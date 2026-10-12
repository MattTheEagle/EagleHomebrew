import type { JsonValue } from "./create-pair";
import { buildPathData } from "./path-data";

// The simplified Homebrew model for "Add Action"/"Add Bonus Action" (N22, M5 Apply): a flat, dnd5e-path-keyed field
// list per Activity type, covering every field of dnd5e's Activity schema (M5 Discover, Befund 2-3) — N21 (full field
// coverage) applies to "advanced" fields exactly as it does to "basic" ones; `group` only tells M7's UI which fields
// to show right away and which to put behind "Mehr anzeigen", it never means a field is skipped.

export type ActivityGroup = "basic" | "advanced";
// "list": the value at this path is a ready-made JSON array, built by whatever repeatable-row UI M7 provides — not
// decomposed into indexed sub-paths here. dnd5e's own ArrayField-typed sub-schemas (consumption.targets,
// uses.recovery, effects) work this way; trying to express e.g. "consumption.targets.0.value" as its own dotted path
// would need array-index handling buildPathData does not have (and dnd5e's field is a real Array, not a
// numeric-keyed object) — kept out of scope for M5-M7.
// "damagePart": the one array field M7 Deploy gives its own real (if single-row) editor, because it carries the
// project lead's own example (damage type, formula/bonus) — `path` is always exactly "damage.parts", the value is a
// one-element DamageData array (M5 Apply, risks_and_assumptions: at most one damage part per Basis field for now).
// "healingPart": the same treatment for `heal`'s own single (not array) DamageData field, `path` always "healing"
// (M7 Deploy rework: heal's damage fields originally went through the generic per-field renderer, which gave them
// auto-derived labels like "Denomination" instead of the curated ones damagePart gets — this closes that gap).
export type ActivityWidget = "text" | "number" | "select" | "checkbox" | "formula" | "set" | "list" | "damagePart" | "healingPart";

// Symbolic choice source for "select"/"set" fields — resolved to the actual CONFIG.DND5E.* lookup in v13/ (M7), never
// here: this file stays Foundry-free and testable without a running Foundry (M5 Apply, Deploy correction — Apply's
// own sketch had `choices: () => CONFIG.DND5E...` directly on the field, which cannot live in core/).
// M8 adds nine more, for Tool's and Weapon's own fields (not Activities): six normal label catalogs
// (itemRarity, currencies, weightUnits, itemProperties, attunementTypes, toolTypes, weaponTypes,
// distanceUnits, weaponMasteries, movementUnits — dadm/m8-02-apply-output.md Befund 1) plus three whose
// dnd5e catalog carries no label at all (toolBaseItems/weaponBaseItems/ammoTypes: the value is either an
// object with no `label` field or the raw UUID of dnd5e's own base item) — `choicesFor` (v13/) falls back
// to an auto-formatted catalog key for those three, same as `pathLabel` already does for an unlabelled
// field path.
export type ChoicesKind =
  | "abilities"
  | "damageTypes"
  | "healingTypes"
  | "activationTypes"
  | "attackTypeValues"
  | "attackClassifications"
  | "activeEffectModes"
  | "itemRarity"
  | "currencies"
  | "weightUnits"
  | "itemProperties"
  | "attunementTypes"
  | "toolTypes"
  | "weaponTypes"
  | "distanceUnits"
  | "weaponMasteries"
  | "movementUnits"
  | "toolBaseItems"
  | "weaponBaseItems"
  | "ammoTypes"
  | "equipmentTypes"
  | "consumableTypes"
  | "equipmentBaseItems"
  | "volumeUnits"
  | "featureTypes"
  | "enchantmentPeriods"
  | "effectSkills"
  | "effectTools"
  | "effectConditions"
  | "effectLanguages"
  | "spellSchools"
  | "spellcastingMethods"
  | "spellPreparationStates"
  | "creatureTypes"
  | "durationUnits"
  | "areaTargetTypes"
  | "individualTargetTypes"
  | "hitDieTypes"
  | "spellcastingProgression"
  | "scaleValueTypes"
  | "traitModes"
  | "armorProficiencyTypes"
  | "weaponProficiencyTypes"
  | "facilityTypes"
  | "facilitySizes"
  | "actorSizes"
  | "armorClassCalculations"
  | "proficiencyLevels"
  | "saveProficiencyLevels"
  | "advancementItemTypes"
  | "advancementSpellLevels"
  | "advancementSpellLists"
  | "legendaryActionIdentifiers"
  | "travelPace"
  | "travelUnits"
  | "vehicleTypes"
  | "rollModes"
  | "ignoredDifficultTerrain"
  | "physicalItemProperties";

