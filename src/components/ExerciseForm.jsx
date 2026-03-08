import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flame, Pencil, TrendingDown, TrendingUp } from "lucide-react";
import {
  collection,
  doc,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebase/config";
import {
  addDocWithFreshAuth,
  getDocsWithFreshAuth,
  updateDocWithFreshAuth,
} from "../firebase/firestoreRetry";
import { listUserExercises, ensureUserExercise, getUserExerciseById } from "../data/exerciseMaster";
import {
  TRACKING_MODES,
  buildCanonicalKey,
  normalizeText,
  normalizeTrackingMode,
} from "../utils/exerciseCatalog";
import {
  buildWorkoutSnapshot,
  formatDistanceKm,
  formatDurationMin,
  formatPace,
  getEnduranceMetrics,
  getStrengthMetrics,
} from "../utils/workoutMetrics";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";

const triggerHaptic = (pattern = 10) => {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
};

const toJsDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  return null;
};

const toDateKey = (date) => {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const formatDateLabel = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  const weekday = date.toLocaleDateString("es-ES", { weekday: "long" });
  return `${date.toLocaleDateString("es-ES")} (${weekday})`;
};

const formatCompactDateLabel = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  const weekdayMap = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];
  return `${date.toLocaleDateString("es-ES")} (${weekdayMap[date.getDay()] || ""})`;
};

const formatHeadlineDate = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("es-ES");
};

const groupRowsByDay = (rows = []) => {
  const grouped = new Map();
  rows.forEach((row) => {
    const timestamp = toJsDate(row.timestamp);
    if (!timestamp) return;
    const key = toDateKey(timestamp);
    if (!grouped.has(key)) {
      grouped.set(key, { key, date: timestamp, rows: [] });
    }
    grouped.get(key).rows.push({ ...row, timestamp });
    if (timestamp > grouped.get(key).date) {
      grouped.get(key).date = timestamp;
    }
  });
  return Array.from(grouped.values()).sort((left, right) => right.date - left.date);
};

const mapWorkoutDoc = (snapshotDoc) => {
  const data = snapshotDoc.data();
  const timestamp = toJsDate(data.timestamp);
  return {
    id: snapshotDoc.id,
    uid: data.uid,
    exerciseId: normalizeText(data.exerciseId),
    exercise: normalizeText(data.exercise || data.exerciseNameSnapshot),
    muscleGroup: normalizeText(data.muscleGroup || data.muscleGroupSnapshot),
    trackingMode: data.trackingModeSnapshot === TRACKING_MODES.ENDURANCE
      ? TRACKING_MODES.ENDURANCE
      : TRACKING_MODES.STRENGTH,
    weight: typeof data.weight === "number" ? data.weight : null,
    reps: typeof data.reps === "number" ? data.reps : null,
    durationMin: typeof data.durationMin === "number" ? data.durationMin : null,
    distanceKm: typeof data.distanceKm === "number" ? data.distanceKm : null,
    timestamp,
    deleted: isMarkedDeleted(data),
  };
};

const buildRowKey = (row = {}) =>
  normalizeText(row.exerciseId) || buildCanonicalKey(row.muscleGroup, row.exercise);

const matchesExerciseOption = (row = {}, exerciseOption = {}) => {
  const optionId = normalizeText(exerciseOption.exerciseId);
  if (optionId && normalizeText(row.exerciseId) === optionId) {
    return true;
  }
  return buildCanonicalKey(row.muscleGroup, row.exercise) === buildCanonicalKey(
    exerciseOption.muscleGroup,
    exerciseOption.exercise
  );
};

const sortRowsByTimestamp = (rows = []) =>
  [...rows].sort((left, right) => (left.timestamp?.getTime?.() || 0) - (right.timestamp?.getTime?.() || 0));

const sortRowsByTimestampDesc = (rows = []) =>
  [...rows].sort((left, right) => (right.timestamp?.getTime?.() || 0) - (left.timestamp?.getTime?.() || 0));

const isMissingIndexError = (error) => {
  const code = String(error?.code || "").toLowerCase();
  return code === "failed-precondition" || code === "firestore/failed-precondition";
};

const explainLoadError = (error, fallback) => {
  const code = String(error?.code || "").toLowerCase();
  if (code.includes("permission-denied")) return `${fallback} (permisos)`;
  if (code.includes("unauthenticated")) return `${fallback} (sesión)`;
  if (code.includes("unavailable")) return `${fallback} (sin conexión a Firestore)`;
  if (code.includes("failed-precondition")) return `${fallback} (índice o configuración)`;
  const message = normalizeText(error?.message);
  return message ? `${fallback} (${message})` : fallback;
};

const summarizeSession = (rows = [], trackingMode = TRACKING_MODES.STRENGTH) => {
  if (trackingMode === TRACKING_MODES.ENDURANCE) {
    const metrics = getEnduranceMetrics(rows);
    const titleParts = [formatDurationMin(metrics.totalDurationMin)];
    if (metrics.totalDistanceKm != null) {
      titleParts.push(formatDistanceKm(metrics.totalDistanceKm));
    }
    const detailParts = [];
    if (metrics.averageSpeedKmh != null) {
      detailParts.push(`Vel.Media: ${metrics.averageSpeedKmh} km/h`);
    }
    if (metrics.paceMinPerKm != null) {
      detailParts.push(`Ritmo: ${formatPace(metrics.paceMinPerKm)}`);
    }
    return {
      title: titleParts.filter(Boolean).join(" · "),
      badge: metrics.totalDistanceKm != null ? formatDistanceKm(metrics.totalDistanceKm) : formatDurationMin(metrics.totalDurationMin),
      compactLine: metrics.totalDistanceKm != null ? formatDurationMin(metrics.totalDurationMin) : "",
      detailLine: detailParts.join(" · "),
    };
  }

  const metrics = getStrengthMetrics(rows);
  const compactLine = `${metrics.averageWeight ?? "-"} kg · ${metrics.averageReps ?? "-"} reps`;
  return {
    title: `PowerScore ${metrics.powerScore}`,
    badge: String(metrics.powerScore),
    compactLine,
    detailLine: "",
  };
};

