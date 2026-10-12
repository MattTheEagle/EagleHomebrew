import { logHomebrewReady } from "../core/index";
import type { ActorReference, ActorResolutionResult } from "../core/actor-member-model";
import { FLIGHT_CONTROL_ID, registerWithFlightControl, type ApiSource, type RegistrationLog } from "../core/flight-control";
import { foundryRequestSender } from "./create-pair";
import { createHomebrewApplicationClass, type EditSession, type HomebrewWindowContext } from "./homebrew-application";
import { currentRulesVersion } from "../core/creation-target";
import { allowedLibraryPacks, routeEditableDocument } from "../core/edit-routing";
import { executePairRetrofit, planPairRetrofit, type PairDocument, type PairPackState } from "../core/pair-retrofit";
import type { JsonObject } from "../core/edit-projection";
import { valueAt } from "../core/edit-projection";
import { registerEditHooks, type EditHookDocument } from "./edit-hooks";
import type { CatalogEntry } from "../core/catalog";

// Flight Control attaches its API to its own module object while it initializes; other modules read it from "setup" on.
// The module can be missing or deactivated, so the API can be undefined (see the contract, section 1). One accessor for
// the whole file (module scope, not tied to either hook): every caller reads `game.modules` fresh, so it is always safe.
const flightControl = () => game.modules?.get(FLIGHT_CONTROL_ID)?.api;
const flightControlApi: ApiSource = flightControl;

const consoleLog: RegistrationLog = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(message),
};

// Reads a world compendium's index by its collection id ("world.eagle-loot-2014"), or undefined if the compendium does
// not exist yet (M4 Apply, section 4). Fields beyond "system.requirements" are not needed (rule R5).
async function readIndex(collection: string): Promise<readonly { name: string; requirements?: unknown }[] | undefined> {
  const pack = game.packs?.get(collection);
  if (!pack) return undefined;
  const index = await pack.getIndex({ fields: ["system.requirements"] } as never);
  return [...index].map((raw) => {
    const entry = raw as unknown as { name?: string; system?: { requirements?: unknown } };
    return { name: entry.name ?? "", requirements: entry.system?.requirements };
  });
}

// M17: Encounter can store a full Actor UUID, while Group's ForeignDocumentField can only store
// a world Actor id. Resolve one selection and its same-id counterparts here, at the Foundry edge;
// all selection rules and output building stay Foundry-free in core/actor-member-model.ts.
interface ReadableActor {
  readonly id: string;
  readonly uuid: string;
  readonly name?: string;
  readonly type: string;
  readonly documentName: string;
  readonly pack?: string | null;
  getFlag?(scope: string, key: string): unknown;
}

interface ActorIndexEntry {
  readonly _id?: string;
  readonly id?: string;
  readonly name?: string;
  readonly type?: string;
}

const actorLibraryCollections = (type: string): readonly string[] => {
  if (type === "npc") return ["world.eagle-npcs-2014", "world.eagle-npcs-2024"];
  if (type === "vehicle") return ["world.eagle-vehicles-2014", "world.eagle-vehicles-2024"];
  return [];
};

function actorReference(actor: ReadableActor, source: ActorReference["source"]): ActorReference {
  return { id: actor.id, uuid: actor.uuid, name: actor.name ?? actor.id, type: actor.type, source };
}

async function indexedActor(collection: string, id: string, expectedType: string): Promise<ActorReference | undefined> {
  const pack = game.packs?.get(collection);
  if (!pack) return undefined;
  const index = await pack.getIndex({ fields: ["name", "type"] } as never);
  const entry = [...index].map((raw) => raw as unknown as ActorIndexEntry).find((row) => (row._id ?? row.id) === id && (!row.type || row.type === expectedType));
  if (!entry) return undefined;
  return {
    id,
    uuid: `Compendium.${collection}.Actor.${id}`,
    name: entry.name ?? id,
    type: entry.type ?? expectedType,
    source: "eagle-library",
  };
}

