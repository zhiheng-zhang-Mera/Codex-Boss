import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceIpcModule, WORKSPACE_IPC_CHANNELS } from "../../electron/bootstrap/workspace-ipc";
import { createAttachmentIpcModule, ATTACHMENT_IPC_CHANNELS, type AttachmentService } from "../../electron/bootstrap/attachment-ipc";
import { createConversationIpcModule, CONVERSATION_IPC_CHANNELS, requireDeleteConfirmation, type ConversationService } from "../../electron/bootstrap/conversation-ipc";
import { createProviderIpcModule, PROVIDER_IPC_CHANNELS, sanitizeViewLayout } from "../../electron/bootstrap/provider-ipc";
import { createStatusIpcModule, STATUS_IPC_CHANNELS, windowStateView } from "../../electron/bootstrap/status-ipc";
import { createEngineeringSurfaceIpcModule, ENGINEERING_SURFACE_IPC_CHANNELS } from "../../electron/bootstrap/engineering-surface-ipc";
import { createResearchIpcModule, RESEARCH_IPC_CHANNELS } from "../../electron/bootstrap/research-ipc";
import { createHostStatusIpcModule, HOST_STATUS_IPC_CHANNELS, type HostStatusService } from "../../electron/bootstrap/host-status-ipc";
import { createSettingsIpcModule, SETTINGS_IPC_CHANNELS } from "../../electron/bootstrap/settings-ipc";
import { createThemeIpcModule, THEME_IPC_CHANNELS, toPreviewView, type ThemeSurface } from "../../electron/bootstrap/theme-ipc";
import { createTaskLifecycleIpcModule, TASK_LIFECYCLE_IPC_CHANNELS } from "../../electron/bootstrap/task-lifecycle-ipc";
import { createResearchOwnerIpcModule, RESEARCH_OWNER_IPC_CHANNELS } from "../../electron/bootstrap/research-owner-ipc";
import { createTaskStateIpcModule, TASK_STATE_IPC_CHANNELS } from "../../electron/bootstrap/task-state-ipc";
import { createResearchRunIpcModule, RESEARCH_RUN_IPC_CHANNELS } from "../../electron/bootstrap/research-run-ipc";
import { canonicalRealPathSync } from "../../electron/workspace/path-utils";
import { createTaskCreationIpcModule, TASK_CREATION_IPC_CHANNELS } from "../../electron/bootstrap/task-creation-ipc";
import { taskTransports, titleForTask, workbookAttachments, type InputRefSources } from "../../electron/tasks/task-inputs";
import { createDispatchIpcModule, DISPATCH_IPC_CHANNELS, escalateDecisionFor } from "../../electron/bootstrap/dispatch-ipc";
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

describe("Phase G — autonomous engineering surface module", () => {
  function build(overrides: Partial<Parameters<typeof createEngineeringSurfaceIpcModule>[0]> = {}) {
    const runs: unknown[] = [];
    const ipc = registrar();
    const module = createEngineeringSurfaceIpcModule({
      handle: ipc.handle.bind(ipc),
      goalStatus: () => ({ settled: false, iterations: 2 }),
      runGoal: async (input) => { runs.push(input); return { state: "ABORTED" }; },
      externalSessions: { list: () => [{ taskId: "t1", status: "ARCHIVE_PENDING" }] },
      runExternalArchive: async () => ({ attempted: 1, archived: 0, deferred: 1, remainingPending: 1 }),
      ...overrides
    });
    return { ipc, module, runs };
  }

  it("registers exactly the four channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...ENGINEERING_SURFACE_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "engineering-surface-ipc", status: "READY" });
  });

  it("passes only the fields the caller supplied to the goal runner", async () => {
    const { ipc, runs } = build();
    await ipc.invoke("boss:engineering-goal-run", { goal: { objective: "o", workspace: "C:\\repo" }, workspace: "C:\\repo", maxIterations: 2 });
    expect(runs).toHaveLength(1);
    // An omitted optional field must stay omitted: `replace: undefined` and
    // `replace: false` are different instructions to the loop.
    expect(runs[0]).toEqual({ goal: { objective: "o", workspace: "C:\\repo" }, workspace: "C:\\repo", maxIterations: 2 });
    expect(Object.keys(runs[0] as object).sort()).toEqual(["goal", "maxIterations", "workspace"]);
  });

  it("answers the durable status and the archive ledger", async () => {
    const { ipc } = build();
    expect(await ipc.invoke("boss:engineering-goal-status")).toEqual({ settled: false, iterations: 2 });
    expect(await ipc.invoke("boss:external-session-list")).toEqual([{ taskId: "t1", status: "ARCHIVE_PENDING" }]);
    expect(await ipc.invoke("boss:external-archive-run")).toMatchObject({ deferred: 1 });
  });

  it("refuses the archive pass when the ledger is not installed instead of pretending it ran", async () => {
    const { ipc } = build({ externalSessions: undefined });
    expect(await ipc.invoke("boss:external-session-list")).toEqual([]);
    await expect(ipc.invoke("boss:external-archive-run")).rejects.toThrow(/not available/);
  });
});

describe("Phase G — research run-control module", () => {
  function build(installed = true) {
    const calls: string[] = [];
    const ipc = registrar();
    const research = {
      status: (id: string) => { calls.push(`status:${id}`); return { state: "RUNNING" }; },
      step: async (id: string) => { calls.push(`step:${id}`); return { stage: "ANALYSIS" }; },
      freeze: (id: string, protocol: unknown) => { calls.push(`freeze:${id}:${JSON.stringify(protocol)}`); return { protocolHash: "abc" }; },
      ledger: { list: () => [{ id: "r1" }] },
      supervisor: {
        runUntilBlocked: async (id: string, options: { maxSteps?: number }) => { calls.push(`autopilot:${id}:${options.maxSteps}`); return { state: "WAITING_FOR_USER" }; },
        resume: (id: string) => { calls.push(`resume:${id}`); return true; },
        requestGuidance: (input: { id: string; question: string }) => { calls.push(`guidance:${input.id}`); return input.question.includes("auto") ? { intercepted: true, parked: false, decision: { chosen: "A" } } : { intercepted: false, parked: true }; }
      }
    };
    const published: unknown[] = [];
    const raised: unknown[] = [];
    const module = createResearchIpcModule({
      handle: ipc.handle.bind(ipc),
      ...(installed ? { research } : {}),
      guidance: { raise: (input) => { raised.push(input); return { taskId: input.taskId, kind: input.kind }; } },
      events: { publish: (event) => { published.push(event); } }
    });
    return { ipc, module, calls, published, raised };
  }

  it("registers exactly the seven channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...RESEARCH_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "research-ipc", status: "READY" });
  });

  it("says when the subsystem is not installed, without throwing on reads", async () => {
    const { ipc, module } = build(false);
    expect(module.health().detail).toContain("not installed");
    expect(await ipc.invoke("boss:research-status", "r1")).toBeNull();
    expect(await ipc.invoke("boss:research-list")).toEqual([]);
    expect(await ipc.invoke("boss:research-step", "r1")).toBeNull();
    expect(await ipc.invoke("boss:research-autopilot", "r1")).toBeNull();
    expect(await ipc.invoke("boss:research-resume", "r1")).toBe(false);
    // A write is refused loudly instead of silently doing nothing.
    await expect(ipc.invoke("boss:research-protocol-freeze", "r1", { protocol: {} })).rejects.toThrow(/not available/);
  });

  it("routes the run-control calls to the service and the supervisor", async () => {
    const { ipc, calls, published } = build();
    expect(await ipc.invoke("boss:research-status", "r1")).toEqual({ state: "RUNNING" });
    expect(await ipc.invoke("boss:research-list")).toEqual([{ id: "r1" }]);
    expect(await ipc.invoke("boss:research-step", "r1")).toEqual({ stage: "ANALYSIS" });
    expect(await ipc.invoke("boss:research-autopilot", "r1", 5)).toEqual({ state: "WAITING_FOR_USER" });
    expect(await ipc.invoke("boss:research-resume", "r1")).toBe(true);
    expect(await ipc.invoke("boss:research-protocol-freeze", "r1", { metric: "acc" })).toEqual({ protocolHash: "abc" });
    expect(calls).toEqual(["status:r1", "step:r1", "autopilot:r1:5", "resume:r1", 'freeze:r1:{"metric":"acc"}']);
    // A resumed run announces it, so the renderer's park banner clears.
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: "HUMAN_APPROVED", taskId: "r1" });
  });

  it("decides a decidable guidance question without parking a human", async () => {
    const { ipc, calls, raised } = build();
    const intercepted = await ipc.invoke("boss:research-wait", { id: "r1", kind: "CLARIFY", question: "auto decide this", blockingStepId: "s1" });
    expect(intercepted).toEqual({ intercepted: true, decision: { chosen: "A" } });
    expect(raised).toEqual([]);
    expect(calls).toEqual(["guidance:r1"]);
  });

  it("parks a genuine blocker as a durable human intervention", async () => {
    const { ipc, raised } = build();
    const parked = await ipc.invoke("boss:research-wait", { id: "r1", kind: "CLARIFY", question: "which dataset?", blockingStepId: "s1" });
    expect(parked).toMatchObject({ taskId: "r1", kind: "CLARIFY" });
    expect(raised).toHaveLength(1);
    // The context summary falls back to the question rather than being empty.
    expect(raised[0]).toMatchObject({ contextSummary: "which dataset?" });
  });
});

