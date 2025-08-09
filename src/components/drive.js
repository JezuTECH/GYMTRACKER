// src/google/drive.js
// Helpers para: token, carpetas y (crear/actualizar) archivo en Google Drive

// ⚠️ Pon aquí tu OAuth 2.0 Client ID (el de Web) del mismo proyecto
const CLIENT_ID = "TU_CLIENT_ID_WEB.apps.googleusercontent.com"; // <- cambia esto

// Scope mínimo: solo archivos creados por la app
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let _accessToken = null;
let _tokenClient = null;

// Pide (o refresca) un token válido usando Google Identity Services
export function getDriveAccessToken() {
  return new Promise((resolve, reject) => {
    if (_accessToken) return resolve(_accessToken);

    if (!_tokenClient) {
      _tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp && resp.access_token) {
            _accessToken = resp.access_token;
            resolve(_accessToken);
          } else {
            reject(new Error("No se obtuvo access_token"));
          }
        },
      });
    }
    _tokenClient.requestAccessToken({ prompt: "" }); // no fuerza selector si ya diste permiso
  });
}

// Llama a Drive REST con el token
async function driveFetch(url, options = {}) {
  const token = await getDriveAccessToken();
  const resp = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!resp.ok) {
    const msg = await resp.text();
    throw new Error(`Drive API error ${resp.status}: ${msg}`);
  }
  return resp;
}

// Busca (o crea) carpeta por nombre bajo un parentId dado
async function findOrCreateFolder(name, parentId = "root") {
  // Busca
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  );
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
  const listResp = await driveFetch(listUrl);
  const list = await listResp.json();
  if (list.files && list.files.length > 0) return list.files[0].id;

  // Crea
  const createResp = await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const folder = await createResp.json();
  return folder.id;
}

// Asegura la ruta: GymTracker/Exercises y devuelve folderId final
export async function ensureExercisesFolder() {
  const root = await findOrCreateFolder("GymTracker", "root");
  const exercises = await findOrCreateFolder("Exercises", root);
  return exercises;
}

// Busca un archivo por nombre dentro de una carpeta
async function findFileInFolderByName(folderId, name) {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`;
  const resp = await driveFetch(url);
  const data = await resp.json();
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

// Sube (crea o actualiza) archivo binario por multipart
export async function uploadOrUpdateFile(folderId, fileName, file) {
  const existing = await findFileInFolderByName(folderId, fileName);
  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  // Construye cuerpo multipart/form-data
  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const metadataPart =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata);

  const fileData = await file.arrayBuffer();
  const filePart =
    delimiter +
    `Content-Type: ${file.type || "image/jpeg"}\r\n\r\n`;

  const body = new Blob([
    metadataPart,
    new Uint8Array(fileData),
    closeDelim,
  ], { type: `multipart/related; boundary=${boundary}` });

  if (existing) {
    // Actualiza
    const url = `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`;
    const resp = await driveFetch(url, { method: "PATCH", body });
    return await resp.json();
  } else {
    // Crea
    const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const resp = await driveFetch(url, { method: "POST", body });
    return await resp.json();
  }
}

// Descarga el archivo como Blob (para poder mostrarlo en <img>)
export async function downloadFileBlob(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await driveFetch(url);
  return await resp.blob();
}

// Obtiene (o null) el fileId por nombre en Exercises
export async function getExerciseImageFileId(muscleGroup, exercise) {
  const folderId = await ensureExercisesFolder();
  const fileName = `${muscleGroup}__${exercise}.jpg`.toLowerCase();
  const f = await findFileInFolderByName(folderId, fileName);
  return f ? f.id : null;
}