import { describe, expect, it } from "vitest";
import {
  buildVehicleComponentItemsChanges,
  stationCapacityExceeded,
  vehicleComponentCategory,
  vehicleComponentFields,
  type VehicleComponentDraft,
} from "./vehicle-component-model";

describe("Vehicle component field contracts", () => {
  it("keeps Feature fields narrow and excludes PC-only systems", () => {
    const paths = vehicleComponentFields("feature").map((field) => field.path);
    expect(paths).toEqual(["type.value", "type.subtype", "properties", "cover", "crewed", "description.value", "description.chat"]);
    for (const path of ["requirements", "prerequisites.level", "advancement", "startingEquipment", "enchant.max"]) expect(paths).not.toContain(path);
  });

  it("reuses content fields for stations while omitting runtime/raw-reference/container fields", () => {
    for (const type of ["equipmentStation", "weaponStation"] as const) {
      const paths = vehicleComponentFields(type).map((field) => field.path);
      for (const path of ["crew.max", "hp.max", "hp.dt", "speed.value", "uses.max", "uses.recovery", "description.value"]) expect(paths, `${type}:${path}`).toContain(path);
      for (const path of ["type.value", "type.baseItem", "crew.value", "hp.value", "uses.spent", "container"]) expect(paths, `${type}:${path}`).not.toContain(path);
    }
    expect(vehicleComponentFields("weaponStation").map((field) => field.path)).toContain("damage.base");
    expect(vehicleComponentFields("equipmentStation").map((field) => field.path)).toContain("armor.value");
  });
});

describe("buildVehicleComponentItemsChanges", () => {
  const ids = ["item-feature", "activity-feature", "item-equipment", "item-weapon"];
  const newId = (): string => ids.shift()!;

  it("builds Feature and fixed-type stations with stable IDs, Activities and repeated crew UUIDs", () => {
    const drafts: VehicleComponentDraft[] = [
      {
        type: "feature", name: "Ram", crew: [], itemFieldValues: { "type.value": "vehicle", crewed: true },
        activity: { type: "damage", values: { "activation.type": "action", name: "Ram", "damage.parts": [{ number: 2, denomination: 10, types: ["bludgeoning"] }] } },
      },
      { type: "equipmentStation", name: "Helm", crew: [{ actorUuid: "Actor.crew", quantity: 2 }], itemFieldValues: { "crew.max": 1, "armor.value": 15 } },
      { type: "weaponStation", name: "Ballista", crew: [], itemFieldValues: { "damage.base": { number: 3, denomination: 10, types: ["piercing"] } } },
    ];
    const result = buildVehicleComponentItemsChanges(drafts, newId, new Map([["Actor.crew", 2]]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.changes.items as readonly Record<string, unknown>[];
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ _id: "item-feature", name: "Ram", type: "feat", system: { type: { value: "vehicle" } } });
    expect(items[1]).toMatchObject({ _id: "item-equipment", name: "Helm", type: "equipment", system: { type: { value: "vehicle" }, crew: { value: ["Actor.crew", "Actor.crew"] } } });
    expect(items[2]).toMatchObject({ _id: "item-weapon", name: "Ballista", type: "weapon", system: { type: { value: "siege" } } });
    expect((items[0] as { system: { activities: object } }).system.activities).toEqual(expect.any(Object));
  });

  it("rejects station crew outside the vehicle roster or above the Actor's available quantity", () => {
    const base: VehicleComponentDraft = { type: "weaponStation", name: "Gun", itemFieldValues: {}, crew: [{ actorUuid: "Actor.a", quantity: 2 }] };
    expect(buildVehicleComponentItemsChanges([base], () => "id", new Map())).toEqual({ ok: false, reason: "crew-not-on-vehicle", actorUuid: "Actor.a" });
    expect(buildVehicleComponentItemsChanges([base], () => "id", new Map([["Actor.a", 1]]))).toEqual({ ok: false, reason: "crew-over-assigned", actorUuid: "Actor.a" });
    const one: VehicleComponentDraft = { ...base, crew: [{ actorUuid: "Actor.a", quantity: 1 }] };
    expect(buildVehicleComponentItemsChanges([one, one], () => "id", new Map([["Actor.a", 1]]))).toEqual({ ok: false, reason: "crew-over-assigned", actorUuid: "Actor.a" });
  });

  it("warns rather than rejecting a station max overage", () => {
    expect(stationCapacityExceeded({ type: "equipmentStation", name: "Helm", itemFieldValues: { "crew.max": 1 }, crew: [{ actorUuid: "Actor.a", quantity: 2 }] })).toBe(true);
  });
});

describe("vehicleComponentCategory", () => {
  it("matches dnd5e's Vehicle feature/station buckets", () => {
    expect(vehicleComponentCategory({ type: "equipmentStation" })).toBe("actionStation");
    expect(vehicleComponentCategory({ type: "feature" })).toBe("feature");
    expect(vehicleComponentCategory({ type: "feature", activity: { type: "damage", values: { "activation.type": "bonus" } } })).toBe("bonus");
    expect(vehicleComponentCategory({ type: "feature", activity: { type: "save", values: { "activation.type": "reaction" } } })).toBe("reaction");
  });
});