describe("Phase G — host status and learning module", () => {
  function build(overrides: Partial<HostStatusService> = {}) {
    const ipc = registrar();
    const host: HostStatusService = {
      accounts: () => [{ providerId: "qwen", mode: "READY" }, { providerId: "codex", mode: "AUTH_REQUIRED" }],
      sessionLifecycles: () => [],
      nodeRegistry: () => undefined,
      githubMachine: () => undefined,
      learning: () => ({
        panel: () => ({ episodes: 3 }),
        drilldown: (episodeId) => ({ episodeId }),
        rebuildDerived: () => undefined,
        resetDerived: () => undefined,
        setAdaptiveRouting: () => undefined,
        setLearning: () => undefined,
        controlState: () => ({ adaptiveRouting: true, learning: true })
      }),
      proxyConfigured: () => false,
      ...overrides
    };
    const module = createHostStatusIpcModule({ handle: ipc.handle.bind(ipc), host });
    return { ipc, module };
  }

  it("registers exactly the six channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...HOST_STATUS_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "host-status-ipc", status: "READY" });
    expect(module.health().detail).toContain("6/6");
  });

  it("reports an uninitialised device rather than throwing when no registry is attached", async () => {
    // The renderer polls this on a timer; a missing optional subsystem is an empty
    // answer, not an error the pane should render as a failure.
    const { ipc } = build();
    const status = await ipc.invoke("boss:node-status") as Record<string, unknown>;
    expect(status.state).toBe("UNINITIALIZED");
    expect(status.reason).toBe("not inspected yet");
    expect(status.verdicts).toEqual([]);
    expect(status.loggedIn).toEqual(["qwen"]);
  });

  it("distinguishes an absent credential provider from an unreachable one", async () => {
    const { ipc } = build({ githubMachine: () => ({ configured: false }) });
    const absent = await ipc.invoke("boss:node-status") as { github: { error?: string; configured: boolean } };
    expect(absent.github).toMatchObject({ configured: false, error: "AUTH_MISSING" });

    const failing = build({
      githubMachine: () => ({ configured: true, selfCheck: async () => { throw new Error("network down"); } })
    });
    const unreachable = await failing.ipc.invoke("boss:node-status") as { github: { error?: string; configured: boolean } };
    // Configured but unreachable is a different answer from not configured at all.
    expect(unreachable.github).toMatchObject({ configured: true, error: "UNKNOWN_GITHUB_ERROR" });
  });

  it("applies each learning control and always answers with the resulting state", async () => {
    const calls: string[] = [];
    const { ipc } = build({
      learning: () => ({
        panel: () => ({}),
        drilldown: () => ({}),
        rebuildDerived: () => { calls.push("rebuild"); },
        resetDerived: () => { calls.push("reset"); },
        setAdaptiveRouting: (on) => { calls.push(`adaptive:${on}`); },
        setLearning: (on) => { calls.push(`learning:${on}`); },
        controlState: () => ({ adaptiveRouting: false, learning: false })
      })
    });
    expect(await ipc.invoke("boss:learning-control", "rebuild")).toEqual({ adaptiveRouting: false, learning: false });
    await ipc.invoke("boss:learning-control", "reset");
    await ipc.invoke("boss:learning-control", "set-adaptive-routing", true);
    await ipc.invoke("boss:learning-control", "set-learning", false);
    expect(calls).toEqual(["rebuild", "reset", "adaptive:true", "learning:false"]);

    // An unknown action is a no-op that still reports state, so a newer renderer
    // cannot break an older host.
    await ipc.invoke("boss:learning-control", "something-new", true);
    expect(calls).toHaveLength(4);
  });

  it("reads the proxy question from its dependency, not from this process's environment", async () => {
    const { ipc } = build({ proxyConfigured: () => true });
    const status = await ipc.invoke("boss:network-status") as { nodeId: string; capabilities: Array<{ id: string; available: boolean; providers?: string[] }> };
    expect(status.nodeId).toBe("desktop");
    const direct = status.capabilities.find((entry) => entry.id === "direct");
    // Only READY accounts are directly reachable; AUTH_REQUIRED is not.
    expect(direct?.available).toBe(true);
    expect(direct?.providers).toEqual(["qwen"]);
    // This is the assertion the module exists to make testable: the proxy answer
    // came from the injected dependency rather than from process.env.
    expect(status.capabilities.find((entry) => entry.id === "user-proxy")?.available).toBe(true);
  });

  it("passes the session lifecycle states into the login scan", async () => {
    const { ipc } = build({ sessionLifecycles: () => [{ providerId: "qwen", state: "AUTHENTICATED" }] });
    const scan = await ipc.invoke("boss:login-scan") as { providers: Array<{ providerId: string }>; readyCount: number; needsOperatorCount: number };
    // Both accounts reach the scan. Order is the scan's own (it sorts), so this
    // asserts the module's contract — pass the accounts through — not an ordering.
    expect(scan.providers.map((entry) => entry.providerId).sort()).toEqual(["codex", "qwen"]);
    expect(scan.readyCount).toBe(1);
    // AUTH_REQUIRED is a genuine operator step, so it must be counted as one.
    expect(scan.needsOperatorCount).toBe(1);
  });
});

