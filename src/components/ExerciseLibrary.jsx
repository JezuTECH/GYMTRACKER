import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";

const normalizeText = (value) => String(value || "").trim().replace(/\s+/g, " ");

const sanitize = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\-_. ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 90);

const docKeyFor = (muscleGroup, exercise) => `${sanitize(muscleGroup)}__${sanitize(exercise)}`;

const emptyDraft = {
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
    return "Permisos insuficientes para leer/guardar la ficha. Revisa reglas y sesión.";
  }
  if (code.includes("unauthenticated")) {
    return "Tu sesión no es válida. Cierra sesión y vuelve a entrar.";
  }
  if (code.includes("unavailable")) {
    return "Servicio no disponible temporalmente. Intenta de nuevo en unos segundos.";
  }
  return fallback;
};

const ExerciseLibrary = ({ user, selectedExercise, onSelectExercise, onBack }) => {
  const [allPairs, setAllPairs] = useState([]);
  const [muscleGroup, setMuscleGroup] = useState("");
  const [exercise, setExercise] = useState("");
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const loadPairs = async () => {
      const qAll = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snap = await getDocs(qAll);
      const seen = new Set();
      const pairs = [];

      snap.docs.forEach((snapshotDoc) => {
        const data = snapshotDoc.data();
        if (isMarkedDeleted(data)) return;
        const nextGroup = normalizeText(data.muscleGroup);
        const nextExercise = normalizeText(data.exercise);
        if (!nextGroup || !nextExercise) return;
        const key = `${nextGroup}||${nextExercise}`;
        if (seen.has(key)) return;
        seen.add(key);
        pairs.push({ muscleGroup: nextGroup, exercise: nextExercise });
      });

      pairs.sort((a, b) => {
        const byGroup = a.muscleGroup.localeCompare(b.muscleGroup);
        if (byGroup !== 0) return byGroup;
        return a.exercise.localeCompare(b.exercise);
      });
      setAllPairs(pairs);
    };

    loadPairs().catch((loadErr) => {
      console.error("Error cargando biblioteca:", loadErr);
      setError("No se pudo cargar la biblioteca.");
    });
  }, [user]);

  useEffect(() => {
    if (!selectedExercise || typeof selectedExercise !== "object") return;
    const nextGroup = normalizeText(selectedExercise.muscleGroup);
    const nextExercise = normalizeText(selectedExercise.exercise);
    if (!nextExercise) return;
    setMuscleGroup(nextGroup);
    setExercise(nextExercise);
  }, [selectedExercise]);

  const exerciseOptions = useMemo(() => {
    if (!muscleGroup) {
      return [...new Set(allPairs.map((item) => item.exercise))].sort((a, b) => a.localeCompare(b));
    }
    return allPairs
      .filter((item) => item.muscleGroup.toLowerCase() === muscleGroup.toLowerCase())
      .map((item) => item.exercise)
      .sort((a, b) => a.localeCompare(b));
  }, [allPairs, muscleGroup]);

  const activeKey = useMemo(() => {
    const nextGroup = normalizeText(muscleGroup);
    const nextExercise = normalizeText(exercise);
    if (!nextGroup || !nextExercise) return "";
    return docKeyFor(nextGroup, nextExercise);
  }, [muscleGroup, exercise]);

  useEffect(() => {
    if (!user || !activeKey) {
      setDraft(emptyDraft);
      return;
    }

    const loadRecord = async () => {
      setLoading(true);
      setError("");
      try {
        const ref = doc(db, "users", user.uid, "exerciseLibrary", activeKey);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          setDraft(emptyDraft);
          return;
        }
        const data = snap.data();
        setDraft({
          youtubeUrl: String(data.youtubeUrl || ""),
          technique: String(data.technique || ""),
          mistakes: String(data.mistakes || ""),
          equipment: String(data.equipment || ""),
          notes: String(data.notes || ""),
        });
      } catch (loadErr) {
        console.error("Error cargando ficha:", loadErr);
        setError(explainFirestoreError(loadErr, "No se pudo cargar la ficha del ejercicio."));
      } finally {
        setLoading(false);
      }
    };

    loadRecord();
  }, [user, activeKey]);

  useEffect(() => {
    const nextExercise = normalizeText(exercise);
    const nextGroup = normalizeText(muscleGroup);
    if (!nextExercise || !nextGroup) return;
    onSelectExercise?.({ exercise: nextExercise, muscleGroup: nextGroup });
  }, [exercise, muscleGroup, onSelectExercise]);

  const groupedPairs = useMemo(() => {
    return Object.entries(
      allPairs.reduce((acc, pair) => {
        const group = pair.muscleGroup || "Sin grupo";
        if (!acc[group]) acc[group] = [];
        acc[group].push(pair.exercise);
        return acc;
      }, {})
    ).map(([group, exercises]) => [group, [...new Set(exercises)].sort((a, b) => a.localeCompare(b))]);
  }, [allPairs]);

  const video = useMemo(() => parseYoutube(draft.youtubeUrl), [draft.youtubeUrl]);

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

      const payload = {
        uid: user.uid,
        muscleGroup: nextGroup,
        exercise: nextExercise,
        youtubeUrl: parsed.valid ? parsed.watchUrl : "",
        technique: normalizeText(draft.technique),
        mistakes: normalizeText(draft.mistakes),
        equipment: normalizeText(draft.equipment),
        notes: normalizeText(draft.notes),
        updatedAt: serverTimestamp(),
      };

      const ref = doc(db, "users", user.uid, "exerciseLibrary", docKeyFor(nextGroup, nextExercise));
      await setDoc(ref, payload, { merge: true });
      setMessage("Ficha guardada correctamente.");
      if (parsed.valid && payload.youtubeUrl !== draft.youtubeUrl) {
        setDraft((prev) => ({ ...prev, youtubeUrl: payload.youtubeUrl }));
      }
    } catch (saveErr) {
      console.error("Error guardando ficha:", saveErr);
      setError(explainFirestoreError(saveErr, "No se pudo guardar la ficha."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="exercise-chart-shell library-page">
      <header className="library-head">
        <button className="library-back" onClick={onBack} type="button">← Volver</button>
        <div>
          <h2>Biblioteca de ejercicios</h2>
          <p>Guarda técnica, vídeo y notas para cada grupo y ejercicio.</p>
        </div>
      </header>

      <section className="library-selectors">
        <div>
          <label htmlFor="library-muscle-group">Grupo</label>
          <input
            id="library-muscle-group"
            list="library-group-list"
            value={muscleGroup}
            onChange={(event) => {
              setMuscleGroup(event.target.value);
              setExercise("");
            }}
            placeholder="Ej: Espalda"
          />
          <datalist id="library-group-list">
            {[...new Set(allPairs.map((item) => item.muscleGroup))].sort((a, b) => a.localeCompare(b)).map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="library-exercise">Ejercicio</label>
          <input
            id="library-exercise"
            list="library-exercise-list"
            value={exercise}
            onChange={(event) => setExercise(event.target.value)}
            placeholder={muscleGroup ? "Ej: Remo sentado" : "Selecciona grupo primero"}
          />
          <datalist id="library-exercise-list">
            {exerciseOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>
      </section>

      {message && <p className="library-message is-ok">{message}</p>}
      {error && <p className="library-message is-error">{error}</p>}

      {!activeKey ? (
        <p className="library-empty">Selecciona grupo y ejercicio para ver o crear su ficha.</p>
      ) : (
        <section className="library-card">
          <div className="library-card-head">
            <h3>{normalizeText(muscleGroup)} · {normalizeText(exercise)}</h3>
            <button className="library-save-btn" onClick={handleSave} type="button" disabled={saving || loading}>
              {saving ? "Guardando..." : "Guardar ficha"}
            </button>
          </div>

          <div className="library-form-grid">
            <div>
              <label htmlFor="library-youtube">YouTube</label>
              <input
                id="library-youtube"
                type="url"
                value={draft.youtubeUrl}
                onChange={(event) => setDraft((prev) => ({ ...prev, youtubeUrl: event.target.value }))}
                placeholder="https://www.youtube.com/watch?v=..."
              />
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
        </section>
      )}

      <section className="library-list">
        <h3>Ejercicios disponibles</h3>
        {groupedPairs.length === 0 ? (
          <p className="library-empty">No hay ejercicios en tu historial todavía.</p>
        ) : (
          groupedPairs.map(([group, exercises]) => (
            <details key={group} className="library-group">
              <summary>{group}</summary>
              <ul>
                {exercises.map((name) => (
                  <li key={`${group}||${name}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setMuscleGroup(group === "Sin grupo" ? "" : group);
                        setExercise(name);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </section>
    </div>
  );
};

export default ExerciseLibrary;
