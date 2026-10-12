import { routeEditableDocument, type EditableDocumentRoute } from "../core/edit-routing";

export interface HookBus {
  on(name: string, callback: (...args: unknown[]) => void): unknown;
}

export interface EditHookDocument extends EditableDocumentRoute {
  readonly id: string;
}

export interface EditHookDependencies {
  readonly hooks: HookBus;
  readonly isGm: () => boolean;
  readonly label: () => string;
  readonly resolve: (documentName: "Actor" | "Item" | "RollTable", id: string) => EditHookDocument | undefined;
  readonly open: (document: EditHookDocument) => void;
}

const ACTION = "eagle-homebrew-edit";

function rowId(row: unknown): string | undefined {
  const raw = row as { readonly 0?: unknown; readonly dataset?: Record<string, string | undefined>; closest?(selector: string): unknown };
  const element = (raw?.[0] ?? raw) as { readonly dataset?: Record<string, string | undefined>; closest?(selector: string): unknown };
  const owner = (element?.closest?.("[data-document-id], [data-entry-id]") ?? element) as { readonly dataset?: Record<string, string | undefined> };
  return owner?.dataset?.documentId ?? owner?.dataset?.entryId;
}

export function registerEditHooks(deps: EditHookDependencies): void {
  deps.hooks.on("getHeaderControlsApplicationV2", (...args: unknown[]) => {
    const application = args[0] as { document?: EditHookDocument } | undefined;
    const controls = args[1] as Array<Record<string, unknown>> | undefined;
    const document = application?.document;
    if (!controls || !document || !deps.isGm() || !routeEditableDocument(document) || controls.some((control) => control.action === ACTION)) return;
    controls.push({
      action: ACTION,
      label: deps.label(),
      icon: "fa-solid fa-hammer",
      ownership: "OWNER",
      onClick: () => deps.open(document),
    });
  });

  for (const documentName of ["Actor", "Item", "RollTable"] as const) {
    deps.hooks.on(`get${documentName}ContextOptions`, (...args: unknown[]) => {
      const options = args[1] as Array<Record<string, unknown>> | undefined;
      if (!options || options.some((option) => option.action === ACTION)) return;
      options.push({
        action: ACTION,
        name: deps.label(),
        icon: '<i class="fa-solid fa-hammer"></i>',
        condition: (row: unknown) => {
          const id = rowId(row);
          const document = id ? deps.resolve(documentName, id) : undefined;
          return deps.isGm() && !!document && !!routeEditableDocument(document);
        },
        callback: (row: unknown) => {
          const id = rowId(row);
          const document = id ? deps.resolve(documentName, id) : undefined;
          if (document && deps.isGm() && routeEditableDocument(document)) deps.open(document);
        },
      });
    });
  }
}
