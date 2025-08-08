import { useEffect, useState } from "react";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { Line } from "react-chartjs-2";
import "chart.js/auto";
import "chartjs-adapter-date-fns";

const ExerciseChart = ({ user, onBack }) => {
  const [data, setData] = useState([]);
  const [exercise, setExercise] = useState("");
  // Estado para guardar la lista de ejercicios con su grupo muscular
  const [exercises, setExercises] = useState([]);

  // Obtener lista de ejercicios únicos con su grupo muscular
  useEffect(() => {
    if (!user) return;

    const fetchExercises = async () => {
      const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          name: data.exercise,
          group: data.classification || "Sin clasificar",
        };
      });

      // Eliminar duplicados por nombre y clasificación
      const uniqueMap = new Map();
      items.forEach((item) => {
        uniqueMap.set(item.name, item);
      });
      setExercises(Array.from(uniqueMap.values()).sort((a, b) => a.group.localeCompare(b.group)));
    };

    fetchExercises();
  }, [user]);

  // Obtener los pesos históricos del ejercicio seleccionado
  useEffect(() => {
    if (!exercise || !user) return;

    const fetchData = async () => {
      const q = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        where("exercise", "==", exercise),
        orderBy("timestamp", "asc")
      );
      const snapshot = await getDocs(q);
      const entries = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          x: d.timestamp.toDate ? d.timestamp.toDate() : new Date(d.timestamp),
          y: d.weight,
        };
      });
      setData(entries);
    };

    fetchData();
  }, [exercise, user]);

  const chartData = {
    datasets: [
      {
        label: `${exercise} - Evolución`,
        data,
        borderColor: "rgb(75, 192, 192)",
        tension: 0.2,
        fill: false,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    scales: {
      x: {
        type: "time",
        time: {
          unit: "day",
          tooltipFormat: "dd/MM/yyyy",
        },
        title: {
          display: true,
          text: "Fecha",
        },
      },
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: "Peso (kg)",
        },
      },
    },
  };

  return (
    <div style={{ maxWidth: "600px", margin: "2rem auto", textAlign: "center" }}>
      <h2>Gráfica de Progreso</h2>

      <select
        value={exercise}
        onChange={(e) => setExercise(e.target.value)}
        style={{ padding: "8px", width: "100%", marginBottom: "1rem" }}
      >
        <option value="">Selecciona un ejercicio</option>
        {Array.from(
          exercises.reduce((acc, { name, group }) => {
            if (!acc.has(group)) acc.set(group, []);
            acc.get(group).push(name);
            return acc;
          }, new Map())
        ).map(([group, names]) => (
          <optgroup key={group} label={group}>
            {names.map((name, i) => (
              <option key={i} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {data.length > 0 ? (
        <Line data={chartData} options={chartOptions} />
      ) : (
        exercise && <p>No hay datos registrados para este ejercicio.</p>
      )}

      <button onClick={onBack} style={{ marginTop: "1.5rem", padding: "10px" }}>
        Volver al registro
      </button>
    </div>
  );
};

export default ExerciseChart;
