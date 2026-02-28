import { isMarkedDeleted } from "./isMarkedDeleted";

describe("isMarkedDeleted", () => {
  test("returns false for missing or empty data", () => {
    expect(isMarkedDeleted()).toBe(false);
    expect(isMarkedDeleted(null)).toBe(false);
    expect(isMarkedDeleted({})).toBe(false);
  });

  test("detects strict boolean flags", () => {
    expect(isMarkedDeleted({ delete: true })).toBe(true);
    expect(isMarkedDeleted({ deleted: true })).toBe(true);
    expect(isMarkedDeleted({ isDeleted: true })).toBe(true);
    expect(isMarkedDeleted({ softDeleted: true })).toBe(true);
    expect(isMarkedDeleted({ delete: false })).toBe(false);
  });

  test("detects string and numeric markers from admin tools", () => {
    expect(isMarkedDeleted({ delete: "true" })).toBe(true);
    expect(isMarkedDeleted({ deleted: "1" })).toBe(true);
    expect(isMarkedDeleted({ deleted: 1 })).toBe(true);
    expect(isMarkedDeleted({ delete: "false" })).toBe(false);
    expect(isMarkedDeleted({ deleted: "0" })).toBe(false);
    expect(isMarkedDeleted({ delete: 0 })).toBe(false);
  });

  test("detects date-based markers", () => {
    expect(isMarkedDeleted({ deletedAt: new Date() })).toBe(true);
    expect(isMarkedDeleted({ deleteDate: "2026-02-28T09:00:00Z" })).toBe(true);
    expect(isMarkedDeleted({ deletedAt: null })).toBe(false);
  });
});
