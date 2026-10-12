import { describe, expect, it } from "vitest";
import type { JsonValue, RequestSender } from "./create-pair";
import { changedPathIntents, changesFromIntents, chunkChanges, executeSave, planSave, projectCollection, projectMapping, type JsonObject } from "./edit-projection";

describe("M19 edit projection", () => {
  it("emits only changed known paths and keeps unknown siblings out of the patch", () => {
    const baseline = { name: "Old", system: { price: { value: 1 }, foreign: { keep: true } } } as JsonObject;
    const desired = { name: "New", system: { price: { value: 2 }, foreign: { keep: false } } } as JsonObject;
    expect(changesFromIntents(changedPathIntents(baseline, desired, ["name", "system.price.value"]))).toEqual({ name: "New", "system.price.value": 2 });
  });

  it("merges modeled entries and preserves opaque entries and foreign fields", () => {
    const current = [
      { _id: "known", type: "weapon", system: { value: 1, foreign: "keep" }, foreign: { exact: true } },
      { _id: "opaque", type: "loot", cargo: "keep" },
    ] as JsonObject[];
    const result = projectCollection(current, {
      baselineModeledIds: new Set(["known"]),
      desired: [{ _id: "known", type: "weapon", system: { value: 2 } }, { _id: "new", type: "weapon", system: {} }],
      compatible: (left, right) => left.type === right.type,
    });
    expect(result).toEqual({ ok: true, value: [
      { _id: "known", type: "weapon", system: { value: 2, foreign: "keep" }, foreign: { exact: true } },
      { _id: "opaque", type: "loot", cargo: "keep" },
      { _id: "new", type: "weapon", system: {} },
    ] });
  });

  it("blocks an opaque same-id collision", () => {
    expect(projectCollection([{ _id: "taken", type: "loot" }], {
      baselineModeledIds: new Set(), desired: [{ _id: "taken", type: "weapon" }], compatible: () => true,
    })).toMatchObject({ ok: false, reason: "id-collision" });
  });

  it("projects modeled mapping entries while preserving opaque entries and nested foreign fields", () => {
    expect(projectMapping(
      { known: { type: "attack", nested: { value: 1, foreign: true } }, opaque: { type: "foreign" } },
      new Set(["known"]),
      { known: { type: "attack", nested: { value: 2 } } },
      (left, right) => left.type === right.type,
    )).toEqual({ ok: true, value: {
      known: { type: "attack", nested: { value: 2, foreign: true } },
      opaque: { type: "foreign" },
    } });
  });

  it("batches at fifty paths and performs library before world with cloned payloads", async () => {
    const changes = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`system.v${index}`, index])) as JsonObject;
    expect(chunkChanges(changes).map((chunk) => Object.keys(chunk).length)).toEqual([50, 1]);
    const calls: { type: string; payload: JsonValue }[] = [];
    const sender: RequestSender = { request: async (type, payload) => {
      calls.push({ type, payload: JSON.parse(JSON.stringify(payload)) as JsonValue });
      (payload as { changes: Record<string, JsonValue> }).changes.mutated = true;
      return { ok: true, value: { changed: [] } };
    } };
    const plan = planSave(changes, { name: "World" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(await executeSave(sender, "Library.uuid", "World.uuid", plan)).toEqual({ ok: true, changed: true });
    expect(calls.map((call) => (call.payload as { uuid: string }).uuid)).toEqual(["Library.uuid", "Library.uuid", "World.uuid"]);
    expect(JSON.stringify(calls)).not.toContain("mutated");
  });

  it("preflights size before any write and makes a no-op request-free", async () => {
    expect(planSave({ items: "x".repeat(70_000) }, {})).toMatchObject({ ok: false, reason: "too-large" });
    let count = 0;
    const sender: RequestSender = { request: async () => { count += 1; return { ok: true, value: {} }; } };
    const plan = planSave({}, {});
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(await executeSave(sender, "L", "W", plan)).toEqual({ ok: true, changed: false });
    expect(count).toBe(0);
  });
});
