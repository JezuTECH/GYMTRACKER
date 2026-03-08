import {
  ref,
  uploadBytesResumable, // ⬅️ importante para ver progreso de subida
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { storage } from "./config";

export {
  storage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
};
