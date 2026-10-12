import type { JsonValue } from "./create-pair";
import { buildPathData } from "./path-data";
import type { ChoicesKind } from "./activity-model";

// M14 (dadm/m14-02-apply-output.md, Entscheidung 6-8): the field model for dnd5e's Advancement system,
// built the same way core/activity-model.ts (M5) and core/item-field-model.ts (M8) already are — a
// deliberately separate type from both (M8 Apply Entscheidung 1: no shared supertype, a small,
// intentional duplication of the {path, widget, choicesKind} shape rather than a forced common base).
// M16b extends the builder to Feat, Background and Species. `value` (an advancement's per-character runtime state, e.g. which
// ability scores a player actually picked) never appears anywhere here — Homebrew only ever builds a
// fresh compendium/world template, which has none yet (Apply Entscheidung 6).

export type AdvancementKind = "class" | "subclass" | "feat" | "background" | "species";

export type AdvancementType = "HitPoints" | "AbilityScoreImprovement" | "Subclass" | "ItemGrant" | "ItemChoice" | "ScaleValue" | "Size" | "Trait";

export type AdvancementFieldWidget = "text" | "number" | "select" | "checkbox" | "formula" | "set" | "list" | "documentPicker" | "documentPickerMulti";

export interface AdvancementField {
  readonly path: string;
  readonly widget: AdvancementFieldWidget;
  readonly choicesKind?: ChoicesKind;
}

export interface AdvancementTypeSpec {
  readonly type: AdvancementType;
  // Homebrew names dnd5e's `race` kind `species`; the other four names match the system directly.
  readonly validKinds: readonly AdvancementKind[];
  // `HitPoints`, `ItemChoice` and `ScaleValue` are dnd5e multi-level types; Size always applies at level 0.
  // None of them gets the separate single-level input. ItemChoice/ScaleValue carry levels in their own tables.
  readonly hasLevel: boolean;
  // Flat, scalar `configuration.*` fields (see also ADVANCEMENT_TABLES in v13/homebrew-application.ts for
  // the three per-type nested tables — `ItemChoice.choices`, `ScaleValue.scale`, `Trait.choices` — which
  // are not flat paths and are handled by their own small composite widgets, the same treatment
  // `weaponDamagePart` already gets in core/item-field-model.ts).
  readonly fields: readonly AdvancementField[];
}

const RAW_ADVANCEMENT_TYPES: readonly AdvancementTypeSpec[] = [
  { type: "HitPoints", validKinds: ["class"], hasLevel: false, fields: [] },
  {
    type: "AbilityScoreImprovement",
    validKinds: ["class", "feat", "background", "species"],
    hasLevel: true,
    fields: [
      { path: "points", widget: "number" },
      { path: "cap", widget: "number" },
      { path: "max", widget: "number" },
      { path: "locked", widget: "set", choicesKind: "abilities" },
      // `recommendation` (a single optional Item UUID, e.g. suggesting a feat) — the one non-multi use of
      // the document picker (Entscheidung 7).
      { path: "recommendation", widget: "documentPicker" },
      // `fixed` (Mapping ability -> forced score) — a rare sub-case, kept as raw JSON (Apply Entscheidung 8).
      { path: "fixed", widget: "list" },
    ],
  },
  { type: "Subclass", validKinds: ["class"], hasLevel: true, fields: [] },
  {
    type: "ItemGrant",
    validKinds: ["class", "subclass", "feat", "background", "species"],
    hasLevel: true,
    fields: [
      { path: "items", widget: "documentPickerMulti" },
      { path: "optional", widget: "checkbox" },
      // `spell` (a third-order sub-configuration for spell-granting item grants) — raw JSON (Entscheidung 8).
      { path: "spell", widget: "list" },
    ],
  },
  {
    type: "ItemChoice",
    validKinds: ["class", "subclass", "feat", "background", "species"],
    hasLevel: false,
    fields: [
      { path: "pool", widget: "documentPickerMulti" },
      { path: "allowDrops", widget: "checkbox" },
      { path: "type", widget: "select", choicesKind: "advancementItemTypes" },
      { path: "restriction.type", widget: "select", choicesKind: "featureTypes" },
      { path: "restriction.subtype", widget: "select" },
      { path: "restriction.level", widget: "select", choicesKind: "advancementSpellLevels" },
      { path: "restriction.list", widget: "set", choicesKind: "advancementSpellLists" },
      { path: "spell", widget: "list" },
    ],
  },
  {
    type: "ScaleValue",
    validKinds: ["class", "subclass", "feat", "background", "species"],
    hasLevel: false,
    fields: [
      { path: "identifier", widget: "text" },
      { path: "type", widget: "select", choicesKind: "scaleValueTypes" },
      { path: "distance.units", widget: "select", choicesKind: "distanceUnits" },
    ],
  },
  {
    type: "Size",
    validKinds: ["species"],
    hasLevel: false,
    fields: [{ path: "sizes", widget: "set", choicesKind: "actorSizes" }],
  },
  {
    type: "Trait",
    validKinds: ["class", "subclass", "feat", "background", "species"],
    hasLevel: true,
    fields: [
      // No curated target catalog here (Apply Entscheidung 8): M11c's picker is for ActiveEffect change
      // keys, a different vocabulary from dnd5e's own Trait keys (`saves:str`, `skills:ath`, ...) — freetext
      // comma-list fallback (`widget: "set"` with no `choicesKind`, the same fallback core/item-field-model.ts
      // already uses for any uncataloged set field).
      { path: "grants", widget: "set" },
      { path: "allowReplacements", widget: "checkbox" },
      { path: "mode", widget: "select", choicesKind: "traitModes" },
    ],
  },
];

