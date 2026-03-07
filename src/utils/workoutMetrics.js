import { TRACKING_MODES, normalizeText, normalizeTrackingMode } from "./exerciseCatalog";

const toNumberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getTrackingModeForRecord = (record = {}) =>
  normalizeTrackingMode(record.trackingModeSnapshot || record.trackingMode);

export const isEnduranceRecord = (record = {}) =>
  getTrackingModeForRecord(record) === TRACKING_MODES.ENDURANCE;

export const getStrengthMetrics = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      powerScore: 0,
      averageWeight: null,
      averageReps: null,
      totalReps: 0,
    };
  }

  const totals = rows.reduce(
    (acc, row) => {
      const weight = toNumberOrNull(row.weight) ?? 0;
      const reps = toNumberOrNull(row.reps) ?? 0;
      acc.totalWeightByReps += weight * reps;
      acc.totalReps += reps;
      acc.seriesCount += reps > 0 ? 1 : 0;
      return acc;
    },
    { totalWeightByReps: 0, totalReps: 0, seriesCount: 0 }
  );

  const averageWeight =
    totals.totalReps > 0 ? Number((totals.totalWeightByReps / totals.totalReps).toFixed(1)) : null;
  const averageReps =
    totals.seriesCount > 0 ? Math.round(totals.totalReps / totals.seriesCount) : null;

  return {
    powerScore: Math.round(totals.totalWeightByReps),
    averageWeight,
    averageReps,
    totalReps: totals.totalReps,
  };
};

export const getEnduranceMetrics = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      totalDurationMin: 0,
      totalDistanceKm: null,
      averageSpeedKmh: null,
      paceMinPerKm: null,
    };
  }

  const totals = rows.reduce(
    (acc, row) => {
      const durationMin = toNumberOrNull(row.durationMin) ?? 0;
      const distanceKm = toNumberOrNull(row.distanceKm);
      acc.totalDurationMin += durationMin;
      if (distanceKm != null && distanceKm >= 0) {
        acc.totalDistanceKm += distanceKm;
        acc.hasDistance = true;
      }
      return acc;
    },
    { totalDurationMin: 0, totalDistanceKm: 0, hasDistance: false }
  );

  const totalDistanceKm = totals.hasDistance ? Number(totals.totalDistanceKm.toFixed(2)) : null;
  const averageSpeedKmh =
    totalDistanceKm && totals.totalDurationMin > 0
      ? Number(((totalDistanceKm / totals.totalDurationMin) * 60).toFixed(2))
      : null;
  const paceMinPerKm =
    totalDistanceKm && totals.totalDurationMin > 0
      ? Number((totals.totalDurationMin / totalDistanceKm).toFixed(2))
      : null;

  return {
    totalDurationMin: totals.totalDurationMin,
    totalDistanceKm,
    averageSpeedKmh,
    paceMinPerKm,
  };
};

export const buildWorkoutSnapshot = ({
  exerciseId,
  exercise,
  muscleGroup,
  trackingMode,
  weight,
  reps,
  durationMin,
  distanceKm,
}) => {
  const normalizedMode = normalizeTrackingMode(trackingMode);
  return {
    exerciseId: normalizeText(exerciseId),
    exercise: normalizeText(exercise),
    muscleGroup: normalizeText(muscleGroup),
    trackingModeSnapshot: normalizedMode,
    weight: normalizedMode === TRACKING_MODES.STRENGTH ? toNumberOrNull(weight) : null,
    reps: normalizedMode === TRACKING_MODES.STRENGTH ? toNumberOrNull(reps) : null,
    durationMin: normalizedMode === TRACKING_MODES.ENDURANCE ? toNumberOrNull(durationMin) : null,
    distanceKm: normalizedMode === TRACKING_MODES.ENDURANCE ? toNumberOrNull(distanceKm) : null,
  };
};

export const formatDistanceKm = (value) => {
  const parsed = toNumberOrNull(value);
  if (parsed == null) return "-";
  return `${parsed.toFixed(parsed % 1 === 0 ? 0 : 1)} km`;
};

export const formatDurationMin = (value) => {
  const parsed = toNumberOrNull(value);
  if (parsed == null) return "-";
  return `${Math.round(parsed)} min`;
};

export const formatPace = (value) => {
  const parsed = toNumberOrNull(value);
  if (parsed == null || parsed <= 0) return "-";
  const wholeMinutes = Math.floor(parsed);
  const seconds = Math.round((parsed - wholeMinutes) * 60);
  return `${wholeMinutes}:${String(seconds).padStart(2, "0")} min/km`;
};

