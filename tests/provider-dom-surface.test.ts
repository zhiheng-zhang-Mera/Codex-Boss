import { describe, expect, it } from "vitest";
import { providerDomSurface } from "../electron/computer/backends/provider-dom-surface";

interface FakeView { webContents: { id: number; isDestroyed(): boolean; isCrashed(): boolean; executeJavaScript(script: string): Promise<unknown> }; }
function fakeViews(pages: Record<string, FakeView | undefined>) {
  return (() => ({ get: (id: string) => pages[id] })) as unknown as Parameters<typeof providerDomSurface>[0];
}
function page(id: number, executeJavaScript: (script: string) => Promise<unknown>): FakeView {
  return { webContents: { id, isDestroyed: () => false, isCrashed: () => false, executeJavaScript } };
}

describe("provider DOM surface (§8.2 real-page wiring)", () => {
  it("evaluates scripts on the named provider WebContentsView", async () => {
    const scripts: string[] = [];
    const views = fakeViews({ chatgpt: page(1, async (script) => { scripts.push(script); return "page-text"; }) });
    const surface = providerDomSurface(views);
    await expect(surface.evaluate<string>("1+1", { providerId: "chatgpt" })).resolves.toBe("page-text");
    expect(scripts).toEqual(["1+1"]);
  });

  it("fails closed when the provider pane is closed, crashed, or the target is ambiguous", async () => {
    const views = fakeViews({
      closed: { webContents: { id: 2, isDestroyed: () => true, isCrashed: () => false, executeJavaScript: async () => "nope" } },
      crashed: { webContents: { id: 3, isDestroyed: () => false, isCrashed: () => true, executeJavaScript: async () => "nope" } }
    });
    const surface = providerDomSurface(views);
    await expect(surface.evaluate("1", { providerId: "closed" })).rejects.toThrow(/not open/);
    await expect(surface.evaluate("1", { providerId: "crashed" })).rejects.toThrow(/crashed/);
    // No providerId → ambiguous by design (never a silent guess).
    await expect(surface.evaluate("1")).rejects.toThrow(/providerId/);
  });

  it("returns real page content when the named provider pane is open", async () => {
    const views = fakeViews({ chatgpt: page(1, async () => ({ ok: true, text: "visible" })) });
    const surface = providerDomSurface(views);
    await expect(surface.evaluate<{ ok: boolean; text: string }>("(() => ({ ok: true, text: document.body.innerText }))()", { providerId: "chatgpt" })).resolves.toMatchObject({ ok: true });
  });
});
