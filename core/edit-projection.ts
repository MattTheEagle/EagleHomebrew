import type { JsonValue, RequestSender } from "./create-pair";
import { updateDocument } from "./document-update";
import { findJsonViolation } from "./json-check";

export type JsonObject = Record<string, JsonValue>;

export interface PathIntent {
  readonly path: string;
  readonly value: JsonValue;
}

const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const same = (left: JsonValue | undefined, right: JsonValue | undefined): boolean => JSON.stringify(left) === JSON.stringify(right);

export function valueAt(source: JsonValue | undefined, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = source;
  for (const part of path.split(".")) {
    if (!value || Array.isArray(value) || typeof value !== "object") return undefined;
    value = (value as Record<string, JsonValue>)[part];
  }
  return value;
}

export function changedPathIntents(baseline: JsonObject, desired: JsonObject, paths: readonly string[]): PathIntent[] {
  return [...new Set(paths)].sort().flatMap((path) => {
    const before = valueAt(baseline, path);
    const after = valueAt(desired, path);
    return same(before, after) || after === undefined ? [] : [{ path, value: clone(after) }];
  });
}

export function changesFromIntents(intents: readonly PathIntent[]): JsonObject {
  return Object.fromEntries(intents.map((intent) => [intent.path, clone(intent.value)]));
}

export interface CollectionIntent {
  /** IDs that belonged to modeled rows when the editor opened. */
  readonly baselineModeledIds: ReadonlySet<string>;
  /** Complete freshly-built modeled rows after the user's edits. */
  readonly desired: readonly JsonObject[];
  /** Rejects a same-ID current row whose kind is incompatible with the modeled row. */
  readonly compatible: (current: JsonObject, desired: JsonObject) => boolean;
}

const idOf = (entry: JsonObject): string | undefined => typeof entry._id === "string" ? entry._id : undefined;

export function mergeJsonObjects(current: JsonObject, desired: JsonObject): JsonObject {
  const output = clone(current);
  for (const [key, value] of Object.entries(desired)) {
    const existing = output[key];
    output[key] = value && !Array.isArray(value) && typeof value === "object" && existing && !Array.isArray(existing) && typeof existing === "object"
      ? mergeJsonObjects(existing as JsonObject, value as JsonObject)
      : clone(value);
  }
  return output;
}

export type CollectionProjection =
  | { readonly ok: true; readonly value: readonly JsonObject[] }
  | { readonly ok: false; readonly reason: "missing-id" | "id-collision"; readonly detail: string };

/** Applies only explicit modeled add/edit/remove operations and leaves every opaque row in place. */
export function projectCollection(current: readonly JsonObject[], intent: CollectionIntent): CollectionProjection {
  const desiredById = new Map<string, JsonObject>();
  for (const entry of intent.desired) {
    const id = idOf(entry);
    if (!id) return { ok: false, reason: "missing-id", detail: JSON.stringify(entry) };
    if (desiredById.has(id)) return { ok: false, reason: "id-collision", detail: id };
    desiredById.set(id, entry);
  }
  const seen = new Set<string>();
  const output: JsonObject[] = [];
  for (const entry of current) {
    const id = idOf(entry);
    if (!id || !intent.baselineModeledIds.has(id)) {
      const desired = id ? desiredById.get(id) : undefined;
      if (desired) return { ok: false, reason: "id-collision", detail: id! };
      output.push(clone(entry));
      continue;
    }
    const desired = desiredById.get(id);
    if (!desired) continue;
    if (!intent.compatible(entry, desired)) return { ok: false, reason: "id-collision", detail: id };
    output.push(mergeJsonObjects(entry, desired));
    desiredById.delete(id);
    seen.add(id);
  }
  for (const [id, desired] of desiredById) {
    if (seen.has(id) || current.some((entry) => idOf(entry) === id)) return { ok: false, reason: "id-collision", detail: id };
    output.push(clone(desired));
  }
  return { ok: true, value: output };
}

export type MappingProjection = { readonly ok: true; readonly value: JsonObject } | { readonly ok: false; readonly reason: "id-collision"; readonly detail: string };

