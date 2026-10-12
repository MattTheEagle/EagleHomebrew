import type { JsonValue } from "./create-pair";
import { buildPathData } from "./path-data";
import type { ChoicesKind } from "./activity-model";

// The M8 counterpart of core/activity-model.ts's ActivityField, for a kind's own fields (Tool, Weapon, and the same
// shape for M9-M18) rather than an Activity's (dadm/m8-02-apply-output.md, Entscheidung 1: reuse the field model
// M5-M7 already built for Activities instead of a second, parallel one). Deliberately not sharing a supertype with
// ActivityField — both are already the same {path, widget, choicesKind} shape structurally, and the one place that
// turns that shape into a Foundry input (v13/homebrew-application.ts's renderFieldWidget/readFieldValue) is typed
// loosely enough to take either without one.

// Which visible <fieldset> a field belongs to (Apply, Entscheidung 2: grouped by template origin, never hidden
// behind a "More fields" disclosure the way Activities' "advanced" group is — Tool/Weapon stay small enough that
// N21 is best served by nothing being one click away from invisible).
// "uses" (M9): Consumable's own charges (`uses.spent`/`.max`/`.recovery`/`.autoDestroy`) get their own
// section because dnd5e itself renders them in a separate fieldset (`field-uses.hbs`) and they fit
// none of the other five sections (dadm/m9-02-apply-output.md, Entscheidung 6).
// "advanced" (M11): a field with no realistic dedicated widget this milestone (`advancement`,
// `startingEquipment` — each its own complex sub-system, comparable in scope to Activities, M5-M7) —
// named after Activities' own "advanced" group (M5-M7) for the same reason: visibly set apart from
// the normal form, not a field to fill in casually (dadm/m11-02-apply-output.md, Entscheidung 3).
// M16 live-check rework: NPC's ~48 fields, all in one "core" section, read as an undifferentiated wall
// of fields (project lead, live-check feedback) — five new, NPC-only sections split it the same way
// "uses"/"mountable" already split off Consumable's/Weapon's own less-common fields, so a much larger
// kind gets the same treatment rather than a one-off mechanism.
export type ItemFieldSection =
  | "core"
  | "currency"
  | "travel"
  | "physical"
  | "description"
  | "equippable"
  | "mountable"
  | "uses"
  | "advanced"
  | "abilityScores"
  | "skills"
  | "combat"
  | "movement"
  | "senses"
  | "resistances"
  | "actions"
  | "capacity"
  | "source";

// "weaponDamagePart": Weapon's own damage.base/damage.versatile (dnd5e's shared DamageData, data/shared/
// damage-field.mjs) — a superset of Activities' damagePart widget (number/denomination/bonus/types) that also
// covers custom.enabled/custom.formula and scaling.mode/scaling.number/scaling.formula, fields Activities' own
// damage parts do not have (Apply, Befund 1: "eigene kleine Erweiterung nötig, kein 1:1-Wiederverwendung").
// "baseItemSelect": `type.baseItem` (M8a) — starts with the same synchronous, key-labelled fallback as a plain
// "select", then resolves to the real base item names, filtered to the selected `type.value`, via an async
// Foundry/dnd5e lookup (`v13/homebrew-application.ts`, since that lookup needs the running game, not just
// CONFIG.DND5E — core/ stays Foundry-free, M5 Apply Deploy correction).
// "dependentSubtypeSelect" (M9, generalized M11): `type.subtype` — the field whose *options*, not just
// its visibility, depend on another field's value (`type.value`). M9 built this Consumable-only
// (`consumableSubtypeSelect`); M11 (Feat has the same shape against `featureTypes`) generalizes it —
// the field's own `choicesKind` (`"consumableTypes"` or `"featureTypes"`) names which `CONFIG.DND5E`
// catalog its subtypes come from (dadm/m11-02-apply-output.md, Entscheidung 2). Resolved synchronously
// in `v13/homebrew-application.ts` — no compendium lookup needed, unlike `baseItemSelect`.
export type ItemFieldWidget = "text" | "number" | "select" | "checkbox" | "formula" | "set" | "list" | "weaponDamagePart" | "baseItemSelect" | "dependentSubtypeSelect";

// What a field's `visibleWhen` (M8a, dadm/m8a-02-apply-output.md) gets to see: the two values dnd5e's own item
// sheet actually branches on for Tool/Weapon (`properties.hbs`/`details-weapon.hbs`/`details-tool.hbs`) — nothing
// else conditions any field in either kind's Discover research.
export interface ItemFieldVisibilityContext {
  readonly properties: ReadonlySet<string>;
  readonly typeValue: string;
  // M11: Feat's `enchant.*` visibility needs `type.subtype` too (`isEnchantmentSource`), not just
  // `type.value`/`properties` — optional so every existing caller (none of which needed it) is
  // unaffected (dadm/m11-02-apply-output.md, Entscheidung 5).
  readonly typeSubtype?: string;
  // M18: Vehicle crew thresholds are meaningful only when individual Action Stations are off.
  readonly actionStations?: boolean;
}

export interface ItemField {
  readonly path: string;
  readonly section: ItemFieldSection;
  readonly widget: ItemFieldWidget;
  readonly choicesKind?: ChoicesKind;
  // Absent means "always relevant" (most fields). Mirrors dnd5e's own item sheet exactly (M8a Discover, each
  // condition traced to a getter on WeaponData or a `{{#if}}` in dnd5e's own Handlebars template) — not guessed.
  readonly visibleWhen?: (context: ItemFieldVisibilityContext) => boolean;
  // M11 live-check rework, Fund 1: restricts a `choicesKind`'s own full catalog (`itemProperties` has ~30
  // entries meant for every physical kind combined) down to the keys dnd5e's own `CONFIG.DND5E.
  // validProperties[<subtype>]` actually allows for THIS kind — e.g. Feat only ever has "Magical"/"Trait",
  // not "Ammunition"/"Heavy"/"Reload" (weapon-only properties a Feature can never sensibly carry). Applies
  // only to `widget: "set"` fields with a `choicesKind`; absent means "show the whole catalog" (unchanged
  // behavior for any field that does not set it).
  readonly restrictChoicesTo?: ReadonlySet<string>;
}

