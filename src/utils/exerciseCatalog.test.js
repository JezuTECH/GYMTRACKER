import {
  TRACKING_MODES,
  buildCanonicalKey,
  canonicalizeText,
  exerciseMatchesCanonicalKey,
  getCoveredCanonicalKeys,
  normalizeTrackingMode,
  normalizeText,
  toExerciseOption,
} from "./exerciseCatalog";

describe("exerciseCatalog", () => {
  test("normalizeText colapsa espacios", () => {
    expect(normalizeText("  Press   banca  ")).toBe("Press banca");
  });

  test("canonicalizeText elimina tildes y pasa a minusculas", () => {
    expect(canonicalizeText(" Bíceps ")).toBe("biceps");
  });

  test("buildCanonicalKey unifica equivalencias seguras", () => {
    expect(buildCanonicalKey("Espalda", "Remo con barra")).toBe("espalda::remo con barra");
    expect(buildCanonicalKey("espalda", "  Remo con  barra  ")).toBe("espalda::remo con barra");
  });

  test("normalizeTrackingMode solo acepta endurance de forma explicita", () => {
    expect(normalizeTrackingMode(TRACKING_MODES.ENDURANCE)).toBe(TRACKING_MODES.ENDURANCE);
    expect(normalizeTrackingMode("otra cosa")).toBe(TRACKING_MODES.STRENGTH);
  });

  test("toExerciseOption normaliza el ejercicio maestro", () => {
    expect(
      toExerciseOption({
        id: "ex_1",
        name: " Elíptica ",
        muscleGroup: " Cardio y Aeróbico ",
        trackingMode: TRACKING_MODES.ENDURANCE,
      })
    ).toMatchObject({
      exerciseId: "ex_1",
      exercise: "Elíptica",
      muscleGroup: "Cardio y Aeróbico",
      trackingMode: TRACKING_MODES.ENDURANCE,
      canonicalKey: "cardio y aerobico::eliptica",
    });
  });

  test("toExerciseOption normaliza alias legacy y evita duplicar la canonical actual", () => {
    expect(
      toExerciseOption({
        id: "ex_2",
        name: "Curl Máquina",
        muscleGroup: "Biceps",
        aliases: ["biceps::curlmaquina", "BICEPS::CURLMAQUINA", "biceps::curl maquina"],
      })
    ).toMatchObject({
      canonicalKey: "biceps::curl maquina",
      aliases: ["biceps::curlmaquina"],
    });
  });

  test("exerciseMatchesCanonicalKey reconoce alias legacy del mismo ejercicio", () => {
    const option = {
      id: "ex_3",
      name: "Curl Máquina",
      muscleGroup: "Biceps",
      aliases: ["biceps::curlmaquina"],
    };

    expect(exerciseMatchesCanonicalKey(option, "biceps::curl maquina")).toBe(true);
    expect(exerciseMatchesCanonicalKey(option, "biceps::curlmaquina")).toBe(true);
    expect(getCoveredCanonicalKeys(option)).toEqual([
      "biceps::curl maquina",
      "biceps::curlmaquina",
    ]);
  });
});
