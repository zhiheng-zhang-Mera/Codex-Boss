import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryRepository, safeSegment } from "../electron/history-repository";
import { StateStore } from "../electron/store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-history-"));
  temporaryDirectories.push(root);
  const historyRoot = path.join(root, "history");
  return { root, historyRoot, store: new StateStore(path.join(root, "state.json"), new HistoryRepository(historyRoot)) };
}

describe("local conversation history", () => {
  it("creates a folder/chat tree and writes message and artifact files", () => {
    const { store, historyRoot } = workspace();
    const folder = store.createFolder("研究/资料");
    const conversation = store.createConversation(folder.id, "模型比较");
    const task = store.createTask("第一问", "比较三个方案", ["chatgpt", "gemini", "claude"], "direct", "chat", {}, conversation.id);
    const run = store.runsForTask(task.id)[0];
    store.captureArtifact(run.id, "ChatGPT 回答", "https://example.test/answer");

    const destination = path.join(historyRoot, folder.storageName, conversation.storageName);
    expect(fs.existsSync(path.join(destination, "conversation.json"))).toBe(true);
    expect(fs.readFileSync(path.join(destination, "messages.md"), "utf8")).toContain("比较三个方案");
    expect(fs.readdirSync(path.join(destination, "artifacts"))).toHaveLength(1);
  });

  it("moves the physical directory when folder or conversation names change", () => {
    const { store, historyRoot } = workspace();
    const originalFolder = store.createFolder("项目 A");
    const conversation = store.createConversation(originalFolder.id, "旧名称");
    const oldFolderStorageName = originalFolder.storageName;
    const oldPath = path.join(historyRoot, oldFolderStorageName, conversation.storageName);
    expect(fs.existsSync(oldPath)).toBe(true);

    store.renameConversation(conversation.id, "新名称");
    store.renameFolder(originalFolder.id, "项目 B");
    const snapshot = store.snapshot();
    const renamedFolder = snapshot.folders.find((item) => item.id === originalFolder.id)!;
    const renamedConversation = snapshot.conversations.find((item) => item.id === conversation.id)!;
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(historyRoot, oldFolderStorageName))).toBe(false);
    expect(fs.existsSync(path.join(historyRoot, renamedFolder.storageName, renamedConversation.storageName, "messages.md"))).toBe(true);
  });

  it("sanitizes Windows-reserved and traversal-like path segments", () => {
    expect(safeSegment("../bad:name")).toBe("..-bad-name");
    expect(safeSegment("CON")).toBe("_CON");
  });

  it("routes generated downloads into the active conversation without overwriting names", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-boss-download-"));
    const history = new HistoryRepository(path.join(root, "history"));
    const store = new StateStore(path.join(root, "state.json"), history);
    const snapshot = store.snapshot();
    const first = history.generatedFilePath(snapshot, snapshot.activeConversationId, "chatgpt", "report?.pdf");
    fs.writeFileSync(first, "first");
    const second = history.generatedFilePath(snapshot, snapshot.activeConversationId, "chatgpt", "report?.pdf");
    expect(path.relative(path.join(root, "history"), first)).toBe(path.join("常规", "新对话", "generated", "chatgpt", "report-.pdf"));
    expect(path.basename(second)).toBe("report- (2).pdf");
  });

  it("restores the active conversation without adding blank history", () => {
    const { root, store } = workspace();
    store.createFolder("触发持久化");
    const previousActiveId = store.snapshot().activeConversationId;
    const restored = new StateStore(path.join(root, "state.json"), new HistoryRepository(path.join(root, "history")));
    expect(restored.snapshot().activeConversationId).toBe(previousActiveId);
    expect(restored.snapshot().conversations[0]).toEqual(expect.objectContaining({ title: "新对话", taskIds: [] }));
  });

  it("preserves sent tasks and history across restart", () => {
    const { root, historyRoot, store } = workspace();
    const previous = store.snapshot();
    const conversation = previous.conversations.find((item) => item.id === previous.activeConversationId)!;
    const folder = previous.folders.find((item) => item.id === conversation.folderId)!;
    const oldDirectory = path.join(historyRoot, folder.storageName, conversation.storageName);
    const task = store.createTask("未完成", "只有用户发送的内容", ["chatgpt", "gemini", "grok"]);
    for (const run of store.runsForTask(task.id)) store.updateRun(run.id, "waiting", null, "已发送，等待回复");
    expect(fs.readFileSync(path.join(oldDirectory, "messages.md"), "utf8")).toContain("只有用户发送的内容");

    const restored = new StateStore(path.join(root, "state.json"), new HistoryRepository(historyRoot));
    const snapshot = restored.snapshot();
    expect(snapshot.tasks.some((item) => item.id === task.id)).toBe(true);
    expect(snapshot.runs.some((run) => run.taskId === task.id)).toBe(true);
    expect(snapshot.activeConversationId).toBe(conversation.id);
    expect(fs.readFileSync(path.join(oldDirectory, "messages.md"), "utf8")).toContain("只有用户发送的内容");
  });
});
