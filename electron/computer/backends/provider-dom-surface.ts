import type { ProviderViews } from "../../provider-views";
import type { DomPageRef, DomPageSurface } from "./dom-page";

/**
 * Production §8.2 DOM page surface bound to the visible provider panes. The
 * DomPageBackend evaluates scripts through whichever provider WebContentsView
 * the action names; a `dom:` target without a provider id resolves only when
 * exactly one provider pane is open (no silent ambiguity).
 */
export function providerDomSurface(views: () => ProviderViews): DomPageSurface {
  const viewFor = (page?: DomPageRef) => {
    const providerId = page?.providerId;
    const open = providerId ? views().get(providerId) : undefined;
    if (providerId && (!open || open.webContents.isDestroyed())) throw new Error(`Provider page is not open: ${providerId}`);
    if (!providerId) throw new Error("DOM action requires a dom: providerId (or exactly one open provider page to disambiguate)");
    if (open!.webContents.isCrashed()) throw new Error(`Provider page crashed: ${providerId}`);
    return open!;
  };
  return {
    async evaluate<T>(script: string, page?: DomPageRef): Promise<T> {
      const view = viewFor(page);
      return view.webContents.executeJavaScript(script) as Promise<T>;
    }
  };
}
