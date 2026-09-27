import { logHomebrewReady } from "../core/index";
import { FLIGHT_CONTROL_ID, registerWithFlightControl, type ApiSource, type RegistrationLog } from "../core/flight-control";
import { foundryRequestSender } from "./create-pair";
import { createHomebrewApplicationClass, type HomebrewWindowContext } from "./homebrew-application";

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

const homebrewWindowContext: HomebrewWindowContext = {
  sender: foundryRequestSender(),
  // Cast the same way EagleFlightControl/v13/setting-write.ts does: Foundry's typed `ClientSettings.get` only knows
  // this module's own settings by declaration merging, not a foreign namespace like dnd5e's (N9: direct read, no
  // Flight Control request needed).
  readRulesVersion: () => (game.settings as unknown as { get(namespace: string, key: string): unknown }).get("dnd5e", "rulesVersion"),
  readIndex,
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

Hooks.once("init", () => {
  logHomebrewReady("13");
});

Hooks.once("setup", () => {
  registerWithFlightControl(flightControlApi, consoleLog, openHomebrew);
});
