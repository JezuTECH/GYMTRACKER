// src/components/ExerciseForm.jsx
import { useState, useEffect, useRef, useMemo } from "react";
import { calculateWeightedAverage, calculateAverageReps } from "../utils/calculateAverages";
import CalcInfoModal from "./CalcInfoModal";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db, auth } from "../firebase/config";

const ExerciseForm = ({ user, onViewChart }) => {
  const [exerciseName, setExerciseName] = useState("");

// ✅ NUEVO BLOQUE: capturar parámetros de la URL al cargar
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const ex = params.get("exercise");
  const mg = params.get("muscleGroup");
  if (ex) setExerciseName(ex);
  if (mg) setMuscleGroup(mg);
}, []);

// ✅ Mover aquí el de limpieza
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has("exercise") || params.has("muscleGroup")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}, []);

  const [muscleGroup, setMuscleGroup] = useState("");
  const [allExercises, setAllExercises] = useState([]);

  // === Sugerencias para exerciseName (texto libre) ===
  const [openSug, setOpenSug] = useState(false);
  const sugBoxRef = useRef(null);

  // === Sugerencias para muscleGroup (texto libre) ===
  const [openGroupSug, setOpenGroupSug] = useState(false);
  const groupSugRef = useRef(null);
  const [groupSuggestions, setGroupSuggestions] = useState([]);

  const muscleGroupInputRef = useRef(null);
  const exerciseInputRef = useRef(null);

  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");

  const [suggestions, setSuggestions] = useState([]);
  const filteredSuggestions = useMemo(() => {
    const q = (exerciseName || "").toLowerCase().trim();
    if (!q) return suggestions.slice(0, 20);
    return suggestions.filter(n => (n || "").toLowerCase().includes(q)).slice(0, 20);
  }, [exerciseName, suggestions]);
  useEffect(() => {
    function handleOutside(e) {
      const t = e.target;
      if (sugBoxRef.current && !sugBoxRef.current.contains(t)) setOpenSug(false);
      if (groupSugRef.current && !groupSugRef.current.contains(t)) setOpenGroupSug(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);
  const [lastWeight, setLastWeight] = useState(null);
  const [lastReps, setLastReps] = useState(null);
  const [lastTimestamp, setLastTimestamp] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [summaryData, setSummaryData] = useState([]);
  const [infoItem, setInfoItem] = useState(null);
  const [headerInfo, setHeaderInfo] = useState(null);
  const [prevHeaderInfo, setPrevHeaderInfo] = useState(null);

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
      setGroupSuggestions([...new Set(all.map((d) => d.muscleGroup).filter(Boolean))].sort());
      fetchSummary(all);
    };
    fetchExercises();
  }, [user]);

  // Helper: PowerScore de un conjunto de series (filas)
  const calcPowerFromRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) return 0;
    const totalWR = rows.reduce((s, r) => s + ((Number(r.weight) || 0) * (Number(r.reps) || 0)), 0);
    const totalReps = rows.reduce((s, r) => s + (Number(r.reps) || 0), 0);
    const avgWeight = totalReps > 0 ? totalWR / totalReps : 0;
    return Math.round(avgWeight * totalReps);
  };

  // Helper: recompute latest-day stats for current selection
  const recomputeLastForSelection = async () => {
    if (!exerciseName || !muscleGroup || !user) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setHeaderInfo(null);
      setPrevHeaderInfo(null);
      return;
    }

    const qSel = query(
      collection(db, "workouts"),
      where("uid", "==", user.uid),
      where("exercise", "==", exerciseName),
      where("muscleGroup", "==", muscleGroup),
      orderBy("timestamp", "desc"),
      limit(150)
    );
    const snapshot = await getDocs(qSel);
    if (snapshot.empty) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setHeaderInfo(null);
      setPrevHeaderInfo(null);
      return;
    }

    const toJsDate = (t) =>
      t?.toDate ? t.toDate() : (t?.seconds ? new Date(t.seconds * 1000) : null);
    const pad2 = (n) => String(n).padStart(2, "0");
    const keyForDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    const docsRaw = snapshot.docs.map((doc) => ({ ...doc.data(), timestamp: doc.data().timestamp }));
    const docs = docsRaw.filter(d => d.delete !== true); // incluye sin campo y con false

    // Agrupar por día y ordenar descendente
    const byDay = new Map();
    for (const d of docs) {
      const dt = toJsDate(d.timestamp);
      if (!dt) continue;
      const key = keyForDay(dt);
      if (!byDay.has(key)) byDay.set(key, { date: dt, rows: [] });
      byDay.get(key).rows.push(d);
      // conservar la fecha más reciente para ese key
      if (!byDay.get(key).date || dt > byDay.get(key).date) byDay.get(key).date = dt;
    }
    const dayEntries = Array.from(byDay.entries())
      .sort((a, b) => b[1].date - a[1].date); // desc

    const latestEntry = dayEntries[0];
    const prevEntry   = dayEntries[1]; // puede ser undefined

    const docsOfDay = latestEntry ? latestEntry[1].rows : [];

    // Calcular PowerScore del último día y el mejor previo (para saber si es récord)
    const latestPower = calcPowerFromRows(docsOfDay);
    const previousBestPower = (() => {
      const others = dayEntries.slice(1).map(([, entry]) => calcPowerFromRows(entry.rows));
      return others.length ? Math.max(...others) : 0;
    })();
    const isPR = latestPower > previousBestPower && latestPower > 0;

    if (!docsOfDay.length) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setHeaderInfo(null);
      setPrevHeaderInfo(null);
      return;
    }

    // Usar funciones utilitarias para calcular el promedio ponderado y reps medias
    const calcWeight = calculateWeightedAverage(docsOfDay);
    const repsAvg = calculateAverageReps(docsOfDay);

    setLastWeight(calcWeight ?? null);
    setLastReps(repsAvg ?? null);
    setLastTimestamp(latestEntry && latestEntry[1].date ? latestEntry[1].date.toLocaleString() : null);

    const debugRowsHeader = docsOfDay.map((d) => {
      const t = d.timestamp?.toDate ? d.timestamp.toDate() : (d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000) : null);
      return {
        weight: typeof d.weight === "number" ? d.weight : null,
        reps: (typeof d.reps === "number" && d.reps > 0) ? d.reps : 10,
        timestamp: t
      };
    });
    setHeaderInfo({
      exercise: exerciseName,
      muscleGroup,
      weight: calcWeight ?? "-",
      reps: repsAvg ?? "-",
      _lastDay: latestEntry && latestEntry[1].date ? latestEntry[1].date : null,
      _calcWeight: calcWeight ?? null,
      _repsAvg: repsAvg ?? null,
      _debugRows: debugRowsHeader,
      _powerScore: latestPower,
      _prevBestPower: previousBestPower,
      _isPR: isPR,
    });

    // Penúltimo día (si existe)
    if (prevEntry && Array.isArray(prevEntry[1].rows) && prevEntry[1].rows.length > 0) {
      const prevRows = prevEntry[1].rows;
      const prevCalcWeight = calculateWeightedAverage(prevRows);
      const prevRepsAvg = calculateAverageReps(prevRows);
      const debugRowsPrev = prevRows.map((d) => {
        const t = d.timestamp?.toDate ? d.timestamp.toDate() : (d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000) : null);
        return {
          weight: typeof d.weight === "number" ? d.weight : null,
          reps: (typeof d.reps === "number" && d.reps > 0) ? d.reps : 10,
          timestamp: t
        };
      });
      setPrevHeaderInfo({
        exercise: exerciseName,
        muscleGroup,
        weight: prevCalcWeight ?? "-",
        reps: prevRepsAvg ?? "-",
        _lastDay: prevEntry[1].date || null,
        _calcWeight: prevCalcWeight ?? null,
        _repsAvg: prevRepsAvg ?? null,
        _debugRows: debugRowsPrev
      });
    } else {
      setPrevHeaderInfo(null);
    }
  };

  useEffect(() => {
    if (!exerciseName || !user) {
      setLastWeight(null);
      setLastReps(null);
      setLastTimestamp(null);
      setHeaderInfo(null);
      return;
    }
    recomputeLastForSelection();
  }, [exerciseName, muscleGroup, user]);

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
        const qPair = query(
          collection(db, "workouts"),
          where("uid", "==", user.uid),
          where("exercise", "==", ex.exercise),
          where("muscleGroup", "==", ex.muscleGroup),
          orderBy("timestamp", "desc"),
          limit(50)
        );
        const snapshot = await getDocs(qPair);
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
    if (!exerciseName || !weight) return;

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

    // Cambio por incidencia android
    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) {
      alert("No hay sesión activa. Vuelve a iniciar sesión y prueba de nuevo.");
      return;
    }
    // cambio por incidencia android

    try {
      await addDoc(collection(db, "workouts"), {
        exercise: exerciseName,
        muscleGroup,
        weight: parseFloat(weight),
        reps: repsNum,
        timestamp: new Date(),
        delete: false, // ← alinear con consultas que excluyen borrados
        uid,
        userName: user?.displayName || auth.currentUser?.displayName || "Sin nombre",
        email: user?.email || auth.currentUser?.email || null,
      });

      // refrescar sugerencias / resumen
      if (!suggestions.includes(exerciseName) && muscleGroup) {
        const filtered = allExercises
          .filter((ex) => ex.muscleGroup === muscleGroup)
          .map((ex) => ex.exercise);
        const updated = [...new Set([...filtered, exerciseName])].sort();
        setSuggestions(updated);
      }
      const updatedAll = [...allExercises, { exercise: exerciseName, muscleGroup }];
      setAllExercises(updatedAll);
      setGroupSuggestions([...new Set(updatedAll.map((d) => d.muscleGroup).filter(Boolean))].sort());
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
    setOpenGroupSug(false);
    setMuscleGroup("");
    setExerciseName("");
    setWeight("");
    setReps("");
    setLastWeight(null);
    setLastReps(null);
    setLastTimestamp(null);
    setSuggestions([...new Set(allExercises.map((d) => d.exercise))].sort());
    requestAnimationFrame(() => muscleGroupInputRef.current?.focus());
  };
  // Memo para sugerencias filtradas de grupo
  const filteredGroupSuggestions = useMemo(() => {
    const q = (muscleGroup || "").toLowerCase().trim();
    if (!q) return groupSuggestions.slice(0, 20);
    return groupSuggestions.filter(g => (g || "").toLowerCase().includes(q)).slice(0, 20);
  }, [muscleGroup, groupSuggestions]);

  // Mantener sugerencias de ejercicios en sync con muscleGroup
  useEffect(() => {
    if (!muscleGroup) {
      setSuggestions([...new Set(allExercises.map((d) => d.exercise))].sort());
      return;
    }
    const filtered = allExercises
      .filter((ex) => ex.muscleGroup === muscleGroup)
      .map((ex) => ex.exercise);
    setSuggestions([...new Set(filtered)].sort());
  }, [muscleGroup, allExercises]);

  // Limpia solo el ejercicio (mantiene grupo)
  const handleClearExercise = () => {
    setExerciseName("");
    setLastWeight(null);
    setLastReps(null);
    setLastTimestamp(null);
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
    background: "#ccc", // antes #eee
    border: "none",
    fontSize: "1.1rem",
    cursor: "pointer",
    padding: "8px 10px",
    borderRadius: "6px",
    lineHeight: 1,
    color: "black" // añadido
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
      <form onSubmit={handleSubmit} style={{ maxWidth: "400px", margin: "2rem auto", 
                                             justifyContent: "center", padding: "0 1rem" }}>
        <h2>Registrar ejercicio</h2>

        {/* Grupo muscular y ejercicio - bloque estilizado */}
        <div style={{
          backgroundColor: "#a8b1e2ff",
          padding: "1.5rem",
          borderRadius: "10px",
          marginBottom: "1rem",
          border: "2px solid #dbde41ff",
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.5rem",
            justifyContent: "center",
          }}>
            <label htmlFor="muscleGroup" style={{
              fontWeight: "bold",
              fontSize: "1rem",
              minWidth: "80px",
              textAlign: "left",
              display: "inline-block",
              marginRight: "0.5rem",
              lineHeight: "1.2",
              verticalAlign: "baseline",
              marginTop: "-12px",
            }}>Grupo:</label>
            <div ref={groupSugRef} style={{ position: "relative", flex: 1 }}>
              <input
                id="muscleGroup"
                type="text"
                value={muscleGroup}
                onChange={(e) => { setMuscleGroup(e.target.value); setOpenGroupSug(true); }}
                onFocus={() => setOpenGroupSug(true)}
                placeholder="Escribe grupo…"
                ref={muscleGroupInputRef}
                style={{
                  width: "100%",
                  fontSize: "0.95rem",
                  padding: "7px 15px",
                  borderRadius: "12px",
                  border: "1px solid #ccc",
                }}
              />
              {openGroupSug && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderTop: "none",
                    zIndex: 100,
                    maxHeight: 260,
                    overflowY: "auto",
                    borderBottomLeftRadius: 12,
                    borderBottomRightRadius: 12,
                  }}
                >
                  {filteredGroupSuggestions.length === 0 && muscleGroup.trim() && (
                    <div style={{ padding: "8px 10px", color: "#777" }}>
                      No hay resultados para “{muscleGroup.trim()}”.
                    </div>
                  )}
                  {filteredGroupSuggestions.map((g, i) => (
                    <div
                      key={`${g}-${i}`}
                      onClick={() => {
                        setMuscleGroup(g);
                        // Al seleccionar grupo, recalcular sugerencias de ejercicios por ese grupo
                        const filtered = allExercises
                          .filter((ex) => ex.muscleGroup === g)
                          .map((ex) => ex.exercise);
                        setSuggestions([...new Set(filtered)].sort());
                        setOpenGroupSug(false);
                      }}
                      style={{ padding: "8px 10px", cursor: "pointer" }}
                    >
                      {g}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {muscleGroup && (
              <button
                type="button"
                onClick={handleClearMuscleGroup}
                style={{ ...clearBtnStyle, marginTop: "-14px", alignSelf: "center" }}
              >✕</button>
            )}
          </div>

          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.75rem",
            justifyContent: "center",
          }}>
            <label htmlFor="exerciseName" style={{
              fontWeight: "bold",
              fontSize: "1rem",
              minWidth: "80px",
              textAlign: "left",
              display: "inline-block",
              marginRight: "0.5rem",
              lineHeight: "1.2",
              verticalAlign: "baseline",
              marginTop: "-14px",
            }}>Ejercicio:</label>
            <div ref={sugBoxRef} style={{ position: "relative", flex: 1 }}>
              <input
                id="exerciseName"
                type="text"
                value={exerciseName}
                onChange={(e) => { setExerciseName(e.target.value); setOpenSug(true); }}
                onFocus={() => setOpenSug(true)}
                placeholder="Escribe un ejercicio…"
                ref={exerciseInputRef}
                style={{
                  width: "100%",
                  fontSize: "0.95rem",
                  padding: "7px 15px",
                  borderRadius: "12px",
                  border: "1px solid #ccc",
                }}
              />
              {openSug && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderTop: "none",
                    zIndex: 100,
                    maxHeight: 260,
                    overflowY: "auto",
                    borderBottomLeftRadius: 12,
                    borderBottomRightRadius: 12,
                  }}
                >
                  {filteredSuggestions.length === 0 && exerciseName.trim() && (
                    <div style={{ padding: "8px 10px", color: "#777" }}>
                      No hay resultados para “{exerciseName.trim()}”.
                    </div>
                  )}
                  {filteredSuggestions.map((ex, i) => (
                    <div
                      key={`${ex}-${i}`}
                      onClick={() => { setExerciseName(ex); setOpenSug(false); }}
                      style={{ padding: "8px 10px", cursor: "pointer" }}
                    >
                      {ex}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {exerciseName && (
              <button
                type="button"
                onClick={handleClearExercise}
                style={{ ...clearBtnStyle, marginTop: "-14px", alignSelf: "center" }}
              >✕</button>
            )}
          </div>
        </div>
        {/* 
        <datalist id="exercise-list">
          {suggestions.map((ex, i) => (
            <option key={i} value={ex} />
          ))}
        </datalist>
        */}

        {/* Último registro */}
        {headerInfo && (
          <p style={{ fontSize: "0.9rem", color: "gray", display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              <strong>
                {(() => {
                  const rows = headerInfo._debugRows || [];
                  const totalWeightReps = rows.reduce((sum, r) => sum + ((r.weight ?? 0) * (r.reps ?? 0)), 0);
                  const totalReps = rows.reduce((sum, r) => sum + (r.reps ?? 0), 0);
                  const avgWeight = totalReps > 0 ? totalWeightReps / totalReps : 0;
                  const powerScore = Math.round(avgWeight * totalReps);

                  // Indicador respecto a la sesión anterior (penúltima)
                  let indicator = "";
                  if (headerInfo._isPR) {
                    indicator = " 🎉";
                  } else if (prevHeaderInfo && Array.isArray(prevHeaderInfo._debugRows)) {
                    const prevPS = calcPowerFromRows(prevHeaderInfo._debugRows);
                    if (powerScore > prevPS) indicator = " ⬆️";
                    else if (powerScore < prevPS) indicator = " ⬇️";
                    else indicator = " ↔️";
                  }

                  const day = headerInfo._lastDay ? formatDateLabel(headerInfo._lastDay) : null;
                  return day ? `${day} - Powerscore: ${powerScore}${indicator}`
                             : `Powerscore: ${powerScore}${indicator}`;
                })()}
              </strong>
            </span>
            <button
              type="button"
              onClick={e => {
                setInfoItem({
                  ...headerInfo,
                  _clickX: e.clientX,
                  _clickY: e.clientY,
                });
              }}
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
          </p>
        )}

        {/* Penúltimo registro */}
        {prevHeaderInfo && (
          <p style={{ fontSize: "0.9rem", color: "gray", display: "flex", alignItems: "center", gap: 8 }}>
            <span>
              <strong>
                {(() => {
                  const rows = prevHeaderInfo._debugRows || [];
                  const totalWeightReps = rows.reduce((sum, r) => sum + ((r.weight ?? 0) * (r.reps ?? 0)), 0);
                  const totalReps = rows.reduce((sum, r) => sum + (r.reps ?? 0), 0);
                  const avgWeight = totalReps > 0 ? totalWeightReps / totalReps : 0;
                  const powerScore = Math.round(avgWeight * totalReps);
                  const day = prevHeaderInfo._lastDay ? formatDateLabel(prevHeaderInfo._lastDay) : null;
                  return day ? `${day} - Powerscore: ${powerScore}` : `Powerscore: ${powerScore}`;
                })()}
              </strong>
            </span>
            <button
              type="button"
              onClick={e => {
                setInfoItem({
                  ...prevHeaderInfo,
                  _clickX: e.clientX,
                  _clickY: e.clientY,
                });
              }}
              title="Ver detalle del cálculo (penúltima vez)"
              aria-label="Ver detalle del cálculo (penúltima vez)"
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
          </p>
        )}

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end", marginBottom: "1rem" }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="weight">Peso (kg):</label>
            <input
              id="weight"
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="Peso en kg"
              inputMode="decimal"
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "1rem",
                borderRadius: "8px",
                border: "1px solid #ccc",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
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
              style={{
                width: "100%",
                padding: "12px",
                fontSize: "1rem",
                borderRadius: "8px",
                border: "1px solid #ccc",
              }}
            />
          </div>
        </div>

        <button type="submit" style={{ width: "100%", padding: "12px", fontSize: "1rem" }}>Guardar</button>
        {saveStatus === "ok" && <p style={{ color: "green", marginTop: "0.5rem" }}>✅ Guardado correctamente</p>}
        {saveStatus === "nok" && <p style={{ color: "red", marginTop: "0.5rem" }}>❌ Error al guardar</p>}

        {exerciseName && (
          <button
            type="button"
            onClick={() => onViewChart(exerciseName)}
            style={{ width: "100%", marginTop: "0.5rem", backgroundColor: "#eee", padding: "10px", fontSize: "1rem" }}
          >
            Ver progreso
          </button>
        )}

        {/* Resumen */}
        <div style={{ overflowX: "auto", marginTop: "2rem" }}>
          <h3>Resumen de ejercicios</h3>
          {Object.entries(summaryData.reduce((acc, item) => {
            const group = item.muscleGroup || "Sin grupo";
            if (!acc[group]) acc[group] = [];
            acc[group].push(item);
            return acc;
          }, {})).map(([group, exercises], i) => (
            <details key={i} style={{ marginBottom: "1rem" }}>
              <summary style={{ fontWeight: "bold", fontSize: "1.05rem", cursor: "pointer" }}>
                {group}
              </summary>
              <ul style={{ listStyle: "none", paddingLeft: "1rem", marginTop: "0.5rem" }}>
                {exercises.map((item, index) => (
                  <li
                    key={index}
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", cursor: "pointer" }}
                    onClick={() => {
                      setExerciseName(item.exercise);
                      setMuscleGroup(item.muscleGroup);
                      setLastWeight(item._calcWeight && item._calcWeight !== "-" ? item._calcWeight : null);
                      setLastReps(item._repsAvg && item._repsAvg !== "-" ? item._repsAvg : null);
                      setLastTimestamp(item._lastDay ? item._lastDay.toLocaleString() : null);
                      const filtered = allExercises
                        .filter((ex) => ex.muscleGroup === item.muscleGroup)
                        .map((ex) => ex.exercise);
                      setSuggestions([...new Set(filtered)].sort());
                      setOpenSug(false);
                      setOpenGroupSug(false);
                    }}
                  >
                    <div>
                      <strong>{item.exercise}</strong> — {item.weight} kg × {item.reps} reps
                    </div>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setInfoItem({
                          ...item,
                          _clickX: e.clientX,
                          _clickY: e.clientY,
                        });
                      }}
                      title="Ver detalle del cálculo"
                      aria-label="Ver detalle del cálculo"
                      style={{
                        padding: "2px 5px",
                        borderRadius: 4,
                        border: "1px solid #ddd",
                        background: "var(--info-button-bg, #f6f6f6)",
                        cursor: "pointer",
                        fontSize: "0.92rem",
                        lineHeight: 1,
                        minWidth: 0,
                        height: "1.5em",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginLeft: 8
                      }}
                    >
                      ℹ️
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </form>

      {/* Modal info cálculo fijo arriba */}
      {infoItem && (
        <>
          {/* CSS variables para dark mode */}
          <style>
            {`
            :root {
              --modal-bg: #fff;
              --modal-text: #222;
            }
            @media (prefers-color-scheme: dark) {
              :root {
                --modal-bg: #1e1e1e;
                --modal-text: #ddd;
              }
            }
            `}
          </style>
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 1100,
              display: "block",
              overflowY: "auto",
              padding: "2vh 1rem",
            }}
            onClick={() => setInfoItem(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "var(--modal-bg, #fff)",
                color: "var(--modal-text, #222)",
                maxWidth: 520,
                width: "90%",
                borderRadius: 10,
                padding: "16px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
                zIndex: 1101,
                maxHeight: "90vh",
                overflowY: "auto",
                // Center modal vertically around click Y coordinate
                position: "absolute",
                top: `${(infoItem._clickY ?? 300) - 200}px`,
                left: "50%",
                transform: "translateX(-50%)",
                // Remove margin: "2rem auto"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>Cómo calculamos el registro</h3>
                <button onClick={() => setInfoItem(null)} style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer", color: "inherit" }} aria-label="Cerrar">✕</button>
              </div>
              <p style={{ margin: "4px 0 10px", color: "var(--modal-text, #222)" }}>
                <strong>Grupo:</strong> {infoItem.muscleGroup || "-"} &nbsp;·&nbsp; <strong>Ejercicio:</strong> {infoItem.exercise || "-"}
              </p>
              <hr />
              <div>
                <p style={{ margin: "6px 0" }}>
                  <strong>Powerscore:</strong>{" "}
                  {(() => {
                    const rows = infoItem._debugRows || [];
                    const totalWeightReps = rows.reduce((sum, r) => sum + ((r.weight ?? 0) * (r.reps ?? 0)), 0);
                    const totalReps = rows.reduce((sum, r) => sum + (r.reps ?? 0), 0);
                    const avgWeight = totalReps > 0 ? totalWeightReps / totalReps : 0;
                    const powerScore = Math.round(avgWeight * totalReps);
                    return `${powerScore} pts`;
                  })()}
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
                    <li><strong>Peso promedio</strong> = suma de todos los pesos ÷ número de series del día.</li>
                    <li><strong>Reps totales</strong> = suma de todas las reps del día.</li>
                    <li><strong>Power Score</strong> = peso promedio × reps totales.</li>
                  </ul>
                </div>
              </div>
              <div style={{ textAlign: "right", marginTop: 12 }}>
                <button
                  onClick={() => setInfoItem(null)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid #ddd",
                    background: "#ddd", // antes #f6f6f6
                    cursor: "pointer",
                    color: "black" // añadido
                  }}
                >Cerrar</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );

// ✅ NUEVO BLOQUE: limpiar parámetros de la URL después de usarlos

};



export default ExerciseForm;