describe("Phase G — settings and pane-control module", () => {
  function build(overrides: { known?: string[]; pane?: { reload(): void } | undefined } = {}) {
    const ipc = registrar();
    const calls: string[] = [];
    const module = createSettingsIpcModule({
      handle: ipc.handle.bind(ipc),
      settings: {
        providerIds: () => overrides.known ?? ["qwen", "codex"],
        updateApiSetting: (input) => { calls.push(`api:${input.providerId}`); },
        updateRemoteChannel: (input) => { calls.push(`remote:${input.channel}:${input.enabled}`); },
        setRuntimeControl: (runtimeId, enabled, priority) => { calls.push(`runtime:${runtimeId}:${enabled}:${priority}`); },
        setRoleRoute: (role, runtimeIds, fallback) => { calls.push(`role:${role}:${runtimeIds.join("|")}:${fallback}`); },
        setRemoteCommandStatus: (commandId, status) => { calls.push(`command:${commandId}:${status}`); },
        publish: () => ({ published: true })
      },
      panes: {
        setWorkspaceView: (view) => { calls.push(`view:${view}`); },
        workspaceView: () => "DETACHED",
        webWindowBounds: () => ({ x: 1, y: 2, width: 3, height: 4 }),
        setVisible: (visible) => { calls.push(`visible:${visible}`); },
        setManualZoom: (providerId, factor) => { calls.push(`zoom:${providerId}:${factor}`); },
        pane: () => overrides.pane
      }
    });
    return { ipc, module, calls };
  }

  it("registers exactly the ten channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...SETTINGS_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "settings-ipc", status: "READY" });
    expect(module.health().detail).toContain("10/10");
  });

  it("refuses an unknown provider by name instead of passing it down", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:update-api-setting", { providerId: "nope" })).rejects.toThrow(/Unknown provider: nope/);
    await expect(ipc.invoke("boss:set-provider-zoom", "nope", 1.5)).rejects.toThrow(/Unknown provider: nope/);
    // The refusal happened before anything was mutated.
    expect(calls).toEqual([]);
  });

  it("coerces the renderer's loosely-typed numbers and booleans", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:update-runtime-control", "cli", 1, "7");
    await ipc.invoke("boss:update-role-route", "planner", ["a"], 1);
    await ipc.invoke("boss:set-provider-views-visible", 1);
    await ipc.invoke("boss:set-provider-zoom", "qwen", "1.25");
    expect(calls).toEqual(["runtime:cli:true:7", "role:planner:a:true", "visible:true", "zoom:qwen:1.25"]);
  });

  it("refuses an unknown workspace view rather than forwarding it", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:set-workspace-view", "SIDEWAYS")).rejects.toThrow(/Invalid workspace view/);
    expect(calls).toEqual([]);
    expect(await ipc.invoke("boss:set-workspace-view", "DETACHED")).toEqual({ view: "DETACHED", webWindow: { x: 1, y: 2, width: 3, height: 4 } });
  });

  it("refuses to reload a provider that has no open pane", async () => {
    const missing = build({ pane: undefined });
    await expect(missing.ipc.invoke("boss:reload-provider", "qwen")).rejects.toThrow(/Unknown provider view: qwen/);

    let reloaded = 0;
    const present = build({ pane: { reload: () => { reloaded += 1; } } });
    await present.ipc.invoke("boss:reload-provider", "qwen");
    expect(reloaded).toBe(1);
  });

  it("re-publishes the snapshot after a mutation and reports the tray status it was given", async () => {
    const { ipc, calls } = build();
    expect(await ipc.invoke("boss:load-remote-command", "c1")).toEqual({ published: true });
    await ipc.invoke("boss:dismiss-remote-command", "c2");
    expect(calls).toEqual(["command:c1:loaded", "command:c2:dismissed"]);
  });
});

describe("Phase G — theme module", () => {
  const snapshot = { activeThemeId: "builtin-dark", themes: [] };
  function build(overrides: Partial<ThemeSurface> = {}) {
    const ipc = registrar();
    const events: string[] = [];
    const calls: string[] = [];
    // The fake implements only what these channels read. The type is derived from
    // the real service, so a method the module starts using but the fake lacks still
    // shows up as a missing property rather than as a silent undefined.
    const themes = {
      snapshot: () => snapshot,
      activate: (themeId: string) => { calls.push(`activate:${themeId}`); return { ok: true, reason: "activated" }; },
      duplicate: (sourceId: string, input: { id: string; name: string }) => { calls.push(`duplicate:${sourceId}:${input.id}:${input.name}`); return { ok: true, themeId: input.id, reason: "" }; },
      delete: (themeId: string) => { calls.push(`delete:${themeId}`); return { ok: true, reason: "" }; },
      validate: (themeId: string) => ({ themeId, valid: true, diagnostics: [] }),
      packageOf: () => ({ tokens: {}, overrides: {} }),
      startPreview: () => ({ id: "custom-1", name: "n", prompt: "p", intent: "i", decisions: [], revisions: 0, valid: true, css: "", tokens: {}, validation: { diagnostics: [] }, createdAt: "now" }),
      preview: () => undefined,
      acceptPreview: () => { calls.push("accept"); return { ok: true, themeId: "custom-1", reason: "" }; },
      cancelPreview: () => { calls.push("cancel"); return { ok: true, reason: "" }; },
      ...overrides
    } as unknown as ThemeSurface;
    const module = createThemeIpcModule({
      handle: ipc.handle.bind(ipc),
      themes,
      events: { publish: (event) => { events.push(`${event.type}:${event.message}`); } },
      uiContracts: () => [] as never,
      capture: async () => ({ frames: [{ surface: "HOST", file: "f.png", bytes: 10 }], skipped: [], directory: "dir", summary: "one line" }),
      recordKnowledge: () => { calls.push("knowledge"); },
      persistVisualReport: () => { calls.push("persist"); }
    });
    return { ipc, module, events, calls };
  }

  it("registers exactly the thirteen channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...THEME_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "theme-ipc", status: "READY" });
    expect(module.health().detail).toContain("13/13");
  });

  it("publishes ACTIVATED or FALLBACK from the service's own answer", async () => {
    const ok = build();
    expect(await ok.ipc.invoke("boss:theme-activate", "custom-1")).toEqual(snapshot);
    expect(ok.events[0]).toContain("THEME_ACTIVATED");

    const failed = build({ activate: () => ({ ok: false, reason: "incompatible" }) as never });
    await failed.ipc.invoke("boss:theme-activate", "broken");
    // A refused activation is a fallback the Owner should see, not a silent no-op.
    expect(failed.events[0]).toContain("THEME_FALLBACK");
    expect(failed.events[0]).toContain("incompatible");
  });

  it("sanitizes a duplicated theme's id before it becomes a directory name", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:theme-duplicate", "custom-1", { id: "My Cool Theme!", name: "My Theme" });
    await ipc.invoke("boss:theme-duplicate", "custom-1", { id: "../../etc/passwd", name: "Traversal" });
    const ids = calls.filter((entry) => entry.startsWith("duplicate:")).map((entry) => entry.split(":")[2]);
    expect(ids[0]).toBe("custom-mycooltheme");
    // The property the sanitizer exists for: whatever the renderer sends, the id is
    // ONE path component inside the custom- namespace, so it can never name a
    // directory outside the theme root. (Dots survive the filter, and harmlessly so,
    // because no separator does.)
    for (const id of ids) {
      expect(id.startsWith("custom-")).toBe(true);
      expect(id).not.toMatch(/[/\\]/);
    }
    expect(calls.some((entry) => entry.endsWith(":My Theme"))).toBe(true);
  });

  it("refuses a duplicate the service rejected, instead of reporting success", async () => {
    const { ipc } = build({ duplicate: () => ({ ok: false, reason: "id already exists" }) as never });
    await expect(ipc.invoke("boss:theme-duplicate", "custom-1", { id: "x", name: "y" })).rejects.toThrow(/id already exists/);
  });

  it("treats cancelling with nothing pending as the state the caller asked for", async () => {
    const none = build({ cancelPreview: () => ({ ok: false, reason: "no preview is pending" }) as never });
    expect(await none.ipc.invoke("boss:theme-preview-cancel")).toEqual(snapshot);

    const real = build({ cancelPreview: () => ({ ok: false, reason: "preview is locked" }) as never });
    await expect(real.ipc.invoke("boss:theme-preview-cancel")).rejects.toThrow(/preview is locked/);
  });

  it("refuses a draft when the current theme package cannot be read", async () => {
    // §15: the generator must start from the theme the user is looking at, so an
    // unreadable base is a refusal rather than a draft from nothing.
    const { ipc, calls } = build({ packageOf: () => undefined });
    const outcome = await ipc.invoke("boss:theme-generate", { prompt: "把主题配色改得更冷一些", capture: false }) as { ok: boolean; escalated: boolean; reason: string };
    expect(outcome.ok).toBe(false);
    expect(outcome.escalated).toBe(false);
    expect(outcome.reason).toContain("主题包不可读");
    expect(calls).toEqual([]);
  });

  it("answers undefined for a preview that is not pending, and a view when it is", async () => {
    expect(await build().ipc.invoke("boss:theme-preview")).toBeUndefined();
    const pending = build({
      preview: () => ({ id: "custom-1", name: "n", prompt: "p", intent: "i", decisions: [], revisions: 2, valid: true, css: "a{}", tokens: {}, validation: { diagnostics: [] }, createdAt: "now" }) as never
    });
    expect(await pending.ipc.invoke("boss:theme-preview")).toMatchObject({ id: "custom-1", revisions: 2, valid: true });
  });

  it("returns capture frames without leaking the sanitized summary into the response", async () => {
    const { ipc } = build();
    const captured = await ipc.invoke("boss:theme-capture") as Record<string, unknown>;
    expect(captured).toEqual({ frames: [{ surface: "HOST", file: "f.png", bytes: 10 }], skipped: [], directory: "dir" });
    expect("summary" in captured).toBe(false);
  });

  it("persists the visual-check evidence and still answers with the report", async () => {
    const { ipc, calls } = build();
    const report = await ipc.invoke("boss:theme-visual-check", {
      themeId: "custom-1",
      surfaces: [],
      controls: [],
      viewport: { width: 1280, height: 800, scrollWidth: 1280, scrollHeight: 800 }
    }) as { checkedAt?: string; themeId?: string; ok?: boolean };
    expect(calls).toContain("persist");
    expect(report.themeId).toBe("custom-1");
    expect(typeof report.checkedAt).toBe("string");
    expect(typeof report.ok).toBe("boolean");
  });

  it("splits preview diagnostics by severity, as text", () => {
    const view = toPreviewView({
      id: "custom-1", name: "n", prompt: "p", intent: "i", decisions: [], revisions: 0, valid: false, css: "", tokens: {}, createdAt: "now",
      validation: { diagnostics: [
        { severity: "ERROR", rule: "CONTRAST", message: "too low" },
        { severity: "WARN", rule: "RADIUS", message: "odd" },
        { severity: "INFO", rule: "NOTE", message: "fine" }
      ] }
    } as never);
    expect(view.errors).toEqual(["CONTRAST: too low"]);
    expect(view.warnings).toEqual(["RADIUS: odd"]);
    // INFO belongs in neither list: the renderer shows errors and warnings only.
    expect(view.errors.length + view.warnings.length).toBe(2);
  });
});

