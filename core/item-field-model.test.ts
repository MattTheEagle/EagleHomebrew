import { describe, expect, it } from "vitest";
import {
  ITEM_KIND_SPECS,
  VALID_PROPERTY_KEYS,
  buildItemFieldData,
  hasSubtypeCatalog,
  isArmorType,
  isEnchantmentSource,
  isEquipmentMountable,
  specForItemKind,
  weaponAttackType,
  weaponHasRange,
  weaponHasReach,
  type ItemFieldVisibilityContext,
} from "./item-field-model";

const ctx = (typeValue: string, ...properties: string[]): ItemFieldVisibilityContext => ({
  typeValue,
  properties: new Set(properties),
});

const ctxWithSubtype = (typeValue: string, typeSubtype: string, ...properties: string[]): ItemFieldVisibilityContext => ({
  typeValue,
  typeSubtype,
  properties: new Set(properties),
});

const KINDS = ["tool", "weapon"] as const;
const ALL_KINDS = ["tool", "weapon", "equipment", "consumable", "container", "feat", "background", "spell", "species"] as const;
// M14: Class/Subclass share the same DESCRIPTION_FIELDS as every other kind, but are deliberately excluded
// from ALL_KINDS above — they are the one exception to the M11 "identifier dropped everywhere" rule
// (Apply Entscheidung 1), so the "identifier dropped" test below must not iterate over them.
const M14_KINDS = ["class", "subclass"] as const;
// M15: Facility shares DESCRIPTION_FIELDS too, but keeps the M11 "no identifier" rule (unlike Class/Subclass) —
// its own constant so it can join the "dropped identifier" check ALL_KINDS is used for, not the M14 exception.
const M15_KINDS = ["facility"] as const;
// M16: NPC is an Actor, not an Item — it has no `ItemDescriptionTemplate` at all (no `identified`,
// no `description.*`, no `source.*`), so it is deliberately excluded from every DESCRIPTION_FIELDS/
// source.*-related check below; its own field list gets a dedicated test instead.
const M16_KINDS = ["npc"] as const;
// M17: Encounter/Group are Actors with GroupTemplate's own description/currency fields, not the
// Item-only DESCRIPTION_FIELDS the generic checks below cover.
const M17_KINDS = ["encounter", "group"] as const;
const M18_KINDS = ["vehicle"] as const;

