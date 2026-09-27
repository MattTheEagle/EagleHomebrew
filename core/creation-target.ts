// The version and duplicate-naming decision for a newly created Homebrew object (N14 c, N16). Unlike the Library, which
// copies existing documents and therefore needs a fallback chain between rulesets (its rule R6), a new object simply
// gets the world's current ruleset version (N16, no fallback) and, on a name collision, a renamed copy (N14 c) — the
// object is always created, never skipped.
import { duplicateName, entryKey, type EntryKey } from "./name-key";

export const RULES_VERSIONS = ["2014", "2024"] as const;
export type RulesVersion = (typeof RULES_VERSIONS)[number];

// Whether an object kind carries a ruleset version at all (library-convention.md, section 1): RollTable, Encounter and
// Group do not; everything else Homebrew creates does.
export interface CreationKind {
  readonly versioned: boolean;
}

// What planCreation needs to know about the target Eagle Compendium (for a versioned kind: the one compendium of the
// current ruleset version; for an unversioned kind: the one compendium there is).
export interface TargetIndex {
  // Every name key already in the target, for the renaming search (R8: name only, not name + requirements).
  readonly nameKeys: ReadonlySet<string>;
  // Whether this exact entry (name + requirements, rule R5) is in the target already.
  has(key: EntryKey): boolean;
}

export interface CreationPlacement {
  readonly name: string;
  readonly renamed: boolean;
  // Present only for a versioned kind.
  readonly version?: RulesVersion;
}

// Decides the name and, for a versioned kind, the ruleset version of a new object. `rulesVersion` is the world's
// current setting (see currentRulesVersion below); it is used only when `kind.versioned`.
export function planCreation(
  kind: CreationKind,
  rulesVersion: RulesVersion,
  name: string,
  requirements: unknown,
  target: TargetIndex,
): CreationPlacement {
  const version = kind.versioned ? rulesVersion : undefined;
  const key = entryKey(name, requirements);
  if (!target.has(key)) return { name, renamed: false, ...(version ? { version } : {}) };
  return { name: duplicateName(name, target.nameKeys), renamed: true, ...(version ? { version } : {}) };
}

// Reads the world's `rulesVersion` setting (dnd5e, direct read, N9 — no Flight Control request needed). `read` is
// `() => game.settings.get("dnd5e", "rulesVersion")` in Foundry (v13/module.ts, `homebrewWindowContext.readRulesVersion`,
// since M4).
//
// Cross-milestone fix (found during M15 Discover, 2026-09-27): the raw setting's actual values are `"modern"` and
// `"legacy"` (dnd5e's own `module/settings.mjs`), never literally `"2014"`/`"2024"` — the original M3 assumption
// (comparing the raw value against `RULES_VERSIONS` and falling back to `"2024"` otherwise) was wrong from the
// start, so every call before this fix silently took that "otherwise" fallback regardless of the world's actual
// setting. Masked so far because dnd5e's own default is `"modern"`, which happens to fall back to the same
// `"2024"` the old fallback already gave — a world actually set to legacy (2014) rules would have silently filed
// every new Homebrew object under the wrong, `-2024` compendium instead. Fixed by mirroring dnd5e's own
// translation exactly (`module/data/shared/source-field.mjs`: `rulesVersion === "modern" ? "2024" : "2014"`)
// instead of comparing against the wrong two strings.
export function currentRulesVersion(read: () => unknown): RulesVersion {
  return read() === "modern" ? "2024" : "2014";
}
