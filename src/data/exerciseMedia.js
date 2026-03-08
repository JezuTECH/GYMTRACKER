import {
  collection,
  doc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { storage } from "../firebase/config";
import {
  deleteDocWithFreshAuth,
  getDocWithFreshAuth,
  getDocsWithFreshAuth,
  setDocWithFreshAuth,
  runWithFreshAuthRetry,
} from "../firebase/firestoreRetry";
import {
  MAX_PHOTOS_PER_EXERCISE,
  MAX_USER_MEDIA_BYTES,
  validatePhotoUpload,
} from "../utils/exerciseMediaLimits";

const getExerciseMediaCollectionRef = (db, uid, exerciseId) =>
  collection(db, "users", uid, "exercises", exerciseId, "media");

const getUsageDocRef = (db, uid) => doc(db, "users", uid, "appMeta", "mediaUsage");
const getExerciseDocRef = (db, uid, exerciseId) => doc(db, "users", uid, "exercises", exerciseId);

const toMediaItem = (snapshotDoc) => {
  const data = snapshotDoc.data();
  return {
    id: snapshotDoc.id,
    type: String(data.type || "image"),
    storagePath: String(data.storagePath || ""),
    downloadUrl: String(data.downloadUrl || ""),
    contentType: String(data.contentType || "image/jpeg"),
    filename: String(data.filename || ""),
    sizeBytes: Number(data.sizeBytes || 0),
    width: Number(data.width || 0),
    height: Number(data.height || 0),
    createdAt: data.createdAt?.toDate?.() || null,
  };
};

const readUsageBytes = async (db, uid) => {
  const usageSnap = await getDocWithFreshAuth(getUsageDocRef(db, uid));
  const raw = Number(usageSnap.data()?.totalBytes || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
};

const writeUsageBytes = async (db, uid, totalBytes) =>
  setDocWithFreshAuth(
    getUsageDocRef(db, uid),
    {
      totalBytes: Math.max(0, Math.round(totalBytes)),
      maxBytes: MAX_USER_MEDIA_BYTES,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

export const listExerciseMedia = async (db, uid, exerciseId) => {
  if (!uid || !exerciseId) {
    return { items: [], totalBytes: 0 };
  }

  const mediaQuery = query(getExerciseMediaCollectionRef(db, uid, exerciseId), orderBy("createdAt", "desc"));
  const [mediaSnap, totalBytes] = await Promise.all([
    getDocsWithFreshAuth(mediaQuery),
    readUsageBytes(db, uid),
  ]);

  return {
    items: mediaSnap.docs.map(toMediaItem),
    totalBytes,
  };
};

const uploadBlobWithProgress = (path, file, onProgress) =>
  runWithFreshAuthRetry(() => new Promise((resolve, reject) => {
    const objectRef = storageRef(storage, path);
    const task = uploadBytesResumable(objectRef, file, {
      contentType: file.type,
      customMetadata: {
        originalName: file.name,
      },
    });

    task.on(
      "state_changed",
      (snapshot) => {
        if (!onProgress) return;
        const progress = snapshot.totalBytes > 0 ? snapshot.bytesTransferred / snapshot.totalBytes : 0;
        onProgress(progress);
      },
      reject,
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          resolve({ downloadUrl, storagePath: path });
        } catch (error) {
          reject(error);
        }
      }
    );
  }));

export const uploadExercisePhoto = async ({
  db,
  uid,
  exerciseId,
  file,
  width = 0,
  height = 0,
  onProgress,
}) => {
  if (!uid || !exerciseId) {
    throw new Error("Guarda la ficha antes de subir fotos.");
  }

  const collectionRef = getExerciseMediaCollectionRef(db, uid, exerciseId);
  const existingSnap = await getDocsWithFreshAuth(collectionRef);
  const currentBytes = await readUsageBytes(db, uid);
  const currentExerciseBytes = existingSnap.docs.reduce((sum, item) => sum + Number(item.data()?.sizeBytes || 0), 0);
  const validationError = validatePhotoUpload({
    currentCount: existingSnap.size,
    currentBytes,
    incomingBytes: file.size,
  });
  if (validationError) {
    throw new Error(validationError);
  }

  if (existingSnap.size >= MAX_PHOTOS_PER_EXERCISE) {
    throw new Error(`Solo se permiten ${MAX_PHOTOS_PER_EXERCISE} fotos por ejercicio.`);
  }

  const assetRef = doc(collectionRef);
  const path = `users/${uid}/exerciseMedia/${exerciseId}/${assetRef.id}.jpg`;
  const upload = await uploadBlobWithProgress(path, file, onProgress);

  const payload = {
    type: "image",
    storagePath: upload.storagePath,
    downloadUrl: upload.downloadUrl,
    contentType: file.type || "image/jpeg",
    filename: file.name,
    sizeBytes: file.size,
    width,
    height,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDocWithFreshAuth(assetRef, payload, { merge: true });
  await writeUsageBytes(db, uid, currentBytes + file.size);
  await setDocWithFreshAuth(
    getExerciseDocRef(db, uid, exerciseId),
    {
      mediaCount: existingSnap.size + 1,
      mediaBytes: currentExerciseBytes + file.size,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return {
    id: assetRef.id,
    ...payload,
    createdAt: new Date(),
  };
};

export const deleteExercisePhoto = async ({ db, uid, exerciseId, asset }) => {
  if (!uid || !exerciseId || !asset?.id) {
    throw new Error("No se pudo identificar la foto a borrar.");
  }

  const currentBytes = await readUsageBytes(db, uid);
  const collectionRef = getExerciseMediaCollectionRef(db, uid, exerciseId);
  const existingSnap = await getDocsWithFreshAuth(collectionRef);
  const currentExerciseBytes = existingSnap.docs.reduce((sum, item) => sum + Number(item.data()?.sizeBytes || 0), 0);

  if (asset.storagePath) {
    await runWithFreshAuthRetry(() => deleteObject(storageRef(storage, asset.storagePath)));
  }

  await deleteDocWithFreshAuth(doc(db, "users", uid, "exercises", exerciseId, "media", asset.id));
  await writeUsageBytes(db, uid, currentBytes - Number(asset.sizeBytes || 0));
  await setDocWithFreshAuth(
    getExerciseDocRef(db, uid, exerciseId),
    {
      mediaCount: Math.max(0, existingSnap.size - 1),
      mediaBytes: Math.max(0, currentExerciseBytes - Number(asset.sizeBytes || 0)),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};