export const ADVANCEMENT_TYPES: readonly AdvancementTypeSpec[] = RAW_ADVANCEMENT_TYPES.map((spec) =>
  Object.freeze({ ...spec, validKinds: Object.freeze(spec.validKinds), fields: Object.freeze(spec.fields) }),
);

export function specForAdvancement(type: AdvancementType): AdvancementTypeSpec {
  const spec = ADVANCEMENT_TYPES.find((entry) => entry.type === type);
  if (!spec) throw new Error(`advancement-model: no spec for type "${type}"`);
  return spec;
}

export function isAdvancementKind(kind: string): kind is AdvancementKind {
  return kind === "class" || kind === "subclass" || kind === "feat" || kind === "background" || kind === "species";
}

export function advancementTypesFor(kind: AdvancementKind, selectedTypes: readonly AdvancementType[] = []): readonly AdvancementType[] {
  return ADVANCEMENT_TYPES.filter((entry) => entry.validKinds.includes(kind) && (entry.type !== "Size" || !selectedTypes.includes("Size"))).map(
    (entry) => entry.type,
  );
}

// ItemChoice has an item type plus different restrictions for Feature and Spell choices. Hidden values are removed
// before data building so switching the type cannot leave a stale, technically valid but misleading configuration.
export function normalizeAdvancementFieldValues(
  type: AdvancementType,
  values: Readonly<Record<string, JsonValue>>,
): Record<string, JsonValue> {
  const normalized = { ...values };
  if (type !== "ItemChoice") return normalized;
  const itemType = typeof normalized.type === "string" ? normalized.type : "";
  if (itemType !== "feat") {
    delete normalized["restriction.type"];
    delete normalized["restriction.subtype"];
  }
  if (itemType !== "spell") {
    delete normalized["restriction.level"];
    delete normalized["restriction.list"];
    delete normalized.spell;
  }
  return normalized;
}

export function validSizeSelection(values: Readonly<Record<string, JsonValue>>): boolean {
  return Array.isArray(values.sizes) && values.sizes.some((value) => typeof value === "string" && value !== "");
}

// Builds one Advancement's `configuration` object from its flat form values (path -> value), the same
// "drop empty strings, nest the rest" rule `core/activity-model.ts`'s `buildActivityData` already applies
// (M5 Apply, section 3) — an empty string means "nothing entered, let dnd5e's own default apply".
export function buildAdvancementConfiguration(values: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  const kept: Record<string, JsonValue> = {};
  for (const [path, value] of Object.entries(values)) {
    if (value !== "") kept[path] = value;
  }
  return buildPathData(kept);
}

// Builds one full Advancement entry (`system.advancement.<id>`, Discover Befund 9) from its type, optional
// level, and configuration values. `tables` holds the pre-built value of any of the three nested tables
// (`choices`/`scale`, see v13/homebrew-application.ts) this type has, keyed by the same name as in
// `configuration` — merged in after the flat fields so a table always wins over an (impossible) same-named
// flat field.
export function buildAdvancementData(
  type: AdvancementType,
  level: number | undefined,
  fieldValues: Readonly<Record<string, JsonValue>>,
  tables: Readonly<Record<string, JsonValue>> = {},
): Record<string, JsonValue> {
  const spec = specForAdvancement(type);
  const configuration = { ...buildAdvancementConfiguration(normalizeAdvancementFieldValues(type, fieldValues)), ...tables };
  return {
    type,
    ...(spec.hasLevel && level !== undefined ? { level } : {}),
    ...(Object.keys(configuration).length > 0 ? { configuration } : {}),
  };
}
