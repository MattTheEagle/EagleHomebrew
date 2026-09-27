import { ACTIVE_EFFECT_MODES, type ActiveEffectMode, type EffectChange } from "./effect-model";

// M11c (dadm/m11c-02-apply-output.md, Entscheidung 1): a curated catalog of common ActiveEffect targets, so
// filling in a passive bonus never requires typing a raw dnd5e path ("system.bonuses.mwak.damage") or a roll
// formula reference ("@abilities.int.mod") by hand (M11-live-check-Runde-2, Fund 3). Every `key`/`mode` pair
// below is read from dnd5e 5.3.x's own actor schema (`module/data/actor/templates/*.mjs`), not guessed — see
// dadm/m11c-01-discover-output.md for the source line of each. Kept in `core/` (Foundry-free): only the
// *structure* of each target lives here; the option list for a target's own parameter (which ability, which
// skill, ...) is resolved live from `CONFIG.DND5E.*` in `v13/homebrew-application.ts`, the same architecture
// every other runtime catalog in this project already uses.

// A target whose own path needs a parameter (which ability/skill/tool) has `keyParameter` and a `{0}`
// placeholder in `key`. A target whose *value* is the parameter itself (add "fire" to the resistances set,
// not a number) has `valueParameter` instead and a fixed `key` — the two never both apply to one target.
export type EffectTargetKeyParameter = "ability" | "skill" | "tool";
export type EffectTargetValueParameter = "damageType" | "condition" | "language";

// "proficiencyLevel": dnd5e's own 0/0.5/1/2 scale (Not Proficient/Half/Proficient/Expertise, `RollConfigField`,
// `module/data/actor/templates/creature.mjs`) — a select, not a free number, and always paired with
// `ACTIVE_EFFECT_MODES.UPGRADE` (not OVERRIDE): a granted proficiency should raise the floor, never downgrade
// an actor who already has a higher one from somewhere else.
export type EffectTargetValueKind = "number" | "formula" | "proficiencyLevel" | "fixed";

export interface EffectTarget {
  readonly id: string;
  readonly mode: ActiveEffectMode;
  readonly valueKind: EffectTargetValueKind;
  readonly key: string;
  readonly keyParameter?: EffectTargetKeyParameter;
  readonly valueParameter?: EffectTargetValueParameter;
}

export const EFFECT_TARGETS: readonly EffectTarget[] = Object.freeze([
  { id: "armorClass", key: "system.attributes.ac.bonus", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "abilityScore", key: "system.abilities.{0}.value", keyParameter: "ability", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "number" },
  { id: "abilityCheck", key: "system.abilities.{0}.bonuses.check", keyParameter: "ability", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "allAbilityChecks", key: "system.bonuses.abilities.check", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "savingThrow", key: "system.abilities.{0}.bonuses.save", keyParameter: "ability", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "allSavingThrows", key: "system.bonuses.abilities.save", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "skillCheck", key: "system.skills.{0}.bonuses.check", keyParameter: "skill", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "allSkillChecks", key: "system.bonuses.abilities.skill", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "skillProficiency", key: "system.skills.{0}.value", keyParameter: "skill", mode: ACTIVE_EFFECT_MODES.UPGRADE, valueKind: "proficiencyLevel" },
  { id: "toolCheck", key: "system.tools.{0}.bonuses.check", keyParameter: "tool", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "toolProficiency", key: "system.tools.{0}.value", keyParameter: "tool", mode: ACTIVE_EFFECT_MODES.UPGRADE, valueKind: "proficiencyLevel" },
  { id: "movementSpeed", key: "system.attributes.movement.bonus", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "initiative", key: "system.attributes.init.bonus", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "hitPointMaximum", key: "system.attributes.hp.bonuses.overall", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "spellSaveDc", key: "system.bonuses.spell.dc", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "number" },
  { id: "meleeWeaponAttack", key: "system.bonuses.mwak.attack", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "meleeWeaponDamage", key: "system.bonuses.mwak.damage", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "rangedWeaponAttack", key: "system.bonuses.rwak.attack", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "rangedWeaponDamage", key: "system.bonuses.rwak.damage", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "meleeSpellAttack", key: "system.bonuses.msak.attack", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "rangedSpellAttack", key: "system.bonuses.rsak.attack", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "formula" },
  { id: "damageResistance", key: "system.traits.dr.value", valueParameter: "damageType", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "fixed" },
  { id: "damageImmunity", key: "system.traits.di.value", valueParameter: "damageType", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "fixed" },
  { id: "damageVulnerability", key: "system.traits.dv.value", valueParameter: "damageType", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "fixed" },
  { id: "conditionImmunity", key: "system.traits.ci.value", valueParameter: "condition", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "fixed" },
  { id: "language", key: "system.traits.languages.value", valueParameter: "language", mode: ACTIVE_EFFECT_MODES.ADD, valueKind: "fixed" },
]);

export function effectTargetById(id: string): EffectTarget | undefined {
  return EFFECT_TARGETS.find((target) => target.id === id);
}

// Resolves one curated selection into the {key, value, mode} shape `EffectChange`/`buildEffectData` already
// expect (core/effect-model.ts, unchanged) — the picker is purely a friendlier way to produce the exact same
// data an "Advanced" raw row would, not a new effect mechanism. `parameter` is the chosen ability/skill/tool/
// damageType/condition/language key (required exactly when the target has a `keyParameter`/`valueParameter`,
// ignored otherwise); `value` is the typed number/formula/proficiency level (ignored for a `valueKind:
// "fixed"` target, where `parameter` doubles as the value). Returns `undefined` for a target that needs a
// parameter it did not get, or a target id the catalog does not have (defensive, should not happen from the UI).
export function resolveEffectChange(targetId: string, parameter: string | undefined, value: string): EffectChange | undefined {
  const target = effectTargetById(targetId);
  if (!target) return undefined;
  if ((target.keyParameter || target.valueParameter) && !parameter) return undefined;
  const key = target.keyParameter ? target.key.replace("{0}", parameter!) : target.key;
  return { key, value: target.valueKind === "fixed" ? parameter! : value, mode: target.mode };
}
