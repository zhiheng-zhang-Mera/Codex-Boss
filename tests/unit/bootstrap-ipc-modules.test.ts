import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceIpcModule, WORKSPACE_IPC_CHANNELS } from "../../electron/bootstrap/workspace-ipc";
import { createAttachmentIpcModule, ATTACHMENT_IPC_CHANNELS, type AttachmentService } from "../../electron/bootstrap/attachment-ipc";
import { createConversationIpcModule, CONVERSATION_IPC_CHANNELS, requireDeleteConfirmation, type ConversationService } from "../../electron/bootstrap/conversation-ipc";
import { createProviderIpcModule, PROVIDER_IPC_CHANNELS, sanitizeViewLayout } from "../../electron/bootstrap/provider-ipc";
import { createStatusIpcModule, STATUS_IPC_CHANNELS, windowStateView } from "../../electron/bootstrap/status-ipc";
import { reportBootHealth, disposeBootModules, type BootModule } from "../../electron/bootstrap/boot-module";
import { WorkspaceSelectionStore } from "../../electron/workspace/workspace-selection";

/**
 * Convergence book, Phase F/G — the boot modules are real, not a rename.
 *
 * The handlers are exercised through the same registrar Electron uses, so these
 * tests cover what the extracted code actually does: which channels exist, what
 * each one validates, what it calls, and what it returns. A source scan cannot
 * establish any of that, and the running application cannot establish it on a
 * machine where the dialog cannot be answered.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-boot-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** The `ipcMain.handle` surface, recorded instead of registered. */
function registrar(): { handle: (channel: string, listener: (event: unknown, ...args: never[]) => unknown) => void; channels: string[]; invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } {
  const listeners = new Map<string, (event: unknown, ...args: never[]) => unknown>();
  return {
    channels: [],
    handle(channel, listener) { listeners.set(channel, listener); this.channels.push(channel); },
    async invoke(channel, ...args) {
      const listener = listeners.get(channel);
      if (!listener) throw new Error(`channel not registered: ${channel}`);
      return await (listener as unknown as (event: unknown, ...rest: unknown[]) => unknown)({}, ...args);
    }
  };
}

describe("Phase F/G — workspace IPC module", () => {
  function build(selection: WorkspaceSelectionStore, dialog: { canceled: boolean; filePaths: string[] }) {
    const ipc = registrar();
    const showOpenDialog = vi.fn(async () => dialog);
    const module = createWorkspaceIpcModule({ handle: ipc.handle.bind(ipc), showOpenDialog, selection });
    return { ipc, module, showOpenDialog };
  }

  it("registers exactly the four channels it owns and reports READY", () => {
    const root = makeTree();
    const { ipc, module } = build(new WorkspaceSelectionStore(path.join(root, "sel.json")), { canceled: true, filePaths: [] });
    expect(ipc.channels.sort()).toEqual([...WORKSPACE_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "workspace-ipc", status: "READY" });
    expect(module.health().detail).toContain("4/4");
    expect(module.service.channels).toEqual(WORKSPACE_IPC_CHANNELS);
  });

  it("answers a cancelled picker with null — never an empty string", async () => {
    const root = makeTree();
    const { ipc, showOpenDialog } = build(new WorkspaceSelectionStore(path.join(root, "sel.json")), { canceled: true, filePaths: [] });
    expect(await ipc.invoke("boss:select-workspace-directory")).toBeNull();
    expect(showOpenDialog).toHaveBeenCalledWith({ title: "选择工作区目录", properties: ["openDirectory"] });
  });

  it("returns the canonical path of a picked directory and persists only that", async () => {
    const root = makeTree();
    const workspace = path.join(root, "my project");
    fs.mkdirSync(workspace);
    const selection = new WorkspaceSelectionStore(path.join(root, "sel.json"));
    const { ipc } = build(selection, { canceled: false, filePaths: [workspace.replace(/\\/g, "/")] });

    const picked = await ipc.invoke("boss:select-workspace-directory");
    expect(typeof picked).toBe("string");
    expect(fs.existsSync(picked as string)).toBe(true);

    const state = await ipc.invoke("boss:workspace-selection");
    expect(state).toMatchObject({ status: "UNSET" }); // the picker canonicalizes; the FIELD remembers
    const remembered = await ipc.invoke("boss:remember-workspace-path", picked);
    expect(remembered).toMatchObject({ status: "AVAILABLE" });
    expect(await ipc.invoke("boss:workspace-selection")).toMatchObject({ status: "AVAILABLE", path: picked });
  });

  it("validates a typed path with a machine code and refuses to remember a bad one", async () => {
    const root = makeTree();
    const selection = new WorkspaceSelectionStore(path.join(root, "sel.json"));
    const { ipc } = build(selection, { canceled: true, filePaths: [] });

    expect(await ipc.invoke("boss:validate-workspace-path", path.join(root, "gone"))).toMatchObject({ ok: false, code: "PATH_NOT_FOUND" });
    expect(await ipc.invoke("boss:validate-workspace-path", ".\\repo")).toMatchObject({ ok: false, code: "NOT_ABSOLUTE" });
    expect(await ipc.invoke("boss:remember-workspace-path", path.join(root, "gone"))).toMatchObject({ status: "REJECTED", code: "PATH_NOT_FOUND" });
    expect(selection.persistedPath()).toBeUndefined();
  });

  it("reads a deleted remembered directory as STALE instead of throwing", async () => {
    const root = makeTree();
    const workspace = path.join(root, "repo");
    fs.mkdirSync(workspace);
    const selection = new WorkspaceSelectionStore(path.join(root, "sel.json"));
    const { ipc } = build(selection, { canceled: true, filePaths: [] });
    await ipc.invoke("boss:remember-workspace-path", workspace);
    fs.rmSync(workspace, { recursive: true, force: true });
    expect(await ipc.invoke("boss:workspace-selection")).toMatchObject({ status: "STALE", code: "PATH_NOT_FOUND" });
  });
});

