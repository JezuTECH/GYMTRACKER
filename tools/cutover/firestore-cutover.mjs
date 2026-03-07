#!/usr/bin/env node

import fs from "fs";
import path from "path";
import process from "process";
import { createRequire } from "module";

const requireFromFunctions = createRequire(
  path.join(process.cwd(), "functions/package.json")
);
const admin = requireFromFunctions("firebase-admin");

const DEFAULT_PROJECT = "gymtracker-a01c8";
const DEFAULT_MODE = "dry-run";
const TRACKING_MODES = {
  STRENGTH: "strength",
  ENDURANCE: "endurance",
};

const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

const canonicalizeText = (value) =>
  normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const buildCanonicalKey = (muscleGroup, exerciseName) =>
  `${canonicalizeText(muscleGroup)}::${canonicalizeText(exerciseName)}`;

const buildMergeKey = (muscleGroup, exerciseName) =>
  `${canonicalizeText(muscleGroup).replace(/\s+/g, "")}::${canonicalizeText(exerciseName).replace(/\s+/g, "")}`;

const normalizeTrackingMode = (value, fallback = TRACKING_MODES.STRENGTH) => {
  if (value === TRACKING_MODES.ENDURANCE) return TRACKING_MODES.ENDURANCE;
  return fallback === TRACKING_MODES.ENDURANCE ? TRACKING_MODES.ENDURANCE : TRACKING_MODES.STRENGTH;
};

const inferTrackingMode = (item = {}, fallback = TRACKING_MODES.STRENGTH) => {
  const explicit = normalizeTrackingMode(
    item.trackingModeSnapshot || item.trackingMode,
    ""
  );
  if (explicit === TRACKING_MODES.ENDURANCE) return TRACKING_MODES.ENDURANCE;
  const hasEnduranceShape =
    Number.isFinite(Number(item.durationMin)) ||
    Number.isFinite(Number(item.distanceKm));
  return hasEnduranceShape ? TRACKING_MODES.ENDURANCE : normalizeTrackingMode(fallback);
};

const isMarkedDeleted = (value = {}) =>
  value.delete === true ||
  value.deleted === true ||
  value.isDeleted === true ||
  value.softDeleted === true ||
  value.deletedAt != null;

const toDateMs = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
};

const serializeValue = (value) => {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, next]) => [key, serializeValue(next)])
    );
  }
  return value;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    mode: DEFAULT_MODE,
    project: DEFAULT_PROJECT,
    outDir: "",
    yes: false,
  };

  args.forEach((arg) => {
    if (arg === "--yes") {
      options.yes = true;
      return;
    }
    if (!arg.startsWith("--")) return;
    const [rawKey, rawValue = ""] = arg.slice(2).split("=");
    if (rawKey === "mode") options.mode = rawValue || DEFAULT_MODE;
    if (rawKey === "project") options.project = rawValue || DEFAULT_PROJECT;
    if (rawKey === "out-dir") options.outDir = rawValue;
  });

  return options;
};

const ensureOutDir = (baseDir = "") => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir =
    baseDir ||
    path.join(process.cwd(), "backups", "cutover", timestamp);
  fs.mkdirSync(outDir, { recursive: true });
  return outDir;
};

const writeJson = (filePath, payload) => {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const buildRepresentative = (variants = []) =>
  [...variants].sort((left, right) => {
    const byDate = (right.lastSeenAtMs || 0) - (left.lastSeenAtMs || 0);
    if (byDate !== 0) return byDate;
    const byCount = (right.sourceCount || 0) - (left.sourceCount || 0);
    if (byCount !== 0) return byCount;
    return left.exercise.localeCompare(right.exercise, "es", { sensitivity: "base" });
  })[0] || null;

const normalizeRoutine = (routine) => {
  if (!routine) return null;
  if (typeof routine === "string") {
    try {
      const parsed = JSON.parse(routine);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }
  return typeof routine === "object" ? routine : null;
};

const loadData = async (db) => {
  const [usersSnap, workoutsSnap, plansSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("workouts").get(),
    db.collection("plans").get(),
  ]);

  const users = usersSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data(),
  }));
  const workouts = workoutsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data(),
  }));
  const plans = plansSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data(),
  }));

  const userIds = new Set(users.map((user) => user.id));
  workouts.forEach((item) => {
    const uid = normalizeText(item.data.uid);
    if (uid) userIds.add(uid);
  });
  plans.forEach((plan) => {
    const uid = normalizeText(plan.data.uid);
    if (uid) userIds.add(uid);
  });

  const mastersByUser = {};
  const legacyByUser = {};

  for (const uid of userIds) {
    const [exerciseSnap, legacySnap] = await Promise.all([
      db.collection("users").doc(uid).collection("exercises").get(),
      db.collection("users").doc(uid).collection("exerciseLibrary").get(),
    ]);
    mastersByUser[uid] = exerciseSnap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data(),
    }));
    legacyByUser[uid] = legacySnap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data(),
    }));
  }

  return { users, workouts, plans, mastersByUser, legacyByUser };
};

