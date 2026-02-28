import { calculatePowerScore } from "./calculatePowerScore";

describe("calculatePowerScore", () => {
  test("calcula power score ponderado por reps", () => {
    const series = [
      { weight: 100, reps: 5 },
      { weight: 80, reps: 10 },
    ];

    // (100*5 + 80*10) = 1300
    expect(calculatePowerScore(series)).toBe(1300);
  });

  test("devuelve 0 si no hay series válidas", () => {
    expect(calculatePowerScore([])).toBe(0);
    expect(calculatePowerScore(null)).toBe(0);
  });

  test("ignora valores no numéricos y evita división por cero", () => {
    const series = [
      { weight: 100, reps: undefined },
      { weight: "80", reps: 8 },
      { weight: 60, reps: 0 },
    ];

    expect(calculatePowerScore(series)).toBe(0);
  });
});
