import type { JsonValue } from "./create-pair";

// Turns dotted-path form values ("attack.ability": "str") into the nested object document.create and document.update
// expect (M4 Deploy: data.system.source.rules had to be `{ system: { source: { rules } } }`, not a literal
// "system.source.rules" key — document.create passes `data` straight through to Item.createDocuments, which does not
// expand dotted paths the way compendium.import's `changes` does). Generalizes that one-off fix so every caller with a
// flat, path-keyed form (M5's Activity/Effect builder, M8's catalog-field forms) shares one expansion, not one each.
//
// Purely structural: keeps whatever values it is given, including empty strings. Whether an empty value means "leave
// this out, let the dnd5e default apply" is a decision for the caller's own domain (activity-model.ts, catalog field
// forms, ...), not for this generic expansion.

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One path/value pair, expanded into a nested object. "a.b.c" with value v becomes { a: { b: { c: v } } }.
function expandPath(path: string, value: JsonValue): Record<string, JsonValue> {
  const segments = path.split(".");
  let node: JsonValue = value;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    node = { [segments[index]]: node };
  }
  return node as Record<string, JsonValue>;
}

// Deep-merges two expansions that may share a prefix ("attack.ability" and "attack.type.value" both touch `attack`).
// Both sides are always plain objects here (expandPath's own output, or a previous merge of it), never arrays or
// primitives at a shared key — a later path always wins on an actual collision (same full path given twice).
function mergeInto(target: Record<string, JsonValue>, source: Record<string, JsonValue>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isRecord(existing) && isRecord(value)) {
      const merged: Record<string, JsonValue> = { ...existing };
      mergeInto(merged, value);
      target[key] = merged;
    } else {
      target[key] = value;
    }
  }
}

// Builds one nested object from several dotted-path values at once, in iteration order of `values`.
export function buildPathData(values: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const [path, value] of Object.entries(values)) {
    mergeInto(result, expandPath(path, value));
  }
  return result;
}