// M11 live-check rework: dnd5e's own `CONFIG.DND5E.validProperties[subtype]` (config.mjs:1981 ff.) — the base,
// static set for each kind (a stable dnd5e fact, not a runtime catalog needing localization, same treatment as
// `WEAPON_ATTACK_TYPE`/`SUBTYPE_KEYS_BY_CATALOG` above). Two kinds (`consumable`/`equipment`) extend this
// dynamically per `type.value` in dnd5e's own code (e.g. `ammo` additionally allows every physical damage
// property, `scroll` allows spell properties) — not replicated here, accepted gap (the base set is still a
// major improvement over showing the full, un-filtered `itemProperties` catalog, dadm/m11-05-live-check
// -output.md Runde 2, Fund 1).
export const VALID_PROPERTY_KEYS: Partial<Record<ItemKind, ReadonlySet<string>>> = {
  tool: new Set(["foc", "mgc"]),
  weapon: new Set(["ada", "amm", "fin", "fir", "foc", "hvy", "lgt", "lod", "mgc", "rch", "rel", "ret", "sil", "spc", "thr", "two", "ver"]),
  equipment: new Set(["ada", "foc", "mgc", "stealthDisadvantage"]),
  consumable: new Set(["mgc"]),
  container: new Set(["mgc", "weightlessContents"]),
  feat: new Set(["mgc", "trait"]),
  // M12 Discover Befund 3: added alongside Spell — the same gap already existed for `spell` since
  // `validProperties` was first read in M9, just not yet acted on for a kind that didn't exist yet.
  spell: new Set(["vocal", "somatic", "material", "concentration", "ritual"]),
  // M14 Discover Befund 1: `validProperties.class` has exactly one value (a Sidekick-rules marker).
  class: new Set(["sidekick"]),
};

// CONFIG.DND5E.weaponTypeMap (dnd5e-5.3.x/module/config.mjs:448) — a small, stable dnd5e fact, not a runtime
// catalog needing localization, so it is copied here rather than read live (the same treatment
// core/effect-model.ts's ACTIVE_EFFECT_MODES already gets, M8a Apply Entscheidung 2). "natural"/"improv" have no
// entry in dnd5e's own map either — `weaponAttackType` returns undefined for them, same as dnd5e's `attackType`
// getter returning `null`.
const WEAPON_ATTACK_TYPE: Record<string, "melee" | "ranged"> = {
  simpleM: "melee",
  simpleR: "ranged",
  martialM: "melee",
  martialR: "ranged",
  siege: "ranged",
};

export function weaponAttackType(typeValue: string): "melee" | "ranged" | undefined {
  return WEAPON_ATTACK_TYPE[typeValue];
}

// dnd5e's own `WeaponData#hasRange` (weapon.mjs:288): `attackType === "ranged" || properties.has("thr") ||
// (type.value === "natural" && range.value)`. The third clause is self-referential (an existing range.value); for
// a field newly being filled in there is nothing to reference yet, so it simplifies to "always relevant for
// natural weapons" (M8a Apply Entscheidung 2) — a natural weapon (claws, bite, ...) plausibly has a reach or a
// thrown range either way. An unset `type.value` also counts as "relevant" (dnd5e's own template:
// `{{#if (or system.hasRange (not system.attackType))}}` — nothing chosen yet should not hide fields).
export function weaponHasRange(context: ItemFieldVisibilityContext): boolean {
  const attackType = weaponAttackType(context.typeValue);
  return attackType === "ranged" || context.properties.has("thr") || context.typeValue === "natural" || context.typeValue === "";
}

// dnd5e's own template (details-weapon.hbs:84): Reach is relevant for a mountable (siege) weapon, or for any
// weapon whose attack type is not "ranged" (melee, natural, improv — every non-ranged case).
export function weaponHasReach(context: ItemFieldVisibilityContext): boolean {
  return context.typeValue === "siege" || weaponAttackType(context.typeValue) !== "ranged";
}

export type ItemKind = "tool" | "weapon" | "equipment" | "consumable" | "container" | "feat" | "background" | "spell" | "species" | "class" | "subclass" | "facility" | "npc" | "encounter" | "group" | "vehicle";

export interface ItemKindSpec {
  readonly kind: ItemKind;
  readonly fields: readonly ItemField[];
}

// Fields every physical dnd5e item shares (PhysicalItemTemplate; M4 Discover Befund 5, M8 Discover Befund 2/3) —
// not yet built for Loot (M4 shipped only its name field; a retrofit, if wanted, is its own future milestone, not
// M8's scope, dadm/m8-02-apply-output.md).
const PHYSICAL_FIELDS: readonly ItemField[] = [
  { path: "quantity", section: "physical", widget: "number" },
  { path: "weight.value", section: "physical", widget: "number" },
  { path: "weight.units", section: "physical", widget: "select", choicesKind: "weightUnits" },
  { path: "price.value", section: "physical", widget: "number" },
  { path: "price.denomination", section: "physical", widget: "select", choicesKind: "currencies" },
  { path: "rarity", section: "physical", widget: "select", choicesKind: "itemRarity" },
  // ForeignDocumentField (a single Item UUID) — free text, the same pragmatic fallback M7 already uses for any
  // field with no simple widget (Apply, Entscheidung 3): a document picker is its own UI component, out of scope.
  { path: "container", section: "physical", widget: "text" },
];

// M11 retrofit (dadm/m11-02-apply-output.md, Entscheidung 1): `ItemDescriptionTemplate` — mixed into
// every kind since M8 — has four fields, not the one below; `description.chat` was missing from every
// kind's form since M8 (dadm/m11-01-discover-output.md, Befund 1). Approved by the project lead to
// retrofit here rather than in a separate milestone: adding it to this shared array reaches every
// kind that spreads it, not only Feat/Background.
// M11 live-check Fund 1: `SourceField`'s six `source.*` fields (book/page/custom/license/revision/
// rules) were tried too, but deliberately dropped again — they describe where a passage in an
// *official* sourcebook comes from, a concern this module, built for homebrew content, does not have
// (project lead, live-check rework).
// M11 live-check rework Runde 2, Fund 2: `identifier` (also tried alongside `description.chat`) was
// dropped again too — a slug meaningful mainly for cross-referencing a class/subclass's own Scale Value
// formulas (e.g. `@scale.wizard.spell-slots`). The later guided Advancement builder can create those
// entries, but it does not need a free-standing identifier field in every item form.
const DESCRIPTION_FIELDS: readonly ItemField[] = [
  { path: "identified", section: "description", widget: "checkbox" },
  { path: "description.value", section: "description", widget: "text" },
  { path: "description.chat", section: "description", widget: "text" },
];

// Attunement/Attuned relevant only with the "Magical" property (M8a Discover Befund 3/10, both kinds identically:
// `details-weapon.hbs:28-57`, `details-tool.hbs:37-54`).
const isMagical = (context: ItemFieldVisibilityContext): boolean => context.properties.has("mgc");

// M9: Equipment hides Attunement/Attuned even when magical, for a "vehicle" (mountable) item — dnd5e's own
// template wraps them in `{{#unless system.isMountable}}` (details-equipment.hbs), unlike Tool/Weapon where
// only `isMagical` gates them (M8a). Parameterized so each kind supplies its own combined condition
// (dadm/m9-02-apply-output.md, Entscheidung 1) instead of duplicating the three fields per kind.
function equippableFields(attunementVisible: (context: ItemFieldVisibilityContext) => boolean): readonly ItemField[] {
  return [
    { path: "attunement", section: "equippable", widget: "select", choicesKind: "attunementTypes", visibleWhen: attunementVisible },
    { path: "attuned", section: "equippable", widget: "checkbox", visibleWhen: attunementVisible },
    { path: "equipped", section: "equippable", widget: "checkbox" },
  ];
}

