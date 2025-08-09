import { useState } from "react";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";

const HistoryViewer = ({ user, onBack }) => {
  const [selectedDate, setSelectedDate] = useState("");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchRecords = async (dateStr) => {
    if (!user || !dateStr) return;
    setLoading(true);

    try {
      const start = new Date(dateStr);
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

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map((doc) => {
        const d = doc.data();
        return {
          muscleGroup: d.muscleGroup || "-",
          exercise: d.exercise || "-",
          weight: d.weight ?? "-",
          reps: d.reps ?? "-", // NUEVO
          timestamp: d.timestamp?.seconds ? new Date(d.timestamp.seconds * 1000) : null,
        };
      });

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
    fetchRecords(date);
  };

  return (
    <div style={{ maxWidth: "600px", margin: "2rem auto", padding: "1rem" }}>
      <h2>Historial diario</h2>

      <label htmlFor="date-picker">Selecciona una fecha:</label>
      <input
        type="date"
        id="date-picker"
        value={selectedDate}
        onChange={handleDateChange}
        style={{ width: "100%", padding: "10px", margin: "0.5rem 0" }}
      />

      {loading && <p>Cargando...</p>}

      {!loading && records.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ borderBottom: "2px solid #000", padding: "0.5rem" }}>Grupo muscular</th>
              <th style={{ borderBottom: "2px solid #000", padding: "0.5rem" }}>Ejercicio</th>
              <th style={{ borderBottom: "2px solid #000", padding: "0.5rem" }}>Peso (kg)</th>
              <th style={{ borderBottom: "2px solid #000", padding: "0.5rem" }}>Reps</th>
              <th style={{ borderBottom: "2px solid #000", padding: "0.5rem" }}>Hora</th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec, idx) => (
              <tr key={idx}>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #ccc" }}>{rec.muscleGroup}</td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #ccc" }}>{rec.exercise}</td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #ccc", textAlign: "center" }}>{rec.weight}</td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #ccc", textAlign: "center" }}>{rec.reps}</td>
                <td style={{ padding: "0.5rem", borderBottom: "1px solid #ccc" }}>
                  {rec.timestamp ? rec.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && selectedDate && records.length === 0 && (
        <p>No hay registros para esta fecha.</p>
      )}

      {onBack && (
        <button onClick={onBack} style={{ marginTop: "2rem" }}>
          ← Volver
        </button>
      )}
    </div>
  );
};

export default HistoryViewer;