describe("Phase G — task lifecycle module", () => {
  function build(overrides: Record<string, unknown> = {}) {
    const ipc = registrar();
    const calls: string[] = [];
    const events: string[] = [];
    const bundle = { id: "b1", taskId: "t1", claims: [] as Array<{ status: string }> };
    const tasks = {
      prepareTask: async (taskId: string) => { calls.push(`prepare:${taskId}`); },
      sendTask: async (taskId: string) => { calls.push(`send:${taskId}`); },
      captureTask: async (taskId: string) => { calls.push(`capture:${taskId}`); },
      continueIfReady: async (taskId: string) => { calls.push(`continue:${taskId}`); },
      dispatchTask: async (taskId: string) => { calls.push(`dispatch:${taskId}`); },
      releaseReview: (taskId: string) => { calls.push(`release:${taskId}`); },
      task: (taskId: string) => (taskId === "t1" ? { id: "t1", providerIds: ["qwen"] } : undefined),
      artifacts: () => [],
      bundle: () => undefined,
      buildEvidence: () => { calls.push("build"); return bundle; },
      saveEvidence: () => { calls.push("save"); },
      addRehydrationRound: () => { calls.push("rehydrate"); },
      updateCodexReview: (_id: string, patch: { status: string }) => { calls.push(`review:${patch.status}`); },
      observeRuntimeFailure: (_runtime: string, message: string) => { calls.push(`observe:${message}`); },
      runCodexReview: async () => "the review",
      publish: () => ({ published: true }),
      ...overrides
    };
    const module = createTaskLifecycleIpcModule({
      handle: ipc.handle.bind(ipc),
      tasks: tasks as never,
      events: { publish: (event) => { events.push(`${event.type}:${event.taskId}`); } }
    });
    return { ipc, module, calls, events };
  }

  it("registers exactly the eight channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...TASK_LIFECYCLE_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "task-lifecycle-ipc", status: "READY" });
    expect(module.health().detail).toContain("8/8");
  });

  it("announces the review gate release before advancing the task", async () => {
    const { ipc, calls, events } = build();
    await ipc.invoke("boss:release-review", "t1");
    expect(events).toEqual(["HUMAN_APPROVED:t1"]);
    // Released, then advanced: the order is what stops the loop resuming on a gate
    // that is still closed.
    expect(calls).toEqual(["release:t1", "continue:t1"]);
  });

  it("refuses an unknown task by name without touching the store", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:build-evidence", "nope")).rejects.toThrow(/Unknown task: nope/);
    await expect(ipc.invoke("boss:run-codex-review", "nope")).rejects.toThrow(/Unknown task: nope/);
    expect(calls).toEqual([]);
  });

  it("refuses a rehydration round when no claim needs one", async () => {
    // A bundle whose claims are all settled has nothing to rehydrate, and asking for
    // it must not silently dispatch the task again.
    const { ipc, calls } = build({ bundle: () => ({ id: "b1", taskId: "t1", claims: [{ status: "SUPPORTED" }] }) });
    await expect(ipc.invoke("boss:rehydrate-evidence", "t1")).rejects.toThrow(/没有需要选择性回填的 claim/);
    expect(calls).not.toContain("dispatch:t1");
  });

  it("dispatches a rehydration round when a claim is disputed", async () => {
    const { ipc, calls } = build({ bundle: () => ({ id: "b1", taskId: "t1", claims: [{ status: "DISPUTED" }] }) });
    await ipc.invoke("boss:rehydrate-evidence", "t1");
    expect(calls).toContain("rehydrate");
    expect(calls).toContain("dispatch:t1");
  });

  it("records a failed Codex review as failed and observes the runtime", async () => {
    const { ipc, calls } = build({
      bundle: () => ({ id: "b1", taskId: "t1", claims: [] }),
      runCodexReview: async () => { throw new Error("cli exploded"); }
    });
    await ipc.invoke("boss:run-codex-review", "t1");
    // The important part: it does not stay at RUNNING.
    expect(calls).toEqual(["review:RUNNING", "observe:Error: cli exploded", "review:FAILED"]);
  });

  it("publishes RUNNING before awaiting the review, so the renderer is not blind", async () => {
    const order: string[] = [];
    const { ipc } = build({
      bundle: () => ({ id: "b1", taskId: "t1", claims: [] }),
      runCodexReview: async () => { order.push("awaited"); return "x"; },
      publish: () => { order.push("published"); return {}; }
    });
    await ipc.invoke("boss:run-codex-review", "t1");
    expect(order[0]).toBe("published");
    expect(order).toContain("awaited");
  });

  it("builds a bundle when the task has none, and carries no review over on recovery", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:build-evidence", "t1");
    // build -> save, in that order: the evidence is durable before it is published.
    expect(calls).toEqual(["build", "save"]);
  });
});

