import { useState, useEffect } from "react";
import { collection, deleteDoc, getDocs, query, where, doc } from "firebase/firestore";
import { db } from "../firebase/config";

const DangerZone = ({ user }) => {
  const [exerciseToDelete, setExerciseToDelete] = useState("");
  const [exercises, setExercises] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const fetchExercises = async () => {
      const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snapshot = await getDocs(q);
      const names = snapshot.docs.map((doc) => doc.data().exercise);
      const unique = [...new Set(names)].sort();
      setExercises(unique);
    };
    fetchExercises();
  }, [user]);

  const handleFullReset = async () => {
    if (!window.confirm("¿Estás seguro de que quieres borrar todos tus datos? Esta acción no se puede deshacer.")) return;

    setIsDeleting(true);
    try {
      const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
      const snapshot = await getDocs(q);
      const deletions = snapshot.docs.map((docSnap) => deleteDoc(doc(db, "workouts", docSnap.id)));
      await Promise.all(deletions);
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
      const q = query(
        collection(db, "workouts"),
        where("uid", "==", user.uid),
        where("exercise", "==", exerciseToDelete)
      );
      const snapshot = await getDocs(q);
      const deletions = snapshot.docs.map((docSnap) => deleteDoc(doc(db, "workouts", docSnap.id)));
      await Promise.all(deletions);
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
        Resetear toda la base de datos
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
          Borrar ejercicio
        </button>
      </div>
    </div>
  );
};

export default DangerZone;
