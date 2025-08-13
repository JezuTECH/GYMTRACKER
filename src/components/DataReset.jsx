import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, where, limit } from "firebase/firestore";
import { db } from "../firebase/config";

const BATCH_SIZE = 200;

const DataReset = ({ user }) => {
  const [exercises, setExercises] = useState([]);
  const [selectedExercise, setSelectedExercise] = useState("");
  const [loading, setLoading] = useState(false);

  // Obtener lista de ejercicios únicos del usuario
  useEffect(() => {
    const fetchExercises = async () => {
      if (!user) return;
      const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snapshot = await getDocs(q);
      const names = snapshot.docs.map((docSnap) => docSnap.data().exercise);
      const unique = [...new Set(names)].sort();
      setExercises(unique);
    };
    fetchExercises();
  }, [user]);

  // Util: borrar en batches un query dado
  async function deleteQueryBatches(baseQuery) {
    let removed = 0;
    do {
      const q = query(baseQuery, limit(BATCH_SIZE));
      const snap = await getDocs(q);
      if (snap.empty) {
        removed = 0;
        break;
      }
      const ids = snap.docs.map((d) => d.id);
      await Promise.all(ids.map((id) => deleteDoc(doc(db, "workouts", id))));
      removed = snap.size;
      // opcional: small pause to avoid hot loops (not strictly necessary)
      await new Promise((r) => setTimeout(r, 150));
    } while (removed > 0);
  }

  const confirmAndDeleteAll = async () => {
    if (!window.confirm("¿Estás seguro de que quieres borrar TODOS tus registros? Esta acción no se puede deshacer.")) return;
    setLoading(true);
    try {
      const baseQuery = query(collection(db, "workouts"), where("uid", "==", user.uid));
      await deleteQueryBatches(baseQuery);
      alert("Todos los registros han sido eliminados.");
    } catch (err) {
      console.error("Error borrando todos los registros:", err);
      alert("Error borrando los registros. Revisa la consola.");
    } finally {
      setLoading(false);
    }
  };

  const confirmAndDeleteExercise = async () => {
    if (!selectedExercise) return alert("Selecciona un ejercicio.");
    if (!window.confirm(`¿Borrar todos los registros del ejercicio "${selectedExercise}"? Esta acción no se puede deshacer.`)) return;
    setLoading(true);
    try {
      const baseQuery = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        where("exercise", "==", selectedExercise)
      );
      await deleteQueryBatches(baseQuery);
      alert(`Registros del ejercicio "${selectedExercise}" eliminados.`);
      setSelectedExercise("");
    } catch (err) {
      console.error("Error borrando registros del ejercicio:", err);
      alert("No se pudieron borrar los registros. Revisa la consola.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: "2rem", maxWidth: "600px", margin: "2rem auto" }}>
      <h2 style={{ color: "#a00" }}>Reseteo de datos</h2>

      <div style={{ marginBottom: "1.5rem" }}>
        <button
          onClick={confirmAndDeleteAll}
          disabled={loading}
          style={{ backgroundColor: "#a00", color: "white", padding: "10px 20px", border: "none", cursor: "pointer" }}
        >
          {loading ? "Borrando..." : "Borrar TODOS mis registros"}
        </button>
      </div>

      <div>
        <select
          value={selectedExercise}
          onChange={(e) => setSelectedExercise(e.target.value)}
          style={{ padding: "8px", marginBottom: "0.5rem", width: "100%" }}
        >
          <option value="">Selecciona un ejercicio</option>
          {exercises.map((ex, i) => (
            <option key={i} value={ex}>{ex}</option>
          ))}
        </select>

        <button
          onClick={confirmAndDeleteExercise}
          disabled={!selectedExercise || loading}
          style={{ backgroundColor: "#c00", color: "white", padding: "10px 20px", border: "none", cursor: "pointer" }}
        >
          {loading ? "Borrando..." : "Borrar registros del ejercicio seleccionado"}
        </button>
      </div>
    </div>
  );
};

export default DataReset;