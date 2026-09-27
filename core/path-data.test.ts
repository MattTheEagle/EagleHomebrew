import { describe, expect, it } from "vitest";
import { buildPathData } from "./path-data";

describe("buildPathData", () => {
  it("expands a single dotted path into a nested object", () => {
    expect(buildPathData({ "system.source.rules": "2014" })).toEqual({ system: { source: { rules: "2014" } } });
  });

  it("expands a deeper path", () => {
    expect(buildPathData({ "attack.type.value": "melee" })).toEqual({ attack: { type: { value: "melee" } } });
  });

  it("keeps a plain (non-dotted) key as-is", () => {
    expect(buildPathData({ name: "Rope" })).toEqual({ name: "Rope" });
  });

  it("merges two paths that share a prefix", () => {
    expect(buildPathData({ "attack.ability": "str", "attack.bonus": "+1" })).toEqual({
      attack: { ability: "str", bonus: "+1" },
    });
  });

  it("merges paths that share a prefix at different depths", () => {
    expect(buildPathData({ "attack.ability": "str", "attack.type.value": "melee", "attack.type.classification": "weapon" })).toEqual({
      attack: { ability: "str", type: { value: "melee", classification: "weapon" } },
    });
  });

  it("keeps unrelated top-level keys apart", () => {
    expect(buildPathData({ name: "Rope", "system.source.rules": "2024", type: "loot" })).toEqual({
      name: "Rope",
      type: "loot",
      system: { source: { rules: "2024" } },
    });
  });

  it("keeps non-string JSON values (e.g. a change list) as leaves", () => {
    expect(buildPathData({ changes: [{ key: "system.bonuses.mwak.damage", value: "+1", mode: 2 }] })).toEqual({
      changes: [{ key: "system.bonuses.mwak.damage", value: "+1", mode: 2 }],
    });
  });

  it("a later path wins when the exact same path is given twice", () => {
    expect(buildPathData(Object.fromEntries([["attack.ability", "str"]]))).toEqual({ attack: { ability: "str" } });
  });

  it("returns an empty object for no values", () => {
    expect(buildPathData({})).toEqual({});
  });
});
