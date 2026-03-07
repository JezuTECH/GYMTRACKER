import { useEffect, useMemo, useState } from "react";
import { db } from "../firebase/config";
import { listUserExercises } from "../data/exerciseMaster";
import {
  doc,
  serverTimestamp,
  collection,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import {
  deleteDocWithFreshAuth,
  getDocWithFreshAuth,
  getDocsWithFreshAuth,
  setDocWithFreshAuth,
} from "../firebase/firestoreRetry";
import { buildCanonicalKey, normalizeText } from "../utils/exerciseCatalog";
import "./PlanDay.css";

const emptyRoutine = () => ({ muscleGroup: "", exercise: "", series: "" });
const initialRoutines = (count = 3) => Array.from({ length: count }, () => emptyRoutine());

const toLocalDateKey = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const fromLocalDateKey = (dateKey) => {
  const [y, m, d] = String(dateKey || "").split("-").map((part) => Number(part));
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
};

const planDocId = (uid, dateKey) => `${uid}_${dateKey}`;

const toJsDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  return null;
};

const normalizeKey = (value) => String(value || "").trim().toLowerCase();

const normalizeRoutine = (routine) => ({
  muscleGroup: String(routine?.muscleGroup || ""),
  exercise: String(routine?.exercise || ""),
  series: String(routine?.series || ""),
  exerciseId: String(routine?.exerciseId || ""),
  trackingModeSnapshot: String(routine?.trackingModeSnapshot || ""),
});

