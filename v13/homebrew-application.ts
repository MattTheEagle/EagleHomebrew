import { entryKey, sameEntry } from "../core/name-key";
import { currentRulesVersion, planCreation, type TargetIndex } from "../core/creation-target";
import { validateName } from "../core/creation-form";
import { createPair, type JsonValue, type RequestSender } from "../core/create-pair";
import { updateDocument } from "../core/document-update";
import { executeSave, planSave, projectCollection, projectMapping, valueAt, type JsonObject } from "../core/edit-projection";
import { entryByKey, subcategoriesOf, type Art, type CatalogEntry } from "../core/catalog";
import { buildActivityData, specFor, type ActivityField, type ActivityType } from "../core/activity-model";
import { buildActivitiesChanges, type ActivityDraft } from "../core/activity-batch";
import { findJsonViolation } from "../core/json-check";
import { ACTIVE_EFFECT_MODES, type EffectChange, type EffectModel } from "../core/effect-model";
import { EFFECT_TARGETS, effectTargetById, resolveEffectChange, type EffectTarget } from "../core/effect-targets";
import type { ChoicesKind } from "../core/activity-model";
import { specForItemKind, buildItemFieldData, type ItemField, type ItemFieldVisibilityContext, type ItemKind, type SubtypeCatalog } from "../core/item-field-model";
import { buildTableResults, type TableResultDraft } from "../core/table-result";
import {
  advancementTypesFor,
  isAdvancementKind,
  specForAdvancement,
  buildAdvancementData,
  validSizeSelection,
  type AdvancementField,
  type AdvancementKind,
  type AdvancementType,
} from "../core/advancement-model";
import { buildAdvancementChanges, type AdvancementDraft } from "../core/advancement-batch";
import { actionItemFields, buildNpcActionItemsChanges, npcActionCategory, type NpcActionCategory, type NpcActionDraft, type NpcActionItemType } from "../core/npc-action-model";
import {
  buildEncounterMembers,
  buildGroupMembers,
  normalizeEncounterMember,
  normalizeGroupMember,
  type ActorMemberDraft,
  type ActorResolutionResult,
  type EncounterMemberDraft,
  type GroupMemberDraft,
  type MemberNormalizationFailureReason,
} from "../core/actor-member-model";
import {
  buildVehicleRosterValues,
  normalizeVehicleRosterDraft,
  vehicleCapacityWarnings,
  vehicleCrewQuantities,
  type VehicleRosterArea,
  type VehicleRosterDraft,
  type VehicleRosterFailureReason,
} from "../core/vehicle-roster-model";
import { buildVehicleDamageModifiers, type VehicleDamageModifierDraft } from "../core/vehicle-damage-model";
import {
  buildVehicleComponentItemsChanges,
  stationCapacityExceeded,
  vehicleComponentCategory,
  vehicleComponentFields,
  type VehicleComponentCategory,
  type VehicleComponentDraft,
  type VehicleComponentType,
  type VehicleCrewAssignment,
} from "../core/vehicle-component-model";

// M11c (dadm/m11c-02-apply-output.md, Entscheidung 2): one change row's live inputs — either the curated
// picker (`target`/`parameter`/`value`/`proficiency`) or, when `target.value === "custom"`, the original raw
// `customKey`/`customValue`/`customMode` fallback. All rendered at once; `#renderEffectTargetRow` toggles
// which group is visible via `hidden`, so switching the target select never needs a full re-render.
interface EffectChangeRowInputs {
  target: HTMLSelectElement;
  parameter: HTMLSelectElement;
  value: HTMLInputElement;
  proficiency: HTMLSelectElement;
  customKey: HTMLInputElement;
  customValue: HTMLInputElement;
  customMode: HTMLSelectElement;
}

interface EffectChangeRowValues {
  target: string;
  parameter: string;
  value: string;
  proficiency: string;
  customKey: string;
  customValue: string;
  customMode: string;
}

interface VehicleDamageRowInputs {
  damageType: HTMLSelectElement;
  formula: HTMLInputElement;
}

interface VehicleDamageRowValues {
  damageType: string;
  formula: string;
}

// M11c: snapshots one effect-change row's live inputs into its persisted-values shape (`#captureValues`) — every
// sub-field is captured regardless of which are currently hidden, the same "safe to call even for an input not
// on screen" property every other persisted map in this file already has.
function captureEffectChangeRow(rowInputs: EffectChangeRowInputs): EffectChangeRowValues {
  return {
    target: rowInputs.target.value,
    parameter: rowInputs.parameter.value,
    value: rowInputs.value.value,
    proficiency: rowInputs.proficiency.value,
    customKey: rowInputs.customKey.value,
    customValue: rowInputs.customValue.value,
    customMode: rowInputs.customMode.value,
  };
}

// M14: one row of an Advancement table (`ItemChoice.choices`, `ScaleValue.scale`, `Trait.choices`) —
// unlike `captureEffectChangeRow` above, the columns differ per type, so this reads whatever columns the
// row actually has rather than a fixed named shape.
function captureAdvancementTableRow(rowInputs: ReadonlyMap<string, HTMLInputElement | HTMLSelectElement>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const [key, input] of rowInputs) out[key] = input instanceof HTMLInputElement && input.type === "checkbox" ? input.checked : input.value;
  return out;
}

// M14 live-check rework, Runde 2 (Fund 1/3): Trait's own target keys (`saves:str`, `skills:ath`, ...) are
// dnd5e-internal vocabulary with no curated picker anywhere in the project yet — M11c's own picker
// (`core/effect-targets.ts`) is for a different vocabulary (ActiveEffect change keys), not directly reusable.
// Six categories, each backed by an existing or new `choicesKind` — none need dnd5e's own async base-item
// lookup (M8a's Mechanism B): "armor"/"weapon" use the broad proficiency categories (light/medium/heavy/
// shield, simple/martial), the same level of detail a Trait advancement actually grants, not a single named
// item.
const TRAIT_CATEGORIES: readonly { readonly key: string; readonly labelKey: string; readonly choicesKind: ChoicesKind }[] = [
  { key: "saves", labelKey: "EAGLEHOMEBREW.window.advancement.trait.category.saves", choicesKind: "abilities" },
  { key: "skills", labelKey: "EAGLEHOMEBREW.window.advancement.trait.category.skills", choicesKind: "effectSkills" },
  { key: "languages", labelKey: "EAGLEHOMEBREW.window.advancement.trait.category.languages", choicesKind: "effectLanguages" },
  { key: "armor", labelKey: "EAGLEHOMEBREW.window.advancement.trait.category.armor", choicesKind: "armorProficiencyTypes" },
  { key: "weapon", labelKey: "EAGLEHOMEBREW.window.advancement.trait.category.weapon", choicesKind: "weaponProficiencyTypes" },
  { key: "tool", labelKey: "EAGLEHOMEBREW.window.advancement.trait.category.tool", choicesKind: "effectTools" },
];

// Adds a guided "pick a category, pick a value, insert" helper above a Trait target field (`grants`, or a
// `choices` row's `pool`) — the field stays the same plain comma-list text input it always was (still
// directly editable/removable by hand), this only writes a correctly formatted key into it. Pure DOM
// mutation, deliberately not `this.render()` (M14 live-check rework, Fund 2: a raw listener triggering a
// full re-render already broke ScaleValue's sub-form once).
function renderTraitTargetPicker(targetInput: HTMLInputElement): HTMLElement {
  const wrapper = element("div");
  wrapper.classList.add("eagle-homebrew-trait-picker");

  const categoryOptions = TRAIT_CATEGORIES.map((category) => ({ value: category.key, label: text(category.labelKey) }));
  const category = fields.createSelectInput({ name: "__traitCategory", value: TRAIT_CATEGORIES[0].key, options: categoryOptions });
  const value = fields.createSelectInput({ name: "__traitValue", value: "", options: [] });

  const refreshValues = (): void => {
    const current = TRAIT_CATEGORIES.find((entry) => entry.key === category.value) ?? TRAIT_CATEGORIES[0];
    const choices = choicesFor(current.choicesKind);
    value.replaceChildren();
    for (const [choiceValue, label] of Object.entries(choices)) {
      const option = element("option", label);
      option.value = choiceValue;
      value.append(option);
    }
  };
  refreshValues();
  category.addEventListener("change", refreshValues);

  const insert = element("button", text("EAGLEHOMEBREW.window.advancement.trait.insert"));
  insert.type = "button";
  insert.addEventListener("click", () => {
    if (!value.value) return;
    const key = `${category.value}:${value.value}`;
    const existing = readList(targetInput);
    if (!existing.includes(key)) targetInput.value = [...existing, key].join(", ");
  });

  wrapper.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.advancement.trait.categoryLabel"), input: category }));
  wrapper.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.advancement.trait.valueLabel"), input: value }));
  wrapper.append(insert);
  return wrapper;
}

// M11c: dnd5e's own 0/0.5/1/2 proficiency scale (Discover, `creature.mjs`'s `RollConfigField`) — a small, fixed
// set, the same "stable dnd5e fact, not a runtime catalog" treatment `ACTIVE_EFFECT_MODES` already gets.
const PROFICIENCY_LEVELS: readonly { readonly value: string; readonly labelKey: string }[] = [
  { value: "0", labelKey: "EAGLEHOMEBREW.window.effect.proficiency.none" },
  { value: "0.5", labelKey: "EAGLEHOMEBREW.window.effect.proficiency.half" },
  { value: "1", labelKey: "EAGLEHOMEBREW.window.effect.proficiency.proficient" },
  { value: "2", labelKey: "EAGLEHOMEBREW.window.effect.proficiency.expertise" },
];

// M11c: which live `CONFIG.DND5E` catalog (via `choicesFor`) resolves a target's own parameter dropdown.
// "ability" reuses the same `"abilities"` catalog `core/activity-model.ts`'s `ChoicesKind` already has;
// "damageType" reuses `"damageTypes"`; "skill"/"tool"/"condition"/"language" are new (added below).
function parameterChoicesKind(target: EffectTarget): ChoicesKind | undefined {
  switch (target.keyParameter ?? target.valueParameter) {
    case "ability":
      return "abilities";
    case "skill":
      return "effectSkills";
    case "tool":
      return "effectTools";
    case "damageType":
      return "damageTypes";
    case "condition":
      return "effectConditions";
    case "language":
      return "effectLanguages";
    default:
      return undefined;
  }
}

// M11c: `EAGLEHOMEBREW.window.effect.target.<id>` — a category-prefixed, human label per curated target
// (dadm/m11c-02-apply-output.md, Entscheidung 3), plus the "Custom (Advanced)" escape hatch.
const EFFECT_TARGET_LABEL_KEY: Record<string, string> = Object.fromEntries(
  EFFECT_TARGETS.map((target) => [target.id, `EAGLEHOMEBREW.window.effect.target.${target.id}`]),
);

function text(key: string, data?: Record<string, string>): string {
  const i18n = game.i18n!;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, content?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (content !== undefined) node.textContent = content;
  return node;
}

// The value currently in a field, whatever kind of input it is (M7 rework, live-check finding: values were lost on
// every re-render because nothing read them back before rebuilding). Foundry's multi-select widget
// (`fields.createMultiSelectInput`) is its own custom element, not a native `<select multiple>` — it fails
// `instanceof HTMLSelectElement` and its `.value` is already a `string[]`, not a comma string (M7 rework, live-check
// finding: the earlier `instanceof`/`.multiple` check missed it entirely and crashed reading `.value.split` on an
// array). Read by the actual shape of `.value` instead of guessing the element's class.
function currentValueOf(input: HTMLInputElement | HTMLSelectElement): string | boolean | string[] {
  if (input instanceof HTMLInputElement && input.type === "checkbox") return input.checked;
  const raw: unknown = input.value;
  if (Array.isArray(raw)) return raw as string[];
  return typeof raw === "string" ? raw : String(raw ?? "");
}

