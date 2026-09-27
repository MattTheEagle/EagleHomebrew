import { describe, expect, it } from "vitest";
import { validateName } from "./creation-form";

describe("validateName", () => {
  it("accepts a plain name", () => {
    expect(validateName("Rope, 50 feet")).toEqual({ ok: true, name: "Rope, 50 feet" });
  });

  it("trims surrounding whitespace", () => {
    expect(validateName("  Rope, 50 feet  ")).toEqual({ ok: true, name: "Rope, 50 feet" });
  });

  it("rejects an empty name", () => {
    expect(validateName("")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a name that is only whitespace", () => {
    expect(validateName("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("accepts a name of exactly 200 characters", () => {
    const name = "x".repeat(200);
    expect(validateName(name)).toEqual({ ok: true, name });
  });

  it("rejects a name over 200 characters", () => {
    expect(validateName("x".repeat(201))).toEqual({ ok: false, reason: "tooLong" });
  });
});
