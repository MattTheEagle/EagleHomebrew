import { describe, expect, it, vi } from "vitest";
import { registerEditHooks, type EditHookDocument } from "./edit-hooks";

describe("M19 Foundry hooks", () => {
  it("registers one header and three directory hooks with the shared route", () => {
    const callbacks = new Map<string, (...args: unknown[]) => void>();
    const weapon: EditHookDocument = { id: "w", documentName: "Item", type: "weapon" };
    const open = vi.fn();
    registerEditHooks({
      hooks: { on: (name, callback) => callbacks.set(name, callback) },
      isGm: () => true,
      label: () => "Edit with Eagle Homebrew",
      resolve: (documentName, id) => documentName === "Item" && id === "w" ? weapon : undefined,
      open,
    });
    expect([...callbacks.keys()]).toEqual([
      "getHeaderControlsApplicationV2", "getActorContextOptions", "getItemContextOptions", "getRollTableContextOptions",
    ]);
    const controls: Record<string, unknown>[] = [];
    callbacks.get("getHeaderControlsApplicationV2")!({ document: weapon }, controls);
    callbacks.get("getHeaderControlsApplicationV2")!({ document: weapon }, controls);
    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({ action: "eagle-homebrew-edit", ownership: "OWNER" });
    (controls[0].onClick as () => void)();
    expect(open).toHaveBeenCalledWith(weapon);

    const options: Record<string, unknown>[] = [];
    callbacks.get("getItemContextOptions")!({}, options);
    const row = { dataset: { documentId: "w" } };
    expect((options[0].condition as (row: unknown) => boolean)(row)).toBe(true);
    (options[0].callback as (row: unknown) => void)(row);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("hides controls from non-GMs and unsupported documents", () => {
    const callbacks = new Map<string, (...args: unknown[]) => void>();
    registerEditHooks({ hooks: { on: (name, callback) => callbacks.set(name, callback) }, isGm: () => false, label: () => "Edit", resolve: () => undefined, open: vi.fn() });
    const controls: Record<string, unknown>[] = [];
    callbacks.get("getHeaderControlsApplicationV2")!({ document: { id: "c", documentName: "Actor", type: "character" } }, controls);
    expect(controls).toEqual([]);
  });
});

