// src/components/Login.jsx
import { useEffect, useState } from "react";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase/config";

const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
const isIOS = /iPad|iPhone|iPod/i.test(ua);

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

const LOGIN_FLAG = "gymtracker_login_in_progress";
const LOGIN_FLAG_TTL_MS = 5 * 60 * 1000;

function setLoginFlag() {
  try {
    localStorage.setItem(LOGIN_FLAG, JSON.stringify({ ts: Date.now() }));
  } catch {}
}
function clearLoginFlag() {
  try {
    localStorage.removeItem(LOGIN_FLAG);
  } catch {}
}
function readLoginFlagAge() {
  try {
    const v = JSON.parse(localStorage.getItem(LOGIN_FLAG));
    if (!v || !v.ts) return Infinity;
    return Date.now() - Number(v.ts || 0);
  } catch {
    return Infinity;
  }
}

export default function Login() {
  const [status, setStatus] = useState("Esperando…");
  const [lastError, setLastError] = useState("");

  // En mount: forzar persistencia y procesar redirect si iniciamos uno
  useEffect(() => {
    (async () => {
      try {
        await setPersistence(auth, browserLocalPersistence);
      } catch (e) {
        console.warn("[Login] setPersistence warning:", e);
      }

      // Sólo procesar getRedirectResult si lanzamos un redirect recientemente
      const age = readLoginFlagAge();
      if (age < LOGIN_FLAG_TTL_MS) {
        setStatus("Procesando retorno de Google...");
        try {
          const res = await getRedirectResult(auth);
          if (res?.user) {
            setStatus("Sesión iniciada (redirect)");
          } else {
            setStatus("Esperando acción del usuario...");
          }
        } catch (err) {
          console.warn("[Login] getRedirectResult:", err?.message || err);
          setLastError(err?.message || String(err));
        } finally {
          clearLoginFlag();
        }
      } else {
        clearLoginFlag();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doRedirectLogin = async () => {
    try {
      setStatus("Redirigiendo a Google...");
      setLastError("");
      setLoginFlag();
      await signInWithRedirect(auth, googleProvider);
      // no llega aquí: redirect
    } catch (err) {
      console.error("[Login] signInWithRedirect error:", err);
      setStatus("Error al redirigir");
      setLastError(err?.message || String(err));
      clearLoginFlag();
    }
  };

  const handleLogin = async () => {
    setStatus("Iniciando sesión…");
    setLastError("");

    // En iOS PWA (standalone) NO usar popup automático: mostrar instrucción
    if (isIOS && isStandalone) {
      setStatus("Abre la app en Safari y pulsa 'Continuar con Google' allí.");
      return;
    }

    // Intentamos popup (mejor UX en desktop); si falla, fallback a redirect
    try {
      await signInWithPopup(auth, googleProvider);
      setStatus("Sesión iniciada con popup");
      clearLoginFlag();
      return;
    } catch (popupErr) {
      console.warn("[Login] signInWithPopup falló, fallback a redirect:", popupErr?.message || popupErr);
      try {
        await doRedirectLogin();
      } catch (redirectErr) {
        console.error("[Login] fallback redirect falló:", redirectErr);
        setStatus("Error al iniciar sesión");
        setLastError(redirectErr?.message || String(redirectErr));
        clearLoginFlag();
      }
    }
  };

  // Función para abrir explicitamente en Safari (útil en PWA)
  const openInSafari = () => {
    try {
      window.open(window.location.href, "_blank");
    } catch {
      window.location.reload();
    }
  };

  return (
    <div className="login-panel login-screen">
      <h2>
        Inicia sesión en <strong>Gym Tracker</strong>
      </h2>

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
            Continuar con Google
          </button>

          <p className="login-status">{status}</p>
          {lastError && <p className="login-error">Detalle: {lastError}</p>}

          <div className="login-help">
            <p>Si al volver de Google sigues en esta pantalla, prueba:</p>
            <ul>
              <li>Permitir ventanas emergentes (popups).</li>
              <li>Usar Safari si estás en iOS PWA.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
