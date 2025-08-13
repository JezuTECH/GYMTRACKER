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
      window.location.href = window.location.href;
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: "4rem", padding: "1rem", maxWidth: 520, marginInline: "auto" }}>
      <h2 style={{ fontSize: "1.6rem", marginBottom: "0.75rem" }}>
        Inicia sesión en <strong>Gym Tracker</strong>
      </h2>

      {isIOS && isStandalone ? (
        <>
          <p style={{ color: "#444" }}>
            Estás usando la app desde la pantalla de inicio (PWA). En iPhone el inicio de sesión funciona mejor en Safari.
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 12 }}>
            <button onClick={openInSafari} style={{ padding: "12px 18px", fontSize: 16 }}>Abrir en Safari</button>
          </div>
          <p style={{ marginTop: 10, color: "#999", fontSize: 13 }}>
            Al abrir Safari, pulsa "Continuar con Google" y completa el flujo allí.
          </p>
        </>
      ) : (
        <>
          <button
            onClick={handleLogin}
            style={{ padding: "12px 20px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
          >
            Continuar con Google
          </button>

          <p style={{ marginTop: 10, color: "#666" }}>{status}</p>
          {lastError && <p style={{ marginTop: 6, color: "#b00020", fontSize: 13 }}>Detalle: {lastError}</p>}

          <div style={{ marginTop: 12, color: "#777", fontSize: 13 }}>
            <p style={{ margin: 0 }}>Si al volver de Google sigues en esta pantalla, prueba:</p>
            <ul style={{ textAlign: "left", display: "inline-block", marginTop: 6 }}>
              <li>Permitir ventanas emergentes (popups).</li>
              <li>Usar Safari si estás en iOS PWA.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}