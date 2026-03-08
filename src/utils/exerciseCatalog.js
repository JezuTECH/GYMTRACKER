export const TRACKING_MODES = {
  STRENGTH: "strength",
  ENDURANCE: "endurance",
};

export const normalizeText = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");

export const normalizeTrackingMode = (value) =>
  value === TRACKING_MODES.ENDURANCE ? TRACKING_MODES.ENDURANCE : TRACKING_MODES.STRENGTH;

export const canonicalizeText = (value) =>
  normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const buildCanonicalKey = (muscleGroup, exerciseName) =>
  `${canonicalizeText(muscleGroup)}::${canonicalizeText(exerciseName)}`;

export const normalizeCanonicalAliases = (value) => {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(
    source
      .map((item) => normalizeText(item).toLowerCase())
      .filter(Boolean)
  )];
};

export const getExerciseIdentity = (entry = {}) => ({
  exerciseId: normalizeText(entry.exerciseId || entry.id),
  exercise: normalizeText(entry.name || entry.exercise || entry.exerciseNameSnapshot),
  muscleGroup: normalizeText(entry.muscleGroup || entry.muscleGroupSnapshot),
  trackingMode: normalizeTrackingMode(entry.trackingMode || entry.trackingModeSnapshot),
});

export const toExerciseOption = (entry = {}) => {
  const identity = getExerciseIdentity(entry);
  const canonicalKey =
    normalizeText(entry.canonicalKey).toLowerCase() || buildCanonicalKey(identity.muscleGroup, identity.exercise);
  return {
    ...identity,
    canonicalKey,
    aliases: normalizeCanonicalAliases(entry.aliases).filter((item) => item !== canonicalKey),
    description: normalizeText(entry.description),
    youtubeUrl: normalizeText(entry.youtubeUrl),
    technique: normalizeText(entry.technique),
    mistakes: normalizeText(entry.mistakes),
    equipment: normalizeText(entry.equipment),
    notes: normalizeText(entry.notes),
    mediaCount: Math.max(0, Number(entry.mediaCount || 0)),
    mediaBytes: Math.max(0, Number(entry.mediaBytes || 0)),
    hasPhotos: Number(entry.mediaCount || 0) > 0,
    isArchived: Boolean(entry.isArchived),
  };
};

export const getCoveredCanonicalKeys = (entry = {}) => {
  const option = toExerciseOption(entry);
  return [...new Set([option.canonicalKey, ...option.aliases].filter(Boolean))];
};

export const exerciseMatchesCanonicalKey = (entry = {}, canonicalKey = "") =>
  getCoveredCanonicalKeys(entry).includes(normalizeText(canonicalKey).toLowerCase());

export const sortExerciseOptions = (items = []) =>
  [...items].sort((left, right) => {
    const byGroup = left.muscleGroup.localeCompare(right.muscleGroup, "es", { sensitivity: "base" });
    if (byGroup !== 0) return byGroup;
    return left.exercise.localeCompare(right.exercise, "es", { sensitivity: "base" });
  });
