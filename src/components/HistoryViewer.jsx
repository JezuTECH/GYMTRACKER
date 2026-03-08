import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import {
  collection,
  query,
  where,
  orderBy,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import {
  getDocWithFreshAuth,
  getDocsWithFreshAuth,
  setDocWithFreshAuth,
  updateDocWithFreshAuth,
} from "../firebase/firestoreRetry";
import { TRACKING_MODES, buildCanonicalKey, normalizeText } from "../utils/exerciseCatalog";
import {
  formatDistanceKm,
  formatDurationMin,
  formatPace,
  getEnduranceMetrics,
  getStrengthMetrics,
} from "../utils/workoutMetrics";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";
import { listUserExercises } from "../data/exerciseMaster";

const pad2 = (value) => String(value).padStart(2, "0");
const dateKeyLocal = (date) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const parseDateKeyLocal = (dateKey) => {
  const [year, month, day] = String(dateKey || "").split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
};

const startOfMonth = (value) => {
  const date = value instanceof Date ? new Date(value) : parseDateKeyLocal(value) || new Date();
  date.setDate(1);
  date.setHours(12, 0, 0, 0);
  return date;
};

const asNonNegativeInteger = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null, error: "" };
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, error: "Debes introducir un número mayor o igual que 0." };
  }
  return { value: Math.round(parsed), error: "" };
};

const toInputMetricValue = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  return String(Math.round(parsed));
};

const formatDateLabel = (value) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("es-ES");
};

