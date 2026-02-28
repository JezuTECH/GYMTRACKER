// src/components/ExerciseForm.jsx
import { useState, useEffect, useRef, useMemo } from "react";
import { calculateWeightedAverage, calculateAverageReps } from "../utils/calculateAverages";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";
// import CalcInfoModal from "./CalcInfoModal";
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

// [2025-08-25] Motivo: evitar duplicados por espacios finales o múltiples espacios internos
// [2025-08-27] Motivo: ocultar sugerencias de ejercicios cuando no hay grupo; mantener escritura libre.
const normalizeText = (str) => (str ?? "")
  .trim()
  .replace(/\s+/g, " ");

const triggerHaptic = (pattern = 10) => {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
};


const ExerciseForm = ({
  user,
  selectedExercise,
  onViewChart,
  onViewLibrary,
  onSelectExercise,
}) => {
  const [exerciseName, setExerciseName] = useState("");

// ✅ NUEVO BLOQUE: capturar parámetros de la URL al cargar
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const ex = params.get("exercise");
  const mg = params.get("muscleGroup");
// if (ex) setExerciseName(ex);
// if (mg) setMuscleGroup(mg);
  if (ex) setExerciseName(normalizeText(ex));
  if (mg) setMuscleGroup(normalizeText(mg));
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
  const [weightSuggestions, setWeightSuggestions] = useState([]);

  const [suggestions, setSuggestions] = useState([]);
  const filteredSuggestions = useMemo(() => {
    const mgClean = normalizeText(muscleGroup);
    if (!mgClean) return []; // sin grupo ⇒ no sugerencias
    const q = (exerciseName || "").toLowerCase().trim();
    if (!q) return suggestions.slice(0, 20);
    return suggestions
      .filter((n) => (n || "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [exerciseName, suggestions, muscleGroup]);
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
  const [openInline, setOpenInline] = useState(null); // 'last' | 'prev' | null
  const [openSummaryKey, setOpenSummaryKey] = useState(null); // acordeón en Resumen
  const [infoItem, setInfoItem] = useState(null);
  const [headerInfo, setHeaderInfo] = useState(null);
  const [prevHeaderInfo, setPrevHeaderInfo] = useState(null);

  useEffect(() => {
    const exercise = normalizeText(exerciseName);
    const muscle = normalizeText(muscleGroup);
    if (!exercise || !muscle) {
      onSelectExercise?.(null);
      return;
    }
    onSelectExercise?.({ exercise, muscleGroup: muscle });
  }, [exerciseName, muscleGroup, onSelectExercise]);

  useEffect(() => {
    if (!selectedExercise || typeof selectedExercise !== "object") return;
    const nextExercise = normalizeText(selectedExercise.exercise);
    const nextGroup = normalizeText(selectedExercise.muscleGroup);
    if (!nextExercise) return;

    setExerciseName((previous) =>
      normalizeText(previous) === nextExercise ? previous : nextExercise
    );
    setMuscleGroup((previous) =>
      normalizeText(previous) === nextGroup ? previous : nextGroup
    );
  }, [selectedExercise]);

  useEffect(() => {
    if (!user) return;
    const fetchExercises = async () => {
      const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snapshot = await getDocs(q);

      const all = snapshot.docs
        .map((doc) => doc.data())
        .filter((data) => !isMarkedDeleted(data))
        .map((data) => ({
          exercise: data.exercise,
          muscleGroup: data.muscleGroup || "",
        }));
      setAllExercises(all);

      setSuggestions([]); // [2025-08-27] Sin grupo, ocultamos sugerencias
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
      setWeightSuggestions([]);
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
      setWeightSuggestions([]);
      return;
    }

    const toJsDate = (t) =>
      t?.toDate ? t.toDate() : (t?.seconds ? new Date(t.seconds * 1000) : null);
    const pad2 = (n) => String(n).padStart(2, "0");
    const keyForDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    const docsRaw = snapshot.docs.map((doc) => ({ ...doc.data(), timestamp: doc.data().timestamp }));
    const docs = docsRaw.filter((d) => !isMarkedDeleted(d)); // incluye sin campo y con false

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

    const recentDayWeights = dayEntries
      .slice(0, 3)
      .map(([, entry]) => calculateWeightedAverage(entry.rows))
      .filter((value) => typeof value === "number" && Number.isFinite(value))
      .map((value) => Number(value.toFixed(1)));

    const nextSuggestions = [...new Set(recentDayWeights)];
    if (nextSuggestions.length > 1) {
      const avgRecent = Number(
        (nextSuggestions.reduce((sum, value) => sum + value, 0) / nextSuggestions.length).toFixed(1)
      );
      if (!nextSuggestions.includes(avgRecent)) {
        nextSuggestions.push(avgRecent);
      }
    }
    setWeightSuggestions(nextSuggestions);

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
      setPrevHeaderInfo(null);
      setOpenInline(null);
      setWeightSuggestions([]);
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

          const docs = snapshot.docs
            .map((doc) => ({ ...doc.data(), timestamp: doc.data().timestamp }))
            .filter((data) => !isMarkedDeleted(data));

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
            const powerScore = calcPowerFromRows(debugRows);

            return {
              exercise: ex.exercise,
              muscleGroup: docsOfDay[0].muscleGroup || ex.muscleGroup || "",
              weight: calcWeight,
              reps: repsAvg,
              _powerScore: powerScore,
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
              _powerScore: 0,
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
            _powerScore: 0,
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
    triggerHaptic(10);
//  if (!exerciseName || !weight) return;
    // Normalizar textos para evitar duplicados por espacios
    const cleanExercise = normalizeText(exerciseName);
    const cleanGroup = normalizeText(muscleGroup);
    if (!cleanExercise || !weight) return;
 
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
//       exercise: exerciseName,
//      muscleGroup,
        exercise: cleanExercise,
        muscleGroup: cleanGroup,
        weight: parseFloat(weight),
        reps: repsNum,
        timestamp: new Date(),
        delete: false, // ← alinear con consultas que excluyen borrados
        uid,
        userName: user?.displayName || auth.currentUser?.displayName || "Sin nombre",
        email: user?.email || auth.currentUser?.email || null,
      });

      // refrescar sugerencias / resumen
//    if (!suggestions.includes(exerciseName) && muscleGroup) {
      if (!suggestions.includes(cleanExercise) && cleanGroup) {
        const filtered = allExercises
//       .filter((ex) => ex.muscleGroup === muscleGroup)
//          .map((ex) => ex.exercise);
//        const updated = [...new Set([...filtered, exerciseName])].sort();
          .filter((ex) => normalizeText(ex.muscleGroup) === cleanGroup)
          .map((ex) => normalizeText(ex.exercise));
        const updated = [...new Set([...filtered, cleanExercise])].sort();
        setSuggestions(updated);
      }
//    const updatedAll = [...allExercises, { exercise: exerciseName, muscleGroup }];
      const updatedAll = [...allExercises, { exercise: cleanExercise, muscleGroup: cleanGroup }];
      setAllExercises(updatedAll);
//    setGroupSuggestions([...new Set(updatedAll.map((d) => d.muscleGroup).filter(Boolean))].sort());
      setGroupSuggestions([...new Set(updatedAll.map((d) => normalizeText(d.muscleGroup)).filter(Boolean))].sort());
      setExerciseName(cleanExercise);
      setMuscleGroup(cleanGroup);
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
    setHeaderInfo(null);
    setPrevHeaderInfo(null);
    setOpenInline(null);
    setWeightSuggestions([]);
    onSelectExercise?.(null);
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
//  if (!muscleGroup) {
//     setSuggestions([...new Set(allExercises.map((d) => d.exercise))].sort());
//     return; }
// const filtered = allExercises
//    .filter((ex) => ex.muscleGroup === muscleGroup)
//    .map((ex) => ex.exercise);
    const mgClean = normalizeText(muscleGroup);
    if (!mgClean) {
      setSuggestions([...new Set(allExercises.map((d) => normalizeText(d.exercise)))].sort());
      return;
    }
    const filtered = allExercises
      .filter((ex) => normalizeText(ex.muscleGroup) === mgClean)
      .map((ex) => normalizeText(ex.exercise));
    setSuggestions([...new Set(filtered)].sort());
  }, [muscleGroup, allExercises]);

  // Limpia solo el ejercicio (mantiene grupo)
  const handleClearExercise = () => {
    setExerciseName("");
    setLastWeight(null);
    setLastReps(null);
    setLastTimestamp(null);
    setHeaderInfo(null);
    setPrevHeaderInfo(null);
    setOpenInline(null);
    setWeightSuggestions([]);
    onSelectExercise?.(null);
    requestAnimationFrame(() => exerciseInputRef.current?.focus());
  };

  const adjustWeight = (delta) => {
    setWeight((prev) => {
      if (prev === "" && delta < 0) return "";
      const base = prev === "" ? 0 : parseFloat(prev);
      const safeBase = Number.isFinite(base) ? base : 0;
      const next = Math.max(0, safeBase + delta);
      return String(next);
    });
  };

  const adjustReps = (delta) => {
    setReps((prev) => {
      if (prev === "" && delta < 0) return "";
      const base = prev === "" ? 0 : parseInt(prev, 10);
      const safeBase = Number.isFinite(base) ? base : 0;
      const next = Math.min(999, Math.max(1, safeBase + delta));
      return String(next);
    });
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
    <div className="exercise-form-shell">
      <form className="exercise-form-card tracker-form" onSubmit={handleSubmit}>
        <h2>Registrar ejercicio</h2>

        {/* Grupo muscular y ejercicio - bloque estilizado */}
        <div className="exercise-selector-card">
          <div className="exercise-selector-row">
            <label className="exercise-selector-label" htmlFor="muscleGroup">Grupo:</label>
            <div className="exercise-suggest-wrap" ref={groupSugRef}>
              <input
                id="muscleGroup"
                type="text"
                value={muscleGroup}
                onChange={(e) => { setMuscleGroup(e.target.value); setOpenGroupSug(true); }}
                onFocus={() => setOpenGroupSug(true)}
                onBlur={(e) => setMuscleGroup(normalizeText(e.target.value))}
                placeholder="Escribe grupo…"
                ref={muscleGroupInputRef}
              />
              {openGroupSug && (
                  <div
                    className="exercise-suggest-menu"
                  >
                  {filteredGroupSuggestions.length === 0 && muscleGroup.trim() && (
                    <div className="exercise-suggest-empty">
                      No hay resultados para “{muscleGroup.trim()}”.
                    </div>
                  )}
                  {filteredGroupSuggestions.map((g, i) => (
                    <div
                      className="exercise-suggest-item"
                      key={`${g}-${i}`}
 //                    onClick={() => {
 //                     setMuscleGroup(g);
                       onClick={() => {
                        const cleanG = normalizeText(g);
                        setMuscleGroup(cleanG);
                        // Al seleccionar grupo, recalcular sugerencias de ejercicios por ese grupo
                        const filtered = allExercises
//                        .filter((ex) => ex.muscleGroup === g)
//                       .map((ex) => ex.exercise);
                          .filter((ex) => normalizeText(ex.muscleGroup) === cleanG)
                          .map((ex) => normalizeText(ex.exercise));
                        setSuggestions([...new Set(filtered)].sort());
                        setOpenGroupSug(false);
                      }}
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
                className="exercise-clear-btn"
              >✕</button>
            )}
          </div>

          <div className="exercise-selector-row">
            <label className="exercise-selector-label" htmlFor="exerciseName">Ejercicio:</label>
            <div className="exercise-suggest-wrap" ref={sugBoxRef}>
              <input
                id="exerciseName"
                type="text"
                value={exerciseName}
                onChange={(e) => { setExerciseName(e.target.value); setOpenSug(true); }}
                onFocus={() => setOpenSug(true)}
                onBlur={(e) => setExerciseName(normalizeText(e.target.value))}
                placeholder="Escribe un ejercicio…"
                ref={exerciseInputRef}
              />
              {openSug && normalizeText(muscleGroup) && (
          <div
                  className="exercise-suggest-menu"
                >
                  { normalizeText(muscleGroup) && filteredSuggestions.length === 0 && exerciseName.trim() && (
                    <div className="exercise-suggest-empty">
                      No hay resultados para “{exerciseName.trim()}”.
                    </div>
                  )}
                  {filteredSuggestions.map((ex, i) => (
                    <div
                      className="exercise-suggest-item"
                      key={`${ex}-${i}`}
//                    onClick={() => { setExerciseName(ex); setOpenSug(false); }}
                      onClick={() => { setExerciseName(normalizeText(ex)); setOpenSug(false); }}
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
                className="exercise-clear-btn"
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
          <>
          <p className="exercise-headline">
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
              onClick={() => setOpenInline(openInline === 'last' ? null : 'last')}
              title="Ver detalle del cálculo"
              aria-label="Ver detalle del cálculo"
              aria-expanded={openInline === 'last'}
              className="exercise-info-btn"
            >
              ℹ️
            </button>
          </p>
          {openInline === 'last' && headerInfo && Array.isArray(headerInfo._debugRows) && (
            <div className="exercise-detail-card" style={{
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              padding: "6px 8px",
              margin: "6px 0 10px",
              background: "#fafafa",
            }}>
              <table className="exercise-detail-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Hora</th>
                    <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Peso (kg)</th>
                    <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Reps</th>
                  </tr>
                </thead>
                <tbody>
                  {[...headerInfo._debugRows]
                    .sort((a, b) => (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0))
                    .map((r, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0" }}>
                          {r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{r.weight ?? '-'}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{r.reps ?? '-'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          </>
        )}

        {/* Penúltimo registro */}
        {prevHeaderInfo && (
          <>
          <p className="exercise-headline">
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
              onClick={() => setOpenInline(openInline === 'prev' ? null : 'prev')}
              title="Ver detalle del cálculo (penúltima vez)"
              aria-label="Ver detalle del cálculo (penúltima vez)"
              aria-expanded={openInline === 'prev'}
              className="exercise-info-btn"
            >
              ℹ️
            </button>
          </p>
          {openInline === 'prev' && prevHeaderInfo && Array.isArray(prevHeaderInfo._debugRows) && (
            <div className="exercise-detail-card" style={{
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              padding: "6px 8px",
              margin: "6px 0 10px",
              background: "#fafafa",
            }}>
              <table className="exercise-detail-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Hora</th>
                    <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Peso (kg)</th>
                    <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Reps</th>
                  </tr>
                </thead>
                <tbody>
                  {[...prevHeaderInfo._debugRows]
                    .sort((a, b) => (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0))
                    .map((r, idx) => (
                      <tr key={idx}>
                        <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0" }}>
                          {r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                        </td>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{r.weight ?? '-'}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{r.reps ?? '-'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          </>
        )}

        <div className="exercise-entry-grid">
          <div className="exercise-entry-field">
            <label htmlFor="weight">Peso (kg):</label>
            <div className="exercise-stepper-field">
              <input
                id="weight"
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="Peso en kg"
                inputMode="decimal"
                list={weightSuggestions.length > 0 ? "weight-suggestions" : undefined}
                className="exercise-stepper-input"
              />
              <div className="exercise-stepper-buttons">
                <button type="button" className="exercise-stepper-btn" onClick={() => adjustWeight(-1)} aria-label="Reducir peso">−</button>
                <button type="button" className="exercise-stepper-btn" onClick={() => adjustWeight(1)} aria-label="Aumentar peso">+</button>
              </div>
            </div>
            {weightSuggestions.length > 0 && (
              <datalist id="weight-suggestions">
                {weightSuggestions.map((suggestedWeight, index) => (
                  <option key={`${suggestedWeight}-${index}`} value={String(suggestedWeight)} />
                ))}
              </datalist>
            )}
          </div>
          <div className="exercise-entry-field">
            <label htmlFor="reps">Repeticiones:</label>
            <div className="exercise-stepper-field">
              <input
                id="reps"
                type="number"
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                placeholder="Ej: 8, 10, 12…"
                inputMode="numeric"
                min={1}
                max={999}
                className="exercise-stepper-input"
              />
              <div className="exercise-stepper-buttons">
                <button type="button" className="exercise-stepper-btn" onClick={() => adjustReps(-1)} aria-label="Reducir repeticiones">−</button>
                <button type="button" className="exercise-stepper-btn" onClick={() => adjustReps(1)} aria-label="Aumentar repeticiones">+</button>
              </div>
            </div>
          </div>
        </div>

        <div className="exercise-actions">
          <div className="exercise-actions-primary">
            <button className="exercise-save-btn exercise-action-btn" type="submit">Guardar</button>
          </div>

          {exerciseName && (
            <div className="exercise-actions-secondary">
              <button
                className="exercise-progress-btn exercise-action-btn"
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  const selected = {
                    exercise: normalizeText(exerciseName),
                    muscleGroup: normalizeText(muscleGroup),
                  };
                  onSelectExercise?.(selected);
                  onViewChart();
                }}
              >
                Ver progreso
              </button>

              <button
                className="exercise-library-btn exercise-action-btn"
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  const selected = {
                    exercise: normalizeText(exerciseName),
                    muscleGroup: normalizeText(muscleGroup),
                  };
                  onSelectExercise?.(selected);
                  onViewLibrary?.();
                }}
              >
                Ver ficha
              </button>
            </div>
          )}
        </div>

        {saveStatus === "ok" && <p className="exercise-save-state is-ok">✅ Guardado correctamente</p>}
        {saveStatus === "nok" && <p className="exercise-save-state is-error">❌ Error al guardar</p>}

        {/* Resumen */}
        <div className="exercise-summary-panel">
          <h3>Resumen de ejercicios</h3>
          {Object.entries(summaryData.reduce((acc, item) => {
            const group = item.muscleGroup || "Sin grupo";
            if (!acc[group]) acc[group] = [];
            acc[group].push(item);
            return acc;
          }, {})).map(([group, exercises], i) => (
            <details className="exercise-summary-group" key={i}>
              <summary className="exercise-summary-group-title">
                {group}
              </summary>
              <ul className="exercise-summary-list">
                {exercises.map((item, index) => {
                  const summaryKey = `${item.muscleGroup}||${item.exercise}`;
                  const itemPowerScore = Number(item._powerScore) || 0;
                  const lastDayLabel = item._lastDay ? formatDateLabel(item._lastDay) : "Sin fecha";

                  return (
                    <li
                      className="exercise-summary-item"
                      key={index}
                      onClick={() => {
   //                   setExerciseName(item.exercise);
   //                   setMuscleGroup(item.muscleGroup);
                        setExerciseName(normalizeText(item.exercise));
                        setMuscleGroup(normalizeText(item.muscleGroup));
                        setLastWeight(item._calcWeight && item._calcWeight !== "-" ? item._calcWeight : null);
                        setLastReps(item._repsAvg && item._repsAvg !== "-" ? item._repsAvg : null);
                        setLastTimestamp(item._lastDay ? item._lastDay.toLocaleString() : null);
                        const filtered = allExercises
    .filter((ex) => normalizeText(ex.muscleGroup) === normalizeText(item.muscleGroup))
    .map((ex) => normalizeText(ex.exercise));
  setSuggestions([...new Set(filtered)].sort());
  setOpenSug(false);
                        setOpenGroupSug(false);
                      }}
                    >
                      <div className="exercise-summary-row">
                        <strong className="exercise-summary-title">{item.exercise}</strong>
                        <span className="exercise-summary-score">Score {itemPowerScore}</span>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setOpenSummaryKey(openSummaryKey === summaryKey ? null : summaryKey);
                          }}
                          title="Ver detalle del último día"
                          aria-label="Ver detalle del último día"
                          aria-expanded={openSummaryKey === summaryKey}
                          className="exercise-info-btn exercise-summary-info-btn"
                        >
                          ℹ️
                        </button>
                      </div>

                      {openSummaryKey === summaryKey && Array.isArray(item._debugRows) && (
                        <div className="exercise-detail-card" style={{
                          border: "1px solid #e5e5e5",
                          borderRadius: 8,
                          padding: "6px 8px",
                          margin: "6px 0 2px",
                          background: "#fafafa",
                        }}>
                          <p className="exercise-summary-lastday">Último día: {lastDayLabel}</p>
                          <table className="exercise-detail-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.95rem" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Hora</th>
                                <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Peso (kg)</th>
                                <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Reps</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...item._debugRows]
                                .sort((a, b) => (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0))
                                .map((r, idx2) => (
                                  <tr key={idx2}>
                                    <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0" }}>
                                      {r.timestamp ? new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                    </td>
                                    <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{r.weight ?? '-'}</td>
                                    <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{r.reps ?? '-'}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      </form>
    </div>
  );

// ✅ NUEVO BLOQUE: limpiar parámetros de la URL después de usarlos

};



export default ExerciseForm;
