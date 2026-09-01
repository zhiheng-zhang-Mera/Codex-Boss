import { BrowserWindow, shell } from "electron";
import type { Provider, ProviderId } from "../src/shared/contracts";

export class ProviderWindows {
  private readonly windows = new Map<ProviderId, BrowserWindow>();

  constructor(
    private readonly onState: (providerId: ProviderId, open: boolean) => void
  ) {}

  open(provider: Provider): BrowserWindow {
    const existing = this.windows.get(provider.id);
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing;
    }

    const offset = this.windows.size * 32;
    const child = new BrowserWindow({
      title: `${provider.name} · Codex Boss Processor`,
      width: 1180,
      height: 820,
      x: 120 + offset,
      y: 90 + offset,
      show: false,
      backgroundColor: "#101113",
      autoHideMenuBar: true,
      webPreferences: {
        partition: `persist:codex-boss-${provider.id}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    child.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    child.once("ready-to-show", () => child.show());
    child.on("closed", () => {
      this.windows.delete(provider.id);
      this.onState(provider.id, false);
    });
    this.windows.set(provider.id, child);
    this.onState(provider.id, true);
    void child.loadURL(provider.url);
    return child;
  }
}
