import { useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Youtube } from "lucide-react";
import { db, functions } from "../firebase/config";
import { getDocWithFreshAuth } from "../firebase/firestoreRetry";
import {
  listUserExercises,
  saveUserExercise,
} from "../data/exerciseMaster";
import {
  TRACKING_MODES,
  buildCanonicalKey,
  exerciseMatchesCanonicalKey,
  getCoveredCanonicalKeys,
  normalizeText,
  normalizeTrackingMode,
} from "../utils/exerciseCatalog";

const sanitizeLegacyKey = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_. ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 90);

const legacyDocKeyFor = (muscleGroup, exercise) =>
  `${sanitizeLegacyKey(muscleGroup)}__${sanitizeLegacyKey(exercise)}`;

const emptyDraft = {
  trackingMode: TRACKING_MODES.STRENGTH,
  description: "",
  youtubeUrl: "",
  technique: "",
  mistakes: "",
  equipment: "",
  notes: "",
};

const parseYoutube = (rawUrl) => {
  const raw = String(rawUrl || "").trim();
  if (!raw) return { valid: false, watchUrl: "", embedUrl: "" };

  let parsedUrl;
  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    parsedUrl = new URL(withProtocol);
  } catch {
    return { valid: false, watchUrl: "", embedUrl: "" };
  }

  const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
  let videoId = "";

  if (host === "youtu.be") {
    videoId = parsedUrl.pathname.split("/").filter(Boolean)[0] || "";
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    videoId = parsedUrl.searchParams.get("v") || "";
    if (!videoId && parsedUrl.pathname.startsWith("/shorts/")) {
      videoId = parsedUrl.pathname.split("/")[2] || "";
    }
    if (!videoId && parsedUrl.pathname.startsWith("/embed/")) {
      videoId = parsedUrl.pathname.split("/")[2] || "";
    }
  }

  if (!/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
    return { valid: false, watchUrl: "", embedUrl: "" };
  }

  return {
    valid: true,
    watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
  };
};

const explainFirestoreError = (err, fallback) => {
  const code = String(err?.code || "").toLowerCase();
  if (code.includes("permission-denied")) {
    return "Permisos insuficientes para leer o guardar la ficha.";
  }
  if (code.includes("unauthenticated")) {
    return "Tu sesión no es válida. Cierra sesión y vuelve a entrar.";
  }
  if (code.includes("unavailable")) {
    return "Servicio no disponible temporalmente. Intenta de nuevo en unos segundos.";
  }
  return fallback;
};

const toDraftFromExercise = (exerciseOption = {}) => ({
  trackingMode: normalizeTrackingMode(exerciseOption.trackingMode),
  description: normalizeText(exerciseOption.description),
  youtubeUrl: normalizeText(exerciseOption.youtubeUrl),
  technique: normalizeText(exerciseOption.technique),
  mistakes: normalizeText(exerciseOption.mistakes),
  equipment: normalizeText(exerciseOption.equipment),
  notes: normalizeText(exerciseOption.notes),
});

