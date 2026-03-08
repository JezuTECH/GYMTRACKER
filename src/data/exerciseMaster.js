import { collection, doc, query, serverTimestamp, where } from "firebase/firestore";
import {
  addDocWithFreshAuth,
  getDocWithFreshAuth,
  getDocsWithFreshAuth,
  setDocWithFreshAuth,
} from "../firebase/firestoreRetry";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";
import {
  TRACKING_MODES,
  buildCanonicalKey,
  exerciseMatchesCanonicalKey,
  getCoveredCanonicalKeys,
  normalizeText,
  normalizeCanonicalAliases,
  normalizeTrackingMode,
  sortExerciseOptions,
  toExerciseOption,
} from "../utils/exerciseCatalog";

const buildExercisePayload = (uid, input = {}, existing = {}) => {
  const exercise = normalizeText(input.exercise || input.name || existing.name);
  const muscleGroup = normalizeText(input.muscleGroup || existing.muscleGroup);
  const trackingMode = normalizeTrackingMode(input.trackingMode || existing.trackingMode);
  const canonicalKey = buildCanonicalKey(muscleGroup, exercise);
  const previousCanonicalKey = normalizeText(existing.canonicalKey).toLowerCase();
  const aliases = new Set(normalizeCanonicalAliases(input.aliases ?? existing.aliases));

  if (previousCanonicalKey && previousCanonicalKey !== canonicalKey) {
    aliases.add(previousCanonicalKey);
  }
  aliases.delete(canonicalKey);

  return {
    uid,
    exerciseId: normalizeText(input.exerciseId || existing.exerciseId),
    name: exercise,
    muscleGroup,
    trackingMode,
    isArchived: Boolean(input.isArchived ?? existing.isArchived),
    description: normalizeText(input.description ?? existing.description),
    youtubeUrl: normalizeText(input.youtubeUrl ?? existing.youtubeUrl),
    technique: normalizeText(input.technique ?? existing.technique),
    mistakes: normalizeText(input.mistakes ?? existing.mistakes),
    equipment: normalizeText(input.equipment ?? existing.equipment),
    notes: normalizeText(input.notes ?? existing.notes),
    canonicalKey,
    aliases: [...aliases].sort(),
    createdAt: existing.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
};

export const getExercisesRef = (db, uid) => collection(db, "users", uid, "exercises");

export const listLegacyPairs = async (db, uid) => {
  const workoutsQuery = query(collection(db, "workouts"), where("uid", "==", uid));
  const snapshot = await getDocsWithFreshAuth(workoutsQuery);
  const seen = new Set();
  const pairs = [];

  snapshot.forEach((snapshotDoc) => {
    const data = snapshotDoc.data();
    if (isMarkedDeleted(data)) return;
    const exercise = normalizeText(data.exercise || data.exerciseNameSnapshot);
    const muscleGroup = normalizeText(data.muscleGroup || data.muscleGroupSnapshot);
    if (!exercise || !muscleGroup) return;
    const trackingMode = normalizeTrackingMode(data.trackingModeSnapshot || data.trackingMode);
    const canonicalKey = buildCanonicalKey(muscleGroup, exercise);
    if (seen.has(canonicalKey)) return;
    seen.add(canonicalKey);
    pairs.push(
      toExerciseOption({
        id: "",
        exerciseId: "",
        exercise,
        muscleGroup,
        trackingMode,
        canonicalKey,
      })
    );
  });

  return sortExerciseOptions(pairs);
};

const listHistoricalAliasesForExerciseId = async (db, uid, exerciseId) => {
  const stableExerciseId = normalizeText(exerciseId);
  if (!stableExerciseId) return [];

  const workoutsQuery = query(
    collection(db, "workouts"),
    where("uid", "==", uid),
    where("exerciseId", "==", stableExerciseId)
  );
  const snapshot = await getDocsWithFreshAuth(workoutsQuery);
  const aliases = new Set();

  snapshot.forEach((snapshotDoc) => {
    const data = snapshotDoc.data();
    if (isMarkedDeleted(data)) return;
    const exercise = normalizeText(data.exerciseNameSnapshot || data.exercise);
    const muscleGroup = normalizeText(data.muscleGroupSnapshot || data.muscleGroup);
    if (!exercise || !muscleGroup) return;
    aliases.add(buildCanonicalKey(muscleGroup, exercise));
  });

  return [...aliases];
};

export const mergeExerciseOptions = (masterItems = [], legacyItems = []) => {
  const seen = new Set(masterItems.flatMap((item) => getCoveredCanonicalKeys(item)));
  return sortExerciseOptions([
    ...masterItems,
    ...legacyItems.filter((item) => !seen.has(item.canonicalKey)),
  ]);
};

export const listUserExercises = async (db, uid) => {
  const exercisesSnap = await getDocsWithFreshAuth(getExercisesRef(db, uid));
  const masterItems = exercisesSnap.docs
    .map((snapshotDoc) => toExerciseOption({ id: snapshotDoc.id, exerciseId: snapshotDoc.id, ...snapshotDoc.data() }))
    .filter((entry) => !entry.isArchived);
  let legacyItems = [];
  try {
    legacyItems = await listLegacyPairs(db, uid);
  } catch (error) {
    console.error("Error cargando pares legacy de ejercicios:", error);
  }
  return mergeExerciseOptions(masterItems, legacyItems);
};

export const findUserExerciseByCanonicalKey = async (db, uid, muscleGroup, exercise) => {
  const canonicalKey = buildCanonicalKey(muscleGroup, exercise);
  const snapshot = await getDocsWithFreshAuth(getExercisesRef(db, uid));
  const items = snapshot.docs
    .map((snapshotDoc) => toExerciseOption({ id: snapshotDoc.id, exerciseId: snapshotDoc.id, ...snapshotDoc.data() }))
    .filter((entry) => !entry.isArchived);
  return items.find((item) => exerciseMatchesCanonicalKey(item, canonicalKey)) || null;
};

export const getUserExerciseById = async (db, uid, exerciseId) => {
  if (!exerciseId) return null;
  const snapshot = await getDocWithFreshAuth(doc(db, "users", uid, "exercises", exerciseId));
  if (!snapshot.exists()) return null;
  return toExerciseOption({ id: snapshot.id, exerciseId: snapshot.id, ...snapshot.data() });
};

export const ensureUserExercise = async (db, uid, input) => {
  const existing = await findUserExerciseByCanonicalKey(db, uid, input.muscleGroup, input.exercise);
  if (existing) return existing;

  const payload = buildExercisePayload(uid, input);
  const newRef = await addDocWithFreshAuth(getExercisesRef(db, uid), {
    ...payload,
    exerciseId: "",
  });

  await setDocWithFreshAuth(
    doc(db, "users", uid, "exercises", newRef.id),
    {
      exerciseId: newRef.id,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    ...toExerciseOption(payload),
    exerciseId: newRef.id,
  };
};

export const saveUserExercise = async (db, uid, exerciseId, input) => {
  const existing = exerciseId ? await getUserExerciseById(db, uid, exerciseId) : null;
  const duplicate = await findUserExerciseByCanonicalKey(db, uid, input.muscleGroup, input.exercise);
  if (duplicate && duplicate.exerciseId !== exerciseId) {
    throw new Error("Ya existe otro ejercicio con ese grupo y nombre.");
  }
  const stableExerciseId = normalizeText(exerciseId || existing?.exerciseId);
  const historicalAliases = await listHistoricalAliasesForExerciseId(db, uid, stableExerciseId);
  const payload = buildExercisePayload(
    uid,
    { ...input, aliases: [...normalizeCanonicalAliases(input.aliases), ...historicalAliases] },
    existing || {}
  );
  const ref = exerciseId
    ? doc(db, "users", uid, "exercises", exerciseId)
    : doc(getExercisesRef(db, uid));

  await setDocWithFreshAuth(
    ref,
    {
      ...payload,
      exerciseId: ref.id,
    },
    { merge: true }
  );

  return {
    ...toExerciseOption({ ...(existing || {}), ...payload }),
    exerciseId: ref.id,
  };
};

export const defaultMasterDraft = {
  exercise: "",
  muscleGroup: "",
  trackingMode: TRACKING_MODES.STRENGTH,
};
