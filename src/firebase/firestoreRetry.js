import {
  addDoc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth } from "./config";

const RETRYABLE_CODES = new Set([
  "permission-denied",
  "firestore/permission-denied",
  "unauthenticated",
  "firestore/unauthenticated",
]);

const shouldRetryWithFreshAuth = (error) => RETRYABLE_CODES.has(String(error?.code || "").toLowerCase());

export const runWithFreshAuthRetry = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    if (!shouldRetryWithFreshAuth(error) || !auth.currentUser) {
      throw error;
    }

    await auth.currentUser.getIdToken(true);
    return operation();
  }
};

export const getDocsWithFreshAuth = (queryRef) => runWithFreshAuthRetry(() => getDocs(queryRef));
export const getDocWithFreshAuth = (docRef) => runWithFreshAuthRetry(() => getDoc(docRef));
export const addDocWithFreshAuth = (collectionRef, data) =>
  runWithFreshAuthRetry(() => addDoc(collectionRef, data));
export const setDocWithFreshAuth = (docRef, data, options) =>
  runWithFreshAuthRetry(() => setDoc(docRef, data, options));
export const updateDocWithFreshAuth = (docRef, data) =>
  runWithFreshAuthRetry(() => updateDoc(docRef, data));
export const deleteDocWithFreshAuth = (docRef) =>
  runWithFreshAuthRetry(() => deleteDoc(docRef));
