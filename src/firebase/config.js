// src/firebase/config.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyABSDAGQXQizE2uPMXnDudTfvQK77rLqpk",
  authDomain: "gymtracker-a01c8.firebaseapp.com",
  projectId: "gymtracker-a01c8",
  storageBucket: "gymtracker-a01c8.appspot.com",
  messagingSenderId: "132751081821",
  appId: "1:132751081821:web:d95d79b8e207c9c36368b4",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// 👇 clave para iPhone (PWA)
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export { app, db, auth, googleProvider }; 
