import { useEffect, useMemo, useState } from "react";
import { collection, orderBy, query, where } from "firebase/firestore";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  TimeScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { Info } from "lucide-react";
import { db } from "../firebase/config";
import { getDocsWithFreshAuth } from "../firebase/firestoreRetry";
import { listUserExercises } from "../data/exerciseMaster";
import { TRACKING_MODES, buildCanonicalKey, normalizeText } from "../utils/exerciseCatalog";
import { formatDistanceKm, formatDurationMin, formatPace, getEnduranceMetrics, getStrengthMetrics } from "../utils/workoutMetrics";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";

ChartJS.register(TimeScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const toJsDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  return null;
};

const dateKeyLocal = (date) => {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
};

const midnightLocal = (value) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const monthStartLocal = (value) => {
  const date = midnightLocal(value);
  date.setDate(1);
  return date;
};

const formatMonthLabel = (value) =>
  new Date(value).toLocaleDateString("es-ES", { month: "short", year: "numeric" });

const buildSelectionKey = (entry = {}) =>
  normalizeText(entry.exerciseId) || buildCanonicalKey(entry.muscleGroup, entry.exercise);

const matchesSelection = (row = {}, option = {}) => {
  const optionId = normalizeText(option.exerciseId);
  if (optionId && normalizeText(row.exerciseId) === optionId) return true;
  return buildCanonicalKey(row.muscleGroup, row.exercise) === buildCanonicalKey(option.muscleGroup, option.exercise);
};

const mapWorkoutDoc = (snapshotDoc) => {
  const data = snapshotDoc.data();
  return {
    id: snapshotDoc.id,
    exerciseId: normalizeText(data.exerciseId),
    exercise: normalizeText(data.exercise || data.exerciseNameSnapshot),
    muscleGroup: normalizeText(data.muscleGroup || data.muscleGroupSnapshot),
    trackingMode: data.trackingModeSnapshot === TRACKING_MODES.ENDURANCE ? TRACKING_MODES.ENDURANCE : TRACKING_MODES.STRENGTH,
    weight: typeof data.weight === "number" ? data.weight : null,
    reps: typeof data.reps === "number" ? data.reps : null,
    durationMin: typeof data.durationMin === "number" ? data.durationMin : null,
    distanceKm: typeof data.distanceKm === "number" ? data.distanceKm : null,
    timestamp: toJsDate(data.timestamp),
    deleted: isMarkedDeleted(data),
  };
};

