import {
  buildWorkoutSnapshot,
  formatDistanceKm,
  formatDurationMin,
  formatPace,
  getEnduranceMetrics,
  getStrengthMetrics,
  isEnduranceRecord,
} from "./workoutMetrics";

describe("workoutMetrics", () => {
  test("getStrengthMetrics calcula power score y promedios", () => {
    expect(
      getStrengthMetrics([
        { weight: 50, reps: 10 },
        { weight: 60, reps: 8 },
      ])
    ).toMatchObject({
      powerScore: 980,
      averageWeight: 54.4,
      averageReps: 9,
      totalReps: 18,
    });
  });

  test("getEnduranceMetrics calcula duracion, distancia, velocidad y ritmo", () => {
    expect(
      getEnduranceMetrics([
        { durationMin: 30, distanceKm: 5 },
        { durationMin: 15, distanceKm: 2.5 },
      ])
    ).toMatchObject({
      totalDurationMin: 45,
      totalDistanceKm: 7.5,
      averageSpeedKmh: 10,
      paceMinPerKm: 6,
    });
  });

  test("buildWorkoutSnapshot respeta el modo endurance", () => {
    const snapshot = buildWorkoutSnapshot({
      exerciseId: "ex_1",
      exercise: "Remo",
      muscleGroup: "Cardio",
      trackingMode: "endurance",
      durationMin: "25",
      distanceKm: "6.2",
      weight: "70",
      reps: "12",
    });

    expect(snapshot).toMatchObject({
      exerciseId: "ex_1",
      exercise: "Remo",
      muscleGroup: "Cardio",
      trackingModeSnapshot: "endurance",
      durationMin: 25,
      distanceKm: 6.2,
      weight: null,
      reps: null,
    });
    expect(isEnduranceRecord(snapshot)).toBe(true);
  });

  test("formatters muestran etiquetas legibles", () => {
    expect(formatDistanceKm(5)).toBe("5 km");
    expect(formatDistanceKm(5.5)).toBe("5.5 km");
    expect(formatDurationMin(42)).toBe("42 min");
    expect(formatPace(5.5)).toBe("5:30 min/km");
  });
});

