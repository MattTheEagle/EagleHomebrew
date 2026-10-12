import { describe, expect, it } from "vitest";
import { entryByKey } from "./catalog";
import { executePairRetrofit, planPairRetrofit, type PairDocument } from "./pair-retrofit";
import type { JsonValue, RequestOutcome, RequestSender } from "./create-pair";

const weapon = entryByKey("weapons")!;
const world: PairDocument = { id: "same", uuid: "Actor.nope", documentName: "Item", type: "weapon" };

describe("M19 pair retrofit", () => {
  it("plans a missing counterpart using the selected rules version", () => {
    expect(planPairRetrofit(weapon, world, [{ collection: "world.eagle-weapons-2024", available: true, writable: true }], "2024", true)).toMatchObject({
      ok: true, pack: "world.eagle-weapons-2024", importRequired: true, fallbackUsed: true,
    });
  });

  it("blocks foreign collisions and ambiguous proven pairs", () => {
    const foreign = { id: "same", uuid: "Compendium.foreign", documentName: "Item", type: "weapon" };
    expect(planPairRetrofit(weapon, world, [{ collection: "world.eagle-weapons-2024", available: true, writable: true, entry: foreign }], "2024")).toMatchObject({ ok: false, reason: "foreign-collision" });
    const paired = (pack: string) => ({ collection: pack, available: true, writable: true, entry: { ...foreign, uuid: `Compendium.${pack}`, pair: { world: "Item" } } });
    expect(planPairRetrofit(weapon, world, [paired("world.eagle-weapons-2014"), paired("world.eagle-weapons-2024")], "2024")).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("uses and repairs a valid existing pair, but rejects unavailable or locked targets", () => {
    const pairedWorld = { ...world, pair: { pack: "world.eagle-weapons-2024" } };
    const library = { id: "same", uuid: "Compendium.world.eagle-weapons-2024.Item.same", documentName: "Item", type: "weapon", pair: { world: "Item" } };
    expect(planPairRetrofit(weapon, pairedWorld, [{ collection: "world.eagle-weapons-2024", available: true, writable: true, entry: library }], "2024")).toMatchObject({
      ok: true, importRequired: false, pack: "world.eagle-weapons-2024",
    });
    expect(planPairRetrofit(weapon, world, [{ collection: "world.eagle-weapons-2024", available: false, writable: false }], "2024")).toMatchObject({ ok: false, reason: "pack-unavailable" });
    expect(planPairRetrofit(weapon, world, [{ collection: "world.eagle-weapons-2024", available: true, writable: false }], "2024")).toMatchObject({ ok: false, reason: "pack-locked" });
  });

  it("repairs the Library flag before the world flag when an already paired document is incomplete", async () => {
    const calls: string[] = [];
    const sender: RequestSender = { request: async (_type, payload): Promise<RequestOutcome> => {
      calls.push((payload as { uuid: string }).uuid);
      return { ok: true, value: { changed: [] } };
    } };
    const library = { id: "same", uuid: "Compendium.world.eagle-weapons-2024.Item.same", documentName: "Item", type: "weapon", pair: {} };
    const result = await executePairRetrofit(sender, weapon, { ...world, pair: { pack: "world.eagle-weapons-2024" } }, {
      ok: true, pack: "world.eagle-weapons-2024", library, importRequired: false, fallbackUsed: false,
    });
    expect(result).toMatchObject({ ok: true });
    expect(calls).toEqual([library.uuid, world.uuid]);
  });

  it("imports once, then sets the world flag", async () => {
    const calls: { type: string; payload: JsonValue }[] = [];
    const sender: RequestSender = { request: async (type, payload): Promise<RequestOutcome> => {
      calls.push({ type, payload });
      if (type === "compendium.import") return { ok: true, value: { created: [{ uuid: "Compendium.world.eagle-weapons-2024.Item.same" }] } };
      return { ok: true, value: { changed: ["flags.eagle-homebrew.pair"] } };
    } };
    const result = await executePairRetrofit(sender, weapon, world, { ok: true, pack: "world.eagle-weapons-2024", importRequired: true, fallbackUsed: false });
    expect(result).toMatchObject({ ok: true, libraryUuid: "Compendium.world.eagle-weapons-2024.Item.same" });
    expect(calls.map((call) => call.type)).toEqual(["compendium.import", "document.update"]);
    expect(calls[0].payload).toEqual({ pack: "world.eagle-weapons-2024", sources: [{ source: world.uuid, id: "same", changes: { "flags.eagle-homebrew.pair": { world: "Item" } } }] });
  });
});
