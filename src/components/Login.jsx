// src/components/Login.jsx
import { useEffect, useState } from "react";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase/config";

const isIOS = /iPad|iPhone|iPod/.test(
  typeof navigator !== "undefined"
    ? navigator.userAgent || navigator.vendor || ""
    : ""
);
const isStandalone =
  typeof navigator !== "undefined" &&
  "standalone" in navigator &&
  navigator.standalone === true;

export default function Login() {
  const [status, setStatus] = useState("Esperando…");

  // Si volvemos de redirect, limpia el flag
  useEffect(() => {
    getRedirectResult(auth)
      .catch(() => {}) // silencioso
      .finally(() => {
        localStorage.removeItem("loginInProgress");
      });
  }, []);

  // En cuanto haya usuario, recarga para que App lo capte (fix iOS PWA)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setStatus("Conectado");
        // En PWA iOS a veces no rehidrata hasta recargar
        window.location.replace("/");
      } else {
        setStatus("Esperando login");
      }
    });
    return () => unsub();
  }, []);

  const handleGoogleLogin = async () => {
    try {
      if (isIOS && isStandalone) {
        localStorage.setItem("loginInProgress", "true");
        await signInWithRedirect(auth, googleProvider);
      } else {
        await signInWithPopup(auth, googleProvider);
      }
    } catch (err) {
      console.error("Error al iniciar sesión:", err);
      setStatus("Error al iniciar sesión");
    }
  };

  return (
    <div style={{ textAlign: "center", marginTop: "4rem" }}>
      <h1>Gym Tracker</h1>
      <p>Inicia sesión para continuar</p>
      <button
        onClick={handleGoogleLogin}
        style={{ padding: "10px 16px", borderRadius: "6px", fontSize: "14px", cursor: "pointer" }}
      >
        Continuar con Google
      </button>
      <p style={{ marginTop: "1rem", color: "gray" }}>{status}</p>
    </div>
  );
}
