import { describe, expect, it } from "vitest";
import { ACTIVITY_TYPES, buildActivityData, specFor } from "./activity-model";

const TYPES = ["attack", "damage", "save", "check", "heal"] as const;

describe("ACTIVITY_TYPES", () => {
  it("has exactly the five start types (M5 Discover, Befund 3)", () => {
    expect(ACTIVITY_TYPES.map((spec) => spec.type).sort()).toEqual([...TYPES].sort());
  });

  it("gives every type the base fields plus at least one type-specific field", () => {
    for (const spec of ACTIVITY_TYPES) {
      expect(spec.fields.some((field) => field.path === "name")).toBe(true);
      expect(spec.fields.some((field) => field.path === "activation.type")).toBe(true);
      expect(spec.fields.length).toBeGreaterThan(20); // base (~28) + type-specific fields
    }
  });

  it("marks name, activation type, and the manual condition as basic (always visible)", () => {
    for (const spec of ACTIVITY_TYPES) {
      expect(spec.fields.find((field) => field.path === "name")?.group).toBe("basic");
      expect(spec.fields.find((field) => field.path === "activation.type")?.group).toBe("basic");
      expect(spec.fields.find((field) => field.path === "activation.condition")?.group).toBe("basic");
    }
  });

  it("marks every field with a path and a widget (no gaps, N21)", () => {
    for (const spec of ACTIVITY_TYPES) {
      for (const field of spec.fields) {
        expect(field.path.length).toBeGreaterThan(0);
        expect(field.widget).toEqual(expect.any(String));
      }
    }
  });

  it("marks the damage/save/heal ability and damage fields as basic (the project lead's example: attribute, damage type, formula/bonus)", () => {
    expect(specFor("attack").fields.find((f) => f.path === "attack.ability")?.group).toBe("basic");
    expect(specFor("attack").fields.find((f) => f.path === "damage.parts")?.group).toBe("basic");
    expect(specFor("save").fields.find((f) => f.path === "save.ability")?.group).toBe("basic");
    expect(specFor("heal").fields.find((f) => f.path === "healing")?.group).toBe("basic");
  });

  it("gives damage-type fields the damageTypes choices kind, ability fields the abilities kind", () => {
    expect(specFor("attack").fields.find((f) => f.path === "attack.ability")?.choicesKind).toBe("abilities");
    expect(specFor("damage").fields.find((f) => f.path === "damage.parts")?.choicesKind).toBe("damageTypes");
    expect(specFor("heal").fields.find((f) => f.path === "healing")?.choicesKind).toBe("healingTypes");
  });

  it("gives the shared duration/range/target fields a select widget with a choicesKind (M12 live-check rework: no more free text)", () => {
    expect(specFor("attack").fields.find((f) => f.path === "duration.units")?.widget).toBe("select");
    expect(specFor("attack").fields.find((f) => f.path === "duration.units")?.choicesKind).toBe("durationUnits");
    expect(specFor("attack").fields.find((f) => f.path === "range.units")?.widget).toBe("select");
    expect(specFor("attack").fields.find((f) => f.path === "range.units")?.choicesKind).toBe("distanceUnits");
    expect(specFor("attack").fields.find((f) => f.path === "target.template.type")?.widget).toBe("select");
    expect(specFor("attack").fields.find((f) => f.path === "target.template.type")?.choicesKind).toBe("areaTargetTypes");
    expect(specFor("attack").fields.find((f) => f.path === "target.affects.type")?.widget).toBe("select");
    expect(specFor("attack").fields.find((f) => f.path === "target.affects.type")?.choicesKind).toBe("individualTargetTypes");
  });

  it("uses the list widget for array-shaped dnd5e fields other than damage.parts (effects, uses.recovery, consumption.targets)", () => {
    for (const path of ["effects", "uses.recovery", "consumption.targets"]) {
      expect(specFor("attack").fields.find((f) => f.path === path)?.widget).toBe("list");
    }
  });

  it("gives damage.parts its own damagePart widget, not the generic list widget (M7 Deploy refinement)", () => {
    for (const type of ["attack", "damage", "save"] as const) {
      expect(specFor(type).fields.find((f) => f.path === "damage.parts")?.widget).toBe("damagePart");
    }
  });

  it("gives heal's healing field its own healingPart widget, not individual generic sub-fields (M7 Deploy rework)", () => {
    expect(specFor("heal").fields.find((f) => f.path === "healing")?.widget).toBe("healingPart");
    expect(specFor("heal").fields.some((f) => f.path.startsWith("healing."))).toBe(false);
  });
});

describe("specFor", () => {
  it("throws for an unknown type", () => {
    // @ts-expect-error — deliberately invalid input to check the runtime guard
    expect(() => specFor("nonsense")).toThrow();
  });
});

describe("buildActivityData", () => {
  it("always sets type, even with no other values", () => {
    expect(buildActivityData("attack", {})).toEqual({ type: "attack" });
  });

  it("nests dotted-path values (M4 Deploy correction, generalized via path-data.ts)", () => {
    expect(buildActivityData("attack", { "attack.ability": "str" })).toEqual({
      type: "attack",
      attack: { ability: "str" },
    });
  });

  it("drops an empty string value, letting the dnd5e default apply", () => {
    expect(buildActivityData("check", { "check.ability": "" })).toEqual({ type: "check" });
  });

  it("keeps a non-string value even when it looks falsy (0, false, an empty array)", () => {
    expect(buildActivityData("attack", { "attack.critical.threshold": 0, "attack.flat": false, "damage.parts": [] })).toEqual({
      type: "attack",
      attack: { critical: { threshold: 0 }, flat: false },
      damage: { parts: [] },
    });
  });

  it("keeps a ready-made damage array and native manual condition untouched", () => {
    const parts = [{ number: 2, denomination: 6, bonus: "", types: ["fire"] }];
    expect(buildActivityData("damage", { "activation.condition": "Only against undead", "damage.parts": parts })).toEqual({
      type: "damage",
      activation: { condition: "Only against undead" },
      damage: { parts },
    });
  });

  it("merges several dotted values that share a prefix, as buildPathData does", () => {
    expect(
      buildActivityData("save", {
        "save.ability": ["dex"],
        "save.dc.formula": "15",
        "damage.parts": [{ number: 8, denomination: 6, bonus: "", types: ["fire"] }],
        "damage.onSave": "half",
      }),
    ).toEqual({
      type: "save",
      save: { ability: ["dex"], dc: { formula: "15" } },
      damage: { parts: [{ number: 8, denomination: 6, bonus: "", types: ["fire"] }], onSave: "half" },
    });
  });
});
