import type { JsonValue } from "./create-pair";
import { buildItemFieldData, VALID_PROPERTY_KEYS, type ItemField } from "./item-field-model";
import { buildActivityData, type ActivityType } from "./activity-model";

// M16a (dadm/m16a-02-apply-output.md, Entscheidung 1): NPC "Aktionen" are embedded Feat/Weapon Items
// (M16a Discover, Befund 1) — not a 14th creatable Homebrew kind, so these two field lists live here
// rather than in `item-field-model.ts`'s `ITEM_KIND_SPECS`. Deliberately narrower than the standalone
// `FEAT_FIELDS`/`WEAPON_FIELDS` (M8/M11): every PC-inventory-only concept an embedded action item does
// not need is left out (`prerequisites.*`/`enchant.*`/`advancement`/`startingEquipment` for Feat;
// `PHYSICAL_FIELDS`/`equippableFields`/`mountableFields` for Weapon — quantity, price, rarity,
// attunement, siege-mount stats mean nothing for a bite or claw attack, Non-Goal). Actual damage lives
// on the item's own embedded Activity (`damage.parts`, already fully built by M5-M7), not on the item's
// own `damage.base` — so `damage.*`/`type.baseItem` are Non-Goals here too, and Feat's `type.subtype`
// is left out entirely since "monster" (the only realistic value here) has no subtypes to pick from
// (Discover Befund 4). Every field uses only "select"/"number"/"text"/"set"/"formula" widgets, all
// already handled by the existing, widget-agnostic `renderFieldWidget`/`readFieldValue` — no new widget
// rendering code needed, and no `visibleWhen` gating either (Deploy simplification: these lists are
// already this short, an always-visible field costs nothing, the same "unconditionally visible"
// precedent Feat's own `crewed` already established, `core/item-field-model.ts`).
export type NpcActionItemType = "feat" | "weapon";

export const ACTION_FEAT_FIELDS: readonly ItemField[] = [
  { path: "identifier", section: "core", widget: "select", choicesKind: "legendaryActionIdentifiers" },
  { path: "type.value", section: "core", widget: "select", choicesKind: "featureTypes" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.feat },
  { path: "description.value", section: "core", widget: "text" },
  { path: "description.chat", section: "core", widget: "text" },
];

export const ACTION_WEAPON_FIELDS: readonly ItemField[] = [
  { path: "identifier", section: "core", widget: "select", choicesKind: "legendaryActionIdentifiers" },
  { path: "type.value", section: "core", widget: "select", choicesKind: "weaponTypes" },
  { path: "mastery", section: "core", widget: "select", choicesKind: "weaponMasteries" },
  { path: "properties", section: "core", widget: "set", choicesKind: "itemProperties", restrictChoicesTo: VALID_PROPERTY_KEYS.weapon },
  { path: "proficient", section: "core", widget: "number" },
  { path: "range.value", section: "core", widget: "number" },
  { path: "range.long", section: "core", widget: "number" },
  { path: "range.reach", section: "core", widget: "number" },
  { path: "range.units", section: "core", widget: "select", choicesKind: "distanceUnits" },
  { path: "ammunition.type", section: "core", widget: "select", choicesKind: "ammoTypes" },
  { path: "magicalBonus", section: "core", widget: "formula" },
  { path: "description.value", section: "core", widget: "text" },
  { path: "description.chat", section: "core", widget: "text" },
];

export function actionItemFields(itemType: NpcActionItemType): readonly ItemField[] {
  return itemType === "feat" ? ACTION_FEAT_FIELDS : ACTION_WEAPON_FIELDS;
}

// M16a Apply, Entscheidung 4: an exact mirror of dnd5e's own `NPCData#_prepareEmbedContext`
// (`npc.mjs:842-844`) — a "trait" property always wins, regardless of any Activity; otherwise the
// first (and, per this module's own Entscheidung 3, only) Activity's own `activation.type` decides.
// Anything else (e.g. "lair" — dnd5e defines the activation type, but `_prepareEmbedContext` has no
// bucket for it) never appears in the statblock at all — a real dnd5e-side limit, not a bug here.
export type NpcActionCategory = "trait" | "action" | "bonus" | "reaction" | "legendary" | "mythic" | "unlisted";

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(["trait", "action", "bonus", "reaction", "legendary", "mythic"]);

export function npcActionCategory(hasTraitProperty: boolean, firstActivationType: string | undefined): NpcActionCategory {
  const category = hasTraitProperty ? "trait" : firstActivationType || "trait";
  return (KNOWN_CATEGORIES.has(category) ? category : "unlisted") as NpcActionCategory;
}

// M16a Apply, Entscheidung 3: at most one Activity per Action item (`_prepareEmbedContext` only ever
// reads `activities.contents[0]`, Discover Befund 7) — no nested "trigger an Effect" sub-toggle either
// (Non-Goal, Deploy: three levels of nesting, Action item -> Activity -> Effect, is out of scope for
// this milestone; a standalone Effect builder for NPCs remains its own future milestone, same as it was
// for every other kind before M11b).
export interface NpcActionDraft {
  readonly itemType: NpcActionItemType;
  readonly name: string;
  readonly itemFieldValues: Readonly<Record<string, JsonValue>>;
  readonly activity?: { readonly type: ActivityType; readonly values: Readonly<Record<string, JsonValue>> };
}

// M16a Apply, Entscheidung 6: one `document.update` `changes.items` entry per draft (a whole-array
// write, the same already-proven mechanism `changes.effects` (M11b) and `changes.results` (M13) use) —
// reuses `buildItemFieldData`/`buildActivityData` unchanged, no new path-building logic. An empty draft
// list gives `{}`, the same "nothing to change" convention `buildActivitiesChanges` already has.
export function buildNpcActionItemsChanges(drafts: readonly NpcActionDraft[], newId: () => string): Record<string, JsonValue> {
  if (drafts.length === 0) return {};
  const items: JsonValue[] = drafts.map((draft) => {
    const itemId = newId();
    const system: Record<string, JsonValue> = buildItemFieldData(draft.itemFieldValues);
    if (draft.activity) {
      const activityId = newId();
      system.activities = { [activityId]: buildActivityData(draft.activity.type, draft.activity.values) };
    }
    return { _id: itemId, name: draft.name, type: draft.itemType, system };
  });
  return { items };
}
