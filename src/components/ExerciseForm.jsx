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
  const [infoItem, setInfoItem] = useState(null);
  const [headerInfo, setHeaderInfo] = useState(null);

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

  // Helper: recompute latest-day stats for current selection
  const recomputeLastForSelection = async () => {
    if (!exercise || !muscleGroup || !user) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setHeaderInfo(null);
      return;
    }

    const q = query(
      collection(db, "workouts"),
      where("uid", "==", user.uid),
      where("exercise", "==", exercise),
      where("muscleGroup", "==", muscleGroup),
      orderBy("timestamp", "desc"),
      limit(50)
    );
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setHeaderInfo(null);
      return;
    }

    const toJsDate = (t) =>
      t?.toDate ? t.toDate() : (t?.seconds ? new Date(t.seconds * 1000) : null);
    const pad2 = (n) => String(n).padStart(2, "0");
    const keyForDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    const docs = snapshot.docs.map((doc) => ({ ...doc.data(), timestamp: doc.data().timestamp }));

    let latestKey = null;
    let latestDate = null;
    for (const d of docs) {
      const dt = toJsDate(d.timestamp);
      if (!dt) continue;
      const key = keyForDay(dt);
      if (!latestDate || dt > latestDate) {
        latestDate = dt;
        latestKey = key;
      }
    }

    const docsOfDay = docs.filter((d) => {
      const dt = toJsDate(d.timestamp);
      return dt && keyForDay(dt) === latestKey;
    });

    if (!docsOfDay.length) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setHeaderInfo(null);
      return;
    }

    let wrSum = 0;
    let repsSum = 0;
    let repsSumForAvg = 0;
    let count = 0;

    docsOfDay.forEach((d) => {
      const w = typeof d.weight === "number" ? d.weight : 0;
      const r = typeof d.reps === "number" && d.reps > 0 ? d.reps : 10; // default 10
      wrSum += w * r;
      repsSum += r;
      repsSumForAvg += r;
      count += 1;
    });

    const calcWeight = repsSum > 0 ? Number((wrSum / repsSum).toFixed(1)) : null;
    const repsAvg = count > 0 ? Math.round(repsSumForAvg / count) : null;

    setLastWeight(calcWeight ?? null);
    setLastReps(repsAvg ?? null);
    setLastTimestamp(latestDate ? latestDate.toLocaleString() : null);

    const debugRowsHeader = docsOfDay.map((d) => {
      const t = d.timestamp?.toDate ? d.timestamp.toDate() : (d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000) : null);
      return {
        weight: typeof d.weight === "number" ? d.weight : null,
        reps: (typeof d.reps === "number" && d.reps > 0) ? d.reps : 10,
        timestamp: t
      };
    });
    setHeaderInfo({
      exercise,
      muscleGroup,
      weight: calcWeight ?? "-",
      reps: repsAvg ?? "-",
      _lastDay: latestDate || null,
      _calcWeight: calcWeight ?? null,
      _repsAvg: repsAvg ?? null,
      _debugRows: debugRowsHeader
    });
  };

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
      setHeaderInfo(null);
      return;
    }
    recomputeLastForSelection();
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
        // Buscar los últimos 50 registros para ese ejercicio/grupo
        const q = query(
          collection(db, "workouts"),
          where("uid", "==", user.uid),
          where("exercise", "==", ex.exercise),
          where("muscleGroup", "==", ex.muscleGroup),
          orderBy("timestamp", "desc"),
          limit(50)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          // Helpers
          const toJsDate = (t) =>
            t?.toDate ? t.toDate() : (t?.seconds ? new Date(t.seconds * 1000) : null);
          const pad2 = (n) => String(n).padStart(2, "0");
          const keyForDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

          const docs = snapshot.docs.map((doc) => ({ ...doc.data(), timestamp: doc.data().timestamp }));

          // Latest day
          let latestKey = null;
          let latestDate = null;
          for (const d of docs) {
            const dt = toJsDate(d.timestamp);
            if (!dt) continue;
            const key = keyForDay(dt);
            if (!latestDate || dt > latestDate) {
              latestDate = dt;
              latestKey = key;
            }
          }

          // Docs of that latest day
          const docsOfDay = docs.filter((d) => {
            const dt = toJsDate(d.timestamp);
            return dt && keyForDay(dt) === latestKey;
          });
          const debugRows = docsOfDay.map((d) => ({
            weight: typeof d.weight === "number" ? d.weight : null,
            reps: (typeof d.reps === "number" && d.reps > 0) ? d.reps : 10,
            timestamp: toJsDate(d.timestamp)
          }));

          if (docsOfDay.length > 0) {
            let wrSum = 0;
            let repsSum = 0;
            let repsSumForAvg = 0;
            let count = 0;

            docsOfDay.forEach((d) => {
              const w = typeof d.weight === "number" ? d.weight : 0;
              const r = typeof d.reps === "number" && d.reps > 0 ? d.reps : 10; // default 10
              wrSum += w * r;
              repsSum += r;
              repsSumForAvg += r;
              count += 1;
            });

            const calcWeight = repsSum > 0 ? Number((wrSum / repsSum).toFixed(1)) : "-";
            const repsAvg = count > 0 ? Math.round(repsSumForAvg / count) : "-";

            return {
              exercise: ex.exercise,
              muscleGroup: docsOfDay[0].muscleGroup || ex.muscleGroup || "",
              weight: calcWeight,
              reps: repsAvg,
              _lastDay: latestDate,
              _calcWeight: calcWeight,
              _repsAvg: repsAvg,
              _debugRows: debugRows,
            };
          } else {
            return {
              exercise: ex.exercise,
              muscleGroup: ex.muscleGroup || "",
              weight: "-",
              reps: "-",
              _lastDay: null,
              _calcWeight: null,
              _repsAvg: null,
              _debugRows: [],
            };
          }
        } else {
          return {
            exercise: ex.exercise,
            muscleGroup: ex.muscleGroup || "",
            weight: "-",
            reps: "-",
            _lastDay: null,
            _calcWeight: null,
            _repsAvg: null,
            _debugRows: [],
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
        email: user.email || null,
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

      // limpiar lo justo: mantener grupo y ejercicio para facilitar series consecutivas
      setWeight("");
      setReps("");
      setSaveStatus("ok");
      window.navigator.vibrate?.(150);

      // Recalcular resumen de cabecera (último día) para la selección actual
      await recomputeLastForSelection();
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

  // Helper para fecha DD/MM/AAAA (día semana)
  const formatDateLabel = (value) => {
    if (!value) return "";
    const d = value instanceof Date ? value : new Date(value);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const weekday = d.toLocaleDateString("es-ES", { weekday: "long" });
    return `${dd}/${mm}/${yyyy} (${weekday})`;
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
          <p style={{ fontSize: "0.9rem", color: "gray", display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              Último registro:{" "}
              <strong>
                {lastWeight !== null ? `${lastWeight} kg` : "-"}{lastReps !== null ? ` × ${lastReps} reps` : ""}
              </strong>
              {lastTimestamp && <> — <strong>{lastTimestamp}</strong></>}
            </span>
            {headerInfo && (
              <button
                type="button"
                onClick={() => setInfoItem(headerInfo)}
                title="Ver detalle del cálculo"
                aria-label="Ver detalle del cálculo"
                style={{
                  padding: "2px 5px",
                  borderRadius: 4,
                  border: "1px solid #ddd",
                  background: "#f6f6f6",
                  cursor: "pointer",
                  fontSize: "0.92rem",
                  lineHeight: 1,
                  minWidth: 0,
                  height: "1.5em",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ℹ️
              </button>
            )}
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
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.25rem 0.35rem", fontSize: "0.97rem" }}>Grupo</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.25rem 0.35rem", fontSize: "0.97rem" }}>Ejercicio</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.25rem 0.35rem", textAlign: "center", fontSize: "0.97rem" }}>Peso</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.25rem 0.35rem", textAlign: "center", fontSize: "0.97rem" }}>Reps</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: "0.25rem 0.35rem", textAlign: "center", fontSize: "0.97rem" }}>Info</th>
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
                    // También actualizar lastWeight, lastReps, lastTimestamp con los valores calculados
                    setLastWeight(item._calcWeight && item._calcWeight !== "-" ? item._calcWeight : null);
                    setLastReps(item._repsAvg && item._repsAvg !== "-" ? item._repsAvg : null);
                    setLastTimestamp(
                      item._lastDay
                        ? item._lastDay.toLocaleString()
                        : null
                    );
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
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0.35rem", fontSize: "0.97rem" }}>
                    {item.muscleGroup || "-"}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0.35rem", fontSize: "0.97rem" }}>
                    {item.exercise}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0.35rem", textAlign: "center", fontSize: "0.97rem" }}>
                    {item.weight}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.25rem 0.35rem", textAlign: "center", fontSize: "0.97rem" }}>
                    {item.reps}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.18rem 0.18rem", textAlign: "center", fontSize: "0.97rem" }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setInfoItem(item); }}
                      title="Ver detalle del cálculo"
                      aria-label="Ver detalle del cálculo"
                      style={{
                        padding: "2px 5px",
                        borderRadius: 4,
                        border: "1px solid #ddd",
                        background: "#f6f6f6",
                        cursor: "pointer",
                        fontSize: "0.92rem",
                        lineHeight: 1,
                        minWidth: 0,
                        height: "1.5em",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ℹ️
                    </button>
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

      {/* Modal info cálculo */}
      {infoItem && (
        <div
          onClick={() => setInfoItem(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", maxWidth: 520, width: "90%", borderRadius: 10, padding: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Cómo calculamos el registro</h3>
              <button onClick={() => setInfoItem(null)} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer" }} aria-label="Cerrar">✕</button>
            </div>
            <p style={{ margin: "4px 0 10px", color: "#444" }}>
              <strong>Grupo:</strong> {infoItem.muscleGroup || "-"} &nbsp;·&nbsp; <strong>Ejercicio:</strong> {infoItem.exercise || "-"}
            </p>
            <hr />
            <div>
              <p style={{ margin: "6px 0" }}>
                <strong>Resultado:</strong> {infoItem._calcWeight !== "-" && infoItem._calcWeight != null ? `${infoItem._calcWeight} kg` : "-"}
                {" "}
                {infoItem._repsAvg !== "-" && infoItem._repsAvg != null ? `× ${infoItem._repsAvg} reps` : ""}
                {infoItem._lastDay ? ` — ${formatDateLabel(infoItem._lastDay)}` : ""}
              </p>
              <p style={{ margin: "6px 0 8px" }}><strong>Series consideradas ese día:</strong></p>
              {Array.isArray(infoItem._debugRows) && infoItem._debugRows.length > 0 ? (
                <ul style={{ maxHeight: 220, overflow: "auto", paddingLeft: 18, margin: 0 }}>
                  {infoItem._debugRows.map((r, idx) => (
                    <li key={idx} style={{ margin: "2px 0" }}>
                      {r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "--:--"}
                      {": "}
                      <strong>{r.weight ?? '-'}</strong> kg × <strong>{r.reps ?? '-'}</strong> reps
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No se han encontrado series para ese día.</p>
              )}
              <hr style={{ margin: "12px 0" }} />
              <div>
                <h4 style={{ margin: "6px 0" }}>Racional del cálculo</h4>
                <p style={{ margin: 0, lineHeight: 1.5 }}>
                  Para cada combinación <strong>grupo</strong> + <strong>ejercicio</strong> buscamos el <strong>último día</strong> en el que lo realizaste.
                  De ese día tomamos todas las series y calculamos:
                </p>
                <ul style={{ marginTop: 6 }}>
                  <li><strong>Reps medias</strong> = media aritmética de las repeticiones del día (si una serie no tiene reps, usamos 10).</li>
                  <li><strong>Peso</strong> = sumatorio de <em>peso × reps</em> dividido por la suma total de reps del día. Redondeado a 1 decimal.</li>
                </ul>
              </div>
            </div>
            <div style={{ textAlign: "right", marginTop: 12 }}>
              <button onClick={() => setInfoItem(null)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd", background: "#f6f6f6", cursor: "pointer" }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ExerciseForm;