export interface ActivityField {
  readonly path: string;
  readonly group: ActivityGroup;
  readonly widget: ActivityWidget;
  readonly choicesKind?: ChoicesKind;
}

export type ActivityType = "attack" | "damage" | "save" | "check" | "heal";

export interface ActivityTypeSpec {
  readonly type: ActivityType;
  readonly fields: readonly ActivityField[];
}

// Fields every Activity type has (M5 Discover, Befund 2 — BaseActivityData). `activation.type` is where "Add Action"
// vs. "Add Bonus Action" (and every other activation type dnd5e defines) lives; nothing beyond it is Homebrew-invented.
const BASE_FIELDS: readonly ActivityField[] = [
  { path: "name", group: "basic", widget: "text" },
  { path: "activation.type", group: "basic", widget: "select", choicesKind: "activationTypes" },
  { path: "activation.value", group: "advanced", widget: "number" },
  // M20: a condition such as "Only against undead" describes whether a manually triggered Activity applies.
  // It is native dnd5e data (shown as a Trigger in chat), not a rule that Eagle Homebrew evaluates, so it
  // belongs next to the visible activation choice instead of behind "More fields".
  { path: "activation.condition", group: "basic", widget: "text" },
  { path: "consumption.scaling.allowed", group: "advanced", widget: "checkbox" },
  { path: "consumption.scaling.max", group: "advanced", widget: "formula" },
  { path: "consumption.spellSlot", group: "advanced", widget: "checkbox" },
  { path: "consumption.targets", group: "advanced", widget: "list" },
  { path: "description.chatFlavor", group: "advanced", widget: "text" },
  { path: "duration.value", group: "advanced", widget: "formula" },
  // M12 live-check rework, Fund (2026-09-27): had no choicesKind since M5-M7 — fell back to plain free
  // text, exactly the raw-dnd5e-knowledge problem M11c already fixed for effect targets. The project
  // lead's own standing principle (dadm/feedback, "so einfach wie möglich... menschenlesbar"): an old
  // gap is not a reason to leave it, every step should keep tightening this, not just new fields.
  { path: "duration.units", group: "advanced", widget: "select", choicesKind: "durationUnits" },
  { path: "duration.special", group: "advanced", widget: "text" },
  { path: "duration.concentration", group: "advanced", widget: "checkbox" },
  { path: "range.value", group: "advanced", widget: "formula" },
  // Same catalog Weapon's own `range.units` already uses (`core/item-field-model.ts`, M8) — dnd5e's
  // `CONFIG.DND5E.distanceUnits` already IS `movementUnits` + `rangeTypes` combined; this field was
  // simply never told to use it.
  { path: "range.units", group: "advanced", widget: "select", choicesKind: "distanceUnits" },
  { path: "range.special", group: "advanced", widget: "text" },
  { path: "target.template.count", group: "advanced", widget: "formula" },
  { path: "target.template.type", group: "advanced", widget: "select", choicesKind: "areaTargetTypes" },
  { path: "target.template.size", group: "advanced", widget: "formula" },
  { path: "target.template.width", group: "advanced", widget: "formula" },
  { path: "target.affects.count", group: "advanced", widget: "formula" },
  { path: "target.affects.type", group: "advanced", widget: "select", choicesKind: "individualTargetTypes" },
  { path: "target.affects.choice", group: "advanced", widget: "checkbox" },
  { path: "uses.max", group: "advanced", widget: "formula" },
  { path: "uses.recovery", group: "advanced", widget: "list" },
  { path: "visibility.level.min", group: "advanced", widget: "number" },
  { path: "visibility.level.max", group: "advanced", widget: "number" },
  // Which effect (if any) the Activity triggers (N22, "zusammen mit Activities"): the effect itself is a separate
  // document (core/effect-model.ts), this only carries the reference back to it (M5 Apply, section 4).
  { path: "effects", group: "advanced", widget: "list" },
];

