export function calculatePowerScore(series) {
  if (!Array.isArray(series) || series.length === 0) return 0;

  const totals = series.reduce(
    (acc, item) => {
      const weight = typeof item?.weight === "number" ? item.weight : 0;
      const reps = typeof item?.reps === "number" ? item.reps : 0;
      acc.totalReps += reps;
      acc.totalWeightByReps += weight * reps;
      return acc;
    },
    { totalReps: 0, totalWeightByReps: 0 }
  );

  if (totals.totalReps <= 0) return 0;

  const weightedAvgWeight = totals.totalWeightByReps / totals.totalReps;
  return Math.round(weightedAvgWeight * totals.totalReps);
}