const buildStrengthHeadlineState = (groupedSessions = []) => {
  if (!Array.isArray(groupedSessions) || groupedSessions.length < 2) return null;

  const sessionScores = groupedSessions.map((session) => getStrengthMetrics(session.rows).powerScore);
  const latestScore = sessionScores[0] ?? 0;
  const previousScore = sessionScores[1] ?? null;
  const previousBestScore =
    sessionScores.length > 1 ? Math.max(...sessionScores.slice(1)) : null;

  if (previousBestScore != null && latestScore > previousBestScore) {
    return {
      kind: "record",
      label: "Récord",
      Icon: Flame,
    };
  }

  if (previousScore == null || latestScore === previousScore) return null;

  if (latestScore > previousScore) {
    return {
      kind: "up",
      label: "Mejora",
      Icon: TrendingUp,
    };
  }

  return {
    kind: "down",
    label: "Por debajo",
    Icon: TrendingDown,
  };
};

const buildSummaryItems = (exerciseOptions = [], workoutRows = []) =>
  exerciseOptions.map((item) => {
    const relatedRows = workoutRows.filter((row) => matchesExerciseOption(row, item));
    const groupedSessions = groupRowsByDay(relatedRows);
    const latestSession = groupedSessions[0] || null;
    const summary = summarizeSession(latestSession?.rows || [], item.trackingMode);
    return {
      ...item,
      summaryKey: normalizeText(item.exerciseId) || item.canonicalKey,
      groupedSessions,
      latestSession,
      latestRows: latestSession ? sortRowsByTimestamp(latestSession.rows) : [],
      latestDate: latestSession?.date || null,
      latestTitle: latestSession ? summary.title : "Sin registros",
      latestBadge: latestSession ? summary.badge : "Sin datos",
      latestCompactLine: latestSession ? summary.compactLine : "Sin actividad",
      latestDetailLine: latestSession ? summary.detailLine : "",
    };
  });