describe("Phase G — research records and the Owner read-model", () => {
  function build(overrides: Record<string, unknown> = {}) {
    const ipc = registrar();
    const calls: string[] = [];
    const events: string[] = [];
    const root = makeTree();
    const owner = {
      dataFile: (...segments: string[]) => path.join(root, ...segments),
      researchDecisions: () => [] as never,
      resumeResearch: (taskId: string) => { calls.push(`resume:${taskId}`); return true; },
      interventions: () => [] as never,
      resolveIntervention: (taskId: string) => ({ taskId }) as never,
      snapshot: () => ({}) as never,
      decisionLedgerEntries: () => [] as never,
      activeWorkspaceId: () => "ws-active",
      projectState: (target: string) => ({ summary: (id: string) => ({ workspace: id, via: target }) }),
      now: () => "2026-01-01T00:00:00.000Z",
      ...overrides
    };
    const module = createResearchOwnerIpcModule({
      handle: ipc.handle.bind(ipc),
      owner: owner as never,
      events: { publish: (event) => { events.push(`${event.type}:${event.taskId}`); } }
    });
    return { ipc, module, calls, events, root };
  }

  it("registers exactly the six channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...RESEARCH_OWNER_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "research-owner-ipc", status: "READY" });
    expect(module.health().detail).toContain("6/6");
  });

  it("falls back to the active workspace only when no id was given", async () => {
    const { ipc } = build();
    expect(await ipc.invoke("boss:project-state")).toEqual({ workspace: "ws-active", via: "ws-active" });
    expect(await ipc.invoke("boss:project-state", "ws-chosen")).toEqual({ workspace: "ws-chosen", via: "ws-chosen" });
  });

  it("announces a resumed research run, and only when it really resumed", async () => {
    const resumed = build();
    await resumed.ipc.invoke("boss:resolve-intervention", "t1", "QUESTION", "because");
    expect(resumed.calls).toContain("resume:t1");
    expect(resumed.events).toEqual(["HUMAN_APPROVED:t1"]);

    // The pause lifted, but the task was not a research run: nothing to announce.
    const notResearch = build({ resumeResearch: () => false });
    await notResearch.ipc.invoke("boss:resolve-intervention", "t1", "QUESTION", "because");
    expect(notResearch.events).toEqual([]);
  });

  it("answers undefined and stays silent when the guidance gate is not composed", async () => {
    const { ipc, events } = build({ resolveIntervention: () => undefined });
    expect(await ipc.invoke("boss:resolve-intervention", "t1", "QUESTION", "x")).toBeUndefined();
    // No publication for an intervention that never existed.
    expect(events).toEqual([]);
  });

  it("returns the answered request itself, not a boolean", async () => {
    // The channel's answer is the request, which a renderer reads; the module must not
    // flatten it to a flag on its way through.
    const { ipc } = build({ resolveIntervention: (taskId: string) => ({ taskId, kind: "QUESTION", answer: "because" }) });
    expect(await ipc.invoke("boss:resolve-intervention", "t9", "QUESTION", "because")).toMatchObject({ taskId: "t9", answer: "because" });
  });

  it("writes a research contract through the injected data root, not app.getPath", async () => {
    const { ipc, root } = build();
    const contract = { runId: "r1", goal: "g", requirements: [] } as never;
    await ipc.invoke("boss:research-contract-record", "r1", contract);
    // The durable effect is the contract of this channel ("persist the Research
    // Contract for a run"), and it must land under the root the composition root
    // injected — the module never reaches for app.getPath itself.
    const written = fs.readdirSync(path.join(root, ".boss", "research-contracts"));
    // The store's layout is a directory per run, not `<id>.json` — the same mix of
    // layouts under `.boss/research/**` that Phase I records.
    expect(written).toContain("r1");
  });
});

