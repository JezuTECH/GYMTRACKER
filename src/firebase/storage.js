import {
  getStorage,
  ref,
  uploadBytes,
  uploadBytesResumable, // ⬅️ importación que falta
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { app } from "./config";

const storage = getStorage(app);

export {
  storage,
  ref,
  uploadBytes,
  uploadBytesResumable, // ⬅️ exportación que falta
  getDownloadURL,
  deleteObject,
};
