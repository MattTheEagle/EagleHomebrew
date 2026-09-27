import { describe, expect, it, vi } from "vitest";
import { createPair, type CreatePairTarget, type JsonValue, type RequestOutcome, type RequestSender } from "./create-pair";

const TARGET: CreatePairTarget = { libraryPack: "world.eagle-loot-2014", worldType: "Item" };
const ID = "abcdefghij012345";
const DATA = { name: "Rope, 50 feet", type: "loot" };

// A fake Flight Control: a fake world compendium and a fake world collection, both backed by document.create's real
// rules (a given id is written once; asking again answers `created: false`). Good enough to prove the two-call
// sequence of createPair without a running Foundry (M2 Deploy acceptance).
function fakeFlightControl(over: { libraryFails?: string; worldFails?: string } = {}) {
  const library = new Map<string, JsonValue>();
  const world = new Map<string, JsonValue>();
  const calls: { type: string; payload: JsonValue }[] = [];

  const answer = (store: Map<string, JsonValue>, kind: "pack" | "world", payload: JsonValue): RequestOutcome => {
    const { target, id, data } = payload as { target: { pack?: string; world?: string }; id: string; data: Record<string, JsonValue> };
    const uuid = kind === "pack" ? `Compendium.${target.pack}.Item.${id}` : `Item.${id}`;
    if (store.has(id)) return { ok: true, value: { target, created: false, uuid, id, name: (store.get(id) as { name: string }).name } };
    store.set(id, data);
    return { ok: true, value: { target, created: true, uuid, id, name: data.name } };
  };

  const sender: RequestSender = {
    request: vi.fn(async (type: string, payload: JsonValue): Promise<RequestOutcome> => {
      calls.push({ type, payload });
      if (type !== "document.create") return { ok: false, reason: "unknown-request", detail: `not faked: ${type}` };
      const isLibrary = "pack" in (payload as { target: { pack?: string } }).target;
      if (isLibrary && over.libraryFails) return { ok: false, reason: "handler-failed", detail: over.libraryFails };
      if (!isLibrary && over.worldFails) return { ok: false, reason: "handler-failed", detail: over.worldFails };
      return answer(isLibrary ? library : world, isLibrary ? "pack" : "world", payload);
    }),
  };
  return { sender, calls, library, world };
}

describe("createPair", () => {
  it("creates the Library entry first, then the world document, both with the same id", async () => {
    const { sender, calls } = fakeFlightControl();
    const result = await createPair(sender, TARGET, ID, DATA);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ type: "document.create", payload: { target: { pack: TARGET.libraryPack }, id: ID } });
    expect(calls[1]).toMatchObject({ type: "document.create", payload: { target: { world: TARGET.worldType }, id: ID } });
    expect(result).toEqual({
      id: ID,
      library: { created: true, uuid: `Compendium.${TARGET.libraryPack}.Item.${ID}` },
      world: { created: true, uuid: `Item.${ID}` },
    });
  });

  it("gives the Library entry a flag naming the world side, and the world document a flag naming the Library side", async () => {
    const { sender, calls } = fakeFlightControl();
    await createPair(sender, TARGET, ID, DATA);
    const libraryPayload = calls[0]!.payload as { data: { flags: JsonValue } };
    const worldPayload = calls[1]!.payload as { data: { flags: JsonValue } };
    expect(libraryPayload.data.flags).toEqual({ "eagle-homebrew": { pair: { world: "Item" } } });
    expect(worldPayload.data.flags).toEqual({ "eagle-homebrew": { pair: { pack: TARGET.libraryPack } } });
  });

  it("carries the caller's data through to both sides, unchanged apart from the flag", async () => {
    const { sender, library, world } = fakeFlightControl();
    await createPair(sender, TARGET, ID, DATA);
    expect(library.get(ID)).toMatchObject(DATA);
    expect(world.get(ID)).toMatchObject(DATA);
  });

  it("does not ask for the world document when the Library entry fails, so no document is ever orphaned", async () => {
    const { sender, calls, world } = fakeFlightControl({ libraryFails: "compendium is locked" });
    const result = await createPair(sender, TARGET, ID, DATA);
    expect(calls).toHaveLength(1);
    expect(world.size).toBe(0);
    expect(result).toEqual({ id: ID, library: { failed: true, reason: "handler-failed", detail: "compendium is locked" } });
    expect(result.world).toBeUndefined();
  });

  it("reports a failed world side without undoing the Library entry, so a repeat can finish the pair", async () => {
    const { sender, library } = fakeFlightControl({ worldFails: "internal-error" });
    const result = await createPair(sender, TARGET, ID, DATA);
    expect(library.has(ID)).toBe(true);
    expect(result).toEqual({
      id: ID,
      library: { created: true, uuid: `Compendium.${TARGET.libraryPack}.Item.${ID}` },
      world: { failed: true, reason: "handler-failed", detail: "internal-error" },
    });
  });

  it("is safe to repeat after a partial failure: the Library side answers as existing, only the world side is written", async () => {
    const first = fakeFlightControl({ worldFails: "internal-error" });
    await createPair(first.sender, TARGET, ID, DATA);
    // A repeat reuses the same fake compendium and collection (simulating "the same world, asked again").
    const secondSender: RequestSender = {
      request: async (type, payload) => {
        const isLibrary = "pack" in (payload as { target: { pack?: string } }).target;
        const store = isLibrary ? first.library : first.world;
        const { id, data } = payload as { id: string; data: Record<string, JsonValue> };
        if (store.has(id)) return { ok: true, value: { created: false, uuid: "existing", id, name: (store.get(id) as { name: string }).name } };
        store.set(id, data);
        return { ok: true, value: { created: true, uuid: "new", id, name: data.name } };
      },
    };
    const result = await createPair(secondSender, TARGET, ID, DATA);
    expect(result.library).toMatchObject({ created: false });
    expect(result.world).toMatchObject({ created: true });
  });
});
