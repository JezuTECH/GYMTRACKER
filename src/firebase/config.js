// src/firebase/config.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage"; // 👈 vuelve a importar Storage

const firebaseConfig = {
  apiKey: "AIzaSyABSDAGQXQizE2uPMXnDudTfvQK77rLqpk",
  authDomain: "gymtracker-a01c8.firebaseapp.com",
  projectId: "gymtracker-a01c8",
  storageBucket: "gymtracker-a01c8.appspot.com",
  messagingSenderId: "132751081821",
  appId: "1:132751081821:web:d95d79b8e207c9c36368b4",
  measurementId: "G-XXXXXXXXXX"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const db = getFirestore(app);
const auth = getAuth(app);

// Google con permiso de Drive (lo dejamos si luego migramos a Drive)
const googleProvider = new GoogleAuthProvider();
// googleProvider.addScope("https://www.googleapis.com/auth/drive.file");
googleProvider.setCustomParameters({
  prompt: "select_account"
});

export { app, db, auth, googleProvider, storage };
