// src/utils/calculateAverages.js

export function calculateWeightedAverage(series) {
  const weightValid = series.filter(s => typeof s.weight === "number");
  if (weightValid.length === 0) return null;

  const totalWeight = weightValid.reduce((sum, s) => sum + s.weight * (s.reps || 10), 0);
  const totalReps = weightValid.reduce((sum, s) => sum + (s.reps || 10), 0);

  return totalReps > 0 ? Math.round((totalWeight / totalReps) * 10) / 10 : null;
}

export function calculateAverageReps(series) {
  const repsValid = series.filter(s => typeof s.reps === "number");
  if (repsValid.length === 0) return null;

  const total = repsValid.reduce((sum, s) => sum + s.reps, 0);
  return Math.round(total / repsValid.length);
}