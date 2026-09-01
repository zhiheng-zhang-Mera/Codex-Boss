import { BrowserWindow, WebContentsView } from "electron";
import type { Provider, ProviderId, ViewBounds } from "../src/shared/contracts";

export class ProviderViews {
  private readonly views = new Map<ProviderId, WebContentsView>();

  constructor(
    private readonly host: BrowserWindow,
    private readonly onState: (providerId: ProviderId, open: boolean) => void
  ) {}

  open(provider: Provider): WebContentsView {
    const existing = this.views.get(provider.id);
    if (existing && !existing.webContents.isDestroyed()) return existing;

    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:codex-boss-${provider.id}`,
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
    this.onState(provider.id, true);
    void view.webContents.loadURL(provider.url);
    return view;
  }

  close(providerId: ProviderId): void {
    const view = this.views.get(providerId);
    if (!view) return;
    this.host.contentView.removeChildView(view);
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
    }
  }

  destroyAll(): void {
    for (const providerId of [...this.views.keys()]) this.close(providerId);
  }
}