const TOOL_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "toolTypes" },
  { path: "type.baseItem", section: "core", widget: "baseItemSelect", choicesKind: "toolBaseItems" },
  { path: "ability", section: "core", widget: "select", choicesKind: "abilities" },
  { path: "bonus", section: "core", widget: "formula" },
  { path: "chatFlavor", section: "core", widget: "text" },
  { path: "proficient", section: "core", widget: "number" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.tool },
  ...PHYSICAL_FIELDS,
  ...DESCRIPTION_FIELDS,
  ...equippableFields(isMagical),
];

// MountableTemplate (data/item/templates/mountable.mjs) — only meaningful, and (M8a) only shown, for a "siege"
// Weapon (M8 Discover Befund 3, M8a Discover Befund 8: `details-weapon.hbs:124`, `{{#if system.isMountable}}`).
const isMountable = (context: ItemFieldVisibilityContext): boolean => context.typeValue === "siege";

// M9: Equipment also mixes in MountableTemplate, but its own `isMountable` getter checks `type.value ===
// "vehicle"` instead of "siege" (Discover Befund 2/4) — same ten fields, different trigger, so the array is
// parameterized by the predicate rather than duplicated (dadm/m9-02-apply-output.md, Entscheidung 1).
function mountableFields(isMountableFor: (context: ItemFieldVisibilityContext) => boolean): readonly ItemField[] {
  return [
    { path: "cover", section: "mountable", widget: "number", visibleWhen: isMountableFor },
    { path: "crew.max", section: "mountable", widget: "number", visibleWhen: isMountableFor },
    // ArrayField<DocumentUUIDField<Actor>> — comma-separated free text, the same fallback the "set" widget already
    // uses for a Set field with no runtime catalog (Apply, Entscheidung 3).
    { path: "crew.value", section: "mountable", widget: "set", visibleWhen: isMountableFor },
    { path: "hp.conditions", section: "mountable", widget: "text", visibleWhen: isMountableFor },
    { path: "hp.dt", section: "mountable", widget: "number", visibleWhen: isMountableFor },
    { path: "hp.max", section: "mountable", widget: "number", visibleWhen: isMountableFor },
    { path: "hp.value", section: "mountable", widget: "number", visibleWhen: isMountableFor },
    { path: "speed.conditions", section: "mountable", widget: "text", visibleWhen: isMountableFor },
    { path: "speed.units", section: "mountable", widget: "select", choicesKind: "movementUnits", visibleWhen: isMountableFor },
    { path: "speed.value", section: "mountable", widget: "number", visibleWhen: isMountableFor },
  ];
}

// M9: Equipment's own MountableTemplate trigger — `EquipmentData#isMountable` (equipment.mjs) checks
// `type.value === "vehicle"`, unlike Weapon's "siege" (dadm/m9-01-discover-output.md, Befund 2).
export const isEquipmentMountable = (context: ItemFieldVisibilityContext): boolean => context.typeValue === "vehicle";

// M9: the five `CONFIG.DND5E.armorTypes` keys (Discover Befund 2) — Equipment's `type.baseItem` only has a
// base-item catalog for these (`armorIds` for the first four, `shieldIds` for "shield"), and `armor.dex`/
// `strength` are only meaningful for them (dnd5e's own `isArmor` getter, `equipment.mjs`).
const ARMOR_TYPE_VALUES: ReadonlySet<string> = new Set(["light", "medium", "heavy", "natural", "shield"]);

export function isArmorType(typeValue: string): boolean {
  return ARMOR_TYPE_VALUES.has(typeValue);
}

// M9/M11/M15: which `CONFIG.DND5E` catalogs `dependentSubtypeSelect` can resolve against, and which of
// that catalog's top-level keys actually have a `subtypes` sub-catalog (every other key has none).
// Consumable (M9 Discover Befund 3): 2 of 9 `consumableTypes` keys. Feat (M11 Discover Befund 3): 4 of
// 7 `featureTypes` keys. Facility (M15 Discover Befund 4): both of `facilityTypes`' 2 keys. A fixed
// lookup table, not a generic "any catalog" system (dadm/m11-02-apply-output.md, Entscheidung 2).
export type SubtypeCatalog = "consumableTypes" | "featureTypes" | "facilityTypes";

const SUBTYPE_KEYS_BY_CATALOG: Record<SubtypeCatalog, ReadonlySet<string>> = {
  consumableTypes: new Set(["ammo", "poison"]),
  featureTypes: new Set(["class", "enchantment", "feat", "supernaturalGift"]),
  facilityTypes: new Set(["basic", "special"]),
};

export function hasSubtypeCatalog(catalog: SubtypeCatalog, typeValue: string): boolean {
  return SUBTYPE_KEYS_BY_CATALOG[catalog].has(typeValue);
}

const WEAPON_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "weaponTypes" },
  { path: "type.baseItem", section: "core", widget: "baseItemSelect", choicesKind: "weaponBaseItems" },
  { path: "damage.base", section: "core", widget: "weaponDamagePart" },
  { path: "damage.versatile", section: "core", widget: "weaponDamagePart", visibleWhen: (ctx) => ctx.properties.has("ver") },
  { path: "magicalBonus", section: "core", widget: "formula", visibleWhen: isMagical },
  { path: "mastery", section: "core", widget: "select", choicesKind: "weaponMasteries" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.weapon },
  { path: "proficient", section: "core", widget: "number", visibleWhen: (ctx) => !isMountable(ctx) },
  { path: "range.value", section: "core", widget: "number", visibleWhen: weaponHasRange },
  { path: "range.long", section: "core", widget: "number", visibleWhen: weaponHasRange },
  { path: "range.reach", section: "core", widget: "number", visibleWhen: weaponHasReach },
  { path: "range.units", section: "core", widget: "select", choicesKind: "distanceUnits" },
  { path: "ammunition.type", section: "core", widget: "select", choicesKind: "ammoTypes", visibleWhen: (ctx) => ctx.properties.has("amm") },
  // Rendered only inside dnd5e's own "Siege Weapon Mount" fieldset (templates/items/details/details-mountable.hbs:8,
  // included only `{{#if system.isMountable}}`) — belongs with the Mountable block, not always-on "core" (M8a
  // follow-up, live-check finding: this field had no visibleWhen yet, unlike the rest of the Mountable set).
  { path: "armor.value", section: "core", widget: "number", visibleWhen: isMountable },
  ...PHYSICAL_FIELDS,
  ...DESCRIPTION_FIELDS,
  ...equippableFields(isMagical),
  ...mountableFields(isMountable),
];