describe("Phase G — attachment IPC module", () => {
  function build(overrides: Partial<AttachmentService> = {}, dialog: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }) {
    const calls: string[] = [];
    const service: AttachmentService = {
      conversationExists: () => true,
      importFromPath: (input) => { calls.push(`path:${input.originalName}`); return { id: "obj-1" } as never; },
      importFromBytes: (input) => { calls.push(`bytes:${input.originalName}`); return { id: "obj-2" } as never; },
      registerInputObjects: (_conversationId, objects) => { calls.push(`register:${objects.length}`); },
      removeAttachment: () => { calls.push("removeAttachment"); },
      removeInputObject: () => { calls.push("removeInputObject"); },
      localPathFor: () => "/tmp/attachment.bin",
      ...overrides
    };
    const ipc = registrar();
    const publish = vi.fn(() => "snapshot");
    const module = createAttachmentIpcModule({ handle: ipc.handle.bind(ipc), attachments: service, publish, showOpenDialog: async () => dialog });
    return { ipc, module, calls, publish };
  }

  it("registers exactly the four channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...ATTACHMENT_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "attachment-ipc", status: "READY" });
    expect(module.health().detail).toContain("4/4");
  });

  it("a cancelled picker publishes and imports nothing", async () => {
    const { ipc, calls, publish } = build({}, { canceled: true, filePaths: [] });
    await ipc.invoke("boss:pick-attachments", "conv-1");
    expect(calls).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("imports every picked file by basename and registers the objects", async () => {
    const { ipc, calls, publish } = build({}, { canceled: false, filePaths: [path.join("C:", "tmp", "a.pdf"), path.join("C:", "tmp", "b.docx")] });
    const result = await ipc.invoke("boss:pick-attachments", "conv-1");
    expect(calls).toEqual(["path:a.pdf", "path:b.docx", "register:2"]);
    expect(result).toBe("snapshot");
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown conversation before touching the dialog", async () => {
    const { ipc, calls } = build({ conversationExists: () => false });
    await expect(ipc.invoke("boss:pick-attachments", "missing")).rejects.toThrow(/Unknown conversation/);
    expect(calls).toEqual([]);
  });

  it("imports bytes, removes from both stores, and answers the local path", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:add-attachment-bytes", { conversationId: "conv-1", originalName: "note.txt", bytes: new Uint8Array([1]) });
    expect(calls).toEqual(["bytes:note.txt", "register:1"]);
    await ipc.invoke("boss:remove-attachment", "conv-1", "obj-1");
    expect(calls).toEqual(["bytes:note.txt", "register:1", "removeAttachment", "removeInputObject"]);
    expect(await ipc.invoke("boss:attachment-path", "conv-1", "obj-1")).toBe("/tmp/attachment.bin");
  });
});

