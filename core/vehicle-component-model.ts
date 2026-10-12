import type { JsonValue } from "./create-pair";
import { buildActivityData, type ActivityType } from "./activity-model";
import { buildItemFieldData, specForItemKind, VALID_PROPERTY_KEYS, type ItemField } from "./item-field-model";

export type VehicleComponentType = "feature" | "equipmentStation" | "weaponStation";

export const VEHICLE_FEATURE_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "featureTypes" },
  { path: "type.subtype", section: "core", widget: "dependentSubtypeSelect", choicesKind: "featureTypes" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.feat },
  { path: "cover", section: "core", widget: "number" },
  { path: "crewed", section: "core", widget: "checkbox" },
  { path: "description.value", section: "description", widget: "text" },
  { path: "description.chat", section: "description", widget: "text" },
];

const STATION_EXCLUDED_PATHS = new Set(["type.value", "type.baseItem", "container", "crew.value", "hp.value", "uses.spent"]);
const stationFields = (kind: "equipment" | "weapon"): readonly ItemField[] => [
  ...specForItemKind(kind).fields.filter((field) => !STATION_EXCLUDED_PATHS.has(field.path)),
  { path: "uses.max", section: "uses", widget: "formula" },
  { path: "uses.recovery", section: "uses", widget: "list" },
];

export const VEHICLE_EQUIPMENT_STATION_FIELDS: readonly ItemField[] = stationFields("equipment");
export const VEHICLE_WEAPON_STATION_FIELDS: readonly ItemField[] = stationFields("weapon");

export function vehicleComponentFields(type: VehicleComponentType): readonly ItemField[] {
  if (type === "feature") return VEHICLE_FEATURE_FIELDS;
  return type === "equipmentStation" ? VEHICLE_EQUIPMENT_STATION_FIELDS : VEHICLE_WEAPON_STATION_FIELDS;
}

export interface VehicleCrewAssignment {
  readonly actorUuid: string;
  readonly quantity: number;
}

export interface VehicleComponentDraft {
  readonly id?: string;
  readonly type: VehicleComponentType;
  readonly name: string;
  readonly itemFieldValues: Readonly<Record<string, JsonValue>>;
  readonly crew: readonly VehicleCrewAssignment[];
  readonly activity?: { readonly id?: string; readonly type: ActivityType; readonly values: Readonly<Record<string, JsonValue>> };
}

export type VehicleComponentCategory = "feature" | "bonus" | "reaction" | "actionStation";

export function vehicleComponentCategory(draft: Pick<VehicleComponentDraft, "type" | "activity">): VehicleComponentCategory {
  if (draft.type !== "feature") return "actionStation";
  const activation = draft.activity?.values["activation.type"];
  if (activation === "bonus") return "bonus";
  if (activation === "reaction") return "reaction";
  return "feature";
}

export type VehicleComponentFailureReason = "invalid-crew-quantity" | "duplicate-crew" | "crew-not-on-vehicle" | "crew-over-assigned";
export type VehicleComponentBuildResult =
  | { readonly ok: true; readonly changes: Readonly<Record<string, JsonValue>> }
  | { readonly ok: false; readonly reason: VehicleComponentFailureReason; readonly actorUuid: string };

function expandedStationCrew(
  assignments: readonly VehicleCrewAssignment[],
  remainingCrew: Map<string, number>,
): { readonly ok: true; readonly uuids: readonly string[] } | { readonly ok: false; readonly reason: VehicleComponentFailureReason; readonly actorUuid: string } {
  const seen = new Set<string>();
  const uuids: string[] = [];
  for (const assignment of assignments) {
    if (!Number.isInteger(assignment.quantity) || assignment.quantity < 1) {
      return { ok: false, reason: "invalid-crew-quantity", actorUuid: assignment.actorUuid };
    }
    if (seen.has(assignment.actorUuid)) return { ok: false, reason: "duplicate-crew", actorUuid: assignment.actorUuid };
    seen.add(assignment.actorUuid);
    const available = remainingCrew.get(assignment.actorUuid);
    if (available === undefined) return { ok: false, reason: "crew-not-on-vehicle", actorUuid: assignment.actorUuid };
    if (assignment.quantity > available) return { ok: false, reason: "crew-over-assigned", actorUuid: assignment.actorUuid };
    remainingCrew.set(assignment.actorUuid, available - assignment.quantity);
    for (let index = 0; index < assignment.quantity; index += 1) uuids.push(assignment.actorUuid);
  }
  return { ok: true, uuids };
}

export function stationCapacityExceeded(draft: VehicleComponentDraft): boolean {
  if (draft.type === "feature") return false;
  const rawMaximum = draft.itemFieldValues["crew.max"];
  if (typeof rawMaximum !== "number" || rawMaximum < 0) return false;
  return draft.crew.reduce((sum, assignment) => sum + assignment.quantity, 0) > rawMaximum;
}

export function buildVehicleComponentItemsChanges(
  drafts: readonly VehicleComponentDraft[],
  newId: () => string,
  availableCrew: ReadonlyMap<string, number>,
): VehicleComponentBuildResult {
  if (drafts.length === 0) return { ok: true, changes: {} };
  const items: JsonValue[] = [];
  const remainingCrew = new Map(availableCrew);
  for (const draft of drafts) {
    const itemId = draft.id ?? newId();
    const stationCrew = draft.type === "feature" ? { ok: true as const, uuids: [] } : expandedStationCrew(draft.crew, remainingCrew);
    if (!stationCrew.ok) return stationCrew;
    const forcedType = draft.type === "feature" ? undefined : draft.type === "equipmentStation" ? "vehicle" : "siege";
    const system = buildItemFieldData({
      ...draft.itemFieldValues,
      ...(forcedType ? { "type.value": forcedType } : {}),
      ...(draft.type !== "feature" ? { "crew.value": stationCrew.uuids } : {}),
    });
    if (draft.activity) {
      const activityId = draft.activity.id ?? newId();
      system.activities = { [activityId]: buildActivityData(draft.activity.type, draft.activity.values) };
    }
    items.push({ _id: itemId, name: draft.name, type: draft.type === "feature" ? "feat" : draft.type === "equipmentStation" ? "equipment" : "weapon", system });
  }
  return { ok: true, changes: { items } };
}
