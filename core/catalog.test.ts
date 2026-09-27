import { describe, expect, it } from "vitest";
import { CATALOG, entryByKey, subcategoriesOf } from "./catalog";

// The 19 keys of EagleLibrary/docs/library-convention.md section 1, minus "journals" (Homebrew creates no journal
// entries) — the 18 keys this catalog must have, exactly, in no particular set order.
const LIBRARY_KEYS_WITHOUT_JOURNALS = [
  "weapons",
  "equipment",
  "consumables",
  "tools",
  "loot",
  "containers",
  "species",
  "backgrounds",
  "classes",
  "subclasses",
  "spells",
  "feats",
  "facilities",
  "npcs",
  "vehicles",
  "encounters",
  "groups",
  "rolltables",
].sort();

describe("CATALOG", () => {
  it("has exactly 18 entries (N15: 19 Library kinds minus journals)", () => {
    expect(CATALOG).toHaveLength(18);
  });

  it("has exactly the Library's keys, minus journals, none twice", () => {
    expect(CATALOG.map((entry) => entry.key).sort()).toEqual(LIBRARY_KEYS_WITHOUT_JOURNALS);
  });

  it("groups into 13 Item, 4 Actor and 1 RollTable entries", () => {
    const byArt = { Item: 0, Actor: 0, RollTable: 0 };
    for (const entry of CATALOG) byArt[entry.art] += 1;
    expect(byArt).toEqual({ Item: 13, Actor: 4, RollTable: 1 });
  });

  it("gives every kind a worldType equal to its art (Homebrew never creates a JournalEntry)", () => {
    for (const entry of CATALOG) expect(entry.worldType).toBe(entry.art);
  });

  it("gives every Item and Actor entry a subtype, and RollTable none", () => {
    for (const entry of CATALOG) {
      if (entry.art === "RollTable") expect(entry.subtype).toBeUndefined();
      else expect(entry.subtype).toEqual(expect.any(String));
    }
  });

  it("versions Items, NPCs and Vehicles; leaves Encounter, Group and RollTable unversioned", () => {
    for (const entry of CATALOG) {
      if (entry.art === "Item" || entry.key === "npcs" || entry.key === "vehicles") expect(entry.versioned).toBe(true);
      else expect(entry.versioned).toBe(false);
    }
  });

  it("gives Species the dnd5e subtype \"race\" (the interface says Species)", () => {
    expect(entryByKey("species")?.subtype).toBe("race");
  });

  it("marks exactly the seven kinds with dnd5e's ActivitiesTemplate as hasActivities (M7 Discover, Befund 1)", () => {
    const withActivities = CATALOG.filter((entry) => entry.hasActivities).map((entry) => entry.key).sort();
    expect(withActivities).toEqual(["consumables", "equipment", "facilities", "feats", "spells", "tools", "weapons"].sort());
    // No Actor kind and no RollTable has activities.
    for (const entry of CATALOG) {
      if (entry.art !== "Item") expect(entry.hasActivities, entry.key).toBe(false);
    }
  });

  it("marks exactly the six kinds with dnd5e's metadata.hasEffects as hasEffects (M11b Discover)", () => {
    const withEffects = CATALOG.filter((entry) => entry.hasEffects).map((entry) => entry.key).sort();
    expect(withEffects).toEqual(["consumables", "equipment", "feats", "spells", "tools", "weapons"].sort());
    // Independent of hasActivities: "facilities" has activities but not effects.
    expect(entryByKey("facilities")?.hasEffects).toBe(false);
    // No Actor kind and no RollTable has effects (not modeled yet, see the field's own comment).
    for (const entry of CATALOG) {
      if (entry.art !== "Item") expect(entry.hasEffects, entry.key).toBe(false);
    }
  });
});

describe("subcategoriesOf", () => {
  it("returns the 13 Item entries for Item", () => {
    expect(subcategoriesOf("Item")).toHaveLength(13);
    expect(subcategoriesOf("Item").every((entry) => entry.art === "Item")).toBe(true);
  });

  it("returns the 4 Actor entries for Actor", () => {
    expect(subcategoriesOf("Actor")).toHaveLength(4);
  });

  it("returns the single rolltables entry for RollTable (the window skips showing it as a step, M4 Apply section 3)", () => {
    expect(subcategoriesOf("RollTable")).toEqual([entryByKey("rolltables")]);
  });
});

describe("entryByKey", () => {
  it("finds an entry by its key", () => {
    expect(entryByKey("loot")).toMatchObject({ key: "loot", art: "Item", subtype: "loot", versioned: true });
  });

  it("returns undefined for an unknown key", () => {
    expect(entryByKey("journals")).toBeUndefined();
    expect(entryByKey("nonsense")).toBeUndefined();
  });
});
