import { describe, expect, it } from "vitest";
import { buildVehicleDamageModifiers } from "./vehicle-damage-model";

describe("buildVehicleDamageModifiers", () => {
  it("builds the open damage-type/formula mapping, including ALL", () => {
    expect(buildVehicleDamageModifiers([
      { damageType: "fire", formula: "5" },
      { damageType: "ALL", formula: "@abilities.con.mod" },
    ])).toEqual({ ok: true, amount: { fire: "5", ALL: "@abilities.con.mod" } });
  });

  it("rejects an empty or duplicate damage type", () => {
    expect(buildVehicleDamageModifiers([{ damageType: "", formula: "1" }])).toEqual({ ok: false, reason: "missing-type" });
    expect(buildVehicleDamageModifiers([{ damageType: "fire", formula: "1" }, { damageType: "fire", formula: "2" }])).toEqual({ ok: false, reason: "duplicate-type" });
  });
});
