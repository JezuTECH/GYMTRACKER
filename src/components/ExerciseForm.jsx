import { useState, useEffect, useRef } from "react";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../firebase/config";

const ExerciseForm = ({ user, onViewChart }) => {
  const [exercise, setExercise] = useState("");
  const [muscleGroup, setMuscleGroup] = useState("");
  const [allExercises, setAllExercises] = useState([]);
  const exerciseInputRef = useRef(null);
  const [weight, setWeight] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [lastWeight, setLastWeight] = useState(null);
  const [lastTimestamp, setLastTimestamp] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [summaryData, setSummaryData] = useState([]);

  useEffect(() => {
    if (!user) return;
    const fetchExercises = async () => {
      const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snapshot = await getDocs(q);
      const all = snapshot.docs.map((doc) => ({
        exercise: doc.data().exercise,
        muscleGroup: doc.data().muscleGroup || "",
      }));
      setAllExercises(all);
      setSuggestions([...new Set(all.map((doc) => doc.exercise))].sort());
      fetchSummary(all);
    };
    fetchExercises();
  }, [user]);

  useEffect(() => {
    if (!exercise || !user) return setLastWeight(null);
    const fetchLastWeight = async () => {
      const q = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        where("exercise", "==", exercise),
        where("muscleGroup", "==", muscleGroup),
        orderBy("timestamp", "desc"),
        limit(1)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const data = snapshot.docs[0].data();
        setLastWeight(data.weight);
        setLastTimestamp(new Date(data.timestamp.seconds * 1000).toLocaleString());
      } else {
        setLastWeight(null);
        setLastTimestamp(null);
      }
    };
    fetchLastWeight();
  }, [exercise, muscleGroup, user]);

  const fetchSummary = async (exerciseList) => {
    // Keep all pairs (muscleGroup, exercise) as provided
    const uniquePairs = [];
    const seen = new Set();
    exerciseList.forEach((ex) => {
      const key = `${ex.muscleGroup}||${ex.exercise}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniquePairs.push(ex);
      }
    });

    const summaries = await Promise.all(
      uniquePairs.map(async (ex) => {
        const q = query(
          collection(db, "workouts"),
          where("uid", "==", user.uid),
          where("exercise", "==", ex.exercise),
          where("muscleGroup", "==", ex.muscleGroup),
          orderBy("timestamp", "desc"),
          limit(1)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          // Ensure muscleGroup is included in summary
          return {
            exercise: ex.exercise,
            weight: snapshot.docs[0].data().weight,
            muscleGroup: snapshot.docs[0].data().muscleGroup || ex.muscleGroup || "",
          };
        } else {
          return {
            exercise: ex.exercise,
            weight: "-",
            muscleGroup: ex.muscleGroup || "",
          };
        }
      })
    );
    summaries.sort((a, b) => {
      if (a.muscleGroup < b.muscleGroup) return -1;
      if (a.muscleGroup > b.muscleGroup) return 1;
      if (a.exercise < b.exercise) return -1;
      if (a.exercise > b.exercise) return 1;
      return 0;
    });
    setSummaryData(summaries);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!exercise || !weight) return;
    try {
      await addDoc(collection(db, "workouts"), {
        exercise,
        muscleGroup,
        weight: parseFloat(weight),
        timestamp: new Date(),
        uid: user.uid,
        userName: user.displayName || "Sin nombre",
      });
      if (!suggestions.includes(exercise) && muscleGroup) {
        const filtered = allExercises
          .filter((ex) => ex.muscleGroup === muscleGroup)
          .map((ex) => ex.exercise);
        const updated = [...new Set([...filtered, exercise])].sort();
        setSuggestions(updated);
      }
      const updatedAll = [...allExercises, { exercise, muscleGroup }];
      setAllExercises(updatedAll);
      fetchSummary(updatedAll);

      setExercise("");
      setWeight("");
      setMuscleGroup("");
      setLastWeight(null);
      setSaveStatus("ok");
      window.navigator.vibrate?.(150);
    } catch (err) {
      console.error("Error al guardar:", err);
      setSaveStatus("nok");
      window.navigator.vibrate?.([100, 50, 100]);
    }
  };

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: "400px", margin: "2rem auto", padding: "0 1rem" }}>
        <h2>Registrar ejercicio</h2>

        <label htmlFor="muscleGroup">Grupo muscular:</label>
        <div style={{ position: "relative" }}>
          <input
            id="muscleGroup"
            list="muscle-group-list"
            value={muscleGroup}
            onChange={(e) => {
              const value = e.target.value;
              setMuscleGroup(value);
              const filtered = allExercises
                .filter((ex) => ex.muscleGroup === value)
                .map((ex) => ex.exercise);
              setSuggestions([...new Set(filtered)].sort());
            }}
            placeholder="Pectoral, Pierna, Espalda..."
            inputMode="text"
            autoComplete="on"
            style={{
              width: "100%",
              padding: "16px",
              fontSize: "1.1rem",
              borderRadius: "8px",
              border: "1px solid #ccc",
              marginBottom: "0.5rem",
            }}
          />
          {muscleGroup && (
            <button
              type="button"
              onClick={() => setMuscleGroup("")}
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                fontSize: "1.2rem",
                cursor: "pointer",
                color: "#999",
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="Clear muscle group"
            >
              ✕
            </button>
          )}
        </div>
        <datalist id="muscle-group-list">
          {Array.from(new Set(allExercises.map((ex) => ex.muscleGroup)))
            .sort()
            .map((group, i) => (
              <option key={i} value={group} />
            ))}
        </datalist>

        <label htmlFor="exercise">Ejercicio:</label>
        <div style={{ position: "relative" }}>
          <input
            id="exercise"
            list="exercise-list"
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
            placeholder="Escribe o selecciona"
            inputMode="text"
            autoComplete="on"
            style={{ width: "100%", padding: "16px", fontSize: "1.1rem", borderRadius: "8px", border: "1px solid #ccc", marginBottom: "0.5rem" }}
            ref={exerciseInputRef}
          />
          {exercise && (
            <button
              type="button"
              onClick={() => setExercise("")}
              style={{
                position: "absolute",
                right: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "transparent",
                border: "none",
                fontSize: "1.2rem",
                cursor: "pointer",
                color: "#999",
                padding: 0,
                lineHeight: 1,
              }}
              aria-label="Clear exercise"
            >
              ✕
            </button>
          )}
        </div>
        <datalist id="exercise-list">
          {suggestions.map((ex, i) => (
            <option key={i} value={ex} />
          ))}
        </datalist>

        {lastWeight !== null && (
          <p style={{ fontSize: "0.9rem", color: "gray" }}>
            Último peso registrado: <strong>{lastWeight} kg</strong><br />
            Fecha: <strong>{lastTimestamp}</strong>
          </p>
        )}

        <label htmlFor="weight">Peso (kg):</label>
        <input
          id="weight"
          type="number"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="Peso en kg"
          inputMode="decimal"
          style={{ width: "100%", padding: "16px", fontSize: "1.1rem", borderRadius: "8px", border: "1px solid #ccc", marginBottom: "1rem" }}
        />

        <button type="submit" style={{ width: "100%", padding: "12px", fontSize: "1rem" }}>Guardar</button>
        {saveStatus === "ok" && <p style={{ color: "green", marginTop: "0.5rem" }}>✅ Guardado correctamente</p>}
        {saveStatus === "nok" && <p style={{ color: "red", marginTop: "0.5rem" }}>❌ Error al guardar</p>}

        {exercise && (
          <button type="button" onClick={() => onViewChart(exercise)} style={{ width: "100%", marginTop: "0.5rem", backgroundColor: "#eee", padding: "10px", fontSize: "1rem" }}>Ver progreso</button>
        )}

        <div style={{ overflowX: "auto", marginTop: "2rem" }}>
          <h3>Resumen de ejercicios</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem" }}>
            <thead>
              <tr>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Grupo</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Ejercicio</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem", textAlign: "center" }}>Último peso (kg)</th>
              </tr>
            </thead>
            <tbody>
              {summaryData.map((item, index) => (
                <tr
                  key={index}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setExercise(item.exercise);
                    setMuscleGroup(item.muscleGroup);
                    const filtered = allExercises
                      .filter((ex) => ex.muscleGroup === item.muscleGroup)
                      .map((ex) => ex.exercise);
                    setSuggestions([...new Set(filtered)].sort());
                    setTimeout(() => {
                      requestAnimationFrame(() => {
                        exerciseInputRef.current?.focus();
                        exerciseInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                      });
                    }, 100);
                  }}
                >
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>
                    {item.muscleGroup || "-"}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>
                    {item.exercise}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem", textAlign: "center" }}>
                    {item.weight}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>
    </>
  );
};

export default ExerciseForm;
