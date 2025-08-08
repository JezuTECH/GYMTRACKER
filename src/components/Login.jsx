// Login.jsx
import { useEffect, useState } from "react";
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase/config"; // Importa el provider ya configurado

const Login = () => {
  const [status, setStatus] = useState("Esperando...");

  const handleLogin = async () => {
    setStatus("Iniciando sesión...");

    try {
      await signInWithPopup(auth, googleProvider);
      setStatus("Sesión iniciada con popup");
    } catch (popupError) {
      console.warn("Popup falló:", popupError.message);
      setStatus("Fallo popup, redirigiendo...");

      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (redirectError) {
        console.error("Redirect también falló:", redirectError.message);
        setStatus("Error crítico al iniciar sesión.");
        alert("No se pudo iniciar sesión. Prueba en otro navegador o dispositivo.");
      }
    }
  };

  // Procesar resultado tras redirección
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          console.log("Sesión iniciada tras redirect con:", result.user.displayName);
          setStatus("Sesión iniciada tras redirección");
        }
      })
      .catch((error) => {
        console.error("Error tras redirección:", error.message);
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
