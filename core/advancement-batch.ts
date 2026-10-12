import type { JsonValue } from "./create-pair";
import { buildAdvancementData, type AdvancementType } from "./advancement-model";

// One Advancement collected in the Homebrew form (M14 Apply, Entscheidung 6), the same shape
// `core/activity-batch.ts`'s `ActivityDraft` already has for Activities: everything needed to build the
// full entry, nothing about where it goes (that is `buildAdvancementChanges`'s job below). `table` holds
// the pre-built value of the one nested table this type has, if any (`ItemChoice.choices`,
// `ScaleValue.scale`, `Trait.choices` — built in v13/homebrew-application.ts, since assembling it needs
// reading several small per-row inputs, not a single flat path).
export interface AdvancementDraft {
  readonly id?: string;
  readonly type: AdvancementType;
  readonly level?: number;
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly table?: Readonly<Record<string, JsonValue>>;
}

// Writes each draft to its own `system.advancement.<id>` path (Discover Befund 9: a `MappingField`, the
// same shape `system.activities.<id>` already has) — sent via the same two `document.update` calls
// (library then world side) `createSimple()` already uses for Activities/Effects/Roll Table results.
export function buildAdvancementChanges(drafts: readonly AdvancementDraft[], newId: () => string): Record<string, JsonValue> {
  const changes: Record<string, JsonValue> = {};
  for (const draft of drafts) {
    const id = draft.id ?? newId();
    changes[`system.advancement.${id}`] = buildAdvancementData(draft.type, draft.level, draft.values, draft.table ?? {});
  }
  return changes;
}
