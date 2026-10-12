import { CATALOG, type CatalogEntry } from "./catalog";

export interface EditableDocumentRoute {
  readonly documentName: string;
  readonly type?: string;
  readonly pack?: string | null;
  readonly embedded?: boolean;
  readonly parent?: unknown;
}

/** The single allow-list used by every M19 entry point. */
export function routeEditableDocument(document: EditableDocumentRoute): CatalogEntry | undefined {
  if (document.pack || document.embedded || document.parent) return undefined;
  if (document.documentName === "RollTable") return CATALOG.find((entry) => entry.art === "RollTable");
  if (document.documentName !== "Actor" && document.documentName !== "Item") return undefined;
  return CATALOG.find((entry) => entry.art === document.documentName && entry.subtype === document.type);
}

export function allowedLibraryPacks(entry: CatalogEntry): readonly string[] {
  const base = `world.eagle-${entry.key}`;
  return entry.versioned ? [`${base}-2014`, `${base}-2024`] : [base];
}
