import { describe, expect, it } from "vitest";
import {
  buildEncounterMembers,
  buildGroupMembers,
  normalizeEncounterMember,
  normalizeGroupMember,
  type ActorReference,
  type ActorResolution,
  type EncounterMemberDraft,
  type GroupMemberDraft,
} from "./actor-member-model";

const ref = (source: ActorReference["source"], type: string, id: string, name = id): ActorReference => ({
  id,
  name,
  type,
  source,
  uuid: source === "world" ? `Actor.${id}` : `Compendium.${source === "eagle-library" ? "world.eagle-npcs-2024" : "dnd5e.monsters"}.Actor.${id}`,
});

const resolution = (selected: ActorReference, over: Partial<Omit<ActorResolution, "ok" | "selected">> = {}): ActorResolution => ({
  ok: true,
  selected,
  ...over,
});

describe("normalizeEncounterMember (M17)", () => {
  it("prefers a same-id Eagle Library NPC over the selected world NPC", () => {
    const world = ref("world", "npc", "goblin", "Goblin");
    const library = ref("eagle-library", "npc", "goblin", "Goblin");
    expect(normalizeEncounterMember(resolution(world, { world, library }), 2, "1d4")).toEqual({
      ok: true,
      draft: {
        kind: "encounter",
        actorUuid: library.uuid,
        name: "Goblin",
        quantity: 2,
        formula: "1d4",
        libraryState: "present",
      },
    });
  });

  it("accepts a world NPC without Library entry, marks it missing, and defaults quantity to 1", () => {
    const world = ref("world", "npc", "wolf", "Wolf");
    expect(normalizeEncounterMember(resolution(world, { world }), undefined, "  ")).toEqual({
      ok: true,
      draft: {
        kind: "encounter",
        actorUuid: world.uuid,
        name: "Wolf",
        quantity: 1,
        formula: "",
        libraryState: "missing",
      },
    });
  });

  it("accepts an Eagle Library NPC without requiring a world counterpart", () => {
    const library = ref("eagle-library", "npc", "dragon", "Dragon");
    expect(normalizeEncounterMember(resolution(library, { library }), 1, "")).toMatchObject({
      ok: true,
      draft: { actorUuid: library.uuid, libraryState: "present" },
    });
  });

  it("rejects non-NPCs, foreign Compendium NPCs without Library entry, invalid quantities, and duplicates", () => {
    expect(normalizeEncounterMember(resolution(ref("world", "vehicle", "cart")), 1, "")).toEqual({ ok: false, reason: "not-npc" });
    expect(normalizeEncounterMember(resolution(ref("other-compendium", "npc", "bear")), 1, "")).toEqual({ ok: false, reason: "unsupported-source" });
    expect(normalizeEncounterMember(resolution(ref("world", "npc", "bear")), -1, "")).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(normalizeEncounterMember(resolution(ref("world", "npc", "bear")), 1.5, "")).toEqual({ ok: false, reason: "invalid-quantity" });
    expect(normalizeEncounterMember(resolution(ref("world", "npc", "bear")), 1, "", new Set(["Actor.bear"]))).toEqual({ ok: false, reason: "duplicate" });
  });
});

describe("normalizeGroupMember (M17)", () => {
  it("keeps a selected world NPC id and marks a missing Library entry", () => {
    const world = ref("world", "npc", "guard", "Guard");
    expect(normalizeGroupMember(resolution(world, { world }))).toEqual({
      ok: true,
      draft: { kind: "group", actorId: "guard", name: "Guard", actorType: "npc", libraryState: "missing" },
    });
  });

  it("maps a Library NPC selection to its same-id world counterpart", () => {
    const library = ref("eagle-library", "npc", "scout", "Scout");
    const world = ref("world", "npc", "scout", "Scout");
    expect(normalizeGroupMember(resolution(library, { world, library }))).toEqual({
      ok: true,
      draft: { kind: "group", actorId: "scout", name: "Scout", actorType: "npc", libraryState: "present" },
    });
  });

  it("accepts a Character as world-only by design", () => {
    const world = ref("world", "character", "hero", "Hero");
    expect(normalizeGroupMember(resolution(world, { world }))).toMatchObject({
      ok: true,
      draft: { actorType: "character", libraryState: "unsupported" },
    });
  });

  it("rejects Compendium members without a world copy, nested group kinds, and duplicates", () => {
    const library = ref("eagle-library", "npc", "mage");
    expect(normalizeGroupMember(resolution(library, { library }))).toEqual({ ok: false, reason: "no-world-counterpart" });
    expect(normalizeGroupMember(resolution(ref("world", "group", "party")))).toEqual({ ok: false, reason: "invalid-group-member" });
    expect(normalizeGroupMember(resolution(ref("world", "encounter", "battle")))).toEqual({ ok: false, reason: "invalid-group-member" });
    expect(normalizeGroupMember(resolution(ref("world", "npc", "mage")), new Set(["mage"]))).toEqual({ ok: false, reason: "duplicate" });
  });
});

describe("member data builders (M17)", () => {
  it("builds Encounter UUID/quantity entries and omits an empty formula", () => {
    const drafts: EncounterMemberDraft[] = [
      { kind: "encounter", actorUuid: "Actor.one", name: "One", quantity: 2, formula: "1d4", libraryState: "missing" },
      { kind: "encounter", actorUuid: "Compendium.world.eagle-npcs-2024.Actor.two", name: "Two", quantity: 1, formula: "", libraryState: "present" },
    ];
    expect(buildEncounterMembers(drafts)).toEqual([
      { uuid: "Actor.one", quantity: { value: 2, formula: "1d4" } },
      { uuid: "Compendium.world.eagle-npcs-2024.Actor.two", quantity: { value: 1 } },
    ]);
  });

  it("builds Group world ids and a primary Vehicle only when it is a member", () => {
    const drafts: GroupMemberDraft[] = [
      { kind: "group", actorId: "hero", name: "Hero", actorType: "character", libraryState: "unsupported" },
      { kind: "group", actorId: "ship", name: "Ship", actorType: "vehicle", libraryState: "present" },
    ];
    expect(buildGroupMembers(drafts, "ship")).toEqual({
      ok: true,
      members: [{ actor: "hero" }, { actor: "ship" }],
      primaryVehicle: "ship",
    });
    expect(buildGroupMembers(drafts, "missing")).toEqual({ ok: false, reason: "primary-not-member" });
    expect(buildGroupMembers(drafts, "hero")).toEqual({ ok: false, reason: "primary-not-vehicle" });
  });
});
