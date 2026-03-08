// src/firebase/config.js
import { initializeApp } from "firebase/app";
import { initializeFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  connectAuthEmulator,
} from "firebase/auth";
import {
  getFunctions,
  connectFunctionsEmulator,
} from "firebase/functions";
import {
  getStorage,
  connectStorageEmulator,
} from "firebase/storage";

const PROD_PROJECT_ID = "gymtracker-a01c8";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyABSDAGQXQizE2uPMXnDudTfvQK77rLqpk",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "gymtracker-a01c8.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || PROD_PROJECT_ID,
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "gymtracker-a01c8.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "132751081821",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:132751081821:web:d95d79b8e207c9c36368b4",
};

const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
  // Mitiga fallos de lectura en algunos navegadores/redes donde WebChannel no conecta bien.
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false,
});
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
const storage = getStorage(app);

const runtimeHostname =
  typeof window !== "undefined" && window.location?.hostname
    ? window.location.hostname
    : "";
const runtimeScope = typeof window !== "undefined" ? window : {};

const isLocalRuntime = LOCAL_HOSTS.has(runtimeHostname);
const emulatorHost = process.env.REACT_APP_FIREBASE_EMULATOR_HOST || "127.0.0.1";
const emulatorPorts = {
  auth: Number(process.env.REACT_APP_FIREBASE_AUTH_EMULATOR_PORT || 9099),
  firestore: Number(process.env.REACT_APP_FIREBASE_FIRESTORE_EMULATOR_PORT || 8080),
  functions: Number(process.env.REACT_APP_FIREBASE_FUNCTIONS_EMULATOR_PORT || 5001),
  storage: Number(process.env.REACT_APP_FIREBASE_STORAGE_EMULATOR_PORT || 9199),
};
const requestedEmulators = String(
  process.env.REACT_APP_USE_FIREBASE_EMULATORS ?? (isLocalRuntime ? "true" : "false")
).toLowerCase();
const useFirebaseEmulators = requestedEmulators === "true";
const allowLocalProd = String(process.env.REACT_APP_ALLOW_LOCAL_PROD || "").toLowerCase() === "true";
const isLocalTestMode = isLocalRuntime && useFirebaseEmulators;

if (isLocalRuntime && !useFirebaseEmulators && firebaseConfig.projectId === PROD_PROJECT_ID && !allowLocalProd) {
  throw new Error(
    "Localhost esta bloqueado contra produccion. Usa emuladores o REACT_APP_ALLOW_LOCAL_PROD=true."
  );
}

if (useFirebaseEmulators && !runtimeScope.__gymTrackerFirebaseEmulatorsConnected) {
  connectAuthEmulator(auth, `http://${emulatorHost}:${emulatorPorts.auth}`, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, emulatorHost, emulatorPorts.firestore);
  connectFunctionsEmulator(functions, emulatorHost, emulatorPorts.functions);
  connectStorageEmulator(storage, emulatorHost, emulatorPorts.storage);
  runtimeScope.__gymTrackerFirebaseEmulatorsConnected = true;
}

const environmentLabel = isLocalTestMode
  ? "TEST"
  : firebaseConfig.projectId === PROD_PROJECT_ID
    ? "PRODUCCION"
    : "STAGING";

// Proveedor Google (forzamos selección de cuenta para evitar “quedarse colgado” en móvil)
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export {
  app,
  db,
  auth,
  functions,
  storage,
  googleProvider,
  environmentLabel,
  isLocalTestMode,
  useFirebaseEmulators,
};
