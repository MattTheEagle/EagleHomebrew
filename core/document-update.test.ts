import { describe, expect, it, vi } from "vitest";
import type { JsonValue, RequestOutcome, RequestSender } from "./create-pair";
import { updateDocument } from "./document-update";

const UUID = "Item.abcdefghij012345";

function fakeSender(outcome: RequestOutcome): { sender: RequestSender; calls: { type: string; payload: JsonValue }[] } {
  const calls: { type: string; payload: JsonValue }[] = [];
  const sender: RequestSender = {
    request: vi.fn(async (type: string, payload: JsonValue): Promise<RequestOutcome> => {
      calls.push({ type, payload });
      return outcome;
    }),
  };
  return { sender, calls };
}

describe("updateDocument", () => {
  it("sends a document.update request with the uuid and changes", async () => {
    const { sender, calls } = fakeSender({ ok: true, value: { uuid: UUID, changed: ["name"] } });
    await updateDocument(sender, UUID, { name: "Renamed" });
    expect(calls).toEqual([{ type: "document.update", payload: { uuid: UUID, changes: { name: "Renamed" } } }]);
  });

  it("returns the changed paths on success", async () => {
    const { sender } = fakeSender({ ok: true, value: { uuid: UUID, changed: ["system.weight.value", "name"] } });
    expect(await updateDocument(sender, UUID, { name: "x" })).toEqual({ ok: true, changed: ["system.weight.value", "name"] });
  });

  it("treats a missing or malformed changed list as empty, rather than failing", async () => {
    const { sender } = fakeSender({ ok: true, value: { uuid: UUID } });
    expect(await updateDocument(sender, UUID, { name: "x" })).toEqual({ ok: true, changed: [] });
  });

  it("passes a failure through unchanged", async () => {
    const { sender } = fakeSender({ ok: false, reason: "handler-failed", detail: "the document does not exist" });
    expect(await updateDocument(sender, UUID, { name: "x" })).toEqual({
      ok: false,
      reason: "handler-failed",
      detail: "the document does not exist",
    });
  });
});