// M9: Equipment (dadm/m9-02-apply-output.md, Feldliste Equipment). `type.baseItem` reuses the M8a
// `baseItemSelect` mechanism with a new `equipmentBaseItems` choicesKind (combined `armorIds`/`shieldIds`,
// resolved in `v13/homebrew-application.ts`); it and `armor.dex`/`strength` are only relevant for the five
// armor/shield type values (`isArmorType`, Discover Befund 2).
const EQUIPMENT_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "equipmentTypes" },
  { path: "type.baseItem", section: "core", widget: "baseItemSelect", choicesKind: "equipmentBaseItems", visibleWhen: (ctx) => isArmorType(ctx.typeValue) },
  { path: "armor.value", section: "core", widget: "number" },
  { path: "armor.dex", section: "core", widget: "number", visibleWhen: (ctx) => isArmorType(ctx.typeValue) && ctx.typeValue !== "shield" },
  { path: "armor.magicalBonus", section: "core", widget: "formula", visibleWhen: isMagical },
  { path: "proficient", section: "core", widget: "number" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.equipment },
  { path: "strength", section: "core", widget: "number", visibleWhen: (ctx) => isArmorType(ctx.typeValue) },
  ...PHYSICAL_FIELDS,
  ...DESCRIPTION_FIELDS,
  // M9: Attunement/Attuned stay hidden for a "vehicle" item even when magical (Discover Befund 4) — the one
  // difference from Tool/Weapon's plain `isMagical` gate.
  ...equippableFields((ctx) => isMagical(ctx) && !isEquipmentMountable(ctx)),
  ...mountableFields(isEquipmentMountable),
];

// M9: Consumable (dadm/m9-02-apply-output.md, Feldliste Consumable). No `type.baseItem` (`ItemTypeField({
// baseItem: false })`) and no MountableTemplate — but a `type.subtype` with its own dynamic widget
// (Entscheidung 5), a damage block reused from Weapon (Entscheidung 4), and Activities' own Uses widgets
// reused for the item-level `uses` field (Entscheidung 6).
const CONSUMABLE_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "consumableTypes" },
  { path: "type.subtype", section: "core", widget: "dependentSubtypeSelect", choicesKind: "consumableTypes", visibleWhen: (ctx) => hasSubtypeCatalog("consumableTypes", ctx.typeValue) },
  { path: "damage.base", section: "core", widget: "weaponDamagePart", visibleWhen: (ctx) => ctx.typeValue === "ammo" },
  { path: "damage.replace", section: "core", widget: "checkbox", visibleWhen: (ctx) => ctx.typeValue === "ammo" },
  { path: "magicalBonus", section: "core", widget: "formula", visibleWhen: (ctx) => isMagical(ctx) && ctx.typeValue === "ammo" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.consumable },
  { path: "uses.spent", section: "uses", widget: "number" },
  { path: "uses.max", section: "uses", widget: "formula" },
  { path: "uses.recovery", section: "uses", widget: "list" },
  { path: "uses.autoDestroy", section: "uses", widget: "checkbox" },
  ...PHYSICAL_FIELDS,
  ...DESCRIPTION_FIELDS,
  ...equippableFields(isMagical),
];

// M10: Container (dadm/m10-02-apply-output.md). No `ItemTypeTemplate` at all (Discover Befund: no
// `type.*` row in the field inventory) — the first of the four mature kinds with no `type.value`
// selector, so none of its own fields (Entscheidung 1) carry a `visibleWhen`; `equippableFields(
// isMagical)` still gives it the usual attunement/attuned condition, unchanged. `quantity` is
// excluded from the shared `PHYSICAL_FIELDS` (Entscheidung 2): dnd5e forces it to `1` on every save
// (`ContainerData#_migrateQuantity`), so an editable control for it would silently discard whatever
// was typed. `currency.*` (Entscheidung 3) and `capacity.*` (Entscheidung 4) are new to this kind —
// dnd5e itself renders `currency` through its own `CurrencyManager` dialog, not inline, so this is
// the same "no dedicated UI component, fall back to plain fields" treatment `container` (a document
// reference) already gets in `PHYSICAL_FIELDS`.
const CONTAINER_FIELDS: readonly ItemField[] = [
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.container },
  { path: "capacity.count", section: "core", widget: "number" },
  { path: "capacity.volume.value", section: "core", widget: "number" },
  { path: "capacity.volume.units", section: "core", widget: "select", choicesKind: "volumeUnits" },
  { path: "capacity.weight.value", section: "core", widget: "number" },
  { path: "capacity.weight.units", section: "core", widget: "select", choicesKind: "weightUnits" },
  { path: "currency.pp", section: "core", widget: "number" },
  { path: "currency.gp", section: "core", widget: "number" },
  { path: "currency.ep", section: "core", widget: "number" },
  { path: "currency.sp", section: "core", widget: "number" },
  { path: "currency.cp", section: "core", widget: "number" },
  ...PHYSICAL_FIELDS.filter((field) => field.path !== "quantity"),
  ...DESCRIPTION_FIELDS,
  ...equippableFields(isMagical),
];

// M11: `FeatData#isEnchantmentSource` (feat.mjs) — `type.value` is a `featureTypes` key with its own
// `subtypes` catalog, and `type.subtype` is one of that key's subtype keys. In practice (dnd5e's own
// `featureTypes.enchantment.subtypes`): `type.value === "enchantment"` and `type.subtype` one of
// `artificerInfusion`/`rune`. Needs `context.typeSubtype` (the new, optional context field).
export function isEnchantmentSource(context: ItemFieldVisibilityContext): boolean {
  return context.typeValue === "enchantment" && (context.typeSubtype === "artificerInfusion" || context.typeSubtype === "rune");
}

// M11: Feat (dadm/m11-02-apply-output.md, Feldliste Feat). No `PhysicalItemTemplate`/
// `EquippableItemTemplate` at all (Discover Befund 3) — a Feature is not a physical object, so none of
// `PHYSICAL_FIELDS`/`equippableFields`/`mountableFields` apply. M16b moved `advancement` out of this
// generic field list into the shared guided Advancement builder.
const FEAT_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "featureTypes" },
  { path: "type.subtype", section: "core", widget: "dependentSubtypeSelect", choicesKind: "featureTypes", visibleWhen: (ctx) => hasSubtypeCatalog("featureTypes", ctx.typeValue) },
  { path: "requirements", section: "core", widget: "text" },
  { path: "prerequisites.level", section: "core", widget: "number" },
  { path: "prerequisites.items", section: "core", widget: "set" },
  { path: "prerequisites.repeatable", section: "core", widget: "checkbox" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.feat },
  { path: "cover", section: "core", widget: "number", visibleWhen: (ctx) => ctx.typeValue === "vehicle" },
  // Present in the schema but never shown by dnd5e's own sheet under any condition (Discover Befund 3)
  // — kept unconditionally visible, the same N21 precedent as Weapon's Mountable speed fields (M8a).
  { path: "crewed", section: "core", widget: "checkbox" },
  { path: "enchant.max", section: "core", widget: "formula", visibleWhen: isEnchantmentSource },
  { path: "enchant.period", section: "core", widget: "select", choicesKind: "enchantmentPeriods", visibleWhen: isEnchantmentSource },
  ...DESCRIPTION_FIELDS,
];

