import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import { allowedLibraryPacks, routeEditableDocument } from "./edit-routing";

describe("M19 edit routing", () => {
  it("routes exactly all 18 catalog entries", () => {
    expect(CATALOG).toHaveLength(18);
    for (const entry of CATALOG) {
      expect(routeEditableDocument({ documentName: entry.art, type: entry.subtype })).toBe(entry);
    }
  });

  it("rejects characters, embedded items, compendium documents and foreign types", () => {
    expect(routeEditableDocument({ documentName: "Actor", type: "character" })).toBeUndefined();
    expect(routeEditableDocument({ documentName: "Item", type: "weapon", embedded: true })).toBeUndefined();
    expect(routeEditableDocument({ documentName: "Item", type: "weapon", pack: "world.other" })).toBeUndefined();
    expect(routeEditableDocument({ documentName: "Item", type: "foreign" })).toBeUndefined();
  });

  it("derives versioned and unversioned targets", () => {
    expect(allowedLibraryPacks(CATALOG.find((entry) => entry.key === "weapons")!)).toEqual([
      "world.eagle-weapons-2014",
      "world.eagle-weapons-2024",
    ]);
    expect(allowedLibraryPacks(CATALOG.find((entry) => entry.key === "rolltables")!)).toEqual(["world.eagle-rolltables"]);
  });
});

