import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/config";

const DataReset = ({ user }) => {
  const [exercises, setExercises] = useState([]);
  const [selectedExercise, setSelectedExercise] = useState("");
  const [loading, setLoading] = useState(false);

  // Obtener lista de ejercicios únicos del usuario
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

  const confirmAndDeleteAll = async () => {
    if (!window.confirm("¿Estás seguro de que quieres borrar TODOS tus registros? Esta acción no se puede deshacer.")) return;
    setLoading(true);
    const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
    const snapshot = await getDocs(q);
    await Promise.all(snapshot.docs.map((doc) => deleteDoc(doc.ref)));
    setLoading(false);
    alert("Todos los registros han sido eliminados.");
  };

  const confirmAndDeleteExercise = async () => {
    if (!selectedExercise) return;
    if (!window.confirm(`¿Borrar todos los registros del ejercicio "${selectedExercise}"? Esta acción no se puede deshacer.`)) return;
    setLoading(true);
    const q = query(
      collection(db, "workouts"),
      where("uid", "==", user.uid),
      where("exercise", "==", selectedExercise)
    );
    const snapshot = await getDocs(q);
    await Promise.all(snapshot.docs.map((doc) => deleteDoc(doc.ref)));
    setLoading(false);
    alert(`Registros del ejercicio "${selectedExercise}" eliminados.`);
    setSelectedExercise("");
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
          Borrar TODOS mis registros
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
          Borrar registros del ejercicio seleccionado
        </button>
      </div>
    </div>
  );
};

export default DataReset;