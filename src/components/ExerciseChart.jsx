import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "../firebase/config";
import { Line } from "react-chartjs-2";
import { calculatePowerScore } from "../utils/calculatePowerScore";
import { isMarkedDeleted } from "../utils/isMarkedDeleted";
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
// import CalcInfoModal from "./CalcInfoModal";

ChartJS.register(TimeScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const pad2 = (n) => String(n).padStart(2, "0");
const dateKeyLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const midnightLocal = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const monthStartLocal = (value) => {
  const d = midnightLocal(value);
  d.setDate(1);
  return d;
};

const formatMonthLabel = (value) =>
  new Date(value).toLocaleDateString("es-ES", { month: "short", year: "numeric" });

const ExerciseChart = ({
  user,
  onBack,
  selectedExercise,
  onSelectExercise,
  onViewRegister,
  onViewLibrary,
}) => {
  const [allPairs, setAllPairs] = useState([]);
  const [muscleGroup, setMuscleGroup] = useState("");
  const [exercise, setExercise] = useState("");
  const [pointsByDay, setPointsByDay] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartMode, setChartMode] = useState("monthly"); // monthly | daily

  const [openDetailIndex, setOpenDetailIndex] = useState(null);
  const [openMonthDetailIndex, setOpenMonthDetailIndex] = useState(null);

  const syncSelection = (nextGroup, nextExercise) => {
    const cleanGroup = String(nextGroup || "").trim();
    const cleanExercise = String(nextExercise || "").trim();
    if (!cleanExercise) return;
    setMuscleGroup(cleanGroup);
    setExercise(cleanExercise);
    onSelectExercise?.({ muscleGroup: cleanGroup, exercise: cleanExercise });
  };

  useEffect(() => {
    if (!user) return;
    const run = async () => {
      const qAll = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snap = await getDocs(qAll);
      const seen = new Set();
      const pairs = [];
      snap.docs.forEach((doc) => {
        const d = doc.data();
        if (isMarkedDeleted(d)) return;
        const mg = d.muscleGroup || "";
        const ex = d.exercise || "";
        if (!mg || !ex) return;
        const key = `${mg}||${ex}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ muscleGroup: mg, exercise: ex });
        }
      });
      pairs.sort((a, b) => {
        const ga = a.muscleGroup.toLowerCase();
        const gb = b.muscleGroup.toLowerCase();
        if (ga !== gb) return ga.localeCompare(gb);
        return a.exercise.toLowerCase().localeCompare(b.exercise.toLowerCase());
      });
      setAllPairs(pairs);
    };
    run();
  }, [user]);

  useEffect(() => {
    if (!selectedExercise || typeof selectedExercise !== "object") return;

    const nextGroup = String(selectedExercise.muscleGroup || "").trim();
    const nextExercise = String(selectedExercise.exercise || "").trim();
    if (!nextExercise) return;

    setMuscleGroup(nextGroup);
    setExercise(nextExercise);
    setOpenDetailIndex(null);
    setOpenMonthDetailIndex(null);
  }, [selectedExercise]);

  useEffect(() => {
    setOpenDetailIndex(null);
    setOpenMonthDetailIndex(null);
  }, [chartMode]);

  useEffect(() => {
    if (!user || !muscleGroup || !exercise) {
      setPointsByDay([]);
      return;
    }
    const run = async () => {
      setLoading(true);
      try {
        const qData = query(
          collection(db, "workouts"),
          where("uid", "==", user.uid),
          where("muscleGroup", "==", muscleGroup),
          where("exercise", "==", exercise),
          orderBy("timestamp", "asc")
        );
        const snap = await getDocs(qData);

        const rows = snap.docs.map((doc) => {
          const d = doc.data();
          const ts = d.timestamp?.toDate
            ? d.timestamp.toDate()
            : (d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000) : null);
          return {
            deleted: isMarkedDeleted(d),
            ok: !!ts && typeof d.weight === "number",
            timestamp: ts,
            weight: d.weight,
            reps: d.reps,
          };
        }).filter((r) => r.ok && !r.deleted);

        const buckets = new Map();
        rows.forEach((r) => {
          const key = dateKeyLocal(r.timestamp);
          if (!buckets.has(key)) {
            buckets.set(key, []);
          }
          buckets.get(key).push(r);
        });

        const points = [];
        for (const series of buckets.values()) {
          const validSeries = series.map(s => ({
            weight: typeof s.weight === "number" ? s.weight : 0,
            reps: typeof s.reps === "number" ? s.reps : 10
          }));

          const totalReps = validSeries.reduce((sum, s) => sum + s.reps, 0);
          const powerScore = calculatePowerScore(validSeries);

          const first = series[0];
          points.push({
            x: midnightLocal(first.timestamp).getTime(),
            y: powerScore,
            repsAvg: Math.round(totalReps / series.length),
            series,
            powerScore,
          });
        }

        points.sort((a, b) => a.x - b.x);
        setPointsByDay(points);
      } catch (e) {
        console.error("Error leyendo datos de la gráfica:", e);
        setPointsByDay([]);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [user, muscleGroup, exercise]);

  const isMonthlyMode = chartMode === "monthly";

  const chartPoints = useMemo(() => {
    if (!isMonthlyMode) return pointsByDay;

    const monthlyBuckets = new Map();
    pointsByDay.forEach((point) => {
      const start = monthStartLocal(point.x);
      const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
      if (!monthlyBuckets.has(key)) {
        monthlyBuckets.set(key, { start, items: [] });
      }
      monthlyBuckets.get(key).items.push(point);
    });

    return Array.from(monthlyBuckets.values())
      .map(({ start, items }) => {
        const monthlyPower = Math.round(
          items.reduce((acc, p) => acc + (Number(p.powerScore) || 0), 0) / items.length
        );
        const monthlyReps = Math.round(
          items.reduce((acc, p) => acc + (Number(p.repsAvg) || 0), 0) / items.length
        );
        return {
          x: start.getTime(),
          y: monthlyPower,
          powerScore: monthlyPower,
          repsAvg: monthlyReps,
          monthStart: start,
          samples: items.length,
          items: items.slice().sort((a, b) => a.x - b.x),
        };
      })
      .sort((a, b) => a.x - b.x);
  }, [isMonthlyMode, pointsByDay]);

  const chartData = useMemo(
    () => ({
      datasets: [
        {
          label: isMonthlyMode ? "PowerScore mensual (promedio)" : "PowerScore diario",
          data: chartPoints,
          borderWidth: isMonthlyMode ? 3 : 2,
          borderColor: "#2a62ff",
          backgroundColor: isMonthlyMode ? "rgba(42, 98, 255, 0.20)" : "#2a62ff44",
          fill: isMonthlyMode,
          tension: isMonthlyMode ? 0.3 : 0.2,
          pointRadius: isMonthlyMode ? 0 : 4,
          spanGaps: true,
          parsing: false,
        },
      ],
    }),
    [chartPoints, isMonthlyMode]
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
          title: { display: true, text: "PowerScore" },
          beginAtZero: false,
        },
      },
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              isMonthlyMode
                ? `PowerScore medio: ${ctx.parsed.y}`
                : `PowerScore: ${ctx.parsed.y}`,
            afterBody: (items) => {
              const d = items[0]?.raw;
              if (!d) return [];
              if (isMonthlyMode) {
                const month = d.monthStart ? formatMonthLabel(d.monthStart) : "Mes";
                const sessions = d.samples ? `Sesiones: ${d.samples}` : null;
                return [month, sessions].filter(Boolean);
              }
              return d?.repsAvg ? [`Reps medias: ${d.repsAvg}`] : [];
            },
          },
        },
      },
    }),
    [isMonthlyMode]
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
            <button
              type="button"
              onClick={() => {
                syncSelection(muscleGroup, exercise);
                onViewRegister?.();
              }}
            >
              Ir a registro
            </button>
            <button
              type="button"
              onClick={() => {
                syncSelection(muscleGroup, exercise);
                onViewLibrary?.();
              }}
            >
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

      {/* Selector superior eliminado: se usa la lista agrupada de abajo */}

      {/* Gráfica */}
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
                {chartPoints.map((point, i) => (
                  <li className={`chart-point-item${openMonthDetailIndex === i ? " is-open" : ""}`} key={`m-${i}`}>
                    <div className="chart-point-row">
                      <button
                        type="button"
                        className="chart-point-toggle"
                        onClick={() => setOpenMonthDetailIndex(openMonthDetailIndex === i ? null : i)}
                        aria-expanded={openMonthDetailIndex === i}
                        aria-label={openMonthDetailIndex === i ? "Ocultar detalle del mes" : "Mostrar detalle del mes"}
                      >
                        <span className="chart-point-text">
                          {formatMonthLabel(point.monthStart)}
                        </span>
                        <strong>{point.powerScore}</strong>
                      </button>
                    </div>
                    {openMonthDetailIndex === i && (
                      <div className="chart-detail-card">
                        <p className="chart-month-meta">
                          Sesiones: <strong>{point.samples || 0}</strong> · Reps medias:{" "}
                          <strong>{point.repsAvg ?? "-"}</strong>
                        </p>
                        <table className="chart-detail-table">
                          <thead>
                            <tr>
                              <th>Día</th>
                              <th>PowerScore</th>
                              <th>Reps medias</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(point.items || [])
                              .slice()
                              .sort((a, b) => b.x - a.x)
                              .map((dayPoint, idx) => (
                                <tr key={`${point.x}-${idx}`}>
                                  <td>{new Date(dayPoint.x).toLocaleDateString("es-ES")}</td>
                                  <td>{dayPoint.powerScore ?? "-"}</td>
                                  <td>{dayPoint.repsAvg ?? "-"}</td>
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
                {chartPoints.map((p, i) => {
                  const isOpen = openDetailIndex === i;
                  return (
                    <li className={`chart-point-item${isOpen ? " is-open" : ""}`} key={i}>
                      <div className="chart-point-row">
                        <span className="chart-point-text">
                          {new Date(p.x).toLocaleDateString()} — PowerScore: {p.powerScore} — {p.repsAvg ?? "-"} reps
                        </span>
                        <button
                          className="chart-info-btn"
                          onClick={() => setOpenDetailIndex(isOpen ? null : i)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? "Ocultar detalle" : "Mostrar detalle"}
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
                                <th>Peso (kg)</th>
                                <th>Reps</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...p.series]
                                .sort((a, b) => (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0))
                                .map((s, idx) => (
                                  <tr key={idx}>
                                    <td>
                                      {s.timestamp ? s.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}
                                    </td>
                                    <td>{s.weight ?? "-"}</td>
                                    <td>{s.reps ?? "-"}</td>
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

      {/* Lista agrupada por grupo muscular */}
      {allPairs.length > 0 && (
        <div className="chart-summary">
          <h3>Resumen de ejercicios</h3>
          {Object.entries(
            allPairs.reduce((acc, p) => {
              const g = p.muscleGroup || "Sin grupo";
              if (!acc[g]) acc[g] = new Set();
              acc[g].add(p.exercise);
              return acc;
            }, {})
          ).map(([group, setEx]) => {
            const exercises = Array.from(setEx).sort((a, b) => a.localeCompare(b));
            return (
              <details className="chart-group" key={group}>
                <summary className="chart-group-title">
                  {group}
                </summary>
                <ul className="chart-group-list">
                  {exercises.map((name) => (
                    <li key={`${group}||${name}`}>
                      <button
                        className="chart-group-btn"
                        type="button"
                        onClick={() => {
                          syncSelection(group === "Sin grupo" ? "" : group, name);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}
        </div>
      )}

      {/* Modal eliminado: ahora el detalle se despliega inline bajo cada día */}
    </div>
  );
};

export default ExerciseChart;
