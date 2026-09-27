import { describe, expect, it } from "vitest";
import { entryKey } from "./name-key";
import { currentRulesVersion, planCreation, type TargetIndex } from "./creation-target";

const VERSIONED = { versioned: true };
const UNVERSIONED = { versioned: false };

function indexOf(entries: readonly { name: string; requirements?: string }[]): TargetIndex {
  const keys = entries.map((entry) => entryKey(entry.name, entry.requirements));
  return {
    nameKeys: new Set(keys.map((key) => key.name)),
    has: (key) => keys.some((existing) => existing.name === key.name && existing.requirements === key.requirements),
  };
}

describe("planCreation: a versioned kind", () => {
  it("places a new name as it is, with the world's ruleset version", () => {
    const placement = planCreation(VERSIONED, "2014", "Rope, 50 feet", undefined, indexOf([]));
    expect(placement).toEqual({ name: "Rope, 50 feet", renamed: false, version: "2014" });
  });

  it("renames a colliding name, but still creates it with the world's ruleset version (N14 c: no skipping)", () => {
    const placement = planCreation(VERSIONED, "2024", "Rope, 50 feet", undefined, indexOf([{ name: "Rope, 50 feet" }]));
    expect(placement).toEqual({ name: "Rope, 50 feet (Duplicate)", renamed: true, version: "2024" });
  });

  it("numbers further collisions, avoiding every name in the target regardless of requirements", () => {
    const target = indexOf([
      { name: "Rope, 50 feet" },
      { name: "Rope, 50 feet (Duplicate)", requirements: "Wizard 1" },
    ]);
    const placement = planCreation(VERSIONED, "2014", "Rope, 50 feet", undefined, target);
    expect(placement.name).toBe("Rope, 50 feet (Duplicate 2)");
  });

  it("does not collide on name alone when requirements differ (rule R5)", () => {
    const target = indexOf([{ name: "Spellcasting", requirements: "Wizard 1" }]);
    const placement = planCreation(VERSIONED, "2014", "Spellcasting", "Bard 1", target);
    expect(placement).toEqual({ name: "Spellcasting", renamed: false, version: "2014" });
  });

  it("does collide when name and requirements both match", () => {
    const target = indexOf([{ name: "Spellcasting", requirements: "Wizard 1" }]);
    const placement = planCreation(VERSIONED, "2014", "Spellcasting", "Wizard 1", target);
    expect(placement).toMatchObject({ renamed: true });
  });
});

describe("planCreation: an unversioned kind (RollTable, Encounter, Group)", () => {
  it("never sets a version, whichever the world's setting is", () => {
    expect(planCreation(UNVERSIONED, "2014", "Random Loot", undefined, indexOf([])).version).toBeUndefined();
    expect(planCreation(UNVERSIONED, "2024", "Random Loot", undefined, indexOf([])).version).toBeUndefined();
  });

  it("still renames a colliding name", () => {
    const placement = planCreation(UNVERSIONED, "2014", "Random Loot", undefined, indexOf([{ name: "Random Loot" }]));
    expect(placement).toEqual({ name: "Random Loot (Duplicate)", renamed: true });
  });
});

describe("currentRulesVersion", () => {
  // Cross-milestone fix (found during M15 Discover): the raw dnd5e world setting actually holds "modern" or
  // "legacy" (module/settings.mjs), never "2014"/"2024" literally — the previous version of this test asserted
  // the old, wrong behavior (treating "modern" as an unrecognized value that falls back to "2024") as correct.
  it("translates the real setting values, mirroring dnd5e's own source-field.mjs exactly", () => {
    expect(currentRulesVersion(() => "modern")).toBe("2024");
    expect(currentRulesVersion(() => "legacy")).toBe("2014");
  });

  it("falls back to 2014 for anything unrecognized, exactly mirroring dnd5e's own ternary", () => {
    for (const value of [undefined, null, "", "2014", "2024", "2015", 2024]) {
      expect(currentRulesVersion(() => value), String(value)).toBe("2014");
    }
  });
});
