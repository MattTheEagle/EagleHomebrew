import { describe, expect, it } from "vitest";
import { buildActivitiesChanges } from "./activity-batch";
import { buildAdvancementChanges } from "./advancement-batch";
import { buildNpcActionItemsChanges } from "./npc-action-model";
import { buildTableResults } from "./table-result";
import { buildVehicleComponentItemsChanges } from "./vehicle-component-model";

describe("M19 modeled-entry identity", () => {
  const never = () => { throw new Error("an existing entry must not allocate a new id"); };

  it("keeps activity, effect, result and advancement ids", () => {
    expect(buildActivitiesChanges([{ id: "activity", type: "attack", values: {}, effect: { id: "effect", name: "E", changes: [] } }], never)).toMatchObject({
      "system.activities.activity": { type: "attack", effects: [{ _id: "effect" }] },
      effects: [{ _id: "effect", name: "E" }],
    });
    expect(buildTableResults([{ id: "result", text: "R", weight: 1 }], never).results[0]._id).toBe("result");
    expect(buildAdvancementChanges([{ id: "advancement", type: "HitPoints", values: {} }], never)).toHaveProperty("system.advancement.advancement");
  });

  it("keeps actor item and nested activity ids", () => {
    expect(buildNpcActionItemsChanges([{ id: "item", itemType: "feat", name: "A", itemFieldValues: {}, activity: { id: "activity", type: "damage", values: {} } }], never)).toMatchObject({
      items: [{ _id: "item", system: { activities: { activity: { type: "damage" } } } }],
    });
    const vehicle = buildVehicleComponentItemsChanges(
      [{ id: "station", type: "feature", name: "S", itemFieldValues: {}, crew: [], activity: { id: "activity", type: "check", values: {} } }],
      never,
      new Map(),
    );
    expect(vehicle).toMatchObject({ ok: true, changes: { items: [{ _id: "station", system: { activities: { activity: { type: "check" } } } }] } });
  });
});

