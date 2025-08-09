// src/components/ExerciseChart.jsx
import { useEffect, useRef, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "../firebase/config";

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
import { Line } from "react-chartjs-2";

ChartJS.register(TimeScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

// Helpers de fecha
const pad2 = (n) => String(n).padStart(2, "0");
const dateKeyLocal = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

  const mgRef = useRef(null);
  const exRef = useRef(null);

  const row = { display: "flex", alignItems: "center", gap: "6px", marginBottom: "0.5rem" };
  const input = { flex: 1, padding: "16px", fontSize: "1.1rem", borderRadius: "8px", border: "1px solid #ccc" };
  const clearBtn = { flexShrink: 0, background: "#eee", border: "none", fontSize: "1.1rem", cursor: "pointer", padding: "8px 10px", borderRadius: "6px", lineHeight: 1 };

  // Cargar pares (grupo, ejercicio)
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

  // Filtrar ejercicios según grupo
  useEffect(() => {
    if (!muscleGroup) {
      setExerciseOptions([...new Set(allPairs.map((p) => p.exercise))].sort());
      return;
    }
    const opts = allPairs.filter((p) => p.muscleGroup === muscleGroup).map((p) => p.exercise);
    setExerciseOptions([...new Set(opts)].sort());
  }, [muscleGroup, allPairs]);

  // Cargar datos agregados
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
            ts,
            weight: typeof d.weight === "number" ? d.weight : null,
            reps: typeof d.reps === "number" ? d.reps : null,
          };
        }).filter(r => r.ok);

        const buckets = new Map();
        rows.forEach((r) => {
          const key = dateKeyLocal(r.ts);
          if (!buckets.has(key)) {
            buckets.set(key, {
              day: midnightLocal(r.ts),
              wrSum: 0,
              repsSumForWeight: 0,
              rSum: 0,
              rCount: 0,
            });
          }
          const b = buckets.get(key);
          const repsForWeight = typeof r.reps === "number" ? r.reps : 10;
          b.wrSum += r.weight * repsForWeight;
          b.repsSumForWeight += repsForWeight;
          const repsForAvg = typeof r.reps === "number" ? r.reps : 10;
          b.rSum += repsForAvg;
          b.rCount += 1;
        });

        const points = Array.from(buckets.values())
          .map((b) => {
            const avgWeighted = b.repsSumForWeight > 0 ? Number((b.wrSum / b.repsSumForWeight).toFixed(1)) : null;
            const repsAvg = b.rCount > 0 ? Math.round(b.rSum / b.rCount) : null;
            return { x: b.day, y: avgWeighted, repsAvg };
          })
          .filter((p) => p.y !== null)
          .sort((a, b) => a.x - b.x);

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

  // Limpiar selects
  const clearMuscleGroup = () => {
    setMuscleGroup("");
    setExercise("");
    setExerciseOptions([...new Set(allPairs.map((p) => p.exercise))].sort());
    setPointsByDay([]);
    requestAnimationFrame(() => mgRef.current?.focus());
  };
  const clearExercise = () => {
    setExercise("");
    setPointsByDay([]);
    requestAnimationFrame(() => exRef.current?.focus());
  };

  // Dataset y opciones
  const chartData = {
    datasets: [
      {
        label: "Peso medio ponderado (kg)",
        data: pointsByDay,
        borderWidth: 2,
        tension: 0.2,
        pointRadius: 4,
        spanGaps: true,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    parsing: false,
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
        min: pointsByDay.length ? pointsByDay[0].x : undefined,
        max: pointsByDay.length ? pointsByDay[pointsByDay.length - 1].x : undefined,
      },
      y: {
        title: { display: true, text: "Peso medio ponderado (kg)" },
        beginAtZero: false,
      },
    },
    plugins: {
      legend: { display: true },
      tooltip: {
        mode: "index",
        intersect: false,
        callbacks: {
          title: (items) => {
            const x = items?.[0]?.parsed?.x;
            return x ? new Date(x).toLocaleDateString() : "";
          },
          label: (ctx) => {
            const val = ctx.parsed?.y;
            return `Peso medio: ${val} kg`;
          },
          afterBody: (items) => {
            const dp = items?.[0]?.raw;
            if (dp?.repsAvg != null) return [`Reps medias: ${dp.repsAvg}`];
            return [];
          },
        },
      },
    },
  };

  const repsLabelPlugin = {
    id: "repsLabelPlugin",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const ds = chart.data.datasets?.[0];
      const meta = chart.getDatasetMeta(0);
      if (!ds || !meta) return;
      ctx.save();
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#444";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      meta.data.forEach((elem, i) => {
        const raw = ds.data?.[i];
        const reps = raw?.repsAvg;
        if (reps == null) return;
        const { x, y } = elem.tooltipPosition();
        ctx.fillText(`${reps}`, x, y - 6);
      });
      ctx.restore();
    },
  };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1rem" }}>
      <button onClick={onBack} style={{ marginBottom: "1rem" }}>← Volver</button>
      <h2 style={{ marginBottom: "1rem" }}>Progreso</h2>

      {/* Grupo muscular */}
      <label htmlFor="mg">Grupo muscular</label>
      <div style={row}>
        <input
          id="mg"
          list="mg-list"
          value={muscleGroup}
          onChange={(e) => setMuscleGroup(e.target.value)}
          placeholder="Pectoral, Pierna, Espalda…"
          ref={mgRef}
          style={input}
        />
        {muscleGroup && (
          <button type="button" onClick={clearMuscleGroup} style={clearBtn}>✕</button>
        )}
      </div>
      <datalist id="mg-list">
        {[...new Set(allPairs.map((p) => p.muscleGroup))].sort().map((g, i) => (
          <option key={i} value={g} />
        ))}
      </datalist>

      {/* Ejercicio */}
      <label htmlFor="ex">Ejercicio</label>
      <div style={row}>
        <input
          id="ex"
          list="ex-list"
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          placeholder="Escribe o selecciona"
          ref={exRef}
          style={input}
        />
        {exercise && (
          <button type="button" onClick={clearExercise} style={clearBtn}>✕</button>
        )}
      </div>
      <datalist id="ex-list">
        {exerciseOptions.map((ex, i) => (
          <option key={i} value={ex} />
        ))}
      </datalist>

      {/* Estado / Gráfica */}
      {loading && <p>Cargando datos…</p>}
      {!loading && muscleGroup && exercise && pointsByDay.length === 0 && <p>No hay registros para este ejercicio.</p>}
      {!loading && pointsByDay.length > 0 && (
        <>
          <div style={{ marginTop: "1rem" }}>
            <Line data={chartData} options={chartOptions} plugins={[repsLabelPlugin]} />
          </div>
          <div style={{ marginTop: "1rem", fontSize: "0.9rem", color: "#555" }}>
            <strong>Puntos calculados:</strong>
            <ul style={{ marginTop: "0.25rem" }}>
              {pointsByDay.map((p, i) => (
                <li key={i}>
                  {p.x.toLocaleDateString()} — {p.y} kg — {p.repsAvg ?? "-"} reps
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default ExerciseChart;