// A Set-shaped field's current values, whichever widget produced them: Foundry's multi-select (an array `.value`,
// see `currentValueOf` above) or the plain comma-text fallback (M7 Deploy) for a field with no runtime catalog.
function readList(input: HTMLInputElement | HTMLSelectElement | undefined): string[] {
  if (!input) return [];
  const raw: unknown = input.value;
  if (Array.isArray(raw)) return raw as string[];
  return String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

// A number field's current value, or undefined for "nothing entered" or anything that would fail Flight Control's
// JSON-serializability check (M7 rework, live-check finding: an empty/invalid number produced NaN, which
// isJsonValue rejects outright — request.payload must be JSON-serializable when given).
function readNumber(input: HTMLInputElement | undefined): number | undefined {
  if (!input) return undefined;
  const raw = input.value.trim();
  if (raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// The same finite-or-undefined parsing, for a value already pulled out of the persisted-values map (a re-render's
// initial value for a number input) rather than read live from an input element.
function persistedNumber(value: string | boolean | string[] | undefined): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Reads one field's current value out of whichever input map it lives in (M7's `#builderFieldInputs` for an
// Activity's own sub-form, M8's `#itemFieldInputs` for a kind's own fields, core/item-field-model.ts) — the widget
// name is all either caller needs, so this stays independent of which spec type (`ActivityField`/`ItemField`)
// produced the field (M8 Apply, Entscheidung 1: one shared reader instead of a second copy of the same rules).
function readFieldValue(
  field: { readonly path: string; readonly widget: string },
  inputs: ReadonlyMap<string, HTMLInputElement | HTMLSelectElement>,
): JsonValue | undefined {
  const input = inputs.get(field.path);
  if (!input) return undefined;
  if (field.widget === "checkbox") return (input as HTMLInputElement).checked;
  if (field.widget === "number") return readNumber(input as HTMLInputElement);
  if (field.widget === "set" || field.widget === "documentPickerMulti") {
    const list = readList(input);
    return list.length > 0 ? list : undefined;
  }
  if (field.widget === "documentPicker") return input.value === "" ? undefined : input.value;
  if (field.widget === "list") {
    const raw = input.value.trim();
    if (raw === "") return undefined;
    try {
      return JSON.parse(raw) as JsonValue;
    } catch {
      // Invalid JSON in an advanced, rarely-used list field: left out rather than sending something malformed
      // (M7 Deploy, pragmatic choice — no validation message for this first pass).
      return undefined;
    }
  }
  return input.value === "" ? undefined : input.value;
}

// The rendering half of the same shared rule (M8 Apply, Entscheidung 1): turns one field's `{path, widget,
// choicesKind}` into a Foundry input element, a real multi-/single-select when `choicesFor` has a runtime catalog
// for it, a plain text fallback otherwise — written once here for both `#renderActivityWidget` (Activities, M7) and
// `#renderItemFieldWidget` (a kind's own fields, M8).

// dnd5e's roll-formula syntax (dice notation plus @-references like `@abilities.int.mod`) is not something a new
// Homebrewer already knows (M8 rework, live-check findings 2 and 3: an empty "Formula"/"Custom Formula" field with
// no example felt like exactly the Foundry-internals complexity N20/N21 were meant to hide). One generic example
// on every formula-shaped field, not a different one per field — a formula's syntax is the same wherever it
// appears, so a single shared placeholder covers all of them for the same reason "a, b, c"/"fire, cold" already do
// for the set-widget fallback above.
const FORMULA_PLACEHOLDER = "e.g. 1d6 + 2, or 8 + @abilities.int.mod";

// A few plain-text fields whose expected content is not obvious from the label alone (same live-check findings) —
// kept short and specific on purpose, unlike the one shared formula placeholder above, because these fields are not
// interchangeable (a container is a document reference, a chat flavor is prose).
const TEXT_PLACEHOLDER_KEY: Record<string, string> = {
  container: "e.g. Item.AbC123dEf456GhI7",
  chatFlavor: "e.g. You feel a surge of power as you use this.",
  "description.value": "e.g. A well-worn leather satchel with brass buckles.",
  "activation.condition": "e.g. Only against undead",
  // M14 live-check, Fund 1: Trait's own target keys are dnd5e-internal vocabulary. A concrete example is
  // the least this module can do without building a full curated picker (the way M11c did for effect targets).
  grants: "e.g. saves:str, skills:ath, tools:thief",
};

// M14 (Apply Entscheidung 7): wraps Foundry's own `<document-tags>` custom element for use in the same
// input maps every other widget already shares. Cast to `HTMLInputElement` purely for storage — the same
// pragmatic mismatch the multi-select widget already has (M7 rework note on `currentValueOf`: read by the
// actual shape of `.value`, never by `instanceof`), never actually treated as a real `<input>`.
function createDocumentPickerInput(config: {
  readonly name: string;
  readonly single: boolean;
  readonly value: string | readonly string[] | undefined;
  readonly documentType?: "Actor" | "Item";
}): HTMLInputElement {
  const picker = elements.HTMLDocumentTagsElement.create({ name: config.name, type: config.documentType ?? "Item", single: config.single, value: config.value as never });
  return picker as unknown as HTMLInputElement;
}

function renderFieldWidget(
  field: { readonly path: string; readonly widget: string; readonly choicesKind?: ChoicesKind; readonly restrictChoicesTo?: ReadonlySet<string> },
  persisted: string | boolean | string[] | undefined,
  inputs: Map<string, HTMLInputElement | HTMLSelectElement>,
): HTMLElement {
  switch (field.widget) {
    case "checkbox": {
      const checkbox = fields.createCheckboxInput({ name: field.path, value: persisted === true });
      inputs.set(field.path, checkbox);
      return checkbox;
    }
    case "number": {
      const numberInput = fields.createNumberInput({ name: field.path, value: persistedNumber(persisted) });
      inputs.set(field.path, numberInput);
      return numberInput;
    }
    case "select":
    // M8a: `type.baseItem`'s widget is "baseItemSelect" — this synchronous branch gives it the exact same initial
    // rendering as a plain "select" (the M8 key-label fallback), which `#renderBaseItemSelect` then asynchronously
    // refreshes with real, type-filtered names (v13/homebrew-application.ts).
    case "baseItemSelect": {
      const choices = field.choicesKind ? choicesFor(field.choicesKind) : undefined;
      const fallback = field.path === "activation.type" ? "action" : "";
      const initial = typeof persisted === "string" ? persisted : fallback;
      if (choices && Object.keys(choices).length > 0) {
        const options = Object.entries(choices).map(([value, label]) => ({ value, label }));
        const select = fields.createSelectInput({ name: field.path, value: initial, options, blank: field.path === "activation.type" ? undefined : "" });
        inputs.set(field.path, select);
        return select;
      }
      // No runtime catalog wired for this field yet (an advanced field, e.g. duration.units) — a plain text
      // input still satisfies N21 (editable), just without a dropdown (M7 Deploy, pragmatic simplification).
      const textInput = fields.createTextInput({ name: field.path, value: initial });
      inputs.set(field.path, textInput);
      return textInput;
    }
    // M9, generalized M11: `type.subtype` (Consumable, Feat) — always a real `<select>`, starting empty;
    // `#renderDependentSubtypeSelect` fills it synchronously right after, based on the currently selected
    // `type.value` (dadm/m9-02-apply-output.md, Entscheidung 5; dadm/m11-02-apply-output.md, Entscheidung 2).
    // `field.choicesKind` here names which `CONFIG.DND5E` catalog to resolve *subtypes* from
    // (`dependentSubtypeOptionsFor`), not a static option list `choicesFor` could return directly — the
    // option set itself, not just the field's visibility, depends on another field's value.
    case "dependentSubtypeSelect": {
      const select = fields.createSelectInput({ name: field.path, value: typeof persisted === "string" ? persisted : "", options: [], blank: "" });
      inputs.set(field.path, select);
      return select;
    }
    case "set": {
      // M11 live-check rework, Fund 1: `restrictChoicesTo` narrows a shared catalog (e.g. `itemProperties`,
      // ~30 entries meant for every physical kind combined) to the keys valid for THIS kind
      // (`CONFIG.DND5E.validProperties[subtype]`, core/item-field-model.ts) — a Feature no longer offers
      // weapon-only properties like "Ammunition"/"Heavy"/"Reload".
      const rawChoices = field.choicesKind ? choicesFor(field.choicesKind) : undefined;
      const choices = rawChoices && field.restrictChoicesTo
        ? Object.fromEntries(Object.entries(rawChoices).filter(([key]) => field.restrictChoicesTo!.has(key)))
        : rawChoices;
      const persistedList = Array.isArray(persisted) ? persisted : [];
      // A real multi-select when a runtime catalog exists (M7 rework, live-check feedback: no Foundry/dnd5e
      // path should ever need to be typed by hand when a fixed choice list already exists) — otherwise the
      // same free-text fallback as an uncataloged "select" field.
      if (choices && Object.keys(choices).length > 0) {
        const options = Object.entries(choices).map(([value, label]) => ({ value, label }));
        const multi = fields.createMultiSelectInput({ name: field.path, value: persistedList, options });
        inputs.set(field.path, multi);
        return multi;
      }
      // M14 live-check, Fund 1: the generic "a, b, c" told a Homebrewer nothing about what a Trait target
      // key actually looks like — `TEXT_PLACEHOLDER_KEY` (already used by the plain-text fallback below)
      // gives a real, field-specific example where one exists; only fields with no better example still
      // fall back to "a, b, c".
      const setInput = fields.createTextInput({ name: field.path, value: persistedList.join(", "), placeholder: TEXT_PLACEHOLDER_KEY[field.path] ?? "a, b, c" });
      inputs.set(field.path, setInput);
      return setInput;
    }
    // M14 (Apply Entscheidung 7): one or several Item references, dragged from a sidebar/compendium or
    // pasted as a UUID, with a live name/image preview — Foundry's own native widget, no bespoke picker
    // built here. Stored in the same input map as every other field (a structural, not nominal, fit: its
    // `.value` is already a plain string or string array, exactly what `currentValueOf`/`readList` below
    // already expect from any other widget).
    case "documentPicker": {
      const picker = createDocumentPickerInput({ name: field.path, single: true, value: typeof persisted === "string" ? persisted : undefined });
      inputs.set(field.path, picker);
      return picker;
    }
    case "documentPickerMulti": {
      const picker = createDocumentPickerInput({ name: field.path, single: false, value: Array.isArray(persisted) ? persisted : [] });
      inputs.set(field.path, picker);
      return picker;
    }
    case "list": {
      const listInput = fields.createTextInput({ name: field.path, value: typeof persisted === "string" ? persisted : "", placeholder: "[]" });
      inputs.set(field.path, listInput);
      return listInput;
    }
    case "text":
    case "formula":
    default: {
      const placeholder = field.widget === "formula" ? FORMULA_PLACEHOLDER : TEXT_PLACEHOLDER_KEY[field.path];
      const textInput = fields.createTextInput({ name: field.path, value: typeof persisted === "string" ? persisted : "", placeholder });
      inputs.set(field.path, textInput);
      return textInput;
    }
  }
}

const { ApplicationV2 } = foundry.applications.api;
const fields = foundry.applications.fields;
// M14 (Apply Entscheidung 7): Foundry's own native document-reference widget — the same custom element
// `DocumentUUIDField`'s built-in `toInput()` uses internally (confirmed against the type declarations,
// no factory function for it in `foundry.applications.fields` itself, unlike every other widget here).
const elements = foundry.applications.elements;

// The three Art buttons of step 1 — a fixed, small enum (like the Hub's RIGHTS_LEVELS), so each gets its own lang key.
// Catalog titles (18 kinds, step 2) do not: they are plain data, the same way EagleLibrary/core/catalog.ts titles are
// never localized individually (M4 Deploy note; not an Apply decision, this repo's own established split). Activity
// field labels (M7) follow the same split: window chrome (buttons, section headers) is localized, field labels
// derived from a dnd5e path are plain, auto-formatted text (see `pathLabel`).
const ART_LABEL_KEY: Record<Art, string> = {
  Actor: "EAGLEHOMEBREW.window.art.actor",
  Item: "EAGLEHOMEBREW.window.art.item",
  RollTable: "EAGLEHOMEBREW.window.art.rolltable",
};
const ARTS: readonly Art[] = ["Actor", "Item", "RollTable"];

// The kinds with a real creation form (M7 Discover, Befund 1: "loot" from M4, minimal; "tools"/"weapons" from M8,
// "equipment"/"consumables" from M9, "containers" from M10, "feats"/"backgrounds" from M11, "spells"/"species"
// from M12, full field coverage, N21). Every other kind still shows the "not built yet" placeholder; the
// remaining M13-M18 editors add to this set one milestone at a time.
const SIMPLE_KINDS = new Set([
  "loot",
  "tools",
  "weapons",
  "equipment",
  "consumables",
  "containers",
  "feats",
  "backgrounds",
  "spells",
  "species",
  "rolltables",
  "classes",
  "subclasses",
  "facilities",
  "npcs",
  "encounters",
  "groups",
  "vehicles",
]);

// A catalog key's own item kind, for the fields M8-M12 built (core/item-field-model.ts) — undefined for every
// other kind (Loot has no full-field form yet; the rest await M13-M18).
function itemKindFor(entryKey: string): ItemKind | undefined {
  if (entryKey === "tools") return "tool";
  if (entryKey === "weapons") return "weapon";
  if (entryKey === "equipment") return "equipment";
  if (entryKey === "consumables") return "consumable";
  if (entryKey === "containers") return "container";
  if (entryKey === "feats") return "feat";
  if (entryKey === "backgrounds") return "background";
  if (entryKey === "spells") return "spell";
  if (entryKey === "species") return "species";
  if (entryKey === "classes") return "class";
  if (entryKey === "subclasses") return "subclass";
  if (entryKey === "facilities") return "facility";
  if (entryKey === "npcs") return "npc";
  if (entryKey === "encounters") return "encounter";
  if (entryKey === "groups") return "group";
  if (entryKey === "vehicles") return "vehicle";
  return undefined;
}

const ACTIVITY_TYPES_ORDER: readonly ActivityType[] = ["attack", "damage", "save", "check", "heal"];
const ACTIVITY_TYPE_LABEL_KEY: Record<ActivityType, string> = {
  attack: "EAGLEHOMEBREW.window.activity.type.attack",
  damage: "EAGLEHOMEBREW.window.activity.type.damage",
  save: "EAGLEHOMEBREW.window.activity.type.save",
  check: "EAGLEHOMEBREW.window.activity.type.check",
  heal: "EAGLEHOMEBREW.window.activity.type.heal",
};

// M16a: labels for the "Erscheint als: ..." live preview (Apply Entscheidung 4) — one per `NpcActionCategory`.
const NPC_ACTION_CATEGORY_LABEL_KEY: Record<NpcActionCategory, string> = {
  trait: "EAGLEHOMEBREW.window.action.category.trait",
  action: "EAGLEHOMEBREW.window.action.category.action",
  bonus: "EAGLEHOMEBREW.window.action.category.bonus",
  reaction: "EAGLEHOMEBREW.window.action.category.reaction",
  legendary: "EAGLEHOMEBREW.window.action.category.legendary",
  mythic: "EAGLEHOMEBREW.window.action.category.mythic",
  unlisted: "EAGLEHOMEBREW.window.action.category.unlisted",
};

const VEHICLE_COMPONENT_CATEGORY_LABEL_KEY: Record<VehicleComponentCategory, string> = {
  feature: "EAGLEHOMEBREW.window.vehicle.component.category.feature",
  bonus: "EAGLEHOMEBREW.window.vehicle.component.category.bonus",
  reaction: "EAGLEHOMEBREW.window.vehicle.component.category.reaction",
  actionStation: "EAGLEHOMEBREW.window.vehicle.component.category.actionStation",
};

const VEHICLE_COMPONENT_TYPE_LABEL_KEY: Record<VehicleComponentType, string> = {
  feature: "EAGLEHOMEBREW.window.vehicle.component.type.feature",
  equipmentStation: "EAGLEHOMEBREW.window.vehicle.component.type.equipmentStation",
  weaponStation: "EAGLEHOMEBREW.window.vehicle.component.type.weaponStation",
};

// Whether a draft's own item fields have the "trait" property set — the same check `npcActionCategory`
// needs, read back from the already-built `itemFieldValues` (confirmed drafts) rather than a live input.
function npcActionDraftHasTraitProperty(itemFieldValues: Readonly<Record<string, JsonValue>>): boolean {
  const properties = itemFieldValues.properties;
  return Array.isArray(properties) && properties.includes("trait");
}

// A few paths whose last segment alone reads badly ("Value", "Classification" with no context) — M7 rework,
// live-check finding: the anleitung said "Type", the auto-label said "Value" for the same field. Everything else
// still goes through the plain auto-label (`pathLabel`); this list stays short on purpose.
const FIELD_LABEL_KEY: Record<string, string> = {
  "attack.type.value": "EAGLEHOMEBREW.window.activity.field.attackRange",
  "attack.type.classification": "EAGLEHOMEBREW.window.activity.field.attackClassification",
  "activation.condition": "EAGLEHOMEBREW.window.activity.field.activationCondition",
};

// The same idea as FIELD_LABEL_KEY, for a kind's own fields (M8): keyed by "<kind>:<path>" because Tool's and
// Weapon's own `type.value`/`type.baseItem` need a different, kind-specific label ("Tool Type" vs "Weapon Type"),
// not the shared plain auto-label a bare path would get.
const ITEM_FIELD_LABEL_KEY: Record<string, string> = {
  "tool:type.value": "EAGLEHOMEBREW.window.item.field.toolType",
  "tool:type.baseItem": "EAGLEHOMEBREW.window.item.field.toolBaseItem",
  "weapon:type.value": "EAGLEHOMEBREW.window.item.field.weaponType",
  "weapon:type.baseItem": "EAGLEHOMEBREW.window.item.field.weaponBaseItem",
  "weapon:range.value": "EAGLEHOMEBREW.window.item.field.rangeNormal",
  "weapon:range.long": "EAGLEHOMEBREW.window.item.field.rangeLong",
  "weapon:range.reach": "EAGLEHOMEBREW.window.item.field.rangeReach",
  "weapon:damage.base": "EAGLEHOMEBREW.window.item.field.damageBase",
  "weapon:damage.versatile": "EAGLEHOMEBREW.window.item.field.damageVersatile",
  "weapon:armor.value": "EAGLEHOMEBREW.window.item.field.armorValue",
  // M9
  "equipment:type.value": "EAGLEHOMEBREW.window.item.field.equipmentType",
  "equipment:type.baseItem": "EAGLEHOMEBREW.window.item.field.equipmentBaseItem",
  "equipment:armor.value": "EAGLEHOMEBREW.window.item.field.armorValue",
  "consumable:type.value": "EAGLEHOMEBREW.window.item.field.consumableType",
  "consumable:type.subtype": "EAGLEHOMEBREW.window.item.field.consumableSubtype",
  "consumable:damage.base": "EAGLEHOMEBREW.window.item.field.damageBase",
  "consumable:damage.replace": "EAGLEHOMEBREW.window.item.field.damageReplace",
  // M10 — Container's own weight.value/units (PhysicalItemTemplate, its own physical weight) would
  // otherwise be indistinguishable from capacity.weight.value/units (how much it can hold); the
  // currency.* keys avoid the "Pp"/"Gp" auto-labels pathLabel would otherwise produce.
  "container:capacity.count": "EAGLEHOMEBREW.window.item.field.capacityCount",
  "container:capacity.volume.value": "EAGLEHOMEBREW.window.item.field.capacityVolume",
  "container:capacity.volume.units": "EAGLEHOMEBREW.window.item.field.capacityVolumeUnits",
  "container:capacity.weight.value": "EAGLEHOMEBREW.window.item.field.capacityWeight",
  "container:capacity.weight.units": "EAGLEHOMEBREW.window.item.field.capacityWeightUnits",
  "container:currency.pp": "EAGLEHOMEBREW.window.item.field.currencyPp",
  "container:currency.gp": "EAGLEHOMEBREW.window.item.field.currencyGp",
  "container:currency.ep": "EAGLEHOMEBREW.window.item.field.currencyEp",
  "container:currency.sp": "EAGLEHOMEBREW.window.item.field.currencySp",
  "container:currency.cp": "EAGLEHOMEBREW.window.item.field.currencyCp",
  // M11
  "feat:type.value": "EAGLEHOMEBREW.window.item.field.featureType",
  "feat:type.subtype": "EAGLEHOMEBREW.window.item.field.featureSubtype",
  "feat:enchant.max": "EAGLEHOMEBREW.window.item.field.enchantMax",
  "feat:enchant.period": "EAGLEHOMEBREW.window.item.field.enchantPeriod",
  // M12 — Spell reuses the exact activation/duration/range/target paths core/activity-model.ts already
  // has, several of which auto-label to the same bare word ("Value"/"Type"/"Count"/"Special") more than
  // once within this one form (unlike inside an Activity's own "advanced" sub-section, where the same
  // ambiguity has existed unnoticed since M5-M7, dadm/m12-01-discover-output.md Befund 2) — explicit
  // labels here, the same class of fix as M8 rework's weight.value/price.value/description.value.
  "spell:activation.type": "EAGLEHOMEBREW.window.item.field.activationType",
  "spell:activation.value": "EAGLEHOMEBREW.window.item.field.activationValue",
  "spell:activation.condition": "EAGLEHOMEBREW.window.item.field.activationCondition",
  "spell:duration.value": "EAGLEHOMEBREW.window.item.field.durationValue",
  "spell:duration.units": "EAGLEHOMEBREW.window.item.field.durationUnits",
  "spell:duration.special": "EAGLEHOMEBREW.window.item.field.durationSpecial",
  "spell:range.value": "EAGLEHOMEBREW.window.item.field.rangeValue",
  "spell:range.units": "EAGLEHOMEBREW.window.item.field.rangeUnitsLabel",
  "spell:range.special": "EAGLEHOMEBREW.window.item.field.rangeSpecial",
  "spell:target.template.count": "EAGLEHOMEBREW.window.item.field.targetAreaCount",
  "spell:target.template.type": "EAGLEHOMEBREW.window.item.field.targetAreaType",
  "spell:target.template.size": "EAGLEHOMEBREW.window.item.field.targetAreaSize",
  "spell:target.template.width": "EAGLEHOMEBREW.window.item.field.targetAreaWidth",
  "spell:target.affects.count": "EAGLEHOMEBREW.window.item.field.targetCount",
  "spell:target.affects.type": "EAGLEHOMEBREW.window.item.field.targetType",
  "spell:materials.value": "EAGLEHOMEBREW.window.item.field.materialsDescription",
  "spell:method": "EAGLEHOMEBREW.window.item.field.spellcastingMethod",
  // M12 — Species
  "species:type.value": "EAGLEHOMEBREW.window.item.field.creatureType",
  "species:type.subtype": "EAGLEHOMEBREW.window.item.field.creatureSubtype",
  "species:type.custom": "EAGLEHOMEBREW.window.item.field.creatureCustom",
  "species:movement.units": "EAGLEHOMEBREW.window.item.field.movementUnitsLabel",
  "species:senses.units": "EAGLEHOMEBREW.window.item.field.sensesUnits",
  // M14 — Class (`primaryAbility.value`/`.all` would otherwise both auto-label to "Value"/"All", unclear
  // without the "Primary Ability" context; `hd.*` reads badly split at "." alone — "Denomination"/"Additional").
  "class:hd.denomination": "EAGLEHOMEBREW.window.item.field.hitDie",
  "class:hd.additional": "EAGLEHOMEBREW.window.item.field.hitDieAdditional",
  "class:primaryAbility.value": "EAGLEHOMEBREW.window.item.field.primaryAbility",
  "class:primaryAbility.all": "EAGLEHOMEBREW.window.item.field.primaryAbilityAll",
  // M15 — Facility (`type.value`/`.max` fields would otherwise auto-label to "Value"/"Max", the same
  // three-way "Max" collision class M12 already avoided for Spell/Species).
  "facility:type.value": "EAGLEHOMEBREW.window.item.field.facilityType",
  "facility:type.subtype": "EAGLEHOMEBREW.window.item.field.facilitySubtype",
  "facility:defenders.max": "EAGLEHOMEBREW.window.item.field.defenderCapacity",
  "facility:hirelings.max": "EAGLEHOMEBREW.window.item.field.hirelingCapacity",
  "facility:trade.creatures.max": "EAGLEHOMEBREW.window.item.field.tradeCreatureCapacity",
  // M16 — NPC. Every ability/skill "value" and every "Max"-named field would otherwise collide on the
  // same auto-label as everything else in this list (the established "Value"/"Max" collision class,
  // M8/M12/M14/M15) — each gets its own explicit label naming which ability/skill/resource it is.
  "npc:abilities.str.value": "EAGLEHOMEBREW.window.item.field.ability.str",
  "npc:abilities.dex.value": "EAGLEHOMEBREW.window.item.field.ability.dex",
  "npc:abilities.con.value": "EAGLEHOMEBREW.window.item.field.ability.con",
  "npc:abilities.int.value": "EAGLEHOMEBREW.window.item.field.ability.int",
  "npc:abilities.wis.value": "EAGLEHOMEBREW.window.item.field.ability.wis",
  "npc:abilities.cha.value": "EAGLEHOMEBREW.window.item.field.ability.cha",
  "npc:abilities.str.proficient": "EAGLEHOMEBREW.window.item.field.abilitySave.str",
  "npc:abilities.dex.proficient": "EAGLEHOMEBREW.window.item.field.abilitySave.dex",
  "npc:abilities.con.proficient": "EAGLEHOMEBREW.window.item.field.abilitySave.con",
  "npc:abilities.int.proficient": "EAGLEHOMEBREW.window.item.field.abilitySave.int",
  "npc:abilities.wis.proficient": "EAGLEHOMEBREW.window.item.field.abilitySave.wis",
  "npc:abilities.cha.proficient": "EAGLEHOMEBREW.window.item.field.abilitySave.cha",
  "npc:skills.acr.value": "EAGLEHOMEBREW.window.item.field.skill.acr",
  "npc:skills.ani.value": "EAGLEHOMEBREW.window.item.field.skill.ani",
  "npc:skills.arc.value": "EAGLEHOMEBREW.window.item.field.skill.arc",
  "npc:skills.ath.value": "EAGLEHOMEBREW.window.item.field.skill.ath",
  "npc:skills.dec.value": "EAGLEHOMEBREW.window.item.field.skill.dec",
  "npc:skills.his.value": "EAGLEHOMEBREW.window.item.field.skill.his",
  "npc:skills.ins.value": "EAGLEHOMEBREW.window.item.field.skill.ins",
  "npc:skills.itm.value": "EAGLEHOMEBREW.window.item.field.skill.itm",
  "npc:skills.inv.value": "EAGLEHOMEBREW.window.item.field.skill.inv",
  "npc:skills.med.value": "EAGLEHOMEBREW.window.item.field.skill.med",
  "npc:skills.nat.value": "EAGLEHOMEBREW.window.item.field.skill.nat",
  "npc:skills.prc.value": "EAGLEHOMEBREW.window.item.field.skill.prc",
  "npc:skills.prf.value": "EAGLEHOMEBREW.window.item.field.skill.prf",
  "npc:skills.per.value": "EAGLEHOMEBREW.window.item.field.skill.per",
  "npc:skills.rel.value": "EAGLEHOMEBREW.window.item.field.skill.rel",
  "npc:skills.slt.value": "EAGLEHOMEBREW.window.item.field.skill.slt",
  "npc:skills.ste.value": "EAGLEHOMEBREW.window.item.field.skill.ste",
  "npc:skills.sur.value": "EAGLEHOMEBREW.window.item.field.skill.sur",
  "npc:details.type.value": "EAGLEHOMEBREW.window.item.field.creatureType",
  "npc:details.type.subtype": "EAGLEHOMEBREW.window.item.field.creatureSubtype",
  "npc:details.type.custom": "EAGLEHOMEBREW.window.item.field.creatureCustom",
  "npc:details.biography.value": "EAGLEHOMEBREW.window.item.field.biography",
  "npc:details.biography.public": "EAGLEHOMEBREW.window.item.field.biographyPublic",
  "npc:details.cr": "EAGLEHOMEBREW.window.item.field.challengeRating",
  "npc:attributes.ac.calc": "EAGLEHOMEBREW.window.item.field.acCalc",
  "npc:attributes.ac.flat": "EAGLEHOMEBREW.window.item.field.acFlat",
  "npc:attributes.ac.formula": "EAGLEHOMEBREW.window.item.field.acFormula",
  "npc:attributes.hp.formula": "EAGLEHOMEBREW.window.item.field.hpFormula",
  "npc:attributes.init.bonus": "EAGLEHOMEBREW.window.item.field.initiativeBonus",
  "npc:attributes.movement.units": "EAGLEHOMEBREW.window.item.field.movementUnitsLabel",
  "npc:attributes.senses.units": "EAGLEHOMEBREW.window.item.field.sensesUnits",
  "npc:attributes.attunement.max": "EAGLEHOMEBREW.window.item.field.attunementCapacity",
  "npc:traits.di.value": "EAGLEHOMEBREW.window.item.field.damageImmunities",
  "npc:traits.di.custom": "EAGLEHOMEBREW.window.item.field.damageImmunitiesCustom",
  "npc:traits.dr.value": "EAGLEHOMEBREW.window.item.field.damageResistances",
  "npc:traits.dr.custom": "EAGLEHOMEBREW.window.item.field.damageResistancesCustom",
  "npc:traits.dv.value": "EAGLEHOMEBREW.window.item.field.damageVulnerabilities",
  "npc:traits.dv.custom": "EAGLEHOMEBREW.window.item.field.damageVulnerabilitiesCustom",
  "npc:traits.ci.value": "EAGLEHOMEBREW.window.item.field.conditionImmunitiesLabel",
  "npc:traits.ci.custom": "EAGLEHOMEBREW.window.item.field.conditionImmunitiesCustom",
  "npc:traits.languages.value": "EAGLEHOMEBREW.window.item.field.languagesLabel",
  "npc:traits.languages.custom": "EAGLEHOMEBREW.window.item.field.languagesCustom",
  "npc:resources.legact.max": "EAGLEHOMEBREW.window.item.field.legendaryActionsMax",
  "npc:resources.legres.max": "EAGLEHOMEBREW.window.item.field.legendaryResistancesMax",
  "npc:resources.lair.value": "EAGLEHOMEBREW.window.item.field.hasLairActions",
  "npc:resources.lair.initiative": "EAGLEHOMEBREW.window.item.field.lairActionInitiative",
  "npc:resources.lair.inside": "EAGLEHOMEBREW.window.item.field.lairActionInsideOnly",
  // M17 — Group travel fields otherwise collapse to repeated bare labels such as "Land" and
  // "Value"; name the stored concept in full. Encounter has only the shared fields below.
  "group:details.xp.value": "EAGLEHOMEBREW.window.item.field.groupXp",
  "group:attributes.travel.pace": "EAGLEHOMEBREW.window.item.field.travelPace",
  "group:attributes.travel.paces.land": "EAGLEHOMEBREW.window.item.field.travelPaceLand",
  "group:attributes.travel.paces.water": "EAGLEHOMEBREW.window.item.field.travelPaceWater",
  "group:attributes.travel.paces.air": "EAGLEHOMEBREW.window.item.field.travelPaceAir",
  "group:attributes.travel.speeds.land": "EAGLEHOMEBREW.window.item.field.travelSpeedLand",
  "group:attributes.travel.speeds.water": "EAGLEHOMEBREW.window.item.field.travelSpeedWater",
  "group:attributes.travel.speeds.air": "EAGLEHOMEBREW.window.item.field.travelSpeedAir",
  "group:attributes.travel.time": "EAGLEHOMEBREW.window.item.field.travelTime",
  "group:attributes.travel.units": "EAGLEHOMEBREW.window.item.field.travelUnits",
};

// Physical/Description fields Tool and Weapon share (core/item-field-model.ts's PHYSICAL_FIELDS/
// DESCRIPTION_FIELDS): the same label regardless of kind, so keyed by bare path, not "<kind>:<path>" — checked
// after ITEM_FIELD_LABEL_KEY (M8 rework, live-check finding: `weight.value`, `price.value` and `description.value`
// all auto-labelled to the same bare "Value" with nothing to tell them apart; `price.denomination` alone read as
// unclear jargon).
const ITEM_FIELD_SHARED_LABEL_KEY: Record<string, string> = {
  "weight.value": "EAGLEHOMEBREW.window.item.field.weight",
  "weight.units": "EAGLEHOMEBREW.window.item.field.weightUnits",
  "price.value": "EAGLEHOMEBREW.window.item.field.price",
  "price.denomination": "EAGLEHOMEBREW.window.item.field.currency",
  "description.value": "EAGLEHOMEBREW.window.item.field.description",
  // M11 retrofit (dadm/m11-02-apply-output.md, Entscheidung 1) — shared across every kind via
  // DESCRIPTION_FIELDS, not just Feat/Background. The six `source.*` fields and `identifier`, tried
  // alongside this one, were both dropped again in the M11 live-check rework — see the note at
  // DESCRIPTION_FIELDS.
  "description.chat": "EAGLEHOMEBREW.window.item.field.descriptionChat",
  "description.summary": "EAGLEHOMEBREW.window.item.field.descriptionSummary",
  "description.full": "EAGLEHOMEBREW.window.item.field.descriptionFull",
  "currency.pp": "EAGLEHOMEBREW.window.item.field.currencyPp",
  "currency.gp": "EAGLEHOMEBREW.window.item.field.currencyGp",
  "currency.ep": "EAGLEHOMEBREW.window.item.field.currencyEp",
  "currency.sp": "EAGLEHOMEBREW.window.item.field.currencySp",
  "currency.cp": "EAGLEHOMEBREW.window.item.field.currencyCp",
  // M14 — Class and Subclass share the exact same SpellcastingField (core/item-field-model.ts), so these
  // three go in the shared map rather than being duplicated under both "class:" and "subclass:" keys.
  "spellcasting.progression": "EAGLEHOMEBREW.window.item.field.spellcastingProgression",
  "spellcasting.ability": "EAGLEHOMEBREW.window.item.field.spellcastingAbility",
  "spellcasting.preparation.formula": "EAGLEHOMEBREW.window.item.field.spellcastingPreparationFormula",
};

const VEHICLE_FIELD_LABEL: Readonly<Record<string, string>> = {
  "details.type": "Vehicle Type",
  "traits.size": "Size",
  "attributes.price.value": "Price",
  "attributes.price.denomination": "Currency",
  "attributes.quality.value": "Quality",
  "attributes.ac.calc": "Armor Class Calculation",
  "attributes.ac.flat": "Armor Class (Flat Value)",
  "attributes.ac.formula": "Armor Class Formula",
  "attributes.hp.max": "Hit Points Maximum",
  "attributes.hp.dt": "Damage Threshold",
  "attributes.hp.mt": "Mishap Threshold",
  "attributes.init.ability": "Initiative Ability",
  "attributes.init.bonus": "Initiative Bonus",
  "attributes.init.roll.min": "Initiative Minimum Roll",
  "attributes.init.roll.max": "Initiative Maximum Roll",
  "attributes.init.roll.mode": "Initiative Roll Mode",
  "attributes.actions.stations": "Use Individual Action Stations",
  "attributes.actions.max": "Actions Maximum",
  "attributes.actions.thresholds.0": "Minimum Crew Threshold",
  "attributes.actions.thresholds.1": "Reduced Crew Threshold",
  "attributes.actions.thresholds.2": "Full Crew Threshold",
  "attributes.movement.bonus": "Movement Bonus",
  "attributes.movement.special": "Special Movement",
  "attributes.movement.units": "Movement Units",
  "attributes.movement.hover": "Can Hover",
  "attributes.movement.ignoredDifficultTerrain": "Ignored Difficult Terrain",
  "attributes.travel.paces.land": "Land Pace Formula",
  "attributes.travel.paces.water": "Water Pace Formula",
  "attributes.travel.paces.air": "Air / Space Pace Formula",
  "attributes.travel.speeds.land": "Land Speed Formula",
  "attributes.travel.speeds.water": "Water Speed Formula",
  "attributes.travel.speeds.air": "Air / Space Speed Formula",
  "attributes.travel.time": "Travel Time per Day",
  "attributes.travel.units": "Travel Units",
  "attributes.capacity.cargo.value": "Cargo Capacity",
  "attributes.capacity.cargo.units": "Cargo Capacity Units",
  "crew.max": "Crew Capacity",
  "passengers.max": "Passenger Capacity",
  "traits.weight.value": "Vehicle Weight",
  "traits.weight.units": "Vehicle Weight Units",
  "traits.keel.value": "Keel Length",
  "traits.keel.units": "Keel Units",
  "traits.beam.value": "Beam Width",
  "traits.beam.units": "Beam Units",
  "traits.di.value": "Damage Immunities",
  "traits.di.custom": "Damage Immunities (Other)",
  "traits.di.bypasses": "Immunity Bypasses",
  "traits.dr.value": "Damage Resistances",
  "traits.dr.custom": "Damage Resistances (Other)",
  "traits.dr.bypasses": "Resistance Bypasses",
  "traits.dv.value": "Damage Vulnerabilities",
  "traits.dv.custom": "Damage Vulnerabilities (Other)",
  "traits.dv.bypasses": "Vulnerability Bypasses",
  "traits.dm.bypasses": "Damage Modifier Bypasses",
  "traits.ci.value": "Condition Immunities",
  "traits.ci.custom": "Condition Immunities (Other)",
  "details.biography.value": "Biography",
  "details.biography.public": "Public Biography",
};

function vehicleFieldLabel(path: string): string | undefined {
  const direct = VEHICLE_FIELD_LABEL[path];
  if (direct) return direct;
  const match = /^abilities\.(str|dex|con|int|wis|cha)\.(.+)$/.exec(path);
  if (!match) return undefined;
  const ability = text(`EAGLEHOMEBREW.window.item.field.ability.${match[1]}`);
  const suffix: Readonly<Record<string, string>> = {
    value: "Score",
    proficient: "Save Proficiency",
    max: "Maximum Score",
    "bonuses.check": "Check Bonus",
    "bonuses.save": "Save Bonus",
    "check.roll.min": "Check Minimum Roll",
    "check.roll.max": "Check Maximum Roll",
    "check.roll.mode": "Check Roll Mode",
    "save.roll.min": "Save Minimum Roll",
    "save.roll.max": "Save Maximum Roll",
    "save.roll.mode": "Save Roll Mode",
  };
  return `${ability} — ${suffix[match[2]] ?? pathLabel(match[2])}`;
}

function itemFieldLabel(kind: ItemKind, field: ItemField): string {
  const key = ITEM_FIELD_LABEL_KEY[`${kind}:${field.path}`] ?? ITEM_FIELD_SHARED_LABEL_KEY[field.path];
  return key ? text(key) : kind === "vehicle" ? (vehicleFieldLabel(field.path) ?? pathLabel(field.path)) : pathLabel(field.path);
}

const ITEM_SECTION_LABEL_KEY: Record<ItemField["section"], string> = {
  core: "EAGLEHOMEBREW.window.item.section.core",
  physical: "EAGLEHOMEBREW.window.item.section.physical",
  description: "EAGLEHOMEBREW.window.item.section.description",
  equippable: "EAGLEHOMEBREW.window.item.section.equippable",
  mountable: "EAGLEHOMEBREW.window.item.section.mountable",
  uses: "EAGLEHOMEBREW.window.item.section.uses",
  advanced: "EAGLEHOMEBREW.window.item.section.advanced",
  // M16 live-check rework: NPC-only sections (core/item-field-model.ts).
  abilityScores: "EAGLEHOMEBREW.window.item.section.abilityScores",
  skills: "EAGLEHOMEBREW.window.item.section.skills",
  combat: "EAGLEHOMEBREW.window.item.section.combat",
  movement: "EAGLEHOMEBREW.window.item.section.movement",
  senses: "EAGLEHOMEBREW.window.item.section.senses",
  resistances: "EAGLEHOMEBREW.window.item.section.resistances",
  currency: "EAGLEHOMEBREW.window.item.section.currency",
  travel: "EAGLEHOMEBREW.window.item.section.travel",
  actions: "EAGLEHOMEBREW.window.item.section.actions",
  capacity: "EAGLEHOMEBREW.window.item.section.capacity",
  source: "EAGLEHOMEBREW.window.item.section.source",
};

type Step = { readonly name: "art" } | { readonly name: "subcategory"; readonly art: Art } | { readonly name: "form"; readonly entry: CatalogEntry };

export interface EditSession {
  readonly entry: CatalogEntry;
  readonly worldUuid: string;
  readonly libraryUuid: string;
  readonly pack: string;
  readonly fallbackUsed: boolean;
  readonly librarySource: JsonObject;
  readonly worldSource: JsonObject;
}

// What the window needs, handed in so the class can be built without arguments (the Hub's `open` calls
// `new EagleHomebrewApplication()`, the same way the Library's own window does).
export interface HomebrewWindowContext {
  sender: RequestSender;
  // `() => game.settings.get("dnd5e", "rulesVersion")` in Foundry (M3, core/creation-target.ts).
  readRulesVersion(): unknown;
  // The index of a world compendium by its collection id ("world.eagle-loot-2014"), or undefined if it does not exist
  // yet (the Gamemaster has not used the Library's "Create missing compendia" for this kind/version).
  readIndex(collection: string): Promise<readonly { name: string; requirements?: unknown }[] | undefined>;
  resolveActorMember(uuid: string): Promise<ActorResolutionResult>;
  readDocumentSource(uuid: string): Promise<JsonObject | undefined>;
  defaultDocumentSource(entry: CatalogEntry): JsonObject;
  newId(): string;
  notify(level: "info" | "warn" | "error", message: string): void;
}

// Builds the TargetIndex M3's planCreation needs (rule R5: name + requirements) from a compendium index.
function targetIndexOf(rows: readonly { name: string; requirements?: unknown }[]): TargetIndex {
  const keys = rows.map((row) => entryKey(row.name, row.requirements));
  return {
    nameKeys: new Set(keys.map((key) => key.name)),
    has: (key) => keys.some((existing) => sameEntry(existing, key)),
  };
}

// Reads CONFIG.DND5E.* catalogs, already localized by the `ready` hook (dnd5e's own `preLocalize`, confirmed for
// every kind used here: abilities, damageTypes, healingTypes, activityActivationTypes, attackTypes,
// attackClassifications — M7 Discover/Deploy). Kept in v13/ only: core/activity-model.ts stays Foundry-free (M5
// Apply, Deploy correction).
function choicesFor(kind: ChoicesKind): Record<string, string> {
  const DND5E = (CONFIG as unknown as { DND5E: Record<string, Record<string, { label?: string } | string> | undefined> }).DND5E;
  const labelsOf = (record: Record<string, { label?: string } | string> | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!record) return out;
    for (const [key, value] of Object.entries(record)) out[key] = typeof value === "string" ? value : (value.label ?? key);
    return out;
  };
  // M8: `DND5E.tools`/`weaponIds`/`ammoIds` carry no readable label at all (an object with no `label` field, or —
  // for weaponIds/ammoIds — the value is dnd5e's own base item's raw Compendium UUID, not even a translation key).
  // `labelsOf` above would show that UUID or the bare technical key verbatim; this always uses the catalog KEY,
  // auto-formatted the same way `pathLabel` already turns an unlabelled field path into readable text (dadm/
  // m8-02-apply-output.md, Befund 1 / Entscheidung 1).
  const keyLabelsOf = (record: Record<string, unknown> | undefined): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!record) return out;
    for (const key of Object.keys(record)) out[key] = pathLabel(key);
    return out;
  };
  switch (kind) {
    case "abilities":
      return labelsOf(DND5E.abilities);
    case "damageTypes":
      return labelsOf(DND5E.damageTypes);
    case "healingTypes":
      return labelsOf(DND5E.healingTypes);
    case "activationTypes":
      return labelsOf(DND5E.activityActivationTypes);
    case "attackTypeValues":
      return labelsOf(DND5E.attackTypes);
    case "attackClassifications":
      return labelsOf(DND5E.attackClassifications);
    case "activeEffectModes":
      return {
        [String(ACTIVE_EFFECT_MODES.CUSTOM)]: "Custom",
        [String(ACTIVE_EFFECT_MODES.MULTIPLY)]: "Multiply",
        [String(ACTIVE_EFFECT_MODES.ADD)]: "Add",
        [String(ACTIVE_EFFECT_MODES.DOWNGRADE)]: "Downgrade",
        [String(ACTIVE_EFFECT_MODES.UPGRADE)]: "Upgrade",
        [String(ACTIVE_EFFECT_MODES.OVERRIDE)]: "Override",
      };
    case "itemRarity":
      return labelsOf(DND5E.itemRarity);
    case "currencies":
      return labelsOf(DND5E.currencies);
    case "weightUnits":
      return labelsOf(DND5E.weightUnits);
    case "itemProperties":
      return labelsOf(DND5E.itemProperties);
    case "attunementTypes":
      return labelsOf(DND5E.attunementTypes);
    case "toolTypes":
      return labelsOf(DND5E.toolTypes);
    case "weaponTypes":
      return labelsOf(DND5E.weaponTypes);
    case "distanceUnits":
      return labelsOf(DND5E.distanceUnits);
    case "weaponMasteries":
      return labelsOf(DND5E.weaponMasteries);
    case "movementUnits":
      return labelsOf(DND5E.movementUnits);
    case "toolBaseItems":
      return keyLabelsOf(DND5E.tools);
    case "weaponBaseItems":
      return keyLabelsOf(DND5E.weaponIds);
    case "ammoTypes":
      return keyLabelsOf(DND5E.ammoIds);
    // M9: `equipmentTypes`/`consumableTypes` are `{label}`-shaped like every other `labelsOf` catalog above
    // (dadm/m9-02-apply-output.md, Entscheidung 3) — `consumableTypes`' own `subtypes` sub-object is simply
    // ignored here, since `labelsOf` only reads `.label`.
    case "equipmentTypes":
      return labelsOf(DND5E.equipmentTypes);
    case "consumableTypes":
      return labelsOf(DND5E.consumableTypes);
    // M9: the synchronous key-labelled fallback for `type.baseItem` (Equipment) — `#refreshBaseItemOptions`
    // (Mechanismus B, M8a) replaces this with real, `type.value`-filtered names once resolved. Combines
    // `armorIds` (4 non-shield armor types) and `shieldIds` (1 entry) into one flat map, matching how
    // `rawBaseItemIds` reads them for the async lookup below.
    case "equipmentBaseItems":
      return keyLabelsOf({ ...DND5E.armorIds, ...DND5E.shieldIds });
    case "volumeUnits":
      return labelsOf(DND5E.volumeUnits);
    case "featureTypes":
      return labelsOf(DND5E.featureTypes);
    case "enchantmentPeriods":
      return labelsOf(DND5E.enchantmentPeriods);
    // M11c: the curated effect picker's own parameter catalogs (dadm/m11c-02-apply-output.md, Entscheidung 1).
    case "effectSkills":
      return labelsOf(DND5E.skills);
    // Same catalog `toolBaseItems` already reads for Tool's own `type.baseItem` (M8) — `system.tools` on an
    // actor is keyed by these same identifiers ("alchemist", "bagpipes", ...), not by `toolTypes`'s three
    // broad categories.
    case "effectTools":
      return keyLabelsOf(DND5E.tools);
    // `conditionTypes` labels live under `.name`, not `.label` (unlike every other catalog here) and mix real
    // conditions with narrative-only "pseudo" statuses (e.g. "bleeding", "burning") dnd5e itself never treats
    // as something an actor can be immune to — filtered out, matching dnd5e's own distinction.
    case "effectConditions": {
      const conditions = (CONFIG as unknown as { DND5E: { conditionTypes?: Record<string, { name?: string; pseudo?: boolean }> } }).DND5E.conditionTypes;
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(conditions ?? {})) if (!value.pseudo && value.name) out[key] = value.name;
      return out;
    }
    // `languages` is a two-level tree (category -> child languages, e.g. "standard"/"exotic"), unlike every
    // other catalog here — flattened to one flat list of the actual leaf languages `system.traits.languages.
    // value` expects, losing only the category grouping (M11c, accepted simplification).
    case "effectLanguages": {
      const languages = (CONFIG as unknown as { DND5E: { languages?: Record<string, { children?: Record<string, string | { label?: string }> }> } }).DND5E
        .languages;
      const out: Record<string, string> = {};
      for (const category of Object.values(languages ?? {})) {
        for (const [key, value] of Object.entries(category.children ?? {})) out[key] = typeof value === "string" ? value : (value.label ?? key);
      }
      return out;
    }
    // M12: Spell/Species catalogs. `spellSchools`/`creatureTypes` are `{label}`-shaped like every other
    // `labelsOf` catalog; `spellcastingMethods` reads `CONFIG.DND5E.spellcasting` (same shape, different
    // source object, M12 Discover Befund 3).
    case "spellSchools":
      return labelsOf(DND5E.spellSchools);
    case "spellcastingMethods":
      return labelsOf(DND5E.spellcasting);
    case "creatureTypes":
      return labelsOf(DND5E.creatureTypes);
    // M12 live-check rework (2026-09-27): `duration.units` had no choicesKind since M5-M7 — dnd5e splits
    // it across three separate catalogs (special/"instantaneous" etc., scalar/"minute" etc. — itself a
    // Proxy over `timeUnits`, spreads fine into a plain object —, permanent/"until dispelled" etc.);
    // merged here into one flat list, same as any other labelsOf catalog.
    case "durationUnits":
      return labelsOf({ ...DND5E.specialTimePeriods, ...DND5E.scalarTimePeriods, ...DND5E.permanentTimePeriods });
    // `target.template.type`/`target.affects.type` had the same gap — both plain `{label}` catalogs, no
    // bespoke reader needed.
    case "areaTargetTypes":
      return labelsOf(DND5E.areaTargetTypes);
    case "individualTargetTypes":
      return labelsOf(DND5E.individualTargetTypes);
    // `spellPreparationStates` is keyed by name ("unprepared"/"prepared"/"always"), but the field itself
    // (`system.prepared`) stores the numeric `.value` (0/1/2) each entry carries — the option list needs
    // to be keyed by that number, not the catalog's own key, unlike every other catalog here.
    case "spellPreparationStates": {
      const states = (CONFIG as unknown as { DND5E: { spellPreparationStates?: Record<string, { value?: number; label?: string }> } }).DND5E.spellPreparationStates;
      const out: Record<string, string> = {};
      for (const state of Object.values(states ?? {})) if (state.value !== undefined && state.label) out[String(state.value)] = state.label;
      return out;
    }
    // M14: `CONFIG.DND5E.hitDieTypes` is a plain array of die strings ("d4".."d12"), not a `{label}`-keyed
    // catalog like every other entry here — value and label are the same string.
    case "hitDieTypes": {
      const dice = (CONFIG as unknown as { DND5E: { hitDieTypes?: readonly string[] } }).DND5E.hitDieTypes;
      const out: Record<string, string> = {};
      for (const die of dice ?? []) out[die] = die;
      return out;
    }
    // M14 Discover Befund 11: `CONFIG.DND5E.spellProgression` is a deprecated, empty-at-load Proxy — read
    // the non-deprecated source instead (`CONFIG.DND5E.spellcasting.<method>.progression`, the same
    // catalog-merging approach `durationUnits` above already uses for its own split source). "none" has no
    // catalog entry of its own (it is the field's own initial value, not a spellcasting method) — one
    // hardcoded label, the same pragmatic choice `activeEffectModes` already makes above for values with no
    // dnd5e catalog counterpart at all.
    case "spellcastingProgression": {
      const methods = (CONFIG as unknown as { DND5E: { spellcasting?: Record<string, { progression?: Record<string, { label?: string }> }> } }).DND5E
        .spellcasting;
      const out: Record<string, string> = { none: "None" };
      for (const method of Object.values(methods ?? {})) {
        for (const [key, value] of Object.entries(method.progression ?? {})) out[key] = value.label ?? key;
      }
      return out;
    }
    // M14: the five ScaleValue types are a plain internal JS object in dnd5e's own advancement data model
    // (`module/data/advancement/scale-value.mjs`, `export const TYPES`), never exposed through
    // `CONFIG.DND5E` at all — the same "small, stable dnd5e fact, hardcoded" treatment `ACTIVE_EFFECT_MODES`
    // already gets above, for the same reason (nothing to read live).
    case "scaleValueTypes":
      return { string: "Text", number: "Number", cr: "Challenge Rating", dice: "Dice", distance: "Distance" };
    // M14: `CONFIG.DND5E.traitModes` is a real, `{label}`-shaped runtime catalog like every other `labelsOf`
    // entry above.
    case "traitModes":
      return labelsOf(DND5E.traitModes);
    // M14 live-check rework, Fund 1/3 (Runde 2): the curated Trait-target picker's own "Armor"/"Weapons"
    // category catalogs — plain `{key: label}` maps like `activeEffectModes`'s source data, pre-localized by
    // dnd5e itself, `labelsOf` already handles a bare-string value the same as a `{label}` object.
    case "armorProficiencyTypes":
      return labelsOf(DND5E.armorProficiencies);
    case "weaponProficiencyTypes":
      return labelsOf(DND5E.weaponProficiencies);
    // M15: `CONFIG.DND5E.facilities.types`/`.sizes` are nested one level deeper than every other
    // catalog here (`CONFIG.DND5E.facilities.*`, not a top-level `CONFIG.DND5E.facilityTypes`) — still
    // a plain `{label}`-shaped map underneath, `labelsOf` applies unchanged.
    case "facilityTypes":
    case "facilitySizes": {
      const facilities = (CONFIG as unknown as { DND5E: { facilities?: { types?: Record<string, { label?: string }>; sizes?: Record<string, { label?: string }> } } }).DND5E
        .facilities;
      return labelsOf(kind === "facilityTypes" ? facilities?.types : facilities?.sizes);
    }
    // M16: both plain `{label}`-shaped top-level catalogs, the standard `labelsOf` case.
    case "actorSizes":
      return labelsOf(DND5E.actorSizes);
    case "armorClassCalculations":
      return labelsOf(DND5E.armorClasses);
    // M17: Group's native travel controls use these two live dnd5e catalogs. They are plain
    // `{label}` maps like the nearby Actor catalogs.
    case "travelPace":
      return labelsOf(DND5E.travelPace);
    case "travelUnits":
      return labelsOf(DND5E.travelUnits);
    case "vehicleTypes":
      return labelsOf(DND5E.vehicleTypes);
    case "rollModes":
      return { "-1": "Disadvantage", "0": "Normal", "1": "Advantage" };
    case "ignoredDifficultTerrain":
      return { all: "All", magical: "Magical", nonmagical: "Nonmagical" };
    case "physicalItemProperties": {
      const properties = (CONFIG as unknown as { DND5E: { itemProperties?: Record<string, { label?: string; isPhysical?: boolean }> } }).DND5E.itemProperties;
      return labelsOf(Object.fromEntries(Object.entries(properties ?? {}).filter(([, value]) => value.isPhysical)));
    }
    // M16 live-check rework: dnd5e already ships both proficiency-level catalogs verbatim, keyed by
    // the exact numbers the fields themselves store (0/0.5/1/2 and 0/1) — the same "value-keyed select"
    // shape `spellPreparationStates` (M12) already established, `labelsOf` needs no special reader here
    // because the catalog's own keys already match the field's stored value (unlike `prepared`, which
    // needed a `.value`-vs-key remap).
    case "proficiencyLevels":
      return labelsOf(DND5E.proficiencyLevels);
    case "saveProficiencyLevels":
      return labelsOf(DND5E.weaponAndArmorProficiencyLevels);
    // M16b: ItemChoice's own item-type restriction is distinct from `restriction.type` (which is a
    // Feature category). Read the native class's valid type set and Foundry's localized Item labels.
    case "advancementItemTypes": {
      const config = CONFIG as unknown as {
        DND5E: { advancementTypes?: { ItemChoice?: { documentClass?: { VALID_TYPES?: ReadonlySet<string> } } } };
        Item?: { typeLabels?: Record<string, string> };
      };
      const valid = config.DND5E.advancementTypes?.ItemChoice?.documentClass?.VALID_TYPES ?? new Set<string>();
      return Object.fromEntries(
        [...valid].map((value) => [value, config.Item?.typeLabels?.[value] ? text(config.Item.typeLabels[value]) : pathLabel(value)]),
      );
    }
    // dnd5e's ItemChoice form adds "available" beside the normal spell levels. The generic select
    // contributes the blank/Any option itself.
    case "advancementSpellLevels":
      return { available: text("EAGLEHOMEBREW.window.advancement.field.spellLevelAvailable"), ...labelsOf(DND5E.spellLevels) };
    // Spell-list options are assembled by dnd5e's registry after ready, including Eagle Library lists.
    case "advancementSpellLists": {
      const options = (globalThis as unknown as { dnd5e?: { registry?: { spellLists?: { options?: readonly { value?: string; label?: string }[] } } } }).dnd5e
        ?.registry?.spellLists?.options;
      const out: Record<string, string> = {};
      for (const option of options ?? []) if (option.value && option.label) out[option.value] = option.label;
      return out;
    }
    // M16a: dnd5e's own naming convention for an NPC action item's `identifier` (`npc.mjs`'s
    // `_prepareEmbedContext`, M16a Discover Befund 3) — not a `CONFIG.DND5E` catalog at all (dnd5e never
    // exposes these two strings as a labelled list anywhere), the same "small, stable, hardcoded fact"
    // treatment `activeEffectModes`/`scaleValueTypes` already get above. No blank/"(None)" entry: the
    // generic `renderFieldWidget` "select" case already adds its own blank option for every optional
    // select field, the same as `type.value` etc. elsewhere in this window.
    case "legendaryActionIdentifiers":
      return { "legendary-actions": "Legendary Actions (Section Header)", "mythic-actions": "Mythic Actions (Section Header)" };
  }
}