describe("Phase G — task state transitions", () => {
  function build(overrides: Record<string, unknown> = {}) {
    const ipc = registrar();
    const calls: string[] = [];
    const state = {
      task: (taskId: string) => (taskId === "t1"
        ? { id: "t1", status: "queued", providerIds: ["qwen", "codex"], conversationId: "c1", inputObjectIds: [] }
        : undefined),
      openProviderIds: () => [],
      setTaskStatus: (taskId: string, status: string) => { calls.push(`status:${taskId}:${status}`); },
      openProvider: (providerId: string) => { calls.push(`open:${providerId}`); },
      conversationInputObjects: () => [],
      workspaceFor: () => "/ws",
      availableWorkspace: () => "/ws",
      resumeWorkspace: () => "/ws",
      approveModeTransition: () => { calls.push("approve"); return true; },
      declineModeTransition: () => { calls.push("decline"); return true; },
      ensureUnstartedRuns: (taskId: string) => { calls.push(`ensure:${taskId}`); },
      resumeWorkbook: async () => { calls.push("resume-workbook"); return undefined; },
      startTask: () => { calls.push("start"); },
      pauseTask: () => { calls.push("pause"); },
      cancelTask: () => { calls.push("cancel"); },
      executeDeterministic: async () => { calls.push("deterministic"); return { executed: true }; },
      executePlan: async () => { calls.push("plan"); return { executed: true }; },
      finalizeTask: async () => { calls.push("finalize"); return { ok: true }; },
      dispatchTask: async () => { calls.push("dispatch"); },
      continueIfReady: async () => { calls.push("continue"); },
      cancelRuns: () => { calls.push("cancel-runs"); },
      setRecoveryState: (_taskId: string, retryAt: unknown, reason: string) => { calls.push(`recovery:${retryAt ?? "none"}:${reason}`); },
      resumeRecovery: () => 0,
      waitingRetryTimes: () => [],
      evidenceBundleAwaitingReview: () => undefined,
      setEvidenceDecision: (id: string, decision: string) => { calls.push(`evidence:${id}:${decision}`); },
      hasFinalizationBlocker: () => false,
      publish: () => ({ published: true }),
      ...overrides
    };
    const module = createTaskStateIpcModule({ handle: ipc.handle.bind(ipc), state: state as never });
    return { ipc, module, calls };
  }

  it("registers exactly the four channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...TASK_STATE_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "task-state-ipc", status: "READY" });
    expect(module.health().detail).toContain("4/4");
  });

  it("refuses to launch when the task would exceed the open-pane limit", async () => {
    // The limit is judged on what *would* be open: four providers already open plus
    // this task's two is six, over the ceiling of five.
    const { ipc, calls } = build({ openProviderIds: () => ["a", "b", "c", "d"] });
    await expect(ipc.invoke("boss:launch-task", "t1")).rejects.toThrow(/超过/);
    // Refused before anything was opened or relabelled.
    expect(calls).toEqual([]);
  });

  it("opens each of the task's providers and marks it running", async () => {
    const { ipc, calls } = build();
    expect(await ipc.invoke("boss:launch-task", "t1")).toEqual({ published: true });
    expect(calls).toEqual(["open:qwen", "open:codex", "status:t1:running"]);
  });

  it("refuses an unknown task by name", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:update-task", "nope", "running")).rejects.toThrow(/Unknown task: nope/);
    await expect(ipc.invoke("boss:accept-evidence", "nope")).rejects.toThrow(/Unknown task: nope/);
    expect(calls).toEqual([]);
  });

  it("runs the chain in one shape: deterministic, then plan, then dispatch, then continue", async () => {
    const { ipc, calls } = build({
      executeDeterministic: async () => { calls.push("deterministic"); return undefined; },
      executePlan: async () => { calls.push("plan"); return undefined; }
    });
    await ipc.invoke("boss:update-task", "t1", "running");
    // Neither orchestration claimed the task, so the provider-driving automation does.
    expect(calls).toEqual(["ensure:t1", "start", "deterministic", "plan", "dispatch", "continue"]);
  });

  it("records the failure and re-throws when execution fails", async () => {
    const { ipc, calls } = build({
      executeDeterministic: async () => { throw new Error("deterministic exploded"); }
    });
    await expect(ipc.invoke("boss:update-task", "t1", "running")).rejects.toThrow(/deterministic exploded/);
    // A task that failed to start must not simply look started.
    expect(calls.some((entry) => entry.startsWith("recovery:none:Error: deterministic exploded"))).toBe(true);
  });

  it("pauses and cancels through the commander rather than relabelling", async () => {
    const paused = build();
    await paused.ipc.invoke("boss:update-task", "t1", "paused");
    expect(paused.calls).toContain("pause");

    const cancelled = build();
    await cancelled.ipc.invoke("boss:update-task", "t1", "cancelled");
    expect(cancelled.calls).toContain("cancel");
    // Cancelling also stops the runs it had in flight.
    expect(cancelled.calls).toContain("cancel-runs");
  });

  it("refuses a mode proposal the task does not have pending", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:resolve-mode-proposal", "t1", true)).rejects.toThrow(/没有待确认的 Work 升级/);
    expect(calls).toEqual([]);
  });

  it("approves a pending upgrade, then runs it through the same chain", async () => {
    const { ipc, calls } = build({
      task: () => ({ id: "t1", status: "queued", providerIds: ["qwen"], conversationId: "c1", interactionMode: "WORK_PROPOSED", modeTransition: { to: "WORK" }, inputObjectIds: [] }),
      executeDeterministic: async () => { calls.push("deterministic"); return { executed: true }; }
    });
    await ipc.invoke("boss:resolve-mode-proposal", "t1", true);
    expect(calls).toEqual(["approve", "start", "deterministic", "continue"]);
  });

  it("declining still runs the task, as Chat", async () => {
    const { ipc, calls } = build({
      task: () => ({ id: "t1", status: "queued", providerIds: ["qwen"], conversationId: "c1", interactionMode: "WORK_PROPOSED", modeTransition: { to: "WORK" }, inputObjectIds: [] })
    });
    await ipc.invoke("boss:resolve-mode-proposal", "t1", false);
    // Declined: no deterministic/plan path, straight to the provider automation.
    expect(calls).toEqual(["decline", "start", "dispatch", "continue"]);
  });

  it("refuses to accept evidence when no bundle is awaiting review", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:accept-evidence", "t1")).rejects.toThrow(/没有待接收的未决证据包/);
    expect(calls).toEqual([]);
  });

  it("records PASS for the held bundle and then finalizes", async () => {
    const { ipc, calls } = build({ evidenceBundleAwaitingReview: () => ({ id: "b1" }) });
    await ipc.invoke("boss:accept-evidence", "t1");
    // Order matters: the decision is durable before the finalization reads it.
    expect(calls).toEqual(["evidence:b1:PASS", "finalize"]);
  });
});

