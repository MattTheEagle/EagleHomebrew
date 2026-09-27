import { describe, expect, it } from "vitest";
import { ACTIVE_EFFECT_MODES, buildEffectData } from "./effect-model";

describe("ACTIVE_EFFECT_MODES", () => {
  it("has the six modes of CONST.ACTIVE_EFFECT_MODES (M5 Discover, Befund 4)", () => {
    expect(ACTIVE_EFFECT_MODES).toEqual({ CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 });
  });
});

describe("buildEffectData", () => {
  it("builds a name and an empty changes list", () => {
    expect(buildEffectData({ name: "Fire Bonus", changes: [] })).toEqual({ name: "Fire Bonus", changes: [] });
  });

  it("builds one change with its key, value and mode", () => {
    const effect = { name: "Fire Bonus", changes: [{ key: "system.bonuses.mwak.damage", value: "+1d6", mode: ACTIVE_EFFECT_MODES.ADD }] };
    expect(buildEffectData(effect)).toEqual({
      name: "Fire Bonus",
      changes: [{ key: "system.bonuses.mwak.damage", value: "+1d6", mode: 2 }],
    });
  });

  it("keeps several changes in order", () => {
    const effect = {
      name: "Two Changes",
      changes: [
        { key: "system.attributes.ac.bonus", value: "+1", mode: ACTIVE_EFFECT_MODES.ADD },
        { key: "system.abilities.str.value", value: "20", mode: ACTIVE_EFFECT_MODES.UPGRADE },
      ],
    };
    expect(buildEffectData(effect).changes).toEqual([
      { key: "system.attributes.ac.bonus", value: "+1", mode: 2 },
      { key: "system.abilities.str.value", value: "20", mode: 4 },
    ]);
  });
});
