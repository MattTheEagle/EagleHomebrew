// M17: Encounter and Group are both collections of Actors, but dnd5e deliberately stores their
// members in different forms. Encounter accepts full Actor UUIDs (including Compendium Actors),
// while Group persists only world Actor ids. This file keeps the normalization and output shape
// Foundry-free; v13/module.ts supplies the documents and same-id counterparts it reads at runtime.

export type ActorReferenceSource = "world" | "eagle-library" | "other-compendium";
export type LibraryState = "present" | "missing" | "unsupported";

export interface ActorReference {
  readonly id: string;
  readonly uuid: string;
  readonly name: string;
  readonly type: string;
  readonly source: ActorReferenceSource;
}

export interface ActorResolution {
  readonly ok: true;
  readonly selected: ActorReference;
  readonly world?: ActorReference;
  readonly library?: ActorReference;
}

export type ActorResolutionFailureReason = "not-found" | "not-actor" | "ambiguous-library";

export interface ActorResolutionFailure {
  readonly ok: false;
  readonly reason: ActorResolutionFailureReason;
  readonly detail: string;
}

export type ActorResolutionResult = ActorResolution | ActorResolutionFailure;

export interface EncounterMemberDraft {
  readonly kind: "encounter";
  readonly actorUuid: string;
  readonly name: string;
  readonly quantity: number;
  readonly formula: string;
  readonly libraryState: Exclude<LibraryState, "unsupported">;
}

export interface GroupMemberDraft {
  readonly kind: "group";
  readonly actorId: string;
  readonly name: string;
  readonly actorType: "character" | "npc" | "vehicle";
  readonly libraryState: LibraryState;
}

export type ActorMemberDraft = EncounterMemberDraft | GroupMemberDraft;

export type MemberNormalizationFailureReason =
  | "not-npc"
  | "unsupported-source"
  | "invalid-quantity"
  | "invalid-group-member"
  | "no-world-counterpart"
  | "duplicate";

export type MemberNormalizationResult<T extends ActorMemberDraft> =
  | { readonly ok: true; readonly draft: T }
  | { readonly ok: false; readonly reason: MemberNormalizationFailureReason };

const GROUP_MEMBER_TYPES = new Set(["character", "npc", "vehicle"]);

// Prefer the Eagle Library UUID for an Encounter whenever it exists (N14 a). A world NPC without
// one remains a valid, visibly marked world reference. A third-party Compendium NPC must first have
// an Eagle Library counterpart; M17's selection contract is World or Eagle Library, not arbitrary
// foreign packs.
export function normalizeEncounterMember(
  resolution: ActorResolution,
  quantity: number | undefined,
  formula: string,
  existingUuids: ReadonlySet<string> = new Set(),
): MemberNormalizationResult<EncounterMemberDraft> {
  if (resolution.selected.type !== "npc") return { ok: false, reason: "not-npc" };
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) return { ok: false, reason: "invalid-quantity" };

  const actor = resolution.library ?? (resolution.selected.source === "world" ? resolution.selected : undefined);
  if (!actor) return { ok: false, reason: "unsupported-source" };
  if (existingUuids.has(actor.uuid)) return { ok: false, reason: "duplicate" };

  return {
    ok: true,
    draft: {
      kind: "encounter",
      actorUuid: actor.uuid,
      name: actor.name,
      quantity: quantity ?? 1,
      formula: formula.trim(),
      libraryState: resolution.library ? "present" : "missing",
    },
  };
}

// A Group's ForeignDocumentField can only resolve an id from game.actors. A Compendium selection
// is therefore usable only when a same-id world Actor exists. Character has no Eagle Library kind
// by project decision N15 and is distinguished from a missing NPC/Vehicle Library entry.
export function normalizeGroupMember(
  resolution: ActorResolution,
  existingIds: ReadonlySet<string> = new Set(),
): MemberNormalizationResult<GroupMemberDraft> {
  if (!GROUP_MEMBER_TYPES.has(resolution.selected.type)) return { ok: false, reason: "invalid-group-member" };
  const world = resolution.selected.source === "world" ? resolution.selected : resolution.world;
  if (!world || world.type !== resolution.selected.type) return { ok: false, reason: "no-world-counterpart" };
  if (existingIds.has(world.id)) return { ok: false, reason: "duplicate" };

  const actorType = world.type as GroupMemberDraft["actorType"];
  return {
    ok: true,
    draft: {
      kind: "group",
      actorId: world.id,
      name: world.name,
      actorType,
      libraryState: actorType === "character" ? "unsupported" : resolution.library ? "present" : "missing",
    },
  };
}

export type EncounterMemberData = {
  readonly uuid: string;
  readonly quantity: { readonly value: number; readonly formula?: string };
};

export function buildEncounterMembers(drafts: readonly EncounterMemberDraft[]): EncounterMemberData[] {
  return drafts.map((draft) => ({
    uuid: draft.actorUuid,
    quantity: { value: draft.quantity, ...(draft.formula ? { formula: draft.formula } : {}) },
  }));
}

export type GroupMemberData = { readonly actor: string };
export type GroupMembersBuildFailureReason = "primary-not-member" | "primary-not-vehicle";
export type GroupMembersBuildResult =
  | {
      readonly ok: true;
      readonly members: readonly GroupMemberData[];
      readonly primaryVehicle?: string;
    }
  | { readonly ok: false; readonly reason: GroupMembersBuildFailureReason };

export function buildGroupMembers(drafts: readonly GroupMemberDraft[], primaryVehicleId?: string): GroupMembersBuildResult {
  if (primaryVehicleId) {
    const primary = drafts.find((draft) => draft.actorId === primaryVehicleId);
    if (!primary) return { ok: false, reason: "primary-not-member" };
    if (primary.actorType !== "vehicle") return { ok: false, reason: "primary-not-vehicle" };
  }
  return {
    ok: true,
    members: drafts.map((draft) => ({ actor: draft.actorId })),
    ...(primaryVehicleId ? { primaryVehicle: primaryVehicleId } : {}),
  };
}
