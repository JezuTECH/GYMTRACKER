import { MAX_PHOTO_BYTES } from "./exerciseMediaLimits";

const MAX_DIMENSION = 1600;
const MIN_QUALITY = 0.5;

const loadImageElement = (file) =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    };
    image.src = objectUrl;
  });

const canvasToBlob = (canvas, quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("No se pudo generar la imagen comprimida."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", quality);
  });

const buildCanvas = (image, scale) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("No se pudo preparar la compresión de la imagen.");
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const safePhotoName = (name = "foto") =>
  String(name)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "foto";

export const compressImageFile = async (file, options = {}) => {
  if (!file) {
    throw new Error("No hay fichero para comprimir.");
  }

  if (!file.type.startsWith("image/")) {
    throw new Error("Solo se permiten imágenes.");
  }

  const targetBytes = options.targetBytes || MAX_PHOTO_BYTES;
  const image = await loadImageElement(file);
  const longestSide = Math.max(image.width, image.height, 1);
  let scale = longestSide > MAX_DIMENSION ? MAX_DIMENSION / longestSide : 1;
  let bestBlob = null;

  for (let step = 0; step < 4; step += 1) {
    const canvas = buildCanvas(image, scale);
    for (let quality = 0.86; quality >= MIN_QUALITY; quality -= 0.08) {
      const blob = await canvasToBlob(canvas, quality);
      bestBlob = blob;
      if (blob.size <= targetBytes) {
        return {
          file: new File([blob], `${safePhotoName(file.name)}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          }),
          width: canvas.width,
          height: canvas.height,
        };
      }
    }
    scale *= 0.82;
  }

  if (!bestBlob) {
    throw new Error("No se pudo comprimir la imagen.");
  }

  return {
    file: new File([bestBlob], `${safePhotoName(file.name)}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    }),
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  };
};
