// src/components/ExerciseMaster.jsx
import { useEffect, useRef, useState } from "react";
import { collection, doc, getDocs, query, setDoc, where, deleteDoc, getDoc } from "firebase/firestore";
import { signInWithPopup } from "firebase/auth";
import { db, auth, googleProvider } from "../firebase/config";

const sanitize = (s = "") =>
  String(s).trim().toLowerCase().replace(/[^a-z0-9\-_. ]+/g, "").replace(/\s+/g, "_").slice(0, 80);

const docKeyFor = (mg, ex) => `${sanitize(mg)}__${sanitize(ex)}`;

// Devuelve un token OAuth de Google con permiso drive.file (pide popup si hace falta)
async function ensureDriveAccessToken() {
  // Reautenticamos con el mismo provider (trae scope drive.file) para obtener accessToken
  const result = await signInWithPopup(auth, googleProvider);
  const cred = (window.firebase?.auth?.GoogleAuthProvider?.credentialFromResult)
    ? window.firebase.auth.GoogleAuthProvider.credentialFromResult(result)
    : null;

  // En el SDK modular, el token viene en result._tokenResponse.oauthAccessToken (no público, pero práctico)
  const token =
    cred?.accessToken ||
    result?._tokenResponse?.oauthAccessToken ||
    result?.user?.stsTokenManager?.accessToken || // fallback (no suele servir para Drive)
    null;

  if (!token) {
    throw new Error("No se pudo obtener el token de Google Drive.");
  }
  return token;
}

// Sube a Drive con uploadType=multipart y devuelve { id, webViewLink, thumbnailLink }
async function uploadToDrive(accessToken, file, filename) {
  // Metadatos: nombre y tipo
  const metadata = {
    name: filename,
    // Si quieres forzar a una carpeta, añade parents: ["<FOLDER_ID>"]
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const metaPart =
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata);

  const filePartHeader =
    `Content-Type: ${file.type || "image/jpeg"}\r\n\r\n`;

  const metaBlob = new Blob([metaPart]);
  const fileHeaderBlob = new Blob([filePartHeader]);
  const body = new Blob([delimiter, metaBlob, delimiter, fileHeaderBlob, file, closeDelim], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,thumbnailLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body,
    }
  );

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Error subiendo a Drive: ${msg}`);
  }
  return await res.json(); // { id, webViewLink, thumbnailLink }
}

// Borra un fichero en Drive por id
async function deleteFromDrive(accessToken, fileId) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Error borrando en Drive: ${msg}`);
  }
}