const ExerciseLibrary = ({ user, selectedExercise, onSelectExercise, onBack }) => {
  const [allExercises, setAllExercises] = useState([]);
  const [activeExerciseId, setActiveExerciseId] = useState("");
  const [muscleGroup, setMuscleGroup] = useState("");
  const [exercise, setExercise] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiFilling, setAiFilling] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const groupedPairs = useMemo(() => {
    return Object.entries(
      allExercises.reduce((acc, item) => {
        const group = item.muscleGroup || "Sin grupo";
        if (!acc[group]) acc[group] = [];
        acc[group].push(item);
        return acc;
      }, {})
    ).map(([group, entries]) => [
      group,
      entries.sort((left, right) => left.exercise.localeCompare(right.exercise, "es", { sensitivity: "base" })),
    ]);
  }, [allExercises]);

  const exerciseOptions = useMemo(() => {
    if (!muscleGroup) {
      return [...new Map(allExercises.map((item) => [item.exercise, item])).values()]
        .map((item) => item.exercise)
        .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
    }
    return allExercises
      .filter((item) => item.muscleGroup.toLowerCase() === muscleGroup.toLowerCase())
      .map((item) => item.exercise)
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  }, [allExercises, muscleGroup]);

  const video = useMemo(() => parseYoutube(draft.youtubeUrl), [draft.youtubeUrl]);
  const currentCanonicalKey = useMemo(
    () => buildCanonicalKey(muscleGroup, exercise),
    [muscleGroup, exercise]
  );
  const matchedExistingExercise = useMemo(() => {
    if (!muscleGroup || !exercise) return null;
    return allExercises.find((item) => exerciseMatchesCanonicalKey(item, currentCanonicalKey)) || null;
  }, [allExercises, currentCanonicalKey, exercise, muscleGroup]);

  const applySelection = async (nextSelection = {}, options = {}) => {
    const nextGroup = normalizeText(nextSelection.muscleGroup);
    const nextExercise = normalizeText(nextSelection.exercise);
    const nextExerciseId = normalizeText(nextSelection.exerciseId);
    const nextCanonicalKey = buildCanonicalKey(nextGroup, nextExercise);
    const shouldNotify = options.notify !== false;

    setMessage("");
    setError("");
    setMuscleGroup(nextGroup);
    setExercise(nextExercise);
    setActiveExerciseId(nextExerciseId);

    if (!nextGroup || !nextExercise) {
      setDraft(emptyDraft);
      if (shouldNotify) onSelectExercise?.(null);
      return;
    }

    const fromMaster =
      (nextExerciseId && allExercises.find((item) => item.exerciseId === nextExerciseId)) ||
      allExercises.find(
        (item) =>
          item.exercise.toLowerCase() === nextExercise.toLowerCase() &&
          item.muscleGroup.toLowerCase() === nextGroup.toLowerCase()
      ) ||
      allExercises.find(
        (item) => item.exerciseId && exerciseMatchesCanonicalKey(item, nextCanonicalKey)
      );

    if (fromMaster?.exerciseId) {
      setMuscleGroup(fromMaster.muscleGroup);
      setExercise(fromMaster.exercise);
      setDraft(toDraftFromExercise(fromMaster));
      setActiveExerciseId(fromMaster.exerciseId);
      if (shouldNotify) {
        onSelectExercise?.({
          exerciseId: fromMaster.exerciseId,
          exercise: fromMaster.exercise,
          muscleGroup: fromMaster.muscleGroup,
          trackingMode: fromMaster.trackingMode,
        });
      }
      return;
    }

    setDraft((prev) => ({
      ...emptyDraft,
      trackingMode: normalizeTrackingMode(nextSelection.trackingMode || prev.trackingMode),
    }));

    try {
      const legacyRef = doc(db, "users", user.uid, "exerciseLibrary", legacyDocKeyFor(nextGroup, nextExercise));
      const legacySnap = await getDocWithFreshAuth(legacyRef);
      if (legacySnap.exists()) {
        const legacy = legacySnap.data();
        setDraft((prev) => ({
          ...prev,
          youtubeUrl: normalizeText(legacy.youtubeUrl),
          technique: normalizeText(legacy.technique),
          mistakes: normalizeText(legacy.mistakes),
          equipment: normalizeText(legacy.equipment),
          notes: normalizeText(legacy.notes),
        }));
      }
    } catch (loadErr) {
      console.error("Error cargando ficha legacy:", loadErr);
    }

    if (shouldNotify) {
      onSelectExercise?.({
        exerciseId: "",
        exercise: nextExercise,
        muscleGroup: nextGroup,
        trackingMode: normalizeTrackingMode(nextSelection.trackingMode),
      });
    }
  };

  useEffect(() => {
    if (!user) {
      setAllExercises([]);
      return;
    }

    const loadExercises = async () => {
      setLoading(true);
      setError("");
      try {
        const items = await listUserExercises(db, user.uid);
        setAllExercises(items);
      } catch (loadErr) {
        console.error("Error cargando maestro de ejercicios:", loadErr);
        setError(explainFirestoreError(loadErr, "No se pudo cargar la biblioteca."));
      } finally {
        setLoading(false);
      }
    };

    loadExercises();
  }, [user]);

  useEffect(() => {
    if (!selectedExercise || !allExercises.length) return;
    applySelection(selectedExercise, { notify: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExercise, allExercises.length]);

  useEffect(() => {
    if (activeExerciseId) return;
    if (!matchedExistingExercise?.exerciseId) return;
    setActiveExerciseId(matchedExistingExercise.exerciseId);
    setDraft(toDraftFromExercise(matchedExistingExercise));
  }, [activeExerciseId, matchedExistingExercise]);

  const handleSave = async () => {
    const nextGroup = normalizeText(muscleGroup);
    const nextExercise = normalizeText(exercise);
    if (!nextGroup || !nextExercise) {
      setError("Selecciona grupo y ejercicio antes de guardar.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const parsed = parseYoutube(draft.youtubeUrl);
      if (draft.youtubeUrl.trim() && !parsed.valid) {
        setError("El enlace de YouTube no es válido.");
        return;
      }

      const saved = await saveUserExercise(db, user.uid, activeExerciseId, {
        exercise: nextExercise,
        muscleGroup: nextGroup,
        trackingMode: draft.trackingMode,
        description: draft.description,
        youtubeUrl: parsed.valid ? parsed.watchUrl : "",
        technique: draft.technique,
        mistakes: draft.mistakes,
        equipment: draft.equipment,
        notes: draft.notes,
      });

      setAllExercises((previous) => {
        const coveredCanonicalKeys = new Set(getCoveredCanonicalKeys(saved));
        const filtered = previous.filter((item) => {
          if (item.exerciseId === saved.exerciseId) return false;
          if (!item.exerciseId && coveredCanonicalKeys.has(item.canonicalKey)) return false;
          return true;
        });
        return [...filtered, saved].sort((left, right) => {
          const byGroup = left.muscleGroup.localeCompare(right.muscleGroup, "es", { sensitivity: "base" });
          if (byGroup !== 0) return byGroup;
          return left.exercise.localeCompare(right.exercise, "es", { sensitivity: "base" });
        });
      });
      setActiveExerciseId(saved.exerciseId);
      setMuscleGroup(saved.muscleGroup);
      setExercise(saved.exercise);
      setDraft(toDraftFromExercise(saved));
      setMessage("Ficha guardada correctamente.");
      onSelectExercise?.({
        exerciseId: saved.exerciseId,
        exercise: saved.exercise,
        muscleGroup: saved.muscleGroup,
        trackingMode: saved.trackingMode,
      });
    } catch (saveErr) {
      console.error("Error guardando ficha:", saveErr);
      setError(explainFirestoreError(saveErr, saveErr?.message || "No se pudo guardar la ficha."));
    } finally {
      setSaving(false);
    }
  };

  const clearGroupSelection = () => {
    setMuscleGroup("");
    setExercise("");
    setActiveExerciseId("");
    setDraft(emptyDraft);
    setMessage("");
    setError("");
    onSelectExercise?.(null);
  };

  const clearExerciseSelection = () => {
    setExercise("");
    setActiveExerciseId("");
    setDraft(emptyDraft);
    setMessage("");
    setError("");
    onSelectExercise?.(null);
  };

  const handleFillWithAi = async () => {
    const nextGroup = normalizeText(muscleGroup);
    const nextExercise = normalizeText(exercise);
    const parsed = parseYoutube(draft.youtubeUrl);

    if (!nextGroup || !nextExercise) {
      setError("Selecciona grupo y ejercicio antes de usar IA.");
      return;
    }
    if (!parsed.valid) {
      setError("Introduce un enlace de YouTube válido antes de usar IA.");
      return;
    }
    setAiFilling(true);
    setError("");
    setMessage("");
    try {
      const callable = httpsCallable(functions, "analyzeExerciseYoutube");
      const result = await callable({
        youtubeUrl: parsed.watchUrl,
        muscleGroup: nextGroup,
        exercise: nextExercise,
      });
      const data = typeof result?.data === "object" && result?.data ? result.data : {};
      setDraft((prev) => ({
        ...prev,
        youtubeUrl: parsed.watchUrl,
        technique: normalizeText(data.technique || prev.technique),
        mistakes: normalizeText(data.mistakes || prev.mistakes),
        equipment: normalizeText(data.equipment || prev.equipment),
        notes: normalizeText(data.notes || prev.notes),
      }));
      const rawCost = Number(data.costEur ?? data.estimatedCostEur);
      if (Number.isFinite(rawCost) && rawCost >= 0) {
        setMessage(`Sugerencias IA listas. Coste: ${rawCost.toFixed(2)} €.`);
      } else {
        setMessage("Sugerencias IA listas. Revisa y guarda la ficha.");
      }
    } catch (aiErr) {
      console.error("Error recuperando datos con IA:", aiErr);
      const code = String(aiErr?.code || "").toLowerCase();
      const rawMessage = normalizeText(aiErr?.message);
      if (code.includes("permission-denied") || code.includes("unauthenticated")) {
        setError("La recuperación con IA está reservada al administrador.");
      } else if (code.includes("resource-exhausted")) {
        setError("Límite mensual de IA alcanzado. No se puede ejecutar más este mes.");
      } else if (code.includes("not-found") || code.includes("unimplemented")) {
        setError("El backend de IA aún no está desplegado.");
      } else if (code.includes("internal")) {
        setError(rawMessage || "Error interno en backend de IA.");
      } else if (rawMessage) {
        setError(`Error IA: ${rawMessage}`);
      } else {
        setError("No se pudo recuperar datos con IA. Intenta de nuevo.");
      }
    } finally {
      setAiFilling(false);
    }
  };

  return (
    <div className="exercise-chart-shell library-page">
      <header className="library-head">
        <button className="library-back" onClick={onBack} type="button">← Volver</button>
        <div>
          <h2>Biblioteca de ejercicios</h2>
          <p>Edita la ficha maestra, el nombre visible y el modo de registro de cada ejercicio.</p>
        </div>
      </header>

      <section className="library-selectors">
        <div className="library-selectors-actions">
          <button
            className="library-reset-btn"
            onClick={clearGroupSelection}
            type="button"
            disabled={!muscleGroup && !exercise}
          >
            Limpiar selección
          </button>
        </div>
        <div>
          <label htmlFor="library-muscle-group">Grupo</label>
          <div className="library-selector-input-row">
            <input
              id="library-muscle-group"
              list="library-group-list"
              value={muscleGroup}
              onChange={(event) => {
                setMuscleGroup(event.target.value);
                setMessage("");
                setError("");
              }}
              onBlur={(event) => setMuscleGroup(normalizeText(event.target.value))}
              placeholder="Ej: Espalda"
            />
            {muscleGroup && (
              <button
                type="button"
                className="library-clear-btn"
                onClick={clearGroupSelection}
                aria-label="Borrar grupo"
                title="Borrar grupo"
              >
                ✕
              </button>
            )}
          </div>
          <datalist id="library-group-list">
            {[...new Set(allExercises.map((item) => item.muscleGroup))]
              .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
              .map((group) => (
                <option key={group} value={group} />
              ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="library-exercise">Ejercicio</label>
          <div className="library-selector-input-row">
            <input
              id="library-exercise"
              list="library-exercise-list"
              value={exercise}
              onChange={(event) => {
                setExercise(event.target.value);
                setMessage("");
                setError("");
              }}
              onBlur={(event) => setExercise(normalizeText(event.target.value))}
              placeholder={muscleGroup ? "Ej: Remo sentado" : "Selecciona grupo primero"}
            />
            {exercise && (
              <button
                type="button"
                className="library-clear-btn"
                onClick={clearExerciseSelection}
                aria-label="Borrar ejercicio"
                title="Borrar ejercicio"
              >
                ✕
              </button>
            )}
          </div>
          <datalist id="library-exercise-list">
            {exerciseOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>
      </section>

      {message && <p className="library-message is-ok">{message}</p>}
      {error && <p className="library-message is-error">{error}</p>}
      {loading && <p className="library-empty">Cargando biblioteca...</p>}

      {!exercise || !muscleGroup ? (
        <p className="library-empty">Selecciona grupo y ejercicio para ver o crear su ficha.</p>
      ) : (
        <section className="library-card">
          <div className="library-card-head">
            <div>
              <h3>{normalizeText(muscleGroup)} · {normalizeText(exercise)}</h3>
              {activeExerciseId ? (
                <p className="library-meta">Ficha maestra existente. Los cambios mantienen su identidad interna.</p>
              ) : (
                <p className="library-meta">Aún no existe ficha maestra. Guarda para crearla.</p>
              )}
            </div>
            <button className="library-save-btn" onClick={handleSave} type="button" disabled={saving || loading}>
              {saving ? "Guardando..." : activeExerciseId ? "Guardar ficha" : "Crear ficha"}
            </button>
          </div>

          <div className="library-form-grid">
            <div className="library-full">
              <label className="library-switch-row" htmlFor="library-tracking-mode">
                <span className={`tracking-mode-option${draft.trackingMode === TRACKING_MODES.STRENGTH ? " is-active" : ""}`}>Peso / reps</span>
                <span className="tracking-mode-slider">
                  <input
                    id="library-tracking-mode"
                    type="checkbox"
                    checked={draft.trackingMode === TRACKING_MODES.ENDURANCE}
                    onChange={(event) =>
                      setDraft((prev) => ({
                        ...prev,
                        trackingMode: event.target.checked ? TRACKING_MODES.ENDURANCE : TRACKING_MODES.STRENGTH,
                      }))
                    }
                  />
                  <span className="tracking-mode-slider-ui" aria-hidden="true" />
                </span>
                <span className={`tracking-mode-option${draft.trackingMode === TRACKING_MODES.ENDURANCE ? " is-active" : ""}`}>Min / dist</span>
              </label>
              <p className="library-help-text">
                {draft.trackingMode === TRACKING_MODES.ENDURANCE
                  ? "Este ejercicio se registrará con minutos obligatorios y distancia opcional."
                  : "Este ejercicio se registrará con peso y repeticiones."}
              </p>
            </div>
            <div className="library-full">
              <label htmlFor="library-description">Descripción</label>
              <textarea
                id="library-description"
                value={draft.description}
                onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Qué representa este ejercicio para ti o cómo quieres usarlo"
                rows={2}
              />
            </div>
            <div>
              <label htmlFor="library-youtube">YouTube</label>
              <input
                id="library-youtube"
                type="url"
                value={draft.youtubeUrl}
                onChange={(event) => setDraft((prev) => ({ ...prev, youtubeUrl: event.target.value }))}
                placeholder="https://www.youtube.com/watch?v=..."
              />
              <div className="library-youtube-actions">
                <button
                  type="button"
                  className="library-ai-btn"
                  onClick={handleFillWithAi}
                  disabled={aiFilling || loading || saving}
                  title="Recuperar técnica y notas desde el vídeo"
                >
                  {aiFilling ? "Analizando..." : "Recuperar datos con IA"}
                </button>
              </div>
              {video.valid && (
                <div className="library-video">
                  <div className="library-video-head">
                    <strong>Vídeo</strong>
                    <a href={video.watchUrl} target="_blank" rel="noreferrer">Abrir en YouTube</a>
                  </div>
                  <iframe
                    title={`Video ${normalizeText(exercise)}`}
                    src={video.embedUrl}
                    loading="lazy"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                  />
                </div>
              )}
            </div>
            <div>
              <label htmlFor="library-equipment">Material</label>
              <input
                id="library-equipment"
                type="text"
                value={draft.equipment}
                onChange={(event) => setDraft((prev) => ({ ...prev, equipment: event.target.value }))}
                placeholder="Ej: barra, banco inclinado"
              />
            </div>
            <div>
              <label htmlFor="library-technique">Técnica clave</label>
              <textarea
                id="library-technique"
                value={draft.technique}
                onChange={(event) => setDraft((prev) => ({ ...prev, technique: event.target.value }))}
                placeholder="Puntos técnicos importantes"
                rows={3}
              />
            </div>
            <div>
              <label htmlFor="library-mistakes">Errores comunes</label>
              <textarea
                id="library-mistakes"
                value={draft.mistakes}
                onChange={(event) => setDraft((prev) => ({ ...prev, mistakes: event.target.value }))}
                placeholder="Qué evitar"
                rows={3}
              />
            </div>
            <div className="library-full">
              <label htmlFor="library-notes">Notas</label>
              <textarea
                id="library-notes"
                value={draft.notes}
                onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                placeholder="Notas rápidas para tu sesión"
                rows={3}
              />
            </div>
          </div>
        </section>
      )}

      <section className="library-list">
        <h3>Ejercicios disponibles</h3>
        {groupedPairs.length === 0 ? (
          <p className="library-empty">No hay ejercicios todavía.</p>
        ) : (
          groupedPairs.map(([group, entries]) => (
            <details key={group} className="library-group">
              <summary>{group}</summary>
              <ul>
                {entries.map((item) => {
                  const hasYoutube = Boolean(item.youtubeUrl);
                  const isEndurance = item.trackingMode === TRACKING_MODES.ENDURANCE;
                  return (
                    <li key={`${group}||${item.exerciseId || item.exercise}`}>
                      <button
                        type="button"
                        onClick={() => {
                          applySelection(item);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <span className="library-exercise-name">{item.exercise}</span>
                        <span className="library-inline-badges">
                          {isEndurance && <span className="library-mode-badge">Tiempo</span>}
                          {hasYoutube && (
                            <span
                              className="library-youtube-badge"
                              title="Tiene enlace de YouTube"
                              aria-label="Tiene enlace de YouTube"
                            >
                              <Youtube size={14} strokeWidth={2.3} />
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))
        )}
      </section>
    </div>
  );
};

export default ExerciseLibrary;
