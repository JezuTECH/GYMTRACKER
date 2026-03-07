// src/components/Login.jsx
import { useEffect, useState } from "react";
import {
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { auth, googleProvider, isLocalTestMode } from "../firebase/config";
import {
  clearLoginRedirectFlag,
  setLoginRedirectFlag,
} from "../utils/loginRedirectState";

const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
const isIOS = /iPad|iPhone|iPod/i.test(ua);
const LOCAL_TEST_EMAIL =
  process.env.REACT_APP_LOCAL_TEST_LOGIN_EMAIL || "jesusrodriguezsanchez@gmail.com";
const LOCAL_TEST_PASSWORD =
  process.env.REACT_APP_LOCAL_TEST_LOGIN_PASSWORD || "gym-tracker-test";

// Detección simple de PWA/standalone (suficiente para la mayoría de casos)
function inStandaloneMode() {
  try {
    if ("standalone" in navigator && navigator.standalone) return true;
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    return false;
  } catch {
    return false;
  }
}
const isStandalone = inStandaloneMode();

export default function Login({ redirectError = "" }) {
  const [status, setStatus] = useState("Esperando…");
  const [lastError, setLastError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (e) {
        console.warn("[Login] setPersistence warning:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!redirectError) return;
    setStatus("No se pudo completar el inicio de sesión.");
    setLastError(redirectError);
  }, [redirectError]);

  const doRedirectLogin = async () => {
    try {
      setStatus("Redirigiendo a Google...");
      setLastError("");
      setLoginRedirectFlag();
      await signInWithRedirect(auth, googleProvider);
      // no llega aquí: redirect
    } catch (err) {
      console.error("[Login] signInWithRedirect error:", err);
      setStatus("Error al redirigir");
      setLastError(err?.message || String(err));
      clearLoginRedirectFlag();
    }
  };

  const handleLogin = async () => {
    setStatus("Iniciando sesión…");
    setLastError("");

    if (isLocalTestMode) {
      try {
        try {
          await signInWithEmailAndPassword(auth, LOCAL_TEST_EMAIL, LOCAL_TEST_PASSWORD);
        } catch (signInErr) {
          const code = String(signInErr?.code || "").toLowerCase();
          if (code.includes("user-not-found") || code.includes("invalid-credential")) {
            await createUserWithEmailAndPassword(auth, LOCAL_TEST_EMAIL, LOCAL_TEST_PASSWORD);
          } else {
            throw signInErr;
          }
        }
        setStatus("Sesión de prueba iniciada");
        clearLoginRedirectFlag();
      } catch (anonymousErr) {
        console.error("[Login] local test sign-in error:", anonymousErr);
        setStatus("Error al iniciar sesión de prueba");
        setLastError(anonymousErr?.message || String(anonymousErr));
      }
      return;
    }

    // En iOS PWA (standalone) NO usar popup automático: mostrar instrucción
    if (isIOS && isStandalone) {
      setStatus("Abre la app en Safari y pulsa 'Continuar con Google' allí.");
      return;
    }

    // Intentamos popup (mejor UX en desktop); si falla, fallback a redirect
    try {
      await signInWithPopup(auth, googleProvider);
      setStatus("Sesión iniciada con popup");
      clearLoginRedirectFlag();
      return;
    } catch (popupErr) {
      console.warn("[Login] signInWithPopup falló, fallback a redirect:", popupErr?.message || popupErr);
      try {
        await doRedirectLogin();
      } catch (redirectErr) {
        console.error("[Login] fallback redirect falló:", redirectErr);
        setStatus("Error al iniciar sesión");
        setLastError(redirectErr?.message || String(redirectErr));
        clearLoginRedirectFlag();
      }
    }
  };

  // Función para abrir explicitamente en Safari (útil en PWA)
  const openInSafari = () => {
    try {
      const nextWindow = window.open(window.location.href, "_blank", "noopener,noreferrer");
      if (nextWindow) {
        nextWindow.opener = null;
        return;
      }
      window.location.assign(window.location.href);
    } catch {
      window.location.assign(window.location.href);
    }
  };

  return (
    <div className="login-panel login-screen">
      <h2>
        Inicia sesión en <strong>Gym Tracker</strong>
      </h2>

      {isLocalTestMode && (
        <p className="login-copy">
          Estás en modo de prueba local. Esta sesión usa emuladores, no mezcla datos con producción y entra con un usuario de test con correo.
        </p>
      )}

      {isIOS && isStandalone ? (
        <>
          <p className="login-copy">
            Estás usando la app desde la pantalla de inicio (PWA). En iPhone el inicio de sesión funciona mejor en Safari.
          </p>
          <div className="login-actions">
            <button className="login-main-btn" onClick={openInSafari}>Abrir en Safari</button>
          </div>
          <p className="login-note">
            Al abrir Safari, pulsa "Continuar con Google" y completa el flujo allí.
          </p>
        </>
      ) : (
        <>
          <button className="login-main-btn" onClick={handleLogin}>
            {isLocalTestMode ? "Entrar en modo test" : "Continuar con Google"}
          </button>

          <p className="login-status">{status}</p>
          {lastError && <p className="login-error">Detalle: {lastError}</p>}

          {isLocalTestMode ? (
            <p className="login-note">
              Usa este acceso para validar flujos, regresión visual y migraciones sin tocar tu base real. Correo test: {LOCAL_TEST_EMAIL}
            </p>
          ) : (
            <div className="login-help">
              <p>Si al volver de Google sigues en esta pantalla, prueba:</p>
              <ul>
                <li>Permitir ventanas emergentes (popups).</li>
                <li>Usar Safari si estás en iOS PWA.</li>
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