const analyzeData = ({
  users,
  workouts,
  plans,
  mastersByUser,
  legacyByUser,
}) => {
  const report = {
    users: users.length,
    workouts: workouts.length,
    plans: plans.length,
    legacyDocs: Object.values(legacyByUser).reduce((acc, items) => acc + items.length, 0),
    existingMasters: Object.values(mastersByUser).reduce((acc, items) => acc + items.length, 0),
    createdMasters: 0,
    updatedMasters: 0,
    workoutUpdates: 0,
    planUpdates: 0,
    conflicts: [],
    usersSummary: [],
  };

  const planMap = new Map(plans.map((item) => [item.id, item]));
  const workoutMap = new Map(workouts.map((item) => [item.id, item]));
  const userStates = new Map();

  const getUserState = (uid) => {
    if (!userStates.has(uid)) {
      const existingMasters = mastersByUser[uid] || [];
      const legacyEntries = legacyByUser[uid] || [];
      const byId = new Map();
      const byMergeKey = new Map();
      const legacyByMergeKey = new Map();
      existingMasters.forEach((entry) => {
        const name = normalizeText(entry.data.name || entry.data.exercise);
        const muscleGroup = normalizeText(entry.data.muscleGroup);
        const canonicalKey =
          normalizeText(entry.data.canonicalKey).toLowerCase() ||
          buildCanonicalKey(muscleGroup, name);
        const aliases = Array.isArray(entry.data.aliases)
          ? entry.data.aliases.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
          : [];
        const mergeKeys = new Set([
          buildMergeKey(muscleGroup, name),
          ...aliases.map((alias) => {
            const [group = "", exercise = ""] = alias.split("::");
            return `${group.replace(/\s+/g, "")}::${exercise.replace(/\s+/g, "")}`;
          }),
        ]);
        const normalized = {
          id: entry.id,
          uid,
          name,
          muscleGroup,
          trackingMode: inferTrackingMode(entry.data),
          canonicalKey,
          aliases,
          mergeKeys,
          source: "master",
        };
        byId.set(entry.id, normalized);
        mergeKeys.forEach((mergeKey) => {
          const previous = byMergeKey.get(mergeKey);
          if (previous && previous.id !== normalized.id) {
            report.conflicts.push({
              type: "duplicate-master-merge-key",
              uid,
              mergeKey,
              ids: [previous.id, normalized.id],
            });
            return;
          }
          byMergeKey.set(mergeKey, normalized);
        });
      });

      legacyEntries.forEach((entry) => {
        const data = entry.data || {};
        const muscleGroup = normalizeText(data.muscleGroup || data.group);
        const exercise = normalizeText(data.exercise || data.name || data.exerciseName);
        if (!muscleGroup || !exercise) return;
        const mergeKey = buildMergeKey(muscleGroup, exercise);
        const updatedAtMs = Math.max(toDateMs(data.updatedAt), toDateMs(data.createdAt));
        const normalized = {
          id: entry.id,
          mergeKey,
          exercise,
          muscleGroup,
          description: normalizeText(data.description),
          youtubeUrl: normalizeText(data.youtubeUrl || data.videoUrl),
          technique: normalizeText(data.technique),
          mistakes: normalizeText(data.mistakes),
          equipment: normalizeText(data.equipment),
          notes: normalizeText(data.notes),
          updatedAtMs,
        };
        const previous = legacyByMergeKey.get(mergeKey);
        if (!previous || normalized.updatedAtMs >= previous.updatedAtMs) {
          legacyByMergeKey.set(mergeKey, normalized);
        }
      });

      userStates.set(uid, {
        uid,
        byId,
        byMergeKey,
        legacyByMergeKey,
        proposedGroups: new Map(),
        createdMasters: [],
        updatedMasters: [],
        workoutUpdates: [],
        planUpdates: [],
      });
    }
    return userStates.get(uid);
  };

  const addCandidate = ({
    uid,
    muscleGroup,
    exercise,
    trackingMode,
    sourceType,
    sourceId,
    seenAtMs,
  }) => {
    const cleanGroup = normalizeText(muscleGroup);
    const cleanExercise = normalizeText(exercise);
    if (!uid || !cleanGroup || !cleanExercise) return;

    const state = getUserState(uid);
    const mergeKey = buildMergeKey(cleanGroup, cleanExercise);
    if (!state.proposedGroups.has(mergeKey)) {
      state.proposedGroups.set(mergeKey, {
        uid,
        mergeKey,
        variants: new Map(),
      });
    }
    const group = state.proposedGroups.get(mergeKey);
    const canonicalKey = buildCanonicalKey(cleanGroup, cleanExercise);
    const variant = group.variants.get(canonicalKey) || {
      canonicalKey,
      exercise: cleanExercise,
      muscleGroup: cleanGroup,
      trackingMode,
      sourceCount: 0,
      sources: [],
      lastSeenAtMs: 0,
    };
    variant.sourceCount += 1;
    variant.trackingMode = variant.trackingMode === TRACKING_MODES.ENDURANCE || trackingMode === TRACKING_MODES.ENDURANCE
      ? TRACKING_MODES.ENDURANCE
      : TRACKING_MODES.STRENGTH;
    variant.lastSeenAtMs = Math.max(variant.lastSeenAtMs, seenAtMs || 0);
    variant.sources.push({ sourceType, sourceId });
    group.variants.set(canonicalKey, variant);
  };

  workouts.forEach((item) => {
    if (isMarkedDeleted(item.data)) return;
    addCandidate({
      uid: normalizeText(item.data.uid),
      muscleGroup: item.data.muscleGroupSnapshot || item.data.muscleGroup,
      exercise: item.data.exerciseNameSnapshot || item.data.exercise,
      trackingMode: inferTrackingMode(item.data),
      sourceType: "workout",
      sourceId: item.id,
      seenAtMs: toDateMs(item.data.timestamp),
    });
  });

  plans.forEach((plan) => {
    const uid = normalizeText(plan.data.uid);
    if (!uid || !Array.isArray(plan.data.routines)) return;
    plan.data.routines.forEach((rawRoutine, index) => {
      const routine = normalizeRoutine(rawRoutine);
      if (!routine) return;
      addCandidate({
        uid,
        muscleGroup: routine.muscleGroupSnapshot || routine.muscleGroup,
        exercise: routine.exerciseNameSnapshot || routine.exercise,
        trackingMode: inferTrackingMode(routine),
        sourceType: "plan",
        sourceId: `${plan.id}#${index}`,
        seenAtMs: toDateMs(plan.data.date),
      });
    });
  });

  Object.entries(legacyByUser).forEach(([uid, items]) => {
    items.forEach((entry) => {
      addCandidate({
        uid,
        muscleGroup: entry.data.muscleGroup || entry.data.group,
        exercise: entry.data.exercise || entry.data.name || entry.data.exerciseName,
        trackingMode: TRACKING_MODES.STRENGTH,
        sourceType: "legacy",
        sourceId: entry.id,
        seenAtMs: Math.max(toDateMs(entry.data.updatedAt), toDateMs(entry.data.createdAt)),
      });
    });
  });

  for (const state of userStates.values()) {
    for (const proposed of state.proposedGroups.values()) {
      const variants = [...proposed.variants.values()];
      const representative = buildRepresentative(variants);
      const existing = state.byMergeKey.get(proposed.mergeKey);
      const legacy = state.legacyByMergeKey.get(proposed.mergeKey) || null;

      if (!existing) {
        state.createdMasters.push({
          mergeKey: proposed.mergeKey,
          representative,
          aliases: variants
            .map((item) => item.canonicalKey)
            .filter((item) => item !== representative.canonicalKey)
            .sort(),
          legacy,
        });
        continue;
      }

      const nextAliases = new Set(existing.aliases || []);
      variants.forEach((variant) => {
        if (variant.canonicalKey !== existing.canonicalKey) {
          nextAliases.add(variant.canonicalKey);
        }
      });
      nextAliases.delete(existing.canonicalKey);

      const nextTrackingMode =
        existing.trackingMode === TRACKING_MODES.ENDURANCE ||
        representative.trackingMode === TRACKING_MODES.ENDURANCE
          ? TRACKING_MODES.ENDURANCE
          : TRACKING_MODES.STRENGTH;

      const aliasesChanged =
        [...nextAliases].sort().join("|") !== [...new Set(existing.aliases || [])].sort().join("|");
      const trackingChanged = nextTrackingMode !== existing.trackingMode;

      if (aliasesChanged || trackingChanged) {
        state.updatedMasters.push({
          id: existing.id,
          mergeKey: proposed.mergeKey,
          aliases: [...nextAliases].sort(),
          trackingMode: nextTrackingMode,
        });
      }
    }
  }

  const lookupMaster = (state, source) => {
    const mergeKey = buildMergeKey(
      source.muscleGroupSnapshot || source.muscleGroup,
      source.exerciseNameSnapshot || source.exercise
    );
    const existing = state.byMergeKey.get(mergeKey);
    if (existing) return existing;
    const pending = state.createdMasters.find((item) => item.mergeKey === mergeKey);
    if (!pending) return null;
    return {
      id: null,
      name: pending.representative.exercise,
      muscleGroup: pending.representative.muscleGroup,
      trackingMode: pending.representative.trackingMode,
      canonicalKey: pending.representative.canonicalKey,
      aliases: pending.aliases,
      mergeKey,
      source: "created",
    };
  };

  workouts.forEach((item) => {
    const uid = normalizeText(item.data.uid);
    if (!uid || isMarkedDeleted(item.data)) return;
    const state = getUserState(uid);
    const master = lookupMaster(state, item.data);
    if (!master) {
      report.conflicts.push({
        type: "missing-master-match",
        collection: "workouts",
        id: item.id,
        uid,
      });
      return;
    }

    const trackingMode = inferTrackingMode(item.data, master.trackingMode);
    const nextPayload = {};
    if (normalizeText(item.data.exerciseId) !== normalizeText(master.id || "")) {
      nextPayload.exerciseId = normalizeText(master.id || "");
    }
    if (normalizeText(item.data.exerciseNameSnapshot) !== master.name) {
      nextPayload.exerciseNameSnapshot = master.name;
    }
    if (normalizeText(item.data.muscleGroupSnapshot) !== master.muscleGroup) {
      nextPayload.muscleGroupSnapshot = master.muscleGroup;
    }
    if (normalizeTrackingMode(item.data.trackingMode, "") !== trackingMode) {
      nextPayload.trackingMode = trackingMode;
    }
    if (normalizeTrackingMode(item.data.trackingModeSnapshot, "") !== trackingMode) {
      nextPayload.trackingModeSnapshot = trackingMode;
    }
    if (Object.keys(nextPayload).length > 0) {
      state.workoutUpdates.push({ id: item.id, payload: nextPayload });
    }
  });

  plans.forEach((plan) => {
    const uid = normalizeText(plan.data.uid);
    if (!uid || !Array.isArray(plan.data.routines)) return;
    const state = getUserState(uid);
    let changed = false;
    const nextRoutines = plan.data.routines.map((rawRoutine) => {
      const routine = normalizeRoutine(rawRoutine);
      if (!routine) return rawRoutine;
      const master = lookupMaster(state, routine);
      if (!master) return routine;
      const trackingMode = inferTrackingMode(routine, master.trackingMode);
      const nextRoutine = {
        ...routine,
        exerciseId: normalizeText(master.id || routine.exerciseId),
        exerciseNameSnapshot: master.name,
        muscleGroupSnapshot: master.muscleGroup,
        trackingModeSnapshot: trackingMode,
      };
      if (
        normalizeText(routine.exerciseId) !== nextRoutine.exerciseId ||
        normalizeText(routine.exerciseNameSnapshot) !== nextRoutine.exerciseNameSnapshot ||
        normalizeText(routine.muscleGroupSnapshot) !== nextRoutine.muscleGroupSnapshot ||
        normalizeTrackingMode(routine.trackingModeSnapshot, "") !== nextRoutine.trackingModeSnapshot
      ) {
        changed = true;
      }
      return nextRoutine;
    });
    if (changed) {
      state.planUpdates.push({ id: plan.id, routines: nextRoutines });
    }
  });

  for (const state of userStates.values()) {
    report.createdMasters += state.createdMasters.length;
    report.updatedMasters += state.updatedMasters.length;
    report.workoutUpdates += state.workoutUpdates.length;
    report.planUpdates += state.planUpdates.length;
    report.usersSummary.push({
      uid: state.uid,
      existingMasters: state.byId.size,
      createdMasters: state.createdMasters.length,
      updatedMasters: state.updatedMasters.length,
      workoutUpdates: state.workoutUpdates.length,
      planUpdates: state.planUpdates.length,
      mergeGroups: state.proposedGroups.size,
    });
  }

  report.usersSummary.sort((left, right) => left.uid.localeCompare(right.uid));

  return { report, userStates, planMap, workoutMap };
};

