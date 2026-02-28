const FALSE_STRINGS = new Set(["", "0", "false", "no", "n", "off", "null", "undefined"]);

const isTruthyDeleteFlag = (value) => {
  if (value === true) return true;
  if (value === false || value == null) return false;

  if (typeof value === "number") return value !== 0;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (FALSE_STRINGS.has(normalized)) return false;
    return normalized.length > 0;
  }

  // Date/Timestamp/object markers are treated as deleted.
  if (typeof value === "object") return true;

  return Boolean(value);
};

const hasDeleteDateMarker = (value) => value !== undefined && value !== null && value !== "";

export const isMarkedDeleted = (data) => {
  if (!data || typeof data !== "object") return false;

  if (
    isTruthyDeleteFlag(data.delete) ||
    isTruthyDeleteFlag(data.deleted) ||
    isTruthyDeleteFlag(data.isDeleted) ||
    isTruthyDeleteFlag(data.softDeleted)
  ) {
    return true;
  }

  return (
    hasDeleteDateMarker(data.deletedAt) ||
    hasDeleteDateMarker(data.deleteAt) ||
    hasDeleteDateMarker(data.deletedOn) ||
    hasDeleteDateMarker(data.deleteOn) ||
    hasDeleteDateMarker(data.deletedDate) ||
    hasDeleteDateMarker(data.deleteDate)
  );
};

export default isMarkedDeleted;
