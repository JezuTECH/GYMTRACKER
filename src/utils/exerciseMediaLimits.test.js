import {
  MAX_PHOTO_BYTES,
  MAX_USER_MEDIA_BYTES,
  formatBytesLabel,
  getRemainingPhotoSlots,
  validatePhotoUpload,
} from "./exerciseMediaLimits";

describe("exerciseMediaLimits", () => {
  test("formatea bytes de forma legible", () => {
    expect(formatBytesLabel(0)).toBe("0 MB");
    expect(formatBytesLabel(1536)).toBe("2 KB");
    expect(formatBytesLabel(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  test("calcula huecos restantes por ejercicio", () => {
    expect(getRemainingPhotoSlots(0)).toBe(4);
    expect(getRemainingPhotoSlots(3)).toBe(1);
    expect(getRemainingPhotoSlots(8)).toBe(0);
  });

  test("valida exceso de fotos por ejercicio", () => {
    expect(validatePhotoUpload({ currentCount: 4, currentBytes: 0, incomingBytes: 10 })).toContain("4 fotos");
  });

  test("valida límite por fichero", () => {
    expect(
      validatePhotoUpload({ currentCount: 1, currentBytes: 0, incomingBytes: MAX_PHOTO_BYTES + 1 })
    ).toContain("2.0 MB");
  });

  test("valida cuota total por usuario", () => {
    expect(
      validatePhotoUpload({
        currentCount: 1,
        currentBytes: MAX_USER_MEDIA_BYTES - 100,
        incomingBytes: 101,
      })
    ).toContain("500 MB");
  });

  test("permite subida válida", () => {
    expect(validatePhotoUpload({ currentCount: 1, currentBytes: 1000, incomingBytes: 1000 })).toBe("");
  });
});