describe("Phase G — conversation IPC module", () => {
  function build(overrides: Partial<ConversationService> = {}) {
    const calls: string[] = [];
    const service: ConversationService = {
      createFolder: (name) => { calls.push(`createFolder:${name}`); },
      renameFolder: (folderId, name) => { calls.push(`renameFolder:${folderId}:${name}`); },
      createConversation: (input) => { calls.push(`createConversation:${input.folderId}:${input.title}`); },
      renameConversation: (conversationId, title) => { calls.push(`rename:${conversationId}:${title}`); },
      moveConversation: (conversationId, folderId) => { calls.push(`move:${conversationId}:${folderId}`); },
      selectConversation: (conversationId) => { calls.push(`select:${conversationId}`); },
      setConversationArchived: (conversationId, archived) => { calls.push(`archive:${conversationId}:${archived}`); },
      duplicateConversation: (conversationId) => { calls.push(`duplicate:${conversationId}`); },
      deleteConversation: (conversationId) => { calls.push(`delete:${conversationId}`); },
      exportRoot: () => "/data/exports",
      exportConversation: (conversationId, root) => { calls.push(`export:${conversationId}:${root}`); return path.join(root, `${conversationId}.md`); },
      revealInFileManager: (target) => { calls.push(`reveal:${target}`); },
      ...overrides
    };
    const ipc = registrar();
    const publish = vi.fn(() => "snapshot");
    const module = createConversationIpcModule({ handle: ipc.handle.bind(ipc), conversations: service, publish });
    return { ipc, module, calls, publish };
  }

  it("registers exactly the eleven channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...CONVERSATION_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "conversation-ipc", status: "READY" });
    expect(module.health().detail).toContain("11/11");
  });

  it("refuses to delete without the explicit confirmation flag", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:delete-conversation", "conv-1", false)).rejects.toThrow(/明确确认/);
    await expect(ipc.invoke("boss:delete-conversations", ["conv-1"], false)).rejects.toThrow(/批量删除需要明确确认/);
    expect(calls).toEqual([]);
  });

  it("deletes one confirmed conversation and publishes", async () => {
    const { ipc, calls, publish } = build();
    await ipc.invoke("boss:delete-conversation", "conv-1", true);
    expect(calls).toEqual(["delete:conv-1"]);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("keeps deleting the rest of a batch, de-duplicates it, and reports the failures", async () => {
    const { ipc, calls } = build({ deleteConversation: (conversationId) => { if (conversationId === "bad") throw new Error("locked"); calls.push(`delete:${conversationId}`); } });
    await expect(ipc.invoke("boss:delete-conversations", ["a", "bad", "a", "", "b"], true)).rejects.toThrow(/1 conversation\(s\) could not be deleted/);
    expect(calls).toEqual(["delete:a", "delete:b"]);
  });

  it("routes the simple mutations and exports + reveals", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:create-folder", "Work");
    await ipc.invoke("boss:rename-folder", "f1", "Renamed");
    await ipc.invoke("boss:create-conversation", { folderId: "f1", title: "T" });
    await ipc.invoke("boss:move-conversation", "c1", "f2");
    await ipc.invoke("boss:archive-conversation", "c1", true);
    const destination = await ipc.invoke("boss:export-conversation", "c1");
    expect(calls).toEqual([
      "createFolder:Work",
      "renameFolder:f1:Renamed",
      "createConversation:f1:T",
      "move:c1:f2",
      "archive:c1:true",
      "export:c1:/data/exports",
      `reveal:${path.join("/data/exports", "c1.md")}`
    ]);
    expect(destination).toBe(path.join("/data/exports", "c1.md"));
  });
});

describe("Phase G — provider IPC module", () => {
  function build(overrides: Partial<{ known: string[] }> = {}) {
    const calls: string[] = [];
    const ipc = registrar();
    const publish = vi.fn(() => "snapshot");
    const module = createProviderIpcModule({
      handle: ipc.handle.bind(ipc),
      providers: {
        known: () => (overrides.known ?? ["chatgpt", "claude"]) as never,
        addCustom: (name, url) => { calls.push(`add:${name}:${url}`); },
        removeCustom: (providerId) => { calls.push(`remove:${providerId}`); }
      },
      panes: {
        close: (providerId) => { calls.push(`close:${providerId}`); },
        layout: (views) => { calls.push(`layout:${Object.keys(views).sort().join(",")}`); }
      },
      openWithinLimit: (providerId) => { calls.push(`open:${providerId}`); },
      requireProvider: (providerId) => { if (providerId === "nope") throw new Error("Unknown provider"); return {}; },
      publish
    });
    return { ipc, module, calls, publish };
  }

  it("registers exactly the five channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...PROVIDER_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "provider-ipc", status: "READY" });
    expect(module.health().detail).toContain("5/5");
  });

  it("normalizes a custom provider through the shared policy before the store sees it", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:add-custom-provider", { name: "  My AI  ", url: "https://example.com/chat" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.startsWith("add:")).toBe(true);
    expect(calls[0]).not.toContain("  My AI  "); // trimmed/normalized by policy
  });

  it("closes the pane before removing the provider", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:remove-custom-provider", "custom-1");
    expect(calls).toEqual(["close:custom-1", "remove:custom-1"]);
  });

  it("validates the provider before closing its pane", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:close-provider", "nope")).rejects.toThrow(/Unknown provider/);
    expect(calls).toEqual([]);
    await ipc.invoke("boss:open-provider", "chatgpt");
    expect(calls).toEqual(["open:chatgpt"]);
  });

  it("drops panes that do not exist and bounds that are not real numbers", async () => {
    const { ipc, calls } = build({ known: ["chatgpt"] });
    await ipc.invoke("boss:layout-views", {
      chatgpt: { x: 0, y: 0, width: 100, height: 200 },
      ghost: { x: 0, y: 0, width: 10, height: 10 },
      claude: { x: Number.NaN, y: 0, width: 10, height: 10 }
    });
    expect(calls).toEqual(["layout:chatgpt"]);
  });

  it("states the sanitising rule as a pure function", () => {
    const known = ["chatgpt", "claude"] as never[];
    expect(Object.keys(sanitizeViewLayout(known, { chatgpt: { x: 1, y: 2, width: 3, height: 4 } }))).toEqual(["chatgpt"]);
    expect(Object.keys(sanitizeViewLayout(known, { claude: { x: Infinity, y: 0, width: 1, height: 1 } }))).toEqual([]);
    expect(Object.keys(sanitizeViewLayout(known, {}))).toEqual([]);
  });
});

