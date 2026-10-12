import { describe, expect, it } from "vitest";
import {
  advancementTypesFor,
  buildAdvancementConfiguration,
  buildAdvancementData,
  isAdvancementKind,
  normalizeAdvancementFieldValues,
  specForAdvancement,
  validSizeSelection,
} from "./advancement-model";

describe("advancementTypesFor", () => {
  it("matches dnd5e's valid item types for all five Homebrew kinds", () => {
    expect([...advancementTypesFor("class")].sort()).toEqual(
      ["AbilityScoreImprovement", "HitPoints", "ItemChoice", "ItemGrant", "ScaleValue", "Subclass", "Trait"].sort(),
    );
    expect([...advancementTypesFor("subclass")].sort()).toEqual(["ItemChoice", "ItemGrant", "ScaleValue", "Trait"].sort());
    for (const kind of ["feat", "background"] as const) {
      expect([...advancementTypesFor(kind)].sort()).toEqual(
        ["AbilityScoreImprovement", "ItemChoice", "ItemGrant", "ScaleValue", "Trait"].sort(),
      );
    }
    expect([...advancementTypesFor("species")].sort()).toEqual(
      ["AbilityScoreImprovement", "ItemChoice", "ItemGrant", "ScaleValue", "Size", "Trait"].sort(),
    );
  });

  it("offers Size only once per Species draft and restores it after removal", () => {
    expect(advancementTypesFor("species", []).includes("Size")).toBe(true);
    expect(advancementTypesFor("species", ["Trait", "Size"])).not.toContain("Size");
    expect(advancementTypesFor("species", ["Trait"])).toContain("Size");
  });
});

describe("isAdvancementKind", () => {
  it("accepts exactly the five kinds with AdvancementTemplate forms", () => {
    for (const kind of ["class", "subclass", "feat", "background", "species"]) expect(isAdvancementKind(kind)).toBe(true);
    for (const kind of ["spell", "npc", "loot", "race", ""]) expect(isAdvancementKind(kind)).toBe(false);
  });
});

describe("specForAdvancement", () => {
  it("omits a separate level for native multi-level types and Size", () => {
    for (const type of ["HitPoints", "ItemChoice", "ScaleValue", "Size"] as const) expect(specForAdvancement(type).hasLevel).toBe(false);
  });

  it("keeps a single level for the four single-level types", () => {
    for (const type of ["AbilityScoreImprovement", "Subclass", "ItemGrant", "Trait"] as const) {
      expect(specForAdvancement(type).hasLevel).toBe(true);
    }
  });

  it("models Size as an actor-size multi-select", () => {
    expect(specForAdvancement("Size").fields).toEqual([{ path: "sizes", widget: "set", choicesKind: "actorSizes" }]);
  });

  it("models ItemChoice's item type separately from feature and spell restrictions", () => {
    expect(specForAdvancement("ItemChoice").fields).toEqual(
      expect.arrayContaining([
        { path: "type", widget: "select", choicesKind: "advancementItemTypes" },
        { path: "restriction.type", widget: "select", choicesKind: "featureTypes" },
        { path: "restriction.subtype", widget: "select" },
        { path: "restriction.level", widget: "select", choicesKind: "advancementSpellLevels" },
        { path: "restriction.list", widget: "set", choicesKind: "advancementSpellLists" },
      ]),
    );
  });

  it("throws for an unknown type", () => {
    // @ts-expect-error deliberately invalid input
    expect(() => specForAdvancement("NotAType")).toThrow();
  });
});

describe("normalizeAdvancementFieldValues", () => {
  const mixed = {
    type: "feat",
    "restriction.type": "class",
    "restriction.subtype": "classFeature",
    "restriction.level": "5",
    "restriction.list": ["class:wizard"],
    spell: { method: "spell" },
    allowDrops: true,
  } as const;

  it("keeps only Feature restrictions for a Feature ItemChoice", () => {
    expect(normalizeAdvancementFieldValues("ItemChoice", mixed)).toEqual({
      type: "feat",
      "restriction.type": "class",
      "restriction.subtype": "classFeature",
      allowDrops: true,
    });
  });

  it("keeps only Spell restrictions for a Spell ItemChoice", () => {
    expect(normalizeAdvancementFieldValues("ItemChoice", { ...mixed, type: "spell" })).toEqual({
      type: "spell",
      "restriction.level": "5",
      "restriction.list": ["class:wizard"],
      spell: { method: "spell" },
      allowDrops: true,
    });
  });

  it("drops both restriction groups for any other or unrestricted ItemChoice", () => {
    expect(normalizeAdvancementFieldValues("ItemChoice", { ...mixed, type: "weapon" })).toEqual({ type: "weapon", allowDrops: true });
    expect(normalizeAdvancementFieldValues("ItemChoice", { ...mixed, type: "" })).toEqual({ type: "", allowDrops: true });
  });

  it("does not alter another Advancement type", () => {
    expect(normalizeAdvancementFieldValues("Trait", mixed)).toEqual(mixed);
  });
});

describe("validSizeSelection", () => {
  it("requires at least one non-empty size", () => {
    expect(validSizeSelection({ sizes: ["sm", "med"] })).toBe(true);
    expect(validSizeSelection({ sizes: [] })).toBe(false);
    expect(validSizeSelection({ sizes: [""] })).toBe(false);
    expect(validSizeSelection({})).toBe(false);
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

  it("merges a table into ItemChoice and ignores its obsolete single level", () => {
    expect(buildAdvancementData("ItemChoice", 3, { allowDrops: true }, { choices: { "3": { count: 1 } } })).toEqual({
      type: "ItemChoice",
      configuration: { allowDrops: true, choices: { "3": { count: 1 } } },
    });
  });

  it("builds Size without level or runtime value", () => {
    expect(buildAdvancementData("Size", 0, { sizes: ["sm", "med"] })).toEqual({
      type: "Size",
      configuration: { sizes: ["sm", "med"] },
    });
  });

  it("omits level when undefined even for a type that has one", () => {
    expect(buildAdvancementData("ItemGrant", undefined, { optional: true })).toEqual({
      type: "ItemGrant",
      configuration: { optional: true },
    });
  });
});
