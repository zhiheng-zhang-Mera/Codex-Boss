import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSessionManager } from "../electron/account-sessions";
import { StateStore } from "../electron/store";
import { isDispatchGroupSize } from "../src/shared/provider-policy";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function newStore(): StateStore {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-workflow-"));
  temporaryDirectories.push(directory);
  return new StateStore(path.join(directory, "state.json"));
}

describe("group dispatch checkpoints", () => {
  it("allows bounded single and multi-provider dispatch", () => {
    expect([1, 2, 3, 4, 5].filter(isDispatchGroupSize)).toEqual([1, 2, 3, 4, 5]);
  });

  it("commits only after every provider artifact is captured", () => {
    const store = newStore();
    const task = store.createTask("group", "same prompt", ["chatgpt", "gemini", "claude"]);
    const runs = store.runsForTask(task.id);
    const { checkpoint } = store.beginDispatch(task.id, 1, task.providerIds);
    runs.forEach((run) => store.updateRun(run.id, "waiting", null, "sent"));
    store.markDispatchCollecting(checkpoint.id, task.providerIds);

    store.captureArtifact(runs[0].id, "a", "https://example.test/a");
    store.captureArtifact(runs[1].id, "b", "https://example.test/b");
    expect(store.snapshot().dispatchCheckpoints[0].status).toBe("COLLECTING");
    store.captureArtifact(runs[2].id, "c", "https://example.test/c");
    expect(store.snapshot().dispatchCheckpoints[0]).toEqual(expect.objectContaining({ status: "COMMITTED", successfulProviderIds: task.providerIds }));
  });

  it("restores the previous local run record when group preparation fails", () => {
    const store = newStore();
    const task = store.createTask("rollback", "same prompt", ["chatgpt", "gemini", "claude"]);
    const { checkpoint, baseline } = store.beginDispatch(task.id, 1, task.providerIds);
    store.updateRun(baseline[0].id, "prepared", "SUCCESS", "prepared");
    store.rollbackDispatch(checkpoint.id, baseline, ["gemini"], false, "prepare failed");
    expect(store.runsForTask(task.id).every((run) => run.phase === "queued")).toBe(true);
    expect(store.snapshot().dispatchCheckpoints[0]).toEqual(expect.objectContaining({ status: "ROLLED_BACK", successfulProviderIds: [], requiresReconciliation: false }));
  });
});

describe("persistent account sessions", () => {
  it("keeps one isolated persistent partition and recognizes guest-ready input", () => {
    const store = newStore();
    const accounts = new AccountSessionManager(store);
    accounts.ensure("gemini");
    accounts.recordProbe("gemini", true, true);
    expect(store.snapshot().accounts[0]).toEqual(expect.objectContaining({ providerId: "gemini", partition: "persist:codex-boss-gemini", persistent: true, mode: "GUEST_READY" }));
  });

  it("keeps login storage while freshly navigating each new provider view", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "electron", "provider-views.ts"), "utf8");
    expect(source).toContain("loadURL(provider.url");
    expect(source).not.toContain("session.clearCache()");
    expect(source).not.toContain("clearStorageData");
    expect(source).toContain("if (!this.host.isDestroyed()) this.host.contentView.removeChildView(view)");
  });
});

describe("provider input focus policy", () => {
  it("does not publish to a destroyed host during child-view shutdown", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "electron", "main.ts"), "utf8");
    expect(source).toContain("!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()");
    const close = source.slice(source.indexOf('mainWindow.on("closed"'));
    expect(close.indexOf("mainWindow = null")).toBeLessThan(close.indexOf("providerViews?.destroyAll()"));
  });
  it("activates Grok web contents before focusing its editor for native insertion", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "electron", "provider-automation.ts"), "utf8");
    const focus = source.indexOf("view.webContents.focus()");
    const clearAndFocusEditor = source.indexOf('prepareScript(definition, "")');
    const nativeInsert = source.indexOf("view.webContents.insertText(run.inputPrompt)");
    expect(focus).toBeGreaterThan(-1);
    expect(focus).toBeLessThan(clearAndFocusEditor);
    expect(clearAndFocusEditor).toBeLessThan(nativeInsert);
    expect(source).toContain('definition.providerId === "grok"');
  });
});

describe("layout policy styles", () => {
  it("defines vertical thirds and a five-provider six-cell workspace", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "styles.css"), "utf8");
    expect(css).toContain(".provider-grid.count-3 { grid-template-columns: 1fr; grid-template-rows: repeat(3");
    expect(css).toContain(".layout-five .chat-half { grid-column: 3; grid-row: 1;");
    expect(css).toContain(".layout-five .provider-grid.count-5 .provider-pane:nth-child(5) { grid-column: 4; grid-row: 2;");
  });

  it("keeps history as an independent collapsible column with a readable bounded desktop width", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "styles.css"), "utf8");
    const renderer = fs.readFileSync(path.join(process.cwd(), "src", "renderer", "main.tsx"), "utf8");
    expect(css).toContain(".desktop-shell.layout-three { grid-template-columns: clamp(220px, 16vw, 300px) var(--controller-width, 30vw) minmax(0, 1fr)");
    expect(css).toContain(".desktop-shell.layout-five { display: grid; grid-template-columns: clamp(220px, 16vw, 300px) repeat(3");
    expect(css).toContain(".desktop-shell.layout-three.history-collapsed { grid-template-columns: 40px var(--controller-width, 30vw)");
    expect(renderer).toContain('openProviders.length === 3 ? "layout-three"');
    expect(renderer).toContain('className="controller-resizer"');
    expect(renderer).toContain('setControllerWidth(30)');
    expect(renderer).toContain('codex-boss:controller-width');
    expect(css).toContain(".layout-three .controller-resizer { display: block; position: absolute;");
    expect(css).not.toContain(".layout-three .controller-resizer { display: block; position: relative;");
    expect(css).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(css).toContain(".browser-half { grid-column: 3; grid-row: 1; }");
    expect(renderer.indexOf('<aside className="history-sidebar"')).toBeLessThan(renderer.indexOf('<section className="chat-half">'));
    expect(renderer).toContain('<div className="history-toolbar">');
    expect(renderer).toContain('aria-controls="history-content"');
    expect(renderer).toContain('codex-boss:history-collapsed');
  });
});
