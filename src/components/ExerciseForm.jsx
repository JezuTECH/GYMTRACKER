// src/components/ExerciseForm.jsx
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
import { db, storage } from "../firebase/config";
import { ref, getDownloadURL } from "firebase/storage";

const sanitize = (s) =>
  (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_");
const imgPath = (muscleGroup, exercise) =>
  `exerciseImages/${sanitize(muscleGroup)}__${sanitize(exercise)}.jpg`;

const ExerciseForm = ({ user, onViewChart }) => {
  const [exercise, setExercise] = useState("");
  const [muscleGroup, setMuscleGroup] = useState("");
  const [allExercises, setAllExercises] = useState([]);

  const muscleGroupInputRef = useRef(null);
  const exerciseInputRef = useRef(null);

  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");

  const [suggestions, setSuggestions] = useState([]);
  const [lastWeight, setLastWeight] = useState(null);
  const [lastReps, setLastReps] = useState(null);
  const [lastTimestamp, setLastTimestamp] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [summaryData, setSummaryData] = useState([]);

  // Imagen del ejercicio (solo lectura)
  const [imageUrl, setImageUrl] = useState(null);
  const [showImg, setShowImg] = useState(false);

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

  // Cargar imagen si hay selección válida
  useEffect(() => {
    const run = async () => {
      if (!muscleGroup || !exercise) {
        setImageUrl(null);
        return;
      }
      try {
        const url = await getDownloadURL(ref(storage, imgPath(muscleGroup, exercise)));
        setImageUrl(url);
      } catch {
        setImageUrl(null);
      }
    };
    run();
  }, [muscleGroup, exercise]);

  useEffect(() => {
    if (!exercise || !user) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      return;
    }

    const fetchLast = async () => {
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
        setLastWeight(data.weight ?? null);
        setLastReps(data.reps ?? null);
        setLastTimestamp(
          data.timestamp?.seconds
            ? new Date(data.timestamp.seconds * 1000).toLocaleString()
            : data.timestamp?.toDate
              ? data.timestamp.toDate().toLocaleString()
              : null
        );
      } else {
        setLastWeight(null);
        setLastReps(null);
        setLastTimestamp(null);
      }
    };
    fetchLast();
  }, [exercise, muscleGroup, user]);

  const fetchSummary = async (exerciseList) => {
    // pares únicos (grupo + ejercicio)
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
          const d = snapshot.docs[0].data();
          return {
            exercise: ex.exercise,
            muscleGroup: d.muscleGroup || ex.muscleGroup || "",
            weight: d.weight ?? "-",
            reps: d.reps ?? "-",
          };
        } else {
          return {
            exercise: ex.exercise,
            muscleGroup: ex.muscleGroup || "",
            weight: "-",
            reps: "-",
          };
        }
      })
    );

    summaries.sort((a, b) => {
      const ga = (a.muscleGroup || "").toLowerCase();
      const gb = (b.muscleGroup || "").toLowerCase();
      if (ga !== gb) return ga.localeCompare(gb);
      return a.exercise.toLowerCase().localeCompare(b.exercise.toLowerCase());
    });

    setSummaryData(summaries);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!exercise || !weight) return;

    // reps opcional, validar si viene
    let repsNum = null;
    if (reps !== "") {
      const r = parseInt(reps, 10);
      if (Number.isNaN(r) || r < 1 || r > 999) {
        alert("Repeticiones debe ser un número entre 1 y 999");
        return;
      }
      repsNum = r;
    }

    try {
      await addDoc(collection(db, "workouts"), {
        exercise,
        muscleGroup,
        weight: parseFloat(weight),
        reps: repsNum,
        timestamp: new Date(),
        uid: user.uid,
        userName: user.displayName || "Sin nombre",
      });

      // refrescar sugerencias / resumen
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

      // limpiar formulario
      setExercise("");
      setWeight("");
      setReps("");
      setMuscleGroup("");
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setImageUrl(null);
      setSaveStatus("ok");
      window.navigator.vibrate?.(150);
    } catch (err) {
      console.error("Error al guardar:", err);
      setSaveStatus("nok");
      window.navigator.vibrate?.([100, 50, 100]);
    }
  };

  // Limpieza completa al pulsar ✕ en grupo muscular (NO toca BBDD)
  const handleClearMuscleGroup = () => {
    setMuscleGroup("");
    setExercise("");
    setWeight("");
    setReps("");
    setLastWeight(null);
    setLastReps(null);
    setLastTimestamp(null);
    setImageUrl(null);
    setSuggestions([...new Set(allExercises.map((d) => d.exercise))].sort());
    requestAnimationFrame(() => muscleGroupInputRef.current?.focus());
  };

  // Limpia solo el ejercicio (mantiene grupo)
  const handleClearExercise = () => {
    setExercise("");
    setLastWeight(null);
    setLastReps(null);
    setLastTimestamp(null);
    setImageUrl(null);
    requestAnimationFrame(() => exerciseInputRef.current?.focus());
  };

  // Estilos
  const fieldRowStyle = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginBottom: "0.5rem",
  };
  const inputStyle = {
    flex: 1,
    padding: "16px",
    fontSize: "1.1rem",
    borderRadius: "8px",
    border: "1px solid #ccc",
  };
  const clearBtnStyle = {
    flexShrink: 0,
    background: "#eee",
    border: "none",
    fontSize: "1.1rem",
    cursor: "pointer",
    padding: "8px 10px",
    borderRadius: "6px",
    lineHeight: 1,
  };

  return (
    <>
      <form onSubmit={handleSubmit} style={{ maxWidth: "400px", margin: "2rem auto", padding: "0 1rem" }}>
        <h2>Registrar ejercicio</h2>

        {/* Grupo muscular */}
        <label htmlFor="muscleGroup">Grupo muscular:</label>
        <div style={fieldRowStyle}>
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
            ref={muscleGroupInputRef}
            style={inputStyle}
          />
          {muscleGroup && (
            <button
              type="button"
              onClick={handleClearMuscleGroup}
              style={clearBtnStyle}
              aria-label="Limpiar grupo muscular (y ejercicio, peso y reps)"
              title="Limpiar grupo muscular (y ejercicio, peso y reps)"
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

        {/* Ejercicio + Lupa */}
        <label htmlFor="exercise">Ejercicio:</label>
        <div style={fieldRowStyle}>
          <input
            id="exercise"
            list="exercise-list"
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
            placeholder="Escribe o selecciona"
            inputMode="text"
            autoComplete="on"
            style={inputStyle}
            ref={exerciseInputRef}
          />
          {exercise && (
            <button
              type="button"
              onClick={handleClearExercise}
              style={clearBtnStyle}
              aria-label="Limpiar ejercicio"
              title="Limpiar ejercicio"
            >
              ✕
            </button>
          )}
          {/* Lupa: visible solo si hay imagen */}
          {imageUrl && (
            <button
              type="button"
              onClick={() => setShowImg(true)}
              style={{ ...clearBtnStyle, background: "#ddd" }}
              title="Ver foto del ejercicio"
              aria-label="Ver foto del ejercicio"
            >
              🔍
            </button>
          )}
        </div>
        <datalist id="exercise-list">
          {suggestions.map((ex, i) => (
            <option key={i} value={ex} />
          ))}
        </datalist>

        {/* Último registro */}
        {(lastWeight !== null || lastReps !== null) && (
          <p style={{ fontSize: "0.9rem", color: "gray" }}>
            Último registro:{" "}
            <strong>
              {lastWeight !== null ? `${lastWeight} kg` : "-"}{lastReps !== null ? ` × ${lastReps} reps` : ""}
            </strong>
            {lastTimestamp && <> — <strong>{lastTimestamp}</strong></>}
          </p>
        )}

        {/* Peso */}
        <label htmlFor="weight">Peso (kg):</label>
        <input
          id="weight"
          type="number"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="Peso en kg"
          inputMode="decimal"
          style={{ width: "100%", padding: "16px", fontSize: "1.1rem", borderRadius: "8px", border: "1px solid #ccc", marginBottom: "0.75rem" }}
        />

        {/* Reps */}
        <label htmlFor="reps">Repeticiones:</label>
        <input
          id="reps"
          type="number"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="Ej: 8, 10, 12…"
          inputMode="numeric"
          min={1}
          max={999}
          style={{ width: "100%", padding: "16px", fontSize: "1.1rem", borderRadius: "8px", border: "1px solid #ccc", marginBottom: "1rem" }}
        />

        <button type="submit" style={{ width: "100%", padding: "12px", fontSize: "1rem" }}>Guardar</button>
        {saveStatus === "ok" && <p style={{ color: "green", marginTop: "0.5rem" }}>✅ Guardado correctamente</p>}
        {saveStatus === "nok" && <p style={{ color: "red", marginTop: "0.5rem" }}>❌ Error al guardar</p>}

        {exercise && (
          <button
            type="button"
            onClick={() => onViewChart(exercise)}
            style={{ width: "100%", marginTop: "0.5rem", backgroundColor: "#eee", padding: "10px", fontSize: "1rem" }}
          >
            Ver progreso
          </button>
        )}

        {/* Resumen */}
        <div style={{ overflowX: "auto", marginTop: "2rem" }}>
          <h3>Resumen de ejercicios</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "2rem" }}>
            <thead>
              <tr>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Grupo</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem" }}>Ejercicio</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem", textAlign: "center" }}>Último peso</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.5rem", textAlign: "center" }}>Últimas reps</th>
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
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem", textAlign: "center" }}>
                    {item.reps}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </form>

      {/* Modal imagen */}
      {showImg && imageUrl && (
        <div
          onClick={() => setShowImg(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }}
        >
          <img
            src={imageUrl}
            alt="Ejercicio"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }}
          />
        </div>
      )}
    </>
  );
};

export default ExerciseForm;