// M11: Background (dadm/m11-02-apply-output.md, Feldliste Background) — the narrowest kind in the
// project: no `ActivitiesTemplate` (`core/catalog.ts`'s `ACTIVITY_KINDS` already correctly excludes
// it, Discover Befund 4), no physical/equippable templates — `wealth` is its only own simple field.
// `startingEquipment` remains a list field; M16b handles `advancement` in the guided builder.
const BACKGROUND_FIELDS: readonly ItemField[] = [
  { path: "wealth", section: "core", widget: "formula" },
  { path: "startingEquipment", section: "advanced", widget: "list" },
  ...DESCRIPTION_FIELDS,
];

// M12: Spell (dadm/m12-02-apply-output.md, Entscheidung 2). No `PhysicalItemTemplate`/
// `EquippableItemTemplate` (like Feat) — but it DOES reuse `ActivitiesTemplate`'s own
// `activation`/`duration`/`range`/`target` shared field classes directly on its own schema (Discover
// Befund 1), the exact same shapes `core/activity-model.ts` already built widgets for. Copied here as
// its own `ItemField` entries (deliberate small duplication of the path list, not the mechanism —
// `ActivityField`/`ItemField` stay separate types, M8 Apply Entscheidung 1). M12 live-check rework
// (2026-09-27): `duration.units`/`range.units`/`target.template.type`/`target.affects.type` had no
// `choicesKind` since M5-M7 (an old gap, not this milestone's own) — fixed here and in
// `core/activity-model.ts` together, not left as "not this milestone's to fix": the project lead's own
// standing principle is that every step keeps Homebrew as free of raw dnd5e knowledge as possible,
// which an old gap does not exempt.
const SPELL_FIELDS: readonly ItemField[] = [
  { path: "school", section: "core", widget: "select", choicesKind: "spellSchools" },
  { path: "level", section: "core", widget: "number" },
  { path: "ability", section: "core", widget: "select", choicesKind: "abilities" },
  { path: "method", section: "core", widget: "select", choicesKind: "spellcastingMethods" },
  { path: "prepared", section: "core", widget: "select", choicesKind: "spellPreparationStates" },
  { path: "materials.value", section: "core", widget: "text" },
  { path: "materials.consumed", section: "core", widget: "checkbox" },
  { path: "materials.cost", section: "core", widget: "number" },
  { path: "materials.supply", section: "core", widget: "number" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.spell },
  { path: "sourceItem", section: "core", widget: "text" },
  { path: "activation.type", section: "core", widget: "select", choicesKind: "activationTypes" },
  { path: "activation.value", section: "core", widget: "number" },
  { path: "activation.condition", section: "core", widget: "text" },
  { path: "duration.value", section: "core", widget: "formula" },
  { path: "duration.units", section: "core", widget: "select", choicesKind: "durationUnits" },
  { path: "duration.special", section: "core", widget: "text" },
  { path: "duration.concentration", section: "core", widget: "checkbox" },
  { path: "range.value", section: "core", widget: "formula" },
  { path: "range.units", section: "core", widget: "select", choicesKind: "distanceUnits" },
  { path: "range.special", section: "core", widget: "text" },
  { path: "target.template.count", section: "core", widget: "formula" },
  { path: "target.template.type", section: "core", widget: "select", choicesKind: "areaTargetTypes" },
  { path: "target.template.size", section: "core", widget: "formula" },
  { path: "target.template.width", section: "core", widget: "formula" },
  { path: "target.affects.count", section: "core", widget: "formula" },
  { path: "target.affects.type", section: "core", widget: "select", choicesKind: "individualTargetTypes" },
  { path: "target.affects.choice", section: "core", widget: "checkbox" },
  ...DESCRIPTION_FIELDS,
];

// M12: Species (dadm/m12-02-apply-output.md, Feldliste Species) — no `type.subtype` dependent select
// (Discover Befund 4: unlike Feat/Consumable, `CreatureTypeField`'s `subtype` is a plain free-text
// field, not looked up from a nested catalog). `senses.ranges.*` are four fixed dnd5e keys
// (`CONFIG.DND5E.senses`, `initialKeysOnly: true`) written out directly, the same treatment
// Container's `currency.*` already got (M10 Entscheidung 3).
const SPECIES_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "creatureTypes" },
  { path: "type.subtype", section: "core", widget: "text" },
  { path: "type.custom", section: "core", widget: "text" },
  { path: "movement.walk", section: "core", widget: "formula" },
  { path: "movement.burrow", section: "core", widget: "formula" },
  { path: "movement.climb", section: "core", widget: "formula" },
  { path: "movement.fly", section: "core", widget: "formula" },
  { path: "movement.swim", section: "core", widget: "formula" },
  { path: "movement.units", section: "core", widget: "select", choicesKind: "movementUnits" },
  { path: "senses.ranges.darkvision", section: "core", widget: "number" },
  { path: "senses.ranges.blindsight", section: "core", widget: "number" },
  { path: "senses.ranges.tremorsense", section: "core", widget: "number" },
  { path: "senses.ranges.truesight", section: "core", widget: "number" },
  { path: "senses.units", section: "core", widget: "select", choicesKind: "movementUnits" },
  { path: "senses.special", section: "core", widget: "text" },
  ...DESCRIPTION_FIELDS,
];

// M14 Apply Entscheidung 1: `identifier` (dropped from DESCRIPTION_FIELDS for every kind in M11 —
// "a slug meaningful only for cross-referencing a class/subclass's own Scale Value formulas") is
// exactly what Class/Subclass need for the Subclass -> Class link (Discover Befund 3-4: a plain
// identifier-string match, not a document reference) — added directly here, not to the shared array,
// so the other eleven kinds are unaffected.
const CLASS_FIELDS: readonly ItemField[] = [
  { path: "identifier", section: "core", widget: "text" },
  { path: "hd.denomination", section: "core", widget: "select", choicesKind: "hitDieTypes" },
  { path: "hd.additional", section: "core", widget: "formula" },
  { path: "primaryAbility.value", section: "core", widget: "set", choicesKind: "abilities" },
  { path: "primaryAbility.all", section: "core", widget: "checkbox" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.class },
  { path: "spellcasting.progression", section: "core", widget: "select", choicesKind: "spellcastingProgression" },
  { path: "spellcasting.ability", section: "core", widget: "select", choicesKind: "abilities" },
  { path: "spellcasting.preparation.formula", section: "core", widget: "formula" },
  // `levels` (M14 Discover Befund 1: a pure character-runtime value, Foundry defaults a new item to 1) and
  // `hd.spent` are deliberately not fields here, the same reasoning M8-M13 already apply to every other
  // runtime-only value (e.g. `uses.spent`, M9).
  { path: "startingEquipment", section: "advanced", widget: "list" },
  ...DESCRIPTION_FIELDS,
];

