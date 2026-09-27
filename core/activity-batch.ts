import type { JsonValue } from "./create-pair";
import { buildActivityData, type ActivityType } from "./activity-model";
import { buildEffectData, type EffectModel } from "./effect-model";

// One "Add Action"/"Add Bonus Action" entry the window has collected, not yet sent (M7 Apply, section 3): the type
// (M5) and its form values, plus an optional triggered effect (M5 Apply, section 4).
export interface ActivityDraft {
  readonly type: ActivityType;
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly effect?: EffectModel;
}

// Builds one document.update `changes` object for every collected draft, in one call (M7 Apply, section 3): each
// draft becomes its own `system.activities.<id>` entry; a draft with an effect also gets an entry in the shared
// `effects` array, referenced from the activity by the effect's own new id — the effect is built first so its id is
// known before the activity that points at it (M5 Apply, section 4, "Effekt zuerst, damit seine ID feststeht").
// `standaloneEffects` (M11b, dadm/m11b-02-apply-output.md, Entscheidung 1): effects the person added directly, with
// no Activity to trigger them — a plain permanent bonus (+1 AC, gains proficiency, ...). Foundry's own `transfer`
// default (true, unset here — dnd5e never overrides it either) already applies an Item's effects to its owner once
// created; nothing else distinguishes a standalone entry from an Activity-triggered one at the data level, so both
// share the exact same `effects` array, an activity-linked one just referenced back from its own activity too.
// An empty draft list gives an empty object: the caller sends no request for nothing to change.
export function buildActivitiesChanges(
  drafts: readonly ActivityDraft[],
  newId: () => string,
  standaloneEffects: readonly EffectModel[] = [],
): Record<string, JsonValue> {
  const changes: Record<string, JsonValue> = {};
  const effects: JsonValue[] = [];
  for (const draft of drafts) {
    let values = draft.values;
    if (draft.effect) {
      const effectId = newId();
      effects.push({ _id: effectId, ...buildEffectData(draft.effect) });
      values = { ...values, effects: [{ _id: effectId }] };
    }
    const activityId = newId();
    changes[`system.activities.${activityId}`] = buildActivityData(draft.type, values);
  }
  for (const effect of standaloneEffects) {
    effects.push({ _id: newId(), ...buildEffectData(effect) });
  }
  if (effects.length > 0) changes.effects = effects;
  return changes;
}
