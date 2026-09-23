import { describe, expect, it } from "vitest";
import { majorOrMinor, toMajor } from "./money";

describe("toMajor", () => {
  it("converts cents to currency units", () => {
    expect(toMajor(2599)).toBe(25.99);
    expect(toMajor(-1250)).toBe(-12.5);
    expect(toMajor(0)).toBe(0);
  });

  it("reads a missing amount as zero rather than NaN", () => {
    expect(toMajor(undefined)).toBe(0);
    expect(toMajor(null)).toBe(0);
  });
});

describe("majorOrMinor", () => {
  it("prefers the decimal amount when the provider sends one", () => {
    expect(majorOrMinor(1234.56, 999)).toBe(1234.56);
  });

  it("keeps a decimal zero rather than falling through to cents", () => {
    // `0 || cents` would have reported the stale cents value instead.
    expect(majorOrMinor(0, 5000)).toBe(0);
  });

  it("falls back to cents when the decimal is absent", () => {
    expect(majorOrMinor(undefined, 123456)).toBe(1234.56);
    expect(majorOrMinor(null, undefined)).toBe(0);
  });
});
