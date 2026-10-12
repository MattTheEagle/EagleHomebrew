import type { ActorResolution, LibraryState } from "./actor-member-model";

export type VehicleRosterArea = "crew" | "passengers" | "draft";

export interface VehicleRosterDraft {
  readonly area: VehicleRosterArea;
  readonly actorUuid: string;
  readonly name: string;
  readonly actorType: "character" | "npc";
  readonly quantity: number;
  readonly libraryState: LibraryState;
}

export type VehicleRosterFailureReason =
  | "invalid-actor"
  | "unsupported-source"
  | "no-world-counterpart"
  | "invalid-quantity"
  | "duplicate";

export type VehicleRosterNormalizationResult =
  | { readonly ok: true; readonly draft: VehicleRosterDraft }
  | { readonly ok: false; readonly reason: VehicleRosterFailureReason };

// Vehicles accept dnd5e creatures only. NPC references follow M17's canonical Library rule;
// Characters deliberately remain world-only because Eagle Library has no Character collection.
export function normalizeVehicleRosterDraft(
  resolution: ActorResolution,
  area: VehicleRosterArea,
  quantity: number,
  existingKeys: ReadonlySet<string> = new Set(),
): VehicleRosterNormalizationResult {
  if (resolution.selected.type !== "character" && resolution.selected.type !== "npc") {
    return { ok: false, reason: "invalid-actor" };
  }
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, reason: "invalid-quantity" };

  if (resolution.selected.type === "npc") {
    const actor = resolution.library ?? (resolution.selected.source === "world" ? resolution.selected : undefined);
    if (!actor) return { ok: false, reason: "unsupported-source" };
    if (existingKeys.has(`${area}:${actor.uuid}`)) return { ok: false, reason: "duplicate" };
    return {
      ok: true,
      draft: {
        area,
        actorUuid: actor.uuid,
        name: actor.name,
        actorType: "npc",
        quantity,
        libraryState: resolution.library ? "present" : "missing",
      },
    };
  }

  const actor = resolution.selected.source === "world" ? resolution.selected : resolution.world;
  if (!actor || actor.type !== "character") return { ok: false, reason: "no-world-counterpart" };
  if (existingKeys.has(`${area}:${actor.uuid}`)) return { ok: false, reason: "duplicate" };
  return {
    ok: true,
    draft: {
      area,
      actorUuid: actor.uuid,
      name: actor.name,
      actorType: "character",
      quantity,
      libraryState: "unsupported",
    },
  };
}

export interface VehicleRosterValues {
  readonly crew: readonly string[];
  readonly passengers: readonly string[];
  readonly draft: readonly string[];
}

export function buildVehicleRosterValues(drafts: readonly VehicleRosterDraft[]): VehicleRosterValues {
  const values: Record<VehicleRosterArea, string[]> = { crew: [], passengers: [], draft: [] };
  for (const entry of drafts) {
    for (let index = 0; index < entry.quantity; index += 1) values[entry.area].push(entry.actorUuid);
  }
  return values;
}

export interface VehicleCapacityWarning {
  readonly area: "crew" | "passengers";
  readonly count: number;
  readonly maximum: number;
}

export function vehicleCapacityWarnings(
  drafts: readonly VehicleRosterDraft[],
  capacities: Readonly<Partial<Record<"crew" | "passengers", number>>>,
): VehicleCapacityWarning[] {
  const counts = { crew: 0, passengers: 0 };
  for (const draft of drafts) {
    if (draft.area === "crew" || draft.area === "passengers") counts[draft.area] += draft.quantity;
  }
  const warnings: VehicleCapacityWarning[] = [];
  for (const area of ["crew", "passengers"] as const) {
    const maximum = capacities[area];
    if (maximum !== undefined && maximum >= 0 && counts[area] > maximum) warnings.push({ area, count: counts[area], maximum });
  }
  return warnings;
}

export function vehicleCrewQuantities(drafts: readonly VehicleRosterDraft[]): ReadonlyMap<string, number> {
  const quantities = new Map<string, number>();
  for (const draft of drafts) {
    if (draft.area === "crew") quantities.set(draft.actorUuid, (quantities.get(draft.actorUuid) ?? 0) + draft.quantity);
  }
  return quantities;
}
