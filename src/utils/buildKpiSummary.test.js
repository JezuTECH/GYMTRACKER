import { buildKpiSummary, dateKeyLocal } from "./buildKpiSummary";

describe("buildKpiSummary", () => {
  test("prioriza el nombre del maestro y calcula KPI utiles", () => {
    const now = new Date(2026, 2, 7, 10, 30);
    const yesterday = new Date(2026, 2, 6, 9, 15);
    const workouts = [
      {
        exerciseId: "ex-1",
        exercise: "CurlMaquina",
        muscleGroup: "Biceps",
        trackingMode: "strength",
        weight: 18,
        reps: 12,
        timestamp: now,
      },
      {
        exerciseId: "ex-1",
        exercise: "CurlMaquina",
        muscleGroup: "Biceps",
        trackingMode: "strength",
        weight: 20,
        reps: 10,
        timestamp: now,
      },
      {
        exerciseId: "ex-2",
        exercise: "Cinta",
        muscleGroup: "Piernas",
        trackingMode: "endurance",
        durationMin: 30,
        distanceKm: 5,
        timestamp: yesterday,
      },
    ];

    const summary = buildKpiSummary({
      days: 7,
      workouts,
      dateKeys: [dateKeyLocal(yesterday), dateKeyLocal(now)],
      dailyMetricsByDate: {
        [dateKeyLocal(now)]: { minutes: 70, calories: 540 },
        [dateKeyLocal(yesterday)]: { minutes: 30, calories: 260 },
      },
      exerciseMasterById: {
        "ex-1": { exercise: "Curl Máquina", muscleGroup: "Biceps" },
        "ex-2": { exercise: "Cinta", muscleGroup: "Cardio" },
      },
    });

    expect(summary.activeDays).toBe(2);
    expect(summary.totalRecords).toBe(3);
    expect(summary.uniqueExercises).toBe(2);
    expect(summary.activeMuscleGroups).toBe(2);
    expect(summary.totalMinutes).toBe(100);
    expect(summary.averageMinutesPerActiveDay).toBe(50);
    expect(summary.totalCalories).toBe(800);
    expect(summary.strengthRecords).toBe(2);
    expect(summary.enduranceRecords).toBe(1);
    expect(summary.totalStrengthPower).toBe(416);
    expect(summary.bestStrengthDayPower).toBe(416);
    expect(summary.averageStrengthPowerPerDay).toBe(416);
    expect(summary.enduranceMinutes).toBe(30);
    expect(summary.enduranceDistance).toBe(5);
    expect(summary.averageSpeedKmh).toBe(10);
    expect(summary.endurancePace).toBe(6);
    expect(summary.strengthExercises[0]).toEqual({ label: "Curl Máquina", value: 416 });
    expect(summary.strengthGroups[0]).toEqual({ label: "Biceps", value: 416 });
    expect(summary.enduranceExercises[0]).toEqual({ label: "Cinta", value: 30 });
    expect(summary.enduranceGroups[0]).toEqual({ label: "Cardio", value: 30 });
  });
});