const HistoryViewer = ({ user, onBack }) => {
  const [selectedDate, setSelectedDate] = useState("");
  const [records, setRecords] = useState([]);
  const [exerciseMaster, setExerciseMaster] = useState([]);
  const [loading, setLoading] = useState(false);
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [monthActivity, setMonthActivity] = useState({});
  const [monthLoading, setMonthLoading] = useState(false);
  const [dailyMetricsByDate, setDailyMetricsByDate] = useState({});
  const [metricsDraft, setMetricsDraft] = useState({ calories: "", minutes: "" });
  const [metricsSaving, setMetricsSaving] = useState(false);
  const [metricsMessage, setMetricsMessage] = useState("");
  const [metricsError, setMetricsError] = useState("");
  const [openKey, setOpenKey] = useState(null);
  const [editingRowId, setEditingRowId] = useState("");
  const [editingDraft, setEditingDraft] = useState({ weight: "", reps: "", durationMin: "", distanceKm: "" });

  const exerciseMasterById = useMemo(
    () =>
      exerciseMaster.reduce((acc, item) => {
        if (!item.exerciseId) return acc;
        acc[item.exerciseId] = item;
        return acc;
      }, {}),
    [exerciseMaster]
  );

  const getDisplayExerciseMeta = (item = {}) => {
    const master = exerciseMasterById[normalizeText(item.exerciseId)];
    return {
      exercise: master?.exercise || item.exercise,
      muscleGroup: master?.muscleGroup || item.muscleGroup,
    };
  };

  const buildGroupKey = (item) =>
    normalizeText(item.exerciseId) || buildCanonicalKey(item.muscleGroup, item.exercise);

  const groupByExercise = (items) => {
    const map = new Map();
    for (const item of items) {
      const key = buildGroupKey(item);
      const displayMeta = getDisplayExerciseMeta(item);
      if (!map.has(key)) {
        map.set(key, {
          key,
          exerciseId: normalizeText(item.exerciseId),
          muscleGroup: displayMeta.muscleGroup,
          exercise: displayMeta.exercise,
          trackingMode: item.trackingMode,
          rows: [],
        });
      }
      map.get(key).rows.push(item);
    }

    const grouped = Array.from(map.values()).map((group) => {
      if (group.trackingMode === TRACKING_MODES.ENDURANCE) {
        const metrics = getEnduranceMetrics(group.rows);
        return {
          ...group,
          headlineLabel: metrics.totalDistanceKm != null ? "Distancia" : "Minutos",
          headlineValue: metrics.totalDistanceKm != null
            ? formatDistanceKm(metrics.totalDistanceKm)
            : formatDurationMin(metrics.totalDurationMin),
          detailLine: [
            formatDurationMin(metrics.totalDurationMin),
            metrics.totalDistanceKm != null ? formatDistanceKm(metrics.totalDistanceKm) : null,
            metrics.paceMinPerKm != null ? formatPace(metrics.paceMinPerKm) : null,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }

      const metrics = getStrengthMetrics(group.rows);
      return {
        ...group,
        headlineLabel: "PowerScore",
        headlineValue: metrics.powerScore,
        detailLine: `${metrics.averageWeight ?? "-"} kg · ${metrics.averageReps ?? "-"} reps`,
      };
    });

    grouped.sort((a, b) => (a.muscleGroup || "").localeCompare(b.muscleGroup || "") || (a.exercise || "").localeCompare(b.exercise || ""));
    return grouped;
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

  const fetchRecords = async (dateStr) => {
    if (!user || !dateStr) return;
    setLoading(true);

    try {
      const parsed = parseDateKeyLocal(dateStr);
      if (!parsed) {
        setRecords([]);
        return;
      }
      const start = new Date(parsed);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const q = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        where("timestamp", ">=", start),
        where("timestamp", "<", end),
        orderBy("timestamp", "asc")
      );

      const snapshot = await getDocsWithFreshAuth(q);
      const data = snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((record) => !isMarkedDeleted(record))
        .map((record) => ({
          id: record.id,
          exerciseId: normalizeText(record.exerciseId),
          trackingMode: record.trackingModeSnapshot === TRACKING_MODES.ENDURANCE
            ? TRACKING_MODES.ENDURANCE
            : TRACKING_MODES.STRENGTH,
          muscleGroup: record.muscleGroup || record.muscleGroupSnapshot || "-",
          exercise: record.exercise || record.exerciseNameSnapshot || "-",
          weight: typeof record.weight === "number" ? record.weight : null,
          reps: typeof record.reps === "number" ? record.reps : null,
          durationMin: typeof record.durationMin === "number" ? record.durationMin : null,
          distanceKm: typeof record.distanceKm === "number" ? record.distanceKm : null,
          timestamp: record.timestamp?.seconds ? new Date(record.timestamp.seconds * 1000) : record.timestamp?.toDate?.() || null,
        }));

      setRecords(data);
    } catch (err) {
      console.error("Error recuperando registros:", err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e) => {
    const date = e.target.value;
    setSelectedDate(date);
    setOpenKey(null);
    setMetricsMessage("");
    setMetricsError("");
    if (date) {
      setMonthCursor(startOfMonth(date));
    }
    fetchRecords(date);
  };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const loadMonthActivity = async () => {
      setMonthLoading(true);
      try {
        const start = new Date(monthCursor);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setMonth(end.getMonth() + 1);

        const q = query(
          collection(db, "workouts"),
          where("uid", "==", user.uid),
          where("timestamp", ">=", start),
          where("timestamp", "<", end),
          orderBy("timestamp", "asc")
        );

        const snapshot = await getDocsWithFreshAuth(q);
        if (cancelled) return;

        const nextActivity = {};
        snapshot.docs.forEach((snapshotDoc) => {
          const data = snapshotDoc.data();
          if (isMarkedDeleted(data)) return;

          const date =
            data.timestamp?.toDate?.() ||
            (data.timestamp?.seconds ? new Date(data.timestamp.seconds * 1000) : null);
          if (!date) return;

          const key = dateKeyLocal(date);
          nextActivity[key] = (nextActivity[key] || 0) + 1;
        });

        setMonthActivity(nextActivity);
      } catch (err) {
        console.error("Error recuperando actividad mensual:", err);
        if (!cancelled) setMonthActivity({});
      } finally {
        if (!cancelled) setMonthLoading(false);
      }
    };

    loadMonthActivity();

    return () => {
      cancelled = true;
    };
  }, [user, monthCursor]);

  useEffect(() => {
    if (!user) {
      setDailyMetricsByDate({});
      return;
    }
    let cancelled = false;

    const loadDailyMetrics = async () => {
      try {
        const userRef = doc(db, "users", user.uid);
        const snap = await getDocWithFreshAuth(userRef);
        if (cancelled) return;
        const metrics = snap.data()?.dailyMetrics;
        if (!metrics || typeof metrics !== "object") {
          setDailyMetricsByDate({});
          return;
        }
        const normalized = {};
        Object.entries(metrics).forEach(([dateKey, value]) => {
          if (!value || typeof value !== "object") return;
          normalized[dateKey] = {
            calories: Number.isFinite(Number(value.calories)) ? Math.max(0, Math.round(Number(value.calories))) : null,
            minutes: Number.isFinite(Number(value.minutes)) ? Math.max(0, Math.round(Number(value.minutes))) : null,
          };
        });
        setDailyMetricsByDate(normalized);
      } catch (err) {
        console.error("Error recuperando métricas diarias:", err);
        if (!cancelled) setDailyMetricsByDate({});
      }
    };

    loadDailyMetrics();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!selectedDate) {
      setMetricsDraft({ calories: "", minutes: "" });
      setMetricsMessage("");
      setMetricsError("");
      return;
    }
    const current = dailyMetricsByDate[selectedDate] || {};
    setMetricsDraft({
      calories: toInputMetricValue(current.calories),
      minutes: toInputMetricValue(current.minutes),
    });
  }, [selectedDate, dailyMetricsByDate]);

  useEffect(() => {
    if (!user) {
      setExerciseMaster([]);
      return;
    }
    let cancelled = false;

    const loadExerciseMaster = async () => {
      try {
        const items = await listUserExercises(db, user.uid);
        if (!cancelled) {
          setExerciseMaster(items.filter((item) => item.exerciseId));
        }
      } catch (err) {
        console.error("Error cargando maestro de ejercicios para diario:", err);
        if (!cancelled) setExerciseMaster([]);
      }
    };

    loadExerciseMaster();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const calendarCells = useMemo(() => {
    const base = new Date(monthCursor);
    const year = base.getFullYear();
    const month = base.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // lunes=0
    const total = Math.ceil((lead + daysInMonth) / 7) * 7;

    return Array.from({ length: total }, (_, index) => {
      const dayNumber = index - lead + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        return { key: `outside-${index}`, dayNumber: "", inMonth: false };
      }
      const date = new Date(year, month, dayNumber, 12, 0, 0, 0);
      const key = dateKeyLocal(date);
      const hits = monthActivity[key] || 0;
      return {
        key,
        dayNumber,
        inMonth: true,
        dateKey: key,
        hits,
        hasActivity: hits > 0,
        isSelected: selectedDate === key,
      };
    });
  }, [monthCursor, monthActivity, selectedDate]);

  const monthLabel = useMemo(
    () => monthCursor.toLocaleDateString("es-ES", { month: "long", year: "numeric" }),
    [monthCursor]
  );

  const shiftMonth = (delta) => {
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1, 12, 0, 0, 0));
  };

  const quickPickDate = (dateKey) => {
    if (!dateKey) return;
    setSelectedDate(dateKey);
    setOpenKey(null);
    setMetricsMessage("");
    setMetricsError("");
    fetchRecords(dateKey);
  };

  const handleSaveDailyMetrics = async () => {
    if (!user || !selectedDate) return;

    const calories = asNonNegativeInteger(metricsDraft.calories);
    if (calories.error) {
      setMetricsError(`Calorías: ${calories.error}`);
      setMetricsMessage("");
      return;
    }

    const minutes = asNonNegativeInteger(metricsDraft.minutes);
    if (minutes.error) {
      setMetricsError(`Tiempo: ${minutes.error}`);
      setMetricsMessage("");
      return;
    }

    setMetricsSaving(true);
    setMetricsMessage("");
    setMetricsError("");

    try {
      const userRef = doc(db, "users", user.uid);
      await setDocWithFreshAuth(
        userRef,
        {
          uid: user.uid,
          dailyMetrics: {
            [selectedDate]: {
              calories: calories.value,
              minutes: minutes.value,
              updatedAt: serverTimestamp(),
            },
          },
          dailyMetricsUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setDailyMetricsByDate((prev) => ({
        ...prev,
        [selectedDate]: {
          calories: calories.value,
          minutes: minutes.value,
        },
      }));
      setMetricsMessage("Resumen diario guardado.");
    } catch (err) {
      console.error("Error guardando métricas diarias:", err);
      setMetricsError("No se pudo guardar el resumen diario.");
    } finally {
      setMetricsSaving(false);
    }
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
    setOpenKey(null);
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
        setMetricsError("Los minutos editados deben ser mayores que 0.");
        setMetricsMessage("");
        return;
      }
      if (nextDistance != null && (!Number.isFinite(nextDistance) || nextDistance < 0)) {
        setMetricsError("La distancia editada no es válida.");
        setMetricsMessage("");
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
        setMetricsError("El peso editado no es válido.");
        setMetricsMessage("");
        return;
      }
      if (nextReps != null && (!Number.isFinite(nextReps) || nextReps < 1 || nextReps > 999)) {
        setMetricsError("Las repeticiones editadas deben estar entre 1 y 999.");
        setMetricsMessage("");
        return;
      }
      nextPayload.weight = nextWeight;
      nextPayload.reps = nextReps;
      nextPayload.durationMin = null;
      nextPayload.distanceKm = null;
    }

    try {
      await updateDocWithFreshAuth(doc(db, "workouts", row.id), nextPayload);
      setRecords((previous) =>
        previous.map((item) => (item.id === row.id ? { ...item, ...nextPayload } : item))
      );
      cancelEditingRow();
      setMetricsError("");
      setMetricsMessage("Registro actualizado.");
      fetchRecords(selectedDate);
    } catch (err) {
      console.error("Error actualizando registro diario:", err);
      setMetricsError("No se pudo actualizar el registro.");
      setMetricsMessage("");
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
      setRecords((previous) => previous.filter((item) => item.id !== row.id));
      cancelEditingRow();
      setMetricsError("");
      setMetricsMessage("Registro marcado para borrado.");
      fetchRecords(selectedDate);
    } catch (err) {
      console.error("Error marcando borrado en diario:", err);
      setMetricsError("No se pudo marcar el registro para borrado.");
      setMetricsMessage("");
    }
  };

  const editingRow = useMemo(
    () => records.find((row) => row.id === editingRowId) || null,
    [editingRowId, records]
  );

  return (
    <div className="history-viewer-shell history-page">
      <header className="history-head">
        <h2>Historial diario</h2>
        <p>Selecciona una fecha y consulta el detalle por ejercicio.</p>
      </header>

      <label className="history-label" htmlFor="date-picker">Selecciona una fecha</label>
      <input
        className="history-date-input"
        type="date"
        id="date-picker"
        value={selectedDate}
        onChange={handleDateChange}
      />
      <section className="history-calendar-card">
        <div className="history-calendar-head">
          <strong>Días con actividad</strong>
          <div className="history-month-nav">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">←</button>
            <span>{monthLabel}</span>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Mes siguiente">→</button>
          </div>
        </div>
        <div className="history-calendar-weekdays" aria-hidden="true">
          {["L", "M", "X", "J", "V", "S", "D"].map((dayLabel) => (
            <span key={dayLabel}>{dayLabel}</span>
          ))}
        </div>
        {monthLoading ? (
          <p className="history-calendar-state">Cargando días...</p>
        ) : (
          <div className="history-calendar-grid">
            {calendarCells.map((cell) => (
              <button
                key={cell.key}
                type="button"
                disabled={!cell.inMonth}
                className={[
                  "history-calendar-day",
                  !cell.inMonth ? "is-outside" : "",
                  cell.hasActivity ? "has-activity" : "",
                  cell.isSelected ? "is-selected" : "",
                ]
                  .join(" ")
                  .trim()}
                onClick={() => quickPickDate(cell.dateKey)}
                title={
                  cell.inMonth
                    ? cell.hasActivity
                      ? `${cell.hits} registro(s) el ${cell.dateKey}`
                      : `Sin registros el ${cell.dateKey}`
                    : ""
                }
              >
                <span>{cell.dayNumber}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="history-metrics-card">
        <div className="history-metrics-head">
          <strong>Resumen del día</strong>
          <span>{selectedDate || "Elige fecha"}</span>
        </div>

        {!selectedDate ? (
          <p className="history-metrics-help">
            Selecciona una fecha para añadir calorías y minutos.
          </p>
        ) : (
          <>
            <div className="history-metrics-grid">
              <div className="history-metrics-field">
                <label className="history-label" htmlFor="history-calories">Calorías (kcal)</label>
                <input
                  id="history-calories"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="Ej: 520"
                  value={metricsDraft.calories}
                  onChange={(event) => setMetricsDraft((prev) => ({ ...prev, calories: event.target.value }))}
                />
              </div>
              <div className="history-metrics-field">
                <label className="history-label" htmlFor="history-minutes">Tiempo entreno (min)</label>
                <input
                  id="history-minutes"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="Ej: 75"
                  value={metricsDraft.minutes}
                  onChange={(event) => setMetricsDraft((prev) => ({ ...prev, minutes: event.target.value }))}
                />
              </div>
            </div>
            <div className="history-metrics-actions">
              <button
                type="button"
                className="history-metrics-save-btn"
                onClick={handleSaveDailyMetrics}
                disabled={metricsSaving}
              >
                {metricsSaving ? "Guardando..." : "Guardar resumen"}
              </button>
            </div>
          </>
        )}

        {metricsMessage && <p className="history-metrics-msg is-ok">{metricsMessage}</p>}
        {metricsError && <p className="history-metrics-msg is-error">{metricsError}</p>}
      </section>

      {loading && <p className="history-state">Cargando...</p>}

      {!loading && records.length > 0 && (() => {
        const groups = groupByExercise(records);
        return (
          <div className="history-list">
            {groups.map((g) => {
              const isOpen = openKey === g.key;
              return (
                <article key={g.key} className={`history-card${isOpen ? " is-open" : ""}`}>
                  <button
                    type="button"
                    className="history-card-btn"
                    onClick={() => setOpenKey(isOpen ? null : g.key)}
                    aria-expanded={isOpen}
                  >
                    <div className="history-card-line">
                      <span className="history-card-group">{g.muscleGroup}</span>
                      <span className="history-card-exercise">{g.exercise}</span>
                    </div>
                    <div className="history-card-scoreline">
                      <span>{g.headlineLabel}</span>
                      <strong>{g.headlineValue}</strong>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="history-detail">
                      <div className="history-detail-head">
                        <strong>Series del día</strong>
                        {g.detailLine && <span className="history-detail-copy">{g.detailLine}</span>}
                      </div>
                      <table className="history-series-table">
                        <thead>
                          <tr>
                            <th>Hora</th>
                            {g.trackingMode === TRACKING_MODES.ENDURANCE ? (
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
                            <th aria-hidden="true"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows
                            .slice()
                            .sort((a, b) => (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0))
                            .map((r, i) => (
                              <tr key={`${g.key}#${i}`}>
                                <td>{r.timestamp ? r.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                                {g.trackingMode === TRACKING_MODES.ENDURANCE ? (
                                  <>
                                    <td>{r.durationMin ?? "-"}</td>
                                    <td>{r.distanceKm ?? "-"}</td>
                                  </>
                                ) : (
                                  <>
                                    <td>{r.weight ?? "-"}</td>
                                    <td>{r.reps ?? "-"}</td>
                                  </>
                                )}
                                <td>
                                  <div className="exercise-row-actions">
                                    <button
                                      type="button"
                                      className="exercise-detail-action-btn exercise-detail-icon-btn"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        startEditingRow(r);
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
                  )}
                </article>
              );
            })}
          </div>
        );
      })()}

      {!loading && selectedDate && records.length === 0 && (
        <p className="history-empty">No hay registros para esta fecha.</p>
      )}

      {onBack && (
        <button className="history-back" onClick={onBack}>
          ← Volver
        </button>
      )}

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
            aria-labelledby="history-edit-modal-title"
          >
            <div className="exercise-edit-modal-head">
              <strong id="history-edit-modal-title">Editar registro</strong>
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
              {(getDisplayExerciseMeta(editingRow).exercise || editingRow.exercise)} · {formatDateLabel(editingRow.timestamp)} ·{" "}
              {editingRow.timestamp
                ? editingRow.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : "--:--"}
            </p>

            <div className="exercise-entry-grid exercise-edit-grid">
              {editingRow.trackingMode === TRACKING_MODES.ENDURANCE ? (
                <>
                  <div className="exercise-entry-field">
                    <label htmlFor="history-edit-durationMin">Minutos:</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="history-edit-durationMin"
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
                    <label htmlFor="history-edit-distanceKm">Distancia (km):</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="history-edit-distanceKm"
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
                    <label htmlFor="history-edit-weight">Peso (kg):</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="history-edit-weight"
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
                    <label htmlFor="history-edit-reps">Repeticiones:</label>
                    <div className="exercise-stepper-field">
                      <input
                        id="history-edit-reps"
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

export default HistoryViewer;
