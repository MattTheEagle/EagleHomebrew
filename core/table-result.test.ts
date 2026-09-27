import { describe, expect, it } from "vitest";
import { buildTableResults } from "./table-result";

function fakeIds(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

describe("buildTableResults", () => {
  it("gives each entry an ascending range from its cumulative weight", () => {
    const { results, formula } = buildTableResults(
      [
        { text: "Nothing happens", weight: 3 },
        { text: "You find a coin", weight: 1 },
      ],
      fakeIds(),
    );
    expect(results).toEqual([
      { _id: "id1", type: "text", name: "Nothing happens", weight: 3, range: [1, 3] },
      { _id: "id2", type: "text", name: "You find a coin", weight: 1, range: [4, 4] },
    ]);
    expect(formula).toBe("1d4");
  });

  it("returns an empty result list and formula for no drafts", () => {
    expect(buildTableResults([], fakeIds())).toEqual({ results: [], formula: "" });
  });

  it("clamps a non-positive or fractional weight to a positive integer", () => {
    const { results, formula } = buildTableResults(
      [
        { text: "A", weight: 0 },
        { text: "B", weight: 2.6 },
        { text: "C", weight: -5 },
      ],
      fakeIds(),
    );
    expect(results).toEqual([
      { _id: "id1", type: "text", name: "A", weight: 1, range: [1, 1] },
      { _id: "id2", type: "text", name: "B", weight: 3, range: [2, 4] },
      { _id: "id3", type: "text", name: "C", weight: 1, range: [5, 5] },
    ]);
    expect(formula).toBe("1d5");
  });

  it("gives each result a fresh id from the caller", () => {
    const ids = ["a1b2c3d4e5f6g7h8", "h8g7f6e5d4c3b2a1"];
    let i = 0;
    const { results } = buildTableResults(
      [
        { text: "X", weight: 1 },
        { text: "Y", weight: 1 },
      ],
      () => ids[i++],
    );
    expect(results.map((r) => r._id)).toEqual(ids);
  });
});