const RAW_ACTIVITY_TYPES: readonly ActivityTypeSpec[] = [
  {
    type: "attack",
    fields: [
      ...BASE_FIELDS,
      { path: "attack.ability", group: "basic", widget: "select", choicesKind: "abilities" },
      { path: "attack.type.value", group: "basic", widget: "select", choicesKind: "attackTypeValues" },
      { path: "attack.type.classification", group: "basic", widget: "select", choicesKind: "attackClassifications" },
      { path: "attack.bonus", group: "advanced", widget: "formula" },
      { path: "attack.critical.threshold", group: "advanced", widget: "number" },
      { path: "attack.flat", group: "advanced", widget: "checkbox" },
      { path: "damage.parts", group: "basic", widget: "damagePart", choicesKind: "damageTypes" },
      { path: "damage.includeBase", group: "advanced", widget: "checkbox" },
      { path: "damage.critical.bonus", group: "advanced", widget: "formula" },
    ],
  },
  {
    type: "damage",
    fields: [
      ...BASE_FIELDS,
      { path: "damage.parts", group: "basic", widget: "damagePart", choicesKind: "damageTypes" },
      { path: "damage.critical.allow", group: "advanced", widget: "checkbox" },
      { path: "damage.critical.bonus", group: "advanced", widget: "formula" },
    ],
  },
  {
    type: "save",
    fields: [
      ...BASE_FIELDS,
      { path: "save.ability", group: "basic", widget: "set", choicesKind: "abilities" },
      { path: "save.dc.formula", group: "basic", widget: "formula" },
      { path: "save.dc.calculation", group: "advanced", widget: "select" },
      { path: "damage.parts", group: "basic", widget: "damagePart", choicesKind: "damageTypes" },
      { path: "damage.onSave", group: "basic", widget: "select" },
    ],
  },
  {
    type: "check",
    fields: [
      ...BASE_FIELDS,
      { path: "check.ability", group: "basic", widget: "select", choicesKind: "abilities" },
      { path: "check.dc.formula", group: "basic", widget: "formula" },
      { path: "check.dc.calculation", group: "advanced", widget: "select" },
      { path: "check.associated", group: "advanced", widget: "set" },
    ],
  },
  {
    type: "heal",
    fields: [
      ...BASE_FIELDS,
      { path: "healing", group: "basic", widget: "healingPart", choicesKind: "healingTypes" },
    ],
  },
];

export const ACTIVITY_TYPES: readonly ActivityTypeSpec[] = RAW_ACTIVITY_TYPES.map((spec) =>
  Object.freeze({ ...spec, fields: Object.freeze(spec.fields) }),
);

export function specFor(type: ActivityType): ActivityTypeSpec {
  const spec = ACTIVITY_TYPES.find((entry) => entry.type === type);
  if (!spec) throw new Error(`activity-model: no spec for type "${type}"`);
  return spec;
}

// Builds a dnd5e Activity data object from form values (path -> value), for `document.create`'s `data.system.
// activities.<id>` or the equivalent `document.update` `changes` (M6). `type` is always set (BaseActivityData:
// required, read-only). An empty string means "no value entered", left out so dnd5e's own default applies (M5 Apply,
// section 3) — a value that is not a string (a "list" field's array, a boolean, a number) is never empty in that
// sense and is always kept.
export function buildActivityData(type: ActivityType, values: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  const kept: Record<string, JsonValue> = { type };
  for (const [path, value] of Object.entries(values)) {
    if (value !== "") kept[path] = value;
  }
  return buildPathData(kept);
}