const ExerciseMaster = ({ user, onBack }) => {
  const [allPairs, setAllPairs] = useState([]); // [{muscleGroup, exercise}]
  const [muscleGroup, setMuscleGroup] = useState("");
  const [exercise, setExercise] = useState("");
  const [exerciseOptions, setExerciseOptions] = useState([]);

  // Ficha guardada en Firestore para este par (si existe)
  const [record, setRecord] = useState(null); // { fileId, webViewLink, thumbnailLink }
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progressText, setProgressText] = useState("");

  const fileRef = useRef(null);

  // Cargar pares desde workouts
  useEffect(() => {
    if (!user) return;
    (async () => {
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
    })();
  }, [user]);

  // Opciones dependientes del grupo
  useEffect(() => {
    if (!muscleGroup) {
      setExerciseOptions([...new Set(allPairs.map((p) => p.exercise))].sort());
    } else {
      const opts = allPairs.filter((p) => p.muscleGroup === muscleGroup).map((p) => p.exercise);
      setExerciseOptions([...new Set(opts)].sort());
    }
  }, [muscleGroup, allPairs]);

  const canQuery = Boolean(user && muscleGroup && exercise);

  // Lee/escucha ficha guardada en Firestore para este par
  useEffect(() => {
    if (!canQuery) { setRecord(null); return; }
    (async () => {
      setLoading(true);
      try {
        const dref = doc(db, "users", user.uid, "exerciseMaster", docKeyFor(muscleGroup, exercise));
        const snap = await getDoc(dref);
        if (snap.exists()) {
          setRecord(snap.data());
        } else {
          setRecord(null);
        }
      } catch (e) {
        console.error(e);
        setRecord(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [canQuery, user, muscleGroup, exercise]);

  const previewURL = record?.fileId
    ? `https://drive.google.com/uc?export=view&id=${encodeURIComponent(record.fileId)}`
    : null;

  async function onPickUpload() {
    if (!canQuery) return;
    const file = fileRef.current?.files?.[0];
    if (!file) {
      alert("Selecciona una imagen primero.");
      return;
    }

    setUploading(true);
    setProgressText("Preparando subida…");
    try {
      // 1) Asegurar token Drive
      const accessToken = await ensureDriveAccessToken();

      // 2) Subir (nota: Drive no da progreso por streaming con fetch; mostramos estados sintéticos)
      setProgressText("Subiendo a Google Drive…");
      const safeName = `${sanitize(muscleGroup)}__${sanitize(exercise)}.jpg`;
      const res = await uploadToDrive(accessToken, file, safeName);

      // 3) Guardar ficha en Firestore
      const payload = {
        muscleGroup,
        exercise,
        fileId: res.id,
        webViewLink: res.webViewLink || "",
        thumbnailLink: res.thumbnailLink || "",
        updatedAt: new Date(),
      };
      const dref = doc(db, "users", user.uid, "exerciseMaster", docKeyFor(muscleGroup, exercise));
      await setDoc(dref, payload, { merge: true });
      setRecord(payload);
      setProgressText("Subida completada.");
    } catch (e) {
      console.error(e);
      alert("No se pudo subir la imagen.");
      setProgressText("");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
      setTimeout(() => setProgressText(""), 1500);
    }
  }

  async function onDelete() {
    if (!canQuery || !record?.fileId) return;
    if (!window.confirm("¿Eliminar la imagen de este ejercicio de tu Google Drive?")) return;
    try {
      const accessToken = await ensureDriveAccessToken();
      await deleteFromDrive(accessToken, record.fileId);
      const dref = doc(db, "users", user.uid, "exerciseMaster", docKeyFor(muscleGroup, exercise));
      await deleteDoc(dref);
      setRecord(null);
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar la imagen.");
    }
  }

  const row = { display: "flex", alignItems: "center", gap: "6px", marginBottom: "0.5rem" };
  const input = { flex: 1, padding: "12px 14px", fontSize: "1rem", borderRadius: "8px", border: "1px solid #ccc" };
  const btn = { padding: "10px 14px", borderRadius: "6px", border: "1px solid #ccc", background: "#eee", cursor: "pointer" };

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1rem" }}>
      <button onClick={onBack} style={{ marginBottom: "1rem" }}>← Volver</button>
      <h2 style={{ marginBottom: "1rem" }}>Maestro de ejercicios (Drive)</h2>

      <label>Grupo muscular</label>
      <div style={row}>
        <input
          list="mg-list"
          value={muscleGroup}
          onChange={(e) => { setMuscleGroup(e.target.value); setExercise(""); }}
          placeholder="Pectoral, Pierna, Espalda…"
          style={input}
        />
      </div>
      <datalist id="mg-list">
        {[...new Set(allPairs.map((p) => p.muscleGroup))].sort().map((g, i) => <option key={i} value={g} />)}
      </datalist>

      <label>Ejercicio</label>
      <div style={row}>
        <input
          list="ex-list"
          value={exercise}
          onChange={(e) => setExercise(e.target.value)}
          placeholder="Press banca, Dominadas…"
          style={input}
        />
      </div>
      <datalist id="ex-list">
        {exerciseOptions.map((ex, i) => <option key={i} value={ex} />)}
      </datalist>

      <div style={{ marginTop: "1rem", borderTop: "1px solid #eee", paddingTop: "1rem" }}>
        <h3 style={{ margin: 0, marginBottom: "0.5rem" }}>Imagen del ejercicio</h3>

        {!canQuery && <p style={{ color: "#666" }}>Selecciona grupo y ejercicio para gestionar la imagen.</p>}

        {canQuery && (
          <>
            {previewURL ? (
              <div style={{ marginBottom: "0.75rem" }}>
                <img src={previewURL} alt="Ejercicio" style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid #ddd" }} />
              </div>
            ) : (
              <p style={{ color: "#666" }}>No hay imagen para este ejercicio.</p>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploading}
                onChange={() => {/* subimos al pulsar botón, no aquí */}}
              />
              <button
                disabled={uploading}
                style={{ ...btn, opacity: uploading ? 0.7 : 1 }}
                onClick={onPickUpload}
              >
                {uploading ? "Subiendo a Drive…" : (record ? "Sustituir imagen" : "Subir imagen")}
              </button>
              {record?.fileId && (
                <button style={{ ...btn, background: "#fce8e6", borderColor: "#f28b82" }} onClick={onDelete}>
                  🗑️ Borrar imagen
                </button>
              )}
            </div>

            {progressText && (
              <div style={{ marginTop: 8, fontSize: "0.9rem", color: "#555" }}>
                {progressText}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ExerciseMaster;
