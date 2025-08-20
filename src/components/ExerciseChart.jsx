import { useEffect, useRef, useState } from "react";
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
import CalcInfoModal from "./CalcInfoModal";

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

  const mgRef = useRef(null);
  const exRef = useRef(null);

  const row = { display: "flex", alignItems: "center", gap: "6px", marginBottom: "0.5rem" };
  const input = { flex: 1, padding: "16px", fontSize: "1.1rem", borderRadius: "8px", border: "1px solid #ccc" };
  const clearBtn = { flexShrink: 0, background: "#eee", border: "none", fontSize: "1.1rem", cursor: "pointer", padding: "8px 10px", borderRadius: "6px", lineHeight: 1 };

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
          const repsValid = series.filter(s => typeof s.reps === "number");
          const weightValid = series.filter(s => typeof s.weight === "number");

          const repsAvg = repsValid.length > 0
            ? Math.round(repsValid.reduce((sum, s) => sum + s.reps, 0) / repsValid.length)
            : 10;

          const pesoPonderado = weightValid.length > 0
            ? Math.round(
              weightValid.reduce((sum, s) => sum + s.weight * (s.reps || 10), 0) /
              weightValid.reduce((sum, s) => sum + (s.reps || 10), 0) * 10
            ) / 10
            : null;

          const first = series[0];
          points.push({
            x: midnightLocal(first.timestamp).getTime(),
            y: pesoPonderado,
            repsAvg,
            series,
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

  const chartData = {
    datasets: [
      {
        label: "Peso medio ponderado (kg)",
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
        title: { display: true, text: "Peso (kg)" },
        beginAtZero: false,
      },
    },
    plugins: {
      legend: { display: true },
      tooltip: {
        callbacks: {
          label: (ctx) => `Peso: ${ctx.parsed.y} kg`,
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

      {/* Desplegables */}
      <label>Grupo muscular</label>
      <div style={row}>
        <input
          list="mg-list"
          value={muscleGroup}
          onChange={(e) => setMuscleGroup(e.target.value)}
          placeholder="Pectoral, Pierna..."
          ref={mgRef}
          style={input}
        />
        {muscleGroup && <button onClick={() => { setMuscleGroup(""); setExercise(""); }} style={clearBtn}>✕</button>}
      </div>
      <datalist id="mg-list">
        {[...new Set(allPairs.map(p => p.muscleGroup))].sort().map((g, i) => (
          <option key={i} value={g} />
        ))}
      </datalist>

      <label>Ejercicio</label>
      <div style={row}>
        <input
          list="ex-list"
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          placeholder="Press banca, Sentadilla..."
          ref={exRef}
          style={input}
        />
        {exercise && <button onClick={() => setExercise("")} style={clearBtn}>✕</button>}
      </div>
      <datalist id="ex-list">
        {exerciseOptions.map((e, i) => <option key={i} value={e} />)}
      </datalist>

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
              {pointsByDay.map((p, i) => (
                <li key={i}>
                  {new Date(p.x).toLocaleDateString()} — {p.y} kg — {p.repsAvg ?? "-"} reps{" "}
                  <button
                    onClick={() => {
                      setModalSeries(p.series);
                      setModalDate(new Date(p.x));
                      setModalOpen(true);
                    }}
                    style={{
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      verticalAlign: "middle",
                    }}
                  >
                    <Info size={16} color="#007bff" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* Tabla */}
      {allPairs.length > 0 && (
        <>
          <hr style={{ margin: "2rem 0" }} />
          <h3>Acceso rápido a ejercicios</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px", borderBottom: "1px solid #ccc" }}>Grupo muscular</th>
                <th style={{ textAlign: "left", padding: "6px", borderBottom: "1px solid #ccc" }}>Ejercicio</th>
                <th style={{ padding: "6px", borderBottom: "1px solid #ccc" }}>Seleccionar</th>
              </tr>
            </thead>
            <tbody>
              {allPairs.map((p, i) => (
                <tr key={i}>
                  <td style={{ padding: "6px", borderBottom: "1px solid #eee" }}>{p.muscleGroup}</td>
                  <td style={{ padding: "6px", borderBottom: "1px solid #eee" }}>{p.exercise}</td>
                  <td style={{ textAlign: "center", padding: "6px", borderBottom: "1px solid #eee" }}>
                    <button
                      onClick={() => {
                        setMuscleGroup(p.muscleGroup);
                        setExercise(p.exercise);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      style={{
                        padding: "6px 10px",
                        fontSize: "14px",
                        background: "#f0f0f0",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Ver gráfica
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Modal */}
      <CalcInfoModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        muscleGroup={muscleGroup}
        exercise={exercise}
        date={modalDate}
        series={modalSeries}
      />
    </div>
  );
};

export default ExerciseChart;