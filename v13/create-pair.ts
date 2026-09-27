import type { RequestOutcome, RequestSender } from "../core/create-pair";
import { FLIGHT_CONTROL_ID } from "../core/flight-control";
import { HOMEBREW_ID } from "../core/index";

// Where the request function comes from: game.modules.get("eagle-flight-control")?.api.request(...). Not wired into
// any hook yet (no window calls this before M4); ready for the milestones that build the editors.
export function foundryRequestSender(): RequestSender {
  return {
    request: async (type, payload): Promise<RequestOutcome> => {
      const api = game.modules?.get(FLIGHT_CONTROL_ID)?.api;
      if (!api) return { ok: false, reason: "not-registered", detail: "Eagle Flight Control is missing or not active" };
      return (await api.request({ module: HOMEBREW_ID, type, payload })) as RequestOutcome;
    },
  };
}