const formatPlanDate = (value) => {
  const date = toJsDate(value);
  if (!date) return "Sin fecha";
  return date.toLocaleDateString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const getDateMs = (value) => toJsDate(value)?.getTime() || 0;

const PlanDay = ({ user, onBack, onPickExercise }) => {
  const [plans, setPlans] = useState([]);
  const [todayPlan, setTodayPlan] = useState(null);
  const [viewPlanId, setViewPlanId] = useState("");
  const [editing, setEditing] = useState(false);
  const [routines, setRoutines] = useState(() => initialRoutines());
  const [allExercises, setAllExercises] = useState([]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingDate, setEditingDate] = useState(() => toLocalDateKey(new Date()));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const todayKey = useMemo(() => toLocalDateKey(new Date()), []);
  const todayDocId = planDocId(user.uid, todayKey);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const todayRef = doc(db, "plans", todayDocId);
        const plansQuery = query(collection(db, "plans"), where("uid", "==", user.uid));

        const [exerciseOptions, todaySnap, plansSnap] = await Promise.all([
          listUserExercises(db, user.uid),
          getDocWithFreshAuth(todayRef),
          getDocsWithFreshAuth(plansQuery),
        ]);

        if (cancelled) return;

        setAllExercises(exerciseOptions);

        const loadedPlans = plansSnap.docs
          .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
          .sort((a, b) => getDateMs(b.date) - getDateMs(a.date));

        setPlans(loadedPlans);

        if (todaySnap.exists()) {
          const data = todaySnap.data();
          const normalizedToday = { id: todayDocId, ...data };
          setTodayPlan(normalizedToday);
          setDescription(String(data.description || ""));

          const nextRoutines = Array.isArray(data.routines) && data.routines.length > 0
            ? data.routines.map(normalizeRoutine)
            : [emptyRoutine()];

          setRoutines(nextRoutines);
          setEditing(false);
          setViewPlanId(todayDocId);
          setEditingDate(todayKey);
        } else {
          setTodayPlan(null);
          setDescription("");
          setRoutines(initialRoutines());
          setEditing(true);
          setViewPlanId(loadedPlans[0]?.id || "");
          setEditingDate(todayKey);
        }
      } catch (loadError) {
        console.error("❌ Error cargando planificación:", loadError);
        if (!cancelled) {
          setError("No se pudo cargar la planificación. Revisa la conexión e inténtalo de nuevo.");
          setTodayPlan(null);
          setRoutines(initialRoutines());
          setDescription("");
          setEditing(true);
          setEditingDate(todayKey);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [user, todayDocId, todayKey]);

  const activePlan = useMemo(() => {
    if (!viewPlanId) return todayPlan;
    return plans.find((plan) => plan.id === viewPlanId) || todayPlan;
  }, [plans, todayPlan, viewPlanId]);

  const previewRows = editing ? routines : (activePlan?.routines || []);
  const planGroups = new Set(previewRows.map((row) => String(row.muscleGroup || "").trim()).filter(Boolean)).size;

  const exercisesByGroup = useMemo(() => {
    const map = new Map();
    allExercises.forEach((item) => {
      const group = String(item?.muscleGroup || "").trim();
      const exercise = String(item?.exercise || "").trim();
      if (!group || !exercise) return;

      const key = normalizeKey(group);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(exercise);
    });
    return map;
  }, [allExercises]);

  const getExercisesForGroup = (muscleGroup) => {
    const key = normalizeKey(muscleGroup);
    if (!key) return [];
    return Array.from(exercisesByGroup.get(key) || []).sort((a, b) => a.localeCompare(b));
  };

  const getDateKeyFromPlanId = (id) => {
    const prefix = `${user.uid}_`;
    if (!String(id || "").startsWith(prefix)) return todayKey;
    const dateKey = String(id).slice(prefix.length);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : todayKey;
  };

  const startNewPlan = (dateKey = todayKey) => {
    setMessage("");
    setError("");
    setEditing(true);
    setEditingDate(dateKey);
    setDescription("");
    setRoutines(initialRoutines());
  };

  const startEditingPlan = (plan) => {
    if (!plan) {
      startNewPlan(todayKey);
      return;
    }

    const nextRoutines = Array.isArray(plan.routines) && plan.routines.length > 0
      ? plan.routines.map(normalizeRoutine)
      : [emptyRoutine()];

    setMessage("");
    setError("");
    setEditing(true);
    setDescription(String(plan.description || ""));
    setRoutines(nextRoutines);
    setEditingDate(getDateKeyFromPlanId(plan.id));
  };

  const handleCancelEdit = () => {
    setError("");
    setMessage("");
    setEditing(false);

    if (todayPlan) {
      setDescription(String(todayPlan.description || ""));
      setRoutines(
        Array.isArray(todayPlan.routines) && todayPlan.routines.length > 0
          ? todayPlan.routines.map(normalizeRoutine)
          : [emptyRoutine()]
      );
      setViewPlanId(todayDocId);
      setEditingDate(todayKey);
      return;
    }

    if (activePlan) {
      setDescription(String(activePlan.description || ""));
      setRoutines(
        Array.isArray(activePlan.routines) && activePlan.routines.length > 0
          ? activePlan.routines.map(normalizeRoutine)
          : [emptyRoutine()]
      );
      setEditingDate(getDateKeyFromPlanId(activePlan.id));
      return;
    }

    setDescription("");
    setRoutines(initialRoutines());
    setEditingDate(todayKey);
  };

  const handleChange = (index, field, value) => {
    setRoutines((previous) => {
      const updated = [...previous];
      const current = updated[index] || emptyRoutine();

      if (field === "muscleGroup") {
        const changedGroup = normalizeKey(value) !== normalizeKey(current.muscleGroup);
        updated[index] = {
          ...current,
          muscleGroup: value,
          exercise: changedGroup ? "" : current.exercise,
        };
        return updated;
      }

      if (field === "exercise" && !String(current.muscleGroup || "").trim()) {
        return updated;
      }

      updated[index] = { ...current, [field]: value };
      return updated;
    });
  };

  const addLine = () => {
    setRoutines((previous) => [...previous, emptyRoutine()]);
  };

  const removeLine = (index) => {
    setRoutines((previous) => {
      if (previous.length <= 1) return [emptyRoutine()];
      return previous.filter((_, rowIndex) => rowIndex !== index);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const saveDateKey = editingDate || todayKey;
      const targetDocId = planDocId(user.uid, saveDateKey);

      const clean = routines
        .map((routine) => {
          const muscleGroup = normalizeText(routine.muscleGroup);
          const exercise = normalizeText(routine.exercise);
          const matchedExercise = allExercises.find(
            (item) => buildCanonicalKey(item.muscleGroup, item.exercise) === buildCanonicalKey(muscleGroup, exercise)
          );
          return {
            muscleGroup,
            exercise,
            series: routine.series.trim(),
            exerciseId: matchedExercise?.exerciseId || "",
            trackingModeSnapshot: matchedExercise?.trackingMode || "",
          };
        })
        .filter((routine) => routine.muscleGroup && routine.exercise && routine.series);

      if (clean.length === 0) {
        setError("Añade al menos una línea completa (grupo, ejercicio y series).");
        return;
      }

      const payload = {
        uid: user.uid,
        date: Timestamp.fromDate(fromLocalDateKey(saveDateKey)),
        description: description.trim() || "Planificación del día",
        routines: clean,
        updatedAt: serverTimestamp(),
      };

      await setDocWithFreshAuth(doc(db, "plans", targetDocId), payload);

      const newPlan = { ...payload, id: targetDocId };
      if (targetDocId === todayDocId) {
        setTodayPlan(newPlan);
      }
      setRoutines(clean);
      setDescription(payload.description);
      setEditing(false);
      setViewPlanId(targetDocId);
      setEditingDate(saveDateKey);
      setMessage("Plan guardado correctamente.");

      setPlans((previous) => {
        const filtered = previous.filter((plan) => plan.id !== targetDocId);
        return [newPlan, ...filtered].sort((a, b) => getDateMs(b.date) - getDateMs(a.date));
      });
    } catch (saveError) {
      console.error("❌ Error guardando planificación:", saveError);
      setError("No se pudo guardar el plan. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async () => {
    if (!activePlan?.id || deleting || saving) return;

    const planLabel = activePlan.description || formatPlanDate(activePlan.date);
    if (!window.confirm(`¿Seguro que quieres borrar la planificación "${planLabel}"?`)) return;

    setDeleting(true);
    setMessage("");
    setError("");

    try {
      await deleteDocWithFreshAuth(doc(db, "plans", activePlan.id));

      const remainingPlans = plans
        .filter((plan) => plan.id !== activePlan.id)
        .sort((a, b) => getDateMs(b.date) - getDateMs(a.date));

      setPlans(remainingPlans);

      if (activePlan.id === todayDocId) {
        setTodayPlan(null);
        setViewPlanId(remainingPlans[0]?.id || "");
        startNewPlan(todayKey);
      } else {
        const nextViewId = todayPlan?.id || remainingPlans[0]?.id || "";
        setViewPlanId(nextViewId);
      }

      setMessage("Planificación eliminada.");
    } catch (deleteError) {
      console.error("❌ Error borrando planificación:", deleteError);
      setError("No se pudo borrar la planificación. Inténtalo de nuevo.");
    } finally {
      setDeleting(false);
    }
  };

  const handleRegisterFromPlan = (routine) => {
    const nextExercise = String(routine?.exercise || "").trim();
    const nextGroup = String(routine?.muscleGroup || "").trim();
    if (!nextExercise || !nextGroup) return;

    const params = new URLSearchParams();
    params.set("exercise", nextExercise);
    params.set("muscleGroup", nextGroup);
    window.history.pushState({}, "", `/?${params.toString()}`);

    if (typeof onPickExercise === "function") {
      onPickExercise({
        exerciseId: normalizeText(routine?.exerciseId),
        exercise: nextExercise,
        muscleGroup: nextGroup,
        trackingMode: routine?.trackingModeSnapshot || "",
      });
      return;
    }

    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const copyLatestPlan = () => {
    const nextSource = plans.find((plan) => plan.id !== planDocId(user.uid, editingDate)) || plans[0];
    if (!nextSource || !Array.isArray(nextSource.routines) || nextSource.routines.length === 0) {
      setError("No hay una planificación previa para copiar.");
      return;
    }
    setRoutines(nextSource.routines.map(normalizeRoutine));
    if (!description.trim()) {
      setDescription(String(nextSource.description || "Planificación copiada"));
    }
    setMessage("Plan previo copiado. Revisa y guarda.");
    setError("");
  };

  return (
    <div className="plan-day">
      <section className="plan-hero">
        <button className="plan-back" onClick={onBack} type="button">← Volver</button>
        <div>
          <h2>Plan del Día</h2>
          <p>Diseña la sesión, guarda tu plantilla y pulsa una fila para saltar al registro.</p>
        </div>
      </section>

      {message && <div className="plan-alert plan-alert-ok">{message}</div>}
      {error && <div className="plan-alert plan-alert-error">{error}</div>}

      {loading ? (
        <div className="plan-loading">Cargando planificación…</div>
      ) : (
        <>
          {!editing && plans.length > 1 && (
            <section className="plan-card plan-picker">
              <label htmlFor="plan-picker">Ver otra planificación</label>
              <select
                id="plan-picker"
                value={activePlan?.id || ""}
                onChange={(event) => setViewPlanId(event.target.value)}
                className="plan-input"
              >
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {formatPlanDate(plan.date)} · {plan.description || "Sin descripción"}
                  </option>
                ))}
              </select>
            </section>
          )}

          {editing ? (
            <section className="plan-card">
              <div className="plan-card-head">
                <h3>{todayDocId === planDocId(user.uid, editingDate) ? "Editar plan de hoy" : "Editar planificación"}</h3>
              </div>

              <div className="plan-edit-grid">
                <div>
                  <label htmlFor="plan-date">Fecha del plan</label>
                  <input
                    id="plan-date"
                    type="date"
                    value={editingDate}
                    onChange={(event) => setEditingDate(event.target.value)}
                    className="plan-input"
                  />
                </div>
                <div>
                  <label htmlFor="plan-description">Descripción</label>
                  <input
                    id="plan-description"
                    type="text"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Ej: Pecho y tríceps"
                    className="plan-input"
                  />
                </div>
              </div>

              <div className="plan-add-row">
                <button className="plan-btn plan-btn-ghost" onClick={addLine} type="button">
                  + Añadir otra línea
                </button>
                <button className="plan-btn plan-btn-secondary" onClick={copyLatestPlan} type="button">
                  Copiar plan previo
                </button>
              </div>

              <div className="plan-table-wrap">
                <table className="plan-table plan-table-edit">
                  <thead>
                    <tr>
                      <th>Grupo muscular</th>
                      <th>Ejercicio</th>
                      <th>Series</th>
                      <th aria-label="Eliminar fila"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {routines.map((routine, index) => (
                      <tr key={`routine-${index}`}>
                        <td data-label="Grupo muscular">
                          <input
                            list="mg-list"
                            value={routine.muscleGroup}
                            onChange={(event) => handleChange(index, "muscleGroup", event.target.value)}
                            placeholder="Ej: Espalda"
                            className="plan-input plan-cell-input"
                          />
                        </td>
                        <td data-label="Ejercicio">
                          <input
                            list={routine.muscleGroup.trim() ? `ex-list-${index}` : undefined}
                            value={routine.exercise}
                            onChange={(event) => handleChange(index, "exercise", event.target.value)}
                            placeholder={routine.muscleGroup.trim() ? "Ej: Dominadas" : "Selecciona grupo primero"}
                            className="plan-input plan-cell-input"
                            disabled={!routine.muscleGroup.trim()}
                          />
                        </td>
                        <td data-label="Series">
                          <input
                            type="text"
                            value={routine.series}
                            onChange={(event) => handleChange(index, "series", event.target.value)}
                            placeholder="Ej: 4x8"
                            className="plan-input plan-cell-input"
                          />
                        </td>
                        <td className="plan-cell-action" data-label="Acción">
                          <button
                            className="plan-btn plan-btn-danger"
                            onClick={() => removeLine(index)}
                            type="button"
                            disabled={saving}
                            title={routines.length <= 1 ? "Limpiar línea" : "Eliminar línea"}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="plan-actions">
                <button
                  className="plan-btn plan-btn-secondary"
                  onClick={handleCancelEdit}
                  type="button"
                  disabled={saving || deleting}
                >
                  Cancelar
                </button>
                <button className="plan-btn plan-btn-primary" onClick={handleSave} type="button" disabled={saving || deleting}>
                  {saving ? "Guardando…" : "Guardar plan"}
                </button>
              </div>

              <datalist id="mg-list">
                {[...new Set(allExercises.map((item) => item.muscleGroup))]
                  .sort((a, b) => a.localeCompare(b))
                  .map((muscleGroup) => (
                    <option key={muscleGroup} value={muscleGroup} />
                  ))}
              </datalist>

              {routines.map((routine, index) => {
                const options = getExercisesForGroup(routine.muscleGroup);
                if (options.length === 0) return null;

                return (
                  <datalist id={`ex-list-${index}`} key={`ex-list-${index}`}>
                    {options.map((exercise) => (
                      <option key={exercise} value={exercise} />
                    ))}
                  </datalist>
                );
              })}
            </section>
          ) : (
            <section className="plan-card">
              <div className="plan-card-head">
                <h3>{activePlan?.id === todayDocId ? "Plan activo" : "Plan histórico"}</h3>
                <div className="plan-card-actions">
                  <button
                    className="plan-btn plan-btn-primary"
                    onClick={() => startEditingPlan(activePlan || todayPlan)}
                    type="button"
                    disabled={!activePlan}
                  >
                    Editar
                  </button>
                  <button
                    className="plan-btn plan-btn-ghost"
                    onClick={() => startNewPlan(todayKey)}
                    type="button"
                  >
                    Nueva
                  </button>
                  <button
                    className="plan-btn plan-btn-danger-outline"
                    onClick={handleDeletePlan}
                    type="button"
                    disabled={!activePlan || deleting || saving}
                  >
                    {deleting ? "Borrando…" : "Borrar"}
                  </button>
                </div>
              </div>

              <div className="plan-meta">
                <span>Fecha: {formatPlanDate(activePlan?.date)}</span>
                <span>{activePlan?.description || "Sin descripción"}</span>
              </div>

              {Array.isArray(activePlan?.routines) && activePlan.routines.length > 0 ? (
                <div className="plan-table-wrap">
                  <table className="plan-table">
                    <thead>
                      <tr>
                        <th>Grupo muscular</th>
                        <th>Ejercicio</th>
                        <th>Series</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activePlan.routines.map((routine, index) => (
                        <tr
                          key={`active-routine-${index}`}
                          className="plan-row-clickable"
                          onClick={() => handleRegisterFromPlan(routine)}
                        >
                          <td data-label="Grupo muscular">{routine.muscleGroup}</td>
                          <td data-label="Ejercicio">{routine.exercise}</td>
                          <td data-label="Series">{routine.series}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="plan-empty">Este plan no tiene ejercicios guardados.</p>
              )}

              <p className="plan-hint">Pulsa una fila para abrir el registro con grupo y ejercicio precargados.</p>
            </section>
          )}

          <section className="plan-secondary">
            <details>
              <summary>Información adicional</summary>
              <div className="plan-stats plan-stats-compact">
                <article className="plan-stat">
                  <span>Bloques</span>
                  <strong>{previewRows.length}</strong>
                </article>
                <article className="plan-stat">
                  <span>Grupos</span>
                  <strong>{planGroups}</strong>
                </article>
                <article className="plan-stat">
                  <span>Biblioteca</span>
                  <strong>{allExercises.length}</strong>
                </article>
              </div>
            </details>
          </section>
        </>
      )}
    </div>
  );
};

export default PlanDay;
