import { useEffect, useState } from "react";
import { db } from "../firebase/config";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  Timestamp,
} from "firebase/firestore";

const PlanDay = ({ user, onBack }) => {
  const [plans, setPlans] = useState([]);
  const [todayPlan, setTodayPlan] = useState(null);
  const [editing, setEditing] = useState(false);
  const [routines, setRoutines] = useState([]);
  const [allExercises, setAllExercises] = useState([]);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);

  const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  useEffect(() => {
    const run = async () => {
      try {
        const q = query(collection(db, "workouts"), where("uid", "==", user.uid));
        const snap = await getDocs(q);
        const seen = new Set();
        const pairs = [];
        snap.forEach((doc) => {
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
        setAllExercises(pairs);
      } catch (err) {
        console.error("❌ Error cargando ejercicios para autocompletar:", err);
        setAllExercises([]); // Para evitar estado inconsistente
      } finally {
        setLoading(false); // Nos aseguramos de ocultar el spinner
      }
    };
    run();
  }, [user]);

  useEffect(() => {
    const run = async () => {
      try {
        const ref = doc(db, "plans", `${user.uid}_${todayKey}`);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          setTodayPlan(data);
          setRoutines(data.routines || []);
          setDescription(data.description || "");
          setEditing(false);
        } else {
          setTodayPlan(null);
          setRoutines([{ muscleGroup: "", exercise: "", series: "" }]);
          setDescription("");
          setEditing(true);
        }
        const plansSnap = await getDocs(query(collection(db, "plans"), where("uid", "==", user.uid)));
        const all = plansSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        all.sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
        setPlans(all);
      } catch (err) {
        console.error("❌ Error cargando planificación:", err);
        setTodayPlan(null);
        setRoutines([{ muscleGroup: "", exercise: "", series: "" }]);
        setDescription("");
        setEditing(true);
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [user, todayKey]);

  const handleChange = (i, field, value) => {
    const updated = [...routines];
    updated[i][field] = value;
    setRoutines(updated);
  };

  const addLine = () => {
    setRoutines((prev) => [...prev, { muscleGroup: "", exercise: "", series: "" }]);
  };

  const handleSave = async () => {
    const clean = routines.filter(
      (r) => r.muscleGroup.trim() && r.exercise.trim() && r.series.trim()
    );
    const payload = {
      uid: user.uid,
      date: Timestamp.fromDate(new Date()),
      description: description.trim() || "Planificación del día",
      routines: clean,
      updatedAt: serverTimestamp(),
    };
    console.log("⏺ Payload a guardar en Firestore:", payload);
    console.log("Payload:", payload);
    await setDoc(doc(db, "plans", `${user.uid}_${todayKey}`), payload);
    const newPlan = { ...payload, id: `${user.uid}_${todayKey}` };
    setTodayPlan(newPlan);
    setPlans(prev => {
      const filtered = prev.filter(p => p.id !== newPlan.id);
      return [newPlan, ...filtered].sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
    });
    setEditing(false);
  };

  const handleRegisterFromPlan = (exercise, muscleGroup) => {
    const query = new URLSearchParams();
    query.set("exercise", exercise);
    query.set("muscleGroup", muscleGroup);
    window.location.href = `/?${query.toString()}`;
  };

  const cellStyle = { padding: "6px", border: "1px solid #ccc" };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1rem" }}>
      {!editing && plans.length > 1 && (
        <div style={{ marginBottom: "1rem" }}>
          <label>📅 Ver otra planificación:</label>
          <select
            onChange={(e) => {
              const selected = plans.find(p => p.id === e.target.value);
              if (selected) {
                setTodayPlan(selected);
                setDescription(selected.description || "");
                setRoutines(selected.routines || []);
              }
            }}
            value={todayPlan?.id || ""}
            style={{ width: "100%", padding: "8px", marginTop: "4px" }}
          >
            {plans.map((p, i) => (
              <option key={i} value={p.id}>
                {new Date(p.date.seconds * 1000).toLocaleDateString()} — {p.description || "Sin descripción"}
              </option>
            ))}
          </select>
        </div>
      )}
      <button onClick={onBack}>← Volver</button>
      <h2>Planificación para hoy</h2>

      {loading ? (
        <p>Cargando…</p>
      ) : editing ? (
        <>
          <label>Descripción:</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: "100%", marginBottom: "1rem" }}
            placeholder="Ej: Día de pierna"
          />

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
            <thead>
              <tr>
                <th style={cellStyle}>Grupo muscular</th>
                <th style={cellStyle}>Ejercicio</th>
                <th style={cellStyle}>Series</th>
                <th style={cellStyle}></th>
              </tr>
            </thead>
            <tbody>
              {routines.map((r, i) => (
                <tr key={i}>
                  <td style={cellStyle}>
                    <input
                      list="mg-list"
                      value={r.muscleGroup}
                      onChange={(e) => handleChange(i, "muscleGroup", e.target.value)}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      list="ex-list"
                      value={r.exercise}
                      onChange={(e) => handleChange(i, "exercise", e.target.value)}
                      style={{ width: "100%" }}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      type="text"
                      value={r.series}
                      onChange={(e) => handleChange(i, "series", e.target.value)}
                      style={{ width: "100%" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button onClick={addLine} style={{ marginTop: "1rem" }}>➕ Añadir línea</button>
          <button onClick={handleSave} style={{ marginLeft: "1rem" }}>💾 Guardar</button>

          <datalist id="mg-list">
            {[...new Set(allExercises.map((p) => p.muscleGroup))].sort().map((mg, i) => (
              <option key={i} value={mg} />
            ))}
          </datalist>
          <datalist id="ex-list">
            {[...new Set(allExercises.map((p) => p.exercise))].sort().map((ex, i) => (
              <option key={i} value={ex} />
            ))}
          </datalist>
        </>
      ) : (
        <>
          <p>
            <strong>Fecha:</strong>{" "}
            {todayPlan?.date?.seconds ? new Date(todayPlan.date.seconds * 1000).toLocaleDateString() : "—"}
          </p>
          <p>
            <strong>Descripción:</strong> {todayPlan?.description || "Sin descripción"}
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "1rem" }}>
            <thead>
              <tr>
                <th style={cellStyle}>Grupo muscular</th>
                <th style={cellStyle}>Ejercicio</th>
                <th style={cellStyle}>Series</th>
              </tr>
            </thead>
            <tbody>
              {todayPlan?.routines?.map((r, i) => (
                <tr
                  key={i}
                  onClick={() => handleRegisterFromPlan(r.exercise, r.muscleGroup)}
                  style={{ cursor: "pointer" }}
                >
                  <td style={cellStyle}>{r.muscleGroup}</td>
                  <td style={cellStyle}>{r.exercise}</td>
                  <td style={cellStyle}>{r.series}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => setEditing(true)} style={{ marginTop: "1rem" }}>
            ✏️ Editar planificación
          </button>
        </>
      )}
    </div>
  );
};

export default PlanDay;