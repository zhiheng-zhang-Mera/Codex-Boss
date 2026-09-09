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

  it("archives and restores a conversation without deleting anything", () => {
    const { store } = workspace();
    const conversation = store.createConversation(store.snapshot().folders[0].id, "可归档");
    store.setConversationArchived(conversation.id, true);
    expect(store.snapshot().conversations.find((item) => item.id === conversation.id)?.archived).toBe(true);
    expect(store.snapshot().tasks.filter((task) => task.conversationId === conversation.id)).toHaveLength(0);
    store.setConversationArchived(conversation.id, false);
    expect(store.snapshot().conversations.find((item) => item.id === conversation.id)?.archived).toBeUndefined();
  });

  it("deletes a conversation with full cascade (no orphan state or history files)", () => {
    const { historyRoot, store } = workspace();
    const folder = store.createFolder("A");
    const conversation = store.createConversation(folder.id, "待删除");
    const task = store.createTask("任务", "目标", ["chatgpt"], "direct", "chat", {}, conversation.id);
    const run = store.runsForTask(task.id)[0];
    store.updateRun(run.id, "completed", "SUCCESS", "完成");
    store.captureArtifact(run.id, "答案", "https://example.test/answer");
    const snapshot = store.snapshot();
    expect(snapshot.conversations.some((item) => item.id === conversation.id)).toBe(true);
    const destination = path.join(historyRoot, folder.storageName, conversation.storageName);
    expect(fs.existsSync(destination)).toBe(true);

    store.deleteConversation(conversation.id);
    const after = store.snapshot();
    expect(after.conversations.some((item) => item.id === conversation.id)).toBe(false);
    expect(after.tasks.some((item) => item.id === task.id)).toBe(false);
    expect(after.runs.some((item) => item.taskId === task.id)).toBe(false);
    expect(after.artifacts.some((item) => item.taskId === task.id)).toBe(false);
    // Active conversation falls back to a valid one.
    expect(after.activeConversationId).toBeTruthy();
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("duplicates a conversation with fresh ids and no shared run/checkpoint references", () => {
    const { store } = workspace();
    const conversation = store.createConversation(store.snapshot().folders[0].id, "原对话");
    const task = store.createTask("原任务", "目标", ["chatgpt"]);
    const copy = store.duplicateConversation(conversation.id);
    const snapshot = store.snapshot();
    const copiedTask = snapshot.tasks.find((item) => item.conversationId === copy.id);
    expect(copy.id).not.toBe(conversation.id);
    expect(copiedTask).toBeDefined();
    expect(copiedTask!.id).not.toBe(task.id);
    expect(copiedTask!.conversationId).toBe(copy.id);
    expect(snapshot.conversations.some((item) => item.id === conversation.id)).toBe(true); // original untouched
    expect(copy.taskIds).toContain(copiedTask!.id);
  });

  it("exports a conversation into a timestamped directory with messages + artifacts", () => {
    const { root, store } = workspace();
    const conversation = store.createConversation(store.snapshot().folders[0].id, "要导出");
    const task = store.createTask("任务", "导出目标", ["chatgpt"], "direct", "chat", {}, conversation.id);
    const run = store.runsForTask(task.id)[0];
    store.captureArtifact(run.id, "导出内容", "https://example.test/export");
    const exportRoot = path.join(root, "exports");
    const destination = new HistoryRepository(path.join(root, "history")).exportConversation(store.snapshot(), conversation.id, exportRoot);
    expect(fs.existsSync(path.join(destination, "messages.md"))).toBe(true);
    expect(fs.readFileSync(path.join(destination, "messages.md"), "utf8")).toContain("导出目标");
    expect(fs.readdirSync(path.join(destination, "artifacts"))).toHaveLength(1);
    expect(path.dirname(destination)).toBe(path.join(exportRoot, store.snapshot().folders[0].storageName));
  });
});
