import { useState, useEffect } from "react";
import { collection, deleteDoc, getDocs, query, where, doc, limit } from "firebase/firestore";
import { db } from "../firebase/config";

const BATCH_SIZE = 200;

const DangerZone = ({ user }) => {
  const [exerciseToDelete, setExerciseToDelete] = useState("");
  const [exercises, setExercises] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

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

  async function deleteQueryBatches(baseQuery) {
    let removed;
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
      await new Promise((r) => setTimeout(r, 150));
    } while (removed > 0);
  }

  const handleFullReset = async () => {
    if (!window.confirm("¿Estás seguro de que quieres borrar todos tus datos? Esta acción no se puede deshacer.")) return;

    setIsDeleting(true);
    try {
      const baseQuery = query(collection(db, "workouts"), where("uid", "==", user.uid));
      await deleteQueryBatches(baseQuery);
      alert("Todos los datos han sido eliminados.");
    } catch (err) {
      console.error("Error eliminando los datos:", err);
      alert("Error al borrar los datos. Intenta de nuevo.");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExerciseDelete = async () => {
    if (!exerciseToDelete) return alert("Debes seleccionar un ejercicio");
    if (!window.confirm(`¿Eliminar todos los registros de '${exerciseToDelete}'? Esta acción no se puede deshacer.`)) return;

    setIsDeleting(true);
    try {
      const baseQuery = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        where("exercise", "==", exerciseToDelete)
      );
      await deleteQueryBatches(baseQuery);
      alert(`Registros de '${exerciseToDelete}' eliminados.`);
      setExerciseToDelete("");
    } catch (err) {
      console.error("Error al borrar ejercicio:", err);
      alert("No se pudo borrar el ejercicio. Intenta de nuevo.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div style={{ maxWidth: "600px", margin: "2rem auto", borderTop: "1px solid red", paddingTop: "2rem" }}>
      <h2 style={{ color: "#c00", textAlign: "center" }}>Reseteo de datos</h2>

      <button onClick={handleFullReset} disabled={isDeleting} style={{ marginBottom: "2rem", padding: "10px" }}>
        {isDeleting ? "Borrando..." : "Resetear toda la base de datos"}
      </button>

      <div>
        <p>Eliminar todos los registros de un ejercicio:</p>
        <select
          value={exerciseToDelete}
          onChange={(e) => setExerciseToDelete(e.target.value)}
          style={{ width: "100%", padding: "8px", marginBottom: "0.5rem" }}
        >
          <option value="">Selecciona un ejercicio</option>
          {exercises.map((ex, i) => (
            <option key={i} value={ex}>
              {ex}
            </option>
          ))}
        </select>
        <button onClick={handleExerciseDelete} disabled={isDeleting} style={{ padding: "10px" }}>
          {isDeleting ? "Borrando..." : "Borrar ejercicio"}
        </button>
      </div>
    </div>
  );
};

export default DangerZone;