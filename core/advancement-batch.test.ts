import { describe, expect, it } from "vitest";
import { buildAdvancementChanges } from "./advancement-batch";

function fakeIds(): () => string {
  let n = 0;
  return () => `adv${++n}`;
}

describe("buildAdvancementChanges", () => {
  it("writes each draft to its own system.advancement.<id> path", () => {
    const changes = buildAdvancementChanges(
      [
        { type: "HitPoints", values: {} },
        { type: "Subclass", level: 3, values: {} },
      ],
      fakeIds(),
    );
    expect(changes).toEqual({
      "system.advancement.adv1": { type: "HitPoints" },
      "system.advancement.adv2": { type: "Subclass", level: 3 },
    });
  });

  it("includes a draft's table in its own entry, not the others", () => {
    const changes = buildAdvancementChanges(
      [{ type: "ItemChoice", level: 3, values: { allowDrops: true }, table: { choices: { "3": { count: 1 } } } }],
      fakeIds(),
    );
    expect(changes).toEqual({
      "system.advancement.adv1": {
        type: "ItemChoice",
        configuration: { allowDrops: true, choices: { "3": { count: 1 } } },
      },
    });
  });

  it("returns an empty object for no drafts", () => {
    expect(buildAdvancementChanges([], fakeIds())).toEqual({});
  });

  it("gives each draft a fresh id from the caller, in order", () => {
    const ids = ["id-a", "id-b", "id-c"];
    let i = 0;
    const changes = buildAdvancementChanges(
      [
        { type: "HitPoints", values: {} },
        { type: "HitPoints", values: {} },
        { type: "HitPoints", values: {} },
      ],
      () => ids[i++],
    );
    expect(Object.keys(changes)).toEqual(["system.advancement.id-a", "system.advancement.id-b", "system.advancement.id-c"]);
  });

  it("writes a Species Size beside another Advancement without a level or runtime value", () => {
    expect(
      buildAdvancementChanges(
        [
          { type: "Size", values: { sizes: ["sm", "med"] } },
          { type: "Trait", level: 0, values: { grants: ["languages:standard:common"] } },
        ],
        fakeIds(),
      ),
    ).toEqual({
      "system.advancement.adv1": { type: "Size", configuration: { sizes: ["sm", "med"] } },
      "system.advancement.adv2": {
        type: "Trait",
        level: 0,
        configuration: { grants: ["languages:standard:common"] },
      },
    });
  });
});
