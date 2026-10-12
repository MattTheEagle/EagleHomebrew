import { describe, expect, it } from "vitest";
import type { ActorReference, ActorResolution } from "./actor-member-model";
import {
  buildVehicleRosterValues,
  normalizeVehicleRosterDraft,
  vehicleCapacityWarnings,
  vehicleCrewQuantities,
  type VehicleRosterDraft,
} from "./vehicle-roster-model";

const actor = (id: string, type: string, source: ActorReference["source"]): ActorReference => ({
  id,
  uuid: source === "world" ? `Actor.${id}` : `Compendium.${source}.${id}`,
  name: id,
  type,
  source,
});
const resolution = (selected: ActorReference, world?: ActorReference, library?: ActorReference): ActorResolution => ({ ok: true, selected, world, library });

describe("normalizeVehicleRosterDraft", () => {
  it("prefers an NPC's canonical Eagle Library UUID and marks a world NPC without one", () => {
    const world = actor("goblin", "npc", "world");
    const library = actor("goblin", "npc", "eagle-library");
    expect(normalizeVehicleRosterDraft(resolution(world, world, library), "crew", 2)).toEqual({
      ok: true,
      draft: { area: "crew", actorUuid: library.uuid, name: "goblin", actorType: "npc", quantity: 2, libraryState: "present" },
    });
    expect(normalizeVehicleRosterDraft(resolution(world, world), "passengers", 1)).toMatchObject({
      ok: true, draft: { actorUuid: world.uuid, libraryState: "missing" },
    });
  });

  it("rejects a foreign NPC without an Eagle counterpart and accepts it with one", () => {
    const foreign = actor("guard", "npc", "other-compendium");
    expect(normalizeVehicleRosterDraft(resolution(foreign), "crew", 1)).toEqual({ ok: false, reason: "unsupported-source" });
    const library = actor("guard", "npc", "eagle-library");
    expect(normalizeVehicleRosterDraft(resolution(foreign, undefined, library), "crew", 1)).toMatchObject({ ok: true, draft: { actorUuid: library.uuid } });
  });

  it("keeps Characters world-only and requires a world counterpart", () => {
    const world = actor("hero", "character", "world");
    expect(normalizeVehicleRosterDraft(resolution(world, world), "passengers", 1)).toMatchObject({
      ok: true, draft: { actorUuid: world.uuid, actorType: "character", libraryState: "unsupported" },
    });
    const foreign = actor("hero", "character", "other-compendium");
    expect(normalizeVehicleRosterDraft(resolution(foreign), "passengers", 1)).toEqual({ ok: false, reason: "no-world-counterpart" });
  });

  it("accepts only Character/NPC, integer quantities from one, and unique Actor per area", () => {
    const vehicle = actor("ship", "vehicle", "world");
    expect(normalizeVehicleRosterDraft(resolution(vehicle), "crew", 1)).toEqual({ ok: false, reason: "invalid-actor" });
    const npc = actor("sailor", "npc", "world");
    expect(normalizeVehicleRosterDraft(resolution(npc), "crew", 0)).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(normalizeVehicleRosterDraft(resolution(npc), "crew", 1.5)).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(normalizeVehicleRosterDraft(resolution(npc), "crew", 1, new Set([`crew:${npc.uuid}`]))).toEqual({ ok: false, reason: "duplicate" });
    expect(normalizeVehicleRosterDraft(resolution(npc), "passengers", 1, new Set([`crew:${npc.uuid}`]))).toMatchObject({ ok: true });
  });
});

describe("Vehicle roster output", () => {
  const drafts: VehicleRosterDraft[] = [
    { area: "crew", actorUuid: "Actor.a", name: "A", actorType: "character", quantity: 2, libraryState: "unsupported" },
    { area: "passengers", actorUuid: "Compendium.eagle.b", name: "B", actorType: "npc", quantity: 3, libraryState: "present" },
    { area: "draft", actorUuid: "Actor.c", name: "C", actorType: "npc", quantity: 1, libraryState: "missing" },
  ];

  it("expands quantities into repeated UUIDs for all three native arrays", () => {
    expect(buildVehicleRosterValues(drafts)).toEqual({
      crew: ["Actor.a", "Actor.a"],
      passengers: ["Compendium.eagle.b", "Compendium.eagle.b", "Compendium.eagle.b"],
      draft: ["Actor.c"],
    });
    expect(vehicleCrewQuantities(drafts)).toEqual(new Map([["Actor.a", 2]]));
  });

  it("reports capacity overages without invalidating the roster", () => {
    expect(vehicleCapacityWarnings(drafts, { crew: 1, passengers: 3 })).toEqual([{ area: "crew", count: 2, maximum: 1 }]);
  });
});