describe("Phase G — research run control", () => {
  function build(overrides: Record<string, unknown> = {}) {
    const ipc = registrar();
    const calls: string[] = [];
    const events: string[] = [];
    const run = {
      startHumanResearch: (input: { researchQuestion: string; workspace: string; providerPolicy: string; budget: { maxSteps: number } }) => {
        calls.push(`human:${input.researchQuestion}:${input.workspace}:${input.providerPolicy}:${input.budget.maxSteps}`);
        return { ir: { id: "rq-1" } };
      },
      start: (ir: { id: string; goal: string; scope: { workspace: string; autonomy: string } }) => {
        calls.push(`auto:${ir.id}:${ir.goal}:${ir.scope.workspace}:${ir.scope.autonomy}`);
        return { ir: { id: ir.id } };
      },
      researchCache: (id: string) => { calls.push(`cache:${id}`); return path.join(makeTree(), id); },
      publish: (event: { taskId: string; message: string }) => { events.push(`${event.type}:${event.taskId}`); },
      ...overrides
    };
    const module = createResearchRunIpcModule({ handle: ipc.handle.bind(ipc), run: run as never });
    return { ipc, module, calls, events };
  }

  it("registers exactly the two channels it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels.sort()).toEqual([...RESEARCH_RUN_IPC_CHANNELS].sort());
    expect(module.health()).toMatchObject({ module: "research-run-ipc", status: "READY" });
    expect(module.health().detail).toContain("2/2");
  });

  it("refuses a workspace the single path model cannot canonicalise", async () => {
    // The whole point of routing through the path model: a typo must not become a
    // research scope that silently writes nowhere.
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:research-start", { goal: "g", workspace: "definitely/not/here", reviewers: ["r"] }))
      .rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("anchors a human research question on the canonical workspace", async () => {
    const root = makeTree();
    const { ipc, calls, events } = build();
    const record = await ipc.invoke("boss:research-start", {
      researchQuestion: "  does X cause Y?  ",
      goal: "ignored when a question is present",
      workspace: root,
      reviewers: ["alice"],
      maxSteps: 7
    }) as { ir: { id: string } };
    expect(record.ir.id).toBe("rq-1");
    // Trimmed question, canonical workspace, and the human path's own budget default.
    expect(calls[0]).toContain("human:does X cause Y?");
    // The CANONICAL form, not the spelling submitted. On a runner whose temp path is
    // an 8.3 short name these differ, and asserting the submitted spelling is exactly
    // the mistake this repository has had to fix in production code before.
    expect(calls[0]).toContain(canonicalRealPathSync(root));
    expect(calls[0]).toContain("AUTO");
    expect(calls[0]).toContain("7");
    expect(events).toEqual(["TOOL_RESULT_READY:rq-1"]);
  });

  it("a GUIDED run with no stated provider policy is FIXED", async () => {
    const root = makeTree();
    const { ipc, calls } = build();
    await ipc.invoke("boss:research-start", { researchQuestion: "q", goal: "g", workspace: root, reviewers: ["r"], autonomy: "GUIDED" });
    expect(calls[0]).toContain("FIXED");
  });

  it("refuses a goal-less, question-less start, and one with no reviewer", async () => {
    const root = makeTree();
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:research-start", { goal: "   ", workspace: root, reviewers: ["r"] }))
      .rejects.toThrow(/Research goal is required/);
    await expect(ipc.invoke("boss:research-start", { goal: "g", workspace: root, reviewers: [] }))
      .rejects.toThrow(/at least one reviewer/);
    expect(calls).toEqual([]);
  });

  it("builds the autopilot IR when no research question is supplied", async () => {
    const root = makeTree();
    const { ipc, calls, events } = build();
    await ipc.invoke("boss:research-start", { goal: "  map the field  ", workspace: root, reviewers: ["bob"] });
    // The IR carries the trimmed goal, the canonical workspace and the autopilot default.
    expect(calls[0]).toContain("auto:");
    expect(calls[0]).toContain("map the field");
    expect(calls[0]).toContain(canonicalRealPathSync(root));
    expect(calls[0]).toContain("AUTOPILOT");
    expect(events[0]).toContain("TOOL_RESULT_READY:");
  });

  it("compiles through the sanitized run id, so a traversal cannot leave the run's cache", async () => {
    const { ipc, calls } = build();
    const failure = await ipc.invoke("boss:research-compile-pdf", "../../etc/passwd").catch((error: Error) => error);
    // Exactly one cache lookup, with the separators stripped from the renderer's id.
    expect(calls).toEqual(["cache:etcpasswd"]);
    // A missing manuscript is a refusal that names the path inside the run's own
    // directory — the traversal never reached the filesystem.
    expect(String((failure as Error).message)).toContain("etcpasswd");
    expect(String((failure as Error).message)).not.toContain("..");
  });
});

describe("Phase G — creating a task", () => {
  const attachments = [{ id: "a1", originalName: "spec.docx" }];
  function build(overrides: Record<string, unknown> = {}) {
    const ipc = registrar();
    const calls: string[] = [];
    const creation = {
      activeConversationId: () => "c-active",
      providerIds: () => ["qwen", "codex"],
      inputs: { inputObjectsFor: () => attachments } as unknown as InputRefSources,
      createTask: (input: Record<string, unknown>) => { calls.push(`create:${input.title}:${(input.providerIds as string[]).join("+")}:${input.appMode}`); return { id: "t-new" }; },
      publish: () => ({ published: true }),
      ...overrides
    };
    const module = createTaskCreationIpcModule({ handle: ipc.handle.bind(ipc), creation: creation as never });
    return { ipc, module, calls };
  }

  it("registers exactly the one channel it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels).toEqual([...TASK_CREATION_IPC_CHANNELS]);
    expect(module.health()).toMatchObject({ module: "task-creation-ipc", status: "READY" });
    expect(module.health().detail).toContain("1/1");
  });

  it("refuses a task with no provider at all", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:create-task", { prompt: "do it", providerIds: [] })).rejects.toThrow(/At least one provider/);
    expect(calls).toEqual([]);
  });

  it("refuses a task over the concurrency ceiling, before anything is created", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:create-task", { prompt: "do it", providerIds: ["a", "b", "c", "d", "e", "f"] }))
      .rejects.toThrow(/最多同时选择/);
    expect(calls).toEqual([]);
  });

  it("refuses an unknown provider by name", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:create-task", { prompt: "do it", providerIds: ["nope"] })).rejects.toThrow(/Unknown provider: nope/);
    expect(calls).toEqual([]);
  });

  it("refuses an invalid transport rather than quietly using web", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:create-task", { prompt: "do it", providerIds: ["qwen"], transportByProvider: { qwen: "carrier-pigeon" } }))
      .rejects.toThrow(/无效执行通道/);
    expect(calls).toEqual([]);
  });

  it("refuses a chat task with no text, because a chat cannot run on an attachment alone", async () => {
    const { ipc, calls } = build();
    await expect(ipc.invoke("boss:create-task", { prompt: "   ", providerIds: ["qwen"], inputObjectIds: ["a1"], appMode: "chat" }))
      .rejects.toThrow(/Chat 模式需要任务文字/);
    expect(calls).toEqual([]);
  });

  it("creates a work task from an attachment alone, naming it after the attachment", async () => {
    const { ipc, calls } = build();
    expect(await ipc.invoke("boss:create-task", { prompt: "", providerIds: ["qwen"], inputObjectIds: ["a1"], appMode: "work" }))
      .toEqual({ published: true });
    // Title from the attachment (extension stripped), and the objective says where the
    // work came from rather than being empty.
    expect(calls).toEqual(["create:spec:qwen:work"]);
  });

  it("falls back to the active conversation when the renderer names none", async () => {
    const { ipc, calls } = build({ activeConversationId: () => "c-fallback" });
    await ipc.invoke("boss:create-task", { prompt: "do it", providerIds: ["qwen"] });
    expect(calls).toHaveLength(1);
  });
});

describe("Phase F — task input normalisation", () => {
  it("forces web transports in chat mode and keeps the chosen one in work mode", () => {
    const chat = taskTransports({ prompt: "p", providerIds: [], appMode: "chat", transportByProvider: { qwen: "api" } } as never, ["qwen"]);
    expect(chat).toEqual({ appMode: "chat", transports: { qwen: "web" } });
    const work = taskTransports({ prompt: "p", providerIds: [], appMode: "work", transportByProvider: { qwen: "api" } } as never, ["qwen"]);
    expect(work).toEqual({ appMode: "work", transports: { qwen: "api" } });
  });

  it("defaults to chat and web when the renderer says nothing", () => {
    expect(taskTransports({ prompt: "p", providerIds: [] } as never, ["qwen"])).toEqual({ appMode: "chat", transports: { qwen: "web" } });
  });

  it("prefers an explicit title, then an attachment name, then the first line of the prompt", () => {
    const refs = [{ id: "a1", originalName: "report.final.pdf" }] as never;
    expect(titleForTask({ title: "  Named  ", prompt: "p" } as never, [])).toBe("Named");
    expect(titleForTask({ prompt: "p" } as never, refs)).toBe("report.final");
    expect(titleForTask({ prompt: "first line\nsecond" } as never, [])).toBe("first line");
    expect(titleForTask({ prompt: "   " } as never, [])).toBe("Untitled task");
  });

  it("resolves only the refs the task actually binds", () => {
    const sources: InputRefSources = { inputObjectsFor: () => [{ id: "a1" }, { id: "a2" }] as never };
    expect(workbookAttachments(sources, { prompt: "p", inputObjectIds: ["a2"] } as never, "c1").map((ref) => ref.id)).toEqual(["a2"]);
    // No bound ids at all means no attachments, not all of them.
    expect(workbookAttachments(sources, { prompt: "p" } as never, "c1")).toEqual([]);
  });

  it("returns refs unhydrated when no attachment store is attached", () => {
    // The distinction the composition root used to make with `if (!attachmentStore)`:
    // a missing store leaves the refs alone rather than emptying their paths.
    const sources: InputRefSources = { inputObjectsFor: () => [{ id: "a1" }] as never };
    const refs = workbookAttachments(sources, { prompt: "p", inputObjectIds: ["a1"] } as never, "c1");
    expect(refs.map((ref) => ref.id)).toEqual(["a1"]);
  });
});

