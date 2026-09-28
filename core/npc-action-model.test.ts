import { describe, expect, it } from "vitest";
import { ACTION_FEAT_FIELDS, ACTION_WEAPON_FIELDS, actionItemFields, buildNpcActionItemsChanges, npcActionCategory } from "./npc-action-model";

function fakeIds(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

describe("actionItemFields", () => {
  it("returns the Feat field list for \"feat\" and the Weapon field list for \"weapon\"", () => {
    expect(actionItemFields("feat")).toBe(ACTION_FEAT_FIELDS);
    expect(actionItemFields("weapon")).toBe(ACTION_WEAPON_FIELDS);
  });

  it("gives Feat a way to mark the item as a passive Trait (dnd5e's own \"trait\" property)", () => {
    const properties = ACTION_FEAT_FIELDS.find((field) => field.path === "properties");
    expect(properties?.restrictChoicesTo?.has("trait")).toBe(true);
  });

  it("never offers \"trait\" for Weapon (dnd5e's own validProperties.weapon excludes it)", () => {
    const properties = ACTION_WEAPON_FIELDS.find((field) => field.path === "properties");
    expect(properties?.restrictChoicesTo?.has("trait")).toBe(false);
  });

  it("leaves out damage/base-item/subtype fields (Non-Goal: damage lives on the embedded Activity)", () => {
    const paths = ACTION_WEAPON_FIELDS.map((field) => field.path);
    expect(paths).not.toContain("damage.base");
    expect(paths).not.toContain("damage.versatile");
    expect(paths).not.toContain("type.baseItem");
    expect(ACTION_FEAT_FIELDS.map((field) => field.path)).not.toContain("type.subtype");
  });
});

describe("npcActionCategory", () => {
  it("is \"trait\" whenever the trait property is set, regardless of any activation type", () => {
    expect(npcActionCategory(true, "action")).toBe("trait");
    expect(npcActionCategory(true, undefined)).toBe("trait");
  });

  it("falls back to \"trait\" when there is no activation type (no Activity added)", () => {
    expect(npcActionCategory(false, undefined)).toBe("trait");
  });

  it("uses the activation type when the trait property is not set", () => {
    expect(npcActionCategory(false, "action")).toBe("action");
    expect(npcActionCategory(false, "bonus")).toBe("bonus");
    expect(npcActionCategory(false, "reaction")).toBe("reaction");
    expect(npcActionCategory(false, "legendary")).toBe("legendary");
    expect(npcActionCategory(false, "mythic")).toBe("mythic");
  });

  it("is \"unlisted\" for an activation type dnd5e's own statblock has no bucket for (e.g. \"lair\")", () => {
    expect(npcActionCategory(false, "lair")).toBe("unlisted");
    expect(npcActionCategory(false, "special")).toBe("unlisted");
  });
});

describe("buildNpcActionItemsChanges", () => {
  it("returns an empty object for no drafts (nothing to change)", () => {
    expect(buildNpcActionItemsChanges([], fakeIds())).toEqual({});
  });

  it("builds one items array entry per draft, with a fresh id from the caller", () => {
    const { items } = buildNpcActionItemsChanges(
      [
        { itemType: "feat", name: "Pack Tactics", itemFieldValues: { "properties": ["trait"] } },
        { itemType: "weapon", name: "Bite", itemFieldValues: { "type.value": "natural" } },
      ],
      fakeIds(),
    );
    expect(items).toEqual([
      { _id: "id1", name: "Pack Tactics", type: "feat", system: { properties: ["trait"] } },
      { _id: "id2", name: "Bite", type: "weapon", system: { type: { value: "natural" } } },
    ]);
  });

  it("nests a fresh Activity under the item's own system.activities when a draft has one", () => {
    const { items } = buildNpcActionItemsChanges(
      [
        {
          itemType: "weapon",
          name: "Bite",
          itemFieldValues: { "type.value": "natural" },
          activity: { type: "attack", values: { "activation.type": "action" } },
        },
      ],
      fakeIds(),
    );
    expect(items).toEqual([
      {
        _id: "id1",
        name: "Bite",
        type: "weapon",
        system: {
          type: { value: "natural" },
          activities: { id2: { type: "attack", activation: { type: "action" } } },
        },
      },
    ]);
  });
});