describe("ITEM_KIND_SPECS", () => {
  it("has exactly the sixteen M8-M18 kinds", () => {
    expect(ITEM_KIND_SPECS.map((spec) => spec.kind).sort()).toEqual([...ALL_KINDS, ...M14_KINDS, ...M15_KINDS, ...M16_KINDS, ...M17_KINDS, ...M18_KINDS].sort());
  });

  it("marks every field with a path and a widget (no gaps, N21)", () => {
    for (const spec of ITEM_KIND_SPECS) {
      for (const field of spec.fields) {
        expect(field.path.length).toBeGreaterThan(0);
        expect(field.widget).toEqual(expect.any(String));
        expect(field.section).toEqual(expect.any(String));
      }
    }
  });

  it("gives every kind the shared Description fields, including the M11 retrofit (description.chat)", () => {
    for (const path of ["identified", "description.value", "description.chat"]) {
      for (const kind of [...ALL_KINDS, ...M14_KINDS, ...M15_KINDS]) {
        expect(specForItemKind(kind).fields.some((f) => f.path === path)).toBe(true);
      }
    }
  });

  it("dropped the source.* fields again (M11 live-check Runde 1, Fund 1: homebrew has no official-book source to record)", () => {
    for (const path of ["source.book", "source.page", "source.custom", "source.license", "source.revision", "source.rules"]) {
      for (const kind of [...ALL_KINDS, ...M14_KINDS, ...M15_KINDS]) {
        expect(specForItemKind(kind).fields.some((f) => f.path === path)).toBe(false);
      }
    }
  });

  it("dropped identifier again too (M11 live-check Runde 2, Fund 2: nobody could explain what it is for) — except Class/Subclass", () => {
    for (const kind of [...ALL_KINDS, ...M15_KINDS]) {
      expect(specForItemKind(kind).fields.some((f) => f.path === "identifier")).toBe(false);
    }
  });

  it("reinstates identifier for Class and Subclass (M14 Apply Entscheidung 1: needed for the classIdentifier link)", () => {
    for (const kind of M14_KINDS) {
      expect(specForItemKind(kind).fields.some((f) => f.path === "identifier")).toBe(true);
    }
  });

  it("gives only the five physical kinds Physical/Equippable fields — Feat/Background/Spell/Species have none (Discover Befund 3/4)", () => {
    const PHYSICAL_KINDS = ["tool", "weapon", "equipment", "consumable", "container"] as const;
    for (const path of ["weight.value", "price.denomination", "rarity", "container", "attunement", "equipped"]) {
      for (const kind of PHYSICAL_KINDS) expect(specForItemKind(kind).fields.some((f) => f.path === path)).toBe(true);
      for (const kind of ["feat", "background", "spell", "species"] as const) expect(specForItemKind(kind).fields.some((f) => f.path === path)).toBe(false);
    }
    // M10 Apply Entscheidung 2: Container alone excludes `quantity` (dnd5e forces it to 1 on every save).
    for (const kind of ["tool", "weapon", "equipment", "consumable"] as const) {
      expect(specForItemKind(kind).fields.some((f) => f.path === "quantity")).toBe(true);
    }
    expect(specForItemKind("container").fields.some((f) => f.path === "quantity")).toBe(false);
  });

  it("gives Tool its own type/ability/properties fields with the right choices kind", () => {
    const tool = specForItemKind("tool").fields;
    expect(tool.find((f) => f.path === "type.value")?.choicesKind).toBe("toolTypes");
    expect(tool.find((f) => f.path === "type.baseItem")?.choicesKind).toBe("toolBaseItems");
    expect(tool.find((f) => f.path === "ability")?.choicesKind).toBe("abilities");
    expect(tool.find((f) => f.path === "properties")?.choicesKind).toBe("itemProperties");
  });

  it("gives Weapon its own damage/type/range fields, and only Weapon the Mountable fields", () => {
    const weapon = specForItemKind("weapon").fields;
    expect(weapon.find((f) => f.path === "damage.base")?.widget).toBe("weaponDamagePart");
    expect(weapon.find((f) => f.path === "damage.versatile")?.widget).toBe("weaponDamagePart");
    expect(weapon.find((f) => f.path === "type.baseItem")?.choicesKind).toBe("weaponBaseItems");
    expect(weapon.find((f) => f.path === "range.units")?.choicesKind).toBe("distanceUnits");
    expect(weapon.find((f) => f.path === "mastery")?.choicesKind).toBe("weaponMasteries");
    for (const path of ["cover", "crew.max", "crew.value", "hp.value", "speed.units"]) {
      expect(weapon.some((f) => f.path === path)).toBe(true);
    }
    expect(specForItemKind("tool").fields.some((f) => f.section === "mountable")).toBe(false);
  });

  it("has no duplicate paths within one kind", () => {
    for (const spec of ITEM_KIND_SPECS) {
      const paths = spec.fields.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it("gives type.baseItem the baseItemSelect widget (M8a/M9), for every kind that has one", () => {
    for (const kind of ["tool", "weapon", "equipment"] as const) {
      expect(specForItemKind(kind).fields.find((f) => f.path === "type.baseItem")?.widget).toBe("baseItemSelect");
    }
    // M9 Discover Befund 3: Consumable's ItemTypeField excludes baseItem entirely.
    expect(specForItemKind("consumable").fields.some((f) => f.path === "type.baseItem")).toBe(false);
  });

  it("M8a: marks the conditional Weapon/shared fields with a visibleWhen, and leaves unconditional fields without one", () => {
    const weapon = specForItemKind("weapon").fields;
    for (const path of ["damage.versatile", "ammunition.type", "magicalBonus", "proficient", "range.value", "range.long", "range.reach", "attunement", "attuned"]) {
      expect(weapon.find((f) => f.path === path)?.visibleWhen).toEqual(expect.any(Function));
    }
    for (const path of ["mastery", "properties", "equipped"]) {
      expect(weapon.find((f) => f.path === path)?.visibleWhen).toBeUndefined();
    }
    // M8a follow-up, live-check finding: armor.value only appears inside dnd5e's own Mountable partial
    // (details-mountable.hbs), not as an always-on field — it needs the same isMountable condition.
    expect(weapon.find((f) => f.path === "armor.value")?.visibleWhen).toEqual(expect.any(Function));
    expect(weapon.filter((f) => f.section === "mountable").every((f) => typeof f.visibleWhen === "function")).toBe(true);
    const tool = specForItemKind("tool").fields;
    expect(tool.find((f) => f.path === "attunement")?.visibleWhen).toEqual(expect.any(Function));
    expect(tool.find((f) => f.path === "ability")?.visibleWhen).toBeUndefined();
  });
});

describe("Equipment fields (M9)", () => {
  const equipment = specForItemKind("equipment").fields;

  it("has its own type/armor/strength fields with the right choices kind", () => {
    expect(equipment.find((f) => f.path === "type.value")?.choicesKind).toBe("equipmentTypes");
    expect(equipment.find((f) => f.path === "type.baseItem")?.choicesKind).toBe("equipmentBaseItems");
    expect(equipment.find((f) => f.path === "armor.value")?.widget).toBe("number");
    expect(equipment.find((f) => f.path === "armor.dex")?.widget).toBe("number");
    expect(equipment.find((f) => f.path === "armor.magicalBonus")?.widget).toBe("formula");
    expect(equipment.find((f) => f.path === "strength")?.widget).toBe("number");
  });

  it("gates type.baseItem/armor.dex/strength on the five armor/shield type values, unlike Tool/Weapon's always-on baseItem", () => {
    for (const path of ["type.baseItem", "armor.dex", "strength"]) {
      expect(equipment.find((f) => f.path === path)?.visibleWhen).toEqual(expect.any(Function));
    }
    expect(equipment.find((f) => f.path === "armor.value")?.visibleWhen).toBeUndefined();
  });

  it("hides armor.dex only for shield, unlike strength/baseItem which stay visible", () => {
    const dexVisible = equipment.find((f) => f.path === "armor.dex")?.visibleWhen!;
    const strengthVisible = equipment.find((f) => f.path === "strength")?.visibleWhen!;
    expect(dexVisible(ctx("light"))).toBe(true);
    expect(dexVisible(ctx("shield"))).toBe(false);
    expect(strengthVisible(ctx("shield"))).toBe(true);
    expect(strengthVisible(ctx("clothing"))).toBe(false);
  });

  it("hides Attunement/Attuned for a vehicle even when magical, unlike Tool/Weapon (Discover Befund 4)", () => {
    const attunementVisible = equipment.find((f) => f.path === "attunement")?.visibleWhen!;
    expect(attunementVisible(ctx("light", "mgc"))).toBe(true);
    expect(attunementVisible(ctx("vehicle", "mgc"))).toBe(false);
    expect(attunementVisible(ctx("vehicle"))).toBe(false);
  });

  it("only shows the Mountable block for type.value \"vehicle\", not \"siege\" (unlike Weapon)", () => {
    const mountablePaths = equipment.filter((f) => f.section === "mountable");
    expect(mountablePaths.length).toBeGreaterThan(0);
    for (const field of mountablePaths) {
      expect(field.visibleWhen!(ctx("vehicle"))).toBe(true);
      expect(field.visibleWhen!(ctx("siege"))).toBe(false);
    }
  });
});

describe("Consumable fields (M9)", () => {
  const consumable = specForItemKind("consumable").fields;

  it("has its own type/subtype/uses fields with the right widgets and choices kind", () => {
    expect(consumable.find((f) => f.path === "type.value")?.choicesKind).toBe("consumableTypes");
    expect(consumable.find((f) => f.path === "type.subtype")?.widget).toBe("dependentSubtypeSelect");
    expect(consumable.find((f) => f.path === "type.subtype")?.choicesKind).toBe("consumableTypes");
    expect(consumable.find((f) => f.path === "uses.spent")?.widget).toBe("number");
    expect(consumable.find((f) => f.path === "uses.max")?.widget).toBe("formula");
    expect(consumable.find((f) => f.path === "uses.recovery")?.widget).toBe("list");
    expect(consumable.find((f) => f.path === "uses.autoDestroy")?.widget).toBe("checkbox");
    expect(consumable.filter((f) => f.section === "uses").length).toBe(4);
  });

  it("reuses Weapon's exact weaponDamagePart widget for damage.base, gated to type.value \"ammo\"", () => {
    const damageBase = consumable.find((f) => f.path === "damage.base");
    expect(damageBase?.widget).toBe("weaponDamagePart");
    expect(damageBase?.visibleWhen!(ctx("ammo"))).toBe(true);
    expect(damageBase?.visibleWhen!(ctx("potion"))).toBe(false);
    const damageReplace = consumable.find((f) => f.path === "damage.replace");
    expect(damageReplace?.widget).toBe("checkbox");
    expect(damageReplace?.visibleWhen!(ctx("ammo"))).toBe(true);
  });

  it("shows magicalBonus only when both magical and type.value is ammo (composed visibleWhen)", () => {
    const magicalBonus = consumable.find((f) => f.path === "magicalBonus")?.visibleWhen!;
    expect(magicalBonus(ctx("ammo", "mgc"))).toBe(true);
    expect(magicalBonus(ctx("ammo"))).toBe(false);
    expect(magicalBonus(ctx("potion", "mgc"))).toBe(false);
  });

  it("shows type.subtype only for ammo/poison (hasSubtypeCatalog)", () => {
    const subtypeVisible = consumable.find((f) => f.path === "type.subtype")?.visibleWhen!;
    expect(subtypeVisible(ctx("ammo"))).toBe(true);
    expect(subtypeVisible(ctx("poison"))).toBe(true);
    expect(subtypeVisible(ctx("potion"))).toBe(false);
    expect(subtypeVisible(ctx(""))).toBe(false);
  });

  it("has no MountableTemplate fields, unlike Equipment/Weapon", () => {
    expect(consumable.some((f) => f.section === "mountable")).toBe(false);
  });
});

describe("Container fields (M10)", () => {
  const container = specForItemKind("container").fields;

  it("has its own capacity/currency fields with the right widgets and choices kind", () => {
    expect(container.find((f) => f.path === "capacity.count")?.widget).toBe("number");
    expect(container.find((f) => f.path === "capacity.volume.value")?.widget).toBe("number");
    expect(container.find((f) => f.path === "capacity.volume.units")?.choicesKind).toBe("volumeUnits");
    expect(container.find((f) => f.path === "capacity.weight.value")?.widget).toBe("number");
    expect(container.find((f) => f.path === "capacity.weight.units")?.choicesKind).toBe("weightUnits");
    for (const key of ["pp", "gp", "ep", "sp", "cp"]) {
      expect(container.find((f) => f.path === `currency.${key}`)?.widget).toBe("number");
    }
  });

  it("has no type.* fields at all, unlike every other reused kind (no ItemTypeTemplate)", () => {
    expect(container.some((f) => f.path.startsWith("type."))).toBe(false);
  });

  it("has no visibleWhen among its own new fields — only the shared attunement/attuned (equippableFields) carry one", () => {
    const ownPaths = ["properties", "capacity.count", "capacity.volume.value", "capacity.volume.units", "capacity.weight.value", "capacity.weight.units", "currency.pp", "currency.gp", "currency.ep", "currency.sp", "currency.cp"];
    for (const path of ownPaths) expect(container.find((f) => f.path === path)?.visibleWhen).toBeUndefined();
    expect(container.find((f) => f.path === "attunement")?.visibleWhen).toEqual(expect.any(Function));
    expect(container.find((f) => f.path === "attuned")?.visibleWhen).toEqual(expect.any(Function));
    expect(container.find((f) => f.path === "equipped")?.visibleWhen).toBeUndefined();
  });

  it("has no Mountable and no Uses fields, unlike Equipment/Consumable", () => {
    expect(container.some((f) => f.section === "mountable")).toBe(false);
    expect(container.some((f) => f.section === "uses")).toBe(false);
  });

  it("has no duplicate paths (currency/capacity additions did not collide with shared fields)", () => {
    const paths = container.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("Feat fields (M11)", () => {
  const feat = specForItemKind("feat").fields;

  it("has its own type/subtype/requirements/prerequisites fields with the right widgets and choices kind", () => {
    expect(feat.find((f) => f.path === "type.value")?.choicesKind).toBe("featureTypes");
    expect(feat.find((f) => f.path === "type.subtype")?.widget).toBe("dependentSubtypeSelect");
    expect(feat.find((f) => f.path === "type.subtype")?.choicesKind).toBe("featureTypes");
    expect(feat.find((f) => f.path === "requirements")?.widget).toBe("text");
    expect(feat.find((f) => f.path === "prerequisites.level")?.widget).toBe("number");
    expect(feat.find((f) => f.path === "prerequisites.items")?.widget).toBe("set");
    expect(feat.find((f) => f.path === "prerequisites.repeatable")?.widget).toBe("checkbox");
    expect(feat.find((f) => f.path === "properties")?.choicesKind).toBe("itemProperties");
  });

  it("shows cover only for a vehicle feature, but always shows crewed (dnd5e's own sheet omits it entirely, N21)", () => {
    expect(feat.find((f) => f.path === "cover")?.visibleWhen!(ctx("vehicle"))).toBe(true);
    expect(feat.find((f) => f.path === "cover")?.visibleWhen!(ctx("monster"))).toBe(false);
    expect(feat.find((f) => f.path === "crewed")?.visibleWhen).toBeUndefined();
  });

  it("shows enchant.max/enchant.period only for an enchantment-source feature (isEnchantmentSource)", () => {
    const max = feat.find((f) => f.path === "enchant.max");
    const period = feat.find((f) => f.path === "enchant.period");
    expect(max?.widget).toBe("formula");
    expect(period?.choicesKind).toBe("enchantmentPeriods");
    expect(max?.visibleWhen!(ctxWithSubtype("enchantment", "rune"))).toBe(true);
    expect(period?.visibleWhen!(ctxWithSubtype("enchantment", "artificerInfusion"))).toBe(true);
    expect(max?.visibleWhen!(ctxWithSubtype("enchantment", "somethingElse"))).toBe(false);
    expect(max?.visibleWhen!(ctx("feat"))).toBe(false);
  });

  it("leaves advancement to the guided M16b builder", () => {
    expect(feat.some((f) => f.path === "advancement")).toBe(false);
  });

  it("has no MountableTemplate/UsesTemplate fields (not a physical item)", () => {
    expect(feat.some((f) => f.section === "mountable")).toBe(false);
    expect(feat.some((f) => f.section === "uses")).toBe(false);
  });

  it("has no duplicate paths", () => {
    const paths = feat.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("Background fields (M11)", () => {
  const background = specForItemKind("background").fields;

  it("has wealth plus startingEquipment as the remaining raw JSON fallback", () => {
    expect(background.find((f) => f.path === "wealth")?.widget).toBe("formula");
    const startingEquipment = background.find((f) => f.path === "startingEquipment");
    expect(background.some((f) => f.path === "advancement")).toBe(false);
    expect(startingEquipment?.section).toBe("advanced");
    expect(startingEquipment?.widget).toBe("list");
  });

  it("has no type.*, no Physical/Equippable fields, and no visibleWhen anywhere (the narrowest kind)", () => {
    expect(background.some((f) => f.path.startsWith("type."))).toBe(false);
    expect(background.some((f) => f.path === "attunement")).toBe(false);
    expect(background.every((f) => f.visibleWhen === undefined)).toBe(true);
  });

  it("has exactly the description-retrofit fields plus its own two (no Activities, no Physical)", () => {
    expect(background.length).toBe(5);
  });
});

describe("Spell fields (M12)", () => {
  const spell = specForItemKind("spell").fields;

  it("has its own type/casting fields with the right widgets and choices kind", () => {
    expect(spell.find((f) => f.path === "school")?.choicesKind).toBe("spellSchools");
    expect(spell.find((f) => f.path === "level")?.widget).toBe("number");
    expect(spell.find((f) => f.path === "ability")?.choicesKind).toBe("abilities");
    expect(spell.find((f) => f.path === "method")?.choicesKind).toBe("spellcastingMethods");
    expect(spell.find((f) => f.path === "prepared")?.choicesKind).toBe("spellPreparationStates");
    expect(spell.find((f) => f.path === "properties")?.restrictChoicesTo).toBe(VALID_PROPERTY_KEYS.spell);
    expect(spell.find((f) => f.path === "sourceItem")?.widget).toBe("text");
  });

  it("reuses the exact activation/duration/range/target paths core/activity-model.ts already built widgets for", () => {
    const paths = [
      "activation.type",
      "activation.value",
      "activation.condition",
      "duration.value",
      "duration.units",
      "duration.special",
      "duration.concentration",
      "range.value",
      "range.units",
      "range.special",
      "target.template.count",
      "target.template.type",
      "target.template.size",
      "target.template.width",
      "target.affects.count",
      "target.affects.type",
      "target.affects.choice",
    ];
    for (const path of paths) expect(spell.some((f) => f.path === path), path).toBe(true);
    expect(spell.find((f) => f.path === "activation.type")?.choicesKind).toBe("activationTypes");
  });

  it("gives duration/range/target-type fields a select widget with a choicesKind, not free text (M12 live-check rework)", () => {
    expect(spell.find((f) => f.path === "duration.units")?.widget).toBe("select");
    expect(spell.find((f) => f.path === "duration.units")?.choicesKind).toBe("durationUnits");
    expect(spell.find((f) => f.path === "range.units")?.widget).toBe("select");
    expect(spell.find((f) => f.path === "range.units")?.choicesKind).toBe("distanceUnits");
    expect(spell.find((f) => f.path === "target.template.type")?.widget).toBe("select");
    expect(spell.find((f) => f.path === "target.template.type")?.choicesKind).toBe("areaTargetTypes");
    expect(spell.find((f) => f.path === "target.affects.type")?.widget).toBe("select");
    expect(spell.find((f) => f.path === "target.affects.type")?.choicesKind).toBe("individualTargetTypes");
  });

  it("has no Mountable/Uses/Physical fields, and no visibleWhen anywhere", () => {
    expect(spell.some((f) => f.section === "mountable")).toBe(false);
    expect(spell.some((f) => f.section === "uses")).toBe(false);
    expect(spell.some((f) => f.path === "quantity")).toBe(false);
    expect(spell.every((f) => f.visibleWhen === undefined)).toBe(true);
  });

  it("has no duplicate paths", () => {
    const paths = spell.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("Species fields (M12)", () => {
  const species = specForItemKind("species").fields;

  it("has its own type/movement/senses fields with the right widgets and choices kind", () => {
    expect(species.find((f) => f.path === "type.value")?.choicesKind).toBe("creatureTypes");
    expect(species.find((f) => f.path === "type.subtype")?.widget).toBe("text");
    expect(species.find((f) => f.path === "type.custom")?.widget).toBe("text");
    for (const type of ["walk", "burrow", "climb", "fly", "swim"]) {
      expect(species.find((f) => f.path === `movement.${type}`)?.widget).toBe("formula");
    }
    expect(species.find((f) => f.path === "movement.units")?.choicesKind).toBe("movementUnits");
    for (const sense of ["darkvision", "blindsight", "tremorsense", "truesight"]) {
      expect(species.find((f) => f.path === `senses.ranges.${sense}`)?.widget).toBe("number");
    }
    expect(species.find((f) => f.path === "senses.units")?.choicesKind).toBe("movementUnits");
  });

  it("has no type.subtype dependent-select, unlike Feat/Consumable (Discover Befund 4: a plain StringField)", () => {
    expect(species.find((f) => f.path === "type.subtype")?.widget).not.toBe("dependentSubtypeSelect");
  });

  it("leaves advancement to the guided M16b builder", () => {
    expect(species.some((f) => f.path === "advancement")).toBe(false);
  });

  it("has no Physical/Equippable/Activities/Uses fields, and no visibleWhen anywhere", () => {
    expect(species.some((f) => f.path === "attunement")).toBe(false);
    expect(species.some((f) => f.section === "mountable")).toBe(false);
    expect(species.some((f) => f.section === "uses")).toBe(false);
    expect(species.every((f) => f.visibleWhen === undefined)).toBe(true);
  });

  it("has no duplicate paths", () => {
    const paths = species.map((f) => f.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("isEnchantmentSource (M11, mirrors FeatData#isEnchantmentSource)", () => {
  it("is true only for type.value \"enchantment\" with subtype artificerInfusion/rune", () => {
    expect(isEnchantmentSource(ctxWithSubtype("enchantment", "rune"))).toBe(true);
    expect(isEnchantmentSource(ctxWithSubtype("enchantment", "artificerInfusion"))).toBe(true);
    expect(isEnchantmentSource(ctxWithSubtype("enchantment", "other"))).toBe(false);
    expect(isEnchantmentSource(ctx("enchantment"))).toBe(false);
    expect(isEnchantmentSource(ctxWithSubtype("feat", "rune"))).toBe(false);
  });
});

describe("properties field restriction (M11 live-check rework, Fund 1: mirrors CONFIG.DND5E.validProperties per kind)", () => {
  const RESTRICTED_KINDS = ["tool", "weapon", "equipment", "consumable", "container", "feat", "spell", "class"] as const;

  it("gives every restricted kind's properties field a restrictChoicesTo matching VALID_PROPERTY_KEYS", () => {
    for (const kind of RESTRICTED_KINDS) {
      const field = specForItemKind(kind).fields.find((f) => f.path === "properties");
      expect(field?.restrictChoicesTo, kind).toBe(VALID_PROPERTY_KEYS[kind]);
    }
  });

  it("Feat only allows Magical and Trait, not weapon-only properties like Ammunition/Heavy/Reload", () => {
    const feat = VALID_PROPERTY_KEYS.feat!;
    expect([...feat].sort()).toEqual(["mgc", "trait"]);
    for (const weaponOnly of ["amm", "hvy", "lod", "rel", "fir", "rch"]) expect(feat.has(weaponOnly)).toBe(false);
  });

  it("Weapon keeps its full, already-correct list (17 keys, unaffected by the rework)", () => {
    expect(VALID_PROPERTY_KEYS.weapon!.size).toBe(17);
  });

  it("Spell allows exactly its five components/tags (M12 Discover Befund 3), not physical properties like Heavy", () => {
    const spell = VALID_PROPERTY_KEYS.spell!;
    expect([...spell].sort()).toEqual(["concentration", "material", "ritual", "somatic", "vocal"].sort());
    expect(spell.has("hvy")).toBe(false);
  });

  it("Class allows only its one Sidekick-rules marker (M14 Discover Befund 1)", () => {
    expect([...VALID_PROPERTY_KEYS.class!]).toEqual(["sidekick"]);
  });
});

describe("isArmorType (M9, mirrors CONFIG.DND5E.armorTypes keys)", () => {
  it("is true for the five armor/shield type values, false otherwise", () => {
    for (const value of ["light", "medium", "heavy", "natural", "shield"]) expect(isArmorType(value)).toBe(true);
    for (const value of ["clothing", "ring", "vehicle", ""]) expect(isArmorType(value)).toBe(false);
  });
});

describe("isEquipmentMountable (M9, mirrors EquipmentData#isMountable)", () => {
  it("is true only for \"vehicle\", unlike Weapon's isMountable (\"siege\")", () => {
    expect(isEquipmentMountable(ctx("vehicle"))).toBe(true);
    expect(isEquipmentMountable(ctx("siege"))).toBe(false);
    expect(isEquipmentMountable(ctx(""))).toBe(false);
  });
});

describe("hasSubtypeCatalog (M9/M11, mirrors which CONFIG.DND5E entries have their own subtypes)", () => {
  it("consumableTypes: exactly ammo and poison", () => {
    for (const value of ["ammo", "poison"]) expect(hasSubtypeCatalog("consumableTypes", value)).toBe(true);
    for (const value of ["potion", "food", "scroll", "wand", "rod", "trinket", "wondrous", ""]) {
      expect(hasSubtypeCatalog("consumableTypes", value)).toBe(false);
    }
  });

  it("featureTypes: exactly class, enchantment, feat and supernaturalGift", () => {
    for (const value of ["class", "enchantment", "feat", "supernaturalGift"]) expect(hasSubtypeCatalog("featureTypes", value)).toBe(true);
    for (const value of ["background", "monster", "race", "vehicle", ""]) expect(hasSubtypeCatalog("featureTypes", value)).toBe(false);
  });

  it("facilityTypes: both basic and special (M15 Discover Befund 4, unlike consumable/feat)", () => {
    expect(hasSubtypeCatalog("facilityTypes", "basic")).toBe(true);
    expect(hasSubtypeCatalog("facilityTypes", "special")).toBe(true);
    expect(hasSubtypeCatalog("facilityTypes", "")).toBe(false);
  });
});

describe("FACILITY_FIELDS (M15)", () => {
  it("covers the capacity/type/size fields, not the runtime-only ones", () => {
    const paths = specForItemKind("facility").fields.map((f) => f.path);
    for (const path of ["type.value", "type.subtype", "size", "level", "defenders.max", "hirelings.max", "trade.creatures.max", "free"]) {
      expect(paths, path).toContain(path);
    }
    for (const path of ["building.built", "building.size", "enlargeable", "disabled", "order", "progress.value", "craft.item", "defenders.value", "hirelings.value", "trade.profit"]) {
      expect(paths, path).not.toContain(path);
    }
  });
});

describe("NPC_FIELDS (M16)", () => {
  const paths = specForItemKind("npc").fields.map((f) => f.path);

  it("covers all six abilities (value + save proficiency) and all eighteen skills", () => {
    for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
      expect(paths, key).toContain(`abilities.${key}.value`);
      expect(paths, key).toContain(`abilities.${key}.proficient`);
    }
    for (const key of ["acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv", "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"]) {
      expect(paths, key).toContain(`skills.${key}.value`);
    }
  });

  it("gives ability save and skill proficiency a value-keyed select, not checkbox (dnd5e stores 0/0.5/1/2, not a boolean) — M16 live-check rework", () => {
    const fields = specForItemKind("npc").fields;
    const saveProficiency = fields.find((f) => f.path === "abilities.str.proficient");
    expect(saveProficiency?.widget).toBe("select");
    expect(saveProficiency?.choicesKind).toBe("saveProficiencyLevels");
    const skillProficiency = fields.find((f) => f.path === "skills.acr.value");
    expect(skillProficiency?.widget).toBe("select");
    expect(skillProficiency?.choicesKind).toBe("proficiencyLevels");
  });

  it("groups its ~48 fields into dedicated sections instead of one flat list — M16 live-check rework", () => {
    const fields = specForItemKind("npc").fields;
    const sectionOf = (path: string): string | undefined => fields.find((f) => f.path === path)?.section;
    expect(sectionOf("abilities.str.value")).toBe("abilityScores");
    expect(sectionOf("skills.acr.value")).toBe("skills");
    expect(sectionOf("attributes.ac.flat")).toBe("combat");
    expect(sectionOf("attributes.movement.walk")).toBe("movement");
    expect(sectionOf("attributes.senses.ranges.darkvision")).toBe("senses");
    expect(sectionOf("traits.di.value")).toBe("resistances");
    expect(sectionOf("details.alignment")).toBe("description");
    expect(sectionOf("traits.size")).toBe("core");
  });

  it("covers the rest of the statblock: type, size, AC/HP/init/movement/senses, resistances, languages, legendary Max fields", () => {
    for (const path of [
      "traits.size", "details.type.value", "details.cr", "attributes.ac.calc", "attributes.ac.flat",
      "attributes.hp.formula", "attributes.init.bonus", "attributes.movement.walk", "attributes.senses.ranges.darkvision",
      "traits.di.value", "traits.dr.value", "traits.dv.value", "traits.ci.value", "traits.languages.value",
      "resources.legact.max", "resources.legres.max", "resources.lair.value",
    ]) {
      expect(paths, path).toContain(path);
    }
  });

  it("does not spread the Item-only DESCRIPTION_FIELDS (NPC is an Actor, uses details.biography.* instead)", () => {
    for (const path of ["identified", "description.value", "description.chat", "identifier"]) {
      expect(paths, path).not.toContain(path);
    }
    expect(paths).toContain("details.biography.value");
    expect(paths).toContain("details.biography.public");
  });

  it("leaves Actions/Legendary Actions and tool proficiencies as Non-Goals (Human Decision m16-hd-1, Entscheidungen 1-2)", () => {
    for (const path of paths) expect(path.startsWith("tools.")).toBe(false);
    // No path referencing embedded-item concepts (activities live on Items, never on the Actor itself).
    expect(paths.some((p) => p.includes("activities"))).toBe(false);
  });
});

describe("Encounter and Group fields (M17)", () => {
  it("covers GroupTemplate currency and description fields for both Actor kinds", () => {
    for (const kind of M17_KINDS) {
      const fields = specForItemKind(kind).fields;
      for (const key of ["pp", "gp", "ep", "sp", "cp"]) {
        const currency = fields.find((field) => field.path === `currency.${key}`);
        expect(currency?.widget, `${kind}:${key}`).toBe("number");
        expect(currency?.section, `${kind}:${key}`).toBe("currency");
      }
      expect(fields.find((field) => field.path === "description.summary")?.section).toBe("description");
      expect(fields.find((field) => field.path === "description.full")?.section).toBe("description");
      for (const itemOnly of ["identified", "description.value", "description.chat"]) {
        expect(fields.some((field) => field.path === itemOnly), `${kind}:${itemOnly}`).toBe(false);
      }
    }
  });

  it("keeps Encounter's members out of raw fields for the guided builder", () => {
    const paths = specForItemKind("encounter").fields.map((field) => field.path);
    expect(paths).toEqual([
      "currency.pp", "currency.gp", "currency.ep", "currency.sp", "currency.cp",
      "description.summary", "description.full",
    ]);
    expect(paths.some((path) => path.startsWith("members"))).toBe(false);
  });

  it("covers all stored Group travel and XP fields with runtime catalogs", () => {
    const fields = specForItemKind("group").fields;
    expect(fields.find((field) => field.path === "details.xp.value")?.widget).toBe("number");
    expect(fields.find((field) => field.path === "attributes.travel.pace")?.choicesKind).toBe("travelPace");
    expect(fields.find((field) => field.path === "attributes.travel.units")?.choicesKind).toBe("travelUnits");
    for (const mapping of ["paces", "speeds"]) {
      for (const type of ["land", "water", "air"]) {
        const field = fields.find((entry) => entry.path === `attributes.travel.${mapping}.${type}`);
        expect(field?.widget, `${mapping}.${type}`).toBe("formula");
        expect(field?.section, `${mapping}.${type}`).toBe("travel");
      }
    }
    expect(fields.find((field) => field.path === "attributes.travel.time")?.widget).toBe("number");
  });

  it("leaves members and primaryVehicle to the guided builder and has no duplicate paths", () => {
    const paths = specForItemKind("group").fields.map((field) => field.path);
    expect(paths.some((path) => path.startsWith("members"))).toBe(false);
    expect(paths).not.toContain("primaryVehicle");
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("Vehicle fields (M18)", () => {
  const fields = specForItemKind("vehicle").fields;
  const paths = fields.map((field) => field.path);

  it("covers identity, all six expanded abilities, combat, actions, movement, travel, capacity, defenses, currency, biography and source", () => {
    for (const path of [
      "details.type", "traits.size", "attributes.price.value", "attributes.quality.value",
      "attributes.ac.calc", "attributes.hp.max", "attributes.hp.dt", "attributes.hp.mt",
      "attributes.init.ability", "attributes.actions.stations", "attributes.actions.max",
      "attributes.movement.ignoredDifficultTerrain", "attributes.travel.speeds.air",
      "attributes.capacity.cargo.value", "crew.max", "passengers.max", "traits.keel.value", "traits.beam.value",
      "traits.di.value", "traits.di.bypasses", "traits.dm.bypasses", "traits.ci.value",
      "currency.gp", "details.biography.value", "source.book", "source.revision",
    ]) expect(paths, path).toContain(path);
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
      for (const suffix of ["value", "proficient", "max", "bonuses.check", "bonuses.save", "check.roll.min", "check.roll.max", "check.roll.mode", "save.roll.min", "save.roll.max", "save.roll.mode"]) {
        expect(paths, `${ability}.${suffix}`).toContain(`abilities.${ability}.${suffix}`);
      }
    }
  });

  it("uses guided catalogs for the vehicle-only choices and physical bypass properties", () => {
    expect(fields.find((field) => field.path === "details.type")?.choicesKind).toBe("vehicleTypes");
    expect(fields.find((field) => field.path === "abilities.str.check.roll.mode")?.choicesKind).toBe("rollModes");
    expect(fields.find((field) => field.path === "attributes.movement.ignoredDifficultTerrain")?.choicesKind).toBe("ignoredDifficultTerrain");
    expect(fields.find((field) => field.path === "traits.dr.bypasses")?.choicesKind).toBe("physicalItemProperties");
  });

  it("shows crew thresholds only while individual Action Stations are disabled", () => {
    for (const path of ["attributes.actions.thresholds.0", "attributes.actions.thresholds.1", "attributes.actions.thresholds.2"]) {
      const visible = fields.find((field) => field.path === path)?.visibleWhen;
      expect(visible?.({ properties: new Set(), typeValue: "", actionStations: false }), path).toBe(true);
      expect(visible?.({ properties: new Set(), typeValue: "", actionStations: true }), path).toBe(false);
    }
  });

  it("excludes runtime, derived, legacy and guided-builder fields", () => {
    for (const path of [
      "attributes.actions.spent", "attributes.actions.value", "attributes.hp.value", "attributes.hp.temp", "attributes.hp.tempmax",
      "attributes.capacity.creature", "traits.dimensions", "cargo.crew", "cargo.passengers", "crew.value", "passengers.value", "draft.value",
      "traits.dm.amount", "source.rules",
    ]) expect(paths, path).not.toContain(path);
  });

  it("has no duplicate paths", () => {
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("weaponAttackType (M8a, mirrors CONFIG.DND5E.weaponTypeMap)", () => {
  it("maps the six weapon type values, and leaves natural/improv/unknown undefined", () => {
    expect(weaponAttackType("simpleM")).toBe("melee");
    expect(weaponAttackType("simpleR")).toBe("ranged");
    expect(weaponAttackType("martialM")).toBe("melee");
    expect(weaponAttackType("martialR")).toBe("ranged");
    expect(weaponAttackType("siege")).toBe("ranged");
    expect(weaponAttackType("natural")).toBeUndefined();
    expect(weaponAttackType("improv")).toBeUndefined();
    expect(weaponAttackType("")).toBeUndefined();
  });
});

describe("weaponHasRange/weaponHasReach (M8a, mirrors WeaponData#hasRange and the Reach condition in details-weapon.hbs)", () => {
  it("hasRange: true for a ranged weapon, a thrown weapon, a natural weapon, or no type chosen yet", () => {
    expect(weaponHasRange(ctx("simpleR"))).toBe(true);
    expect(weaponHasRange(ctx("martialM", "thr"))).toBe(true);
    expect(weaponHasRange(ctx("natural"))).toBe(true);
    expect(weaponHasRange(ctx(""))).toBe(true);
  });

  it("hasRange: false for a plain melee weapon with no thrown property", () => {
    expect(weaponHasRange(ctx("martialM"))).toBe(false);
    expect(weaponHasRange(ctx("simpleM"))).toBe(false);
  });

  it("hasReach: true for melee, natural, improv and siege; false for a plain ranged weapon", () => {
    expect(weaponHasReach(ctx("martialM"))).toBe(true);
    expect(weaponHasReach(ctx("natural"))).toBe(true);
    expect(weaponHasReach(ctx("improv"))).toBe(true);
    expect(weaponHasReach(ctx("siege"))).toBe(true);
    expect(weaponHasReach(ctx("simpleR"))).toBe(false);
    expect(weaponHasReach(ctx("martialR"))).toBe(false);
  });
});

describe("specForItemKind", () => {
  it("throws for an unknown kind", () => {
    // @ts-expect-error — deliberately invalid input to check the runtime guard
    expect(() => specForItemKind("nonsense")).toThrow();
  });
});

describe("buildItemFieldData", () => {
  it("nests dotted-path values", () => {
    expect(buildItemFieldData({ "type.value": "art", "type.baseItem": "alchemist" })).toEqual({
      type: { value: "art", baseItem: "alchemist" },
    });
  });

  it("drops an empty string value, letting the dnd5e default apply", () => {
    expect(buildItemFieldData({ ability: "" })).toEqual({});
  });

  it("keeps a non-string value even when it looks falsy (0, false, an empty array)", () => {
    expect(buildItemFieldData({ "armor.value": 0, identified: false, "properties": [] })).toEqual({
      armor: { value: 0 },
      identified: false,
      properties: [],
    });
  });

  it("keeps a ready-made object value for the weaponDamagePart widget untouched", () => {
    const base = { number: 1, denomination: 8, types: ["slashing"] };
    expect(buildItemFieldData({ "damage.base": base })).toEqual({ damage: { base } });
  });
});
