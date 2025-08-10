import "./App.css";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, getRedirectResult } from "firebase/auth";
import { auth } from "./firebase/config";
import ExerciseForm from "./components/ExerciseForm";
import ExerciseChart from "./components/ExerciseChart";
import DangerZone from "./components/DangerZone";
import Login from "./components/Login";
import HistoryViewer from "./components/HistoryViewer";

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState("form");

  // Flag que marcamos desde Login cuando lanzamos signInWithRedirect
  const loginInProgress = localStorage.getItem("loginInProgress") === "true";

  useEffect(() => {
    // 1) Procesa el resultado del redirect. Si viene un usuario, marcamos un flag
    // en sessionStorage para forzar un reload en PWA iOS y evitar quedarse en la pantalla de login.
    getRedirectResult(auth)
      .then((res) => {
        if (res && res.user) {
          sessionStorage.setItem("justRedirected", "true");
        }
      })
      .catch(() => {})
      .finally(() => {
        localStorage.removeItem("loginInProgress");
      });

    // 2) Suscripción a cambios de sesión
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);

      // Si venimos de redirect y ya tenemos usuario, recarga dura en PWA iOS
      if (firebaseUser && sessionStorage.getItem("justRedirected") === "true") {
        sessionStorage.removeItem("justRedirected");
        // Evita que la app se quede "conectado" en el marcador de iOS
        try {
          window.location.replace("/");
        } catch (_) {}
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = () => {
    signOut(auth);
  };

  // Mientras no esté lista la autenticación o el login siga en progreso
  if (!authReady || loginInProgress) {
    return <div style={{ textAlign: "center", marginTop: "3rem" }}>Cargando…</div>;
  }

  // Si no hay usuario, mostramos Login
  if (!user) return <Login />;

  const renderView = () => {
    switch (view) {
      case "form":
        return <ExerciseForm user={user} onViewChart={() => setView("chart")} />;
      case "chart":
        return <ExerciseChart user={user} onBack={() => setView("form")} />;
      case "danger":
        return <DangerZone user={user} />;
      case "history":
        return <HistoryViewer user={user} onBack={() => setView("form")} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="App"
      style={{
        fontFamily: "Arial, sans-serif",
        padding: "1rem",
        maxWidth: "700px",
        margin: "0 auto",
      }}
    >
      <h1 style={{ textAlign: "center" }}>Gym Tracker</h1>

      <p style={{ textAlign: "center" }}>
        Bienvenido <strong>{user?.displayName || user?.email || "Usuario"}</strong>{" "}
        <button
          onClick={handleLogout}
          style={{ marginLeft: "1rem", padding: "6px 12px", fontSize: "14px" }}
        >
          Cerrar sesión
        </button>
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0.5rem",
          margin: "1.5rem 0",
        }}
      >
        <button
          onClick={() => setView("form")}
          style={{
            padding: "10px 16px",
            fontSize: "14px",
            borderRadius: "6px",
            backgroundColor: "#e0e0e0",
            border: "none",
            cursor: "pointer",
            flex: "1 0 30%",
            minWidth: "100px",
          }}
        >
          Registro
        </button>

        <button
          onClick={() => setView("chart")}
          style={{
            padding: "10px 16px",
            fontSize: "14px",
            borderRadius: "6px",
            backgroundColor: "#e0e0e0",
            border: "none",
            cursor: "pointer",
            flex: "1 0 30%",
            minWidth: "100px",
          }}
        >
          Ver progreso
        </button>

        <button
          onClick={() => setView("history")}
          style={{
            padding: "10px 16px",
            fontSize: "14px",
            borderRadius: "6px",
            backgroundColor: "#e0e0e0",
            border: "none",
            cursor: "pointer",
            flex: "1 0 30%",
            minWidth: "100px",
          }}
        >
          Historial diario
        </button>
      </div>

      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "flex-start",
          padding: "0 1rem",
          marginTop: "2rem",
        }}
      >
        <button
          onClick={() => setView("danger")}
          style={{
            padding: "10px 16px",
            fontSize: "14px",
            borderRadius: "6px",
            backgroundColor: "#f44336",
            color: "white",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            width: "200px",
          }}
        >
          🗑️ Reseteo de datos
        </button>
      </div>

      {renderView()}
    </div>
  );
}

export default App;
