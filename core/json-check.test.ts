import { describe, expect, it } from "vitest";
import { findJsonViolation } from "./json-check";

describe("findJsonViolation", () => {
  it("finds nothing wrong with plain JSON-shaped data", () => {
    expect(findJsonViolation({ a: 1, b: "x", c: [true, null, { d: 2 }] })).toBeUndefined();
  });

  it("reports a non-finite number with its path", () => {
    expect(findJsonViolation({ a: { b: NaN } })).toBe("$.a.b (number, not finite: NaN)");
    expect(findJsonViolation({ a: Infinity })).toBe("$.a (number, not finite: Infinity)");
  });

  it("reports undefined with its path, including inside an array", () => {
    expect(findJsonViolation({ a: undefined })).toBe("$.a (undefined)");
    expect(findJsonViolation({ a: [1, undefined] })).toBe("$.a[1] (undefined)");
  });

  it("reports a class instance (not a plain object) with its constructor name", () => {
    expect(findJsonViolation({ a: new Set(["fire"]) })).toBe("$.a (not a plain object: Set)");
    expect(findJsonViolation({ a: new Date() })).toBe("$.a (not a plain object: Date)");
  });

  it("reports a function and a cycle", () => {
    expect(findJsonViolation({ a: () => 1 })).toBe("$.a (function)");
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(findJsonViolation(cyclic)).toBe("$.self (cycle)");
  });
});