export function projectMapping(
  current: JsonObject,
  baselineModeledIds: ReadonlySet<string>,
  desired: JsonObject,
  compatible: (current: JsonObject, desired: JsonObject) => boolean,
): MappingProjection {
  const output: JsonObject = {};
  for (const [id, raw] of Object.entries(current)) {
    const desiredRaw = desired[id];
    if (!baselineModeledIds.has(id)) {
      if (desiredRaw !== undefined) return { ok: false, reason: "id-collision", detail: id };
      output[id] = clone(raw);
      continue;
    }
    if (desiredRaw === undefined) continue;
    if (!raw || Array.isArray(raw) || typeof raw !== "object" || !desiredRaw || Array.isArray(desiredRaw) || typeof desiredRaw !== "object") {
      return { ok: false, reason: "id-collision", detail: id };
    }
    if (!compatible(raw as JsonObject, desiredRaw as JsonObject)) return { ok: false, reason: "id-collision", detail: id };
    output[id] = mergeJsonObjects(raw as JsonObject, desiredRaw as JsonObject);
  }
  for (const [id, raw] of Object.entries(desired)) if (!Object.hasOwn(current, id)) output[id] = clone(raw);
  return { ok: true, value: output };
}

export function chunkChanges(changes: JsonObject, maximum = 50): readonly JsonObject[] {
  const entries = Object.entries(changes).sort(([left], [right]) => left.localeCompare(right));
  const chunks: JsonObject[] = [];
  for (let index = 0; index < entries.length; index += maximum) chunks.push(Object.fromEntries(entries.slice(index, index + maximum)));
  return chunks;
}

export type SavePlan =
  | { readonly ok: true; readonly library: readonly JsonObject[]; readonly world: readonly JsonObject[] }
  | { readonly ok: false; readonly reason: "not-json" | "too-large"; readonly detail: string };

export function planSave(
  libraryChanges: JsonObject,
  worldChanges: JsonObject,
  maximumLength = 65_536,
  libraryUuid = "",
  worldUuid = "",
): SavePlan {
  const library = chunkChanges(libraryChanges);
  const world = chunkChanges(worldChanges);
  // document.update normally runs on the GM client directly, but Flight Control may relay the exact
  // envelope. Check the largest valid relay envelope too: its two opaque IDs may each contain 128
  // characters, so the result cannot pass locally and fail only for a non-GM editor.
  const relaySize = (uuid: string, changes: JsonObject): number =>
    JSON.stringify({
      request: { module: "eagle-homebrew", type: "document.update", payload: { uuid, changes } },
      claim: { userId: "x".repeat(128), requestId: "x".repeat(128) },
    }).length;
  for (const [side, uuid, chunks] of [["library", libraryUuid, library], ["world", worldUuid, world]] as const) {
    for (let index = 0; index < chunks.length; index += 1) {
      const violation = findJsonViolation(chunks[index]);
      if (violation) return { ok: false, reason: "not-json", detail: `${side} ${index + 1}: ${violation}` };
      if (relaySize(uuid, chunks[index]) > maximumLength) {
        return { ok: false, reason: "too-large", detail: `${side} ${index + 1}` };
      }
    }
  }
  return { ok: true, library, world };
}

export type SaveResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly side: "library" | "world"; readonly batch: number; readonly reason: string; readonly detail: string };

export async function executeSave(sender: RequestSender, libraryUuid: string, worldUuid: string, plan: Extract<SavePlan, { ok: true }>): Promise<SaveResult> {
  if (plan.library.length === 0 && plan.world.length === 0) return { ok: true, changed: false };
  for (const [side, uuid, chunks] of [["library", libraryUuid, plan.library], ["world", worldUuid, plan.world]] as const) {
    for (let index = 0; index < chunks.length; index += 1) {
      const outcome = await updateDocument(sender, uuid, clone(chunks[index]));
      if (!outcome.ok) return { ok: false, side, batch: index + 1, reason: outcome.reason, detail: outcome.detail };
    }
  }
  return { ok: true, changed: true };
}