const ExerciseForm = ({
  user,
  selectedExercise,
  onViewChart,
  onViewLibrary,
  onSelectExercise,
}) => {
  const [exerciseName, setExerciseName] = useState("");
  const [muscleGroup, setMuscleGroup] = useState("");
  const [draftTrackingMode, setDraftTrackingMode] = useState(TRACKING_MODES.STRENGTH);
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [durationMin, setDurationMin] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [saveStatus, setSaveStatus] = useState(null);
  const [error, setError] = useState("");
  const [allExercises, setAllExercises] = useState([]);
  const [allWorkouts, setAllWorkouts] = useState([]);
  const [editingRowId, setEditingRowId] = useState("");
  const [editingDraft, setEditingDraft] = useState({ weight: "", reps: "", durationMin: "", distanceKm: "" });
  const [openSug, setOpenSug] = useState(false);
  const [openGroupSug, setOpenGroupSug] = useState(false);
  const [openInline, setOpenInline] = useState(null);
  const [openSummaryKey, setOpenSummaryKey] = useState(null);
  const [weightSuggestions, setWeightSuggestions] = useState([]);
  const sugBoxRef = useRef(null);
  const groupSugRef = useRef(null);
  const muscleGroupInputRef = useRef(null);
  const exerciseInputRef = useRef(null);

  const loadWorkoutSnapshot = useCallback(async () => {
    const workoutsCollection = collection(db, "workouts");
    try {
      return await getDocsWithFreshAuth(
        query(workoutsCollection, where("uid", "==", user.uid), orderBy("timestamp", "desc"))
      );
    } catch (queryErr) {
      if (!isMissingIndexError(queryErr)) throw queryErr;
      return getDocsWithFreshAuth(query(workoutsCollection, where("uid", "==", user.uid)));
    }
  }, [user]);

  const reloadUserData = useCallback(async ({ silent = false } = {}) => {
    if (!user) return;
    const [exerciseResult, workoutResult] = await Promise.allSettled([
      listUserExercises(db, user.uid),
      loadWorkoutSnapshot(),
    ]);

    const nextExercises =
      exerciseResult.status === "fulfilled" ? exerciseResult.value : [];
    const nextWorkouts =
      workoutResult.status === "fulfilled"
        ? sortRowsByTimestampDesc(
            workoutResult.value.docs
              .map(mapWorkoutDoc)
              .filter((row) => !row.deleted)
          )
        : [];

    setAllExercises(nextExercises);
    setAllWorkouts(nextWorkouts);

    if (exerciseResult.status === "rejected") {
      console.error("Error cargando maestro de ejercicios:", exerciseResult.reason);
    }
    if (workoutResult.status === "rejected") {
      console.error("Error cargando historial de registro:", workoutResult.reason);
    }

    if (exerciseResult.status === "rejected" && workoutResult.status === "rejected") {
      if (silent) return;
      throw exerciseResult.reason || workoutResult.reason;
    }
    if (exerciseResult.status === "rejected") {
      if (!silent) {
        setError("No se pudo cargar el maestro de ejercicios.");
      }
      return;
    }
    if (workoutResult.status === "rejected") {
      if (!silent) {
        setError("No se pudo cargar el historial reciente.");
      }
      return;
    }
    if (!silent) {
      setError("");
    }
  }, [loadWorkoutSnapshot, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextExercise = params.get("exercise");
    const nextGroup = params.get("muscleGroup");
    if (nextExercise) setExerciseName(normalizeText(nextExercise));
    if (nextGroup) setMuscleGroup(normalizeText(nextGroup));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("exercise") || params.has("muscleGroup")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    function handleOutside(event) {
      const target = event.target;
      if (sugBoxRef.current && !sugBoxRef.current.contains(target)) setOpenSug(false);
      if (groupSugRef.current && !groupSugRef.current.contains(target)) setOpenGroupSug(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (!user) {
      setAllExercises([]);
      setAllWorkouts([]);
      return;
    }
    reloadUserData().catch((loadErr) => {
      console.error("Error cargando datos de registro:", loadErr);
      setError(explainLoadError(loadErr, "No se pudo cargar el registro."));
    });
  }, [user, reloadUserData]);

  useEffect(() => {
    if (!selectedExercise) return;
    const nextExercise = normalizeText(selectedExercise.exercise);
    const nextGroup = normalizeText(selectedExercise.muscleGroup);
    if (!nextExercise || !nextGroup) return;
    setExerciseName(nextExercise);
    setMuscleGroup(nextGroup);
  }, [selectedExercise]);

  const currentCanonicalKey = useMemo(
    () => buildCanonicalKey(muscleGroup, exerciseName),
    [muscleGroup, exerciseName]
  );
  const selectedCanonicalKey = useMemo(
    () => buildCanonicalKey(selectedExercise?.muscleGroup, selectedExercise?.exercise),
    [selectedExercise]
  );
  const selectedExerciseOption = useMemo(() => {
    const exerciseId = normalizeText(selectedExercise?.exerciseId);
    const exercise = normalizeText(selectedExercise?.exercise);
    const nextGroup = normalizeText(selectedExercise?.muscleGroup);
    if (!exerciseId || !exercise || !nextGroup) return null;
    return {
      exerciseId,
      exercise,
      muscleGroup: nextGroup,
      trackingMode: normalizeTrackingMode(selectedExercise?.trackingMode),
      canonicalKey: buildCanonicalKey(nextGroup, exercise),
    };
  }, [selectedExercise]);

  const matchedExercise = useMemo(() => {
    if (selectedExerciseOption && currentCanonicalKey === selectedCanonicalKey) {
      const byId = allExercises.find((item) => item.exerciseId === selectedExerciseOption.exerciseId);
      if (byId) return byId;
      return selectedExerciseOption;
    }
    return allExercises.find(
      (item) => buildCanonicalKey(item.muscleGroup, item.exercise) === currentCanonicalKey
    ) || null;
  }, [allExercises, currentCanonicalKey, selectedCanonicalKey, selectedExerciseOption]);

  const trackingMode = matchedExercise?.trackingMode || draftTrackingMode;

  useEffect(() => {
    if (matchedExercise) {
      setDraftTrackingMode(matchedExercise.trackingMode);
    }
  }, [matchedExercise]);

  useEffect(() => {
    if (matchedExercise) return;
    if (normalizeText(exerciseName) || normalizeText(muscleGroup)) return;
    setDraftTrackingMode(TRACKING_MODES.STRENGTH);
  }, [exerciseName, matchedExercise, muscleGroup]);

  const groupSuggestions = useMemo(
    () => [...new Set(allExercises.map((item) => item.muscleGroup).filter(Boolean))],
    [allExercises]
  );

  const filteredGroupSuggestions = useMemo(() => {
    const queryText = muscleGroup.toLowerCase().trim();
    if (!queryText) return groupSuggestions.slice(0, 20);
    return groupSuggestions.filter((group) => group.toLowerCase().includes(queryText)).slice(0, 20);
  }, [groupSuggestions, muscleGroup]);

  const exerciseSuggestions = useMemo(() => {
    const base = muscleGroup
      ? allExercises.filter((item) => item.muscleGroup.toLowerCase() === muscleGroup.toLowerCase())
      : [];
    const names = [...new Set(base.map((item) => item.exercise))];
    const queryText = exerciseName.toLowerCase().trim();
    if (!queryText) return names.slice(0, 20);
    return names.filter((name) => name.toLowerCase().includes(queryText)).slice(0, 20);
  }, [allExercises, exerciseName, muscleGroup]);

  const currentRows = useMemo(() => {
    if (!exerciseName || !muscleGroup) return [];
    return allWorkouts.filter((row) => {
      if (matchedExercise?.exerciseId) {
        return matchesExerciseOption(row, matchedExercise);
      }
      return buildRowKey(row) === currentCanonicalKey;
    });
  }, [allWorkouts, currentCanonicalKey, exerciseName, matchedExercise, muscleGroup]);

  const groupedCurrentSessions = useMemo(() => groupRowsByDay(currentRows), [currentRows]);
  const latestSession = groupedCurrentSessions[0] || null;
  const previousSession = groupedCurrentSessions[1] || null;
  const latestStrengthHeadlineState = useMemo(
    () =>
      trackingMode === TRACKING_MODES.STRENGTH
        ? buildStrengthHeadlineState(groupedCurrentSessions)
        : null,
    [groupedCurrentSessions, trackingMode]
  );

  const summaryData = useMemo(() => buildSummaryItems(allExercises, allWorkouts), [allExercises, allWorkouts]);
  const groupedSummaryData = useMemo(
    () =>
      Object.entries(
        summaryData.reduce((acc, item) => {
          const group = item.muscleGroup || "Sin grupo";
          if (!acc[group]) acc[group] = [];
          acc[group].push(item);
          return acc;
        }, {})
      ),
    [summaryData]
  );
  const editingRow = useMemo(
    () => allWorkouts.find((row) => row.id === editingRowId) || null,
    [allWorkouts, editingRowId]
  );

  useEffect(() => {
    if (trackingMode !== TRACKING_MODES.STRENGTH) {
      setWeightSuggestions([]);
      return;
    }
    const recentAverages = groupedCurrentSessions
      .slice(0, 3)
      .map((session) => getStrengthMetrics(session.rows).averageWeight)
      .filter((value) => typeof value === "number");
    const nextSuggestions = [...new Set(recentAverages)];
    if (nextSuggestions.length > 1) {
      const average = Number(
        (nextSuggestions.reduce((sum, value) => sum + value, 0) / nextSuggestions.length).toFixed(1)
      );
      if (!nextSuggestions.includes(average)) nextSuggestions.push(average);
    }
    setWeightSuggestions(nextSuggestions);
  }, [groupedCurrentSessions, trackingMode]);

  const resetEntryFields = () => {
    setWeight("");
    setReps("");
    setDurationMin("");
    setDistanceKm("");
  };

  const commitSelection = useCallback((entry = null) => {
    const nextExercise = normalizeText(entry?.exercise || exerciseName);
    const nextGroup = normalizeText(entry?.muscleGroup || muscleGroup);
    if (!nextExercise || !nextGroup) return null;
    const payload = {
      exerciseId: normalizeText(entry?.exerciseId || matchedExercise?.exerciseId),
      exercise: nextExercise,
      muscleGroup: nextGroup,
      trackingMode: entry?.trackingMode || matchedExercise?.trackingMode || draftTrackingMode,
    };
    onSelectExercise?.(payload);
    return payload;
  }, [draftTrackingMode, exerciseName, matchedExercise, muscleGroup, onSelectExercise]);

  const applyExerciseSelection = useCallback((entry) => {
    if (!entry) return;
    setExerciseName(entry.exercise);
    setMuscleGroup(entry.muscleGroup);
    setDraftTrackingMode(entry.trackingMode || TRACKING_MODES.STRENGTH);
    setSaveStatus(null);
    setError("");
    setOpenInline(null);
    setOpenSummaryKey(null);
    setOpenSug(false);
    setOpenGroupSug(false);
    commitSelection(entry);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [commitSelection]);

  const saveWorkout = async () => {
    const cleanExercise = normalizeText(exerciseName);
    const cleanGroup = normalizeText(muscleGroup);
    if (!cleanExercise || !cleanGroup) {
      setError("Debes indicar grupo y ejercicio.");
      return;
    }

    let effectiveExercise = matchedExercise;
    if (!effectiveExercise && selectedExerciseOption && currentCanonicalKey === selectedCanonicalKey) {
      effectiveExercise = await getUserExerciseById(db, user.uid, selectedExerciseOption.exerciseId);
    }
    if (!effectiveExercise) {
      effectiveExercise = await ensureUserExercise(db, user.uid, {
        exercise: cleanExercise,
        muscleGroup: cleanGroup,
        trackingMode,
      });
      setAllExercises((previous) => {
        const filtered = previous.filter((item) => buildRowKey(item) !== buildRowKey(effectiveExercise));
        return [...filtered, effectiveExercise].sort((left, right) => left.muscleGroup.localeCompare(right.muscleGroup) || left.exercise.localeCompare(right.exercise));
      });
    }

    const uid = user?.uid || auth.currentUser?.uid;
    if (!uid) {
      setError("No hay sesión activa. Vuelve a iniciar sesión y prueba de nuevo.");
      return;
    }

    const snapshot = buildWorkoutSnapshot({
      exerciseId: effectiveExercise.exerciseId,
      exercise: effectiveExercise.exercise,
      muscleGroup: effectiveExercise.muscleGroup,
      trackingMode: effectiveExercise.trackingMode,
      weight,
      reps,
      durationMin,
      distanceKm,
    });

    if (effectiveExercise.trackingMode === TRACKING_MODES.STRENGTH) {
      if (snapshot.weight == null || snapshot.weight < 0) {
        setError("El peso es obligatorio para ejercicios de fuerza.");
        return;
      }
      if (snapshot.reps != null && (snapshot.reps < 1 || snapshot.reps > 999)) {
        setError("Las repeticiones deben estar entre 1 y 999.");
        return;
      }
    } else {
      if (snapshot.durationMin == null || snapshot.durationMin <= 0) {
        setError("Los minutos son obligatorios para ejercicios de resistencia.");
        return;
      }
      if (snapshot.distanceKm != null && snapshot.distanceKm < 0) {
        setError("La distancia no puede ser negativa.");
        return;
      }
    }

    await addDocWithFreshAuth(collection(db, "workouts"), {
      exerciseId: effectiveExercise.exerciseId,
      exercise: effectiveExercise.exercise,
      exerciseNameSnapshot: effectiveExercise.exercise,
      muscleGroup: effectiveExercise.muscleGroup,
      muscleGroupSnapshot: effectiveExercise.muscleGroup,
      trackingMode: effectiveExercise.trackingMode,
      trackingModeSnapshot: effectiveExercise.trackingMode,
      weight: snapshot.weight,
      reps: snapshot.reps,
      durationMin: snapshot.durationMin,
      distanceKm: snapshot.distanceKm,
      timestamp: new Date(),
      delete: false,
      uid,
      userName: user?.displayName || auth.currentUser?.displayName || "Sin nombre",
      email: user?.email || auth.currentUser?.email || null,
    });

    resetEntryFields();
    setSaveStatus("ok");
    setError("");
    commitSelection(effectiveExercise);
    triggerHaptic(150);
    await reloadUserData();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    triggerHaptic(10);
    try {
      await saveWorkout();
    } catch (saveErr) {
      console.error("Error al guardar registro:", saveErr);
      setSaveStatus("nok");
      setError(saveErr?.message || "No se pudo guardar el registro.");
    }
  };

  const handleClearMuscleGroup = () => {
    setOpenGroupSug(false);
    setMuscleGroup("");
    setExerciseName("");
    resetEntryFields();
    setSaveStatus(null);
    setError("");
    setEditingRowId("");
    setOpenInline(null);
    setOpenSummaryKey(null);
    onSelectExercise?.(null);
    requestAnimationFrame(() => muscleGroupInputRef.current?.focus());
  };

  const handleClearExercise = () => {
    setExerciseName("");
    resetEntryFields();
    setSaveStatus(null);
    setError("");
    setEditingRowId("");
    setOpenInline(null);
    setOpenSummaryKey(null);
    onSelectExercise?.(null);
    requestAnimationFrame(() => exerciseInputRef.current?.focus());
  };

  const startEditingRow = (row) => {
    setEditingRowId(row.id);
    setEditingDraft({
      weight: row.weight ?? "",
      reps: row.reps ?? "",
      durationMin: row.durationMin ?? "",
      distanceKm: row.distanceKm ?? "",
    });
  };

  const cancelEditingRow = () => {
    setEditingRowId("");
    setEditingDraft({ weight: "", reps: "", durationMin: "", distanceKm: "" });
    setOpenInline(null);
    setOpenSummaryKey(null);
  };

  const handleUpdateRow = async (row) => {
    const nextPayload = {
      delete: false,
      deletedAt: null,
    };

    if (row.trackingMode === TRACKING_MODES.ENDURANCE) {
      const nextDuration = Number(editingDraft.durationMin);
      const nextDistance = editingDraft.distanceKm === "" ? null : Number(editingDraft.distanceKm);
      if (!Number.isFinite(nextDuration) || nextDuration <= 0) {
        setError("Los minutos editados deben ser mayores que 0.");
        return;
      }
      if (nextDistance != null && (!Number.isFinite(nextDistance) || nextDistance < 0)) {
        setError("La distancia editada no es válida.");
        return;
      }
      nextPayload.durationMin = nextDuration;
      nextPayload.distanceKm = nextDistance;
      nextPayload.weight = null;
      nextPayload.reps = null;
    } else {
      const nextWeight = Number(editingDraft.weight);
      const nextReps = editingDraft.reps === "" ? null : Number(editingDraft.reps);
      if (!Number.isFinite(nextWeight) || nextWeight < 0) {
        setError("El peso editado no es válido.");
        return;
      }
      if (nextReps != null && (!Number.isFinite(nextReps) || nextReps < 1 || nextReps > 999)) {
        setError("Las repeticiones editadas deben estar entre 1 y 999.");
        return;
      }
      nextPayload.weight = nextWeight;
      nextPayload.reps = nextReps;
      nextPayload.durationMin = null;
      nextPayload.distanceKm = null;
    }

    try {
      await updateDocWithFreshAuth(doc(db, "workouts", row.id), nextPayload);
      setAllWorkouts((previous) =>
        sortRowsByTimestampDesc(
          previous.map((item) => (item.id === row.id ? { ...item, ...nextPayload } : item))
        )
      );
      cancelEditingRow();
      setSaveStatus("ok");
      setError("");
      reloadUserData({ silent: true }).catch((refreshErr) => {
        console.error("Error refrescando registro tras editar:", refreshErr);
      });
    } catch (updateErr) {
      console.error("Error actualizando registro:", updateErr);
      setError("No se pudo actualizar el registro.");
    }
  };

  const handleSoftDelete = async (row) => {
    const label = row.trackingMode === TRACKING_MODES.ENDURANCE
      ? `${formatDurationMin(row.durationMin)} · ${row.distanceKm != null ? formatDistanceKm(row.distanceKm) : "Sin distancia"}`
      : `${row.weight ?? "-"} kg · ${row.reps ?? "-"} reps`;
    if (!window.confirm(`¿Marcar para borrado este registro?\n${label}`)) return;

    try {
      await updateDocWithFreshAuth(doc(db, "workouts", row.id), {
        delete: true,
        deletedAt: new Date(),
      });
      setAllWorkouts((previous) => previous.filter((item) => item.id !== row.id));
      cancelEditingRow();
      setSaveStatus("ok");
      setError("");
      reloadUserData({ silent: true }).catch((refreshErr) => {
        console.error("Error refrescando registro tras borrar:", refreshErr);
      });
    } catch (deleteErr) {
      console.error("Error marcando borrado:", deleteErr);
      setError("No se pudo marcar el registro para borrado.");
    }
  };

  const adjustNumericField = (setter, currentValue, delta, { min = 0, max = 999 } = {}) => {
    const base = currentValue === "" ? 0 : Number(currentValue);
    const safeBase = Number.isFinite(base) ? base : 0;
    const next = Math.min(max, Math.max(min, safeBase + delta));
    setter(String(next));
  };

  const adjustDecimalField = (setter, currentValue, delta, { min = 0, max = 999, decimals = 1 } = {}) => {
    const base = currentValue === "" ? 0 : Number(currentValue);
    const safeBase = Number.isFinite(base) ? base : 0;
    const next = Math.min(max, Math.max(min, safeBase + delta));
    setter(String(Number(next.toFixed(decimals))));
  };

  const latestSummary = latestSession ? summarizeSession(latestSession.rows, trackingMode) : null;
  const previousSummary = previousSession ? summarizeSession(previousSession.rows, trackingMode) : null;
  const renderSessionDetail = (session, mode) => {
    if (!session) return null;
    const sortedRows = sortRowsByTimestamp(session.rows);

    return (
      <div className="exercise-detail-card">
        <table className="exercise-detail-table exercise-detail-table--dense">
          <thead>
            <tr>
              <th>Hora</th>
              {mode === TRACKING_MODES.ENDURANCE ? (
                <>
                  <th>Minutos</th>
                  <th>Distancia</th>
                </>
              ) : (
                <>
                  <th>Peso (kg)</th>
                  <th>Reps</th>
                </>
              )}
              <th aria-label="Editar"></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id}>
                <td>{row.timestamp ? row.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                {mode === TRACKING_MODES.ENDURANCE ? (
                  <>
                    <td>{row.durationMin ?? "-"}</td>
                    <td>{row.distanceKm ?? "-"}</td>
                  </>
                ) : (
                  <>
                    <td>{row.weight ?? "-"}</td>
                    <td>{row.reps ?? "-"}</td>
                  </>
                )}
                <td>
                  <div className="exercise-row-actions">
                    <button
                      type="button"
                      className="exercise-detail-action-btn exercise-detail-icon-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditingRow(row);
                      }}
                      aria-label="Editar registro"
                      title="Editar registro"
                    >
                      <Pencil size={12} strokeWidth={2.2} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="exercise-form-shell">
      <form className="exercise-form-card tracker-form" onSubmit={handleSubmit}>
        <h2>Registrar ejercicio</h2>

        <div className="exercise-selector-card">
          <div className="exercise-selector-row">
            <label className="exercise-selector-label" htmlFor="muscleGroup">Grupo:</label>
            <div className="exercise-suggest-wrap" ref={groupSugRef}>
              <input
                id="muscleGroup"
                type="text"
                value={muscleGroup}
                onChange={(event) => {
                  setMuscleGroup(event.target.value);
                  setSaveStatus(null);
                  setError("");
                  setOpenInline(null);
                  setOpenGroupSug(true);
                }}
                onFocus={() => setOpenGroupSug(true)}
                onBlur={(event) => setMuscleGroup(normalizeText(event.target.value))}
                placeholder="Escribe grupo…"
                ref={muscleGroupInputRef}
              />
              {openGroupSug && (
                <div className="exercise-suggest-menu">
                  {filteredGroupSuggestions.length === 0 && muscleGroup.trim() && (
                    <div className="exercise-suggest-empty">No hay resultados para “{muscleGroup.trim()}”.</div>
                  )}
                  {filteredGroupSuggestions.map((group) => (
                    <div
                      className="exercise-suggest-item"
                      key={group}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setMuscleGroup(group);
                        setOpenGroupSug(false);
                      }}
                    >
                      {group}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {muscleGroup && (
              <button type="button" onClick={handleClearMuscleGroup} className="exercise-clear-btn">✕</button>
            )}
          </div>

          <div className="exercise-selector-row">
            <label className="exercise-selector-label" htmlFor="exerciseName">Ejercicio:</label>
            <div className="exercise-suggest-wrap" ref={sugBoxRef}>
              <input
                id="exerciseName"
                type="text"
                value={exerciseName}
                onChange={(event) => {
                  setExerciseName(event.target.value);
                  setSaveStatus(null);
                  setError("");
                  setOpenInline(null);
                  setOpenSug(true);
                }}
                onFocus={() => setOpenSug(true)}
                onBlur={(event) => setExerciseName(normalizeText(event.target.value))}
                placeholder="Escribe un ejercicio…"
                ref={exerciseInputRef}
              />
              {openSug && normalizeText(muscleGroup) && (
                <div className="exercise-suggest-menu">
                  {exerciseSuggestions.length === 0 && exerciseName.trim() && (
                    <div className="exercise-suggest-empty">No hay resultados para “{exerciseName.trim()}”.</div>
                  )}
                  {exerciseSuggestions.map((name) => (
                    <div
                      className="exercise-suggest-item"
                      key={name}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setExerciseName(name);
                        setOpenSug(false);
                      }}
                    >
                      {name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {exerciseName && (
              <button type="button" onClick={handleClearExercise} className="exercise-clear-btn">✕</button>
            )}
          </div>
        </div>

        {!matchedExercise && exerciseName && muscleGroup && (
          <div className="exercise-master-pending">
            <strong>Nuevo ejercicio</strong>
            <p>Se creará una ficha maestra al guardar. Define ahora cómo se registrará.</p>
            <label className="exercise-master-switch" htmlFor="tracking-mode-draft">
              <span className={`tracking-mode-option${draftTrackingMode === TRACKING_MODES.STRENGTH ? " is-active" : ""}`}>Peso / reps</span>
              <span className="tracking-mode-slider">
                <input
                  id="tracking-mode-draft"
                  type="checkbox"
                  checked={draftTrackingMode === TRACKING_MODES.ENDURANCE}
                  onChange={(event) => {
                    setDraftTrackingMode(event.target.checked ? TRACKING_MODES.ENDURANCE : TRACKING_MODES.STRENGTH);
                    setSaveStatus(null);
                    setError("");
                  }}
                />
                <span className="tracking-mode-slider-ui" aria-hidden="true" />
              </span>
              <span className={`tracking-mode-option${draftTrackingMode === TRACKING_MODES.ENDURANCE ? " is-active" : ""}`}>Min / dist</span>
            </label>
          </div>
        )}

        {matchedExercise && (
          <p className="exercise-headline exercise-headline-muted">
            Modo activo: <strong>{trackingMode === TRACKING_MODES.ENDURANCE ? "tiempo/distancia" : "peso/reps"}</strong>
          </p>
        )}

        {latestSummary && latestSession && (
          <div className="exercise-headline exercise-headline-stack">
            <strong>
              {formatHeadlineDate(latestSession.date)} · {latestSummary.title}
              {latestStrengthHeadlineState && (
                <span
                  className={`exercise-headline-trend is-${latestStrengthHeadlineState.kind}`}
                  title={latestStrengthHeadlineState.label}
                  aria-label={latestStrengthHeadlineState.label}
                >
                  <latestStrengthHeadlineState.Icon size={16} strokeWidth={2.4} />
                </span>
              )}
              <button
                type="button"
                className="exercise-info-btn"
                onClick={() => setOpenInline(openInline === "latest" ? null : "latest")}
                aria-expanded={openInline === "latest"}
                aria-label="Ver detalle del último día"
              >
                i
              </button>
            </strong>
            {latestSummary.detailLine && <span className="exercise-headline-submeta">{latestSummary.detailLine}</span>}
            {openInline === "latest" && renderSessionDetail(latestSession, trackingMode)}
          </div>
        )}

        {previousSummary && previousSession && (
          <div className="exercise-headline exercise-headline-secondary exercise-headline-stack">
            <strong>
              {formatHeadlineDate(previousSession.date)} · {previousSummary.title}
              <button
                type="button"
                className="exercise-info-btn"
                onClick={() => setOpenInline(openInline === "previous" ? null : "previous")}
                aria-expanded={openInline === "previous"}
                aria-label="Ver detalle del día anterior"
              >
                i
              </button>
            </strong>
            {previousSummary.detailLine && <span className="exercise-headline-submeta">{previousSummary.detailLine}</span>}
            {openInline === "previous" && renderSessionDetail(previousSession, trackingMode)}
          </div>
        )}

        <div className={`exercise-entry-grid${trackingMode === TRACKING_MODES.STRENGTH ? " is-strength" : ""}`}>
          {trackingMode === TRACKING_MODES.ENDURANCE ? (
            <>
              <div className="exercise-entry-field">
                <label htmlFor="durationMin">Minutos:</label>
                <div className="exercise-stepper-field">
                  <input
                    id="durationMin"
                    type="number"
                    value={durationMin}
                    onChange={(event) => setDurationMin(event.target.value)}
                    placeholder="Duración en minutos"
                    inputMode="numeric"
                    min={1}
                    className="exercise-stepper-input"
                  />
                  <div className="exercise-stepper-buttons">
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustNumericField(setDurationMin, durationMin, -1, { min: 1 })} aria-label="Reducir minutos">−</button>
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustNumericField(setDurationMin, durationMin, 1, { min: 1 })} aria-label="Aumentar minutos">+</button>
                  </div>
                </div>
              </div>
              <div className="exercise-entry-field">
                <label htmlFor="distanceKm">Distancia (km):</label>
                <div className="exercise-stepper-field">
                  <input
                    id="distanceKm"
                    type="number"
                    value={distanceKm}
                    onChange={(event) => setDistanceKm(event.target.value)}
                    placeholder="Opcional"
                    inputMode="decimal"
                    min={0}
                    step="0.1"
                    className="exercise-stepper-input"
                  />
                  <div className="exercise-stepper-buttons">
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustDecimalField(setDistanceKm, distanceKm, -0.1, { min: 0, decimals: 1 })} aria-label="Reducir distancia">−</button>
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustDecimalField(setDistanceKm, distanceKm, 0.1, { min: 0, decimals: 1 })} aria-label="Aumentar distancia">+</button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="exercise-entry-field">
                <label htmlFor="weight">Peso (kg):</label>
                <div className="exercise-stepper-field">
                  <input
                    id="weight"
                    type="number"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    placeholder="Peso en kg"
                    inputMode="decimal"
                    list={weightSuggestions.length > 0 ? "weight-suggestions" : undefined}
                    className="exercise-stepper-input"
                  />
                  <div className="exercise-stepper-buttons">
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustNumericField(setWeight, weight, -1)} aria-label="Reducir peso">−</button>
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustNumericField(setWeight, weight, 1)} aria-label="Aumentar peso">+</button>
                  </div>
                </div>
                {weightSuggestions.length > 0 && (
                  <datalist id="weight-suggestions">
                    {weightSuggestions.map((suggestedWeight) => (
                      <option key={suggestedWeight} value={String(suggestedWeight)} />
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
                    onChange={(event) => setReps(event.target.value)}
                    placeholder="Ej: 8, 10, 12…"
                    inputMode="numeric"
                    min={1}
                    max={999}
                    className="exercise-stepper-input"
                  />
                  <div className="exercise-stepper-buttons">
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustNumericField(setReps, reps, -1, { min: 1 })} aria-label="Reducir repeticiones">−</button>
                    <button type="button" className="exercise-stepper-btn" onClick={() => adjustNumericField(setReps, reps, 1, { min: 1 })} aria-label="Aumentar repeticiones">+</button>
                  </div>
                </div>
              </div>
            </>
          )}
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
                  commitSelection();
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
                  commitSelection();
                  onViewLibrary?.();
                }}
              >
                Ver ficha
              </button>
            </div>
          )}
        </div>

        {error && <p className="exercise-save-state is-error">❌ {error}</p>}
        {saveStatus === "ok" && <p className="exercise-save-state is-ok">✅ Guardado correctamente</p>}
        {saveStatus === "nok" && <p className="exercise-save-state is-error">❌ Error al guardar</p>}

        <div className="exercise-summary-panel">
          <h3>Resumen de ejercicios</h3>
          {groupedSummaryData.map(([group, exercises]) => (
            <details className="exercise-summary-group" key={group}>
              <summary className="exercise-summary-group-title">{group}</summary>
              <ul className="exercise-summary-list">
                {exercises.map((item) => {
                  const isOpen = openSummaryKey === item.summaryKey;
                  return (
                    <li className="exercise-summary-item" key={item.summaryKey}>
                      <div className="exercise-summary-row">
                        <button
                          type="button"
                          className="exercise-summary-select"
                          onClick={() => applyExerciseSelection(item)}
                        >
                          <strong className="exercise-summary-title">{item.exercise}</strong>
                          {item.latestSession && (
                            <span className="exercise-summary-date-inline">
                              {formatCompactDateLabel(item.latestDate)}
                            </span>
                          )}
                        </button>
                        <span className="exercise-summary-score">{item.latestBadge}</span>
                        {item.latestSession && (
                          <button
                            type="button"
                            className="exercise-info-btn exercise-summary-info-btn"
                            onClick={() => setOpenSummaryKey(isOpen ? null : item.summaryKey)}
                            aria-expanded={isOpen}
                            aria-label="Ver detalle del último día"
                          >
                            i
                          </button>
                        )}
                      </div>
                      {item.latestSession ? (
                        <>
                          {isOpen && renderSessionDetail(item.latestSession, item.trackingMode)}
                        </>
                      ) : (
                        <p className="exercise-summary-lastday">Todavía no hay registros para este ejercicio.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      </form>

      {editingRow && (
        <div
          className="exercise-edit-modal-backdrop"
          onClick={cancelEditingRow}
          role="presentation"
        >
          <div
            className="exercise-edit-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="exercise-edit-modal-title"
          >
            <div className="exercise-edit-modal-head">
              <strong id="exercise-edit-modal-title">Editar registro</strong>
              <button
                type="button"
                className="exercise-edit-close"
                onClick={cancelEditingRow}
                aria-label="Cerrar edición"
              >
                ✕
              </button>
            </div>
            <p className="exercise-edit-modal-copy">
              {editingRow.exercise} · {formatDateLabel(editingRow.timestamp)} ·{" "}
              {editingRow.timestamp
                ? editingRow.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "--:--"}
            </p>

            <div className="exercise-entry-grid exercise-edit-grid">
              {editingRow.trackingMode === TRACKING_MODES.ENDURANCE ? (
                <>
                  <div className="exercise-entry-field">
                    <label htmlFor="edit-durationMin">Minutos:</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="edit-durationMin"
                        type="number"
                        value={editingDraft.durationMin}
                        onChange={(event) =>
                          setEditingDraft((prev) => ({ ...prev, durationMin: event.target.value }))
                        }
                        inputMode="numeric"
                        min={1}
                        className="exercise-stepper-input"
                      />
                      <div className="exercise-stepper-buttons">
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustNumericField(
                              (value) => setEditingDraft((prev) => ({ ...prev, durationMin: value })),
                              editingDraft.durationMin,
                              -1,
                              { min: 1 }
                            )
                          }
                          aria-label="Reducir minutos editados"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustNumericField(
                              (value) => setEditingDraft((prev) => ({ ...prev, durationMin: value })),
                              editingDraft.durationMin,
                              1,
                              { min: 1 }
                            )
                          }
                          aria-label="Aumentar minutos editados"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="exercise-entry-field">
                    <label htmlFor="edit-distanceKm">Distancia (km):</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="edit-distanceKm"
                        type="number"
                        value={editingDraft.distanceKm}
                        onChange={(event) =>
                          setEditingDraft((prev) => ({ ...prev, distanceKm: event.target.value }))
                        }
                        inputMode="decimal"
                        min={0}
                        step="0.1"
                        className="exercise-stepper-input"
                      />
                      <div className="exercise-stepper-buttons">
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustDecimalField(
                              (value) => setEditingDraft((prev) => ({ ...prev, distanceKm: value })),
                              editingDraft.distanceKm,
                              -0.1,
                              { min: 0, decimals: 1 }
                            )
                          }
                          aria-label="Reducir distancia editada"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustDecimalField(
                              (value) => setEditingDraft((prev) => ({ ...prev, distanceKm: value })),
                              editingDraft.distanceKm,
                              0.1,
                              { min: 0, decimals: 1 }
                            )
                          }
                          aria-label="Aumentar distancia editada"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="exercise-entry-field">
                    <label htmlFor="edit-weight">Peso (kg):</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="edit-weight"
                        type="number"
                        value={editingDraft.weight}
                        onChange={(event) =>
                          setEditingDraft((prev) => ({ ...prev, weight: event.target.value }))
                        }
                        inputMode="decimal"
                        className="exercise-stepper-input"
                      />
                      <div className="exercise-stepper-buttons">
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustNumericField(
                              (value) => setEditingDraft((prev) => ({ ...prev, weight: value })),
                              editingDraft.weight,
                              -1
                            )
                          }
                          aria-label="Reducir peso editado"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustNumericField(
                              (value) => setEditingDraft((prev) => ({ ...prev, weight: value })),
                              editingDraft.weight,
                              1
                            )
                          }
                          aria-label="Aumentar peso editado"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="exercise-entry-field">
                    <label htmlFor="edit-reps">Repeticiones:</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="edit-reps"
                        type="number"
                        value={editingDraft.reps}
                        onChange={(event) =>
                          setEditingDraft((prev) => ({ ...prev, reps: event.target.value }))
                        }
                        inputMode="numeric"
                        min={1}
                        max={999}
                        className="exercise-stepper-input"
                      />
                      <div className="exercise-stepper-buttons">
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustNumericField(
                              (value) => setEditingDraft((prev) => ({ ...prev, reps: value })),
                              editingDraft.reps,
                              -1,
                              { min: 1 }
                            )
                          }
                          aria-label="Reducir repeticiones editadas"
                        >
                          −
                        </button>
                        <button
                          type="button"
                          className="exercise-stepper-btn"
                          onClick={() =>
                            adjustNumericField(
                              (value) => setEditingDraft((prev) => ({ ...prev, reps: value })),
                              editingDraft.reps,
                              1,
                              { min: 1 }
                            )
                          }
                          aria-label="Aumentar repeticiones editadas"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="exercise-edit-actions">
              <button
                type="button"
                className="exercise-library-btn exercise-action-btn"
                onClick={cancelEditingRow}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="exercise-progress-btn exercise-action-btn exercise-edit-delete-btn"
                onClick={() => handleSoftDelete(editingRow)}
              >
                Borrar
              </button>
              <button
                type="button"
                className="exercise-save-btn exercise-action-btn"
                onClick={() => handleUpdateRow(editingRow)}
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExerciseForm;
