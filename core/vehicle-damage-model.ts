import type { JsonValue } from "./create-pair";

export interface VehicleDamageModifierDraft {
  readonly damageType: string;
  readonly formula: string;
}

export type VehicleDamageModifierBuildResult =
  | { readonly ok: true; readonly amount: Readonly<Record<string, JsonValue>> }
  | { readonly ok: false; readonly reason: "missing-type" | "duplicate-type" };

// `traits.dm.amount` is an open MappingField. The UI supplies a guided damage-type/formula row
// instead of asking for JSON; empty formulas are valid because dnd5e accepts an empty FormulaField.
export function buildVehicleDamageModifiers(drafts: readonly VehicleDamageModifierDraft[]): VehicleDamageModifierBuildResult {
  const amount: Record<string, JsonValue> = {};
  for (const draft of drafts) {
    const damageType = draft.damageType.trim();
    if (damageType === "") return { ok: false, reason: "missing-type" };
    if (Object.hasOwn(amount, damageType)) return { ok: false, reason: "duplicate-type" };
    amount[damageType] = draft.formula.trim();
  }
  return { ok: true, amount };
}
