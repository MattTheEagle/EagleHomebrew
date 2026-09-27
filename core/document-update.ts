import type { JsonValue, RequestSender } from "./create-pair";

// A thin wrapper around document.update (Flight Control, M6), the same way core/create-pair.ts wraps document.create
// — reuses the same RequestSender interface unchanged (M7 Discover, Befund 2b: `request(type, payload)` already
// carries any request type, not just document.create).
export type UpdateOutcome =
  | { readonly ok: true; readonly changed: readonly string[] }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export async function updateDocument(
  sender: RequestSender,
  uuid: string,
  changes: Readonly<Record<string, JsonValue>>,
): Promise<UpdateOutcome> {
  const outcome = await sender.request("document.update", { uuid, changes });
  if (!outcome.ok) return { ok: false, reason: outcome.reason, detail: outcome.detail };
  const value = outcome.value as { changed?: unknown };
  const changed = Array.isArray(value.changed) ? value.changed.filter((entry): entry is string => typeof entry === "string") : [];
  return { ok: true, changed };
}
