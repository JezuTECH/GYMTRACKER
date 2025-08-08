import { useState } from "react";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

const HistoryViewer = ({ user }) => {
  const [selectedDate, setSelectedDate] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchRecords = async (date) => {
    if (!user || !date) return;
    setLoading(true);

    try {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);

      const q = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        orderBy("timestamp", "asc")
      );

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => {
        const d = doc.data();
        const ts = d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000) : null;
        return {
          muscleGroup: d.muscleGroup || "-",
          exercise: d.exercise || "-",
          weight: d.weight ?? "-",
          timestamp: ts,
        };
      }).filter((rec) => {
        return rec.timestamp && rec.timestamp >= start && rec.timestamp < end;
      });

      setRecords(data);
    } catch (error) {
      console.error("Error al recuperar registros:", error);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e) => {
    const date = e.target.value;
    setSelectedDate(date);
    fetchRecords(date);
  };

  return (
    <div style={{ maxWidth: "600px", margin: "2rem auto", padding: "1rem" }}>
      <h2>Historial Diario de Ejercicios</h2>

      <label htmlFor="date">Selecciona una fecha:</label>
      <input
        type="date"
        id="date"
        value={selectedDate}
        onChange={handleDateChange}
        style={{ display: "block", width: "100%", padding: "10px", margin: "1rem 0" }}
      />

      {loading ? (
        <p>Cargando registros...</p>
      ) : records.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th>Grupo muscular</th>
              <th>Ejercicio</th>
              <th>Peso (kg)</th>
              <th>Hora</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, index) => (
              <tr key={index}>
                <td>{rec.muscleGroup}</td>
                <td>{rec.exercise}</td>
                <td style={{ textAlign: "center" }}>{rec.weight}</td>
                <td>
                  {rec.timestamp
                    ? rec.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : selectedDate ? (
        <p>No hay registros para esta fecha.</p>
      ) : null}
    </div>
  );
};

export default HistoryViewer;
