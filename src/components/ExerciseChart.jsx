import { useEffect, useRef, useState, useMemo } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "../firebase/config";
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
// import CalcInfoModal from "./CalcInfoModal";

ChartJS.register(TimeScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const pad2 = (n) => String(n).padStart(2, "0");
const dateKeyLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const midnightLocal = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const ExerciseChart = ({ user, onBack }) => {
  const [allPairs, setAllPairs] = useState([]);
  const [muscleGroup, setMuscleGroup] = useState("");
  const [exercise, setExercise] = useState("");
  const [exerciseOptions, setExerciseOptions] = useState([]);
  const [pointsByDay, setPointsByDay] = useState([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalSeries, setModalSeries] = useState([]);
  const [modalDate, setModalDate] = useState(new Date());

  const [openDetailIndex, setOpenDetailIndex] = useState(null);

  // Dropdown states & refs (mismo patrón que ExerciseForm)
  const [openGroupSug, setOpenGroupSug] = useState(false);
  const [openExSug, setOpenExSug] = useState(false);
  const groupSugRef = useRef(null);
  const exSugRef = useRef(null);

  // Sugerencias únicas
  const groupSuggestions = useMemo(
    () => [...new Set(allPairs.map((p) => p.muscleGroup))].sort(),
    [allPairs]
  );

  const filteredGroupSuggestions = useMemo(() => {
    const q = (muscleGroup || "").toLowerCase().trim();
    if (!q) return groupSuggestions.slice(0, 20);
    return groupSuggestions
      .filter((g) => (g || "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [muscleGroup, groupSuggestions]);

  const filteredExerciseSuggestions = useMemo(() => {
    const q = (exercise || "").toLowerCase().trim();
    if (!q) return exerciseOptions.slice(0, 20);
    return exerciseOptions
      .filter((e) => (e || "").toLowerCase().includes(q))
      .slice(0, 20);
  }, [exercise, exerciseOptions]);

  const mgRef = useRef(null);
  const exRef = useRef(null);

  const row = { display: "flex", alignItems: "center", gap: "12px" };
  const comboRow = {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto auto 1fr auto", // Label, Input, X, Label, Input, X
    alignItems: "center",
    columnGap: "12px",
  };
  const input = {
    flex: 1,
    boxSizing: "border-box",
    height: 36,
    lineHeight: "36px",
    padding: "0 10px",
    fontSize: "0.9rem",
    borderRadius: "10px",
    border: "1px solid #ccc",
    WebkitAppearance: "none",
    appearance: "none",
    transform: "translateY(8px)", // baja 8px el cuadro para alinear el eje
  };
  const clearBtn = {
    flexShrink: 0,
    boxSizing: "border-box",
    background: "#eee",
    border: "1px solid #ccc",
    fontSize: "0.9rem",
    cursor: "pointer",
    padding: "0 10px",
    borderRadius: "10px",
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  };
  const panel = {
    background: "rgba(122, 134, 204, 0.5)",
    border: "1px solid #e6e56f",
    borderRadius: "10px",
    padding: "10px",
    marginTop: "6px",
    marginBottom: "8px",
  };
  const leftLabel = {
    fontWeight: "bold",
    fontSize: "0.9rem",
    minWidth: "72px",
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    height: 36,
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
    if (!muscleGroup) {
      setExerciseOptions([...new Set(allPairs.map((p) => p.exercise))].sort());
      return;
    }
    const opts = allPairs.filter((p) => p.muscleGroup === muscleGroup).map((p) => p.exercise);
    setExerciseOptions([...new Set(opts)].sort());
  }, [muscleGroup, allPairs]);

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
            ok: !!ts && typeof d.weight === "number",
            timestamp: ts,
            weight: d.weight,
            reps: d.reps,
          };
        }).filter(r => r.ok);

        const buckets = new Map();
        rows.forEach((r) => {
          const key = dateKeyLocal(r.timestamp);
          if (!buckets.has(key)) {
            buckets.set(key, []);
          }
          buckets.get(key).push(r);
        });

        const points = [];
        for (let [key, series] of buckets) {
          const validSeries = series.map(s => ({
            weight: typeof s.weight === "number" ? s.weight : 0,
            reps: typeof s.reps === "number" ? s.reps : 10
          }));

          const totalReps = validSeries.reduce((sum, s) => sum + s.reps, 0);
          const totalWeight = validSeries.reduce((sum, s) => sum + s.weight, 0);
          const weightAvg = validSeries.length > 0 ? totalWeight / validSeries.length : 0;
          const powerScore = Math.round(weightAvg * totalReps);

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

  useEffect(() => {
    function handle(e) {
      if (groupSugRef.current && !groupSugRef.current.contains(e.target)) setOpenGroupSug(false);
      if (exSugRef.current && !exSugRef.current.contains(e.target)) setOpenExSug(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const chartData = {
    datasets: [
      {
        label: "Power Score",
        data: pointsByDay,
        borderWidth: 2,
        borderColor: "#007bff",
        backgroundColor: "#007bff44",
        tension: 0.2,
        pointRadius: 4,
        spanGaps: true,
        parsing: false,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    animation: false,
    scales: {
      x: {
        type: "time",
        time: {
          unit: "day",
          tooltipFormat: "dd/MM/yyyy",
          displayFormats: { day: "dd/MM/yyyy" },
        },
        title: { display: true, text: "Fecha" },
      },
      y: {
        title: { display: true, text: "Power Score" },
        beginAtZero: false,
      },
    },
    plugins: {
      legend: { display: true },
      tooltip: {
        callbacks: {
          label: (ctx) => `Power Score: ${ctx.parsed.y}`,
          afterBody: (items) => {
            const d = items[0]?.raw;
            return d?.repsAvg ? [`Reps medias: ${d.repsAvg}`] : [];
          },
        },
      },
    },
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1rem" }}>
      <button onClick={onBack} style={{ marginBottom: "1rem" }}>← Volver</button>
      <h2>Progreso</h2>

      {/* Selector superior eliminado: se usa la lista agrupada de abajo */}

      {/* Gráfica */}
      {loading && <p>Cargando datos…</p>}
      {!loading && pointsByDay.length > 0 && (
        <>
          <div style={{ marginTop: "1rem" }}>
            <Line data={chartData} options={chartOptions} />
          </div>
          <div style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
            <strong>Puntos calculados</strong>
            <ul>
              {pointsByDay.map((p, i) => {
                const isOpen = openDetailIndex === i;
                return (
                  <li key={i} style={{ marginBottom: isOpen ? "0.5rem" : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1 }}>
                        {new Date(p.x).toLocaleDateString()} — Power Score: {p.powerScore} — {p.repsAvg ?? "-"} reps
                      </span>
                      <button
                        onClick={() => setOpenDetailIndex(isOpen ? null : i)}
                        style={{
                          border: "none",
                          background: "none",
                          cursor: "pointer",
                          verticalAlign: "middle",
                        }}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? "Ocultar detalle" : "Mostrar detalle"}
                        title={isOpen ? "Ocultar detalle" : "Mostrar detalle"}
                      >
                        <Info size={16} color="#007bff" />
                      </button>
                    </div>

                    {isOpen && (
                      <div style={{
                        border: "1px solid #e5e5e5",
                        borderRadius: 8,
                        padding: "6px 8px",
                        marginTop: 6,
                        background: "#fafafa",
                      }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: "left", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Hora</th>
                              <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Peso (kg)</th>
                              <th style={{ textAlign: "right", padding: "4px 6px", borderBottom: "1px solid #e5e5e5" }}>Reps</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...p.series]
                              .sort((a, b) => (a.timestamp?.getTime?.() || 0) - (b.timestamp?.getTime?.() || 0))
                              .map((s, idx) => (
                                <tr key={idx}>
                                  <td style={{ padding: "4px 6px", borderBottom: "1px solid #f0f0f0" }}>
                                    {s.timestamp ? s.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}
                                  </td>
                                  <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{s.weight ?? "-"}</td>
                                  <td style={{ padding: "4px 6px", textAlign: "right", borderBottom: "1px solid #f0f0f0" }}>{s.reps ?? "-"}</td>
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
        </>
      )}

      {/* Lista agrupada por grupo muscular */}
      {allPairs.length > 0 && (
        <div style={{ marginTop: "1.25rem" }}>
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
              <details key={group} style={{ marginBottom: "0.75rem" }}>
                <summary style={{ fontWeight: "bold", fontSize: "1.05rem", cursor: "pointer" }}>
                  {group}
                </summary>
                <ul style={{ listStyle: "none", paddingLeft: "1rem", marginTop: "0.5rem" }}>
                  {exercises.map((name) => (
                    <li key={`${group}||${name}`} style={{ marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setMuscleGroup(group === "Sin grupo" ? "" : group);
                          setExercise(name);
                          setOpenGroupSug(false);
                          setOpenExSug(false);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        style={{
                          background: "transparent",
                          border: "1px solid #ddd",
                          borderRadius: 6,
                          padding: "6px 10px",
                          cursor: "pointer",
                          width: "100%",
                          textAlign: "left",
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