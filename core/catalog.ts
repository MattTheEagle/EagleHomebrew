import type { HomebrewWorldType } from "./create-pair";

// The 18 object kinds Homebrew can create (M4 Apply, section 1), grouped by "Art" (dialog step 1) and, within Item,
// by subtype (dialog step 2). Modelled after EagleLibrary/core/catalog.ts (same shape, same helpers), but an
// independent copy (E7: no shared code between repos) without the `journals` entry — Homebrew creates no journal
// entries (`core/create-pair.ts`). `key` matches the Library's own catalog key exactly, because it is also the part
// of the compendium name Homebrew writes to (`eagle-<key>-<version>` or `eagle-<key>`, docs/library-convention.md
// section 1): a mismatch here would silently write to a compendium name the Library does not recognize.

export type Art = "Actor" | "Item" | "RollTable";

export interface CatalogEntry {
  // Part of the compendium name: `eagle-<key>` or `eagle-<key>-<version>`. Matches EagleLibrary/core/catalog.ts.
  readonly key: string;
  readonly art: Art;
  // Always equal to `art` for Homebrew (unlike the Library, which also knows JournalEntry); kept as its own field
  // because it names a different thing (the Foundry document type `createPair` needs, `core/create-pair.ts`), and
  // `HomebrewWorldType` already exists there.
  readonly worldType: HomebrewWorldType;
  // The dnd5e subtype (`system.type`/`type`), as EagleLibrary/core/catalog.ts records it. Absent only for Roll Table,
  // which has no subtype (it is the kind itself).
  readonly subtype?: string;
  readonly versioned: boolean;
  // The label of the dialog button for this kind (singular: creating one new object of this kind).
  readonly title: string;
  // Whether dnd5e mixes `ActivitiesTemplate` into this kind's data model (M7 Discover, Befund 1: `grep -l
  // ActivitiesTemplate module/data/item/*.mjs` gives exactly seven — `feat`, `weapon`, `tool`, `spell`,
  // `consumable`, `equipment`, `facility`; every other kind, including every Actor kind and `loot`, has none). The
  // Add Action/Add Bonus Action builder (M5-M7) only shows for a kind where this is true — writing
  // `system.activities` on a kind without it would sit outside that kind's own schema.
  readonly hasActivities: boolean;
  // Whether dnd5e's own item data model sets `metadata.hasEffects: true` (M11b Discover: `grep -rn hasEffects
  // module/data/item/` gives exactly six — `tool`, `weapon`, `equipment`, `consumable`, `feat`, `spell`; the base
  // `ItemDataModel` defaults it to `false`, and no other Item kind overrides it, including `container` and
  // `background`). Gates the standalone "Add Effect" builder (M11b) the same way `hasActivities` gates "Add
  // Action" — independently: a kind can have one, both, or neither. Actor kinds always support embedded
  // ActiveEffects natively in Foundry (not gated by this dnd5e Item-only flag at all), but none of them has a
  // Homebrew form yet, so this is left `false` for them until that kind's own milestone actually discovers it.
  readonly hasEffects: boolean;
  // M16a Discover Befund 1/5: NPC "Aktionen" are embedded Feat/Weapon Items, a structure no other kind
  // shares (`hasActivities`/`hasEffects` above are both, correctly, `false` for every Actor kind — an
  // Actor itself has neither `ActivitiesTemplate` nor `metadata.hasEffects`; this is a third, independent
  // concept: "this kind's own editor has an Actions sub-builder for its embedded items"). `true` only for
  // `npc` — no other kind (including the other three Actor kinds) has this milestone's Actions builder;
  // Vehicle could revisit the same question in its own future milestone, not assumed here.
  readonly hasActions: boolean;
}

const ACTIVITY_KINDS = new Set(["tool", "weapon", "feat", "spell", "consumable", "equipment", "facility"]);
const EFFECT_KINDS = new Set(["tool", "weapon", "equipment", "consumable", "feat", "spell"]);

const item = (key: string, subtype: string, title: string): CatalogEntry =>
  ({ key, art: "Item", worldType: "Item", subtype, versioned: true, title, hasActivities: ACTIVITY_KINDS.has(subtype), hasEffects: EFFECT_KINDS.has(subtype), hasActions: false });
const actor = (key: string, subtype: string, title: string, versioned: boolean, hasActions = false): CatalogEntry =>
  ({ key, art: "Actor", worldType: "Actor", subtype, versioned, title, hasActivities: false, hasEffects: false, hasActions });

// 18 entries, in the order of `04-milestone-plan.md` (simple, medium, high, special cases), matching
// EagleLibrary/docs/library-convention.md section 1 minus `journals`.
export const CATALOG: readonly CatalogEntry[] = Object.freeze(
  [
    item("loot", "loot", "Loot"),
    item("tools", "tool", "Tool"),
    item("weapons", "weapon", "Weapon"),
    item("equipment", "equipment", "Equipment"),
    item("consumables", "consumable", "Consumable"),
    item("containers", "container", "Container"),
    item("feats", "feat", "Feat"),
    item("spells", "spell", "Spell"),
    // dnd5e stores the subtype as "race"; its interface says "Species" (EagleLibrary/core/catalog.ts, same note).
    item("species", "race", "Species"),
    item("backgrounds", "background", "Background"),
    actor("npcs", "npc", "NPC", true, true),
    actor("vehicles", "vehicle", "Vehicle", true),
    item("classes", "class", "Class"),
    item("subclasses", "subclass", "Subclass"),
    item("facilities", "facility", "Facility"),
    actor("encounters", "encounter", "Encounter", false),
    actor("groups", "group", "Group", false),
    Object.freeze({
      key: "rolltables",
      art: "RollTable",
      worldType: "RollTable",
      versioned: false,
      title: "Roll Table",
      hasActivities: false,
      hasEffects: false,
      hasActions: false,
    }),
  ].map((entry) => Object.freeze(entry)),
);

// The entries of one Art, in catalog order: 13 for Item, 4 for Actor, the single "rolltables" entry for RollTable.
// RollTable's one entry is still returned here (an honest answer to "what are the kinds of this Art"); the window
// itself skips rendering it as its own subcategory step (M4 Apply, section 3) and jumps straight to the form.
export function subcategoriesOf(art: Art): readonly CatalogEntry[] {
  return CATALOG.filter((entry) => entry.art === art);
}

const byKey: ReadonlyMap<string, CatalogEntry> = new Map(CATALOG.map((entry) => [entry.key, entry]));

export function entryByKey(key: string): CatalogEntry | undefined {
  return byKey.get(key);
}
