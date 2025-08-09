// helpers/driveAuth.js
import { reauthenticateWithPopup } from "firebase/auth";
import { googleProvider } from "../firebase/config";

export async function ensureDriveAccessToken(user) {
  // Pide el consentimiento (si ya lo dio, no verá nada)
  const result = await reauthenticateWithPopup(user, googleProvider);
  const cred = window.google && result?._tokenResponse
    ? null // (para compatibilidad antigua)
    : result; // no importa, abajo sacamos cred igual

  const credential = (window.google && cred) // defensa
    ? null
    : (await import("firebase/auth")).GoogleAuthProvider
        .credentialFromResult(result);

  const accessToken = credential?.accessToken;
  if (!accessToken) throw new Error("No se pudo obtener el accessToken de Google.");
  return accessToken;
}