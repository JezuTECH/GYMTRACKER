// src/App.js
import "./App.css";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, getRedirectResult } from "firebase/auth";
import { auth } from "./firebase/config";
import ExerciseForm from "./components/ExerciseForm";
import ExerciseChart from "./components/ExerciseChart";
import DangerZone from "./components/DangerZone";
import Login from "./components/Login";
import HistoryViewer from "./components/HistoryViewer";
import PlanDay from "./components/PlanDay";
import { ZoomIn, ZoomOut, Sun, Moon } from "lucide-react";

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState("form");

  const [selectedExercise, setSelectedExercise] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");

  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem("uiScale");
    return saved ? parseFloat(saved) : 1.0;
  });

  const applyScale = (next) => {
    const clamped = Math.max(0.8, Math.min(1.2, next));
    setUiScale(clamped);
    localStorage.setItem("uiScale", String(clamped));
  };

  const setNormal = () => applyScale(1.0);
  const setCompact = () => applyScale(0.92);
  const setUltra = () => applyScale(0.85);
  const smaller = () => applyScale(uiScale - 0.05);
  const bigger = () => applyScale(uiScale + 0.05);

  const loginInProgress = localStorage.getItem("loginInProgress") === "true";

  useEffect(() => {
    getRedirectResult(auth)
      .finally(() => localStorage.removeItem("loginInProgress"))
      .catch(() => {});

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);

      const cached = localStorage.getItem("selectedExercise");
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.exercise) {
            setSelectedExercise(parsed);
            setView("form");
          }
          localStorage.removeItem("selectedExercise");
        } catch {}
      }

      const urlParams = new URLSearchParams(window.location.search);
      const exerciseParam = urlParams.get("exercise");
      const groupParam = urlParams.get("muscleGroup");
      if (exerciseParam && groupParam) {
        setSelectedExercise({ exercise: exerciseParam, muscleGroup: groupParam });
        setView("form");
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-mode");
    } else {
      document.body.classList.remove("dark-mode");
    }
    localStorage.setItem("darkMode", darkMode);
  }, [darkMode]);

  const handleLogout = () => {
    signOut(auth);
  };

  if (!authReady || loginInProgress) {
    return <div style={{ textAlign: "center", marginTop: "3rem" }}>Cargando…</div>;
  }

  if (!user) return <Login />;

  const renderView = () => {
    switch (view) {
      case "form":
        return (
          <ExerciseForm
            user={user}
            onViewChart={() => setView("chart")}
            onSelectExercise={setSelectedExercise}
          />
        );
      case "chart":
        return (
          <ExerciseChart
            user={user}
            selectedExercise={selectedExercise}
            onBack={() => setView("form")}
          />
        );
      case "danger":
        return <DangerZone user={user} />;
      case "history":
        return <HistoryViewer user={user} onBack={() => setView("form")} />;
      case "plan":
        return <PlanDay user={user} onBack={() => setView("form")} />;
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        transform: `scale(${uiScale})`,
        transformOrigin: "top center",
        width: `${100 / uiScale}%`,
      }}
    >
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

        {/* Controles de tamaño y modo oscuro */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "0.5rem",
            alignItems: "center",
            marginBottom: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          <button onClick={() => setDarkMode(!darkMode)} title="Modo oscuro/claro">
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <span style={{ fontSize: 12, color: "#666" }}>Tamaño:</span>
          <button onClick={setUltra}>Ultra</button>
          <button onClick={setCompact}>Compacto</button>
          <button onClick={setNormal}>Normal</button>
          <span style={{ marginLeft: 8 }} />
          <button onClick={smaller}>
            <ZoomOut size={16} />
          </button>
          <button onClick={bigger}>
            <ZoomIn size={16} />
          </button>
          <span style={{ fontSize: 12, color: "#999" }}>({Math.round(uiScale * 100)}%)</span>
        </div>

        <p style={{ textAlign: "center" }}>
          Bienvenido <strong>{user.displayName}</strong>{" "}
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
          <button onClick={() => setView("form")}>✍️ Registro</button>
          <button onClick={() => setView("chart")}>📈 Progresión</button>
          <button onClick={() => setView("history")}>📅 Diario</button>
          <button onClick={() => setView("plan")}>📝 Planificar día</button>
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
            }}
          >
            🗑️ Borrado
          </button>
        </div>

        {renderView()}
      </div>
    </div>
  );
}

export default App;