// Validates the name field of the creation form before a document.create request is ever built (M4 Apply, section 4).
// The rule is `document.create`'s own payload rule, not a new one: `data` needs "at least a non-empty `name` (at most
// 200 characters)" (EagleFlightControl/docs/api-contract.md, the "Documents" section, field `data`). Checking this
// locally, before the request, means an invalid name never reaches Flight Control's handler (which would answer
// `invalid-payload` for the same reason, but only after a round trip).

const MAX_NAME_LENGTH = 200;

export type NameValidation = { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: "empty" | "tooLong" };

export function validateName(raw: string): NameValidation {
  const name = raw.trim();
  if (name === "") return { ok: false, reason: "empty" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: "tooLong" };
  return { ok: true, name };
}