const getProjectId = (db) =>
  db?.app?.options?.projectId ||
  admin.app()?.options?.projectId ||
  DEFAULT_PROJECT;

const runBackup = async (db, outDir) => {
  const payload = await loadData(db);
  const snapshot = {
    exportedAt: new Date().toISOString(),
    projectId: getProjectId(db),
    users: payload.users.map((item) => ({ id: item.id, data: serializeValue(item.data) })),
    workouts: payload.workouts.map((item) => ({ id: item.id, data: serializeValue(item.data) })),
    plans: payload.plans.map((item) => ({ id: item.id, data: serializeValue(item.data) })),
    mastersByUser: Object.fromEntries(
      Object.entries(payload.mastersByUser).map(([uid, items]) => [
        uid,
        items.map((item) => ({ id: item.id, data: serializeValue(item.data) })),
      ])
    ),
    legacyByUser: Object.fromEntries(
      Object.entries(payload.legacyByUser).map(([uid, items]) => [
        uid,
        items.map((item) => ({ id: item.id, data: serializeValue(item.data) })),
      ])
    ),
  };
  writeJson(path.join(outDir, "firestore-backup.json"), snapshot);
  writeJson(path.join(outDir, "backup-manifest.json"), {
    exportedAt: snapshot.exportedAt,
    projectId: snapshot.projectId,
    users: snapshot.users.length,
    workouts: snapshot.workouts.length,
    plans: snapshot.plans.length,
    masters: Object.values(snapshot.mastersByUser).reduce((acc, items) => acc + items.length, 0),
  });
  return snapshot;
};

