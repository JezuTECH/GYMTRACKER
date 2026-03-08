import {
  TRACKING_MODES,
  normalizeText,
  normalizeTrackingMode,
} from "./exerciseCatalog";

const pad2 = (value) => String(value).padStart(2, "0");

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const dateKeyLocal = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const getKpiDateRange = (days) => {
  const safeDays = Number(days) === 30 ? 30 : 7;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (safeDays - 1));

  const dateKeys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dateKeys.push(dateKeyLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return { days: safeDays, start, end, dateKeys };
};

const sortTopList = (map, limit = 5) =>
  Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label, "es", { sensitivity: "base" }))
    .slice(0, limit);

export const buildKpiSummary = ({
  days,
  workouts = [],
  dateKeys = [],
  dailyMetricsByDate = {},
  exerciseMasterById = {},
}) => {
  const activeDays = new Set();
  const uniqueExercises = new Set();
  const activeMuscleGroups = new Set();
  const strengthGroups = new Map();
  const strengthExercises = new Map();
  const strengthDays = new Map();
  const enduranceExercises = new Map();
  const enduranceGroups = new Map();

  let totalRecords = 0;
  let strengthRecords = 0;
  let enduranceRecords = 0;
  let totalStrengthPower = 0;
  let enduranceMinutes = 0;
  let enduranceDistance = 0;
  let hasEnduranceDistance = false;

  workouts.forEach((item) => {
    const exerciseId = normalizeText(item.exerciseId);
    const master = exerciseMasterById[exerciseId];
    const exercise = normalizeText(master?.exercise || item.exercise || item.exerciseNameSnapshot);
    const muscleGroup = normalizeText(master?.muscleGroup || item.muscleGroup || item.muscleGroupSnapshot);
    const trackingMode = normalizeTrackingMode(item.trackingMode || item.trackingModeSnapshot);
    const timestamp =
      item.timestamp instanceof Date
        ? item.timestamp
        : item.timestamp?.toDate?.() ||
          (typeof item.timestamp?.seconds === "number" ? new Date(item.timestamp.seconds * 1000) : null);

    totalRecords += 1;
    if (timestamp) activeDays.add(dateKeyLocal(timestamp));
    if (exercise) {
      uniqueExercises.add(exercise);
    }
    if (muscleGroup) {
      activeMuscleGroups.add(muscleGroup);
    }

    if (trackingMode === TRACKING_MODES.ENDURANCE) {
      const minutes = Math.max(0, Math.round(toFiniteNumber(item.durationMin)));
      const distance = toFiniteNumber(item.distanceKm);
      enduranceRecords += 1;
      enduranceMinutes += minutes;
      if (distance > 0) {
        enduranceDistance += distance;
        hasEnduranceDistance = true;
      }
      if (exercise && minutes > 0) {
        enduranceExercises.set(exercise, (enduranceExercises.get(exercise) || 0) + minutes);
      }
      if (muscleGroup && minutes > 0) {
        enduranceGroups.set(muscleGroup, (enduranceGroups.get(muscleGroup) || 0) + minutes);
      }
      return;
    }

    strengthRecords += 1;
    const power = Math.max(0, toFiniteNumber(item.weight)) * Math.max(0, toFiniteNumber(item.reps));
    totalStrengthPower += power;
    if (exercise && power > 0) {
      strengthExercises.set(exercise, (strengthExercises.get(exercise) || 0) + power);
    }
    if (muscleGroup && power > 0) {
      strengthGroups.set(muscleGroup, (strengthGroups.get(muscleGroup) || 0) + power);
    }
    if (timestamp && power > 0) {
      const dayKey = dateKeyLocal(timestamp);
      strengthDays.set(dayKey, (strengthDays.get(dayKey) || 0) + power);
    }
  });

  let totalMinutes = 0;
  let totalCalories = 0;
  let hasMinutes = false;
  let hasCalories = false;

  dateKeys.forEach((dateKey) => {
    const metric = dailyMetricsByDate?.[dateKey];
    if (!metric || typeof metric !== "object") return;
    const minutes = Math.max(0, Math.round(toFiniteNumber(metric.minutes)));
    const calories = Math.max(0, Math.round(toFiniteNumber(metric.calories)));
    if (minutes > 0) {
      totalMinutes += minutes;
      hasMinutes = true;
      activeDays.add(dateKey);
    }
    if (calories > 0) {
      totalCalories += calories;
      hasCalories = true;
    }
  });

  const averageMinutesPerActiveDay =
    hasMinutes && activeDays.size > 0 ? Math.round(totalMinutes / activeDays.size) : null;
  const totalStrengthPowerRounded = strengthRecords > 0 ? Math.round(totalStrengthPower) : null;
  const bestStrengthDayPower =
    strengthDays.size > 0 ? Math.round(Math.max(...strengthDays.values())) : null;
  const averageStrengthPowerPerDay =
    strengthDays.size > 0 ? Math.round(totalStrengthPower / strengthDays.size) : null;
  const enduranceDistanceRounded = hasEnduranceDistance ? Number(enduranceDistance.toFixed(2)) : null;
  const averageSpeedKmh =
    enduranceDistanceRounded && enduranceMinutes > 0
      ? Number(((enduranceDistanceRounded / enduranceMinutes) * 60).toFixed(2))
      : null;
  const endurancePace =
    enduranceDistanceRounded && enduranceMinutes > 0
      ? Number((enduranceMinutes / enduranceDistanceRounded).toFixed(2))
      : null;

  return {
    days: Number(days) === 30 ? 30 : 7,
    activeDays: activeDays.size,
    totalRecords,
    uniqueExercises: uniqueExercises.size,
    activeMuscleGroups: activeMuscleGroups.size,
    totalMinutes: hasMinutes ? totalMinutes : null,
    averageMinutesPerActiveDay,
    totalCalories: hasCalories ? totalCalories : null,
    strengthRecords,
    enduranceRecords,
    totalStrengthPower: totalStrengthPowerRounded,
    bestStrengthDayPower,
    averageStrengthPowerPerDay,
    enduranceMinutes,
    enduranceDistance: enduranceDistanceRounded,
    averageSpeedKmh,
    endurancePace,
    strengthGroups: sortTopList(strengthGroups),
    strengthExercises: sortTopList(strengthExercises),
    enduranceExercises: sortTopList(enduranceExercises),
    enduranceGroups: sortTopList(enduranceGroups),
  };
};
