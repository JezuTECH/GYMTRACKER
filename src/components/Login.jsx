// src/components/Login.jsx
import { useEffect, useState } from "react";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase/config";

const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
const isAndroid = /Android/i.test(ua);
const isIOS = /iPad|iPhone|iPod/.test(ua);
// PWA iOS (pantalla de inicio) no permite popups → redirect obligatorio
const isStandalone =
  typeof navigator !== "undefined" &&
  "standalone" in navigator &&
  navigator.standalone === true;

export default function Login() {
  const [status, setStatus] = useState("Esperando…");
  const [lastError, setLastError] = useState("");

  // Procesar el retorno del redirect (si lo hubo) y limpiar el flag
  useEffect(() => {
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) setStatus("Sesión iniciada");
      })
      .catch((err) => {
        // No bloquees el flujo si no venimos de redirect
        console.warn("getRedirectResult:", err?.message || err);
        setLastError(err?.message || String(err));
      })
      .finally(() => {
        try { localStorage.removeItem("loginInProgress"); } catch {}
      });
  }, []);

  const handleLogin = async () => {
    setStatus("Iniciando sesión…");
    setLastError("");

    // iOS en pantalla de inicio → redirect siempre
    if (isIOS && isStandalone) {
      try {
        try { localStorage.setItem("loginInProgress", "true"); } catch {}
        await signInWithRedirect(auth, googleProvider);
      } catch (err) {
        setStatus("No se pudo redirigir a Google");
        setLastError(err?.message || String(err));
      }
      return;
    }

    // En el resto (incluido Android): intenta POPUP primero, cae a REDIRECT si falla
    try {
      await signInWithPopup(auth, googleProvider);
      setStatus("Sesión iniciada con popup");
    } catch (popupErr) {
      console.warn("Popup falló; uso redirect:", popupErr?.message || popupErr);
      try {
        try { localStorage.setItem("loginInProgress", "true"); } catch {}
        await signInWithRedirect(auth, googleProvider);
      } catch (redirectErr) {
        setStatus("Error al iniciar sesión");
        setLastError(redirectErr?.message || String(redirectErr));
        // opcional: alert corto para guiar
        alert("No se pudo iniciar sesión. Prueba a permitir ventanas emergentes y cookies, o reintenta.");
      }
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: "4rem", padding: "1rem", maxWidth: 520, marginInline: "auto" }}>
      <h2 style={{ fontSize: "1.8rem", marginBottom: "1rem" }}>
        Inicia sesión en <strong>Gym Tracker</strong>
      </h2>

      <button
        onClick={handleLogin}
        style={{ padding: "12px 20px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
      >
        Continuar con Google
      </button>

      <p style={{ marginTop: 10, color: "#666" }}>{status}</p>
      {lastError ? (
        <p style={{ marginTop: 6, color: "#b00020", fontSize: 13 }}>Detalle: {lastError}</p>
      ) : null}

      {(isIOS && isStandalone) && (
        <p style={{ marginTop: 8, fontSize: 13, color: "#999" }}>
          Si tras volver de Google no entra, cierra y reabre la app del escritorio.
        </p>
      )}
    </div>
  );
}