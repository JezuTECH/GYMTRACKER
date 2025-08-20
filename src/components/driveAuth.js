// src/driveAuth.js
// Solo necesario si en el futuro quieres pedir permisos extra (Drive, etc.)
import { reauthenticateWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth, googleProvider } from "./firebase/config";

/**
 * Fuerza reapertura del popup de Google para obtener un accessToken con scopes extra.
 * Devuelve accessToken si todo va bien.
 */
export async function ensureDriveAccessToken() {
  // Asegúrate de tener un usuario activo
  const user = auth.currentUser;
  if (!user) throw new Error("No hay usuario autenticado.");

  // Reautentica con popup usando el mismo provider (debe tener añadidos los scopes antes)
  const result = await reauthenticateWithPopup(user, googleProvider);

  // Extrae credenciales de Google
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;

  if (!accessToken) {
    throw new Error("No se pudo obtener el accessToken de Google.");
  }
  return accessToken;
}