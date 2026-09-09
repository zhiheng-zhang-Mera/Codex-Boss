import { BrowserWindow, WebContentsView, screen } from "electron";
import type { DownloadItem, Event as ElectronEvent, Session } from "electron";
import type { Provider, ProviderId, ViewBounds } from "../src/shared/contracts";
import { AccountSessionManager } from "./account-sessions";
import { profileFor, zoomForPaneWidth, type ProviderDisplayProfile } from "../src/shared/provider-view-profile";
import { layoutProviderPanes, type WorkspaceViewState } from "../src/shared/workspace-layout";

/**
 * Web-AI pane host (plan §4/§9). Supports both workspace views:
 * - MERGED: every provider pane is a child of the Boss window's content view
 *   (renderer-driven pane bounds).
 * - DETACHED (U4 §7/§9): the provider panes live in a second BrowserWindow
 *   ("window B") beside the Boss window ("window A"); Boss keeps its own page.
 *   Panes auto-lay out across window B's full height (never two rows) and stay
 *   in sync — opening/closing a provider moves its pane between the windows and
 *   both views re-layout. Closing window B returns the workspace to MERGED.
 */
export class ProviderViews {
  private readonly views = new Map<ProviderId, WebContentsView>();
  private readonly downloadListeners = new Map<ProviderId, { session: Session; listener: (event: ElectronEvent, item: DownloadItem) => void }>();
  /** Manual zoom overrides (U4 §9.2); when set, auto-fit zoom is skipped. */
  private readonly manualZoom = new Map<ProviderId, number>();
  /** Provider-specific zoom profiles (plan Phase 2); applied on every layout. */
  private readonly profiles: ProviderDisplayProfile[];
  /** Last renderer-provided pane bounds (host coordinates) — restored on MERGE. */
  private readonly lastBounds = new Map<ProviderId, ViewBounds>();
  private viewState: WorkspaceViewState = "MERGED";
  private webWindow: BrowserWindow | undefined;

  constructor(
    private readonly host: BrowserWindow,
    private readonly onState: (providerId: ProviderId, open: boolean) => void,
    private readonly accounts: AccountSessionManager,
    private readonly downloadPathFor: (providerId: ProviderId, suggestedName: string) => string,
    profiles: ProviderDisplayProfile[] = []
  ) {
    this.profiles = profiles;
  }

  /** Current MERGED/DETACHED workspace view. */
  workspaceView(): WorkspaceViewState {
    return this.viewState;
  }

  /** Bounds of the DETACHED web window, when one exists (for status/UI). */
  webWindowBounds(): { x: number; y: number; width: number; height: number } | undefined {
    const window = this.webWindow;
    if (!window || window.isDestroyed()) return undefined;
    return window.getBounds();
  }

  /** The live DETACHED web window instance, when one exists (state checks). */
  webWindowInstance(): BrowserWindow | undefined {
    const window = this.webWindow;
    return window && !window.isDestroyed() ? window : undefined;
  }

  private contentViewFor(viewState: WorkspaceViewState) {
    if (viewState === "DETACHED" && this.webWindow && !this.webWindow.isDestroyed()) return this.webWindow.contentView;
    return this.host.contentView;
  }

  /** Detaches `view` from whichever window currently hosts it (safe no-op). */
  private detachFromEverywhere(view: WebContentsView): void {
    if (!this.host.isDestroyed()) { try { this.host.contentView.removeChildView(view); } catch { /* not a child */ } }
    if (this.webWindow && !this.webWindow.isDestroyed()) { try { this.webWindow.contentView.removeChildView(view); } catch { /* not a child */ } }
  }

  private ensureWebWindow(): BrowserWindow {
    if (this.webWindow && !this.webWindow.isDestroyed()) return this.webWindow;
    // Window B sits to the right of the Boss window; sized from the union of
    // the panes it will host (falling back to a default pane area). Its
    // placement is clamped to the host display's work area so the pop-out is
    // never pushed off-screen (e.g. when the Boss window is maximized).
    const hostBounds = this.host.getBounds();
    const union = [...this.lastBounds.values()].reduce((area, bounds) => ({
      width: Math.max(area.width, bounds.x + bounds.width),
      height: Math.max(area.height, bounds.y + bounds.height)
    }), { width: 0, height: 0 });
    const display = screen.getDisplayMatching(hostBounds);
    const work = display.workArea;
    const width = Math.min(Math.max(420, union.width || 1280), work.width);
    const height = Math.min(Math.max(320, union.height || 800), work.height);
    const gap = 12;
    let x = hostBounds.x + hostBounds.width + gap;
    let y = hostBounds.y;
    if (x + width > work.x + work.width) x = Math.max(work.x, work.x + work.width - width);
    if (y + height > work.y + work.height) y = Math.max(work.y, work.y + work.height - height);
    const window = new BrowserWindow({
      width,
      height,
      x: Math.max(work.x, Math.min(x, work.x + work.width - width)),
      y: Math.max(work.y, Math.min(y, work.y + work.height - height)),
      title: "Codex Boss — AI panes",
      backgroundColor: "#111315",
      autoHideMenuBar: true,
      webPreferences: { sandbox: true }
    });
    window.on("resize", () => this.layoutWebWindow());
    // Closing window B by the user returns the workspace to MERGED and moves
    // every pane back into the Boss window (sessions survive the move).
    window.on("close", (event) => {
      if (this.viewState !== "DETACHED") return;
      event.preventDefault();
      this.setWorkspaceView("MERGED");
    });
    this.webWindow = window;
    return window;
  }

