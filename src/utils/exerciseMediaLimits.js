export const MAX_PHOTOS_PER_EXERCISE = 4;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_USER_MEDIA_BYTES = 500 * 1024 * 1024;

export const formatBytesLabel = (bytes) => {
  const safe = Number(bytes);
  if (!Number.isFinite(safe) || safe <= 0) return "0 MB";
  if (safe >= 1024 * 1024) {
    return `${(safe / (1024 * 1024)).toFixed(safe >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  if (safe >= 1024) {
    return `${Math.round(safe / 1024)} KB`;
  }
  return `${Math.round(safe)} B`;
};

export const getRemainingPhotoSlots = (currentCount) =>
  Math.max(0, MAX_PHOTOS_PER_EXERCISE - Math.max(0, Number(currentCount) || 0));

export const validatePhotoUpload = ({
  currentCount = 0,
  currentBytes = 0,
  incomingBytes = 0,
}) => {
  if (currentCount >= MAX_PHOTOS_PER_EXERCISE) {
    return `Solo se permiten ${MAX_PHOTOS_PER_EXERCISE} fotos por ejercicio.`;
  }

  if (incomingBytes > MAX_PHOTO_BYTES) {
    return `La foto supera ${formatBytesLabel(MAX_PHOTO_BYTES)} tras la compresión.`;
  }

  if (currentBytes + incomingBytes > MAX_USER_MEDIA_BYTES) {
    return `Has alcanzado la cuota de ${formatBytesLabel(MAX_USER_MEDIA_BYTES)} por usuario.`;
  }

  return "";
};

