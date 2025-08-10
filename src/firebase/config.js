// src/firebase/config.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// Configuración oficial de tu proyecto Firebase (Web App)
const firebaseConfig = {
  apiKey: "AIzaSyABSDAGQXQizE2uPMXnDudTfvQK77rLqpk",
  authDomain: "gymtracker-a01c8.firebaseapp.com",
  projectId: "gymtracker-a01c8",
  storageBucket: "gymtracker-a01c8.appspot.com",
  messagingSenderId: "132751081821",
  appId: "1:132751081821:web:d95d79b8e207c9c36368b4",
  measurementId: "G-XXXXXXXXXX" // Este campo es opcional; si Firebase no lo muestra, lo puedes omitir
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Configuración del proveedor de Google
const googleProvider = new GoogleAuthProvider();
// Esto fuerza que se abra siempre un popup (más fiable en navegador móvil)
googleProvider.setCustomParameters({
  prompt: "select_account"
});

export { db, auth, googleProvider, app }; // ← ESTA LÍNEA ES LA NUEVA