// M14: much narrower than Class — Subclass has no hit die, no starting equipment, no primary ability
// (multiclassing prerequisites belong to the Class, not the Subclass).
const SUBCLASS_FIELDS: readonly ItemField[] = [
  { path: "identifier", section: "core", widget: "text" },
  { path: "classIdentifier", section: "core", widget: "text" },
  { path: "spellcasting.progression", section: "core", widget: "select", choicesKind: "spellcastingProgression" },
  { path: "spellcasting.ability", section: "core", widget: "select", choicesKind: "abilities" },
  { path: "spellcasting.preparation.formula", section: "core", widget: "formula" },
  ...DESCRIPTION_FIELDS,
];

// M15: `type.value`/`type.subtype` reuse the same dependent-select mechanism as Feat/Consumable
// (Discover Befund 4) — both possible `type.value` values have their own subtype list, unlike those
// two kinds. `defenders.max`/`hirelings.max`/`trade.creatures.max` are the capacity a Facility offers,
// kept even though `trade.creatures.max` only matters for a trading-post Facility (harmless as an
// always-empty field otherwise, the same treatment Container's `currency.*` gets for a Container that
// never holds coins). Every runtime/derived field (`building.built`, `enlargeable`, `disabled`,
// `order`, `progress.*`, `craft.*`, `defenders.value`, `hirelings.value`, `trade.pending.*`/`.profit`/
// `.stock.*`) and the unread `building.size` are Non-Goals (Discover Befund 2-3).
const FACILITY_FIELDS: readonly ItemField[] = [
  { path: "type.value", section: "core", widget: "select", choicesKind: "facilityTypes" },
  { path: "type.subtype", section: "core", widget: "dependentSubtypeSelect", choicesKind: "facilityTypes", visibleWhen: (ctx) => hasSubtypeCatalog("facilityTypes", ctx.typeValue) },
  { path: "size", section: "core", widget: "select", choicesKind: "facilitySizes" },
  { path: "level", section: "core", widget: "number" },
  { path: "defenders.max", section: "core", widget: "number" },
  { path: "hirelings.max", section: "core", widget: "number" },
  { path: "trade.creatures.max", section: "core", widget: "number" },
  { path: "free", section: "core", widget: "checkbox" },
  ...DESCRIPTION_FIELDS,
];

// M16: the six ability scores/save proficiencies and eighteen skill proficiencies (Discover Befund 2)
// share one shape each — written out from a short key list rather than eighteen near-identical literal
// lines, the same "small, fixed table" treatment M10's `currency.*` already got, just built once instead
// of copied by hand.
const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
const SKILL_KEYS = ["acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv", "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"];

// M16 (dadm/m16-02-apply-output.md, Entscheidung 1): NPC is the first Actor kind with a full field
// model — the mechanism itself (`buildItemFieldData`/`buildPathData`, `#renderItemFieldSections`) never
// assumed an Item, only ever nested flat paths under `system.*`, so it applies unchanged (Entscheidung
// 5: no separate "Actor kind" structure introduced for this). Movement/Senses/CreatureType are the
// exact same field groups Species (M12) already has, just under `attributes.*` instead of the item's
// own root. `DESCRIPTION_FIELDS` is **not** spread here — that array is Item-specific
// (`identified`/`description.*`, from `ItemDescriptionTemplate`), which NPCData does not have; its own
// equivalent is `details.biography.*`, listed explicitly below. Actions/Legendary Actions and `tools`
// (Human Decision `m16-hd-1-output.md`, Entscheidungen 1-2) are deliberately absent — Non-Goals for
// M16, vorgesehen für M16a.
//
// M16 live-check rework: ~48 fields in one flat "core" section read as an undifferentiated wall of
// fields (project lead) — split across six sections (`abilityScores`/`skills`/`combat`/`movement`/
// `senses`/`resistances`, plus `core`/`description` for identity and roleplay text), the same
// treatment "uses"/"mountable" already give Consumable's/Weapon's own less-common fields, just for a
// much larger kind. Also converted `abilities.<key>.proficient` and `skills.<key>.value` from a bare
// number input to a `select` — dnd5e already ships exactly the right catalogs for both
// (`weaponAndArmorProficiencyLevels`, a plain 0/1 map; `proficiencyLevels`, 0/0.5/1/2) — the same
// "value-keyed select" shape M12's `prepared` field already established for Spell, reused here as-is
// (no new mechanism, `readFieldValue`'s existing default branch already round-trips a numeric string
// into dnd5e's `NumberField` correctly, confirmed live by `prepared` in M12).
const NPC_FIELDS: readonly ItemField[] = [
  ...ABILITY_KEYS.flatMap((key): ItemField[] => [
    { path: `abilities.${key}.value`, section: "abilityScores", widget: "number" },
    { path: `abilities.${key}.proficient`, section: "abilityScores", widget: "select", choicesKind: "saveProficiencyLevels" },
  ]),
  ...SKILL_KEYS.map((key): ItemField => ({ path: `skills.${key}.value`, section: "skills", widget: "select", choicesKind: "proficiencyLevels" })),
  { path: "traits.size", section: "core", widget: "select", choicesKind: "actorSizes" },
  { path: "details.type.value", section: "core", widget: "select", choicesKind: "creatureTypes" },
  { path: "details.type.subtype", section: "core", widget: "text" },
  { path: "details.type.custom", section: "core", widget: "text" },
  { path: "details.cr", section: "core", widget: "number" },
  { path: "details.alignment", section: "description", widget: "text" },
  { path: "details.ideal", section: "description", widget: "text" },
  { path: "details.bond", section: "description", widget: "text" },
  { path: "details.flaw", section: "description", widget: "text" },
  { path: "details.biography.value", section: "description", widget: "text" },
  { path: "details.biography.public", section: "description", widget: "text" },
  { path: "attributes.ac.calc", section: "combat", widget: "select", choicesKind: "armorClassCalculations" },
  { path: "attributes.ac.flat", section: "combat", widget: "number" },
  { path: "attributes.ac.formula", section: "combat", widget: "formula" },
  { path: "attributes.hp.formula", section: "combat", widget: "formula" },
  { path: "attributes.init.bonus", section: "combat", widget: "formula" },
  { path: "attributes.attunement.max", section: "combat", widget: "number" },
  { path: "attributes.exhaustion", section: "combat", widget: "number" },
  { path: "attributes.spellcasting", section: "combat", widget: "select", choicesKind: "abilities" },
  { path: "resources.legact.max", section: "combat", widget: "number" },
  { path: "resources.legres.max", section: "combat", widget: "number" },
  { path: "resources.lair.value", section: "combat", widget: "checkbox" },
  { path: "resources.lair.initiative", section: "combat", widget: "number" },
  { path: "resources.lair.inside", section: "combat", widget: "checkbox" },
  { path: "attributes.movement.walk", section: "movement", widget: "formula" },
  { path: "attributes.movement.burrow", section: "movement", widget: "formula" },
  { path: "attributes.movement.climb", section: "movement", widget: "formula" },
  { path: "attributes.movement.fly", section: "movement", widget: "formula" },
  { path: "attributes.movement.swim", section: "movement", widget: "formula" },
  { path: "attributes.movement.units", section: "movement", widget: "select", choicesKind: "movementUnits" },
  { path: "attributes.senses.ranges.darkvision", section: "senses", widget: "number" },
  { path: "attributes.senses.ranges.blindsight", section: "senses", widget: "number" },
  { path: "attributes.senses.ranges.tremorsense", section: "senses", widget: "number" },
  { path: "attributes.senses.ranges.truesight", section: "senses", widget: "number" },
  { path: "attributes.senses.units", section: "senses", widget: "select", choicesKind: "movementUnits" },
  { path: "attributes.senses.special", section: "senses", widget: "text" },
  { path: "traits.di.value", section: "resistances", widget: "set", choicesKind: "damageTypes" },
  { path: "traits.di.custom", section: "resistances", widget: "text" },
  { path: "traits.dr.value", section: "resistances", widget: "set", choicesKind: "damageTypes" },
  { path: "traits.dr.custom", section: "resistances", widget: "text" },
  { path: "traits.dv.value", section: "resistances", widget: "set", choicesKind: "damageTypes" },
  { path: "traits.dv.custom", section: "resistances", widget: "text" },
  { path: "traits.ci.value", section: "resistances", widget: "set", choicesKind: "effectConditions" },
  { path: "traits.ci.custom", section: "resistances", widget: "text" },
  { path: "traits.languages.value", section: "resistances", widget: "set", choicesKind: "effectLanguages" },
  { path: "traits.languages.custom", section: "resistances", widget: "text" },
];

