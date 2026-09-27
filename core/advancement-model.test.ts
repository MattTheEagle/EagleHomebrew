import { describe, expect, it } from "vitest";
import { ADVANCEMENT_TYPES, advancementTypesFor, buildAdvancementConfiguration, buildAdvancementData, specForAdvancement } from "./advancement-model";

describe("advancementTypesFor", () => {
  it("gives Class all seven types", () => {
    expect([...advancementTypesFor("class")].sort()).toEqual(
      ["AbilityScoreImprovement", "HitPoints", "ItemChoice", "ItemGrant", "ScaleValue", "Subclass", "Trait"].sort(),
    );
  });

  it("gives Subclass only the four types not restricted to Class", () => {
    expect([...advancementTypesFor("subclass")].sort()).toEqual(["ItemChoice", "ItemGrant", "ScaleValue", "Trait"].sort());
  });

  it("never offers Size, which is race-only and not modelled at all", () => {
    expect(ADVANCEMENT_TYPES.some((entry) => (entry.type as string) === "Size")).toBe(false);
  });
});

describe("specForAdvancement", () => {
  it("marks HitPoints as having no level field (dnd5e's own multiLevel type)", () => {
    expect(specForAdvancement("HitPoints").hasLevel).toBe(false);
  });

  it("marks every other type as having a level field", () => {
    for (const type of ["AbilityScoreImprovement", "Subclass", "ItemGrant", "ItemChoice", "ScaleValue", "Trait"] as const) {
      expect(specForAdvancement(type).hasLevel).toBe(true);
    }
  });

  it("throws for an unknown type", () => {
    // @ts-expect-error deliberately invalid input
    expect(() => specForAdvancement("NotAType")).toThrow();
  });
});

describe("buildAdvancementConfiguration", () => {
  it("nests dotted paths and drops empty strings", () => {
    expect(buildAdvancementConfiguration({ "restriction.type": "weapon", "restriction.subtype": "", points: 2 })).toEqual({
      restriction: { type: "weapon" },
      points: 2,
    });
  });

  it("keeps non-string falsy values (false, 0)", () => {
    expect(buildAdvancementConfiguration({ optional: false, points: 0 })).toEqual({ optional: false, points: 0 });
  });

  it("returns an empty object for no values", () => {
    expect(buildAdvancementConfiguration({})).toEqual({});
  });
});

describe("buildAdvancementData", () => {
  it("builds HitPoints with no level and no configuration", () => {
    expect(buildAdvancementData("HitPoints", undefined, {})).toEqual({ type: "HitPoints" });
  });

  it("builds Subclass with a level and no configuration", () => {
    expect(buildAdvancementData("Subclass", 3, {})).toEqual({ type: "Subclass", level: 3 });
  });

  it("builds AbilityScoreImprovement with level and flat configuration", () => {
    expect(buildAdvancementData("AbilityScoreImprovement", 4, { points: 2, cap: 20 })).toEqual({
      type: "AbilityScoreImprovement",
      level: 4,
      configuration: { points: 2, cap: 20 },
    });
  });

  it("merges a table into the configuration, the table winning on a name clash", () => {
    expect(
      buildAdvancementData("ItemChoice", 3, { allowDrops: true }, { choices: { "3": { count: 1 } } }),
    ).toEqual({
      type: "ItemChoice",
      level: 3,
      configuration: { allowDrops: true, choices: { "3": { count: 1 } } },
    });
  });

  it("omits level when undefined even for a type that has one", () => {
    expect(buildAdvancementData("ItemGrant", undefined, { optional: true })).toEqual({
      type: "ItemGrant",
      configuration: { optional: true },
    });
  });
});