async function resolveActorMember(uuid: string): Promise<ActorResolutionResult> {
  let resolved: unknown;
  try {
    const fromUuid = foundry.utils.fromUuid as unknown as (documentUuid: string) => Promise<unknown>;
    resolved = await fromUuid(uuid);
  } catch (error) {
    return { ok: false, reason: "not-found", detail: error instanceof Error ? error.message : String(error) };
  }
  if (!resolved) return { ok: false, reason: "not-found", detail: uuid };
  const selected = resolved as ReadableActor;
  if (selected.documentName !== "Actor") return { ok: false, reason: "not-actor", detail: uuid };

  const expectedCollections = actorLibraryCollections(selected.type);
  const selectedSource: ActorReference["source"] = !selected.pack
    ? "world"
    : expectedCollections.includes(selected.pack)
      ? "eagle-library"
      : "other-compendium";
  const selectedReference = actorReference(selected, selectedSource);

  const worldActor = (game.actors as unknown as { get(id: string): ReadableActor | undefined })?.get(selected.id);
  const world = worldActor?.type === selected.type ? actorReference(worldActor, "world") : undefined;
  if (selectedSource === "eagle-library") return { ok: true, selected: selectedReference, world, library: selectedReference };

  // A valid pair flag is authoritative. It records the exact Eagle pack used when Homebrew created
  // the pair, so a second same-id entry for another rules version does not make that pair ambiguous.
  const pair = (selectedSource === "world" ? selected.getFlag?.("eagle-homebrew", "pair") : undefined) as { pack?: unknown } | undefined;
  if (typeof pair?.pack === "string" && expectedCollections.includes(pair.pack)) {
    const library = await indexedActor(pair.pack, selected.id, selected.type);
    if (library) return { ok: true, selected: selectedReference, world, library };
  }

  const matches = (await Promise.all(expectedCollections.map((collection) => indexedActor(collection, selected.id, selected.type)))).filter(
    (entry): entry is ActorReference => entry !== undefined,
  );
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous-library", detail: matches.map((entry) => entry.uuid).join(", ") };
  }
  return { ok: true, selected: selectedReference, world, library: matches[0] };
}

interface EditableFoundryDocument extends EditHookDocument {
  readonly uuid: string;
  readonly name?: string;
  readonly parent?: unknown;
  getFlag?(scope: string, key: string): unknown;
  toObject?(source?: boolean): unknown;
}

async function documentByUuid(uuid: string): Promise<EditableFoundryDocument | undefined> {
  try {
    return await (foundry.utils.fromUuid as unknown as (value: string) => Promise<EditableFoundryDocument | undefined>)(uuid);
  } catch {
    return undefined;
  }
}

function jsonSource(document: EditableFoundryDocument | undefined): JsonObject | undefined {
  if (!document?.toObject) return undefined;
  const raw = document.toObject(true);
  try {
    return JSON.parse(JSON.stringify(raw)) as JsonObject;
  } catch {
    return undefined;
  }
}

async function readDocumentSource(uuid: string): Promise<JsonObject | undefined> {
  return jsonSource(await documentByUuid(uuid));
}

function defaultDocumentSource(entry: CatalogEntry): JsonObject {
  if (entry.art === "RollTable") return { name: "" };
  const models = (game as unknown as { model?: Record<string, Record<string, unknown>> }).model;
  const system = entry.subtype ? models?.[entry.art]?.[entry.subtype] : undefined;
  try {
    return { name: "", system: JSON.parse(JSON.stringify(system ?? {})) as JsonObject };
  } catch {
    return { name: "", system: {} };
  }
}

function pairDocument(document: EditableFoundryDocument): PairDocument {
  const pair = document.getFlag?.("eagle-homebrew", "pair") as { pack?: string; world?: string } | undefined;
  return { id: document.id, uuid: document.uuid, documentName: document.documentName, type: document.type, ...(pair ? { pair } : {}) };
}

const homebrewWindowContext: HomebrewWindowContext = {
  sender: foundryRequestSender(),
  // Cast the same way EagleFlightControl/v13/setting-write.ts does: Foundry's typed `ClientSettings.get` only knows
  // this module's own settings by declaration merging, not a foreign namespace like dnd5e's (N9: direct read, no
  // Flight Control request needed).
  readRulesVersion: () => (game.settings as unknown as { get(namespace: string, key: string): unknown }).get("dnd5e", "rulesVersion"),
  readIndex,
  resolveActorMember,
  readDocumentSource,
  defaultDocumentSource,
  newId: () => foundry.utils.randomID(),
  notify: (level, message) => ui.notifications?.[level]?.(message),
};

