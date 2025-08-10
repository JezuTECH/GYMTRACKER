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
const isMobile = isAndroid || isIOS;
// PWA standalone check (iOS)
const isStandalone =
  typeof navigator !== "undefined" &&
  "standalone" in navigator &&
  navigator.standalone === true;

export default function Login() {
  const [status, setStatus] = useState("Esperando…");
  const [lastError, setLastError] = useState("");

  // Al volver del redirect, procesa y limpia flag
  useEffect(() => {
    getRedirectResult(auth)
      .then((res) => {
        if (res?.user) setStatus("Sesión iniciada");
      })
      .catch((err) => {
        console.error("getRedirectResult error:", err);
        setLastError(err?.message || String(err));
        setStatus("Error tras volver de Google");
      })
      .finally(() => {
        try { localStorage.removeItem("loginInProgress"); } catch {}
      });
  }, []);

  const handleLogin = async () => {
    setStatus("Iniciando sesión…");
    setLastError("");

    // En móvil (Android/iOS) usa redirect por fiabilidad
    // En iOS PWA (standalone) ES OBLIGATORIO redirect
    const mustRedirect = isMobile || isStandalone;

    if (mustRedirect) {
      try {
        try { localStorage.setItem("loginInProgress", "true"); } catch {}
        await signInWithRedirect(auth, googleProvider);
      } catch (err) {
        console.error("signInWithRedirect error:", err);
        setLastError(err?.message || String(err));
        setStatus("No se pudo redirigir a Google");
      }
      return;
    }

    // En desktop: intenta popup y cae a redirect si falla
    try {
      await signInWithPopup(auth, googleProvider);
      setStatus("Sesión iniciada con popup");
    } catch (popupErr) {
      console.warn("Popup falló, uso redirect. Motivo:", popupErr?.message);
      try {
        try { localStorage.setItem("loginInProgress", "true"); } catch {}
        await signInWithRedirect(auth, googleProvider);
      } catch (redirectErr) {
        console.error("Redirect también falló:", redirectErr);
        setLastError(redirectErr?.message || String(redirectErr));
        setStatus("Error al iniciar sesión");
        alert("No se pudo iniciar sesión. Prueba a borrar caché/cookies y vuelve a intentarlo.");
      }
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: "4rem", padding: "1rem", maxWidth: 520, marginInline: "auto" }}>
      <h2 style={{ fontSize: "1.8rem", marginBottom: "1rem" }}>Inicia sesión en <strong>Gym Tracker</strong></h2>
      <button
        onClick={handleLogin}
        style={{ padding: "12px 20px", fontSize: 16, borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}
      >
        Continuar con Google
      </button>
      <p style={{ marginTop: 10, color: "#666" }}>{status}</p>
      {lastError && (
        <p style={{ marginTop: 6, color: "#b00020", fontSize: 13 }}>
          Detalle: {lastError}
        </p>
      )}
      {(isIOS && isStandalone) && (
        <p style={{ marginTop: 8, fontSize: 13, color: "#999" }}>
          Si tras volver de Google no entra, cierra y reabre la app del escritorio.
        </p>
      )}
    </div>
  );
}
