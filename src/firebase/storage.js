// src/storage.js
import {
  getStorage,
  ref,
  uploadBytes,
  uploadBytesResumable, // ⬅️ importante para ver progreso de subida
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { app } from "./firebase/config";

const storage = getStorage(app);

export {
  storage,
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
};