const runDryRun = async (db, outDir) => {
  const payload = await loadData(db);
  const analysis = analyzeData(payload);
  writeJson(path.join(outDir, "migration-dry-run.json"), {
    generatedAt: new Date().toISOString(),
    projectId: getProjectId(db),
    report: analysis.report,
    users: [...analysis.userStates.values()].map((state) => ({
      uid: state.uid,
      createdMasters: state.createdMasters,
      updatedMasters: state.updatedMasters,
      workoutUpdates: state.workoutUpdates.slice(0, 50),
      planUpdates: state.planUpdates.map((item) => ({ id: item.id, routines: item.routines.length })),
    })),
  });
  return analysis.report;
};

const applyCutover = async (db, outDir, { yes = false } = {}) => {
  if (!yes) {
    throw new Error("Modo apply bloqueado. Añade --yes para escribir en Firestore.");
  }

  const payload = await loadData(db);
  const analysis = analyzeData(payload);
  if (analysis.report.conflicts.length > 0) {
    writeJson(path.join(outDir, "migration-apply-blocked.json"), analysis.report);
    throw new Error("Hay conflictos en el dry-run. No se aplica la migración.");
  }

  const writer = db.bulkWriter();
  const createdMasterIds = new Map();

  for (const state of analysis.userStates.values()) {
    const userRef = db.collection("users").doc(state.uid);

    for (const item of state.createdMasters) {
      const ref = userRef.collection("exercises").doc();
      createdMasterIds.set(`${state.uid}::${item.mergeKey}`, ref.id);
      writer.set(
        ref,
        {
          uid: state.uid,
          exerciseId: ref.id,
          name: item.representative.exercise,
          muscleGroup: item.representative.muscleGroup,
          trackingMode: item.representative.trackingMode,
          isArchived: false,
          description: item.legacy?.description || "",
          youtubeUrl: item.legacy?.youtubeUrl || "",
          technique: item.legacy?.technique || "",
          mistakes: item.legacy?.mistakes || "",
          equipment: item.legacy?.equipment || "",
          notes: item.legacy?.notes || "",
          canonicalKey: item.representative.canonicalKey,
          aliases: item.aliases,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    for (const item of state.updatedMasters) {
      writer.set(
        userRef.collection("exercises").doc(item.id),
        {
          trackingMode: item.trackingMode,
          aliases: item.aliases,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  for (const state of analysis.userStates.values()) {
    const resolveMasterId = (mergeKey, fallback = "") =>
      normalizeText(state.byMergeKey.get(mergeKey)?.id) ||
      normalizeText(createdMasterIds.get(`${state.uid}::${mergeKey}`)) ||
      normalizeText(fallback);

    state.workoutUpdates.forEach((item) => {
      const source = analysis.workoutMap.get(item.id);
      const mergeKey = buildMergeKey(
        source?.data?.muscleGroupSnapshot || source?.data?.muscleGroup,
        source?.data?.exerciseNameSnapshot || source?.data?.exercise
      );
      const nextPayload = {
        ...item.payload,
        exerciseId: resolveMasterId(mergeKey, item.payload.exerciseId),
      };
      writer.set(db.collection("workouts").doc(item.id), nextPayload, { merge: true });
    });

    state.planUpdates.forEach((item) => {
      const routines = item.routines.map((routine) => {
        const normalizedRoutine = normalizeRoutine(routine);
        if (!normalizedRoutine) return routine;
        const mergeKey = buildMergeKey(
          normalizedRoutine.muscleGroupSnapshot || normalizedRoutine.muscleGroup,
          normalizedRoutine.exerciseNameSnapshot || normalizedRoutine.exercise
        );
        return {
          ...normalizedRoutine,
          exerciseId: resolveMasterId(mergeKey, normalizedRoutine.exerciseId),
        };
      });
      writer.set(
        db.collection("plans").doc(item.id),
        {
          routines,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  }

  await writer.close();

  const verify = await runVerify(db, outDir);
  writeJson(path.join(outDir, "migration-apply-result.json"), {
    appliedAt: new Date().toISOString(),
    projectId: getProjectId(db),
    report: analysis.report,
    verify,
  });
  return { report: analysis.report, verify };
};

const runVerify = async (db, outDir) => {
  const payload = await loadData(db);
  const usersSummary = [];
  let workoutsMissingExerciseId = 0;
  let workoutsMissingSnapshots = 0;
  let plansMissingExerciseId = 0;
  let plansMissingSnapshots = 0;

  payload.users.forEach((user) => {
    const masters = payload.mastersByUser[user.id] || [];
    usersSummary.push({
      uid: user.id,
      masters: masters.length,
    });
  });

  payload.workouts.forEach((item) => {
    if (isMarkedDeleted(item.data)) return;
    if (!normalizeText(item.data.exerciseId)) workoutsMissingExerciseId += 1;
    if (
      !normalizeText(item.data.exerciseNameSnapshot) ||
      !normalizeText(item.data.muscleGroupSnapshot) ||
      !normalizeTrackingMode(item.data.trackingModeSnapshot, "")
    ) {
      workoutsMissingSnapshots += 1;
    }
  });

  payload.plans.forEach((plan) => {
    if (!Array.isArray(plan.data.routines)) return;
    plan.data.routines.forEach((routine) => {
      const normalizedRoutine = normalizeRoutine(routine);
      if (!normalizedRoutine) {
        plansMissingExerciseId += 1;
        plansMissingSnapshots += 1;
        return;
      }
      if (!normalizeText(normalizedRoutine.exerciseId)) plansMissingExerciseId += 1;
      if (
        !normalizeText(normalizedRoutine.exerciseNameSnapshot) ||
        !normalizeText(normalizedRoutine.muscleGroupSnapshot) ||
        !normalizeTrackingMode(normalizedRoutine.trackingModeSnapshot, "")
      ) {
        plansMissingSnapshots += 1;
      }
    });
  });

  const result = {
    generatedAt: new Date().toISOString(),
    projectId: getProjectId(db),
    users: usersSummary,
    workouts: payload.workouts.length,
    plans: payload.plans.length,
    workoutsMissingExerciseId,
    workoutsMissingSnapshots,
    plansMissingExerciseId,
    plansMissingSnapshots,
  };

  writeJson(path.join(outDir, "migration-verify.json"), result);
  return result;
};

const main = async () => {
  const options = parseArgs();
  const outDir = ensureOutDir(options.outDir);
  admin.initializeApp({ projectId: options.project });
  const db = admin.firestore();

  const manifest = {
    startedAt: new Date().toISOString(),
    mode: options.mode,
    projectId: options.project,
    outDir,
  };
  writeJson(path.join(outDir, "run-manifest.json"), manifest);

  let result;
  if (options.mode === "backup") {
    result = await runBackup(db, outDir);
  } else if (options.mode === "dry-run") {
    result = await runDryRun(db, outDir);
  } else if (options.mode === "apply") {
    result = await applyCutover(db, outDir, { yes: options.yes });
  } else if (options.mode === "verify") {
    result = await runVerify(db, outDir);
  } else {
    throw new Error(`Modo no soportado: ${options.mode}`);
  }

  console.log(JSON.stringify(serializeValue(result), null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