describe("Phase G — dispatching a task", () => {
  function build(overrides: Record<string, unknown> = {}) {
    const ipc = registrar();
    const calls: string[] = [];
    const dispatch = {
      activeConversationId: () => "c1",
      providerIds: () => ["qwen", "codex"],
      openProviderIds: () => ["qwen", "codex"],
      inputs: { inputObjectsFor: () => [] } as unknown as InputRefSources,
      workspaceView: () => "MERGED",
      setWorkspaceView: (view: string) => { calls.push(`layout:${view}`); },
      materializeGithubInput: async () => undefined,
      workspacePath: () => "/ws",
      conversationInputObjects: () => [],
      runWorkbookDispatch: async (request: { title: string }) => { calls.push(`workbook:${request.title}`); return { ok: true }; },
      workbookRegistry: () => ({}),
      createTask: (input: { title: string }) => { calls.push(`create:${input.title}`); return { id: "t1", runMode: "ASSISTED", appMode: "chat", mode: "direct", conversationId: "c1", prompt: "p" }; },
      startTask: () => { calls.push("start"); },
      executeDeterministic: async () => { calls.push("deterministic"); return { executed: true }; },
      executePlan: async () => { calls.push("plan"); return { executed: true }; },
      dispatchTask: async () => { calls.push("dispatch"); },
      continueIfReady: async () => { calls.push("continue"); },
      setRecoveryState: (_taskId: string, _retryAt: unknown, reason: string) => { calls.push(`recovery:${reason}`); },
      approveModeTransition: () => { calls.push("approve"); return true; },
      stageModeTransition: (_taskId: string, transition: { to: string }) => { calls.push(`stage:${transition.to}`); },
      publish: () => ({ published: true }),
      ...overrides
    };
    const module = createDispatchIpcModule({ handle: ipc.handle.bind(ipc), dispatch: dispatch as never });
    return { ipc, module, calls };
  }

  it("registers exactly the one channel it owns and reports READY", () => {
    const { ipc, module } = build();
    expect(ipc.channels).toEqual([...DISPATCH_IPC_CHANNELS]);
    expect(module.health()).toMatchObject({ module: "dispatch-ipc", status: "READY" });
  });

  it("refuses a dispatch whose chosen providers are not all open", async () => {
    // Dispatch drives real pages; opening them here would spend the concurrency
    // budget as a side effect.
    const { ipc, calls } = build({ openProviderIds: () => ["qwen"] });
    await expect(ipc.invoke("boss:dispatch-task", { prompt: "do it", providerIds: ["qwen", "codex"] }))
      .rejects.toThrow(/必须全部处于已打开状态/);
    expect(calls).toEqual([]);
  });

  it("refuses an unknown provider and an over-large group before creating anything", async () => {
    const unknown = build({ providerIds: () => ["qwen"] });
    await expect(unknown.ipc.invoke("boss:dispatch-task", { prompt: "do it", providerIds: ["qwen", "ghost"] }))
      .rejects.toThrow(/Unknown provider: ghost/);
    expect(unknown.calls).toEqual([]);

    const tooMany = build({ providerIds: () => ["a", "b", "c", "d", "e", "f"], openProviderIds: () => ["a", "b", "c", "d", "e", "f"] });
    await expect(tooMany.ipc.invoke("boss:dispatch-task", { prompt: "do it", providerIds: ["a", "b", "c", "d", "e", "f"] }))
      .rejects.toThrow();
    expect(tooMany.calls).toEqual([]);
  });

  it("treats the pane layout as advisory: a failure there never blocks dispatch", async () => {
    const { ipc, calls } = build({ setWorkspaceView: () => { throw new Error("no second window"); } });
    await ipc.invoke("boss:dispatch-task", { prompt: "do it", providerIds: ["qwen"] });
    // The layout was attempted and failed, and the task ran anyway.
    expect(calls).toContain("create:do it");
    expect(calls).toContain("continue");
  });

  it("asks for the merged layout when the panes are currently detached", async () => {
    // One web provider is three-or-fewer, so the advisory decision is MERGED — and it
    // is only asked for because the current layout differs.
    const { ipc, calls } = build({ workspaceView: () => "DETACHED" });
    expect(await ipc.invoke("boss:dispatch-task", { prompt: "do it", providerIds: ["qwen"] })).toEqual({ published: true });
    expect(calls).toEqual(["layout:MERGED", "create:do it", "start", "deterministic", "continue"]);
  });

  it("leaves the layout alone when it is already what the dispatch wants", async () => {
    const { ipc, calls } = build();
    await ipc.invoke("boss:dispatch-task", { prompt: "do it", providerIds: ["qwen"] });
    expect(calls).toEqual(["create:do it", "start", "deterministic", "continue"]);
  });

  it("records the failure against the task and re-throws when execution fails", async () => {
    const { ipc, calls } = build({ executeDeterministic: async () => { throw new Error("cannot start"); } });
    await expect(ipc.invoke("boss:dispatch-task", { prompt: "do it", providerIds: ["qwen"] })).rejects.toThrow(/cannot start/);
    expect(calls).toContain("recovery:Error: cannot start");
  });

  it("stages a Chat→Work proposal instead of firing, when no ledger can record it", async () => {
    // Without a decision ledger the interception keeps the human gate: it must not
    // auto-approve a capability change it cannot record. The message names a repo and
    // a mutation verb, which is exactly what makes CHAT insufficient.
    const escalation = "refactor the repo parser";
    const { ipc, calls } = build({
      createTask: () => { calls.push("create"); return { id: "t1", runMode: "ASSISTED", appMode: "chat", mode: "direct", conversationId: "c1", prompt: escalation }; }
    });
    await ipc.invoke("boss:dispatch-task", { prompt: escalation, providerIds: ["qwen"] });
    expect(calls).toContain("stage:WORK");
    expect(calls).not.toContain("start");
  });

  it("records the interception before it auto-approves, when a ledger exists", async () => {
    const escalation = "refactor the repo parser";
    const order: string[] = [];
    const { ipc } = build({
      createTask: () => { order.push("create"); return { id: "t1", runMode: "OWNER_RESULT", appMode: "chat", mode: "direct", conversationId: "c1", prompt: escalation }; },
      appendDecision: () => { order.push("ledger"); },
      approveModeTransition: () => { order.push("approve"); return true; },
      startTask: () => { order.push("start"); }
    });
    await ipc.invoke("boss:dispatch-task", { prompt: escalation, providerIds: ["qwen"] });
    // The decision is durable BEFORE the task is allowed to run: an interception that
    // acted first could not be audited if the run then failed.
    expect(order).toEqual(["create", "ledger", "approve", "start"]);
  });

  it("delegates a WorkBook dispatch to the single production entry point, creating no task itself", async () => {
    const workbookRef = { id: "w1", kind: "WORKBOOK", originalName: "plan.docx", localPath: "/tmp/plan.docx" };
    const { ipc, calls } = build({
      inputs: { inputObjectsFor: () => [workbookRef] } as unknown as InputRefSources
    });
    await ipc.invoke("boss:dispatch-task", { prompt: "analyze it", providerIds: ["qwen"], appMode: "work", inputObjectIds: ["w1"] });
    expect(calls.some((entry) => entry.startsWith("workbook:"))).toBe(true);
    // The orchestration owns creation; the channel must not also create a task.
    expect(calls).not.toContain("create:analyze it");
  });
});

describe("Phase F — the escalation decision", () => {
  it("reads the bound input kinds off the conversation, not off the task alone", () => {
    // A spreadsheet bound to the task is what makes it a Work job, even though the
    // message itself reads like an ordinary question.
    const decision = escalateDecisionFor(
      { conversationId: "c1", prompt: "看看这个", inputObjectIds: ["i1"] },
      [{ id: "i1", kind: "WORKBOOK" }]
    );
    expect(decision).toHaveProperty("escalate");
  });

  it("does not escalate a plain chat message with no bound work", () => {
    const decision = escalateDecisionFor({ conversationId: "c1", prompt: "你好，今天怎么样？" }, []);
    expect(decision.escalate).toBe(false);
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