// M17: Encounter and Group share dnd5e's GroupTemplate (CurrencyTemplate plus its own two-part
// description). These are Actor system fields, not ItemDescriptionTemplate: no `identified`,
// `description.value`, or `description.chat`. Members get their own guided Actor-reference builder
// because their schema differs between the two Actor kinds (core/actor-member-model.ts).
const GROUP_ACTOR_COMMON_FIELDS: readonly ItemField[] = [
  { path: "currency.pp", section: "currency", widget: "number" },
  { path: "currency.gp", section: "currency", widget: "number" },
  { path: "currency.ep", section: "currency", widget: "number" },
  { path: "currency.sp", section: "currency", widget: "number" },
  { path: "currency.cp", section: "currency", widget: "number" },
  { path: "description.summary", section: "description", widget: "text" },
  { path: "description.full", section: "description", widget: "text" },
];

const ENCOUNTER_FIELDS: readonly ItemField[] = [...GROUP_ACTOR_COMMON_FIELDS];

// TravelField uses two fixed, three-key MappingFields (`paces` and `speeds`) rather than an open
// object, so each land/water/air formula is represented explicitly. Derived `max`/`prePace` values
// are prepared by dnd5e and are deliberately not inputs.
const GROUP_FIELDS: readonly ItemField[] = [
  { path: "details.xp.value", section: "core", widget: "number" },
  { path: "attributes.travel.pace", section: "travel", widget: "select", choicesKind: "travelPace" },
  { path: "attributes.travel.paces.land", section: "travel", widget: "formula" },
  { path: "attributes.travel.paces.water", section: "travel", widget: "formula" },
  { path: "attributes.travel.paces.air", section: "travel", widget: "formula" },
  { path: "attributes.travel.speeds.land", section: "travel", widget: "formula" },
  { path: "attributes.travel.speeds.water", section: "travel", widget: "formula" },
  { path: "attributes.travel.speeds.air", section: "travel", widget: "formula" },
  { path: "attributes.travel.time", section: "travel", widget: "number" },
  { path: "attributes.travel.units", section: "travel", widget: "select", choicesKind: "travelUnits" },
  ...GROUP_ACTOR_COMMON_FIELDS,
];

