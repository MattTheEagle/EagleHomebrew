import type { CatalogEntry } from "./catalog";
import type { JsonValue, RequestSender } from "./create-pair";
import { allowedLibraryPacks } from "./edit-routing";
import { updateDocument } from "./document-update";

export interface PairDocument {
  readonly id: string;
  readonly uuid: string;
  readonly documentName: string;
  readonly type?: string;
  readonly pair?: { readonly pack?: string; readonly world?: string };
}

export interface PairPackState {
  readonly collection: string;
  readonly available: boolean;
  readonly writable: boolean;
  readonly entry?: PairDocument;
}

export type PairPlan =
  | { readonly ok: true; readonly pack: string; readonly library?: PairDocument; readonly importRequired: boolean; readonly fallbackUsed: boolean }
  | { readonly ok: false; readonly reason: "invalid-pack" | "pack-unavailable" | "pack-locked" | "foreign-collision" | "type-mismatch" | "ambiguous" | "rules-version"; readonly detail: string };

function matchingType(entry: CatalogEntry, document: PairDocument): boolean {
  return document.documentName === entry.art && (entry.art === "RollTable" || document.type === entry.subtype);
}

export function planPairRetrofit(
  entry: CatalogEntry,
  world: PairDocument,
  packs: readonly PairPackState[],
  rulesVersion?: "2014" | "2024",
  rulesFallbackUsed = false,
): PairPlan {
  const allowed = allowedLibraryPacks(entry);
  const byName = new Map(packs.map((pack) => [pack.collection, pack]));
  const flagged = world.pair?.pack;
  if (flagged && !allowed.includes(flagged)) return { ok: false, reason: "invalid-pack", detail: flagged };

  const validMatches = packs.filter((pack) => {
    const candidate = pack.entry;
    return allowed.includes(pack.collection) && candidate?.id === world.id && candidate.pair?.world === entry.worldType && matchingType(entry, candidate);
  });
  if (!flagged && validMatches.length > 1) return { ok: false, reason: "ambiguous", detail: validMatches.map((pack) => pack.collection).join(", ") };

  let fallbackUsed = false;
  let target = flagged ?? validMatches[0]?.collection;
  if (!target) {
    if (entry.versioned) {
      if (!rulesVersion) return { ok: false, reason: "rules-version", detail: entry.key };
      target = `world.eagle-${entry.key}-${rulesVersion}`;
      fallbackUsed = rulesFallbackUsed;
    } else target = allowed[0];
  }
  const pack = byName.get(target);
  if (!pack?.available) return { ok: false, reason: "pack-unavailable", detail: target };
  if (!pack.writable) return { ok: false, reason: "pack-locked", detail: target };
  if (pack.entry) {
    if (!matchingType(entry, pack.entry)) return { ok: false, reason: "type-mismatch", detail: pack.entry.uuid };
    const proven = flagged === target || pack.entry.pair?.world === entry.worldType;
    if (!proven) return { ok: false, reason: "foreign-collision", detail: pack.entry.uuid };
  }
  return { ok: true, pack: target, library: pack.entry, importRequired: !pack.entry, fallbackUsed };
}

export type RetrofitResult =
  | { readonly ok: true; readonly pack: string; readonly libraryUuid: string; readonly fallbackUsed: boolean }
  | { readonly ok: false; readonly reason: string; readonly detail: string };

export async function executePairRetrofit(
  sender: RequestSender,
  entry: CatalogEntry,
  world: PairDocument,
  plan: Extract<PairPlan, { readonly ok: true }>,
): Promise<RetrofitResult> {
  let libraryUuid = plan.library?.uuid;
  if (plan.importRequired) {
    const imported = await sender.request("compendium.import", {
      pack: plan.pack,
      sources: [{ source: world.uuid, id: world.id, changes: { "flags.eagle-homebrew.pair": { world: entry.worldType } } }],
    });
    if (!imported.ok) return imported;
    const value = imported.value as { created?: readonly { uuid?: unknown }[]; existed?: readonly { uuid?: unknown }[] };
    const result = value.created?.[0] ?? value.existed?.[0];
    libraryUuid = typeof result?.uuid === "string" ? result.uuid : undefined;
    if (!libraryUuid) return { ok: false, reason: "invalid-response", detail: "compendium.import returned no document UUID" };
  } else if (plan.library?.pair?.world !== entry.worldType) {
    const repaired = await updateDocument(sender, plan.library!.uuid, { "flags.eagle-homebrew.pair": { world: entry.worldType } });
    if (!repaired.ok) return repaired;
  }
  const worldFlag = await updateDocument(sender, world.uuid, { "flags.eagle-homebrew.pair": { pack: plan.pack } });
  if (!worldFlag.ok) return worldFlag;
  return { ok: true, pack: plan.pack, libraryUuid: libraryUuid!, fallbackUsed: plan.fallbackUsed };
}