let EagleHomebrewApplication: ReturnType<typeof createHomebrewApplicationClass> | undefined;

// Opens Homebrew's own window (M4). Flight Control gates document.create to a Gamemaster or Assistant server-side
// already; this is the client-side courtesy check, the same pattern as EagleLibrary/v13/module.ts's `openCopy`. Foundry
// gives `isGM` for both roles (EagleFlightControl/core/system-guard.ts, request-relay.ts).
function openHomebrew(): void {
  if (game.user?.isGM !== true) {
    ui.notifications?.warn(game.i18n!.localize("EAGLEHOMEBREW.window.notGm"));
    return;
  }
  EagleHomebrewApplication ??= createHomebrewApplicationClass(homebrewWindowContext);
  new EagleHomebrewApplication().render(true);
}

function resolveWorldDocument(documentName: "Actor" | "Item" | "RollTable", id: string): EditableFoundryDocument | undefined {
  const collection = documentName === "Actor" ? game.actors : documentName === "Item" ? game.items : game.tables;
  return (collection as unknown as { get(id: string): EditableFoundryDocument | undefined })?.get(id);
}

async function readPackState(collection: string, id: string): Promise<PairPackState> {
  const pack = game.packs?.get(collection) as unknown as { locked?: boolean; getDocument(id: string): Promise<EditableFoundryDocument | undefined> } | undefined;
  if (!pack) return { collection, available: false, writable: false };
  const document = await pack.getDocument(id);
  return { collection, available: true, writable: pack.locked !== true, ...(document ? { entry: pairDocument(document) } : {}) };
}

async function prepareEdit(world: EditableFoundryDocument): Promise<EditSession | undefined> {
  if (game.user?.isGM !== true) {
    ui.notifications?.warn(game.i18n!.localize("EAGLEHOMEBREW.window.notGm"));
    return undefined;
  }
  const entry = routeEditableDocument(world);
  if (!entry) return undefined;
  const worldSourceBefore = jsonSource(world);
  if (!worldSourceBefore) throw new Error("The world document could not be serialized.");
  const packs = await Promise.all(allowedLibraryPacks(entry).map((collection) => readPackState(collection, world.id)));
  const sourceRules = valueAt(worldSourceBefore, "system.source.rules");
  const hasSourceRules = sourceRules === "2014" || sourceRules === "2024";
  const rulesVersion = hasSourceRules ? sourceRules : currentRulesVersion(homebrewWindowContext.readRulesVersion);
  const planned = planPairRetrofit(entry, pairDocument(world), packs, rulesVersion, entry.versioned && !hasSourceRules);
  if (!planned.ok) throw new Error(`${planned.reason}: ${planned.detail}`);
  const plan = planned;
  const result = await executePairRetrofit(homebrewWindowContext.sender, entry, pairDocument(world), plan);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  const [librarySource, worldSource] = await Promise.all([readDocumentSource(result.libraryUuid), readDocumentSource(world.uuid)]);
  if (!librarySource || !worldSource) throw new Error("The paired documents could not be read after retrofit.");
  return { entry, worldUuid: world.uuid, libraryUuid: result.libraryUuid, pack: result.pack, fallbackUsed: plan.fallbackUsed, librarySource, worldSource };
}

async function openExisting(world: EditableFoundryDocument): Promise<void> {
  try {
    const session = await prepareEdit(world);
    if (!session) return;
    EagleHomebrewApplication ??= createHomebrewApplicationClass(homebrewWindowContext);
    new EagleHomebrewApplication(session).render(true);
  } catch (error) {
    ui.notifications?.error(game.i18n!.format("EAGLEHOMEBREW.window.notify.editOpenFailed", { detail: error instanceof Error ? error.message : String(error) }));
  }
}

Hooks.once("init", () => {
  logHomebrewReady("13");
});

Hooks.once("setup", () => {
  registerWithFlightControl(flightControlApi, consoleLog, openHomebrew);
  registerEditHooks({
    hooks: Hooks as unknown as { on(name: string, callback: (...args: unknown[]) => void): unknown },
    isGm: () => game.user?.isGM === true,
    label: () => game.i18n!.localize("EAGLEHOMEBREW.window.edit.action"),
    resolve: resolveWorldDocument,
    open: (document) => void openExisting(document as EditableFoundryDocument),
  });
});
