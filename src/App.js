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
import ExerciseLibrary from "./components/ExerciseLibrary";
import { ZoomIn, ZoomOut, Sun, Moon } from "lucide-react";

const BRAND_LOGO = `${process.env.PUBLIC_URL || ""}/gym-logo.svg`;

const isMobileViewportNow = () => {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(max-width: 760px)").matches;
  }
  return window.innerWidth <= 760;
};

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState("form");
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("darkMode") === "true");
  const [isMobileViewport, setIsMobileViewport] = useState(() => isMobileViewportNow());
  const [uiScale, setUiScale] = useState(() => {
    const saved = localStorage.getItem("uiScale");
    return saved ? parseFloat(saved) : 1.0;
  });

  const applyScale = (next) => {
    if (isMobileViewport) return;
    const clamped = Math.max(0.8, Math.min(1.2, next));
    setUiScale(clamped);
    localStorage.setItem("uiScale", String(clamped));
  };

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

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const refreshViewport = () => {
      setIsMobileViewport(isMobileViewportNow());
    };

    if (typeof window.matchMedia === "function") {
      const media = window.matchMedia("(max-width: 760px)");
      refreshViewport();
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", refreshViewport);
        return () => media.removeEventListener("change", refreshViewport);
      }
      media.addListener(refreshViewport);
      return () => media.removeListener(refreshViewport);
    }

    window.addEventListener("resize", refreshViewport);
    refreshViewport();
    return () => window.removeEventListener("resize", refreshViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) return;
    if (uiScale === 1) return;
    setUiScale(1);
    localStorage.setItem("uiScale", "1");
  }, [isMobileViewport, uiScale]);

  const handleLogout = () => {
    signOut(auth);
  };

  const navButtonClass = (targetView) => `app-nav-btn${view === targetView ? " is-active" : ""}`;

  if (!authReady || loginInProgress) {
    return <div className="app-loading">Cargando…</div>;
  }

  if (!user) return <Login />;

  const renderView = () => {
    switch (view) {
      case "form":
        return (
          <ExerciseForm
            user={user}
            selectedExercise={selectedExercise}
            onViewChart={() => setView("chart")}
            onViewLibrary={() => setView("library")}
            onSelectExercise={setSelectedExercise}
          />
        );
      case "chart":
        return (
          <ExerciseChart
            user={user}
            selectedExercise={selectedExercise}
            onSelectExercise={setSelectedExercise}
            onViewRegister={() => setView("form")}
            onViewLibrary={() => setView("library")}
            onBack={() => setView("form")}
          />
        );
      case "library":
        return (
          <ExerciseLibrary
            user={user}
            selectedExercise={selectedExercise}
            onSelectExercise={setSelectedExercise}
            onBack={() => setView("form")}
          />
        );
      case "danger":
        return <DangerZone user={user} />;
      case "history":
        return <HistoryViewer user={user} onBack={() => setView("form" )} />;
      case "plan":
        return (
          <PlanDay
            user={user}
            onBack={() => setView("form")}
            onPickExercise={({ exercise, muscleGroup }) => {
              setSelectedExercise({ exercise, muscleGroup });
              setView("form");
            }}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app-shell">
      <div
        className="app-scale-layer"
        style={isMobileViewport ? undefined : {
          transform: `scale(${uiScale})`,
          transformOrigin: "top center",
          width: `${100 / uiScale}%`,
        }}
      >
        <div className="App">
        <header className="app-header">
          <div className="app-brand">
            <img className="app-logo" src={BRAND_LOGO} alt="Gym Tracker logo" />
            <h1 className="app-title">GYM TRACKER</h1>
          </div>
          <div className="app-userbar">
            <p className="app-welcome">
              Bienvenido <strong>{user.displayName}</strong>
            </p>
            <button className="app-logout" onClick={handleLogout}>
              Cerrar sesión
            </button>
          </div>
        </header>

        <div className="app-toolbar">
          {!isMobileViewport && (
            <>
              <button className="app-tool-btn" onClick={smaller} title="Reducir tamaño">
                <ZoomOut size={16} />
              </button>
              <button className="app-tool-btn" onClick={bigger} title="Aumentar tamaño">
                <ZoomIn size={16} />
              </button>
            </>
          )}
          <button className="app-tool-btn" onClick={() => setDarkMode(!darkMode)} title="Modo oscuro/claro">
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <nav className="app-nav">
          <button className={navButtonClass("form")} onClick={() => setView("form")}>Registro</button>
          <button className={navButtonClass("chart")} onClick={() => setView("chart")}>Progresión</button>
          <button className={navButtonClass("history")} onClick={() => setView("history")}>Diario</button>
          <button className={navButtonClass("library")} onClick={() => setView("library")}>Biblioteca</button>
        </nav>

        <main className="app-view">{renderView()}</main>
        </div>
      </div>
    </div>
  );
}

export default App;