// M18: Vehicle is the second full Actor field model. dnd5e 5.3.3 has one shared schema for
// air/land/space/water vehicles; `details.type` selects the presentation, not a different model.
// Runtime values (current HP, spent actions), derived values and legacy migration fields are absent.
// Actor references and the open damage-modifier mapping use guided builders in their own core files.
const VEHICLE_FIELDS: readonly ItemField[] = [
  { path: "details.type", section: "core", widget: "select", choicesKind: "vehicleTypes" },
  { path: "traits.size", section: "core", widget: "select", choicesKind: "actorSizes" },
  { path: "attributes.price.value", section: "core", widget: "number" },
  { path: "attributes.price.denomination", section: "core", widget: "select", choicesKind: "currencies" },
  { path: "attributes.quality.value", section: "core", widget: "number" },
  ...ABILITY_KEYS.flatMap((key): ItemField[] => [
    { path: `abilities.${key}.value`, section: "abilityScores", widget: "number" },
    { path: `abilities.${key}.proficient`, section: "abilityScores", widget: "select", choicesKind: "saveProficiencyLevels" },
    { path: `abilities.${key}.max`, section: "abilityScores", widget: "number" },
    { path: `abilities.${key}.bonuses.check`, section: "abilityScores", widget: "formula" },
    { path: `abilities.${key}.bonuses.save`, section: "abilityScores", widget: "formula" },
    { path: `abilities.${key}.check.roll.min`, section: "abilityScores", widget: "number" },
    { path: `abilities.${key}.check.roll.max`, section: "abilityScores", widget: "number" },
    { path: `abilities.${key}.check.roll.mode`, section: "abilityScores", widget: "select", choicesKind: "rollModes" },
    { path: `abilities.${key}.save.roll.min`, section: "abilityScores", widget: "number" },
    { path: `abilities.${key}.save.roll.max`, section: "abilityScores", widget: "number" },
    { path: `abilities.${key}.save.roll.mode`, section: "abilityScores", widget: "select", choicesKind: "rollModes" },
  ]),
  { path: "attributes.ac.calc", section: "combat", widget: "select", choicesKind: "armorClassCalculations" },
  { path: "attributes.ac.flat", section: "combat", widget: "number" },
  { path: "attributes.ac.formula", section: "combat", widget: "formula" },
  { path: "attributes.hp.max", section: "combat", widget: "number" },
  { path: "attributes.hp.dt", section: "combat", widget: "number" },
  { path: "attributes.hp.mt", section: "combat", widget: "number" },
  { path: "attributes.init.ability", section: "combat", widget: "select", choicesKind: "abilities" },
  { path: "attributes.init.bonus", section: "combat", widget: "formula" },
  { path: "attributes.init.roll.min", section: "combat", widget: "number" },
  { path: "attributes.init.roll.max", section: "combat", widget: "number" },
  { path: "attributes.init.roll.mode", section: "combat", widget: "select", choicesKind: "rollModes" },
  { path: "attributes.actions.stations", section: "actions", widget: "checkbox" },
  { path: "attributes.actions.max", section: "actions", widget: "number" },
  { path: "attributes.actions.thresholds.0", section: "actions", widget: "number", visibleWhen: (ctx) => !ctx.actionStations },
  { path: "attributes.actions.thresholds.1", section: "actions", widget: "number", visibleWhen: (ctx) => !ctx.actionStations },
  { path: "attributes.actions.thresholds.2", section: "actions", widget: "number", visibleWhen: (ctx) => !ctx.actionStations },
  { path: "attributes.movement.walk", section: "movement", widget: "formula" },
  { path: "attributes.movement.burrow", section: "movement", widget: "formula" },
  { path: "attributes.movement.climb", section: "movement", widget: "formula" },
  { path: "attributes.movement.fly", section: "movement", widget: "formula" },
  { path: "attributes.movement.swim", section: "movement", widget: "formula" },
  { path: "attributes.movement.bonus", section: "movement", widget: "formula" },
  { path: "attributes.movement.special", section: "movement", widget: "text" },
  { path: "attributes.movement.units", section: "movement", widget: "select", choicesKind: "movementUnits" },
  { path: "attributes.movement.hover", section: "movement", widget: "checkbox" },
  { path: "attributes.movement.ignoredDifficultTerrain", section: "movement", widget: "set", choicesKind: "ignoredDifficultTerrain" },
  { path: "attributes.travel.paces.land", section: "travel", widget: "formula" },
  { path: "attributes.travel.paces.water", section: "travel", widget: "formula" },
  { path: "attributes.travel.paces.air", section: "travel", widget: "formula" },
  { path: "attributes.travel.speeds.land", section: "travel", widget: "formula" },
  { path: "attributes.travel.speeds.water", section: "travel", widget: "formula" },
  { path: "attributes.travel.speeds.air", section: "travel", widget: "formula" },
  { path: "attributes.travel.time", section: "travel", widget: "number" },
  { path: "attributes.travel.units", section: "travel", widget: "select", choicesKind: "travelUnits" },
  { path: "attributes.capacity.cargo.value", section: "capacity", widget: "number" },
  { path: "attributes.capacity.cargo.units", section: "capacity", widget: "select", choicesKind: "weightUnits" },
  { path: "crew.max", section: "capacity", widget: "number" },
  { path: "passengers.max", section: "capacity", widget: "number" },
  { path: "traits.weight.value", section: "capacity", widget: "number" },
  { path: "traits.weight.units", section: "capacity", widget: "select", choicesKind: "weightUnits" },
  { path: "traits.keel.value", section: "capacity", widget: "number" },
  { path: "traits.keel.units", section: "capacity", widget: "select", choicesKind: "distanceUnits" },
  { path: "traits.beam.value", section: "capacity", widget: "number" },
  { path: "traits.beam.units", section: "capacity", widget: "select", choicesKind: "distanceUnits" },
  { path: "traits.di.value", section: "resistances", widget: "set", choicesKind: "damageTypes" },
  { path: "traits.di.custom", section: "resistances", widget: "text" },
  { path: "traits.di.bypasses", section: "resistances", widget: "set", choicesKind: "physicalItemProperties" },
  { path: "traits.dr.value", section: "resistances", widget: "set", choicesKind: "damageTypes" },
  { path: "traits.dr.custom", section: "resistances", widget: "text" },
  { path: "traits.dr.bypasses", section: "resistances", widget: "set", choicesKind: "physicalItemProperties" },
  { path: "traits.dv.value", section: "resistances", widget: "set", choicesKind: "damageTypes" },
  { path: "traits.dv.custom", section: "resistances", widget: "text" },
  { path: "traits.dv.bypasses", section: "resistances", widget: "set", choicesKind: "physicalItemProperties" },
  { path: "traits.dm.bypasses", section: "resistances", widget: "set", choicesKind: "physicalItemProperties" },
  { path: "traits.ci.value", section: "resistances", widget: "set", choicesKind: "effectConditions" },
  { path: "traits.ci.custom", section: "resistances", widget: "text" },
  { path: "currency.pp", section: "currency", widget: "number" },
  { path: "currency.gp", section: "currency", widget: "number" },
  { path: "currency.ep", section: "currency", widget: "number" },
  { path: "currency.sp", section: "currency", widget: "number" },
  { path: "currency.cp", section: "currency", widget: "number" },
  { path: "details.biography.value", section: "description", widget: "text" },
  { path: "details.biography.public", section: "description", widget: "text" },
  { path: "source.book", section: "source", widget: "text" },
  { path: "source.page", section: "source", widget: "text" },
  { path: "source.custom", section: "source", widget: "text" },
  { path: "source.license", section: "source", widget: "text" },
  { path: "source.revision", section: "source", widget: "number" },
];

export const ITEM_KIND_SPECS: readonly ItemKindSpec[] = Object.freeze([
  Object.freeze({ kind: "tool", fields: Object.freeze(TOOL_FIELDS) }),
  Object.freeze({ kind: "weapon", fields: Object.freeze(WEAPON_FIELDS) }),
  Object.freeze({ kind: "equipment", fields: Object.freeze(EQUIPMENT_FIELDS) }),
  Object.freeze({ kind: "consumable", fields: Object.freeze(CONSUMABLE_FIELDS) }),
  Object.freeze({ kind: "container", fields: Object.freeze(CONTAINER_FIELDS) }),
  Object.freeze({ kind: "feat", fields: Object.freeze(FEAT_FIELDS) }),
  Object.freeze({ kind: "background", fields: Object.freeze(BACKGROUND_FIELDS) }),
  Object.freeze({ kind: "spell", fields: Object.freeze(SPELL_FIELDS) }),
  Object.freeze({ kind: "species", fields: Object.freeze(SPECIES_FIELDS) }),
  Object.freeze({ kind: "class", fields: Object.freeze(CLASS_FIELDS) }),
  Object.freeze({ kind: "subclass", fields: Object.freeze(SUBCLASS_FIELDS) }),
  Object.freeze({ kind: "facility", fields: Object.freeze(FACILITY_FIELDS) }),
  Object.freeze({ kind: "npc", fields: Object.freeze(NPC_FIELDS) }),
  Object.freeze({ kind: "encounter", fields: Object.freeze(ENCOUNTER_FIELDS) }),
  Object.freeze({ kind: "group", fields: Object.freeze(GROUP_FIELDS) }),
  Object.freeze({ kind: "vehicle", fields: Object.freeze(VEHICLE_FIELDS) }),
]);

export function specForItemKind(kind: ItemKind): ItemKindSpec {
  const spec = ITEM_KIND_SPECS.find((entry) => entry.kind === kind);
  if (!spec) throw new Error(`item-field-model: no spec for kind "${kind}"`);
  return spec;
}

// Builds a dnd5e system-data object from form values (path -> value), for document.create's `data.system` — the
// same "drop an empty string, keep everything else, nest dotted paths" treatment core/activity-model.ts's
// buildActivityData gives Activities (M5 Apply, section 3), minus the forced `type` field (an item kind's Foundry
// `type` is set once at document.create's top level, not inside `system`).
export function buildItemFieldData(values: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  const kept: Record<string, JsonValue> = {};
  for (const [path, value] of Object.entries(values)) {
    if (value !== "") kept[path] = value;
  }
  return buildPathData(kept);
}