// A plain, auto-formatted label from the last segment of a dnd5e path ("attack.ability" -> "Ability"), for every
// field FIELD_LABEL_KEY does not name explicitly. Field labels are data-driven, not module chrome (see the note at
// ART_LABEL_KEY above) — a pragmatic first pass (M7 Deploy): not as polished as a hand-written label per field, but
// every field stays genuinely editable (N21), which is what matters. `damage.parts`/`healing`'s own four sub-fields
// (the project lead's own example) get real, localized labels instead (`#renderPartField`).
function pathLabel(path: string): string {
  const last = path.split(".").pop() ?? path;
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The raw dnd5e catalog `baseItemOptionsFor` resolves against — `CONFIG.DND5E.tools` values are `{ability, id}`
// objects, `CONFIG.DND5E.weaponIds`/`armorIds`/`shieldIds` values are already the UUID string itself (M8 Apply,
// Befund 1; M9: Equipment combines `armorIds` and `shieldIds`, dadm/m9-02-apply-output.md, Entscheidung 2).
function rawBaseItemIds(kind: ItemKind): Record<string, string> {
  const DND5E = (
    CONFIG as unknown as {
      DND5E: { tools?: Record<string, { id?: string }>; weaponIds?: Record<string, string>; armorIds?: Record<string, string>; shieldIds?: Record<string, string> };
    }
  ).DND5E;
  if (kind === "tool") {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(DND5E.tools ?? {})) if (typeof value.id === "string") out[key] = value.id;
    return out;
  }
  if (kind === "equipment") return { ...(DND5E.armorIds ?? {}), ...(DND5E.shieldIds ?? {}) };
  return { ...(DND5E.weaponIds ?? {}) };
}

// dnd5e's own base-item name/type lookup (M8a Apply, Mechanismus B) — the same one its own item sheet uses
// (dnd5e's `item-sheet.mjs#_getBaseItemOptions`): resolves each catalog entry's real compendium item (cached by
// dnd5e itself after the first lookup per pack) and filters to the ones matching `typeValue`. `dnd5e.documents.
// Trait` is a global the dnd5e system itself exposes (`dnd5e.mjs`, `globalThis.dnd5e.documents`), not part of the
// stable `CONFIG.DND5E` contract — undefined return here means "API missing", and the caller keeps whatever
// synchronous key-label fallback `renderFieldWidget` already rendered rather than emptying the field.
async function baseItemOptionsFor(kind: ItemKind, typeValue: string): Promise<Record<string, string> | undefined> {
  const getBaseItem = (
    globalThis as unknown as {
      dnd5e?: { documents?: { Trait?: { getBaseItem?(id: string): Promise<{ name?: string; system?: { type?: { value?: string } } } | undefined> } } };
    }
  ).dnd5e?.documents?.Trait?.getBaseItem;
  if (!getBaseItem) return undefined;
  const ids = rawBaseItemIds(kind);
  const out: Record<string, string> = {};
  for (const [key, uuid] of Object.entries(ids)) {
    const index = await getBaseItem(uuid);
    if (!index) continue;
    if (typeValue !== "" && index.system?.type?.value !== typeValue) continue;
    out[key] = typeof index.name === "string" && index.name !== "" ? index.name : pathLabel(key);
  }
  return out;
}

// M9, generalized M11: `type.subtype`'s own option set (dadm/m9-02-apply-output.md, Entscheidung 5;
// dadm/m11-02-apply-output.md, Entscheidung 2) — unlike `baseItemOptionsFor` above, this needs no
// compendium lookup: `CONFIG.DND5E[catalog][typeValue].subtypes` is already the full, pre-localized
// label map (`config.mjs`'s own `preLocalize("consumableTypes.ammo.subtypes", ...)`/
// `preLocalize("featureTypes.class.subtypes", ...)` etc.). Empty for any `typeValue` whose catalog
// entry has no `subtypes` (`hasSubtypeCatalog`, core/item-field-model.ts), matching dnd5e's own
// template (`{{#if itemSubtypes}}`).
function dependentSubtypeOptionsFor(catalog: SubtypeCatalog, typeValue: string): Record<string, string> {
  type SubtypeMap = Record<string, { subtypes?: Record<string, string> }>;
  const DND5E = (CONFIG as unknown as { DND5E: Record<string, SubtypeMap | undefined> & { facilities?: { types?: SubtypeMap } } }).DND5E;
  // M15: `facilityTypes` has no matching top-level `CONFIG.DND5E.facilityTypes` — its data lives one
  // level deeper, at `CONFIG.DND5E.facilities.types` (Apply Entscheidung 2).
  const source = catalog === "facilityTypes" ? DND5E.facilities?.types : DND5E[catalog];
  return { ...(source?.[typeValue]?.subtypes ?? {}) };
}

function labelFor(field: ActivityField): string {
  const key = FIELD_LABEL_KEY[field.path];
  return key ? text(key) : pathLabel(field.path);
}

// M14: labels for Advancement fields whose auto-formatted path (`pathLabel`) would be unclear on its own
// (the same reasoning `ITEM_FIELD_LABEL_KEY` already follows for Item fields) — everything else falls back
// to `pathLabel`, same as Activities.
const ADVANCEMENT_FIELD_LABEL_KEY: Record<string, string> = {
  points: "EAGLEHOMEBREW.window.advancement.field.points",
  cap: "EAGLEHOMEBREW.window.advancement.field.cap",
  max: "EAGLEHOMEBREW.window.advancement.field.max",
  locked: "EAGLEHOMEBREW.window.advancement.field.locked",
  recommendation: "EAGLEHOMEBREW.window.advancement.field.recommendation",
  fixed: "EAGLEHOMEBREW.window.advancement.field.fixed",
  items: "EAGLEHOMEBREW.window.advancement.field.items",
  optional: "EAGLEHOMEBREW.window.advancement.field.optional",
  spell: "EAGLEHOMEBREW.window.advancement.field.spell",
  pool: "EAGLEHOMEBREW.window.advancement.field.pool",
  allowDrops: "EAGLEHOMEBREW.window.advancement.field.allowDrops",
  "ItemChoice:type": "EAGLEHOMEBREW.window.advancement.field.itemType",
  "restriction.type": "EAGLEHOMEBREW.window.advancement.field.restrictionType",
  "restriction.subtype": "EAGLEHOMEBREW.window.advancement.field.restrictionSubtype",
  "restriction.level": "EAGLEHOMEBREW.window.advancement.field.restrictionLevel",
  "restriction.list": "EAGLEHOMEBREW.window.advancement.field.restrictionList",
  "distance.units": "EAGLEHOMEBREW.window.advancement.field.distanceUnits",
  grants: "EAGLEHOMEBREW.window.advancement.field.grants",
  allowReplacements: "EAGLEHOMEBREW.window.advancement.field.allowReplacements",
  mode: "EAGLEHOMEBREW.window.advancement.field.mode",
  sizes: "EAGLEHOMEBREW.window.advancement.field.sizes",
};

function advancementFieldLabel(type: AdvancementType, field: AdvancementField): string {
  const key = ADVANCEMENT_FIELD_LABEL_KEY[`${type}:${field.path}`] ?? ADVANCEMENT_FIELD_LABEL_KEY[field.path];
  return key ? text(key) : pathLabel(field.path);
}

const ADVANCEMENT_TYPE_LABEL_KEY: Record<AdvancementType, string> = {
  HitPoints: "EAGLEHOMEBREW.window.advancement.type.hitPoints",
  AbilityScoreImprovement: "EAGLEHOMEBREW.window.advancement.type.abilityScoreImprovement",
  Subclass: "EAGLEHOMEBREW.window.advancement.type.subclass",
  ItemGrant: "EAGLEHOMEBREW.window.advancement.type.itemGrant",
  ItemChoice: "EAGLEHOMEBREW.window.advancement.type.itemChoice",
  ScaleValue: "EAGLEHOMEBREW.window.advancement.type.scaleValue",
  Size: "EAGLEHOMEBREW.window.advancement.type.size",
  Trait: "EAGLEHOMEBREW.window.advancement.type.trait",
};

// M14 Apply Entscheidung 8: which `configuration` key each type's nested table is stored under.
const ADVANCEMENT_TABLES: Partial<Record<AdvancementType, string>> = {
  ItemChoice: "choices",
  ScaleValue: "scale",
  Trait: "choices",
};

// Same key ("choices") means two different things for ItemChoice and Trait (a level-keyed count table vs. a
// plain list of choice groups) — the legend disambiguates, keyed by type rather than by that shared string.
const ADVANCEMENT_TABLE_LEGEND_KEY: Partial<Record<AdvancementType, string>> = {
  ItemChoice: "EAGLEHOMEBREW.window.advancement.table.legendItemChoice",
  ScaleValue: "EAGLEHOMEBREW.window.advancement.table.legendScaleValue",
  Trait: "EAGLEHOMEBREW.window.advancement.table.legendTrait",
};