describe("Phase G — status IPC module", () => {
  function build() {
    const ipc = registrar();
    const module = createStatusIpcModule({
      handle: ipc.handle.bind(ipc),
      status: {
        snapshot: () => ({ tasks: ["t1"] }),
        progress: () => [{ taskId: "t1" }],
        activeIntervention: (taskId) => (taskId === "t1" ? { kind: "CLARIFY" } : undefined),
        listInterventions: (taskId) => (taskId ? [{ taskId }] : [{ taskId: "t1" }, { taskId: "t2" }]),
        workspaceView: () => ({ view: "DETACHED" }),
        windowState: () => ({ view: "DETACHED", host: { visible: true } })
      }
    });
    return { ipc, module };
  }

  it("registers exactly the six read-only channels and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...STATUS_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "status-ipc", status: "READY" });
    expect(module.health().detail).toContain("read-only");
  });

  it("answers each read with the service's value", async () => {
    const { ipc } = build();
    expect(await ipc.invoke("boss:snapshot")).toEqual({ tasks: ["t1"] });
    expect(await ipc.invoke("boss:progress")).toEqual([{ taskId: "t1" }]);
    expect(await ipc.invoke("boss:active-intervention", "t1")).toEqual({ kind: "CLARIFY" });
    expect(await ipc.invoke("boss:active-intervention", "t9")).toBeUndefined();
    expect(await ipc.invoke("boss:list-interventions")).toHaveLength(2);
    expect(await ipc.invoke("boss:list-interventions", "t2")).toEqual([{ taskId: "t2" }]);
    expect(await ipc.invoke("boss:get-workspace-view")).toEqual({ view: "DETACHED" });
    expect(await ipc.invoke("boss:get-window-state")).toMatchObject({ view: "DETACHED" });
  });

  it("treats a destroyed window as an empty answer, not an error", () => {
    // The renderer polls this on a timer; the pane it asks about may be gone.
    expect(windowStateView(() => { throw new Error("Object has been destroyed"); })).toBeUndefined();
    expect(windowStateView(() => ({ visible: true, minimized: false, maximized: false, focused: true, bounds: { x: 0, y: 0, width: 1, height: 1 } }))).toMatchObject({ visible: true });
  });
});

describe("Phase F — the boot module contract", () => {
  it("reports every module's health and disposes them in reverse order", async () => {
    const order: string[] = [];
    const module = (name: string, status: "READY" | "DEGRADED" = "READY"): BootModule<unknown> => ({
      service: {},
      health: () => ({ module: name, status, detail: `${name} ${status}` }),
      dispose: () => { order.push(name); }
    });
    const modules = [module("first"), module("second", "DEGRADED")];
    const health = reportBootHealth(modules);
    expect(health.map((entry) => entry.module)).toEqual(["first", "second"]);
    expect(health.map((entry) => entry.status)).toEqual(["READY", "DEGRADED"]);
    await disposeBootModules(modules);
    expect(order).toEqual(["second", "first"]);
  });

  it("a throwing dispose never stops the rest", async () => {
    const disposed: string[] = [];
    const failing: BootModule<unknown> = { service: {}, health: () => ({ module: "failing", status: "READY", detail: "" }), dispose: () => { throw new Error("boom"); } };
    const ok: BootModule<unknown> = { service: {}, health: () => ({ module: "ok", status: "READY", detail: "" }), dispose: () => { disposed.push("ok"); } };
    await expect(disposeBootModules([ok, failing])).resolves.toBeUndefined();
    expect(disposed).toEqual(["ok"]);
  });
});
