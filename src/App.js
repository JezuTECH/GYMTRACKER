// src/App.js
import "./App.css";
import { useEffect, useState } from "react";
import { onIdTokenChanged, signOut, getRedirectResult } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, environmentLabel, isLocalTestMode } from "./firebase/config";
import ExerciseForm from "./components/ExerciseForm";
import ExerciseChart from "./components/ExerciseChart";
import DangerZone from "./components/DangerZone";
import Login from "./components/Login";
import HistoryViewer from "./components/HistoryViewer";
import PlanDay from "./components/PlanDay";
import ExerciseLibrary from "./components/ExerciseLibrary";
import KpiViewer from "./components/KpiViewer";
import { ZoomIn, ZoomOut, Sun, Moon } from "lucide-react";
import {
  clearLoginRedirectFlag,
  hasFreshLoginRedirectFlag,
} from "./utils/loginRedirectState";

const BRAND_LOGO = `${process.env.PUBLIC_URL || ""}/gym-logo.svg`;
const ADMIN_EMAIL_ALLOWLIST = new Set([
  "jesusrodriguezsanchez@gmail.com",
]);
const EUR_FORMATTER = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const isMobileViewportNow = () => {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(max-width: 760px)").matches;
  }
  return window.innerWidth <= 760;
};

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

function App() {
  const [user, setUser] = useState(null);
  const [isAdminApp, setIsAdminApp] = useState(false);
  const [monthlyAiCost, setMonthlyAiCost] = useState(0);
  const [authReady, setAuthReady] = useState(false);
  const [redirectPending, setRedirectPending] = useState(() => hasFreshLoginRedirectFlag());
  const [redirectError, setRedirectError] = useState("");
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

  useEffect(() => {
    if (!redirectPending) return undefined;

    let cancelled = false;
    getRedirectResult(auth)
      .catch((err) => {
        if (cancelled) return;
        const message = String(err?.message || "").trim();
        setRedirectError(message);
      })
      .finally(() => {
        clearLoginRedirectFlag();
        if (!cancelled) {
          setRedirectPending(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [redirectPending]);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        if (cancelled) return;
        setUser(null);
        setAuthReady(true);
        setIsAdminApp(false);
        setMonthlyAiCost(0);
        return;
      }

      let tokenResult = null;
      try {
        tokenResult = await firebaseUser.getIdTokenResult();
      } catch (tokenErr) {
        console.error("No se pudo leer el token de sesion:", tokenErr);
      }

      if (cancelled) return;

      setUser(firebaseUser);
      setAuthReady(true);
      setRedirectError("");

      const byClaim = Boolean(tokenResult?.claims?.adminApp);
      const byEmail = ADMIN_EMAIL_ALLOWLIST.has(normalizeEmail(tokenResult?.claims?.email || firebaseUser?.email));
      setIsAdminApp(byClaim || byEmail);

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

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user || !isAdminApp) {
      setMonthlyAiCost(0);
      return undefined;
    }
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const ref = doc(db, "auditLogs", `ai-cost-${monthKey}`);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const raw = Number(snapshot.data()?.totalEur ?? 0);
        setMonthlyAiCost(Number.isFinite(raw) && raw > 0 ? raw : 0);
      },
      (snapshotErr) => {
        console.error("No se pudo cargar coste IA mensual:", snapshotErr);
        setMonthlyAiCost(0);
      }
    );
    return () => unsubscribe();
  }, [user, isAdminApp]);

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
  const monthlyAiCostLabel = EUR_FORMATTER.format(monthlyAiCost);
  const displayName = user?.displayName || user?.email || (isLocalTestMode ? "Usuario test" : "Usuario");

  if (!authReady || redirectPending) {
    return <div className="app-loading">Cargando…</div>;
  }

  if (!user) return <Login redirectError={redirectError} />;

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
      case "kpis":
        return <KpiViewer user={user} />;
      case "danger":
        return <DangerZone user={user} />;
      case "history":
        return <HistoryViewer user={user} onBack={() => setView("form")} />;
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
            {isLocalTestMode && <span className="app-env-badge">{environmentLabel}</span>}
          </div>
          <div className="app-userbar">
            <p className="app-welcome">
              Bienvenido <strong>{displayName}</strong>
            </p>
            <button className="app-logout" onClick={handleLogout}>
              Cerrar sesión
            </button>
            {isAdminApp && view === "form" && (
              <div className="app-admin-cost app-admin-cost-inline" title="Gasto de IA acumulado del mes">
                <span className="app-admin-cost-label">IA mes</span>
                <strong className="app-admin-cost-value">{monthlyAiCostLabel}</strong>
              </div>
            )}
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
          <button className={`${navButtonClass("form")} app-nav-btn--form`} onClick={() => setView("form")}>Registro</button>
          <button className={`${navButtonClass("history")} app-nav-btn--history`} onClick={() => setView("history")}>Diario</button>
          <button className={`${navButtonClass("chart")} app-nav-btn--chart`} onClick={() => setView("chart")}>Progresión</button>
          <button className={`${navButtonClass("kpis")} app-nav-btn--kpis`} onClick={() => setView("kpis")}>KPIs</button>
          <button className={`${navButtonClass("library")} app-nav-btn--library`} onClick={() => setView("library")}>Biblioteca</button>
        </nav>

        <main className="app-view">{renderView()}</main>
        </div>
      </div>
    </div>
  );
}

export default App;
