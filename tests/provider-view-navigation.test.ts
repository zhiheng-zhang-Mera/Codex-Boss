import { expect, it, vi } from "vitest";
import { ProviderViews } from "../electron/provider-views";
import { providerSeed } from "../electron/store";
vi.mock("electron", () => ({
 BrowserWindow: class {},
 WebContentsView: class {
  webContents = { isDestroyed: () => false, setWindowOpenHandler: vi.fn(), loadURL: vi.fn(async () => {}), session: { on: vi.fn(), off: vi.fn() }, close: vi.fn() };
  setBackgroundColor() {}
 }
}));
it("creates recovery views without starting a competing homepage load", async () => {
 const host = { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, isDestroyed: () => false };
 const accounts = { ensure: vi.fn(), partitionFor: () => "persist:test", mount: vi.fn() };
 const views = new ProviderViews(host as never, () => {}, accounts as never, () => "unused");
 const provider = providerSeed[0];
 const recovered = views.open(provider, false);
 expect(recovered.webContents.loadURL).not.toHaveBeenCalled();
 await recovered.webContents.loadURL("https://chatgpt.com/c/restored");
 expect(recovered.webContents.loadURL).toHaveBeenCalledTimes(1);
 expect(views.open(provider)).toBe(recovered);
 expect(recovered.webContents.loadURL).toHaveBeenCalledTimes(1);
 views.close(provider.id);
 const normal = views.open(provider);
 expect(normal.webContents.loadURL).toHaveBeenCalledExactlyOnceWith(provider.url);
});