// The Homebrew window (milestone M4, extended M7): the Hub's Open button renders this. Built like the Hub, the
// Library's own window and its Copy window (UI guide R-01 to R-09): an ApplicationV2 without template files, DOM
// built with `element()`, clicks through `actions`/`data-action`. One window, one internal step (`#step`), no second
// window — unlike Library -> Copy, this is a single linear flow (Art, then subcategory, then the form), not two
// independent tools (M4 Apply, section 2).
export function createHomebrewApplicationClass(context: HomebrewWindowContext) {
  async function onSelectArt(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const art = target.dataset.art as Art | undefined;
    if (!art || !ARTS.includes(art)) return;
    // Roll Table has exactly one kind (M4 Apply, section 3): the subcategory step, with its single always-same
    // button, is skipped — straight to the form.
    if (art === "RollTable") {
      const entry = entryByKey("rolltables");
      if (entry) await this.goTo({ name: "form", entry });
      return;
    }
    await this.goTo({ name: "subcategory", art });
  }

  async function onSelectKind(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const entry = entryByKey(target.dataset.key ?? "");
    if (entry) await this.goTo({ name: "form", entry });
  }

  async function onBack(this: EagleHomebrewApplication): Promise<void> {
    const step = this.currentStep();
    if (step.name === "form") {
      // Roll Table skipped "subcategory" on the way in (onSelectArt above), so it skips it on the way back too.
      await this.goTo(step.entry.art === "RollTable" ? { name: "art" } : { name: "subcategory", art: step.entry.art });
    } else if (step.name === "subcategory") {
      await this.goTo({ name: "art" });
    }
  }

  async function onCreate(this: EagleHomebrewApplication): Promise<void> {
    await this.createSimple();
  }

  async function onAddAction(this: EagleHomebrewApplication): Promise<void> {
    await this.openBuilder();
  }

  async function onPickActivityType(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const type = target.dataset.type as ActivityType | undefined;
    if (type) await this.pickActivityType(type);
  }

  async function onAddEffectChange(this: EagleHomebrewApplication): Promise<void> {
    await this.addEffectChangeRow();
  }

  async function onRemoveEffectChange(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const row = Number(target.dataset.row);
    if (Number.isFinite(row)) await this.removeEffectChangeRow(row);
  }

  async function onConfirmActivity(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmActivity();
  }

  async function onCancelActivity(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelBuilder();
  }

  async function onRemoveDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeDraft(index);
  }

  async function onEditDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.editActivityDraft(index);
  }

  // M11b: a standalone effect — a plain permanent bonus with no Activity to trigger it (dadm/m11-05-live-check
  // -output.md, Fund 4; dadm/m11b-02-apply-output.md). Its own small builder, parallel to the Activity one above,
  // not nested inside it: "Add Effect" opens the same name+change-rows shape `#renderEffectSection` already has,
  // just without the "does this action also trigger an effect" toggle — here the whole point is the effect.
  async function onAddEffect(this: EagleHomebrewApplication): Promise<void> {
    await this.openEffectBuilder();
  }

  async function onAddStandaloneEffectChange(this: EagleHomebrewApplication): Promise<void> {
    await this.addStandaloneEffectChangeRow();
  }

  async function onRemoveStandaloneEffectChange(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const row = Number(target.dataset.row);
    if (Number.isFinite(row)) await this.removeStandaloneEffectChangeRow(row);
  }

  async function onConfirmEffect(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmEffect();
  }

  async function onCancelEffect(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelEffectBuilder();
  }

  async function onRemoveEffectDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeEffectDraft(index);
  }

  async function onEditEffectDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.editEffectDraft(index);
  }

  // M13: Roll Table's own entries, the same flat add/confirm/cancel/remove shape as standalone Effects above.
  async function onAddResult(this: EagleHomebrewApplication): Promise<void> {
    await this.openResultBuilder();
  }

  async function onConfirmResult(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmResult();
  }

  async function onCancelResult(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelResultBuilder();
  }

  async function onRemoveResultDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeResultDraft(index);
  }

  async function onEditResultDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.editResultDraft(index);
  }

  // M14/M16b: the shared Item Advancement builder — a type picker like Activities.
  async function onAddAdvancement(this: EagleHomebrewApplication): Promise<void> {
    await this.openAdvancementBuilder();
  }

  async function onPickAdvancementType(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const type = target.dataset.type as AdvancementType | undefined;
    if (type) await this.pickAdvancementType(type);
  }

  async function onConfirmAdvancement(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmAdvancement();
  }

  async function onCancelAdvancement(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelAdvancementBuilder();
  }

  async function onRemoveAdvancementDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeAdvancementDraft(index);
  }

  async function onEditAdvancementDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.editAdvancementDraft(index);
  }

  async function onAddAdvancementTableRow(this: EagleHomebrewApplication): Promise<void> {
    await this.addAdvancementTableRow();
  }

  async function onRemoveAdvancementTableRow(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const row = Number(target.dataset.row);
    if (Number.isFinite(row)) await this.removeAdvancementTableRow(row);
  }

  // M16a: NPC's own Actions builder — a type picker like Activities/Advancement (`onAddAction`/
  // `onAddAdvancement`), but the type picked first is the carrying Item's own type (Feat/Weapon,
  // M16a Discover Befund 1), not an Activity type; the (optional) Activity type is a second, nested pick.
  async function onAddNpcAction(this: EagleHomebrewApplication): Promise<void> {
    await this.openNpcActionBuilder();
  }

  async function onPickNpcActionItemType(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const itemType = target.dataset.itemType as NpcActionItemType | undefined;
    if (itemType) await this.pickNpcActionItemType(itemType);
  }

  async function onPickNpcActionActivityType(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const type = target.dataset.type as ActivityType | undefined;
    if (type) await this.pickNpcActionActivityType(type);
  }

  async function onRemoveNpcActionActivity(this: EagleHomebrewApplication): Promise<void> {
    await this.removeNpcActionActivity();
  }

  async function onConfirmNpcAction(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmNpcAction();
  }

  async function onCancelNpcAction(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelNpcActionBuilder();
  }

  async function onRemoveNpcActionDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeNpcActionDraft(index);
  }

  async function onEditNpcActionDraft(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.editNpcActionDraft(index);
  }

  // M17: Encounter/Group member rows use their own repeatable builder because the two native
  // schemas store Actor references differently (UUID vs world id).
  async function onAddMember(this: EagleHomebrewApplication): Promise<void> {
    await this.openMemberBuilder();
  }

  async function onConfirmMember(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmMember();
  }

  async function onCancelMember(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelMemberBuilder();
  }

  async function onRemoveMember(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeMemberDraft(index);
  }

  async function onSetPrimaryVehicle(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const actorId = target.dataset.actorId;
    if (actorId) await this.setPrimaryVehicle(actorId);
  }

  async function onAddVehicleRoster(this: EagleHomebrewApplication): Promise<void> {
    await this.openVehicleRosterBuilder();
  }

  async function onConfirmVehicleRoster(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmVehicleRoster();
  }

  async function onCancelVehicleRoster(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelVehicleRosterBuilder();
  }

  async function onRemoveVehicleRoster(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeVehicleRosterDraft(index);
  }

  async function onAddVehicleDamage(this: EagleHomebrewApplication): Promise<void> {
    await this.addVehicleDamageRow();
  }

  async function onRemoveVehicleDamage(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const row = Number(target.dataset.row);
    if (Number.isFinite(row)) await this.removeVehicleDamageRow(row);
  }

  async function onAddVehicleComponent(this: EagleHomebrewApplication): Promise<void> {
    await this.openVehicleComponentBuilder();
  }

  async function onPickVehicleComponentType(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const type = target.dataset.componentType as VehicleComponentType | undefined;
    if (type) await this.pickVehicleComponentType(type);
  }

  async function onPickVehicleComponentActivityType(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const type = target.dataset.type as ActivityType | undefined;
    if (type) await this.pickVehicleComponentActivityType(type);
  }

  async function onRemoveVehicleComponentActivity(this: EagleHomebrewApplication): Promise<void> {
    await this.removeVehicleComponentActivity();
  }

  async function onConfirmVehicleComponent(this: EagleHomebrewApplication): Promise<void> {
    await this.confirmVehicleComponent();
  }

  async function onCancelVehicleComponent(this: EagleHomebrewApplication): Promise<void> {
    await this.cancelVehicleComponentBuilder();
  }

  async function onRemoveVehicleComponent(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.removeVehicleComponentDraft(index);
  }

  async function onEditVehicleComponent(this: EagleHomebrewApplication, _event: PointerEvent, target: HTMLElement): Promise<void> {
    const index = Number(target.dataset.index);
    if (Number.isFinite(index)) await this.editVehicleComponentDraft(index);
  }

  // A class declaration, not a class expression in the `return`: its name must be visible to the handler functions
  // above (their `this: EagleHomebrewApplication` parameter), which only a hoisted declaration gives (matches
  // EagleLibrary/v13/copy-application.ts).
  class EagleHomebrewApplication extends ApplicationV2 {
    static override DEFAULT_OPTIONS = {
      id: "eagle-homebrew-window",
      window: { title: "EAGLEHOMEBREW.window.title", icon: "fa-solid fa-hammer", resizable: true, contentClasses: ["standard-form"] },
      // An explicit height (not just width), matching EagleLibrary's Copy window: without one, a window that grows
      // past the viewport (e.g. "More fields" open) has nothing to make it scroll (M7 live-check finding).
      position: { width: 520, height: 700 },
      actions: {
        selectArt: onSelectArt,
        selectKind: onSelectKind,
        back: onBack,
        create: onCreate,
        addAction: onAddAction,
        pickActivityType: onPickActivityType,
        addEffectChange: onAddEffectChange,
        removeEffectChange: onRemoveEffectChange,
        confirmActivity: onConfirmActivity,
        cancelActivity: onCancelActivity,
        removeDraft: onRemoveDraft,
        editDraft: onEditDraft,
        addEffect: onAddEffect,
        addStandaloneEffectChange: onAddStandaloneEffectChange,
        removeStandaloneEffectChange: onRemoveStandaloneEffectChange,
        confirmEffect: onConfirmEffect,
        cancelEffect: onCancelEffect,
        removeEffectDraft: onRemoveEffectDraft,
        editEffectDraft: onEditEffectDraft,
        addResult: onAddResult,
        confirmResult: onConfirmResult,
        cancelResult: onCancelResult,
        removeResultDraft: onRemoveResultDraft,
        editResultDraft: onEditResultDraft,
        addAdvancement: onAddAdvancement,
        pickAdvancementType: onPickAdvancementType,
        confirmAdvancement: onConfirmAdvancement,
        cancelAdvancement: onCancelAdvancement,
        removeAdvancementDraft: onRemoveAdvancementDraft,
        editAdvancementDraft: onEditAdvancementDraft,
        addAdvancementTableRow: onAddAdvancementTableRow,
        removeAdvancementTableRow: onRemoveAdvancementTableRow,
        addNpcAction: onAddNpcAction,
        pickNpcActionItemType: onPickNpcActionItemType,
        pickNpcActionActivityType: onPickNpcActionActivityType,
        removeNpcActionActivity: onRemoveNpcActionActivity,
        confirmNpcAction: onConfirmNpcAction,
        cancelNpcAction: onCancelNpcAction,
        removeNpcActionDraft: onRemoveNpcActionDraft,
        editNpcActionDraft: onEditNpcActionDraft,
        addMember: onAddMember,
        confirmMember: onConfirmMember,
        cancelMember: onCancelMember,
        removeMember: onRemoveMember,
        setPrimaryVehicle: onSetPrimaryVehicle,
        addVehicleRoster: onAddVehicleRoster,
        confirmVehicleRoster: onConfirmVehicleRoster,
        cancelVehicleRoster: onCancelVehicleRoster,
        removeVehicleRoster: onRemoveVehicleRoster,
        addVehicleDamage: onAddVehicleDamage,
        removeVehicleDamage: onRemoveVehicleDamage,
        addVehicleComponent: onAddVehicleComponent,
        pickVehicleComponentType: onPickVehicleComponentType,
        pickVehicleComponentActivityType: onPickVehicleComponentActivityType,
        removeVehicleComponentActivity: onRemoveVehicleComponentActivity,
        confirmVehicleComponent: onConfirmVehicleComponent,
        cancelVehicleComponent: onCancelVehicleComponent,
        removeVehicleComponent: onRemoveVehicleComponent,
        editVehicleComponent: onEditVehicleComponent,
      },
    };

    #step: Step = { name: "art" };
    #nameInput: HTMLInputElement | undefined;
    #createButton: HTMLButtonElement | undefined;
    #busy = false;
    #editSession: EditSession | undefined;

    // Activities collected for the object about to be created (M7 Apply, section 3) — sent as one document.update
    // right after the creation succeeds (Apply, section 3, step 5). Cleared whenever the form step changes.
    #drafts: ActivityDraft[] = [];
    // The builder: closed (`#builderOpen === false`), picking a type (`#builderType === undefined`), or editing one.
    #builderOpen = false;
    #builderType: ActivityType | undefined;
    #builderEffectOn = false;
    #builderEffectChangeRows: number[] = [];
    #nextEffectChangeRow = 0;
    // Field inputs of the activity sub-form, captured at render time and read at confirm time (the same pattern the
    // name field already uses) — keyed by dnd5e path, or "<path>#<sub>" for the four damage-/healing-part inputs.
    #builderFieldInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    #builderEffectNameInput: HTMLInputElement | undefined;
    #builderEffectChangeInputs = new Map<number, EffectChangeRowInputs>();
    #editingActivityIndex: number | undefined;
    #baselineActivityIds = new Set<string>();
    #activitiesDirty = false;

    // M11b: standalone effects — collected the same way `#drafts` collects Activities, but independent of them
    // (an object can have both, either, or neither). Its own small builder state, parallel to `#builderOpen`/
    // `#builderType` above but simpler: no type to pick, the name+change-rows sub-form shows immediately.
    #effectDrafts: EffectModel[] = [];
    #effectBuilderOpen = false;
    #effectBuilderChangeRows: number[] = [];
    #nextStandaloneEffectChangeRow = 0;
    #effectBuilderNameInput: HTMLInputElement | undefined;
    #effectBuilderChangeInputs = new Map<number, EffectChangeRowInputs>();
    #editingEffectIndex: number | undefined;
    #baselineEffectIds = new Set<string>();
    #effectsDirty = false;

    // M13: Roll Table's own entries — collected the same way `#effectDrafts` collects standalone
    // effects (a flat list, no type to pick), written once as the whole `results` array via
    // `document.update` right after creation (Apply, Entscheidung 2-3).
    #resultDrafts: TableResultDraft[] = [];
    #resultBuilderOpen = false;
    #resultBuilderTextInput: HTMLInputElement | undefined;
    #resultBuilderWeightInput: HTMLInputElement | undefined;
    #resultBuilderTextValue = "";
    #resultBuilderWeightValue = "1";
    #editingResultIndex: number | undefined;
    #baselineResultIds = new Set<string>();
    #resultsDirty = false;

    // M14/M16b: guided Advancement entries for Class, Subclass, Feat, Background and Species — a type picker like
    // Activities (M5-M7), not a flat add like Effects/Roll Table entries, since each modelled type
    // (`core/advancement-model.ts`) has its own configuration shape. `#advancementTableRows` etc. hold the
    // one nested table a few types have (`ItemChoice.choices`, `ScaleValue.scale`, `Trait.choices`,
    // `ADVANCEMENT_TABLES` below) — only one table is ever open at a time (whichever type is currently being
    // built), so one generic row bucket serves all three shapes.
    #advancementDrafts: AdvancementDraft[] = [];
    #advancementBuilderOpen = false;
    #advancementBuilderType: AdvancementType | undefined;
    #advancementFieldInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    #advancementFieldValues = new Map<string, string | boolean | string[]>();
    #advancementLevelInput: HTMLInputElement | undefined;
    #advancementLevelValue = "";
    #advancementTableRows: number[] = [];
    #nextAdvancementTableRow = 0;
    #advancementTableInputs = new Map<number, Map<string, HTMLInputElement | HTMLSelectElement>>();
    #advancementTableValues = new Map<number, Record<string, string | boolean>>();
    #editingAdvancementIndex: number | undefined;
    #baselineAdvancementIds = new Set<string>();
    #advancementsDirty = false;

    // M16a: NPC's own Actions — a type picker (Feat/Weapon) like Activities/Advancement, plus its own
    // item-field sub-form (`#actionFieldInputs`/`#actionFieldValues`, the same shape as the top-level
    // `#itemFieldInputs`/`#itemFieldValues` but a separate map since both can be on screen at once) and,
    // nested inside it, at most one optional Activity of its own (M16a Apply, Entscheidung 3) with its own
    // third, independent field map.
    #actionDrafts: NpcActionDraft[] = [];
    #actionBuilderOpen = false;
    #actionBuilderItemType: NpcActionItemType | undefined;
    #actionNameInput: HTMLInputElement | undefined;
    #actionNameValue = "";
    #actionFieldInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    #actionFieldValues = new Map<string, string | boolean | string[]>();
    #actionActivityType: ActivityType | undefined;
    #actionActivityFieldInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    #actionActivityFieldValues = new Map<string, string | boolean | string[]>();
    #editingActionIndex: number | undefined;
    #baselineActionIds = new Set<string>();
    #actionsDirty = false;

    // M17: confirmed Actor members plus one in-progress picker row. Group additionally keeps the
    // selected primary Vehicle id, which is validated again by the pure builder at Create time.
    #memberDrafts: ActorMemberDraft[] = [];
    #memberBuilderOpen = false;
    #memberActorInput: HTMLInputElement | undefined;
    #memberQuantityInput: HTMLInputElement | undefined;
    #memberFormulaInput: HTMLInputElement | undefined;
    #memberActorValue = "";
    #memberQuantityValue = "1";
    #memberFormulaValue = "";
    #primaryVehicleId: string | undefined;

    // M18: a Vehicle's Actor-reference arrays, damage-modifier mapping and embedded Features/Stations.
    #vehicleRosterDrafts: VehicleRosterDraft[] = [];
    #vehicleRosterBuilderOpen = false;
    #vehicleRosterAreaInput: HTMLSelectElement | undefined;
    #vehicleRosterActorInput: HTMLInputElement | undefined;
    #vehicleRosterQuantityInput: HTMLInputElement | undefined;
    #vehicleRosterAreaValue: VehicleRosterArea = "crew";
    #vehicleRosterActorValue = "";
    #vehicleRosterQuantityValue = "1";

    #vehicleDamageRows: number[] = [];
    #nextVehicleDamageRow = 0;
    #vehicleDamageInputs = new Map<number, VehicleDamageRowInputs>();
    #vehicleDamageValues = new Map<number, VehicleDamageRowValues>();

    #vehicleComponentDrafts: VehicleComponentDraft[] = [];
    #vehicleComponentBuilderOpen = false;
    #vehicleComponentType: VehicleComponentType | undefined;
    #vehicleComponentNameInput: HTMLInputElement | undefined;
    #vehicleComponentNameValue = "";
    #vehicleComponentFieldInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    #vehicleComponentFieldValues = new Map<string, string | boolean | string[]>();
    #vehicleComponentCrewInputs = new Map<string, HTMLInputElement>();
    #vehicleComponentCrewValues = new Map<string, string>();
    #vehicleComponentActivityType: ActivityType | undefined;
    #vehicleComponentActivityFieldInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    #vehicleComponentActivityFieldValues = new Map<string, string | boolean | string[]>();
    #editingVehicleComponentIndex: number | undefined;
    #baselineVehicleComponentIds = new Set<string>();
    #vehicleComponentsDirty = false;

    // Persisted values (M7 rework, live-check finding): every re-render rebuilds the form from scratch (a new
    // ApplicationV2 `_renderHTML`/`_replaceHTML` pass), which used to silently drop anything typed but not yet
    // confirmed. `#captureValues()` snapshots the live DOM into these maps right before such a render; the render
    // methods read them back as each input's initial value. Cleared deliberately on navigation (`goTo`) or a
    // finished builder session (`#resetBuilderState`), never merely by a render.
    #nameValue = "";
    #builderValues = new Map<string, string | boolean | string[]>();
    #effectNameValue = "";
    #effectChangeValues = new Map<number, EffectChangeRowValues>();
    #effectBuilderNameValue = "";
    #effectBuilderChangeValues = new Map<number, EffectChangeRowValues>();

    // M8: a kind's own fields (core/item-field-model.ts), the same input/persisted-value pattern as the Activity
    // sub-form above, but for the top-level form itself — keyed by dnd5e path, or "<path>#<sub>" for the nine
    // weaponDamagePart sub-inputs (`#renderItemDamagePartField`).
    #itemFieldInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    #itemFieldValues = new Map<string, string | boolean | string[]>();

    constructor(editSession?: EditSession) {
      super();
      this.#editSession = editSession;
      if (editSession) {
        this.#step = { name: "form", entry: editSession.entry };
        this.#nameValue = typeof editSession.librarySource.name === "string" ? editSession.librarySource.name : "";
        const kind = itemKindFor(editSession.entry.key);
        if (kind) this.#hydrateItemFieldValues(kind, editSession.librarySource);
        this.#hydrateActivitiesAndEffects(editSession.librarySource);
        if (kind && isAdvancementKind(kind)) this.#hydrateAdvancements(kind, editSession.librarySource);
        this.#hydrateResults(editSession.librarySource);
        if (editSession.entry.key === "npcs") this.#hydrateNpcActions(editSession.librarySource);
        if (editSession.entry.key === "vehicles") this.#hydrateVehicle(editSession.librarySource);
        if (kind === "encounter" || kind === "group") this.#hydrateMembers(kind, editSession.librarySource);
      }
    }

    currentStep(): Step {
      return this.#step;
    }

    async goTo(step: Step): Promise<void> {
      this.#step = step;
      this.#drafts = [];
      this.#nameValue = "";
      this.#itemFieldValues.clear();
      this.#resetBuilderState();
      this.#effectDrafts = [];
      this.#resetEffectBuilderState();
      this.#resultDrafts = [];
      this.#resetResultBuilderState();
      this.#advancementDrafts = [];
      this.#resetAdvancementBuilderState();
      this.#actionDrafts = [];
      this.#resetNpcActionBuilderState();
      this.#memberDrafts = [];
      this.#resetMemberBuilderState();
      this.#primaryVehicleId = undefined;
      this.#vehicleRosterDrafts = [];
      this.#resetVehicleRosterBuilderState();
      this.#vehicleDamageRows = [];
      this.#vehicleDamageInputs.clear();
      this.#vehicleDamageValues.clear();
      this.#nextVehicleDamageRow = 0;
      this.#vehicleComponentDrafts = [];
      this.#resetVehicleComponentBuilderState();
      await this.render();
    }

    async openBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetBuilderState();
      this.#builderOpen = true;
      await this.render();
    }

    async editActivityDraft(index: number): Promise<void> {
      const draft = this.#drafts[index];
      if (!draft) return;
      this.#captureValues();
      this.#resetBuilderState();
      this.#editingActivityIndex = index;
      this.#builderOpen = true;
      this.#builderType = draft.type;
      this.#hydrateFlatValues(specFor(draft.type).fields, buildActivityData(draft.type, draft.values) as JsonObject, this.#builderValues);
      if (draft.effect) {
        this.#builderEffectOn = true;
        this.#effectNameValue = draft.effect.name;
        for (const change of draft.effect.changes) {
          const row = this.#nextEffectChangeRow++;
          this.#builderEffectChangeRows.push(row);
          this.#effectChangeValues.set(row, { target: "custom", parameter: "", value: "", proficiency: "1", customKey: change.key, customValue: change.value, customMode: String(change.mode) });
        }
        if (this.#builderEffectChangeRows.length === 0) this.#builderEffectChangeRows.push(this.#nextEffectChangeRow++);
      }
      await this.render();
    }

    async pickActivityType(type: ActivityType): Promise<void> {
      this.#captureValues();
      this.#builderType = type;
      await this.render();
    }

    async cancelBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetBuilderState();
      await this.render();
    }

    async toggleEffect(): Promise<void> {
      this.#captureValues();
      this.#builderEffectOn = !this.#builderEffectOn;
      if (this.#builderEffectOn && this.#builderEffectChangeRows.length === 0) {
        this.#builderEffectChangeRows = [this.#nextEffectChangeRow++];
      }
      await this.render();
    }

    async addEffectChangeRow(): Promise<void> {
      this.#captureValues();
      this.#builderEffectChangeRows = [...this.#builderEffectChangeRows, this.#nextEffectChangeRow++];
      await this.render();
    }

    async removeEffectChangeRow(row: number): Promise<void> {
      this.#captureValues();
      this.#builderEffectChangeRows = this.#builderEffectChangeRows.filter((entry) => entry !== row);
      this.#effectChangeValues.delete(row);
      await this.render();
    }

    async removeDraft(index: number): Promise<void> {
      this.#captureValues();
      if (this.#drafts[index]?.effect) this.#effectsDirty = true;
      this.#drafts = this.#drafts.filter((_draft, i) => i !== index);
      this.#activitiesDirty = true;
      await this.render();
    }

    // M11b: opens straight into the name+change-rows sub-form (one row to start, like toggling the Activity
    // builder's own effect section on) — no type to pick first, unlike `openBuilder`.
    async openEffectBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetEffectBuilderState();
      this.#effectBuilderOpen = true;
      this.#effectBuilderChangeRows = [this.#nextStandaloneEffectChangeRow++];
      await this.render();
    }

    async editEffectDraft(index: number): Promise<void> {
      const draft = this.#effectDrafts[index];
      if (!draft) return;
      this.#captureValues();
      this.#resetEffectBuilderState();
      this.#editingEffectIndex = index;
      this.#effectBuilderOpen = true;
      this.#effectBuilderNameValue = draft.name;
      for (const change of draft.changes) {
        const row = this.#nextStandaloneEffectChangeRow++;
        this.#effectBuilderChangeRows.push(row);
        this.#effectBuilderChangeValues.set(row, { target: "custom", parameter: "", value: "", proficiency: "1", customKey: change.key, customValue: change.value, customMode: String(change.mode) });
      }
      if (this.#effectBuilderChangeRows.length === 0) this.#effectBuilderChangeRows.push(this.#nextStandaloneEffectChangeRow++);
      await this.render();
    }

    async addStandaloneEffectChangeRow(): Promise<void> {
      this.#captureValues();
      this.#effectBuilderChangeRows = [...this.#effectBuilderChangeRows, this.#nextStandaloneEffectChangeRow++];
      await this.render();
    }

    async removeStandaloneEffectChangeRow(row: number): Promise<void> {
      this.#captureValues();
      this.#effectBuilderChangeRows = this.#effectBuilderChangeRows.filter((entry) => entry !== row);
      this.#effectBuilderChangeValues.delete(row);
      await this.render();
    }

    async cancelEffectBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetEffectBuilderState();
      await this.render();
    }

    // Validates the name (same rule as everywhere else, `validateName`) and appends one EffectModel to
    // `this.#effectDrafts` — sent on the next "Create" click, merged into the same `effects` array Activity-linked
    // effects already share (`buildActivitiesChanges`'s new `standaloneEffects` parameter, M11b).
    async confirmEffect(): Promise<void> {
      const validated = validateName(this.#effectBuilderNameInput?.value ?? "");
      if (!validated.ok) {
        context.notify("warn", text(validated.reason === "empty" ? "EAGLEHOMEBREW.window.notify.nameEmpty" : "EAGLEHOMEBREW.window.notify.nameTooLong"));
        return;
      }
      const changes = this.#readEffectChanges(this.#effectBuilderChangeRows, this.#effectBuilderChangeInputs);
      const previous = this.#editingEffectIndex === undefined ? undefined : this.#effectDrafts[this.#editingEffectIndex];
      const next: EffectModel = { ...(previous?.id ? { id: previous.id } : {}), name: validated.name, changes };
      this.#effectDrafts = this.#editingEffectIndex === undefined
        ? [...this.#effectDrafts, next]
        : this.#effectDrafts.map((draft, index) => index === this.#editingEffectIndex ? next : draft);
      this.#effectsDirty = true;
      this.#resetEffectBuilderState();
      await this.render();
    }

    async removeEffectDraft(index: number): Promise<void> {
      this.#captureValues();
      this.#effectDrafts = this.#effectDrafts.filter((_draft, i) => i !== index);
      this.#effectsDirty = true;
      await this.render();
    }

    // M13: opens the entry sub-form (text + weight, no type to pick, no change rows — the same flat
    // shape as `openEffectBuilder`, simpler because a table entry has none of an effect's sub-fields).
    async openResultBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetResultBuilderState();
      this.#resultBuilderOpen = true;
      await this.render();
    }

    async editResultDraft(index: number): Promise<void> {
      const draft = this.#resultDrafts[index];
      if (!draft) return;
      this.#captureValues();
      this.#resetResultBuilderState();
      this.#editingResultIndex = index;
      this.#resultBuilderTextValue = draft.text;
      this.#resultBuilderWeightValue = String(draft.weight);
      this.#resultBuilderOpen = true;
      await this.render();
    }

    async cancelResultBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetResultBuilderState();
      await this.render();
    }

    // Validates the text the same way every other name-like field in this window does (`validateName`
    // — not empty, at most 200 characters); the weight defaults to 1 for anything empty or invalid,
    // `core/table-result.ts` clamps it to a positive integer besides.
    async confirmResult(): Promise<void> {
      const validated = validateName(this.#resultBuilderTextInput?.value ?? "");
      if (!validated.ok) {
        context.notify("warn", text(validated.reason === "empty" ? "EAGLEHOMEBREW.window.notify.nameEmpty" : "EAGLEHOMEBREW.window.notify.nameTooLong"));
        return;
      }
      const weight = readNumber(this.#resultBuilderWeightInput) ?? 1;
      const previous = this.#editingResultIndex === undefined ? undefined : this.#resultDrafts[this.#editingResultIndex];
      const next = { ...(previous?.id ? { id: previous.id } : {}), text: validated.name, weight };
      this.#resultDrafts = this.#editingResultIndex === undefined
        ? [...this.#resultDrafts, next]
        : this.#resultDrafts.map((draft, index) => index === this.#editingResultIndex ? next : draft);
      this.#resultsDirty = true;
      this.#resetResultBuilderState();
      await this.render();
    }

    async removeResultDraft(index: number): Promise<void> {
      this.#captureValues();
      this.#resultDrafts = this.#resultDrafts.filter((_draft, i) => i !== index);
      this.#resultsDirty = true;
      await this.render();
    }

    // M14/M16b: opens the type picker (like `openBuilder` for Activities), not directly a sub-form — the
    // available types depend on the current Item kind and each has its own configuration shape.
    async openAdvancementBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetAdvancementBuilderState();
      this.#advancementBuilderOpen = true;
      await this.render();
    }

    async editAdvancementDraft(index: number): Promise<void> {
      const draft = this.#advancementDrafts[index];
      if (!draft) return;
      this.#captureValues();
      this.#resetAdvancementBuilderState();
      this.#editingAdvancementIndex = index;
      this.#advancementBuilderOpen = true;
      this.#advancementBuilderType = draft.type;
      this.#advancementLevelValue = draft.level === undefined ? "" : String(draft.level);
      const built = buildAdvancementData(draft.type, draft.level, draft.values, draft.table ?? {}) as JsonObject;
      const configuration = built.configuration && !Array.isArray(built.configuration) && typeof built.configuration === "object" ? built.configuration as JsonObject : {};
      this.#hydrateFlatValues(specForAdvancement(draft.type).fields, configuration, this.#advancementFieldValues);
      const tableKey = ADVANCEMENT_TABLES[draft.type];
      const tableValue = tableKey ? configuration[tableKey] : undefined;
      if (draft.type === "Trait" && Array.isArray(tableValue)) {
        for (const raw of tableValue) {
          if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
          const row = this.#nextAdvancementTableRow++;
          const value = raw as Record<string, JsonValue>;
          this.#advancementTableRows.push(row);
          this.#advancementTableValues.set(row, { count: typeof value.count === "number" ? String(value.count) : "", pool: Array.isArray(value.pool) ? value.pool.filter((entry): entry is string => typeof entry === "string").join(", ") : "" });
        }
      } else if (tableValue && !Array.isArray(tableValue) && typeof tableValue === "object") {
        for (const [level, raw] of Object.entries(tableValue)) {
          if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
          const row = this.#nextAdvancementTableRow++;
          const value = raw as Record<string, JsonValue>;
          const persisted: Record<string, string | boolean> = { level };
          for (const [key, cell] of Object.entries(value)) {
            if (typeof cell === "boolean") persisted[key] = cell;
            else if (typeof cell === "string" || typeof cell === "number") {
              const target = key === "value" ? (typeof cell === "number" ? "valueNumber" : "valueText") : key;
              persisted[target] = String(cell);
            }
          }
          this.#advancementTableRows.push(row);
          this.#advancementTableValues.set(row, persisted);
        }
      }
      await this.render();
    }

    async pickAdvancementType(type: AdvancementType): Promise<void> {
      this.#captureValues();
      const kind = this.#currentAdvancementKind();
      const selectedTypes = this.#advancementDrafts.filter((_draft, index) => index !== this.#editingAdvancementIndex).map((draft) => draft.type);
      if (!kind || !advancementTypesFor(kind, selectedTypes).includes(type)) {
        if (type === "Size") context.notify("warn", text("EAGLEHOMEBREW.window.notify.sizeOnlyOnce"));
        return;
      }
      this.#advancementBuilderType = type;
      if (type === "Size") this.#advancementFieldValues.set("sizes", ["med"]);
      this.#advancementTableRows = [];
      this.#advancementTableInputs.clear();
      this.#advancementTableValues.clear();
      if (ADVANCEMENT_TABLES[type]) this.#advancementTableRows = [this.#nextAdvancementTableRow++];
      await this.render();
    }

    async cancelAdvancementBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetAdvancementBuilderState();
      await this.render();
    }

    async addAdvancementTableRow(): Promise<void> {
      this.#captureValues();
      this.#advancementTableRows = [...this.#advancementTableRows, this.#nextAdvancementTableRow++];
      await this.render();
    }

    async removeAdvancementTableRow(row: number): Promise<void> {
      this.#captureValues();
      this.#advancementTableRows = this.#advancementTableRows.filter((entry) => entry !== row);
      this.#advancementTableValues.delete(row);
      await this.render();
    }

    // Reads the current type's flat fields and, where applicable, its level and its one nested table
    // (Discover Befund 9 / Apply Entscheidung 8), and appends one AdvancementDraft — sent on the next
    // "Create" click, one `system.advancement.<id>` entry per draft (`core/advancement-batch.ts`).
    async confirmAdvancement(): Promise<void> {
      const type = this.#advancementBuilderType;
      if (!type) return;
      const kind = this.#currentAdvancementKind();
      const selectedTypes = this.#advancementDrafts.filter((_draft, index) => index !== this.#editingAdvancementIndex).map((draft) => draft.type);
      if (!kind || !advancementTypesFor(kind, selectedTypes).includes(type)) {
        if (type === "Size") context.notify("warn", text("EAGLEHOMEBREW.window.notify.sizeOnlyOnce"));
        return;
      }
      const spec = specForAdvancement(type);
      const level = spec.hasLevel ? readNumber(this.#advancementLevelInput) : undefined;
      const values: Record<string, JsonValue> = {};
      for (const field of spec.fields) {
        const value = readFieldValue(field, this.#advancementFieldInputs);
        if (value !== undefined) values[field.path] = value;
      }
      if (type === "Size" && !validSizeSelection(values)) {
        context.notify("warn", text("EAGLEHOMEBREW.window.notify.sizeRequired"));
        return;
      }
      const table = ADVANCEMENT_TABLES[type] ? this.#readAdvancementTable(type) : undefined;
      const previous = this.#editingAdvancementIndex === undefined ? undefined : this.#advancementDrafts[this.#editingAdvancementIndex];
      const next: AdvancementDraft = { ...(previous?.id ? { id: previous.id } : {}), type, level, values, ...(table ? { table } : {}) };
      this.#advancementDrafts = this.#editingAdvancementIndex === undefined
        ? [...this.#advancementDrafts, next]
        : this.#advancementDrafts.map((draft, index) => index === this.#editingAdvancementIndex ? next : draft);
      this.#advancementsDirty = true;
      this.#resetAdvancementBuilderState();
      await this.render();
    }

    #currentAdvancementKind(): AdvancementKind | undefined {
      if (this.#step.name !== "form") return undefined;
      const kind = itemKindFor(this.#step.entry.key);
      return kind && isAdvancementKind(kind) ? kind : undefined;
    }

    async removeAdvancementDraft(index: number): Promise<void> {
      this.#captureValues();
      this.#advancementDrafts = this.#advancementDrafts.filter((_draft, i) => i !== index);
      this.#advancementsDirty = true;
      await this.render();
    }

    // M16a: opens the item-type picker (Feat/Weapon) — the carrying Item's own type, not an Activity type
    // (that is a second, nested pick, `pickNpcActionActivityType`, once `pickNpcActionItemType` has run).
    async openNpcActionBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetNpcActionBuilderState();
      this.#actionBuilderOpen = true;
      await this.render();
    }

    async editNpcActionDraft(index: number): Promise<void> {
      const draft = this.#actionDrafts[index];
      if (!draft) return;
      this.#captureValues();
      this.#resetNpcActionBuilderState();
      this.#editingActionIndex = index;
      this.#actionBuilderOpen = true;
      this.#actionBuilderItemType = draft.itemType;
      this.#actionNameValue = draft.name;
      this.#hydrateFlatValues(actionItemFields(draft.itemType), buildItemFieldData(draft.itemFieldValues) as JsonObject, this.#actionFieldValues);
      if (draft.activity) {
        this.#actionActivityType = draft.activity.type;
        this.#hydrateFlatValues(specFor(draft.activity.type).fields, buildActivityData(draft.activity.type, draft.activity.values) as JsonObject, this.#actionActivityFieldValues);
      }
      await this.render();
    }

    async pickNpcActionItemType(itemType: NpcActionItemType): Promise<void> {
      this.#captureValues();
      this.#actionBuilderItemType = itemType;
      await this.render();
    }

    async pickNpcActionActivityType(type: ActivityType): Promise<void> {
      this.#captureValues();
      this.#actionActivityType = type;
      await this.render();
    }

    // Drops the nested Activity entirely, back to "no Activity" (dnd5e's own fallback: the item becomes a
    // passive Trait, `npcActionCategory`) — not a cancel of the whole Action item.
    async removeNpcActionActivity(): Promise<void> {
      this.#captureValues();
      this.#actionActivityType = undefined;
      this.#actionActivityFieldInputs.clear();
      this.#actionActivityFieldValues.clear();
      await this.render();
    }

    async cancelNpcActionBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetNpcActionBuilderState();
      await this.render();
    }

    // Reads the Action item's own fields, its optional nested Activity's fields (at most one, M16a Apply
    // Entscheidung 3), and appends one NpcActionDraft — sent on the next "Create" click alongside every
    // other draft kind (`createSimple`). Reads straight from the live DOM, the same as `confirmActivity`.
    async confirmNpcAction(): Promise<void> {
      const itemType = this.#actionBuilderItemType;
      if (!itemType) return;
      const validated = validateName(this.#actionNameInput?.value ?? "");
      if (!validated.ok) {
        context.notify("warn", text(validated.reason === "empty" ? "EAGLEHOMEBREW.window.notify.nameEmpty" : "EAGLEHOMEBREW.window.notify.nameTooLong"));
        return;
      }
      const itemFieldValues: Record<string, JsonValue> = {};
      for (const field of actionItemFields(itemType)) {
        const value = readFieldValue(field, this.#actionFieldInputs);
        if (value !== undefined) itemFieldValues[field.path] = value;
      }
      let activity: NpcActionDraft["activity"];
      const activityType = this.#actionActivityType;
      if (activityType) {
        const values: Record<string, JsonValue> = {};
        for (const field of specFor(activityType).fields) {
          if (field.path === "effects") continue; // no nested Effect for an NPC action (M16a Apply, Entscheidung 3)
          if (field.widget === "damagePart" || field.widget === "healingPart") {
            const part = this.#readPart(field.path, this.#actionActivityFieldInputs);
            if (part) values[field.path] = field.widget === "damagePart" ? [part] : part;
            continue;
          }
          const value = readFieldValue(field, this.#actionActivityFieldInputs);
          if (value !== undefined) values[field.path] = value;
        }
        const previousActivity = this.#editingActionIndex === undefined ? undefined : this.#actionDrafts[this.#editingActionIndex]?.activity;
        activity = { ...(previousActivity?.id ? { id: previousActivity.id } : {}), type: activityType, values };
      }
      const previous = this.#editingActionIndex === undefined ? undefined : this.#actionDrafts[this.#editingActionIndex];
      const next: NpcActionDraft = { ...(previous?.id ? { id: previous.id } : {}), itemType, name: validated.name, itemFieldValues, activity };
      this.#actionDrafts = this.#editingActionIndex === undefined
        ? [...this.#actionDrafts, next]
        : this.#actionDrafts.map((draft, index) => index === this.#editingActionIndex ? next : draft);
      this.#actionsDirty = true;
      this.#resetNpcActionBuilderState();
      await this.render();
    }

    async removeNpcActionDraft(index: number): Promise<void> {
      this.#captureValues();
      this.#actionDrafts = this.#actionDrafts.filter((_draft, i) => i !== index);
      this.#actionsDirty = true;
      await this.render();
    }

    async openMemberBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetMemberBuilderState();
      this.#memberBuilderOpen = true;
      await this.render();
    }

    async cancelMemberBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetMemberBuilderState();
      await this.render();
    }

    async confirmMember(): Promise<void> {
      if (this.#step.name !== "form") return;
      const kind = itemKindFor(this.#step.entry.key);
      if (kind !== "encounter" && kind !== "group") return;
      this.#captureValues();
      const actorUuid = this.#memberActorValue.trim();
      if (actorUuid === "") {
        context.notify("warn", text("EAGLEHOMEBREW.window.notify.memberActorRequired"));
        return;
      }

      const resolved = await context.resolveActorMember(actorUuid);
      if (!resolved.ok) {
        const key =
          resolved.reason === "not-found"
            ? "EAGLEHOMEBREW.window.notify.memberNotFound"
            : resolved.reason === "not-actor"
              ? "EAGLEHOMEBREW.window.notify.memberNotActor"
              : "EAGLEHOMEBREW.window.notify.memberAmbiguousLibrary";
        context.notify("warn", text(key));
        return;
      }

      if (kind === "encounter") {
        const rawQuantity = this.#memberQuantityValue.trim();
        const quantity = rawQuantity === "" ? undefined : Number(rawQuantity);
        const normalized = normalizeEncounterMember(
          resolved,
          quantity,
          this.#memberFormulaValue,
          new Set(this.#memberDrafts.filter((draft): draft is EncounterMemberDraft => draft.kind === "encounter").map((draft) => draft.actorUuid)),
        );
        if (!normalized.ok) {
          this.#notifyMemberFailure(normalized.reason);
          return;
        }
        this.#memberDrafts = [...this.#memberDrafts, normalized.draft];
        if (normalized.draft.libraryState === "missing") {
          context.notify("warn", text("EAGLEHOMEBREW.window.notify.memberMissingLibrary", { name: normalized.draft.name }));
        }
      } else {
        const normalized = normalizeGroupMember(
          resolved,
          new Set(this.#memberDrafts.filter((draft): draft is GroupMemberDraft => draft.kind === "group").map((draft) => draft.actorId)),
        );
        if (!normalized.ok) {
          this.#notifyMemberFailure(normalized.reason);
          return;
        }
        this.#memberDrafts = [...this.#memberDrafts, normalized.draft];
        if (normalized.draft.libraryState === "missing") {
          context.notify("warn", text("EAGLEHOMEBREW.window.notify.memberMissingLibrary", { name: normalized.draft.name }));
        }
      }

      this.#resetMemberBuilderState();
      await this.render();
    }

    async removeMemberDraft(index: number): Promise<void> {
      this.#captureValues();
      const removed = this.#memberDrafts[index];
      this.#memberDrafts = this.#memberDrafts.filter((_draft, i) => i !== index);
      if (removed?.kind === "group" && removed.actorId === this.#primaryVehicleId) this.#primaryVehicleId = undefined;
      await this.render();
    }

    async setPrimaryVehicle(actorId: string): Promise<void> {
      this.#captureValues();
      const vehicle = this.#memberDrafts.some((draft) => draft.kind === "group" && draft.actorType === "vehicle" && draft.actorId === actorId);
      if (!vehicle) return;
      this.#primaryVehicleId = this.#primaryVehicleId === actorId ? undefined : actorId;
      await this.render();
    }

    #notifyMemberFailure(reason: MemberNormalizationFailureReason): void {
      const keys: Record<MemberNormalizationFailureReason, string> = {
        "not-npc": "EAGLEHOMEBREW.window.notify.memberNotNpc",
        "unsupported-source": "EAGLEHOMEBREW.window.notify.memberUnsupportedSource",
        "invalid-quantity": "EAGLEHOMEBREW.window.notify.memberInvalidQuantity",
        "invalid-group-member": "EAGLEHOMEBREW.window.notify.memberInvalidGroup",
        "no-world-counterpart": "EAGLEHOMEBREW.window.notify.memberNoWorld",
        duplicate: "EAGLEHOMEBREW.window.notify.memberDuplicate",
      };
      context.notify("warn", text(keys[reason]));
    }

    async openVehicleRosterBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetVehicleRosterBuilderState();
      this.#vehicleRosterBuilderOpen = true;
      await this.render();
    }

    async cancelVehicleRosterBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetVehicleRosterBuilderState();
      await this.render();
    }

    async confirmVehicleRoster(): Promise<void> {
      this.#captureValues();
      const uuid = this.#vehicleRosterActorValue.trim();
      if (uuid === "") {
        context.notify("warn", text("EAGLEHOMEBREW.window.notify.memberActorRequired"));
        return;
      }
      const resolved = await context.resolveActorMember(uuid);
      if (!resolved.ok) {
        const key = resolved.reason === "not-found"
          ? "EAGLEHOMEBREW.window.notify.memberNotFound"
          : resolved.reason === "not-actor"
            ? "EAGLEHOMEBREW.window.notify.memberNotActor"
            : "EAGLEHOMEBREW.window.notify.memberAmbiguousLibrary";
        context.notify("warn", text(key));
        return;
      }
      const quantity = Number(this.#vehicleRosterQuantityValue);
      const existing = new Set(this.#vehicleRosterDrafts.map((draft) => `${draft.area}:${draft.actorUuid}`));
      const normalized = normalizeVehicleRosterDraft(resolved, this.#vehicleRosterAreaValue, quantity, existing);
      if (!normalized.ok) {
        this.#notifyVehicleRosterFailure(normalized.reason);
        return;
      }
      this.#vehicleRosterDrafts = [...this.#vehicleRosterDrafts, normalized.draft];
      if (normalized.draft.libraryState === "missing") {
        context.notify("warn", text("EAGLEHOMEBREW.window.notify.memberMissingLibrary", { name: normalized.draft.name }));
      }
      this.#warnVehicleActorCapacities();
      this.#resetVehicleRosterBuilderState();
      await this.render();
    }

    async removeVehicleRosterDraft(index: number): Promise<void> {
      this.#captureValues();
      this.#vehicleRosterDrafts = this.#vehicleRosterDrafts.filter((_draft, current) => current !== index);
      await this.render();
    }

    #notifyVehicleRosterFailure(reason: VehicleRosterFailureReason): void {
      const keys: Record<VehicleRosterFailureReason, string> = {
        "invalid-actor": "EAGLEHOMEBREW.window.notify.vehicleRosterInvalidActor",
        "unsupported-source": "EAGLEHOMEBREW.window.notify.memberUnsupportedSource",
        "no-world-counterpart": "EAGLEHOMEBREW.window.notify.memberNoWorld",
        "invalid-quantity": "EAGLEHOMEBREW.window.notify.vehicleRosterInvalidQuantity",
        duplicate: "EAGLEHOMEBREW.window.notify.vehicleRosterDuplicate",
      };
      context.notify("warn", text(keys[reason]));
    }

    #warnVehicleActorCapacities(): void {
      const crew = readNumber(this.#itemFieldInputs.get("crew.max") as HTMLInputElement | undefined);
      const passengers = readNumber(this.#itemFieldInputs.get("passengers.max") as HTMLInputElement | undefined);
      for (const warning of vehicleCapacityWarnings(this.#vehicleRosterDrafts, { crew, passengers })) {
        context.notify("warn", text("EAGLEHOMEBREW.window.notify.vehicleCapacityExceeded", {
          area: text(`EAGLEHOMEBREW.window.vehicle.roster.area.${warning.area}`),
          count: String(warning.count),
          maximum: String(warning.maximum),
        }));
      }
    }

    async addVehicleDamageRow(): Promise<void> {
      this.#captureValues();
      this.#vehicleDamageRows = [...this.#vehicleDamageRows, this.#nextVehicleDamageRow++];
      await this.render();
    }

    async removeVehicleDamageRow(row: number): Promise<void> {
      this.#captureValues();
      this.#vehicleDamageRows = this.#vehicleDamageRows.filter((entry) => entry !== row);
      this.#vehicleDamageValues.delete(row);
      await this.render();
    }

    async openVehicleComponentBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetVehicleComponentBuilderState();
      this.#vehicleComponentBuilderOpen = true;
      await this.render();
    }

    async editVehicleComponentDraft(index: number): Promise<void> {
      const draft = this.#vehicleComponentDrafts[index];
      if (!draft) return;
      this.#captureValues();
      this.#resetVehicleComponentBuilderState();
      this.#editingVehicleComponentIndex = index;
      this.#vehicleComponentBuilderOpen = true;
      this.#vehicleComponentType = draft.type;
      this.#vehicleComponentNameValue = draft.name;
      this.#hydrateFlatValues(vehicleComponentFields(draft.type), buildItemFieldData(draft.itemFieldValues) as JsonObject, this.#vehicleComponentFieldValues);
      for (const assignment of draft.crew) this.#vehicleComponentCrewValues.set(assignment.actorUuid, String(assignment.quantity));
      if (draft.activity) {
        this.#vehicleComponentActivityType = draft.activity.type;
        this.#hydrateFlatValues(specFor(draft.activity.type).fields, buildActivityData(draft.activity.type, draft.activity.values) as JsonObject, this.#vehicleComponentActivityFieldValues);
      }
      await this.render();
    }

    async pickVehicleComponentType(type: VehicleComponentType): Promise<void> {
      this.#captureValues();
      this.#vehicleComponentType = type;
      await this.render();
    }

    async pickVehicleComponentActivityType(type: ActivityType): Promise<void> {
      this.#captureValues();
      this.#vehicleComponentActivityType = type;
      await this.render();
    }

    async removeVehicleComponentActivity(): Promise<void> {
      this.#captureValues();
      this.#vehicleComponentActivityType = undefined;
      this.#vehicleComponentActivityFieldInputs.clear();
      this.#vehicleComponentActivityFieldValues.clear();
      await this.render();
    }

    async cancelVehicleComponentBuilder(): Promise<void> {
      this.#captureValues();
      this.#resetVehicleComponentBuilderState();
      await this.render();
    }

    async confirmVehicleComponent(): Promise<void> {
      const type = this.#vehicleComponentType;
      if (!type) return;
      const validated = validateName(this.#vehicleComponentNameInput?.value ?? "");
      if (!validated.ok) {
        context.notify("warn", text(validated.reason === "empty" ? "EAGLEHOMEBREW.window.notify.nameEmpty" : "EAGLEHOMEBREW.window.notify.nameTooLong"));
        return;
      }
      const itemFieldValues: Record<string, JsonValue> = {};
      for (const field of vehicleComponentFields(type)) {
        if (field.widget === "weaponDamagePart") {
          const part = this.#readItemDamagePart(field.path, this.#vehicleComponentFieldInputs);
          if (part) itemFieldValues[field.path] = part;
          continue;
        }
        const value = readFieldValue(field, this.#vehicleComponentFieldInputs);
        if (value !== undefined) itemFieldValues[field.path] = value;
      }
      const crew: VehicleCrewAssignment[] = [];
      if (type !== "feature") {
        for (const [actorUuid, input] of this.#vehicleComponentCrewInputs) {
          const quantity = readNumber(input);
          if (quantity !== undefined && quantity > 0) crew.push({ actorUuid, quantity });
        }
      }
      let activity: VehicleComponentDraft["activity"];
      if (this.#vehicleComponentActivityType) {
        const values: Record<string, JsonValue> = {};
        for (const field of specFor(this.#vehicleComponentActivityType).fields) {
          if (field.path === "effects") continue;
          if (field.widget === "damagePart" || field.widget === "healingPart") {
            const part = this.#readPart(field.path, this.#vehicleComponentActivityFieldInputs);
            if (part) values[field.path] = field.widget === "damagePart" ? [part] : part;
            continue;
          }
          const value = readFieldValue(field, this.#vehicleComponentActivityFieldInputs);
          if (value !== undefined) values[field.path] = value;
        }
        const previousActivity = this.#editingVehicleComponentIndex === undefined ? undefined : this.#vehicleComponentDrafts[this.#editingVehicleComponentIndex]?.activity;
        activity = { ...(previousActivity?.id ? { id: previousActivity.id } : {}), type: this.#vehicleComponentActivityType, values };
      }
      const previous = this.#editingVehicleComponentIndex === undefined ? undefined : this.#vehicleComponentDrafts[this.#editingVehicleComponentIndex];
      const draft: VehicleComponentDraft = { ...(previous?.id ? { id: previous.id } : {}), type, name: validated.name, itemFieldValues, crew, activity };
      const candidate = this.#editingVehicleComponentIndex === undefined
        ? [...this.#vehicleComponentDrafts, draft]
        : this.#vehicleComponentDrafts.map((entry, index) => index === this.#editingVehicleComponentIndex ? draft : entry);
      const validation = buildVehicleComponentItemsChanges(
        candidate,
        () => "preview",
        vehicleCrewQuantities(this.#vehicleRosterDrafts),
      );
      if (!validation.ok) {
        context.notify("warn", text("EAGLEHOMEBREW.window.notify.vehicleComponentCrewInvalid"));
        return;
      }
      if (stationCapacityExceeded(draft)) context.notify("warn", text("EAGLEHOMEBREW.window.notify.vehicleStationCapacityExceeded"));
      this.#vehicleComponentDrafts = candidate;
      this.#vehicleComponentsDirty = true;
      this.#resetVehicleComponentBuilderState();
      await this.render();
    }

    async removeVehicleComponentDraft(index: number): Promise<void> {
      this.#captureValues();
      this.#vehicleComponentDrafts = this.#vehicleComponentDrafts.filter((_draft, current) => current !== index);
      this.#vehicleComponentsDirty = true;
      await this.render();
    }

    // Snapshots every input currently on screen into the persisted maps (see their declaration above). Safe to call
    // whenever: a field that is not currently rendered simply is not in `#builderFieldInputs` yet, so there is
    // nothing to read for it.
    #captureValues(): void {
      if (this.#nameInput) this.#nameValue = this.#nameInput.value;
      for (const [path, input] of this.#builderFieldInputs) this.#builderValues.set(path, currentValueOf(input));
      for (const [path, input] of this.#itemFieldInputs) this.#itemFieldValues.set(path, currentValueOf(input));
      if (this.#builderEffectNameInput) this.#effectNameValue = this.#builderEffectNameInput.value;
      for (const [row, rowInputs] of this.#builderEffectChangeInputs) this.#effectChangeValues.set(row, captureEffectChangeRow(rowInputs));
      if (this.#effectBuilderNameInput) this.#effectBuilderNameValue = this.#effectBuilderNameInput.value;
      for (const [row, rowInputs] of this.#effectBuilderChangeInputs) this.#effectBuilderChangeValues.set(row, captureEffectChangeRow(rowInputs));
      if (this.#resultBuilderTextInput) this.#resultBuilderTextValue = this.#resultBuilderTextInput.value;
      if (this.#resultBuilderWeightInput) this.#resultBuilderWeightValue = this.#resultBuilderWeightInput.value;
      for (const [path, input] of this.#advancementFieldInputs) this.#advancementFieldValues.set(path, currentValueOf(input));
      if (this.#advancementLevelInput) this.#advancementLevelValue = this.#advancementLevelInput.value;
      for (const [row, rowInputs] of this.#advancementTableInputs) this.#advancementTableValues.set(row, captureAdvancementTableRow(rowInputs));
      if (this.#actionNameInput) this.#actionNameValue = this.#actionNameInput.value;
      for (const [path, input] of this.#actionFieldInputs) this.#actionFieldValues.set(path, currentValueOf(input));
      for (const [path, input] of this.#actionActivityFieldInputs) this.#actionActivityFieldValues.set(path, currentValueOf(input));
      if (this.#memberActorInput) {
        const raw = currentValueOf(this.#memberActorInput);
        this.#memberActorValue = Array.isArray(raw) ? (raw[0] ?? "") : typeof raw === "string" ? raw : "";
      }
      if (this.#memberQuantityInput) this.#memberQuantityValue = this.#memberQuantityInput.value;
      if (this.#memberFormulaInput) this.#memberFormulaValue = this.#memberFormulaInput.value;
      if (this.#vehicleRosterAreaInput) this.#vehicleRosterAreaValue = this.#vehicleRosterAreaInput.value as VehicleRosterArea;
      if (this.#vehicleRosterActorInput) {
        const raw = currentValueOf(this.#vehicleRosterActorInput);
        this.#vehicleRosterActorValue = Array.isArray(raw) ? (raw[0] ?? "") : typeof raw === "string" ? raw : "";
      }
      if (this.#vehicleRosterQuantityInput) this.#vehicleRosterQuantityValue = this.#vehicleRosterQuantityInput.value;
      for (const [row, inputs] of this.#vehicleDamageInputs) {
        this.#vehicleDamageValues.set(row, { damageType: inputs.damageType.value, formula: inputs.formula.value });
      }
      if (this.#vehicleComponentNameInput) this.#vehicleComponentNameValue = this.#vehicleComponentNameInput.value;
      for (const [path, input] of this.#vehicleComponentFieldInputs) this.#vehicleComponentFieldValues.set(path, currentValueOf(input));
      for (const [actorUuid, input] of this.#vehicleComponentCrewInputs) this.#vehicleComponentCrewValues.set(actorUuid, input.value);
      for (const [path, input] of this.#vehicleComponentActivityFieldInputs) this.#vehicleComponentActivityFieldValues.set(path, currentValueOf(input));
    }

    #resetBuilderState(): void {
      this.#builderOpen = false;
      this.#builderType = undefined;
      this.#builderEffectOn = false;
      this.#builderEffectChangeRows = [];
      this.#builderFieldInputs.clear();
      this.#builderEffectNameInput = undefined;
      this.#builderEffectChangeInputs.clear();
      this.#builderValues.clear();
      this.#effectNameValue = "";
      this.#effectChangeValues.clear();
      this.#editingActivityIndex = undefined;
    }

    // M11b
    #resetEffectBuilderState(): void {
      this.#effectBuilderOpen = false;
      this.#effectBuilderChangeRows = [];
      this.#effectBuilderNameInput = undefined;
      this.#effectBuilderChangeInputs.clear();
      this.#effectBuilderNameValue = "";
      this.#effectBuilderChangeValues.clear();
      this.#editingEffectIndex = undefined;
    }

    // M13
    #resetResultBuilderState(): void {
      this.#resultBuilderOpen = false;
      this.#resultBuilderTextInput = undefined;
      this.#resultBuilderWeightInput = undefined;
      this.#resultBuilderTextValue = "";
      this.#resultBuilderWeightValue = "1";
      this.#editingResultIndex = undefined;
    }

    // M14
    #resetAdvancementBuilderState(): void {
      this.#advancementBuilderOpen = false;
      this.#advancementBuilderType = undefined;
      this.#advancementFieldInputs.clear();
      this.#advancementFieldValues.clear();
      this.#advancementLevelInput = undefined;
      this.#advancementLevelValue = "";
      this.#advancementTableRows = [];
      this.#advancementTableInputs.clear();
      this.#advancementTableValues.clear();
      this.#editingAdvancementIndex = undefined;
    }

    // M16a
    #resetNpcActionBuilderState(): void {
      this.#actionBuilderOpen = false;
      this.#actionBuilderItemType = undefined;
      this.#actionNameInput = undefined;
      this.#actionNameValue = "";
      this.#actionFieldInputs.clear();
      this.#actionFieldValues.clear();
      this.#actionActivityType = undefined;
      this.#actionActivityFieldInputs.clear();
      this.#actionActivityFieldValues.clear();
      this.#editingActionIndex = undefined;
    }

    #resetMemberBuilderState(): void {
      this.#memberBuilderOpen = false;
      this.#memberActorInput = undefined;
      this.#memberQuantityInput = undefined;
      this.#memberFormulaInput = undefined;
      this.#memberActorValue = "";
      this.#memberQuantityValue = "1";
      this.#memberFormulaValue = "";
    }

    #resetVehicleRosterBuilderState(): void {
      this.#vehicleRosterBuilderOpen = false;
      this.#vehicleRosterAreaInput = undefined;
      this.#vehicleRosterActorInput = undefined;
      this.#vehicleRosterQuantityInput = undefined;
      this.#vehicleRosterAreaValue = "crew";
      this.#vehicleRosterActorValue = "";
      this.#vehicleRosterQuantityValue = "1";
    }

    #resetVehicleComponentBuilderState(): void {
      this.#vehicleComponentBuilderOpen = false;
      this.#vehicleComponentType = undefined;
      this.#vehicleComponentNameInput = undefined;
      this.#vehicleComponentNameValue = "";
      this.#vehicleComponentFieldInputs.clear();
      this.#vehicleComponentFieldValues.clear();
      this.#vehicleComponentCrewInputs.clear();
      this.#vehicleComponentCrewValues.clear();
      this.#vehicleComponentActivityType = undefined;
      this.#vehicleComponentActivityFieldInputs.clear();
      this.#vehicleComponentActivityFieldValues.clear();
      this.#editingVehicleComponentIndex = undefined;
    }

    // Shared by `confirmActivity`'s own (optional) triggered effect and `confirmEffect`'s standalone one (M11b),
    // now (M11c) via the curated picker rather than a raw key/value: a row with a real target resolves through
    // `resolveEffectChange` (core/effect-targets.ts) — the value comes from the proficiency select for a
    // `proficiencyLevel` target, the parameter select for a "fixed" one, the plain value text otherwise. A row
    // left at "Custom (Advanced)" falls back to the original raw key/value/mode fields unchanged. A row with
    // neither a target chosen nor a custom key is skipped, same as an empty key was skipped before M11c.
    #readEffectChanges(rows: readonly number[], inputs: ReadonlyMap<number, EffectChangeRowInputs>): EffectChange[] {
      const changes: EffectChange[] = [];
      for (const row of rows) {
        const rowInputs = inputs.get(row);
        if (!rowInputs) continue;
        if (rowInputs.target.value === "custom") {
          const key = rowInputs.customKey.value.trim();
          if (key === "") continue;
          const mode = Number(rowInputs.customMode.value) as EffectChange["mode"];
          changes.push({ key, value: rowInputs.customValue.value, mode });
          continue;
        }
        const target = effectTargetById(rowInputs.target.value);
        if (!target) continue;
        const parameter = rowInputs.parameter.value || undefined;
        const value = target.valueKind === "proficiencyLevel" ? rowInputs.proficiency.value : rowInputs.value.value;
        const change = resolveEffectChange(target.id, parameter, value);
        if (change) changes.push(change);
      }
      return changes;
    }

    // Reads the sub-form for `this.#builderType`, validates the optional effect name, and appends one ActivityDraft
    // to `this.#drafts` (M7 Apply, section 3, steps 3-4). Does not send anything yet — that happens with the next
    // "Create" click (`createSimple`). Reads straight from the live DOM (not the persisted maps): nothing has been
    // re-rendered since the fields were last shown, so their current values are exactly these inputs' values.
    async confirmActivity(): Promise<void> {
      const type = this.#builderType;
      if (!type) return;
      const spec = specFor(type);
      const values: Record<string, JsonValue> = {};
      for (const field of spec.fields) {
        if (field.path === "effects") continue; // carried via the effect section below, not a generic field
        if (field.widget === "damagePart" || field.widget === "healingPart") {
          const part = this.#readPart(field.path);
          if (part) values[field.path] = field.widget === "damagePart" ? [part] : part;
          continue;
        }
        const value = this.#readField(field);
        if (value !== undefined) values[field.path] = value;
      }

      let effect: EffectModel | undefined;
      if (this.#builderEffectOn) {
        const validated = validateName(this.#builderEffectNameInput?.value ?? "");
        if (!validated.ok) {
          context.notify("warn", text(validated.reason === "empty" ? "EAGLEHOMEBREW.window.notify.nameEmpty" : "EAGLEHOMEBREW.window.notify.nameTooLong"));
          return;
        }
        const changes = this.#readEffectChanges(this.#builderEffectChangeRows, this.#builderEffectChangeInputs);
        const previousEffect = this.#editingActivityIndex === undefined ? undefined : this.#drafts[this.#editingActivityIndex]?.effect;
        effect = { ...(previousEffect?.id ? { id: previousEffect.id } : {}), name: validated.name, changes };
      }

      const previous = this.#editingActivityIndex === undefined ? undefined : this.#drafts[this.#editingActivityIndex];
      const next: ActivityDraft = { ...(previous?.id ? { id: previous.id } : {}), type, values, effect };
      this.#drafts = this.#editingActivityIndex === undefined
        ? [...this.#drafts, next]
        : this.#drafts.map((draft, index) => index === this.#editingActivityIndex ? next : draft);
      this.#activitiesDirty = true;
      if (effect || previous?.effect) this.#effectsDirty = true;
      this.#resetBuilderState();
      await this.render();
    }

    #readField(field: ActivityField): JsonValue | undefined {
      return readFieldValue(field, this.#builderFieldInputs);
    }

    // Reads the four sub-inputs of a damage-/healing-part field (M7 Deploy/rework: `damage.parts` — an array field,
    // wrapped in `[...]` by the caller — and `heal`'s own `healing` — a single object, not wrapped — share this
    // reader; only the caller decides whether to wrap the result). `inputs` defaults to the top-level Activity
    // builder's own map; M16a passes `#actionActivityFieldInputs` for the nested Activity on an NPC Action item —
    // the same reader, a second map (Deploy generalization, the same treatment `readFieldValue`/`renderFieldWidget`
    // already got in M8 once a second real use case appeared).
    #readPart(prefix: string, inputs: ReadonlyMap<string, HTMLInputElement | HTMLSelectElement> = this.#builderFieldInputs): Record<string, JsonValue> | undefined {
      const number = readNumber(inputs.get(`${prefix}#number`) as HTMLInputElement | undefined);
      const denomination = readNumber(inputs.get(`${prefix}#denomination`) as HTMLInputElement | undefined);
      const bonus = (inputs.get(`${prefix}#bonus`) as HTMLInputElement | undefined)?.value.trim() ?? "";
      const typeList = readList(inputs.get(`${prefix}#types`));
      const part: Record<string, JsonValue> = {};
      if (number !== undefined) part.number = number;
      if (denomination !== undefined) part.denomination = denomination;
      if (bonus !== "") part.bonus = bonus;
      if (typeList.length > 0) part.types = typeList;
      return Object.keys(part).length > 0 ? part : undefined;
    }

    // Runs the pilot path for a minimally creatable kind (M4 Apply, section 4, generalized M7 Apply section 1 from
    // Loot alone to every kind in SIMPLE_KINDS): validate the name, read the target compendium's index, plan the
    // placement (name/version, M3), create the pair (M2). If any Activities were collected (Add Action), they are
    // written to **both** sides of the pair (M7 rework, live-check finding: the first version wrote only to the
    // world copy, leaving the Library copy — the source, N14 a — without them) via two document.update calls (M6),
    // each with its own deep-cloned copy of the same built `changes` (see the clone note at the call site below), so
    // both sides get the same activity/effect ids.
    async createSimple(): Promise<void> {
      if (this.#busy || this.#step.name !== "form" || !SIMPLE_KINDS.has(this.#step.entry.key) || !this.#nameInput) return;
      const entry = this.#step.entry;
      const validated = validateName(this.#nameInput.value);
      if (!validated.ok) {
        context.notify("warn", text(validated.reason === "empty" ? "EAGLEHOMEBREW.window.notify.nameEmpty" : "EAGLEHOMEBREW.window.notify.nameTooLong"));
        return;
      }
      if (this.#editSession) {
        await this.#saveEdit(entry, validated.name);
        return;
      }
      this.#setBusy(true);
      try {
        const rulesVersion = currentRulesVersion(context.readRulesVersion);
        // M13 Apply, Entscheidung 1: an unversioned kind (Roll Table, `entry.versioned === false`)
        // has one compendium, named without a version suffix (library-convention.md, Abschnitt 1).
        const collection = entry.versioned ? `world.eagle-${entry.key}-${rulesVersion}` : `world.eagle-${entry.key}`;
        const rows = await context.readIndex(collection);
        if (!rows) {
          context.notify("error", text("EAGLEHOMEBREW.window.notify.noTarget", { collection }));
          return;
        }
        // M8: a kind's own fields (Tool/Weapon, full coverage N21) share the same `system`-nested `data.system`
        // document.create expects as the version's `source.rules` (M4) — one buildItemFieldData/buildPathData call
        // nests both together, so a field and the version never fight over which one wins `system`.
        // M11: read before `planCreation` (M8-M10 read it after, since no kind needed anything from it) — Feat's
        // own `requirements` value must be part of the very key `planCreation`/`targetIndexOf` check for a
        // collision (R5, dadm/m11-02-apply-output.md, Entscheidung 4), not just of the document written afterwards.
        const itemKind = itemKindFor(entry.key);
        const itemFieldValues = itemKind ? this.#collectItemFieldValues(itemKind) : {};
        const placement = planCreation({ versioned: entry.versioned }, rulesVersion, validated.name, itemFieldValues.requirements, targetIndexOf(rows));
        const systemValues: Record<string, JsonValue> = { ...itemFieldValues };
        if (itemKind === "encounter") {
          const members = this.#memberDrafts.filter((draft): draft is EncounterMemberDraft => draft.kind === "encounter");
          systemValues.members = buildEncounterMembers(members);
        } else if (itemKind === "group") {
          const members = this.#memberDrafts.filter((draft): draft is GroupMemberDraft => draft.kind === "group");
          const built = buildGroupMembers(members, this.#primaryVehicleId);
          if (!built.ok) {
            context.notify("warn", text("EAGLEHOMEBREW.window.notify.primaryVehicleInvalid"));
            return;
          }
          systemValues.members = built.members;
          if (built.primaryVehicle) systemValues.primaryVehicle = built.primaryVehicle;
        } else if (itemKind === "vehicle") {
          const roster = buildVehicleRosterValues(this.#vehicleRosterDrafts);
          systemValues["crew.value"] = roster.crew;
          systemValues["passengers.value"] = roster.passengers;
          systemValues["draft.value"] = roster.draft;
          const damageDrafts: VehicleDamageModifierDraft[] = this.#vehicleDamageRows.map((row) => {
            const inputs = this.#vehicleDamageInputs.get(row);
            return { damageType: inputs?.damageType.value ?? "", formula: inputs?.formula.value ?? "" };
          });
          const damage = buildVehicleDamageModifiers(damageDrafts);
          if (!damage.ok) {
            context.notify("warn", text(damage.reason === "missing-type"
              ? "EAGLEHOMEBREW.window.notify.vehicleDamageTypeRequired"
              : "EAGLEHOMEBREW.window.notify.vehicleDamageDuplicate"));
            return;
          }
          if (Object.keys(damage.amount).length > 0) systemValues["traits.dm.amount"] = damage.amount;
          const componentValidation = buildVehicleComponentItemsChanges(
            this.#vehicleComponentDrafts,
            () => "preview",
            vehicleCrewQuantities(this.#vehicleRosterDrafts),
          );
          if (!componentValidation.ok) {
            context.notify("warn", text("EAGLEHOMEBREW.window.notify.vehicleComponentCrewInvalid"));
            return;
          }
          this.#warnVehicleActorCapacities();
        }
        const missingLibraryNames = [
          ...this.#memberDrafts.filter((draft) => draft.libraryState === "missing").map((draft) => draft.name),
          ...this.#vehicleRosterDrafts.filter((draft) => draft.libraryState === "missing").map((draft) => draft.name),
        ];
        if (missingLibraryNames.length > 0) {
          context.notify("warn", text("EAGLEHOMEBREW.window.notify.membersMissingLibraryCreate", { names: missingLibraryNames.join(", ") }));
        }
        if (placement.version) systemValues["source.rules"] = placement.version;
        const systemData = buildItemFieldData(systemValues);
        const result = await createPair(
          context.sender,
          { libraryPack: collection, worldType: entry.worldType },
          context.newId(),
          {
            name: placement.name,
            // Only a typed document (Item/Actor) has a subtype to set; Roll Table's schema has no
            // `type` field at all (M13 Discover Befund 5) — sending one anyway is simply skipped.
            ...(entry.subtype ? { type: entry.subtype } : {}),
            // A nested object, not a dotted key: document.create passes `data` straight into Item.createDocuments
            // (EagleFlightControl/v13/document-create.ts), which does not expand dotted paths the way
            // compendium.import's `changes` does (that expansion is specific to that request type).
            ...(Object.keys(systemData).length > 0 ? { system: systemData } : {}),
          },
        );
        if ("failed" in result.library) {
          context.notify("error", text("EAGLEHOMEBREW.window.notify.failed", { name: placement.name, reason: result.library.reason, detail: result.library.detail }));
          return;
        }
        if (!result.world || "failed" in result.world) {
          const failure = result.world && "failed" in result.world ? result.world : { reason: "no-world-result", detail: "" };
          context.notify("error", text("EAGLEHOMEBREW.window.notify.failed", { name: placement.name, reason: failure.reason, detail: failure.detail }));
          return;
        }
        context.notify(
          "info",
          text(placement.renamed ? "EAGLEHOMEBREW.window.notify.renamed" : "EAGLEHOMEBREW.window.notify.created", { name: placement.name }),
        );
        // M15 Apply, Entscheidung 3: Facility is 2024 Bastion System content — nothing technically
        // prevents creating one in a Legacy (2014) world (Discover Befund 6), so this is a hint, not a
        // block; the creation above already ran either way.
        if (entry.key === "facilities" && rulesVersion === "2014") context.notify("warn", text("EAGLEHOMEBREW.window.notify.facilityLegacyHint"));
        if (
          this.#drafts.length > 0 ||
          this.#effectDrafts.length > 0 ||
          this.#resultDrafts.length > 0 ||
          this.#advancementDrafts.length > 0 ||
          this.#actionDrafts.length > 0 ||
          this.#vehicleComponentDrafts.length > 0
        ) {
          const changes = buildActivitiesChanges(this.#drafts, context.newId, this.#effectDrafts);
          // M13 Apply, Entscheidung 3: `results` is a genuine Foundry EmbeddedCollectionField on
          // RollTable, written the same way `effects` already is above — the whole array under one
          // `changes` path, through the same two document.update calls (library then world side).
          if (this.#resultDrafts.length > 0) {
            const { results, formula } = buildTableResults(this.#resultDrafts, context.newId);
            changes.results = results;
            changes.formula = formula;
          }
          // M14 Apply, Entscheidung 6: `system.advancement` is a MappingField like `system.activities`
          // (Discover Befund 9) — each draft becomes its own `system.advancement.<id>` path, merged
          // alongside Activities/Effects/Roll Table entries into the same single `changes` object.
          if (this.#advancementDrafts.length > 0) Object.assign(changes, buildAdvancementChanges(this.#advancementDrafts, context.newId));
          // M16a Apply, Entscheidung 6: `items` is a genuine Foundry EmbeddedCollectionField on Actor,
          // the same whole-array write `effects`/`results` above already use, confirmed live by the
          // M16a spike (`dadm/m16a-spike-1-result-output.md`) before this milestone even started.
          if (this.#actionDrafts.length > 0) Object.assign(changes, buildNpcActionItemsChanges(this.#actionDrafts, context.newId));
          if (this.#vehicleComponentDrafts.length > 0) {
            const built = buildVehicleComponentItemsChanges(
              this.#vehicleComponentDrafts,
              context.newId,
              vehicleCrewQuantities(this.#vehicleRosterDrafts),
            );
            if (built.ok) Object.assign(changes, built.changes);
          }
          // Diagnostic for live-check finding 14 (M7 rework Runde 3, dadm/m7-hd-1-output.md): Flight Control
          // rejects the whole document.update payload as soon as one value anywhere in it fails its
          // JSON-serializability check, without saying which one. Mirror that same check here, on the exact object
          // about to be sent, and log the precise offending path if any — so the next report says where the problem
          // is instead of only that there is one. Logged as a single plain string (not `console.log(label, obj)`),
          // because a live object logged that way shows only "Object" until manually expanded in the browser and
          // cannot be copy-pasted as text — a string is directly copyable from the console as-is.
          const violation = findJsonViolation(changes);
          console.log(
            `[eagle-homebrew] document.update changes: ${JSON.stringify(changes, null, 2)}\n` +
              (violation
                ? `[eagle-homebrew] non-JSON-safe value at: ${violation}`
                : "[eagle-homebrew] no non-JSON-safe value found by findJsonViolation"),
          );
          // Root cause of finding 14, found via the log above: it always showed a clean payload, yet Flight Control
          // still rejected the request — because it rejected the *second* call. Foundry's own `Document#update()`
          // mutates the data object handed to it in place into a full diff shape (the exact same behavior M6's
          // rework already had to work around for the "changed" field, EagleHomebrew/dadm/m6-05-live-check-output.md
          // rework Runde 2) — so the library-side call (which runs first and succeeds) leaves the *shared* `changes`
          // reference mutated by the time the world-side call reuses it, and that mutated shape is what fails
          // JSON-serializability. Each call now gets its own deep-cloned copy, so neither can see the other's
          // Foundry-side mutation.
          const libraryUpdate = await updateDocument(context.sender, result.library.uuid, foundry.utils.deepClone(changes));
          const worldUpdate = await updateDocument(context.sender, result.world.uuid, foundry.utils.deepClone(changes));
          const failedUpdate = !libraryUpdate.ok ? libraryUpdate : !worldUpdate.ok ? worldUpdate : undefined;
          if (failedUpdate) {
            context.notify("error", text("EAGLEHOMEBREW.window.notify.activitiesFailed", { name: placement.name, reason: failedUpdate.reason, detail: failedUpdate.detail }));
          }
        }
        this.#nameInput.value = "";
        this.#nameValue = "";
        this.#itemFieldValues.clear();
        this.#drafts = [];
        this.#resetBuilderState();
        this.#effectDrafts = [];
        this.#resetEffectBuilderState();
        this.#resultDrafts = [];
        this.#resetResultBuilderState();
        this.#advancementDrafts = [];
        this.#resetAdvancementBuilderState();
        this.#actionDrafts = [];
        this.#resetNpcActionBuilderState();
        this.#memberDrafts = [];
        this.#resetMemberBuilderState();
        this.#primaryVehicleId = undefined;
        this.#vehicleRosterDrafts = [];
        this.#resetVehicleRosterBuilderState();
        this.#vehicleDamageRows = [];
        this.#vehicleDamageInputs.clear();
        this.#vehicleDamageValues.clear();
        this.#nextVehicleDamageRow = 0;
        this.#vehicleComponentDrafts = [];
        this.#resetVehicleComponentBuilderState();
        await this.render();
      } finally {
        this.#setBusy(false);
      }
    }

    async #saveEdit(entry: CatalogEntry, name: string): Promise<void> {
      const session = this.#editSession;
      if (!session) return;
      this.#setBusy(true);
      try {
        const [librarySource, worldSource] = await Promise.all([
          context.readDocumentSource(session.libraryUuid),
          context.readDocumentSource(session.worldUuid),
        ]);
        if (!librarySource || !worldSource) {
          context.notify("error", text("EAGLEHOMEBREW.window.notify.editMissing"));
          return;
        }
        const worldPack = valueAt(worldSource, "flags.eagle-homebrew.pair.pack");
        const libraryWorld = valueAt(librarySource, "flags.eagle-homebrew.pair.world");
        if (worldPack !== session.pack || libraryWorld !== entry.worldType || librarySource.type !== entry.subtype && entry.subtype !== undefined || worldSource.type !== entry.subtype && entry.subtype !== undefined) {
          context.notify("error", text("EAGLEHOMEBREW.window.notify.editPairChanged"));
          return;
        }

        const commonChanges: JsonObject = {};
        if (session.librarySource.name !== name) commonChanges.name = name;
        const kind = itemKindFor(entry.key);
        if (kind) {
          const entered = this.#collectItemFieldValues(kind);
          const defaults = context.defaultDocumentSource(entry);
          for (const field of specForItemKind(kind).fields) {
            const after = Object.hasOwn(entered, field.path) ? entered[field.path] : valueAt(defaults, `system.${field.path}`);
            const before = valueAt(session.librarySource, `system.${field.path}`);
            if (after !== undefined && JSON.stringify(after) !== JSON.stringify(before)) commonChanges[`system.${field.path}`] = after;
          }
          if (kind === "encounter") {
            const members = buildEncounterMembers(this.#memberDrafts.filter((draft): draft is EncounterMemberDraft => draft.kind === "encounter"));
            const baseline = valueAt(session.librarySource, "system.members");
            if (!(baseline === undefined && members.length === 0) && JSON.stringify(baseline) !== JSON.stringify(members)) commonChanges["system.members"] = members;
          } else if (kind === "group") {
            const built = buildGroupMembers(this.#memberDrafts.filter((draft): draft is GroupMemberDraft => draft.kind === "group"), this.#primaryVehicleId);
            if (!built.ok) {
              context.notify("warn", text("EAGLEHOMEBREW.window.notify.primaryVehicleInvalid"));
              return;
            }
            const baselineMembers = valueAt(session.librarySource, "system.members");
            if (!(baselineMembers === undefined && built.members.length === 0) && JSON.stringify(baselineMembers) !== JSON.stringify(built.members)) commonChanges["system.members"] = built.members;
            const baselinePrimary = valueAt(session.librarySource, "system.primaryVehicle");
            const desiredPrimary = built.primaryVehicle ?? null;
            if (!(baselinePrimary === undefined && desiredPrimary === null) && baselinePrimary !== desiredPrimary) commonChanges["system.primaryVehicle"] = desiredPrimary;
          }
          if (kind === "vehicle") {
            const roster = buildVehicleRosterValues(this.#vehicleRosterDrafts);
            for (const [path, value] of [["system.crew.value", roster.crew], ["system.passengers.value", roster.passengers], ["system.draft.value", roster.draft]] as const) {
              const baseline = valueAt(session.librarySource, path);
              if (!(baseline === undefined && value.length === 0) && JSON.stringify(baseline) !== JSON.stringify(value)) commonChanges[path] = value;
            }
            const damageDrafts: VehicleDamageModifierDraft[] = this.#vehicleDamageRows.map((row) => {
              const inputs = this.#vehicleDamageInputs.get(row);
              const persisted = this.#vehicleDamageValues.get(row);
              return { damageType: inputs?.damageType.value ?? persisted?.damageType ?? "", formula: inputs?.formula.value ?? persisted?.formula ?? "" };
            });
            const damage = buildVehicleDamageModifiers(damageDrafts);
            if (!damage.ok) {
              context.notify("warn", text(damage.reason === "missing-type" ? "EAGLEHOMEBREW.window.notify.vehicleDamageTypeRequired" : "EAGLEHOMEBREW.window.notify.vehicleDamageDuplicate"));
              return;
            }
            const baselineDamage = valueAt(session.librarySource, "system.traits.dm.amount");
            if (!(baselineDamage === undefined && Object.keys(damage.amount).length === 0) && JSON.stringify(baselineDamage) !== JSON.stringify(damage.amount)) commonChanges["system.traits.dm.amount"] = damage.amount;
          }
        }

        const occupied = new Set<string>();
        const collectIds = (value: JsonValue): void => {
          if (Array.isArray(value)) for (const entry of value) collectIds(entry);
          else if (value && typeof value === "object") {
            const object = value as Record<string, JsonValue>;
            if (typeof object._id === "string") occupied.add(object._id);
            for (const child of Object.values(object)) collectIds(child);
          }
        };
        collectIds(librarySource);
        collectIds(worldSource);
        const newId = (): string => {
          let id = context.newId();
          while (occupied.has(id)) id = context.newId();
          occupied.add(id);
          return id;
        };

        const additions: JsonObject = {};
        if (this.#activitiesDirty || this.#effectsDirty) Object.assign(additions, buildActivitiesChanges(this.#drafts, newId, this.#effectDrafts));
        if (this.#advancementsDirty) Object.assign(additions, buildAdvancementChanges(this.#advancementDrafts, newId));
        if (this.#actionsDirty) {
          const built = buildNpcActionItemsChanges(this.#actionDrafts, newId);
          additions.items = built.items ?? [];
        }
        if (this.#vehicleComponentsDirty) {
          const built = buildVehicleComponentItemsChanges(this.#vehicleComponentDrafts, newId, vehicleCrewQuantities(this.#vehicleRosterDrafts));
          if (!built.ok) {
            context.notify("warn", text("EAGLEHOMEBREW.window.notify.vehicleComponentCrewInvalid"));
            return;
          }
          additions.items = built.changes.items ?? [];
        }
        if (this.#resultsDirty) {
          const built = buildTableResults(this.#resultDrafts, newId);
          additions.results = built.results;
        }

        const projectResults = (source: JsonObject): readonly JsonObject[] | undefined => {
          if (!Object.hasOwn(additions, "results")) return undefined;
          const current = Array.isArray(source.results)
            ? source.results.filter((value): value is JsonObject => !!value && !Array.isArray(value) && typeof value === "object")
            : [];
          const desired = (additions.results as readonly JsonValue[]).filter((value): value is JsonObject => !!value && !Array.isArray(value) && typeof value === "object");
          const projected = projectCollection(current, {
            baselineModeledIds: this.#baselineResultIds,
            desired,
            compatible: (left, right) => left.type === right.type,
          });
          if (!projected.ok) throw new Error(`result ${projected.reason}: ${projected.detail}`);
          return projected.value;
        };
        const desiredActivities: JsonObject = {};
        const desiredAdvancements: JsonObject = {};
        for (const [path, value] of Object.entries(additions)) {
          const prefix = "system.activities.";
          const advancementPrefix = "system.advancement.";
          if (path.startsWith(prefix)) {
            desiredActivities[path.slice(prefix.length)] = value;
            delete additions[path];
          } else if (path.startsWith(advancementPrefix)) {
            desiredAdvancements[path.slice(advancementPrefix.length)] = value;
            delete additions[path];
          }
        }
        const projectActivities = (source: JsonObject): JsonObject | undefined => {
          if (!this.#activitiesDirty) return undefined;
          const raw = valueAt(source, "system.activities");
          const current = raw && !Array.isArray(raw) && typeof raw === "object" ? raw as JsonObject : {};
          const projected = projectMapping(current, this.#baselineActivityIds, desiredActivities, (left, right) => left.type === right.type);
          if (!projected.ok) throw new Error(`activity ${projected.reason}: ${projected.detail}`);
          return projected.value;
        };
        const projectAdvancements = (source: JsonObject): JsonObject | undefined => {
          if (!this.#advancementsDirty) return undefined;
          const raw = valueAt(source, "system.advancement");
          const current = raw && !Array.isArray(raw) && typeof raw === "object" ? raw as JsonObject : {};
          const projected = projectMapping(current, this.#baselineAdvancementIds, desiredAdvancements, (left, right) => left.type === right.type);
          if (!projected.ok) throw new Error(`advancement ${projected.reason}: ${projected.detail}`);
          return projected.value;
        };
        const projectEffects = (source: JsonObject): readonly JsonObject[] | undefined => {
          if (!this.#effectsDirty && !this.#activitiesDirty) return undefined;
          const current = Array.isArray(source.effects)
            ? source.effects.filter((value): value is JsonObject => !!value && !Array.isArray(value) && typeof value === "object")
            : [];
          const desiredRaw = additions.effects;
          const desired = Array.isArray(desiredRaw) ? desiredRaw.filter((value): value is JsonObject => !!value && !Array.isArray(value) && typeof value === "object") : [];
          const projected = projectCollection(current, { baselineModeledIds: this.#baselineEffectIds, desired, compatible: () => true });
          if (!projected.ok) throw new Error(`effect ${projected.reason}: ${projected.detail}`);
          return projected.value;
        };
        let projectedLibraryResults: readonly JsonObject[] | undefined;
        let projectedWorldResults: readonly JsonObject[] | undefined;
        const projectItems = (source: JsonObject): readonly JsonObject[] | undefined => {
          if (!Object.hasOwn(additions, "items")) return undefined;
          const current = Array.isArray(source.items)
            ? source.items.filter((value): value is JsonObject => !!value && !Array.isArray(value) && typeof value === "object")
            : [];
          const desired = (additions.items as readonly JsonValue[]).filter((value): value is JsonObject => !!value && !Array.isArray(value) && typeof value === "object");
          const projected = projectCollection(current, {
            baselineModeledIds: new Set([...this.#baselineActionIds, ...this.#baselineVehicleComponentIds]),
            desired,
            compatible: (left, right) => left.type === right.type,
          });
          if (!projected.ok) throw new Error(`item ${projected.reason}: ${projected.detail}`);
          return projected.value;
        };
        let projectedLibraryItems: readonly JsonObject[] | undefined;
        let projectedWorldItems: readonly JsonObject[] | undefined;
        let projectedLibraryActivities: JsonObject | undefined;
        let projectedWorldActivities: JsonObject | undefined;
        let projectedLibraryEffects: readonly JsonObject[] | undefined;
        let projectedWorldEffects: readonly JsonObject[] | undefined;
        let projectedLibraryAdvancements: JsonObject | undefined;
        let projectedWorldAdvancements: JsonObject | undefined;
        try {
          projectedLibraryResults = projectResults(librarySource);
          projectedWorldResults = projectResults(worldSource);
          projectedLibraryItems = projectItems(librarySource);
          projectedWorldItems = projectItems(worldSource);
          projectedLibraryActivities = projectActivities(librarySource);
          projectedWorldActivities = projectActivities(worldSource);
          projectedLibraryEffects = projectEffects(librarySource);
          projectedWorldEffects = projectEffects(worldSource);
          projectedLibraryAdvancements = projectAdvancements(librarySource);
          projectedWorldAdvancements = projectAdvancements(worldSource);
        } catch (error) {
          context.notify("error", text("EAGLEHOMEBREW.window.notify.editPreflight", { reason: "id-collision", detail: error instanceof Error ? error.message : String(error) }));
          return;
        }

        const sideChanges = (
          source: JsonObject,
          projectedResults: readonly JsonObject[] | undefined,
          projectedItems: readonly JsonObject[] | undefined,
          projectedActivities: JsonObject | undefined,
          projectedEffects: readonly JsonObject[] | undefined,
          projectedAdvancements: JsonObject | undefined,
        ): JsonObject => {
          const changes = { ...commonChanges };
          for (const [path, value] of Object.entries(additions)) {
            if (path === "results" || path === "items" || path === "effects") continue;
            changes[path] = value;
          }
          if (projectedActivities) changes["system.activities"] = projectedActivities;
          if (projectedAdvancements) changes["system.advancement"] = projectedAdvancements;
          if (projectedEffects) changes.effects = projectedEffects;
          if (projectedItems) changes.items = projectedItems;
          if (projectedResults) {
            const results = projectedResults;
            let end = 0;
            changes.results = results.map((raw) => {
              if (!raw || Array.isArray(raw) || typeof raw !== "object") return raw;
              const result = { ...(raw as Record<string, JsonValue>) };
              const weight = typeof result.weight === "number" ? Math.max(1, Math.round(result.weight)) : 1;
              const start = end + 1;
              end += weight;
              result.weight = weight;
              result.range = [start, end];
              return result;
            });
            changes.formula = end > 0 ? `1d${end}` : "";
          }
          return changes;
        };
        const libraryChanges = sideChanges(librarySource, projectedLibraryResults, projectedLibraryItems, projectedLibraryActivities, projectedLibraryEffects, projectedLibraryAdvancements);
        const worldChanges = sideChanges(worldSource, projectedWorldResults, projectedWorldItems, projectedWorldActivities, projectedWorldEffects, projectedWorldAdvancements);
        const savePlan = planSave(libraryChanges, worldChanges, 65_536, session.libraryUuid, session.worldUuid);
        if (!savePlan.ok) {
          context.notify("error", text("EAGLEHOMEBREW.window.notify.editPreflight", { reason: savePlan.reason, detail: savePlan.detail }));
          return;
        }
        const saved = await executeSave(context.sender, session.libraryUuid, session.worldUuid, savePlan);
        if (!saved.ok) {
          context.notify("error", text("EAGLEHOMEBREW.window.notify.editFailed", { side: saved.side, batch: String(saved.batch), reason: saved.reason, detail: saved.detail }));
          return;
        }
        context.notify("info", text(saved.changed ? "EAGLEHOMEBREW.window.notify.saved" : "EAGLEHOMEBREW.window.notify.noChanges"));
        const [freshLibrary, freshWorld] = await Promise.all([
          context.readDocumentSource(session.libraryUuid),
          context.readDocumentSource(session.worldUuid),
        ]);
        if (freshLibrary && freshWorld) this.#editSession = { ...session, librarySource: freshLibrary, worldSource: freshWorld, fallbackUsed: false };
        if (freshLibrary) this.#hydrateActivitiesAndEffects(freshLibrary);
        else {
          this.#drafts = [];
          this.#effectDrafts = [];
          this.#baselineActivityIds.clear();
          this.#baselineEffectIds.clear();
        }
        this.#activitiesDirty = false;
        this.#effectsDirty = false;
        if (freshLibrary) this.#hydrateResults(freshLibrary);
        else {
          this.#resultDrafts = [];
          this.#baselineResultIds.clear();
        }
        this.#resultsDirty = false;
        if (freshLibrary && kind && isAdvancementKind(kind)) this.#hydrateAdvancements(kind, freshLibrary);
        else {
          this.#advancementDrafts = [];
          this.#baselineAdvancementIds.clear();
        }
        this.#advancementsDirty = false;
        if (freshLibrary && entry.key === "npcs") this.#hydrateNpcActions(freshLibrary);
        else {
          this.#actionDrafts = [];
          this.#baselineActionIds.clear();
        }
        this.#actionsDirty = false;
        if (freshLibrary && entry.key === "vehicles") this.#hydrateVehicle(freshLibrary);
        else {
          this.#vehicleComponentDrafts = [];
          this.#baselineVehicleComponentIds.clear();
        }
        this.#vehicleComponentsDirty = false;
        if (freshLibrary && (kind === "encounter" || kind === "group")) this.#hydrateMembers(kind, freshLibrary);
        await this.render();
      } finally {
        this.#setBusy(false);
      }
    }

    #setBusy(busy: boolean): void {
      this.#busy = busy;
      if (this.#nameInput) this.#nameInput.disabled = busy;
      if (this.#createButton) this.#createButton.disabled = busy;
    }

    protected override async _renderHTML(): Promise<HTMLElement> {
      const root = element("div");
      root.classList.add("eagle-homebrew-root");
      if (this.#step.name === "art") root.append(this.#renderArtStep());
      else if (this.#step.name === "subcategory") root.append(this.#renderSubcategoryStep(this.#step.art));
      else root.append(this.#renderFormStep(this.#step.entry));
      return root;
    }

    // M8 rework, live-check finding: every render rebuilds `.eagle-homebrew-root` from scratch (a brand new
    // element, `_renderHTML` above), which used to silently reset scroll to the top on every single click inside
    // the form (e.g. "Add Action") — the same class of bug M7 already had to fix for form *values* (`#captureValues`),
    // now for scroll position. `result` here already carries the `eagle-homebrew-root` class, so it is the element
    // to set `scrollTop` on directly.
    protected override _replaceHTML(result: HTMLElement, content: HTMLElement): void {
      const previousScrollTop = content.querySelector(".eagle-homebrew-root")?.scrollTop ?? 0;
      content.replaceChildren(result);
      result.scrollTop = previousScrollTop;
    }

    #renderArtStep(): HTMLElement {
      const block = element("div");
      block.append(element("p", text("EAGLEHOMEBREW.window.art.title")));
      const list = element("div");
      list.classList.add("eagle-homebrew-choices");
      for (const art of ARTS) {
        const button = element("button", text(ART_LABEL_KEY[art]));
        button.type = "button";
        button.dataset.action = "selectArt";
        button.dataset.art = art;
        list.append(button);
      }
      block.append(list);
      return block;
    }

    #renderSubcategoryStep(art: Art): HTMLElement {
      const block = element("div");
      block.append(this.#renderBackButton());
      block.append(element("p", text(ART_LABEL_KEY[art])));
      const list = element("div");
      list.classList.add("eagle-homebrew-choices");
      for (const entry of subcategoriesOf(art)) {
        const button = element("button", entry.title);
        button.type = "button";
        button.dataset.action = "selectKind";
        button.dataset.key = entry.key;
        list.append(button);
      }
      block.append(list);
      return block;
    }

    #renderFormStep(entry: CatalogEntry): HTMLElement {
      const block = element("div");
      if (!this.#editSession) block.append(this.#renderBackButton());
      block.append(element("h3", entry.title));
      if (this.#editSession) {
        block.append(element("p", text("EAGLEHOMEBREW.window.edit.status", {
          world: this.#editSession.worldUuid,
          library: this.#editSession.libraryUuid,
        })));
        if (this.#editSession.fallbackUsed) block.append(element("p", text("EAGLEHOMEBREW.window.edit.rulesFallback")));
      }
      if (!SIMPLE_KINDS.has(entry.key)) {
        block.append(element("p", text("EAGLEHOMEBREW.window.notBuiltYet", { kind: entry.title })));
        this.#nameInput = undefined;
        this.#createButton = undefined;
        return block;
      }
      const name = fields.createTextInput({ name: "name", value: this.#nameValue, placeholder: text("EAGLEHOMEBREW.window.form.namePlaceholder") });
      const group = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.form.nameLabel"), input: name });
      block.append(group);
      this.#nameInput = name;

      // M8: a kind's own fields, full coverage (N21) — between the name and the Activity builder, `#renderFormStep`'s
      // own natural reading order (identify the object, then describe it, then give it its actions).
      const kind = itemKindFor(entry.key);
      if (kind) block.append(this.#renderItemFieldSections(kind, specForItemKind(kind).fields));
      else this.#itemFieldInputs.clear();

      if (kind === "encounter" || kind === "group") block.append(this.#renderMembersSection(kind));
      if (kind === "vehicle") {
        block.append(this.#renderVehicleDamageSection());
        block.append(this.#renderVehicleRosterSection());
        block.append(this.#renderVehicleComponentsSection());
      }

      if (entry.hasActivities) block.append(this.#renderActivitySection());
      if (entry.hasEffects) block.append(this.#renderEffectsSection());
      // M13: Roll Table has no Activities/Effects (Discover Befund 10) but has its own entries instead.
      if (entry.art === "RollTable") block.append(this.#renderResultsSection());
      // M16b: dnd5e's five AdvancementTemplate kinds share the guided builder. Homebrew calls `race`
      // "species" in its catalog, hence the explicit core type guard rather than comparing document subtypes.
      if (kind && isAdvancementKind(kind)) block.append(this.#renderAdvancementSection(kind));
      // M16a: NPC's own Actions builder (embedded Feat/Weapon items, Discover Befund 1) — its own catalog
      // flag (`hasActions`), independent of `hasActivities`/`hasEffects` (both correctly `false` for
      // every Actor kind, `core/catalog.ts`).
      if (entry.hasActions) block.append(this.#renderNpcActionsSection());

      const create = element("button", text(this.#editSession ? "EAGLEHOMEBREW.window.form.save" : "EAGLEHOMEBREW.window.form.create"));
      create.type = "button";
      create.dataset.action = "create";
      create.disabled = this.#busy;
      block.append(create);
      this.#createButton = create;
      return block;
    }

    #renderMembersSection(kind: "encounter" | "group"): HTMLElement {
      const details = element("details");
      details.open = true;
      details.append(element("summary", text("EAGLEHOMEBREW.window.member.legend")));
      const section = element("fieldset");

      const drafts = this.#memberDrafts.filter((draft) => draft.kind === kind);
      if (drafts.length > 0) {
        const list = element("ul");
        list.classList.add("eagle-homebrew-member-drafts");
        drafts.forEach((draft) => {
          const actualIndex = this.#memberDrafts.indexOf(draft);
          const item = element("li");
          const summary =
            draft.kind === "encounter"
              ? text("EAGLEHOMEBREW.window.member.encounterSummary", { name: draft.name, quantity: String(draft.quantity) })
              : text("EAGLEHOMEBREW.window.member.groupSummary", { name: draft.name, type: pathLabel(draft.actorType) });
          item.append(element("strong", summary));

          const statusKey =
            draft.libraryState === "present"
              ? draft.kind === "encounter" && draft.actorUuid.startsWith("Compendium.")
                ? "EAGLEHOMEBREW.window.member.status.libraryReference"
                : "EAGLEHOMEBREW.window.member.status.libraryPresent"
              : draft.libraryState === "missing"
                ? "EAGLEHOMEBREW.window.member.status.libraryMissing"
                : "EAGLEHOMEBREW.window.member.status.worldOnly";
          item.append(element("p", text(statusKey)));

          if (draft.kind === "encounter" && draft.formula) {
            item.append(element("p", text("EAGLEHOMEBREW.window.member.formulaSummary", { formula: draft.formula })));
          }
          if (draft.kind === "group" && draft.actorType === "vehicle") {
            const primary = element(
              "button",
              text(
                this.#primaryVehicleId === draft.actorId
                  ? "EAGLEHOMEBREW.window.member.clearPrimaryVehicle"
                  : "EAGLEHOMEBREW.window.member.setPrimaryVehicle",
              ),
            );
            primary.type = "button";
            primary.dataset.action = "setPrimaryVehicle";
            primary.dataset.actorId = draft.actorId;
            item.append(primary);
          }
          const remove = element("button", text("EAGLEHOMEBREW.window.member.remove"));
          remove.type = "button";
          remove.dataset.action = "removeMember";
          remove.dataset.index = String(actualIndex);
          item.append(remove);
          list.append(item);
        });
        section.append(list);
      }

      if (!this.#memberBuilderOpen) {
        const add = element("button", text("EAGLEHOMEBREW.window.member.addMember"));
        add.type = "button";
        add.dataset.action = "addMember";
        section.append(add);
      } else {
        const actor = createDocumentPickerInput({
          name: "__memberActor",
          single: true,
          value: this.#memberActorValue || undefined,
          documentType: "Actor",
        });
        this.#memberActorInput = actor;
        section.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.member.actor"), input: actor }));

        if (kind === "encounter") {
          const quantity = fields.createNumberInput({ name: "__memberQuantity", value: persistedNumber(this.#memberQuantityValue) ?? 1 });
          quantity.min = "0";
          quantity.step = "1";
          const formula = fields.createTextInput({ name: "__memberFormula", value: this.#memberFormulaValue, placeholder: "e.g. 1d4" });
          this.#memberQuantityInput = quantity;
          this.#memberFormulaInput = formula;
          section.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.member.quantity"), input: quantity }));
          section.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.member.formula"), input: formula }));
        }

        const confirm = element("button", text("EAGLEHOMEBREW.window.member.add"));
        confirm.type = "button";
        confirm.dataset.action = "confirmMember";
        const cancel = element("button", text("EAGLEHOMEBREW.window.member.cancel"));
        cancel.type = "button";
        cancel.dataset.action = "cancelMember";
        section.append(confirm, cancel);
      }

      details.append(section);
      return details;
    }

    #renderVehicleDamageSection(): HTMLElement {
      const details = element("details");
      details.append(element("summary", text("EAGLEHOMEBREW.window.vehicle.damage.legend")));
      const section = element("fieldset");
      this.#vehicleDamageInputs.clear();
      const damageChoices = { ...choicesFor("damageTypes"), ALL: text("EAGLEHOMEBREW.window.vehicle.damage.all") };
      for (const row of this.#vehicleDamageRows) {
        const persisted = this.#vehicleDamageValues.get(row);
        const block = element("div");
        block.classList.add("eagle-homebrew-damage-modifier");
        const damageType = fields.createSelectInput({
          name: `__vehicleDamageType_${row}`,
          value: persisted?.damageType ?? "",
          options: Object.entries(damageChoices).map(([value, label]) => ({ value, label })),
          blank: "",
        });
        const formula = fields.createTextInput({ name: `__vehicleDamageFormula_${row}`, value: persisted?.formula ?? "", placeholder: FORMULA_PLACEHOLDER });
        this.#vehicleDamageInputs.set(row, { damageType, formula });
        const remove = element("button", text("EAGLEHOMEBREW.window.vehicle.damage.remove"));
        remove.type = "button";
        remove.dataset.action = "removeVehicleDamage";
        remove.dataset.row = String(row);
        block.append(
          fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.vehicle.damage.type"), input: damageType }),
          fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.vehicle.damage.formula"), input: formula }),
          remove,
        );
        section.append(block);
      }
      const add = element("button", text("EAGLEHOMEBREW.window.vehicle.damage.add"));
      add.type = "button";
      add.dataset.action = "addVehicleDamage";
      section.append(add);
      details.append(section);
      return details;
    }

    #renderVehicleRosterSection(): HTMLElement {
      const details = element("details");
      details.open = true;
      details.append(element("summary", text("EAGLEHOMEBREW.window.vehicle.roster.legend")));
      const section = element("fieldset");
      if (this.#vehicleRosterDrafts.length > 0) {
        const list = element("ul");
        this.#vehicleRosterDrafts.forEach((draft, index) => {
          const item = element("li");
          item.append(element("strong", text("EAGLEHOMEBREW.window.vehicle.roster.summary", {
            name: draft.name,
            area: text(`EAGLEHOMEBREW.window.vehicle.roster.area.${draft.area}`),
            quantity: String(draft.quantity),
          })));
          const statusKey = draft.libraryState === "present"
            ? "EAGLEHOMEBREW.window.member.status.libraryReference"
            : draft.libraryState === "missing"
              ? "EAGLEHOMEBREW.window.member.status.libraryMissing"
              : "EAGLEHOMEBREW.window.member.status.worldOnly";
          item.append(element("p", text(statusKey)));
          const remove = element("button", text("EAGLEHOMEBREW.window.member.remove"));
          remove.type = "button";
          remove.dataset.action = "removeVehicleRoster";
          remove.dataset.index = String(index);
          item.append(remove);
          list.append(item);
        });
        section.append(list);
      }
      if (!this.#vehicleRosterBuilderOpen) {
        const add = element("button", text("EAGLEHOMEBREW.window.vehicle.roster.add"));
        add.type = "button";
        add.dataset.action = "addVehicleRoster";
        section.append(add);
      } else {
        const area = fields.createSelectInput({
          name: "__vehicleRosterArea",
          value: this.#vehicleRosterAreaValue,
          options: (["crew", "passengers", "draft"] as const).map((value) => ({ value, label: text(`EAGLEHOMEBREW.window.vehicle.roster.area.${value}`) })),
        });
        const actor = createDocumentPickerInput({ name: "__vehicleRosterActor", single: true, value: this.#vehicleRosterActorValue || undefined, documentType: "Actor" });
        const quantity = fields.createNumberInput({ name: "__vehicleRosterQuantity", value: persistedNumber(this.#vehicleRosterQuantityValue) ?? 1 });
        quantity.min = "1";
        quantity.step = "1";
        this.#vehicleRosterAreaInput = area;
        this.#vehicleRosterActorInput = actor;
        this.#vehicleRosterQuantityInput = quantity;
        section.append(
          fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.vehicle.roster.areaLabel"), input: area }),
          fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.member.actor"), input: actor }),
          fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.member.quantity"), input: quantity }),
        );
        const confirm = element("button", text("EAGLEHOMEBREW.window.member.add"));
        confirm.type = "button";
        confirm.dataset.action = "confirmVehicleRoster";
        const cancel = element("button", text("EAGLEHOMEBREW.window.member.cancel"));
        cancel.type = "button";
        cancel.dataset.action = "cancelVehicleRoster";
        section.append(confirm, cancel);
      }
      details.append(section);
      return details;
    }

    #renderVehicleComponentsSection(): HTMLElement {
      const section = element("fieldset");
      section.append(element("legend", text("EAGLEHOMEBREW.window.vehicle.component.legend")));
      if (this.#vehicleComponentDrafts.length > 0) {
        const list = element("ul");
        this.#vehicleComponentDrafts.forEach((draft, index) => {
          const item = element("li");
          item.append(document.createTextNode(text("EAGLEHOMEBREW.window.vehicle.component.summary", {
            name: draft.name,
            type: text(VEHICLE_COMPONENT_TYPE_LABEL_KEY[draft.type]),
            category: text(VEHICLE_COMPONENT_CATEGORY_LABEL_KEY[vehicleComponentCategory(draft)]),
          })));
          if (this.#editSession) {
            const edit = element("button", text("EAGLEHOMEBREW.window.edit.editRow"));
            edit.type = "button";
            edit.dataset.action = "editVehicleComponent";
            edit.dataset.index = String(index);
            item.append(document.createTextNode(" "), edit);
          }
          const remove = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
          remove.type = "button";
          remove.dataset.action = "removeVehicleComponent";
          remove.dataset.index = String(index);
          item.append(document.createTextNode(" "), remove);
          list.append(item);
        });
        section.append(list);
      }
      if (!this.#vehicleComponentBuilderOpen) {
        const add = element("button", text("EAGLEHOMEBREW.window.vehicle.component.add"));
        add.type = "button";
        add.dataset.action = "addVehicleComponent";
        section.append(add);
        return section;
      }
      if (!this.#vehicleComponentType) {
        section.append(element("p", text("EAGLEHOMEBREW.window.vehicle.component.pickType")));
        for (const type of ["feature", "equipmentStation", "weaponStation"] as const) {
          const button = element("button", text(VEHICLE_COMPONENT_TYPE_LABEL_KEY[type]));
          button.type = "button";
          button.dataset.action = "pickVehicleComponentType";
          button.dataset.componentType = type;
          section.append(button);
        }
        const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
        cancel.type = "button";
        cancel.dataset.action = "cancelVehicleComponent";
        section.append(cancel);
        return section;
      }
      section.append(this.#renderVehicleComponentBuilder(this.#vehicleComponentType));
      return section;
    }

    #renderVehicleComponentBuilder(type: VehicleComponentType): HTMLElement {
      const block = element("div");
      this.#vehicleComponentFieldInputs.clear();
      const name = fields.createTextInput({ name: "__vehicleComponentName", value: this.#vehicleComponentNameValue, placeholder: text("EAGLEHOMEBREW.window.form.namePlaceholder") });
      this.#vehicleComponentNameInput = name;
      block.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.form.nameLabel"), input: name }));

      const componentFields = vehicleComponentFields(type);
      const conditional: { field: ItemField; element: HTMLElement }[] = [];
      const order: readonly ItemField["section"][] = ["core", "uses", "physical", "description", "equippable", "mountable"];
      for (const sectionName of order) {
        const inSection = componentFields.filter((field) => field.section === sectionName);
        if (inSection.length === 0) continue;
        const details = element("details");
        if (sectionName === "core") details.open = true;
        details.append(element("summary", text(ITEM_SECTION_LABEL_KEY[sectionName])));
        const fieldset = element("fieldset");
        for (const field of inSection) {
          const group = this.#renderVehicleComponentFieldGroup(type, field);
          if (field.visibleWhen) conditional.push({ field, element: group });
          fieldset.append(group);
        }
        details.append(fieldset);
        block.append(details);
      }
      this.#wireVehicleComponentVisibility(type, conditional);
      if (type !== "feature") block.append(this.#renderVehicleStationCrew());
      block.append(this.#renderVehicleComponentActivityBlock());

      const preview = element("p");
      const refreshPreview = (): void => {
        const activation = this.#vehicleComponentActivityFieldInputs.get("activation.type")?.value;
        const category = vehicleComponentCategory({ type, ...(this.#vehicleComponentActivityType ? { activity: { type: this.#vehicleComponentActivityType, values: { "activation.type": activation ?? "" } } } : {}) });
        preview.textContent = text("EAGLEHOMEBREW.window.vehicle.component.preview", { category: text(VEHICLE_COMPONENT_CATEGORY_LABEL_KEY[category]) });
      };
      refreshPreview();
      this.#vehicleComponentActivityFieldInputs.get("activation.type")?.addEventListener("change", refreshPreview);
      block.append(preview);

      const confirm = element("button", text("EAGLEHOMEBREW.window.action.confirm"));
      confirm.type = "button";
      confirm.dataset.action = "confirmVehicleComponent";
      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelVehicleComponent";
      block.append(confirm, cancel);
      return block;
    }

    #renderVehicleComponentFieldGroup(type: VehicleComponentType, field: ItemField): HTMLElement {
      const labelKind: ItemKind = type === "feature" ? "feat" : type === "equipmentStation" ? "equipment" : "weapon";
      if (field.widget === "weaponDamagePart") {
        const wrapper = element("div");
        wrapper.append(element("h4", itemFieldLabel(labelKind, field)));
        wrapper.append(this.#renderItemDamagePartField(field, this.#vehicleComponentFieldValues, this.#vehicleComponentFieldInputs));
        return wrapper;
      }
      if (field.widget === "dependentSubtypeSelect") {
        const input = renderFieldWidget(field, this.#vehicleComponentFieldValues.get(field.path), this.#vehicleComponentFieldInputs) as HTMLSelectElement;
        const refresh = (): void => this.#refreshVehicleComponentSubtype(field, input);
        refresh();
        this.#vehicleComponentFieldInputs.get("type.value")?.addEventListener("change", refresh);
        return fields.createFormGroup({ label: itemFieldLabel(labelKind, field), input });
      }
      const input = renderFieldWidget(field, this.#vehicleComponentFieldValues.get(field.path), this.#vehicleComponentFieldInputs);
      return fields.createFormGroup({ label: itemFieldLabel(labelKind, field), input });
    }

    #refreshVehicleComponentSubtype(field: ItemField, select: HTMLSelectElement): void {
      if (this.#vehicleComponentFieldInputs.get(field.path) !== select) return;
      const catalog = field.choicesKind as SubtypeCatalog | undefined;
      if (!catalog) return;
      const typeValue = this.#vehicleComponentFieldInputs.get("type.value")?.value ?? "";
      const current = select.value;
      select.replaceChildren(element("option"));
      for (const [value, label] of Object.entries(dependentSubtypeOptionsFor(catalog, typeValue))) {
        const option = element("option", label);
        option.value = value;
        option.selected = value === current;
        select.append(option);
      }
    }

    #wireVehicleComponentVisibility(
      type: VehicleComponentType,
      conditional: readonly { readonly field: ItemField; readonly element: HTMLElement }[],
    ): void {
      if (conditional.length === 0) return;
      const refresh = (): void => {
        const forcedType = type === "equipmentStation" ? "vehicle" : type === "weaponStation" ? "siege" : undefined;
        const contextValue: ItemFieldVisibilityContext = {
          properties: new Set(readList(this.#vehicleComponentFieldInputs.get("properties"))),
          typeValue: forcedType ?? this.#vehicleComponentFieldInputs.get("type.value")?.value ?? "",
          typeSubtype: this.#vehicleComponentFieldInputs.get("type.subtype")?.value,
        };
        for (const entry of conditional) entry.element.hidden = entry.field.visibleWhen ? !entry.field.visibleWhen(contextValue) : false;
      };
      refresh();
      this.#vehicleComponentFieldInputs.get("properties")?.addEventListener("change", refresh);
      this.#vehicleComponentFieldInputs.get("type.value")?.addEventListener("change", refresh);
      this.#vehicleComponentFieldInputs.get("type.subtype")?.addEventListener("change", refresh);
    }

    #renderVehicleStationCrew(): HTMLElement {
      const fieldset = element("fieldset");
      fieldset.append(element("legend", text("EAGLEHOMEBREW.window.vehicle.component.crewLegend")));
      this.#vehicleComponentCrewInputs.clear();
      const crew = this.#vehicleRosterDrafts.filter((draft) => draft.area === "crew");
      if (crew.length === 0) fieldset.append(element("p", text("EAGLEHOMEBREW.window.vehicle.component.noCrew")));
      for (const member of crew) {
        const input = fields.createNumberInput({
          name: `__vehicleComponentCrew_${member.actorUuid}`,
          value: persistedNumber(this.#vehicleComponentCrewValues.get(member.actorUuid)) ?? 0,
        });
        input.min = "0";
        input.max = String(member.quantity);
        input.step = "1";
        this.#vehicleComponentCrewInputs.set(member.actorUuid, input);
        fieldset.append(fields.createFormGroup({ label: `${member.name} (max ${member.quantity})`, input }));
      }
      return fieldset;
    }

    #renderVehicleComponentActivityBlock(): HTMLElement {
      const wrapper = element("div");
      wrapper.append(element("h4", text("EAGLEHOMEBREW.window.action.activityHeading")));
      if (!this.#vehicleComponentActivityType) {
        wrapper.append(element("p", text("EAGLEHOMEBREW.window.action.noActivityHint")));
        for (const type of ACTIVITY_TYPES_ORDER) {
          const button = element("button", text(ACTIVITY_TYPE_LABEL_KEY[type]));
          button.type = "button";
          button.dataset.action = "pickVehicleComponentActivityType";
          button.dataset.type = type;
          wrapper.append(button);
        }
        return wrapper;
      }
      this.#vehicleComponentActivityFieldInputs.clear();
      const spec = specFor(this.#vehicleComponentActivityType);
      const basic = spec.fields.filter((field) => field.group === "basic" && field.path !== "effects");
      const advanced = spec.fields.filter((field) => field.group === "advanced" && field.path !== "effects");
      for (const field of basic) wrapper.append(this.#renderActivityFieldGroup(field, this.#vehicleComponentActivityFieldValues, this.#vehicleComponentActivityFieldInputs));
      if (advanced.length > 0) {
        const details = element("details");
        details.append(element("summary", text("EAGLEHOMEBREW.window.activity.moreFields")));
        for (const field of advanced) details.append(this.#renderActivityFieldGroup(field, this.#vehicleComponentActivityFieldValues, this.#vehicleComponentActivityFieldInputs));
        wrapper.append(details);
      }
      const remove = element("button", text("EAGLEHOMEBREW.window.action.removeActivity"));
      remove.type = "button";
      remove.dataset.action = "removeVehicleComponentActivity";
      wrapper.append(remove);
      return wrapper;
    }

    // The Activity-/Effekt-Baustein (M5-M7): the list of already-added drafts, then either the "Add Action" button
    // or (while the builder is open) the type picker / the sub-form for the chosen type. New territory (M7 Discover,
    // Befund 3 — no earlier repeatable-list UI in this project). One button, not two (M7 rework, live-check
    // feedback): "Action" vs. "Bonus Action" vs. every other activation type is already the first field of the
    // sub-form itself (`activation.type`); a second entry-point button added nothing a dropdown does not.
    #renderActivitySection(): HTMLElement {
      const section = element("fieldset");
      section.append(element("legend", text("EAGLEHOMEBREW.window.activity.legend")));
      section.append(element("p", text("EAGLEHOMEBREW.window.activity.manualHint")));

      if (this.#drafts.length > 0) {
        const list = element("ul");
        list.classList.add("eagle-homebrew-activity-drafts");
        this.#drafts.forEach((draft, index) => {
          const item = element("li");
          const activation =
            draft.values["activation.type"] === "bonus" ? text("EAGLEHOMEBREW.window.activity.activationBonus") : text("EAGLEHOMEBREW.window.activity.activationAction");
          item.append(document.createTextNode(`${text(ACTIVITY_TYPE_LABEL_KEY[draft.type])} (${activation})${draft.effect ? ` + ${draft.effect.name}` : ""}`));
          if (this.#editSession) {
            const edit = element("button", text("EAGLEHOMEBREW.window.edit.editRow"));
            edit.type = "button";
            edit.dataset.action = "editDraft";
            edit.dataset.index = String(index);
            item.append(document.createTextNode(" "), edit);
          }
          const remove = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
          remove.type = "button";
          remove.dataset.action = "removeDraft";
          remove.dataset.index = String(index);
          item.append(document.createTextNode(" "), remove);
          list.append(item);
        });
        section.append(list);
      }

      if (!this.#builderOpen) {
        const addAction = element("button", text("EAGLEHOMEBREW.window.activity.addAction"));
        addAction.type = "button";
        addAction.dataset.action = "addAction";
        section.append(addAction);
        return section;
      }

      if (!this.#builderType) {
        section.append(this.#renderActivityTypePicker());
        return section;
      }

      section.append(this.#renderActivityBuilder(this.#builderType));
      return section;
    }

    // M11b: standalone effects — a plain permanent bonus, no Activity involved (dadm/m11-05-live-check-output.md,
    // Fund 4). Same list-then-button-or-form shape as `#renderActivitySection` above, but there is no type to pick:
    // "Add Effect" goes straight to the name+change-rows sub-form (`#renderStandaloneEffectFields`).
    #renderEffectsSection(): HTMLElement {
      const section = element("fieldset");
      section.append(element("legend", text("EAGLEHOMEBREW.window.effect.legend")));

      if (this.#effectDrafts.length > 0) {
        const list = element("ul");
        list.classList.add("eagle-homebrew-effect-drafts");
        this.#effectDrafts.forEach((draft, index) => {
          const item = element("li");
          item.append(document.createTextNode(text("EAGLEHOMEBREW.window.effect.draftSummary", { name: draft.name, count: String(draft.changes.length) })));
          if (this.#editSession) {
            const edit = element("button", text("EAGLEHOMEBREW.window.edit.editRow"));
            edit.type = "button";
            edit.dataset.action = "editEffectDraft";
            edit.dataset.index = String(index);
            item.append(document.createTextNode(" "), edit);
          }
          const remove = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
          remove.type = "button";
          remove.dataset.action = "removeEffectDraft";
          remove.dataset.index = String(index);
          item.append(document.createTextNode(" "), remove);
          list.append(item);
        });
        section.append(list);
      }

      if (!this.#effectBuilderOpen) {
        const addEffect = element("button", text("EAGLEHOMEBREW.window.effect.addEffect"));
        addEffect.type = "button";
        addEffect.dataset.action = "addEffect";
        section.append(addEffect);
        return section;
      }

      section.append(this.#renderStandaloneEffectFields());
      return section;
    }

    // The same name+change-rows shape as `#renderEffectSection`'s inner half (kept separate rather than shared,
    // M11b Apply Entscheidung 2: the two flows differ enough — one nested inside an Activity's own optional toggle,
    // this one always shown once opened, with its own action names for row add/remove — that sharing would need
    // more parameters than the duplicated lines are worth; kept in sync by hand like other small, deliberate
    // duplications in this project, e.g. core/name-key.ts across repos). The row itself, `#renderEffectChangeRow`,
    // IS shared (M11c): its curated picker is too involved to duplicate a second time.
    #renderStandaloneEffectFields(): HTMLElement {
      const block = element("div");
      const name = fields.createTextInput({
        name: "__standaloneEffectName",
        value: this.#effectBuilderNameValue,
        placeholder: text("EAGLEHOMEBREW.window.activity.effectNamePlaceholder"),
      });
      this.#effectBuilderNameInput = name;
      block.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.effectName"), input: name }));

      this.#effectBuilderChangeInputs.clear();
      for (const row of this.#effectBuilderChangeRows) {
        block.append(this.#renderEffectChangeRow(row, this.#effectBuilderChangeValues.get(row), this.#effectBuilderChangeInputs, "removeStandaloneEffectChange"));
      }
      const addRow = element("button", text("EAGLEHOMEBREW.window.activity.addChange"));
      addRow.type = "button";
      addRow.dataset.action = "addStandaloneEffectChange";
      block.append(addRow);

      const confirm = element("button", text("EAGLEHOMEBREW.window.effect.confirm"));
      confirm.type = "button";
      confirm.dataset.action = "confirmEffect";
      block.append(confirm);

      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelEffect";
      block.append(cancel);

      return block;
    }

    // M13 (dadm/m13-02-apply-output.md, Entscheidungen 2-4): Roll Table's own entries, same
    // list-then-button-or-form shape as `#renderEffectsSection`, simpler still — a table entry has
    // no type to pick and no change rows, just its own text and weight. `range`/`formula` are never
    // shown here: they are derived from the weights when the object is created (`core/table-result.ts`),
    // not entered.
    #renderResultsSection(): HTMLElement {
      const section = element("fieldset");
      section.append(element("legend", text("EAGLEHOMEBREW.window.result.legend")));

      if (this.#resultDrafts.length > 0) {
        const list = element("ul");
        list.classList.add("eagle-homebrew-result-drafts");
        this.#resultDrafts.forEach((draft, index) => {
          const item = element("li");
          item.append(document.createTextNode(text("EAGLEHOMEBREW.window.result.draftSummary", { text: draft.text, weight: String(draft.weight) })));
          if (this.#editSession) {
            const edit = element("button", text("EAGLEHOMEBREW.window.edit.editRow"));
            edit.type = "button";
            edit.dataset.action = "editResultDraft";
            edit.dataset.index = String(index);
            item.append(document.createTextNode(" "), edit);
          }
          const remove = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
          remove.type = "button";
          remove.dataset.action = "removeResultDraft";
          remove.dataset.index = String(index);
          item.append(document.createTextNode(" "), remove);
          list.append(item);
        });
        section.append(list);
      }

      if (!this.#resultBuilderOpen) {
        const addResult = element("button", text("EAGLEHOMEBREW.window.result.addResult"));
        addResult.type = "button";
        addResult.dataset.action = "addResult";
        section.append(addResult);
        return section;
      }

      section.append(this.#renderResultBuilderFields());
      return section;
    }

    #renderResultBuilderFields(): HTMLElement {
      const block = element("div");
      const textInput = fields.createTextInput({
        name: "__resultText",
        value: this.#resultBuilderTextValue,
        placeholder: text("EAGLEHOMEBREW.window.result.textPlaceholder"),
      });
      this.#resultBuilderTextInput = textInput;
      block.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.result.textLabel"), input: textInput }));

      const weightInput = fields.createNumberInput({ name: "__resultWeight", value: persistedNumber(this.#resultBuilderWeightValue) ?? 1 });
      this.#resultBuilderWeightInput = weightInput;
      block.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.result.weightLabel"), input: weightInput }));

      const confirm = element("button", text("EAGLEHOMEBREW.window.result.confirm"));
      confirm.type = "button";
      confirm.dataset.action = "confirmResult";
      block.append(confirm);

      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelResult";
      block.append(cancel);

      return block;
    }

    // M14/M16b: guided Advancement entries for every supported Item kind, list-then-button-or-form like
    // `#renderActivitySection`. The button opens a kind-filtered type picker first because each modelled
    // type has its own configuration shape (`core/advancement-model.ts`).
    #renderAdvancementSection(kind: AdvancementKind): HTMLElement {
      const section = element("fieldset");
      section.append(element("legend", text("EAGLEHOMEBREW.window.advancement.legend")));

      if (this.#advancementDrafts.length > 0) {
        const list = element("ul");
        list.classList.add("eagle-homebrew-advancement-drafts");
        this.#advancementDrafts.forEach((draft, index) => {
          const item = element("li");
          const summary = draft.level !== undefined
            ? text("EAGLEHOMEBREW.window.advancement.draftSummaryWithLevel", { type: text(ADVANCEMENT_TYPE_LABEL_KEY[draft.type]), level: String(draft.level) })
            : text(ADVANCEMENT_TYPE_LABEL_KEY[draft.type]);
          item.append(document.createTextNode(summary));
          if (this.#editSession) {
            const edit = element("button", text("EAGLEHOMEBREW.window.edit.editRow"));
            edit.type = "button";
            edit.dataset.action = "editAdvancementDraft";
            edit.dataset.index = String(index);
            item.append(document.createTextNode(" "), edit);
          }
          const remove = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
          remove.type = "button";
          remove.dataset.action = "removeAdvancementDraft";
          remove.dataset.index = String(index);
          item.append(document.createTextNode(" "), remove);
          list.append(item);
        });
        section.append(list);
      }

      if (!this.#advancementBuilderOpen) {
        const add = element("button", text("EAGLEHOMEBREW.window.advancement.addAdvancement"));
        add.type = "button";
        add.dataset.action = "addAdvancement";
        section.append(add);
        return section;
      }

      if (!this.#advancementBuilderType) {
        section.append(this.#renderAdvancementTypePicker(kind));
        return section;
      }

      section.append(this.#renderAdvancementBuilder(this.#advancementBuilderType));
      return section;
    }

    #renderAdvancementTypePicker(kind: AdvancementKind): HTMLElement {
      const wrapper = element("div");
      wrapper.append(element("p", text("EAGLEHOMEBREW.window.advancement.pickType")));
      for (const type of advancementTypesFor(kind, this.#advancementDrafts.map((draft) => draft.type))) {
        const button = element("button", text(ADVANCEMENT_TYPE_LABEL_KEY[type]));
        button.type = "button";
        button.dataset.action = "pickAdvancementType";
        button.dataset.type = type;
        wrapper.append(button);
      }
      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelAdvancement";
      wrapper.append(cancel);
      return wrapper;
    }

    #renderAdvancementBuilder(type: AdvancementType): HTMLElement {
      const block = element("div");
      this.#advancementFieldInputs.clear();
      const spec = specForAdvancement(type);

      if (spec.hasLevel) {
        const levelInput = fields.createNumberInput({ name: "__advancementLevel", value: persistedNumber(this.#advancementLevelValue) });
        this.#advancementLevelInput = levelInput;
        block.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.advancement.level"), input: levelInput }));
      }

      // M14 live-check rework, Fund 3: ScaleValue's "Distance Units" field only means anything for `type:
      // "distance"` — shown unconditionally before, one more field a Homebrewer had to puzzle over. Collected
      // here alongside the table's own per-row groups so one shared toggle (`#wireScaleValueVisibility`)
      // covers both instead of two separate mechanisms.
      const scaleGroups: { readonly element: HTMLElement; readonly types: readonly string[] }[] = [];
      const itemChoiceGroups = new Map<string, HTMLElement>();
      for (const field of spec.fields) {
        const group = this.#renderAdvancementFieldGroup(type, field);
        if (type === "ScaleValue" && field.path === "distance.units") scaleGroups.push({ element: group, types: ["distance"] });
        if (type === "ItemChoice") itemChoiceGroups.set(field.path, group);
        block.append(group);
      }

      const tableKey = ADVANCEMENT_TABLES[type];
      if (tableKey) block.append(this.#renderAdvancementTable(type, tableKey, scaleGroups));
      if (type === "ScaleValue") this.#wireScaleValueVisibility(scaleGroups);
      if (type === "ItemChoice") this.#wireItemChoiceVisibility(itemChoiceGroups);

      const confirm = element("button", text("EAGLEHOMEBREW.window.advancement.add"));
      confirm.type = "button";
      confirm.dataset.action = "confirmAdvancement";
      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelAdvancement";
      block.append(confirm, document.createTextNode(" "), cancel);
      return block;
    }

    #renderAdvancementFieldGroup(type: AdvancementType, field: AdvancementField): HTMLElement {
      let input: HTMLElement;
      if (type === "ItemChoice" && field.path === "restriction.subtype") {
        const category = this.#advancementFieldValues.get("restriction.type");
        const persisted = this.#advancementFieldValues.get(field.path);
        const options = Object.entries(dependentSubtypeOptionsFor("featureTypes", typeof category === "string" ? category : "")).map(([value, label]) => ({ value, label }));
        const select = fields.createSelectInput({ name: field.path, value: typeof persisted === "string" ? persisted : "", options, blank: "" });
        this.#advancementFieldInputs.set(field.path, select);
        input = select;
      } else {
        input = renderFieldWidget(field, this.#advancementFieldValues.get(field.path), this.#advancementFieldInputs);
      }
      const group = fields.createFormGroup({ label: advancementFieldLabel(type, field), input });
      // M14 live-check rework, Runde 2: Trait's `grants` is the one Advancement field this guided picker
      // covers directly (its own top-level field, not inside a table row like ItemChoice/Trait's own
      // `choices[].pool`, wired separately in `#renderAdvancementTableRow`).
      if (field.path === "grants" && field.widget === "set") {
        const wrapper = element("div");
        wrapper.append(group, renderTraitTargetPicker(input as HTMLInputElement));
        return wrapper;
      }
      return group;
    }

    // ItemChoice has one item-type field and two mutually exclusive groups of restrictions. dnd5e uses
    // `restriction.type/subtype` for Feature categories, while Spell uses `restriction.level/list` and
    // the spell sub-configuration. Keep every input mounted, toggle only its FormGroup, and clear values
    // that stop applying when the user changes the item type.
    #wireItemChoiceVisibility(groups: ReadonlyMap<string, HTMLElement>): void {
      const typeInput = this.#advancementFieldInputs.get("type") as HTMLSelectElement | undefined;
      const categoryInput = this.#advancementFieldInputs.get("restriction.type") as HTMLSelectElement | undefined;
      const subtypeInput = this.#advancementFieldInputs.get("restriction.subtype") as HTMLSelectElement | undefined;
      if (!typeInput || !categoryInput || !subtypeInput) return;

      const clearInput = (path: string): void => {
        const input = this.#advancementFieldInputs.get(path);
        if (!input) return;
        const current: unknown = input.value;
        (input as unknown as { value: string | string[] }).value = Array.isArray(current) ? [] : "";
      };
      const refreshSubtypes = (): void => {
        const options = dependentSubtypeOptionsFor("featureTypes", categoryInput.value);
        const current = subtypeInput.value;
        subtypeInput.replaceChildren(element("option"));
        for (const [value, label] of Object.entries(options)) {
          const option = element("option", label);
          option.value = value;
          if (value === current) option.selected = true;
          subtypeInput.append(option);
        }
        if (!(current in options)) subtypeInput.value = "";
        const subtypeGroup = groups.get("restriction.subtype");
        if (subtypeGroup) subtypeGroup.hidden = typeInput.value !== "feat" || Object.keys(options).length === 0;
      };
      const refreshVisibility = (): void => {
        const isFeat = typeInput.value === "feat";
        const isSpell = typeInput.value === "spell";
        const featureGroup = groups.get("restriction.type");
        if (featureGroup) featureGroup.hidden = !isFeat;
        for (const path of ["restriction.level", "restriction.list", "spell"]) {
          const group = groups.get(path);
          if (group) group.hidden = !isSpell;
        }
        refreshSubtypes();
      };
      typeInput.addEventListener("change", () => {
        if (typeInput.value !== "feat") {
          clearInput("restriction.type");
          clearInput("restriction.subtype");
        }
        if (typeInput.value !== "spell") {
          clearInput("restriction.level");
          clearInput("restriction.list");
          clearInput("spell");
        }
        refreshVisibility();
      });
      categoryInput.addEventListener("change", refreshSubtypes);
      refreshVisibility();
    }

    // M14 Apply Entscheidung 8: the one nested, level- or count-keyed table three Advancement types have
    // (`ItemChoice.choices`, `ScaleValue.scale`, `Trait.choices`) — a small bespoke composite per type, the
    // same treatment `#renderPartField` already gives Weapon's damage parts, rather than a forced-generic
    // abstraction across three genuinely different row shapes.
    // M14 live-check rework, Fund 2: a raw `addEventListener("change", () => void this.render())` on the
    // "type" select (tried first) broke the whole sub-form — a full ApplicationV2 re-render triggered from a
    // manually attached native listener fights the framework's own render lifecycle, unlike a render
    // triggered through its `data-action` dispatch (every other re-render in this file goes through that).
    // Fixed the same way `#wireConditionalVisibility`/`#renderEffectChangeRow`'s own `refresh()` already solve
    // an equivalent problem: render every shape up front, toggle `.hidden` directly, no re-render. `scaleGroups`
    // is shared with `#renderAdvancementBuilder` so the same toggle also covers the "Distance Units" field.
    #renderAdvancementTable(
      type: AdvancementType,
      configKey: string,
      scaleGroups: { readonly element: HTMLElement; readonly types: readonly string[] }[],
    ): HTMLElement {
      const wrapper = element("fieldset");
      wrapper.append(element("legend", text(ADVANCEMENT_TABLE_LEGEND_KEY[type] ?? configKey)));
      this.#advancementTableInputs.clear();
      for (const row of this.#advancementTableRows) wrapper.append(this.#renderAdvancementTableRow(type, row, scaleGroups));
      const addRow = element("button", text("EAGLEHOMEBREW.window.advancement.addRow"));
      addRow.type = "button";
      addRow.dataset.action = "addAdvancementTableRow";
      wrapper.append(addRow);
      return wrapper;
    }

    // See the note on `#renderAdvancementTable` above: toggles which of ScaleValue's three value shapes
    // (dice/text/number) is visible per row, driven directly by the "type" select already rendered by
    // `#renderAdvancementFieldGroup` — no re-render, so nothing else in the open builder is ever disturbed.
    #wireScaleValueVisibility(groups: readonly { readonly element: HTMLElement; readonly types: readonly string[] }[]): void {
      const typeInput = this.#advancementFieldInputs.get("type") as HTMLSelectElement | undefined;
      if (!typeInput || groups.length === 0) return;
      const refresh = (): void => {
        const current = typeInput.value || "string";
        for (const group of groups) group.element.hidden = !group.types.includes(current);
      };
      refresh();
      typeInput.addEventListener("change", refresh);
    }

    #renderAdvancementTableRow(
      type: AdvancementType,
      row: number,
      scaleGroups?: { readonly element: HTMLElement; readonly types: readonly string[] }[],
    ): HTMLElement {
      const rowBlock = element("div");
      rowBlock.classList.add("eagle-homebrew-advancement-row");
      const persisted = this.#advancementTableValues.get(row) ?? {};
      const rowInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
      const addColumn = (key: string, labelKey: string, input: HTMLInputElement | HTMLSelectElement): HTMLElement => {
        rowInputs.set(key, input);
        const group = fields.createFormGroup({ label: text(labelKey), input });
        rowBlock.append(group);
        return group;
      };

      if (type === "ItemChoice") {
        addColumn("level", "EAGLEHOMEBREW.window.advancement.table.level", fields.createNumberInput({ name: `__advTable_${row}_level`, value: persistedNumber(persisted.level) }));
        addColumn("count", "EAGLEHOMEBREW.window.advancement.table.count", fields.createNumberInput({ name: `__advTable_${row}_count`, value: persistedNumber(persisted.count) }));
        addColumn("replacement", "EAGLEHOMEBREW.window.advancement.table.replacement", fields.createCheckboxInput({ name: `__advTable_${row}_replacement`, value: persisted.replacement === true }));
      } else if (type === "Trait") {
        addColumn("count", "EAGLEHOMEBREW.window.advancement.table.count", fields.createNumberInput({ name: `__advTable_${row}_count`, value: persistedNumber(persisted.count) ?? 1 }));
        const poolInput = fields.createTextInput({ name: `__advTable_${row}_pool`, value: typeof persisted.pool === "string" ? persisted.pool : "", placeholder: "saves:str, skills:ath" });
        addColumn("pool", "EAGLEHOMEBREW.window.advancement.table.pool", poolInput);
        rowBlock.append(renderTraitTargetPicker(poolInput));
      } else if (type === "ScaleValue") {
        addColumn("level", "EAGLEHOMEBREW.window.advancement.table.level", fields.createNumberInput({ name: `__advTable_${row}_level`, value: persistedNumber(persisted.level) }));
        // All three shapes render together; `#wireScaleValueVisibility` shows only the one matching the
        // current "type" selection. Reading (`#readAdvancementTable`) looks at the same "type" value to pick
        // which of these three keys to actually use, so a hidden group's leftover value is simply ignored.
        const textGroup = addColumn(
          "valueText",
          "EAGLEHOMEBREW.window.advancement.table.value",
          fields.createTextInput({ name: `__advTable_${row}_valueText`, value: typeof persisted.valueText === "string" ? persisted.valueText : "" }),
        );
        scaleGroups?.push({ element: textGroup, types: ["string"] });
        const numberGroup = addColumn(
          "valueNumber",
          "EAGLEHOMEBREW.window.advancement.table.value",
          fields.createNumberInput({ name: `__advTable_${row}_valueNumber`, value: persistedNumber(persisted.valueNumber) }),
        );
        scaleGroups?.push({ element: numberGroup, types: ["number", "cr", "distance"] });
        const diceNumberGroup = addColumn(
          "number",
          "EAGLEHOMEBREW.window.advancement.table.diceNumber",
          fields.createNumberInput({ name: `__advTable_${row}_number`, value: persistedNumber(persisted.number) }),
        );
        const diceFacesGroup = addColumn(
          "faces",
          "EAGLEHOMEBREW.window.advancement.table.diceFaces",
          fields.createNumberInput({ name: `__advTable_${row}_faces`, value: persistedNumber(persisted.faces) }),
        );
        scaleGroups?.push({ element: diceNumberGroup, types: ["dice"] }, { element: diceFacesGroup, types: ["dice"] });
      }

      this.#advancementTableInputs.set(row, rowInputs);
      const remove = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
      remove.type = "button";
      remove.dataset.action = "removeAdvancementTableRow";
      remove.dataset.row = String(row);
      rowBlock.append(remove);
      return rowBlock;
    }

    // Reads the currently open type's table (if it has one) back into the shape `core/advancement-model.ts`
    // expects to merge into `configuration` — a row with nothing meaningful entered is skipped rather than
    // written as an empty object (the same "empty means nothing to say" rule the rest of this file follows).
    #readAdvancementTable(type: AdvancementType): Record<string, JsonValue> {
      const key = ADVANCEMENT_TABLES[type];
      if (!key) return {};
      if (type === "Trait") {
        const list: JsonValue[] = [];
        for (const row of this.#advancementTableRows) {
          const inputs = this.#advancementTableInputs.get(row);
          if (!inputs) continue;
          const count = readNumber(inputs.get("count") as HTMLInputElement | undefined);
          const pool = readList(inputs.get("pool"));
          if (count === undefined && pool.length === 0) continue;
          list.push({ ...(count !== undefined ? { count } : {}), ...(pool.length > 0 ? { pool } : {}) });
        }
        return list.length > 0 ? { [key]: list } : {};
      }
      const mapping: Record<string, JsonValue> = {};
      for (const row of this.#advancementTableRows) {
        const inputs = this.#advancementTableInputs.get(row);
        if (!inputs) continue;
        const level = readNumber(inputs.get("level") as HTMLInputElement | undefined);
        if (level === undefined) continue;
        if (type === "ItemChoice") {
          const count = readNumber(inputs.get("count") as HTMLInputElement | undefined);
          const replacement = (inputs.get("replacement") as HTMLInputElement | undefined)?.checked === true;
          mapping[String(level)] = { ...(count !== undefined ? { count } : {}), ...(replacement ? { replacement } : {}) };
        } else if (type === "ScaleValue") {
          const scaleType = (this.#advancementFieldInputs.get("type") as HTMLSelectElement | undefined)?.value ?? "string";
          if (scaleType === "dice") {
            const number = readNumber(inputs.get("number") as HTMLInputElement | undefined);
            const faces = readNumber(inputs.get("faces") as HTMLInputElement | undefined);
            if (faces === undefined) continue;
            mapping[String(level)] = { ...(number !== undefined ? { number } : {}), faces };
          } else if (scaleType === "string") {
            const value = (inputs.get("valueText") as HTMLInputElement | undefined)?.value ?? "";
            if (value === "") continue;
            mapping[String(level)] = { value };
          } else {
            const value = readNumber(inputs.get("valueNumber") as HTMLInputElement | undefined);
            if (value === undefined) continue;
            mapping[String(level)] = { value };
          }
        }
      }
      return Object.keys(mapping).length > 0 ? { [key]: mapping } : {};
    }

    // M16a (dadm/m16a-02-apply-output.md): NPC's own Actions builder — the list of already-added drafts,
    // then either the "Add Action" button, the item-type picker (Feat/Weapon), or the sub-form for the
    // chosen type. Same list-then-button-or-form shape as `#renderActivitySection`, one extra picker step
    // (Item type) before the Activity type/fields, since an Action is an Item that optionally carries one.
    #renderNpcActionsSection(): HTMLElement {
      const section = element("fieldset");
      section.append(element("legend", text("EAGLEHOMEBREW.window.action.legend")));

      if (this.#actionDrafts.length > 0) {
        const list = element("ul");
        list.classList.add("eagle-homebrew-action-drafts");
        this.#actionDrafts.forEach((draft, index) => {
          const item = element("li");
          const itemTypeLabel = text(draft.itemType === "feat" ? "EAGLEHOMEBREW.window.action.itemTypeFeat" : "EAGLEHOMEBREW.window.action.itemTypeWeapon");
          const category = npcActionCategory(
            npcActionDraftHasTraitProperty(draft.itemFieldValues),
            typeof draft.activity?.values["activation.type"] === "string" ? (draft.activity.values["activation.type"] as string) : undefined,
          );
          item.append(document.createTextNode(`${draft.name} (${itemTypeLabel}, ${text(NPC_ACTION_CATEGORY_LABEL_KEY[category])})`));
          if (this.#editSession) {
            const edit = element("button", text("EAGLEHOMEBREW.window.edit.editRow"));
            edit.type = "button";
            edit.dataset.action = "editNpcActionDraft";
            edit.dataset.index = String(index);
            item.append(document.createTextNode(" "), edit);
          }
          const remove = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
          remove.type = "button";
          remove.dataset.action = "removeNpcActionDraft";
          remove.dataset.index = String(index);
          item.append(document.createTextNode(" "), remove);
          list.append(item);
        });
        section.append(list);
      }

      if (!this.#actionBuilderOpen) {
        const addAction = element("button", text("EAGLEHOMEBREW.window.action.addAction"));
        addAction.type = "button";
        addAction.dataset.action = "addNpcAction";
        section.append(addAction);
        return section;
      }

      if (!this.#actionBuilderItemType) {
        section.append(this.#renderNpcActionItemTypePicker());
        return section;
      }

      section.append(this.#renderNpcActionBuilder(this.#actionBuilderItemType));
      return section;
    }

    #renderNpcActionItemTypePicker(): HTMLElement {
      const block = element("div");
      block.append(element("p", text("EAGLEHOMEBREW.window.action.pickItemType")));
      const feat = element("button", text("EAGLEHOMEBREW.window.action.itemTypeFeat"));
      feat.type = "button";
      feat.dataset.action = "pickNpcActionItemType";
      feat.dataset.itemType = "feat";
      const weapon = element("button", text("EAGLEHOMEBREW.window.action.itemTypeWeapon"));
      weapon.type = "button";
      weapon.dataset.action = "pickNpcActionItemType";
      weapon.dataset.itemType = "weapon";
      block.append(feat, weapon);
      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelNpcAction";
      block.append(cancel);
      return block;
    }

    #renderNpcActionBuilder(itemType: NpcActionItemType): HTMLElement {
      const block = element("div");
      this.#actionFieldInputs.clear();
      const name = fields.createTextInput({ name: "__actionName", value: this.#actionNameValue, placeholder: text("EAGLEHOMEBREW.window.form.namePlaceholder") });
      this.#actionNameInput = name;
      block.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.form.nameLabel"), input: name }));

      let propertiesInput: HTMLInputElement | HTMLSelectElement | undefined;
      for (const field of actionItemFields(itemType)) {
        const input = renderFieldWidget(field, this.#actionFieldValues.get(field.path), this.#actionFieldInputs);
        block.append(fields.createFormGroup({ label: itemFieldLabel(itemType, field), input }));
        if (field.path === "properties") propertiesInput = input as HTMLInputElement;
      }

      block.append(this.#renderNpcActionActivityBlock());

      const previewLine = element("p");
      previewLine.classList.add("eagle-homebrew-action-preview");
      block.append(previewLine);
      this.#wireNpcActionCategoryPreview(previewLine, itemType, propertiesInput, this.#actionActivityFieldInputs.get("activation.type"));

      const confirm = element("button", text("EAGLEHOMEBREW.window.action.confirm"));
      confirm.type = "button";
      confirm.dataset.action = "confirmNpcAction";
      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelNpcAction";
      block.append(confirm, document.createTextNode(" "), cancel);
      return block;
    }

    // The nested, at-most-one Activity (M16a Apply, Entscheidung 3): no type picked yet shows the five
    // type buttons (like `#renderActivityTypePicker`, but no "Cancel" — leaving it at "no Activity" is
    // itself a valid, meaningful choice, dnd5e's own Trait fallback); a type picked shows its basic/
    // advanced fields (`#renderActivityFieldGroup`, reused with this Action's own maps) plus a "Remove
    // Activity" button to go back. No nested Effect toggle here (Non-Goal, see `core/npc-action-model.ts`).
    #renderNpcActionActivityBlock(): HTMLElement {
      const wrapper = element("div");
      wrapper.append(element("h4", text("EAGLEHOMEBREW.window.action.activityHeading")));
      if (!this.#actionActivityType) {
        wrapper.append(element("p", text("EAGLEHOMEBREW.window.action.noActivityHint")));
        for (const type of ACTIVITY_TYPES_ORDER) {
          const button = element("button", text(ACTIVITY_TYPE_LABEL_KEY[type]));
          button.type = "button";
          button.dataset.action = "pickNpcActionActivityType";
          button.dataset.type = type;
          wrapper.append(button);
        }
        return wrapper;
      }
      this.#actionActivityFieldInputs.clear();
      const spec = specFor(this.#actionActivityType);
      const basic = spec.fields.filter((field) => field.group === "basic" && field.path !== "effects");
      const advanced = spec.fields.filter((field) => field.group === "advanced" && field.path !== "effects");
      for (const field of basic) wrapper.append(this.#renderActivityFieldGroup(field, this.#actionActivityFieldValues, this.#actionActivityFieldInputs));
      if (advanced.length > 0) {
        const details = element("details");
        details.append(element("summary", text("EAGLEHOMEBREW.window.activity.moreFields")));
        for (const field of advanced) details.append(this.#renderActivityFieldGroup(field, this.#actionActivityFieldValues, this.#actionActivityFieldInputs));
        wrapper.append(details);
      }
      const removeActivity = element("button", text("EAGLEHOMEBREW.window.action.removeActivity"));
      removeActivity.type = "button";
      removeActivity.dataset.action = "removeNpcActionActivity";
      wrapper.append(removeActivity);
      return wrapper;
    }

    // Live "Erscheint als: ..." feedback (M16a Apply, Entscheidung 4), an exact mirror of dnd5e's own
    // categorization (`npcActionCategory`) — a direct "change" listener on the two fields that actually
    // feed it, the same no-full-re-render technique `#wireConditionalVisibility`/the damage-formula
    // toggles already use elsewhere in this file, so switching Properties or the Activity's own
    // activation type never disturbs the rest of the in-progress form.
    #wireNpcActionCategoryPreview(
      previewLine: HTMLElement,
      itemType: NpcActionItemType,
      propertiesInput: HTMLInputElement | HTMLSelectElement | undefined,
      activationInput: HTMLInputElement | HTMLSelectElement | undefined,
    ): void {
      const refresh = (): void => {
        const hasTrait = itemType === "feat" && readList(propertiesInput).includes("trait");
        const activation = typeof activationInput?.value === "string" ? activationInput.value : undefined;
        const category = npcActionCategory(hasTrait, activation || undefined);
        previewLine.textContent = text("EAGLEHOMEBREW.window.action.preview", { category: text(NPC_ACTION_CATEGORY_LABEL_KEY[category]) });
      };
      refresh();
      propertiesInput?.addEventListener("change", refresh);
      activationInput?.addEventListener("change", refresh);
    }

    // M11c (dadm/m11c-02-apply-output.md, Entscheidung 2): one change row, shared by the nested Activity-effect
    // toggle (`#renderEffectSection`) and the standalone builder (`#renderStandaloneEffectFields`) — unlike the
    // rest of those two methods, this piece is genuinely shared, not duplicated: the curated picker's toggle
    // logic is too involved to keep two copies in sync by hand. Renders every possible sub-field up front
    // (target select, parameter select, value text, proficiency select, the three "Custom" fallback fields) and
    // toggles their `hidden` state when the target selection changes — the same direct-DOM approach the rest of
    // this file already uses for conditional fields, so switching targets never needs a full re-render.
    #renderEffectChangeRow(
      row: number,
      persistedRow: EffectChangeRowValues | undefined,
      inputsMap: Map<number, EffectChangeRowInputs>,
      removeAction: string,
    ): HTMLElement {
      const rowBlock = element("div");
      rowBlock.classList.add("eagle-homebrew-effect-change");

      const targetOptions = [
        ...EFFECT_TARGETS.map((entry) => ({ value: entry.id, label: text(EFFECT_TARGET_LABEL_KEY[entry.id]) })),
        { value: "custom", label: text("EAGLEHOMEBREW.window.effect.target.custom") },
      ];
      const target = fields.createSelectInput({ name: `__effect_target_${row}`, value: persistedRow?.target ?? "", options: targetOptions, blank: text("EAGLEHOMEBREW.window.effect.targetPick") });
      const targetGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.effect.targetLabel"), input: target });

      const parameter = fields.createSelectInput({ name: `__effect_parameter_${row}`, value: persistedRow?.parameter ?? "", options: [] });
      const parameterGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.effect.parameterLabel"), input: parameter });

      const value = fields.createTextInput({ name: `__effect_value_${row}`, value: persistedRow?.value ?? "" });
      const valueGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.changeValue"), input: value });

      const proficiencyOptions = PROFICIENCY_LEVELS.map((level) => ({ value: level.value, label: text(level.labelKey) }));
      const proficiency = fields.createSelectInput({ name: `__effect_proficiency_${row}`, value: persistedRow?.proficiency ?? "1", options: proficiencyOptions });
      const proficiencyGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.effect.proficiencyLabel"), input: proficiency });

      const customKey = fields.createTextInput({ name: `__effect_customKey_${row}`, value: persistedRow?.customKey ?? "", placeholder: "system.bonuses.mwak.damage" });
      const customValue = fields.createTextInput({ name: `__effect_customValue_${row}`, value: persistedRow?.customValue ?? "", placeholder: "+1d6" });
      const modeChoices = choicesFor("activeEffectModes");
      const modeOptions = Object.entries(modeChoices).map(([modeValue, modeLabel]) => ({ value: modeValue, label: modeLabel }));
      const customMode = fields.createSelectInput({ name: `__effect_customMode_${row}`, value: persistedRow?.customMode ?? String(ACTIVE_EFFECT_MODES.ADD), options: modeOptions });
      const customKeyGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.changeKey"), input: customKey });
      const customValueGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.changeValue"), input: customValue });
      const customModeGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.changeMode"), input: customMode });

      inputsMap.set(row, { target, parameter, value, proficiency, customKey, customValue, customMode });

      const refresh = (): void => {
        const selectedTarget = effectTargetById(target.value);
        const isCustom = target.value === "custom";
        const needsParameter = Boolean(selectedTarget?.keyParameter || selectedTarget?.valueParameter);
        parameterGroup.hidden = !needsParameter;
        if (needsParameter && selectedTarget) {
          const choicesKind = parameterChoicesKind(selectedTarget);
          const choices = choicesKind ? choicesFor(choicesKind) : {};
          const current = parameter.value;
          parameter.replaceChildren();
          parameter.append(element("option"));
          for (const [choiceValue, choiceLabel] of Object.entries(choices)) {
            const option = element("option", choiceLabel);
            option.value = choiceValue;
            if (choiceValue === current) option.selected = true;
            parameter.append(option);
          }
        }
        valueGroup.hidden = selectedTarget?.valueKind !== "number" && selectedTarget?.valueKind !== "formula";
        if (selectedTarget?.valueKind === "formula") value.placeholder = "e.g. +1d4, or 2 + @abilities.int.mod";
        else if (selectedTarget?.valueKind === "number") value.placeholder = "e.g. 1";
        proficiencyGroup.hidden = selectedTarget?.valueKind !== "proficiencyLevel";
        customKeyGroup.hidden = customValueGroup.hidden = customModeGroup.hidden = !isCustom;
      };
      target.addEventListener("change", refresh);
      refresh();

      rowBlock.append(targetGroup, parameterGroup, valueGroup, proficiencyGroup, customKeyGroup, customValueGroup, customModeGroup);
      const removeRow = element("button", text("EAGLEHOMEBREW.window.activity.remove"));
      removeRow.type = "button";
      removeRow.dataset.action = removeAction;
      removeRow.dataset.row = String(row);
      rowBlock.append(removeRow);
      return rowBlock;
    }

    #renderActivityTypePicker(): HTMLElement {
      const block = element("div");
      block.append(element("p", text("EAGLEHOMEBREW.window.activity.pickType")));
      for (const type of ACTIVITY_TYPES_ORDER) {
        const button = element("button", text(ACTIVITY_TYPE_LABEL_KEY[type]));
        button.type = "button";
        button.dataset.action = "pickActivityType";
        button.dataset.type = type;
        block.append(button);
      }
      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelActivity";
      block.append(cancel);
      return block;
    }

    #renderActivityBuilder(type: ActivityType): HTMLElement {
      const block = element("div");
      this.#builderFieldInputs.clear();
      const spec = specFor(type);
      const basic = spec.fields.filter((field) => field.group === "basic" && field.path !== "effects");
      const advanced = spec.fields.filter((field) => field.group === "advanced" && field.path !== "effects");

      for (const field of basic) block.append(this.#renderActivityFieldGroup(field));

      if (advanced.length > 0) {
        const details = element("details");
        details.append(element("summary", text("EAGLEHOMEBREW.window.activity.moreFields")));
        for (const field of advanced) details.append(this.#renderActivityFieldGroup(field));
        block.append(details);
      }

      block.append(this.#renderEffectSection());

      const confirm = element("button", text("EAGLEHOMEBREW.window.activity.add"));
      confirm.type = "button";
      confirm.dataset.action = "confirmActivity";
      const cancel = element("button", text("EAGLEHOMEBREW.window.activity.cancel"));
      cancel.type = "button";
      cancel.dataset.action = "cancelActivity";
      block.append(confirm, document.createTextNode(" "), cancel);
      return block;
    }

    // `values`/`inputs` default to the top-level Activity builder's own maps; M16a passes
    // `#actionActivityFieldValues`/`#actionActivityFieldInputs` for the nested Activity on an NPC Action
    // item — the same rendering, a second pair of maps (Deploy generalization, mirroring `#readPart`'s own).
    #renderActivityFieldGroup(
      field: ActivityField,
      values: ReadonlyMap<string, string | boolean | string[]> = this.#builderValues,
      inputs: Map<string, HTMLInputElement | HTMLSelectElement> = this.#builderFieldInputs,
    ): HTMLElement {
      if (field.widget === "damagePart" || field.widget === "healingPart") return this.#renderPartField(field, values, inputs);
      const input = this.#renderActivityWidget(field, values, inputs);
      return fields.createFormGroup({ label: labelFor(field), input });
    }

    #renderActivityWidget(
      field: ActivityField,
      values: ReadonlyMap<string, string | boolean | string[]> = this.#builderValues,
      inputs: Map<string, HTMLInputElement | HTMLSelectElement> = this.#builderFieldInputs,
    ): HTMLElement {
      return renderFieldWidget(field, values.get(field.path), inputs);
    }

    // The four sub-fields of one DamageData (M4 Discover Befund 3): shared by `damage.parts` (an array field, one
    // element — attack/damage/save) and `heal`'s own `healing` (a single object, not an array) — `field.widget`
    // tells `confirmActivity`/`#readPart`'s caller which of the two shapes to wrap the result in; the fields
    // themselves are identical either way. "Damage Type(s)" is a real multi-select, the same as any other Set field
    // with a runtime catalog (M7 rework). A single-dropdown variant was tried in Runde 3 to isolate live-check
    // finding 14 (Flight Control's "must be JSON-serializable" rejection on document.update) — that test showed the
    // multi-select was never the cause (the real cause: `createSimple` reusing one mutated `changes` reference
    // across two calls, fixed there, dadm/m7-hd-1-output.md) — reverted back to the multi-select on the project
    // lead's instruction once the actual cause was confirmed.
    #renderPartField(
      field: ActivityField,
      values: ReadonlyMap<string, string | boolean | string[]> = this.#builderValues,
      inputs: Map<string, HTMLInputElement | HTMLSelectElement> = this.#builderFieldInputs,
    ): HTMLElement {
      const prefix = field.path;
      const rawNumber = values.get(`${prefix}#number`);
      const rawDenomination = values.get(`${prefix}#denomination`);
      const persistedBonus = values.get(`${prefix}#bonus`);
      const persistedTypes = values.get(`${prefix}#types`);
      const block = element("div");
      const number = fields.createNumberInput({ name: `${prefix}#number`, value: persistedNumber(rawNumber) });
      const denomination = fields.createNumberInput({ name: `${prefix}#denomination`, value: persistedNumber(rawDenomination) });
      const bonus = fields.createTextInput({ name: `${prefix}#bonus`, value: typeof persistedBonus === "string" ? persistedBonus : "", placeholder: "e.g. +2" });
      const choices = field.choicesKind ? choicesFor(field.choicesKind) : undefined;
      const persistedTypeList = Array.isArray(persistedTypes) ? persistedTypes : [];
      let types: HTMLInputElement | HTMLSelectElement;
      if (choices && Object.keys(choices).length > 0) {
        const options = Object.entries(choices).map(([value, label]) => ({ value, label }));
        types = fields.createMultiSelectInput({ name: `${prefix}#types`, value: persistedTypeList, options });
      } else {
        types = fields.createTextInput({ name: `${prefix}#types`, value: persistedTypeList.join(", "), placeholder: "fire, cold" });
      }
      inputs.set(`${prefix}#number`, number);
      inputs.set(`${prefix}#denomination`, denomination);
      inputs.set(`${prefix}#bonus`, bonus);
      inputs.set(`${prefix}#types`, types);
      block.append(
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageNumber"), input: number }),
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageDenomination"), input: denomination }),
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageBonus"), input: bonus }),
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageTypes"), input: types }),
      );
      return block;
    }

    // M8: a kind's own fields (core/item-field-model.ts), grouped by template origin — every section in a fixed
    // order, skipping an empty one (Tool has no "mountable" fields, so that section simply does not appear for
    // Tool). Each section is its own `<details>` (M8 rework, live-check finding: a Weapon's ~28 fields all open at
    // once, all in plain `<fieldset>`s, made the window too long — individually foldable sections shorten it back
    // down without hiding anything, N21 still holds since every field is still there, just one click away). "core"
    // (the fields a Homebrewer fills in first and most often — the project lead's own example: weapon type, weapon,
    // ability, damage type, formula/bonus) starts open; the rest start closed.
    #renderItemFieldSections(kind: ItemKind, itemFields: readonly ItemField[]): HTMLElement {
      this.#itemFieldInputs.clear();
      const wrapper = element("div");
      // M11 rework: "advanced" was added to ItemFieldSection but missed here — Feat's/Background's
      // `advancement`/`startingEquipment` fields (both section "advanced") silently never rendered at
      // all, found while implementing the M11 live-check rework (no unit test covers this v13-only
      // rendering order; core/ only tests that the field spec itself carries the right section).
      const order: readonly ItemField["section"][] = [
        "core",
        "abilityScores",
        "skills",
        "combat",
        "actions",
        "movement",
        "senses",
        "travel",
        "capacity",
        "resistances",
        "uses",
        "currency",
        "physical",
        "description",
        "source",
        "equippable",
        "mountable",
        "advanced",
      ];
      // M8a: fields with a `visibleWhen` get their element remembered here, so `#wireConditionalVisibility` can
      // apply and keep updating it after every relevant field in the whole form has been rendered (a condition
      // like Reach's can depend on `type.value`, rendered in the "core" section before Reach's own "core" entry,
      // but also needs `properties`, rendered right next to it — simplest to wire once, after everything exists).
      const conditional: { field: ItemField; element: HTMLElement }[] = [];
      for (const section of order) {
        const inSection = itemFields.filter((field) => field.section === section);
        if (inSection.length === 0) continue;
        const details = element("details");
        if (section === "core") details.open = true;
        details.append(element("summary", text(kind === "vehicle" && section === "core" ? "EAGLEHOMEBREW.window.item.section.identity" : ITEM_SECTION_LABEL_KEY[section])));
        const fieldset = element("fieldset");
        for (const field of inSection) {
          const fieldElement = this.#renderItemFieldGroup(kind, field);
          if (field.visibleWhen) conditional.push({ field, element: fieldElement });
          fieldset.append(fieldElement);
        }
        details.append(fieldset);
        wrapper.append(details);
      }
      this.#wireConditionalVisibility(conditional);
      return wrapper;
    }

    // M8a: a field only relevant given another field's current value (Discover, traced to dnd5e's own item sheet —
    // Reach only for a non-ranged weapon, the whole Mountable block only for a siege weapon, ...) starts hidden or
    // shown to match right away, and a `change` listener on the one or two fields any `visibleWhen` actually reads
    // (`properties`, `type.value`) re-evaluates every conditional field whenever either changes — one shared
    // listener pair instead of one per conditional field, since several conditions share the same trigger.
    #wireConditionalVisibility(conditional: readonly { readonly field: ItemField; readonly element: HTMLElement }[]): void {
      if (conditional.length === 0) return;
      const currentContext = (): ItemFieldVisibilityContext => {
        const propertiesInput = this.#itemFieldInputs.get("properties");
        const typeValueInput = this.#itemFieldInputs.get("type.value") as HTMLSelectElement | undefined;
        const typeSubtypeInput = this.#itemFieldInputs.get("type.subtype") as HTMLSelectElement | undefined;
        const actionStationsInput = this.#itemFieldInputs.get("attributes.actions.stations") as HTMLInputElement | undefined;
        return {
          properties: new Set(propertiesInput ? readList(propertiesInput) : []),
          typeValue: typeValueInput?.value ?? "",
          typeSubtype: typeSubtypeInput?.value,
          actionStations: actionStationsInput?.checked ?? false,
        };
      };
      const refresh = (): void => {
        const context = currentContext();
        for (const { field, element } of conditional) element.hidden = field.visibleWhen ? !field.visibleWhen(context) : false;
      };
      refresh();
      this.#itemFieldInputs.get("properties")?.addEventListener("change", refresh);
      this.#itemFieldInputs.get("type.value")?.addEventListener("change", refresh);
      this.#itemFieldInputs.get("type.subtype")?.addEventListener("change", refresh);
      this.#itemFieldInputs.get("attributes.actions.stations")?.addEventListener("change", refresh);
    }

    #renderItemFieldGroup(kind: ItemKind, field: ItemField): HTMLElement {
      if (field.widget === "weaponDamagePart") {
        // M8 rework Runde 2, live-check finding: `damage.base` and `damage.versatile` rendered back to back with
        // no heading between them looked like the same nine fields repeated for no reason — a heading names which
        // block is which (Weapon has exactly two, so this only ever runs twice per form).
        const wrapper = element("div");
        wrapper.append(element("h4", itemFieldLabel(kind, field)));
        wrapper.append(this.#renderItemDamagePartField(field));
        return wrapper;
      }
      if (field.widget === "baseItemSelect") return this.#renderBaseItemSelect(kind, field);
      if (field.widget === "dependentSubtypeSelect") return this.#renderDependentSubtypeSelect(kind, field);
      // M11 live-check rework, Funde 2+3: Feat's `requirements` gets a "Prerequisites" heading (grouping it
      // visually with `prerequisites.level`/`.items`/`.repeatable`, which follow it right after in FEAT_FIELDS
      // and so land directly below in the DOM) and a synthetic "Has Requirements" checkbox that hides it by
      // default — most Features have none. The checkbox has no backing dnd5e field (nothing to write, unlike
      // `custom.enabled` below); it only toggles the requirements FormGroup's `hidden`, the same technique.
      if (kind === "feat" && field.path === "requirements") return this.#renderRequirementsGroup(kind, field);
      const input = this.#renderItemFieldWidget(field);
      return fields.createFormGroup({ label: itemFieldLabel(kind, field), input });
    }

    #renderRequirementsGroup(kind: ItemKind, field: ItemField): HTMLElement {
      const wrapper = element("div");
      wrapper.append(element("h4", text("EAGLEHOMEBREW.window.item.field.prerequisitesHeading")));
      const persisted = this.#itemFieldValues.get("requirements#has");
      const hasValue = typeof persisted === "boolean" ? persisted : typeof this.#itemFieldValues.get(field.path) === "string" && this.#itemFieldValues.get(field.path) !== "";
      const toggle = fields.createCheckboxInput({ name: "requirements#has", value: hasValue });
      this.#itemFieldInputs.set("requirements#has", toggle);
      wrapper.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.item.field.hasRequirements"), input: toggle }));
      const input = this.#renderItemFieldWidget(field);
      const requirementsGroup = fields.createFormGroup({ label: itemFieldLabel(kind, field), input });
      requirementsGroup.hidden = !toggle.checked;
      toggle.addEventListener("change", () => {
        requirementsGroup.hidden = !toggle.checked;
      });
      wrapper.append(requirementsGroup);
      return wrapper;
    }

    #renderItemFieldWidget(field: ItemField): HTMLElement {
      const persisted = this.#itemFieldValues.has(field.path)
        ? this.#itemFieldValues.get(field.path)
        : field.path === "attributes.actions.stations"
          ? true
          : undefined;
      return renderFieldWidget(field, persisted, this.#itemFieldInputs);
    }

    // M8a: `type.baseItem` — starts with the same synchronous, key-labelled options `renderFieldWidget`'s "select"
    // case would already give it (via `field.choicesKind`), then asynchronously resolves the real base item names,
    // filtered to the currently selected `type.value`, and replaces the options in place once that resolves
    // (`#refreshBaseItemOptions`) — never a full re-render, so this does not disturb anything else on screen. A
    // `change` listener on `type.value` re-resolves when the filter criterion changes.
    #renderBaseItemSelect(kind: ItemKind, field: ItemField): HTMLElement {
      const input = this.#renderItemFieldWidget(field) as HTMLSelectElement;
      const refresh = (): void => void this.#refreshBaseItemOptions(kind, field, input);
      refresh();
      this.#itemFieldInputs.get("type.value")?.addEventListener("change", refresh);
      return fields.createFormGroup({ label: itemFieldLabel(kind, field), input });
    }

    // Resolves real, type-filtered base item names via dnd5e's own `Trait.getBaseItem` (M8a Apply, Mechanismus B)
    // and rewrites `select`'s options in place once the (possibly several) lookups settle. Guards against a stale
    // result landing after the field has been re-rendered from scratch (a new `<select>` instance, M7's established
    // pattern for anything async here) by checking this is still the input actually registered for `field.path`.
    async #refreshBaseItemOptions(kind: ItemKind, field: ItemField, select: HTMLSelectElement): Promise<void> {
      const typeValue = (this.#itemFieldInputs.get("type.value") as HTMLSelectElement | undefined)?.value ?? "";
      const resolved = await baseItemOptionsFor(kind, typeValue);
      if (this.#itemFieldInputs.get(field.path) !== select || !resolved) return;
      const current = select.value;
      const options = new Map(Object.entries(resolved));
      // Keep an already-chosen value selectable even if the type filter now excludes it (dnd5e's own
      // `_getBaseItemOptions` does the same, `item-sheet.mjs:565`) — a field's own selection should never silently
      // vanish out from under the person filling in the form. Formatted through `pathLabel`, not shown as the raw
      // key (M8a rework, live-check finding: it read as an odd, lowercase leftover next to the real names above it).
      if (current !== "" && !options.has(current)) options.set(current, pathLabel(current));
      select.replaceChildren();
      select.append(element("option"));
      for (const [value, label] of options) {
        const optionEl = element("option", label);
        optionEl.value = value;
        if (value === current) optionEl.selected = true;
        select.append(optionEl);
      }
    }

    // M9, generalized M11: `type.subtype` (Consumable, Feat) — same "render, then fill/refresh on
    // `type.value` change" shape as `#renderBaseItemSelect` above, but synchronous
    // (`dependentSubtypeOptionsFor`, no compendium lookup) and without preserving a now-irrelevant stale
    // selection: a value that no longer has a matching subtype is a value for a field the type change is
    // about to hide anyway (`visibleWhen`, `#wireConditionalVisibility`), not a choice worth keeping
    // visible like a filtered-out (but still valid) base item is (Mechanismus B, M8a).
    #renderDependentSubtypeSelect(kind: ItemKind, field: ItemField): HTMLElement {
      const input = this.#renderItemFieldWidget(field) as HTMLSelectElement;
      const refresh = (): void => this.#refreshDependentSubtypeOptions(field, input);
      refresh();
      this.#itemFieldInputs.get("type.value")?.addEventListener("change", refresh);
      return fields.createFormGroup({ label: itemFieldLabel(kind, field), input });
    }

    #refreshDependentSubtypeOptions(field: ItemField, select: HTMLSelectElement): void {
      if (this.#itemFieldInputs.get(field.path) !== select) return;
      const catalog = field.choicesKind as SubtypeCatalog | undefined;
      if (!catalog) return;
      const typeValue = (this.#itemFieldInputs.get("type.value") as HTMLSelectElement | undefined)?.value ?? "";
      const resolved = dependentSubtypeOptionsFor(catalog, typeValue);
      const current = select.value;
      select.replaceChildren();
      select.append(element("option"));
      for (const [value, label] of Object.entries(resolved)) {
        const optionEl = element("option", label);
        optionEl.value = value;
        if (value === current) optionEl.selected = true;
        select.append(optionEl);
      }
    }

    // Weapon's own `damage.base`/`damage.versatile` (dnd5e's shared DamageData): the same four sub-fields as an
    // Activity's `damagePart` widget, plus `custom.enabled`/`custom.formula` (an override formula) and
    // `scaling.mode`/`scaling.number`/`scaling.formula` (per-level damage scaling) — fields Activities' own damage
    // parts do not have (M8 Apply, Befund 1). `scaling.mode`'s three values are dnd5e's own fixed switch-case
    // (`DamageData#scaledFormula`, not a runtime catalog), the same "small, fixed, code-held set" treatment
    // `ACTIVE_EFFECT_MODES` already gets.
    #renderItemDamagePartField(
      field: ItemField,
      values: ReadonlyMap<string, string | boolean | string[]> = this.#itemFieldValues,
      inputs: Map<string, HTMLInputElement | HTMLSelectElement> = this.#itemFieldInputs,
    ): HTMLElement {
      const prefix = field.path;
      const block = element("div");
      const rawNumber = values.get(`${prefix}#number`);
      const rawDenomination = values.get(`${prefix}#denomination`);
      const persistedBonus = values.get(`${prefix}#bonus`);
      const persistedTypes = values.get(`${prefix}#types`);
      const persistedCustomFormula = values.get(`${prefix}#customFormula`);
      const persistedScalingMode = values.get(`${prefix}#scalingMode`);
      const rawScalingNumber = values.get(`${prefix}#scalingNumber`);
      const persistedScalingFormula = values.get(`${prefix}#scalingFormula`);

      const number = fields.createNumberInput({ name: `${prefix}#number`, value: persistedNumber(rawNumber) });
      const denomination = fields.createNumberInput({ name: `${prefix}#denomination`, value: persistedNumber(rawDenomination) });
      const bonus = fields.createTextInput({ name: `${prefix}#bonus`, value: typeof persistedBonus === "string" ? persistedBonus : "", placeholder: "e.g. +2" });
      const damageChoices = choicesFor("damageTypes");
      const persistedTypeList = Array.isArray(persistedTypes) ? persistedTypes : [];
      const types = fields.createMultiSelectInput({
        name: `${prefix}#types`,
        value: persistedTypeList,
        options: Object.entries(damageChoices).map(([value, label]) => ({ value, label })),
      });
      const customEnabled = fields.createCheckboxInput({ name: `${prefix}#customEnabled`, value: values.get(`${prefix}#customEnabled`) === true });
      const customFormula = fields.createTextInput({
        name: `${prefix}#customFormula`,
        value: typeof persistedCustomFormula === "string" ? persistedCustomFormula : "",
        placeholder: "e.g. 2d6 + @mod (replaces the dice/bonus above entirely when \"Use Custom Formula\" is on)",
      });
      // M8 rework Runde 3, live-check request: dnd5e's own "whole"/"half"/"none" scaling-mode vocabulary (cantrip-
      // style die progression, generically available on every DamageData but genuinely rare on a plain weapon —
      // mostly a magic item that grows stronger with its wielder's level) read as unexplained jargon on its own.
      // A plain-language "Scales with level" checkbox now stands in for "none" vs. not, the same hidden-until-
      // relevant treatment "Use Custom Formula" already got — dropping "none" as a selectable Scaling Speed option
      // (the checkbox already says that) and renaming the remaining two to what they actually mean.
      const scalingOn = fields.createCheckboxInput({ name: `${prefix}#scalingOn`, value: values.get(`${prefix}#scalingOn`) === true });
      const scalingModeOptions = [
        { value: "whole", label: text("EAGLEHOMEBREW.window.item.field.scalingModeWhole") },
        { value: "half", label: text("EAGLEHOMEBREW.window.item.field.scalingModeHalf") },
      ];
      const scalingMode = fields.createSelectInput({
        name: `${prefix}#scalingMode`,
        value: typeof persistedScalingMode === "string" && persistedScalingMode !== "none" ? persistedScalingMode : "whole",
        options: scalingModeOptions,
      });
      const scalingNumber = fields.createNumberInput({
        name: `${prefix}#scalingNumber`,
        value: persistedNumber(rawScalingNumber),
        placeholder: "e.g. 1 (one extra die per scaling step)",
      });
      const scalingFormula = fields.createTextInput({
        name: `${prefix}#scalingFormula`,
        value: typeof persistedScalingFormula === "string" ? persistedScalingFormula : "",
        placeholder: "e.g. 1d6 (extra damage added per scaling step, instead of another die of the base size)",
      });

      inputs.set(`${prefix}#number`, number);
      inputs.set(`${prefix}#denomination`, denomination);
      inputs.set(`${prefix}#bonus`, bonus);
      inputs.set(`${prefix}#types`, types);
      inputs.set(`${prefix}#customEnabled`, customEnabled);
      inputs.set(`${prefix}#customFormula`, customFormula);
      inputs.set(`${prefix}#scalingOn`, scalingOn);
      inputs.set(`${prefix}#scalingMode`, scalingMode);
      inputs.set(`${prefix}#scalingNumber`, scalingNumber);
      inputs.set(`${prefix}#scalingFormula`, scalingFormula);

      // M8 rework Runde 2, live-check finding: "Custom Formula" sat visible and empty right next to its own
      // checkbox, implying it always matters — it only does once "Use Custom Formula" is on (it then replaces the
      // dice/bonus above entirely, per dnd5e's own DamageData#formula). A live "change" listener toggles it, the
      // same direct-DOM approach `#renderEffectSection`'s own toggle checkbox already uses, chosen over a full
      // re-render here so this one field does not reset the rest of the block (and its scroll position) on toggle.
      const customFormulaGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.item.field.customFormula"), input: customFormula });
      customFormulaGroup.hidden = !customEnabled.checked;
      customEnabled.addEventListener("change", () => {
        customFormulaGroup.hidden = !customEnabled.checked;
      });

      // Same treatment, Runde 3, for the whole Scaling block (Scaling Speed/Dice/Formula) behind "Scales with
      // level".
      const scalingModeGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.item.field.scalingMode"), input: scalingMode });
      const scalingNumberGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.item.field.scalingNumber"), input: scalingNumber });
      const scalingFormulaGroup = fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.item.field.scalingFormula"), input: scalingFormula });
      const setScalingGroupsHidden = (hidden: boolean): void => {
        scalingModeGroup.hidden = hidden;
        scalingNumberGroup.hidden = hidden;
        scalingFormulaGroup.hidden = hidden;
      };
      setScalingGroupsHidden(!scalingOn.checked);
      scalingOn.addEventListener("change", () => setScalingGroupsHidden(!scalingOn.checked));

      block.append(
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageNumber"), input: number }),
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageDenomination"), input: denomination }),
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageBonus"), input: bonus }),
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.field.damageTypes"), input: types }),
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.item.field.customEnabled"), input: customEnabled }),
        customFormulaGroup,
        fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.item.field.scalingOn"), input: scalingOn }),
        scalingModeGroup,
        scalingNumberGroup,
        scalingFormulaGroup,
      );
      return block;
    }

    #readItemField(field: ItemField): JsonValue | undefined {
      return readFieldValue(field, this.#itemFieldInputs);
    }

    #readItemDamagePart(
      prefix: string,
      inputs: ReadonlyMap<string, HTMLInputElement | HTMLSelectElement> = this.#itemFieldInputs,
    ): Record<string, JsonValue> | undefined {
      const number = readNumber(inputs.get(`${prefix}#number`) as HTMLInputElement | undefined);
      const denomination = readNumber(inputs.get(`${prefix}#denomination`) as HTMLInputElement | undefined);
      const bonus = (inputs.get(`${prefix}#bonus`) as HTMLInputElement | undefined)?.value.trim() ?? "";
      const typeList = readList(inputs.get(`${prefix}#types`));
      const customEnabled = (inputs.get(`${prefix}#customEnabled`) as HTMLInputElement | undefined)?.checked ?? false;
      const customFormula = (inputs.get(`${prefix}#customFormula`) as HTMLInputElement | undefined)?.value.trim() ?? "";
      // "Scales with level" (M8 rework Runde 3) stands in for dnd5e's own `scaling.mode: "none"` — off means no
      // `scaling` at all (dnd5e's blank-mode default already behaves as "does not scale", `DamageData#scaledFormula`),
      // so there is nothing to read from Scaling Speed/Dice/Formula unless the checkbox is on.
      const scalingOn = (inputs.get(`${prefix}#scalingOn`) as HTMLInputElement | undefined)?.checked ?? false;
      const scalingMode = (inputs.get(`${prefix}#scalingMode`) as HTMLSelectElement | undefined)?.value ?? "whole";
      const scalingNumber = readNumber(inputs.get(`${prefix}#scalingNumber`) as HTMLInputElement | undefined);
      const scalingFormula = (inputs.get(`${prefix}#scalingFormula`) as HTMLInputElement | undefined)?.value.trim() ?? "";

      const part: Record<string, JsonValue> = {};
      if (number !== undefined) part.number = number;
      if (denomination !== undefined) part.denomination = denomination;
      if (bonus !== "") part.bonus = bonus;
      if (typeList.length > 0) part.types = typeList;
      if (customEnabled || customFormula !== "") {
        part.custom = { enabled: customEnabled, ...(customFormula !== "" ? { formula: customFormula } : {}) };
      }
      if (scalingOn) {
        part.scaling = {
          mode: scalingMode,
          ...(scalingNumber !== undefined ? { number: scalingNumber } : {}),
          ...(scalingFormula !== "" ? { formula: scalingFormula } : {}),
        };
      }
      return Object.keys(part).length > 0 ? part : undefined;
    }

    // Reads every one of a kind's own fields back from the live DOM (M8, the same "read at Create time, not before"
    // approach `confirmActivity` already uses for Activities) into a dotted-path values record `buildItemFieldData`
    // (core/item-field-model.ts) can nest under `system`.
    #collectItemFieldValues(kind: ItemKind): Record<string, JsonValue> {
      const values: Record<string, JsonValue> = {};
      for (const field of specForItemKind(kind).fields) {
        if (field.widget === "weaponDamagePart") {
          const part = this.#readItemDamagePart(field.path);
          if (part) values[field.path] = part;
          continue;
        }
        const value = this.#readItemField(field);
        if (value !== undefined) values[field.path] = value;
      }
      return values;
    }

    #hydrateItemFieldValues(kind: ItemKind, source: JsonObject): void {
      for (const field of specForItemKind(kind).fields) {
        const value = valueAt(source, `system.${field.path}`);
        if (value === undefined || value === null) continue;
        if (field.widget === "weaponDamagePart") {
          if (Array.isArray(value) || typeof value !== "object") continue;
          const part = value as Record<string, JsonValue>;
          const put = (suffix: string, raw: JsonValue | undefined): void => {
            if (typeof raw === "boolean") this.#itemFieldValues.set(`${field.path}#${suffix}`, raw);
            else if (typeof raw === "number" || typeof raw === "string") this.#itemFieldValues.set(`${field.path}#${suffix}`, String(raw));
            else if (Array.isArray(raw)) this.#itemFieldValues.set(`${field.path}#${suffix}`, raw.filter((entry): entry is string => typeof entry === "string"));
          };
          put("number", part.number);
          put("denomination", part.denomination);
          put("bonus", part.bonus);
          put("types", part.types);
          const custom = part.custom && !Array.isArray(part.custom) && typeof part.custom === "object" ? part.custom as Record<string, JsonValue> : undefined;
          put("customEnabled", custom?.enabled);
          put("customFormula", custom?.formula);
          const scaling = part.scaling && !Array.isArray(part.scaling) && typeof part.scaling === "object" ? part.scaling as Record<string, JsonValue> : undefined;
          if (scaling) this.#itemFieldValues.set(`${field.path}#scalingOn`, true);
          put("scalingMode", scaling?.mode);
          put("scalingNumber", scaling?.number);
          put("scalingFormula", scaling?.formula);
          continue;
        }
        if (field.widget === "checkbox" && typeof value === "boolean") this.#itemFieldValues.set(field.path, value);
        else if (field.widget === "set" && Array.isArray(value)) {
          this.#itemFieldValues.set(field.path, value.filter((entry): entry is string => typeof entry === "string"));
        } else if (field.widget === "list") this.#itemFieldValues.set(field.path, JSON.stringify(value));
        else if (typeof value === "string" || typeof value === "number") this.#itemFieldValues.set(field.path, String(value));
      }
    }

    #hydrateResults(source: JsonObject): void {
      this.#resultDrafts = [];
      this.#baselineResultIds.clear();
      const results = source.results;
      if (!Array.isArray(results)) return;
      for (const raw of results) {
        if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
        const result = raw as Record<string, JsonValue>;
        if (result.type !== "text" || typeof result._id !== "string" || typeof result.name !== "string") continue;
        this.#resultDrafts.push({ id: result._id, text: result.name, weight: typeof result.weight === "number" ? result.weight : 1 });
        this.#baselineResultIds.add(result._id);
      }
    }

    #hydrateActivitiesAndEffects(source: JsonObject): void {
      this.#drafts = [];
      this.#effectDrafts = [];
      this.#baselineActivityIds.clear();
      this.#baselineEffectIds.clear();
      const effectsById = new Map<string, EffectModel>();
      if (Array.isArray(source.effects)) {
        for (const raw of source.effects) {
          if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
          const effect = raw as Record<string, JsonValue>;
          if (typeof effect._id !== "string" || typeof effect.name !== "string" || !Array.isArray(effect.changes)) continue;
          const changes = effect.changes.flatMap((change): EffectChange[] => {
            if (!change || Array.isArray(change) || typeof change !== "object") return [];
            const row = change as Record<string, JsonValue>;
            return typeof row.key === "string" && typeof row.value === "string" && typeof row.mode === "number"
              ? [{ key: row.key, value: row.value, mode: row.mode as EffectChange["mode"] }]
              : [];
          });
          effectsById.set(effect._id, { id: effect._id, name: effect.name, changes });
          this.#baselineEffectIds.add(effect._id);
        }
      }
      const linked = new Set<string>();
      const activities = valueAt(source, "system.activities");
      if (activities && !Array.isArray(activities) && typeof activities === "object") {
        for (const [id, raw] of Object.entries(activities)) {
          if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
          const activitySource = raw as JsonObject;
          const type = activitySource.type as ActivityType;
          if (!ACTIVITY_TYPES_ORDER.includes(type)) continue;
          const values: Record<string, JsonValue> = {};
          for (const field of specFor(type).fields) {
            if (field.path === "effects") continue;
            const value = valueAt(activitySource, field.path);
            if (value !== undefined) values[field.path] = value;
          }
          let effect: EffectModel | undefined;
          const references = activitySource.effects;
          if (Array.isArray(references)) {
            for (const reference of references) {
              if (!reference || Array.isArray(reference) || typeof reference !== "object") continue;
              const effectId = (reference as Record<string, JsonValue>)._id;
              if (typeof effectId === "string" && effectsById.has(effectId)) {
                effect = effectsById.get(effectId);
                linked.add(effectId);
                break;
              }
            }
          }
          this.#drafts.push({ id, type, values, effect });
          this.#baselineActivityIds.add(id);
        }
      }
      for (const [id, effect] of effectsById) if (!linked.has(id)) this.#effectDrafts.push(effect);
    }

    #hydrateAdvancements(kind: AdvancementKind, source: JsonObject): void {
      this.#advancementDrafts = [];
      this.#baselineAdvancementIds.clear();
      const mapping = valueAt(source, "system.advancement");
      if (!mapping || Array.isArray(mapping) || typeof mapping !== "object") return;
      for (const [id, raw] of Object.entries(mapping)) {
        if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
        const advancement = raw as JsonObject;
        const type = advancement.type as AdvancementType;
        if (!advancementTypesFor(kind).includes(type)) continue;
        const configuration = advancement.configuration && !Array.isArray(advancement.configuration) && typeof advancement.configuration === "object"
          ? advancement.configuration as JsonObject
          : {};
        const values: Record<string, JsonValue> = {};
        for (const field of specForAdvancement(type).fields) {
          const value = valueAt(configuration, field.path);
          if (value !== undefined) values[field.path] = value;
        }
        const tableKey = ADVANCEMENT_TABLES[type];
        const tableValue = tableKey ? configuration[tableKey] : undefined;
        const table = tableKey && tableValue !== undefined ? { [tableKey]: tableValue } : undefined;
        this.#advancementDrafts.push({ id, type, ...(typeof advancement.level === "number" ? { level: advancement.level } : {}), values, ...(table ? { table } : {}) });
        this.#baselineAdvancementIds.add(id);
      }
    }

    #hydrateFlatValues(
      fieldSpecs: readonly { readonly path: string; readonly widget: string }[],
      source: JsonObject,
      target: Map<string, string | boolean | string[]>,
    ): Record<string, JsonValue> {
      const values: Record<string, JsonValue> = {};
      for (const field of fieldSpecs) {
        if (field.path === "effects") continue;
        const raw = valueAt(source, field.path);
        if (raw === undefined || raw === null) continue;
        values[field.path] = raw;
        if (field.widget === "damagePart" || field.widget === "healingPart") {
          const partRaw = field.widget === "damagePart" && Array.isArray(raw) ? raw[0] : raw;
          if (!partRaw || Array.isArray(partRaw) || typeof partRaw !== "object") continue;
          const part = partRaw as Record<string, JsonValue>;
          for (const key of ["number", "denomination", "bonus"] as const) {
            if (typeof part[key] === "string" || typeof part[key] === "number") target.set(`${field.path}#${key}`, String(part[key]));
          }
          if (Array.isArray(part.types)) target.set(`${field.path}#types`, part.types.filter((entry): entry is string => typeof entry === "string"));
        } else if (field.widget === "checkbox" && typeof raw === "boolean") target.set(field.path, raw);
        else if ((field.widget === "set" || field.widget === "documentPickerMulti") && Array.isArray(raw)) target.set(field.path, raw.filter((entry): entry is string => typeof entry === "string"));
        else if (field.widget === "list") target.set(field.path, JSON.stringify(raw));
        else if (typeof raw === "string" || typeof raw === "number") target.set(field.path, String(raw));
      }
      return values;
    }

    #hydrateNpcActions(source: JsonObject): void {
      this.#actionDrafts = [];
      this.#baselineActionIds.clear();
      if (!Array.isArray(source.items)) return;
      for (const raw of source.items) {
        if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
        const item = raw as Record<string, JsonValue>;
        if ((item.type !== "feat" && item.type !== "weapon") || typeof item._id !== "string" || typeof item.name !== "string") continue;
        const system = item.system && !Array.isArray(item.system) && typeof item.system === "object" ? item.system as JsonObject : {};
        const activities = system.activities && !Array.isArray(system.activities) && typeof system.activities === "object" ? system.activities as JsonObject : {};
        const properties = system.properties;
        const isAction = Object.keys(activities).length > 0 || Array.isArray(properties) && properties.includes("trait") || typeof system.identifier === "string" && system.identifier !== "";
        if (!isAction) continue;
        const itemType = item.type as NpcActionItemType;
        const fieldValues: Record<string, JsonValue> = {};
        for (const field of actionItemFields(itemType)) {
          const value = valueAt(system, field.path);
          if (value !== undefined) fieldValues[field.path] = value;
        }
        let activity: NpcActionDraft["activity"];
        const first = Object.entries(activities)[0];
        if (first && first[1] && !Array.isArray(first[1]) && typeof first[1] === "object") {
          const activitySource = first[1] as JsonObject;
          const type = activitySource.type as ActivityType;
          if (ACTIVITY_TYPES_ORDER.includes(type)) {
            const values: Record<string, JsonValue> = {};
            for (const field of specFor(type).fields) {
              if (field.path === "effects") continue;
              const value = valueAt(activitySource, field.path);
              if (value !== undefined) values[field.path] = value;
            }
            activity = { id: first[0], type, values };
          }
        }
        this.#actionDrafts.push({ id: item._id, itemType, name: item.name, itemFieldValues: fieldValues, activity });
        this.#baselineActionIds.add(item._id);
      }
    }

    #hydrateVehicle(source: JsonObject): void {
      const system = source.system && !Array.isArray(source.system) && typeof source.system === "object" ? source.system as JsonObject : {};
      this.#vehicleRosterDrafts = [];
      for (const area of ["crew", "passengers", "draft"] as const) {
        const uuids = valueAt(system, `${area}.value`);
        if (!Array.isArray(uuids)) continue;
        const counts = new Map<string, number>();
        for (const uuid of uuids) if (typeof uuid === "string") counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
        for (const [actorUuid, quantity] of counts) this.#vehicleRosterDrafts.push({
          area,
          actorUuid,
          name: actorUuid,
          actorType: actorUuid.startsWith("Compendium.") ? "npc" : "character",
          quantity,
          libraryState: actorUuid.startsWith("Compendium.world.eagle-npcs-") ? "present" : "unsupported",
        });
      }

      this.#vehicleDamageRows = [];
      this.#vehicleDamageValues.clear();
      const amount = valueAt(system, "traits.dm.amount");
      if (amount && !Array.isArray(amount) && typeof amount === "object") {
        for (const [damageType, formula] of Object.entries(amount)) {
          const row = this.#nextVehicleDamageRow++;
          this.#vehicleDamageRows.push(row);
          this.#vehicleDamageValues.set(row, { damageType, formula: typeof formula === "string" ? formula : "" });
        }
      }

      this.#vehicleComponentDrafts = [];
      this.#baselineVehicleComponentIds.clear();
      if (!Array.isArray(source.items)) return;
      for (const raw of source.items) {
        if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
        const item = raw as Record<string, JsonValue>;
        if (typeof item._id !== "string" || typeof item.name !== "string") continue;
        const itemSystem = item.system && !Array.isArray(item.system) && typeof item.system === "object" ? item.system as JsonObject : {};
        const typeValue = valueAt(itemSystem, "type.value");
        const type: VehicleComponentType | undefined = item.type === "feat" ? "feature" : item.type === "equipment" && typeValue === "vehicle" ? "equipmentStation" : item.type === "weapon" && typeValue === "siege" ? "weaponStation" : undefined;
        if (!type) continue;
        const itemFieldValues: Record<string, JsonValue> = {};
        for (const field of vehicleComponentFields(type)) {
          const value = valueAt(itemSystem, field.path);
          if (value !== undefined) itemFieldValues[field.path] = value;
        }
        const crewValues = valueAt(itemSystem, "crew.value");
        const crewCounts = new Map<string, number>();
        if (Array.isArray(crewValues)) for (const uuid of crewValues) if (typeof uuid === "string") crewCounts.set(uuid, (crewCounts.get(uuid) ?? 0) + 1);
        const crew = [...crewCounts].map(([actorUuid, quantity]) => ({ actorUuid, quantity }));
        const activities = itemSystem.activities && !Array.isArray(itemSystem.activities) && typeof itemSystem.activities === "object" ? itemSystem.activities as JsonObject : {};
        let activity: VehicleComponentDraft["activity"];
        const first = Object.entries(activities)[0];
        if (first && first[1] && !Array.isArray(first[1]) && typeof first[1] === "object") {
          const activitySource = first[1] as JsonObject;
          const activityType = activitySource.type as ActivityType;
          if (ACTIVITY_TYPES_ORDER.includes(activityType)) {
            const values: Record<string, JsonValue> = {};
            for (const field of specFor(activityType).fields) {
              if (field.path === "effects") continue;
              const value = valueAt(activitySource, field.path);
              if (value !== undefined) values[field.path] = value;
            }
            activity = { id: first[0], type: activityType, values };
          }
        }
        this.#vehicleComponentDrafts.push({ id: item._id, type, name: item.name, itemFieldValues, crew, activity });
        this.#baselineVehicleComponentIds.add(item._id);
      }
    }

    #hydrateMembers(kind: "encounter" | "group", source: JsonObject): void {
      this.#memberDrafts = [];
      const members = valueAt(source, "system.members");
      if (!Array.isArray(members)) return;
      if (kind === "encounter") {
        for (const raw of members) {
          if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
          const member = raw as Record<string, JsonValue>;
          const quantity = member.quantity && !Array.isArray(member.quantity) && typeof member.quantity === "object" ? member.quantity as Record<string, JsonValue> : {};
          if (typeof member.uuid !== "string") continue;
          this.#memberDrafts.push({
            kind,
            actorUuid: member.uuid,
            name: member.uuid,
            quantity: typeof quantity.value === "number" ? quantity.value : 1,
            formula: typeof quantity.formula === "string" ? quantity.formula : "",
            libraryState: member.uuid.startsWith("Compendium.world.eagle-npcs-") ? "present" : "missing",
          });
        }
      } else {
        const primary = valueAt(source, "system.primaryVehicle");
        this.#primaryVehicleId = typeof primary === "string" ? primary : undefined;
        for (const raw of members) {
          if (!raw || Array.isArray(raw) || typeof raw !== "object") continue;
          const actor = (raw as Record<string, JsonValue>).actor;
          if (typeof actor !== "string") continue;
          this.#memberDrafts.push({ kind, actorId: actor, name: actor, actorType: actor === primary ? "vehicle" : "npc", libraryState: "missing" });
        }
      }
    }

    #renderEffectSection(): HTMLElement {
      const block = element("div");
      const label = element("label");
      const toggle = fields.createCheckboxInput({ name: "__effectOn", value: this.#builderEffectOn });
      // A checkbox's meaningful event is "change", not "click" — wired the same way the Copy window's pack
      // checkboxes are (EagleLibrary/v13/copy-application.ts), not through data-action (that dispatch is for clicks).
      toggle.addEventListener("change", () => void this.toggleEffect());
      label.append(toggle, document.createTextNode(` ${text("EAGLEHOMEBREW.window.activity.effectToggle")}`));
      block.append(label);
      if (!this.#builderEffectOn) return block;

      const name = fields.createTextInput({
        name: "__effectName",
        value: this.#effectNameValue,
        placeholder: text("EAGLEHOMEBREW.window.activity.effectNamePlaceholder"),
      });
      this.#builderEffectNameInput = name;
      block.append(fields.createFormGroup({ label: text("EAGLEHOMEBREW.window.activity.effectName"), input: name }));

      this.#builderEffectChangeInputs.clear();
      for (const row of this.#builderEffectChangeRows) {
        block.append(this.#renderEffectChangeRow(row, this.#effectChangeValues.get(row), this.#builderEffectChangeInputs, "removeEffectChange"));
      }
      const addRow = element("button", text("EAGLEHOMEBREW.window.activity.addChange"));
      addRow.type = "button";
      addRow.dataset.action = "addEffectChange";
      block.append(addRow);
      return block;
    }

    #renderBackButton(): HTMLElement {
      const button = element("button", text("EAGLEHOMEBREW.window.back"));
      button.type = "button";
      button.dataset.action = "back";
      return button;
    }
  }

  return EagleHomebrewApplication;
}
