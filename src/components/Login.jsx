// Login.jsx
import { useEffect, useState } from "react";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase/config"; // Provider ya configurado

// Heurística simple para iOS Safari (incluye WebView)
const isIOSSafari = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || navigator.vendor || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari\//.test(ua) && !/CriOS|FxiOS|OPiOS/.test(ua);
  return iOS && isSafari;
})();

const Login = () => {
  const [status, setStatus] = useState("Esperando…");

  // Asegura persistencia en el navegador (no rompe Chrome móvil)
  useEffect(() => {
    setPersistence(auth, browserLocalPersistence).catch((err) => {
      console.warn("No se pudo establecer la persistencia local:", err?.message);
    });
  }, []);

  const handleLogin = async () => {
    setStatus("Iniciando sesión…");

    // En iOS Safari el popup falla a menudo: vamos directo a redirect
    if (isIOSSafari) {
      try {
        await signInWithRedirect(auth, googleProvider);
        setStatus("Redirigiendo a Google…");
        return;
      } catch (err) {
        console.error("Redirect falló (iOS Safari):", err?.message);
        setStatus("No se pudo redirigir. Prueba en Chrome.");
        return;
      }
    }

    // En el resto, probamos popup y si falla, hacemos redirect
    try {
      await signInWithPopup(auth, googleProvider);
      setStatus("Sesión iniciada (popup)");
    } catch (popupError) {
      console.warn("Popup falló, probando redirección:", popupError?.message);
      setStatus("Fallo popup, redirigiendo…");
      try {
        await signInWithRedirect(auth, googleProvider);
        // No seguimos; el flujo continuará tras volver del redirect
      } catch (redirectError) {
        console.error("Redirect también falló:", redirectError?.message);
        setStatus("Error crítico al iniciar sesión.");
        alert("No se pudo iniciar sesión. Prueba en otro navegador o dispositivo.");
      }
    }
  };

  // Procesar resultado tras redirección (Safari/iOS y si el popup se bloquea)
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          console.log("Sesión iniciada tras redirect con:", result.user.displayName);
          setStatus("Sesión iniciada (redirect)");
        }
      })
      .catch((error) => {
        // No mostramos error al usuario: solo log para no molestar en iOS
        if (error?.message) console.debug("Error tras redirección:", error.message);
      });
  }, []);

  return (
    <div style={{ textAlign: "center", marginTop: "4rem", padding: "1rem", maxWidth: "500px", marginInline: "auto" }}>
      <h2 style={{ fontSize: "1.8rem", marginBottom: "2rem" }}>
        Inicia sesión para acceder a tu <strong>Gym Tracker</strong>
      </h2>

      <button
        onClick={handleLogin}
        style={{
          padding: "12px 24px",
          fontSize: "16px",
          borderRadius: "8px",
          border: "1px solid #ccc",
          backgroundColor: "#ffffff",
          cursor: "pointer",
        }}
      >
        Iniciar sesión con Google
      </button>

      <p style={{ marginTop: "1rem", fontSize: "0.9rem", color: "#666" }}>{status}</p>
    </div>
  );
};

export default Login;
