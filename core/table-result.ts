import type { JsonValue } from "./create-pair";

// A single row entered in the Homebrew form's table-entry builder (M13 Apply, Entscheidung 2): plain
// text plus its weight. Everything else a TableResult needs (id, type, range) is derived, never
// entered by hand (Entscheidungen 4/5) — no document-linked entries, no per-entry image or
// description in this milestone.
export interface TableResultDraft {
  readonly id?: string;
  readonly text: string;
  readonly weight: number;
}

export interface TableResultPlacement {
  readonly results: readonly Record<string, JsonValue>[];
  readonly formula: string;
}

// Foundry's own `RollTable#normalize()` computes each TableResult's `range` from the cumulative
// weights and sets `formula` to match; it is a client-only instance method on a document that
// already exists (M13 Discover Befund 7). Homebrew's drafts exist only before the RollTable is
// created and are written once, never edited through an open document instance afterwards (the same
// reason Activities/Effects are built as plain data, M5-M7) — so the same computation is redone here
// as pure, Foundry-free logic instead (core/ stays Foundry-free, M5 Apply). Weight is clamped to a
// positive integer, mirroring TableResult's own field constraint (`integer: true, positive: true`),
// so a stray 0 or a fractional value from the number input never produces an inverted or zero-width
// range.
export function buildTableResults(drafts: readonly TableResultDraft[], newId: () => string): TableResultPlacement {
  let cumulative = 0;
  const results = drafts.map((draft) => {
    const weight = Math.max(1, Math.round(draft.weight));
    const start = cumulative + 1;
    cumulative += weight;
    return {
      _id: draft.id ?? newId(),
      type: "text",
      name: draft.text,
      weight,
      range: [start, cumulative],
    };
  });
  return { results, formula: cumulative > 0 ? `1d${cumulative}` : "" };
}
