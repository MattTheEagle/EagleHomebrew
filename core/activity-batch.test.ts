import { describe, expect, it } from "vitest";
import { buildActivitiesChanges, type ActivityDraft } from "./activity-batch";

// A deterministic id sequence ("id1", "id2", ...) so the tests can check exactly which id went where.
function idSequence(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

describe("buildActivitiesChanges", () => {
  it("returns an empty object for no drafts", () => {
    expect(buildActivitiesChanges([], idSequence())).toEqual({});
  });

  it("builds one system.activities entry for a draft without an effect", () => {
    const drafts: ActivityDraft[] = [{ type: "check", values: { "check.ability": "str" } }];
    expect(buildActivitiesChanges(drafts, idSequence())).toEqual({
      "system.activities.id1": { type: "check", check: { ability: "str" } },
    });
  });

  it("builds an effect entry and links the activity to it by the effect's own new id", () => {
    const drafts: ActivityDraft[] = [
      {
        type: "damage",
        values: { "damage.parts": [{ number: 2, denomination: 6, bonus: "", types: ["fire"] }] },
        effect: { name: "Fire Bonus", changes: [{ key: "system.bonuses.mwak.damage", value: "+1d6", mode: 2 }] },
      },
    ];
    // The effect is built first (its id, "id1", is needed before the activity), then the activity ("id2").
    expect(buildActivitiesChanges(drafts, idSequence())).toEqual({
      effects: [{ _id: "id1", name: "Fire Bonus", changes: [{ key: "system.bonuses.mwak.damage", value: "+1d6", mode: 2 }] }],
      "system.activities.id2": {
        type: "damage",
        damage: { parts: [{ number: 2, denomination: 6, bonus: "", types: ["fire"] }] },
        effects: [{ _id: "id1" }],
      },
    });
  });

  it("builds several drafts into one changes object, each with its own activity id", () => {
    const drafts: ActivityDraft[] = [
      { type: "check", values: { "check.ability": "str" } },
      { type: "heal", values: { "healing.denomination": 8 } },
    ];
    const changes = buildActivitiesChanges(drafts, idSequence());
    expect(Object.keys(changes).sort()).toEqual(["system.activities.id1", "system.activities.id2"]);
    expect(changes["system.activities.id1"]).toMatchObject({ type: "check" });
    expect(changes["system.activities.id2"]).toMatchObject({ type: "heal" });
  });

  it("collects the effects of several drafts into one shared effects array, in draft order", () => {
    const drafts: ActivityDraft[] = [
      { type: "check", values: {}, effect: { name: "First", changes: [] } },
      { type: "heal", values: {}, effect: { name: "Second", changes: [] } },
    ];
    const changes = buildActivitiesChanges(drafts, idSequence());
    expect(changes.effects).toEqual([
      { _id: "id1", name: "First", changes: [] },
      { _id: "id3", name: "Second", changes: [] },
    ]);
  });

  it("M11b: builds a standalone effect with no Activity at all, and no system.activities entry", () => {
    const changes = buildActivitiesChanges([], idSequence(), [{ name: "Permanent +1 AC", changes: [{ key: "system.attributes.ac.bonus", value: "+1", mode: 2 }] }]);
    expect(changes).toEqual({
      effects: [{ _id: "id1", name: "Permanent +1 AC", changes: [{ key: "system.attributes.ac.bonus", value: "+1", mode: 2 }] }],
    });
    expect(Object.keys(changes).some((key) => key.startsWith("system.activities."))).toBe(false);
  });

  it("M11b: mixes activity-linked and standalone effects into the same shared effects array", () => {
    const drafts: ActivityDraft[] = [{ type: "check", values: {}, effect: { name: "Linked", changes: [] } }];
    const changes = buildActivitiesChanges(drafts, idSequence(), [{ name: "Standalone", changes: [] }]);
    expect(changes.effects).toEqual([
      { _id: "id1", name: "Linked", changes: [] },
      { _id: "id3", name: "Standalone", changes: [] },
    ]);
  });
});