  /** Deterministic full-height horizontal layout of the open panes inside window B. */
  private layoutWebWindow(): void {
    const window = this.webWindow;
    if (!window || window.isDestroyed() || this.views.size === 0) return;
    const [width, height] = window.getContentSize();
    const openIds = [...this.views.keys()];
    const panes = layoutProviderPanes(openIds, Math.max(1, width), Math.max(1, height));
    for (const pane of panes) this.applyBounds(this.views.get(pane.providerId), pane);
  }

  /** Restores host-coordinate bounds for every pane after returning to MERGED. */
  private layoutHostWindow(): void {
    for (const [providerId, view] of this.views) {
      const bounds = this.lastBounds.get(providerId) ?? { x: 0, y: 0, width: 0, height: 0 };
      this.applyBounds(view, bounds);
    }
  }

  private applyBounds(view: WebContentsView | undefined, bounds: ViewBounds): void {
    if (!view || view.webContents.isDestroyed()) return;
    view.setBounds({
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height))
    });
    try {
      const providerId = [...this.views.entries()].find(([, item]) => item === view)?.[0];
      if (!providerId) return;
      const override = this.manualZoom.get(providerId);
      const zoom = override ?? zoomForPaneWidth(profileFor(this.profiles, providerId), bounds.width);
      if (Math.abs((view.webContents.getZoomFactor() ?? 1) - zoom) > 0.001) view.webContents.setZoomFactor(zoom);
    } catch { /* a not-yet-ready or closing view keeps its current zoom */ }
  }

  /**
   * Switches the workspace between MERGED and DETACHED (U4 §7/§9). Panes are
   * moved between the Boss window and window B without destroying their
   * webContents, so provider sessions survive the transition.
   */
  setWorkspaceView(state: WorkspaceViewState): WorkspaceViewState {
    if (state !== "MERGED" && state !== "DETACHED") throw new Error("Invalid workspace view");
    if (state === this.viewState) return this.viewState;
    if (state === "DETACHED") {
      const window = this.ensureWebWindow();
      // The second window is a pop-out beside the Boss window — never instead
      // of it: the main interaction window must stay open while the web-AI
      // processors are detached (restore/show it if it was minimized/hidden).
      if (this.host.isMinimized()) this.host.restore();
      if (!this.host.isVisible()) this.host.show();
      for (const view of this.views.values()) {
        if (view.webContents.isDestroyed()) continue;
        this.detachFromEverywhere(view);
        window.contentView.addChildView(view);
      }
      this.viewState = "DETACHED";
      this.layoutWebWindow();
    } else {
      const window = this.webWindow;
      this.viewState = "MERGED";
      for (const view of this.views.values()) {
        if (view.webContents.isDestroyed()) continue;
        this.detachFromEverywhere(view);
        this.host.contentView.addChildView(view);
      }
      this.layoutHostWindow();
      this.webWindow = undefined;
      if (window && !window.isDestroyed()) window.close();
    }
    return this.viewState;
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
    this.contentViewFor(this.viewState).addChildView(view);
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
    // A pane opened while DETACHED joins window B's layout immediately.
    if (this.viewState === "DETACHED") this.layoutWebWindow();
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
    this.lastBounds.delete(providerId);
    this.detachFromEverywhere(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.views.delete(providerId);
    this.onState(providerId, false);
    if (this.viewState === "DETACHED") this.layoutWebWindow();
  }

  layout(boundsByProvider: Partial<Record<ProviderId, ViewBounds>>): void {
    // Renderer-provided bounds describe the MERGED host area; remember them for
    // the merge-back, and ignore them while DETACHED (window B self-lays-out).
    for (const [providerId, bounds] of Object.entries(boundsByProvider)) {
      if (bounds && this.views.has(providerId as ProviderId)) this.lastBounds.set(providerId as ProviderId, bounds);
    }
    if (this.viewState === "DETACHED") return;
    for (const [providerId, view] of this.views) {
      const bounds = boundsByProvider[providerId];
      if (!bounds || view.webContents.isDestroyed()) continue;
      this.applyBounds(view, bounds);
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
    this.viewState = "MERGED";
    const window = this.webWindow;
    this.webWindow = undefined;
    for (const providerId of [...this.views.keys()]) this.close(providerId);
    if (window && !window.isDestroyed()) window.destroy();
  }
}