const ExerciseChart = ({
  user,
  onBack,
  selectedExercise,
  onSelectExercise,
  onViewRegister,
  onViewLibrary,
}) => {
  const [allExercises, setAllExercises] = useState([]);
  const [allWorkouts, setAllWorkouts] = useState([]);
  const [muscleGroup, setMuscleGroup] = useState("");
  const [exercise, setExercise] = useState("");
  const [chartMode, setChartMode] = useState("monthly");
  const [loading, setLoading] = useState(false);
  const [openDetailIndex, setOpenDetailIndex] = useState(null);
  const [openMonthDetailIndex, setOpenMonthDetailIndex] = useState(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const [exerciseOptions, workoutSnap] = await Promise.all([
          listUserExercises(db, user.uid),
          getDocsWithFreshAuth(query(collection(db, "workouts"), where("uid", "==", user.uid), orderBy("timestamp", "asc"))),
        ]);
        setAllExercises(exerciseOptions);
        setAllWorkouts(
          workoutSnap.docs
            .map(mapWorkoutDoc)
            .filter((row) => !row.deleted && row.timestamp)
        );
      } catch (loadErr) {
        console.error("Error leyendo datos de la gráfica:", loadErr);
        setAllExercises([]);
        setAllWorkouts([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  useEffect(() => {
    if (!selectedExercise || typeof selectedExercise !== "object") return;
    const nextGroup = normalizeText(selectedExercise.muscleGroup);
    const nextExercise = normalizeText(selectedExercise.exercise);
    if (!nextExercise) return;
    setMuscleGroup(nextGroup);
    setExercise(nextExercise);
    setOpenDetailIndex(null);
    setOpenMonthDetailIndex(null);
  }, [selectedExercise]);

  const matchedExercise = useMemo(() => {
    if (selectedExercise?.exerciseId) {
      const byId = allExercises.find((item) => item.exerciseId === selectedExercise.exerciseId);
      if (byId) return byId;
    }
    return allExercises.find(
      (item) => buildCanonicalKey(item.muscleGroup, item.exercise) === buildCanonicalKey(muscleGroup, exercise)
    ) || null;
  }, [allExercises, exercise, muscleGroup, selectedExercise]);

  const syncSelection = (nextOption) => {
    if (!nextOption?.exercise) return;
    setMuscleGroup(nextOption.muscleGroup);
    setExercise(nextOption.exercise);
    onSelectExercise?.({
      exerciseId: nextOption.exerciseId,
      muscleGroup: nextOption.muscleGroup,
      exercise: nextOption.exercise,
      trackingMode: nextOption.trackingMode,
    });
  };

  const currentRows = useMemo(() => {
    if (!exercise || !muscleGroup) return [];
    if (matchedExercise) {
      return allWorkouts.filter((row) => matchesSelection(row, matchedExercise));
    }
    const selectionKey = buildCanonicalKey(muscleGroup, exercise);
    return allWorkouts.filter((row) => buildSelectionKey(row) === selectionKey);
  }, [allWorkouts, exercise, matchedExercise, muscleGroup]);

  const trackingMode = matchedExercise?.trackingMode || TRACKING_MODES.STRENGTH;
  const hasDistanceData = useMemo(
    () => trackingMode === TRACKING_MODES.ENDURANCE && currentRows.some((row) => typeof row.distanceKm === "number" && row.distanceKm > 0),
    [currentRows, trackingMode]
  );

  const pointsByDay = useMemo(() => {
    const buckets = new Map();
    currentRows.forEach((row) => {
      const key = dateKeyLocal(row.timestamp);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(row);
    });

    return Array.from(buckets.values())
      .map((rows) => {
        const first = rows[0];
        if (trackingMode === TRACKING_MODES.ENDURANCE) {
          const metrics = getEnduranceMetrics(rows);
          return {
            x: midnightLocal(first.timestamp).getTime(),
            y: hasDistanceData ? metrics.totalDistanceKm || 0 : metrics.totalDurationMin,
            rows,
            totalDurationMin: metrics.totalDurationMin,
            totalDistanceKm: metrics.totalDistanceKm,
            paceMinPerKm: metrics.paceMinPerKm,
            averageSpeedKmh: metrics.averageSpeedKmh,
          };
        }

        const metrics = getStrengthMetrics(rows);
        return {
          x: midnightLocal(first.timestamp).getTime(),
          y: metrics.powerScore,
          rows,
          powerScore: metrics.powerScore,
          averageWeight: metrics.averageWeight,
          averageReps: metrics.averageReps,
        };
      })
      .sort((left, right) => left.x - right.x);
  }, [currentRows, hasDistanceData, trackingMode]);

  const isMonthlyMode = chartMode === "monthly";

  const chartPoints = useMemo(() => {
    if (!isMonthlyMode) return pointsByDay;

    const monthlyBuckets = new Map();
    pointsByDay.forEach((point) => {
      const start = monthStartLocal(point.x);
      const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyBuckets.has(key)) monthlyBuckets.set(key, { start, items: [] });
      monthlyBuckets.get(key).items.push(point);
    });

    return Array.from(monthlyBuckets.values())
      .map(({ start, items }) => {
        if (trackingMode === TRACKING_MODES.ENDURANCE) {
          const totalDurationMin = items.reduce((sum, item) => sum + (item.totalDurationMin || 0), 0);
          const totalDistanceKm = items.reduce((sum, item) => sum + (item.totalDistanceKm || 0), 0);
          return {
            x: start.getTime(),
            y: hasDistanceData ? Number(totalDistanceKm.toFixed(2)) : totalDurationMin,
            monthStart: start,
            samples: items.length,
            totalDurationMin,
            totalDistanceKm: hasDistanceData ? Number(totalDistanceKm.toFixed(2)) : null,
            items,
          };
        }

        const averagePower = Math.round(items.reduce((sum, item) => sum + (item.powerScore || 0), 0) / items.length);
        const averageReps = Math.round(items.reduce((sum, item) => sum + (item.averageReps || 0), 0) / items.length);
        return {
          x: start.getTime(),
          y: averagePower,
          monthStart: start,
          samples: items.length,
          powerScore: averagePower,
          averageReps,
          items,
        };
      })
      .sort((left, right) => left.x - right.x);
  }, [hasDistanceData, isMonthlyMode, pointsByDay, trackingMode]);

  const yAxisLabel = useMemo(() => {
    if (trackingMode === TRACKING_MODES.ENDURANCE) {
      return hasDistanceData ? "Distancia (km)" : "Minutos";
    }
    return "PowerScore";
  }, [hasDistanceData, trackingMode]);

  const chartData = useMemo(
    () => ({
      datasets: [
        {
          label:
            trackingMode === TRACKING_MODES.ENDURANCE
              ? isMonthlyMode
                ? hasDistanceData
                  ? "Distancia mensual"
                  : "Minutos mensuales"
                : hasDistanceData
                  ? "Distancia diaria"
                  : "Minutos diarios"
              : isMonthlyMode
                ? "PowerScore mensual (promedio)"
                : "PowerScore diario",
          data: chartPoints,
          borderWidth: isMonthlyMode ? 3 : 2,
          borderColor: trackingMode === TRACKING_MODES.ENDURANCE ? "#0f766e" : "#2a62ff",
          backgroundColor:
            trackingMode === TRACKING_MODES.ENDURANCE
              ? "rgba(15, 118, 110, 0.18)"
              : isMonthlyMode
                ? "rgba(42, 98, 255, 0.20)"
                : "#2a62ff44",
          fill: isMonthlyMode,
          tension: isMonthlyMode ? 0.3 : 0.2,
          pointRadius: isMonthlyMode ? 0 : 4,
          spanGaps: true,
          parsing: false,
        },
      ],
    }),
    [chartPoints, hasDistanceData, isMonthlyMode, trackingMode]
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      animation: false,
      scales: {
        x: {
          type: "time",
          display: !isMonthlyMode,
          grid: { display: !isMonthlyMode },
          ticks: { display: !isMonthlyMode },
          time: {
            unit: "day",
            tooltipFormat: "dd/MM/yyyy",
            displayFormats: { day: "dd/MM/yyyy" },
          },
          title: { display: !isMonthlyMode, text: "Fecha" },
        },
        y: {
          title: { display: true, text: yAxisLabel },
          beginAtZero: false,
        },
      },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: (context) => `${yAxisLabel}: ${context.parsed.y}`,
            afterBody: (items) => {
              const point = items[0]?.raw;
              if (!point) return [];
              if (trackingMode === TRACKING_MODES.ENDURANCE) {
                const lines = [formatDurationMin(point.totalDurationMin)];
                if (point.totalDistanceKm != null) lines.push(formatDistanceKm(point.totalDistanceKm));
                if (point.paceMinPerKm != null) lines.push(formatPace(point.paceMinPerKm));
                return lines;
              }
              return [
                point.averageWeight != null ? `Peso medio: ${point.averageWeight} kg` : null,
                point.averageReps != null ? `Reps medias: ${point.averageReps}` : null,
              ].filter(Boolean);
            },
          },
        },
      },
    }),
    [isMonthlyMode, trackingMode, yAxisLabel]
  );

  return (
    <div className="exercise-chart-shell chart-page">
      <button className="chart-back" onClick={onBack}>← Volver</button>
      <h2>Progreso</h2>
      {exercise ? (
        <section className="chart-active-selection">
          <span>Mostrando ahora</span>
          <strong>{muscleGroup || "Sin grupo"} · {exercise}</strong>
          <div className="chart-active-actions">
            <button type="button" onClick={() => onViewRegister?.()}>
              Ir a registro
            </button>
            <button type="button" onClick={() => onViewLibrary?.()}>
              Ver ficha
            </button>
          </div>
        </section>
      ) : (
        <p className="chart-selection-empty">Selecciona un ejercicio para ver su progreso.</p>
      )}
      <div className="chart-mode-switch">
        <button
          type="button"
          className={`chart-mode-btn${isMonthlyMode ? " is-active" : ""}`}
          onClick={() => setChartMode("monthly")}
        >
          Vista rápida mensual
        </button>
        <button
          type="button"
          className={`chart-mode-btn${!isMonthlyMode ? " is-active" : ""}`}
          onClick={() => setChartMode("daily")}
        >
          Vista detalle diaria
        </button>
      </div>

      {loading && <p className="chart-loading">Cargando datos…</p>}
      {!loading && chartPoints.length > 0 && (
        <>
          <div className="chart-plot">
            <Line data={chartData} options={chartOptions} />
          </div>
          {isMonthlyMode ? (
            <div className="chart-points">
              <strong>Resumen mensual</strong>
              <ul className="chart-points-list">
                {chartPoints.map((point, index) => (
                  <li className={`chart-point-item${openMonthDetailIndex === index ? " is-open" : ""}`} key={`m-${index}`}>
                    <div className="chart-point-row">
                      <button
                        type="button"
                        className="chart-point-toggle"
                        onClick={() => setOpenMonthDetailIndex(openMonthDetailIndex === index ? null : index)}
                        aria-expanded={openMonthDetailIndex === index}
                      >
                        <span className="chart-point-text">{formatMonthLabel(point.monthStart)}</span>
                        <strong>{point.y}</strong>
                      </button>
                    </div>
                    {openMonthDetailIndex === index && (
                      <div className="chart-detail-card">
                        <p className="chart-month-meta">
                          Sesiones: <strong>{point.samples || 0}</strong>
                          {trackingMode === TRACKING_MODES.ENDURANCE ? (
                            <>
                              {" "}· Minutos: <strong>{point.totalDurationMin || 0}</strong>
                              {point.totalDistanceKm != null && <> · Distancia: <strong>{formatDistanceKm(point.totalDistanceKm)}</strong></>}
                            </>
                          ) : (
                            <> · Reps medias: <strong>{point.averageReps ?? "-"}</strong></>
                          )}
                        </p>
                        <table className="chart-detail-table">
                          <thead>
                            <tr>
                              <th>Día</th>
                              <th>{yAxisLabel}</th>
                              <th>{trackingMode === TRACKING_MODES.ENDURANCE ? "Detalle" : "Promedio"}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(point.items || [])
                              .slice()
                              .sort((left, right) => right.x - left.x)
                              .map((dayPoint, rowIndex) => (
                                <tr key={`${point.x}-${rowIndex}`}>
                                  <td>{new Date(dayPoint.x).toLocaleDateString("es-ES")}</td>
                                  <td>{dayPoint.y ?? "-"}</td>
                                  <td>
                                    {trackingMode === TRACKING_MODES.ENDURANCE
                                      ? [formatDurationMin(dayPoint.totalDurationMin), dayPoint.totalDistanceKm != null ? formatDistanceKm(dayPoint.totalDistanceKm) : null]
                                        .filter(Boolean)
                                        .join(" · ")
                                      : `${dayPoint.averageWeight ?? "-"} kg · ${dayPoint.averageReps ?? "-"} reps`}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="chart-points">
              <strong>Puntos diarios</strong>
              <ul className="chart-points-list">
                {chartPoints.map((point, index) => {
                  const isOpen = openDetailIndex === index;
                  return (
                    <li className={`chart-point-item${isOpen ? " is-open" : ""}`} key={index}>
                      <div className="chart-point-row">
                        <span className="chart-point-text">
                          {new Date(point.x).toLocaleDateString("es-ES")} — {yAxisLabel}: {point.y}
                        </span>
                        <button
                          className="chart-info-btn"
                          type="button"
                          onClick={() => setOpenDetailIndex(isOpen ? null : index)}
                          aria-expanded={isOpen}
                          title={isOpen ? "Ocultar detalle" : "Mostrar detalle"}
                        >
                          <Info size={16} color="#007bff" />
                        </button>
                      </div>

                      {isOpen && (
                        <div className="chart-detail-card">
                          <table className="chart-detail-table">
                            <thead>
                              <tr>
                                <th>Hora</th>
                                {trackingMode === TRACKING_MODES.ENDURANCE ? (
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
                              </tr>
                            </thead>
                            <tbody>
                              {[...point.rows]
                                .sort((left, right) => (left.timestamp?.getTime?.() || 0) - (right.timestamp?.getTime?.() || 0))
                                .map((row, rowIndex) => (
                                  <tr key={rowIndex}>
                                    <td>{row.timestamp ? row.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}</td>
                                    {trackingMode === TRACKING_MODES.ENDURANCE ? (
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
            </div>
          )}
        </>
      )}

      {allExercises.length > 0 && (
        <div className="chart-summary">
          <h3>Resumen de ejercicios</h3>
          {Object.entries(
            allExercises.reduce((acc, item) => {
              const group = item.muscleGroup || "Sin grupo";
              if (!acc[group]) acc[group] = [];
              acc[group].push(item);
              return acc;
            }, {})
          ).map(([group, entries]) => (
            <details className="chart-group" key={group}>
              <summary className="chart-group-title">{group}</summary>
              <ul className="chart-group-list">
                {entries.map((item) => (
                  <li key={item.exerciseId || buildSelectionKey(item)}>
                    <button
                      className="chart-group-btn"
                      type="button"
                      onClick={() => {
                        syncSelection(item);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      {item.exercise}
                      {item.trackingMode === TRACKING_MODES.ENDURANCE && <span className="chart-mode-chip">Tiempo</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
};

export default ExerciseChart;
