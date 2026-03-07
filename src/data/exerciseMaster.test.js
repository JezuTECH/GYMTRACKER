import { mergeExerciseOptions } from "./exerciseMaster";

describe("exerciseMaster", () => {
  test("mergeExerciseOptions mantiene el maestro cuando el legacy duplica la canonical", () => {
    const masterItems = [
      {
        exerciseId: "master_1",
        exercise: "Crunch Tumbado",
        muscleGroup: "Abdomen",
        canonicalKey: "abdomen::crunch tumbado",
        aliases: [],
      },
    ];
    const legacyItems = [
      {
        exerciseId: "",
        exercise: "Crunch Tumbado",
        muscleGroup: "Abdomen",
        canonicalKey: "abdomen::crunch tumbado",
        aliases: [],
      },
    ];

    expect(mergeExerciseOptions(masterItems, legacyItems)).toEqual(masterItems);
  });

  test("mergeExerciseOptions respeta aliases del maestro para filtrar legacy equivalente", () => {
    const masterItems = [
      {
        exerciseId: "master_2",
        exercise: "Curl Máquina",
        muscleGroup: "Biceps",
        canonicalKey: "biceps::curl maquina",
        aliases: ["biceps::curlmaquina"],
      },
    ];
    const legacyItems = [
      {
        exerciseId: "",
        exercise: "CurlMáquina",
        muscleGroup: "Biceps",
        canonicalKey: "biceps::curlmaquina",
        aliases: [],
      },
      {
        exerciseId: "",
        exercise: "Martillo",
        muscleGroup: "Biceps",
        canonicalKey: "biceps::martillo",
        aliases: [],
      },
    ];

    expect(mergeExerciseOptions(masterItems, legacyItems)).toEqual([
      masterItems[0],
      legacyItems[1],
    ]);
  });
});
