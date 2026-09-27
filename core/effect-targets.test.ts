import { describe, expect, it } from "vitest";
import { ACTIVE_EFFECT_MODES } from "./effect-model";
import { EFFECT_TARGETS, effectTargetById, resolveEffectChange } from "./effect-targets";

describe("EFFECT_TARGETS", () => {
  it("has 26 curated targets, each with a non-empty id and key", () => {
    expect(EFFECT_TARGETS.length).toBe(26);
    for (const target of EFFECT_TARGETS) {
      expect(target.id.length).toBeGreaterThan(0);
      expect(target.key.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    const ids = EFFECT_TARGETS.map((target) => target.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never sets both keyParameter and valueParameter on the same target", () => {
    for (const target of EFFECT_TARGETS) {
      expect(target.keyParameter && target.valueParameter, target.id).toBeFalsy();
    }
  });

  it("every keyParameter target has a {0} placeholder in its key", () => {
    for (const target of EFFECT_TARGETS.filter((t) => t.keyParameter)) {
      expect(target.key, target.id).toContain("{0}");
    }
  });

  it("every valueParameter target uses valueKind \"fixed\" and mode ADD (a Set field, grown by adding the key)", () => {
    for (const target of EFFECT_TARGETS.filter((t) => t.valueParameter)) {
      expect(target.valueKind, target.id).toBe("fixed");
      expect(target.mode, target.id).toBe(ACTIVE_EFFECT_MODES.ADD);
    }
  });

  it("grants proficiency with UPGRADE, never OVERRIDE (a granted floor must not downgrade an existing higher proficiency)", () => {
    for (const id of ["skillProficiency", "toolProficiency"]) {
      expect(effectTargetById(id)?.mode).toBe(ACTIVE_EFFECT_MODES.UPGRADE);
      expect(effectTargetById(id)?.valueKind).toBe("proficiencyLevel");
    }
  });
});

describe("effectTargetById", () => {
  it("finds a known target, returns undefined for an unknown one", () => {
    expect(effectTargetById("armorClass")?.key).toBe("system.attributes.ac.bonus");
    expect(effectTargetById("nonsense")).toBeUndefined();
  });
});

describe("resolveEffectChange", () => {
  it("resolves a plain target (no parameter) straight through", () => {
    expect(resolveEffectChange("armorClass", undefined, "+1")).toEqual({
      key: "system.attributes.ac.bonus",
      value: "+1",
      mode: ACTIVE_EFFECT_MODES.ADD,
    });
  });

  it("substitutes a keyParameter into the path, keeps the typed value", () => {
    expect(resolveEffectChange("abilityScore", "str", "1")).toEqual({
      key: "system.abilities.str.value",
      value: "1",
      mode: ACTIVE_EFFECT_MODES.ADD,
    });
  });

  it("uses the valueParameter itself as the value, ignoring any typed value, for a fixed target", () => {
    expect(resolveEffectChange("damageResistance", "fire", "")).toEqual({
      key: "system.traits.dr.value",
      value: "fire",
      mode: ACTIVE_EFFECT_MODES.ADD,
    });
  });

  it("returns undefined when a keyParameter/valueParameter target gets no parameter", () => {
    expect(resolveEffectChange("abilityScore", undefined, "1")).toBeUndefined();
    expect(resolveEffectChange("damageResistance", undefined, "")).toBeUndefined();
  });

  it("returns undefined for an unknown target id", () => {
    expect(resolveEffectChange("nonsense", undefined, "1")).toBeUndefined();
  });
});
