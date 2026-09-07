import { BrowserWindow, WebContentsView } from "electron";
import type { DownloadItem, Event as ElectronEvent, Session } from "electron";
import type { Provider, ProviderId, ViewBounds } from "../src/shared/contracts";
import { AccountSessionManager } from "./account-sessions";
import { profileFor, zoomForPaneWidth, type ProviderDisplayProfile } from "../src/shared/provider-view-profile";

export class ProviderViews {
  private readonly views = new Map<ProviderId, WebContentsView>();
  private readonly downloadListeners = new Map<ProviderId, { session: Session; listener: (event: ElectronEvent, item: DownloadItem) => void }>();
  /** Manual zoom overrides (U4 §9.2); when set, auto-fit zoom is skipped. */
  private readonly manualZoom = new Map<ProviderId, number>();
  /** Provider-specific zoom profiles (plan Phase 2); applied on every layout. */
  private readonly profiles: ProviderDisplayProfile[];

  constructor(
    private readonly host: BrowserWindow,
    private readonly onState: (providerId: ProviderId, open: boolean) => void,
    private readonly accounts: AccountSessionManager,
    private readonly downloadPathFor: (providerId: ProviderId, suggestedName: string) => string,
    profiles: ProviderDisplayProfile[] = []
  ) {
    this.profiles = profiles;
  }

  open(provider: Provider, loadInitialPage = true): WebContentsView {
    const existing = this.views.get(provider.id);
    if (existing && !existing.webContents.isDestroyed()) return existing;

    this.accounts.ensure(provider.id);
    const view = new WebContentsView({
      webPreferences: {
        partition: this.accounts.partitionFor(provider.id),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    view.setBackgroundColor("#111315");
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void view.webContents.loadURL(url);
      return { action: "deny" };
    });
    this.host.contentView.addChildView(view);
    this.views.set(provider.id, view);
    const downloadListener = (_event: ElectronEvent, item: DownloadItem) => {
      try { item.setSavePath(this.downloadPathFor(provider.id, item.getFilename())); }
      catch (error) {
        console.error(`Unable to route ${provider.id} download into conversation history`, error);
        item.cancel();
      }
    };
    view.webContents.session.on("will-download", downloadListener);
    this.downloadListeners.set(provider.id, { session: view.webContents.session, listener: downloadListener });
    this.accounts.mount(provider, view);
    this.onState(provider.id, true);
    if (loadInitialPage) void view.webContents.loadURL(provider.url).catch((error) => console.error("Provider navigation failed", error));
    return view;
  }

  get(providerId: ProviderId): WebContentsView | undefined {
    const view = this.views.get(providerId);
    return view && !view.webContents.isDestroyed() ? view : undefined;
  }

  close(providerId: ProviderId): void {
    const view = this.views.get(providerId);
    if (!view) return;
    const download = this.downloadListeners.get(providerId);
    if (download) download.session.off("will-download", download.listener);
    this.downloadListeners.delete(providerId);
    this.manualZoom.delete(providerId);
    if (!this.host.isDestroyed()) this.host.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.views.delete(providerId);
    this.onState(providerId, false);
  }

  layout(boundsByProvider: Partial<Record<ProviderId, ViewBounds>>): void {
    for (const [providerId, view] of this.views) {
      const bounds = boundsByProvider[providerId];
      if (!bounds || view.webContents.isDestroyed()) continue;
      view.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height))
      });
      // U4 §9.2: a manual zoom override wins; otherwise auto-fit by pane width.
      try {
        const override = this.manualZoom.get(providerId);
        const zoom = override ?? zoomForPaneWidth(profileFor(this.profiles, providerId), bounds.width);
        if (Math.abs((view.webContents.getZoomFactor() ?? 1) - zoom) > 0.001) view.webContents.setZoomFactor(zoom);
      } catch { /* a not-yet-ready or closing view keeps its current zoom */ }
    }
  }

  /** Sets a manual zoom override for one pane (persisted for the session). */
  setManualZoom(providerId: ProviderId, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0 || factor > 3) throw new Error("Zoom factor must be within (0, 3]");
    this.manualZoom.set(providerId, factor);
    const view = this.views.get(providerId);
    if (view && !view.webContents.isDestroyed()) view.webContents.setZoomFactor(factor);
  }

  /** Clears the manual override; the next layout applies auto-fit again. */
  clearManualZoom(providerId: ProviderId): void {
    this.manualZoom.delete(providerId);
  }

  setVisible(visible: boolean): void {
    for (const view of this.views.values()) view.setVisible(visible);
  }

  destroyAll(): void {
    for (const providerId of [...this.views.keys()]) this.close(providerId);
  }
}
