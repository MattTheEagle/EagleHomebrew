import type { JsonValue } from "./create-pair";

// The simplified model for an ActiveEffect an Activity triggers (N22, M5 Apply section 4). Unlike an Activity, an
// ActiveEffect is its own embedded Foundry document (M5 Discover, Befund 4: `item.effects`, not an Activity
// sub-field) — a separate, smaller model, not another ActivityTypeSpec.

// Foundry's CONST.ACTIVE_EFFECT_MODES (M5 Discover, Befund 4): a small, fixed set, not a CONFIG.DND5E.* runtime
// catalog, so it is safe to hold here directly instead of behind a ChoicesKind (core/activity-model.ts).
export const ACTIVE_EFFECT_MODES = {
  CUSTOM: 0,
  MULTIPLY: 1,
  ADD: 2,
  DOWNGRADE: 3,
  UPGRADE: 4,
  OVERRIDE: 5,
} as const;
export type ActiveEffectMode = (typeof ACTIVE_EFFECT_MODES)[keyof typeof ACTIVE_EFFECT_MODES];

export interface EffectChange {
  // The attribute path in the Actor or Item data the change modifies, e.g. "system.bonuses.mwak.damage".
  readonly key: string;
  readonly value: string;
  readonly mode: ActiveEffectMode;
}

export interface EffectModel {
  readonly id?: string;
  // Required (M5 Discover, Befund 4: ActiveEffect.name is `required: true, blank: false`) — the one true required
  // field in this whole research area; `validateName` (M4) is reused for it, not re-implemented.
  readonly name: string;
  readonly changes: readonly EffectChange[];
}

// Builds the data object for document.create/document.update to write a new ActiveEffect (M5 Apply, section 4). The
// changes list is passed through as-is: it is already an array of the shape dnd5e/Foundry expects (`{key, value,
// mode}`), the same "list value, not decomposed into indexed paths" treatment core/activity-model.ts gives
// array-shaped fields.
export function buildEffectData(effect: EffectModel): Record<string, JsonValue> {
  return {
    name: effect.name,
    changes: effect.changes.map((change) => ({ key: change.key, value: change.value, mode: change.mode })),
  };
}
