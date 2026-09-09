import fs from "node:fs";
import path from "node:path";
import type { AppSnapshot, BossConversation, ConversationFolder } from "../src/shared/contracts";

interface HistoryIndex {
  version: 1;
  conversations: Record<string, string>;
}

export class HistoryRepository {
  private readonly indexPath: string;

  constructor(private readonly root: string) {
    this.indexPath = path.join(root, ".codex-boss-history-index.json");
  }

  sync(snapshot: AppSnapshot): void {
    fs.mkdirSync(this.root, { recursive: true });
    const index = this.readIndex();
    const folders = new Map(snapshot.folders.map((folder) => [folder.id, folder]));
    for (const conversation of snapshot.conversations) {
      const folder = folders.get(conversation.folderId);
      if (!folder) continue;
      const relative = path.join(folder.storageName, conversation.storageName);
      const previous = index.conversations[conversation.id];
      if (previous && previous !== relative) this.moveDirectory(previous, relative);
      const destination = this.resolveRelative(relative);
      fs.mkdirSync(destination, { recursive: true });
      this.writeConversation(snapshot, folder, conversation, destination);
      index.conversations[conversation.id] = relative;
    }
    this.atomicWrite(this.indexPath, JSON.stringify(index, null, 2));
  }

  generatedFilePath(snapshot: AppSnapshot, conversationId: string, providerId: string, suggestedName: string): string {
    const conversation = snapshot.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);
    const folder = snapshot.folders.find((item) => item.id === conversation.folderId);
    if (!folder) throw new Error(`Unknown conversation folder: ${conversation.folderId}`);
    const directory = this.resolveRelative(path.join(folder.storageName, conversation.storageName, "generated", safeSegment(providerId)));
    fs.mkdirSync(directory, { recursive: true });
    const fileName = safeSegment(suggestedName);
    const extension = path.extname(fileName);
    const stem = path.basename(fileName, extension);
    let candidate = path.join(directory, fileName);
    for (let copy = 2; fs.existsSync(candidate); copy += 1) candidate = path.join(directory, `${stem} (${copy})${extension}`);
    return candidate;
  }

  private writeConversation(snapshot: AppSnapshot, folder: ConversationFolder, conversation: BossConversation, destination: string): void {
    const tasks = snapshot.tasks.filter((task) => task.conversationId === conversation.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const taskIds = new Set(tasks.map((task) => task.id));
    const runs = snapshot.runs.filter((run) => taskIds.has(run.taskId));
    const artifacts = snapshot.artifacts.filter((artifact) => taskIds.has(artifact.taskId));
    const evidence = snapshot.evidenceBundles.filter((bundle) => taskIds.has(bundle.taskId));
    const metadata = { version: 1, folder: { id: folder.id, name: folder.name }, conversation, tasks, runs, updatedAt: new Date().toISOString() };
    this.atomicWrite(path.join(destination, "conversation.json"), JSON.stringify(metadata, null, 2));

    const messageLines = [`# ${conversation.title}`, ""];
    for (const task of tasks) {
      messageLines.push(`## ${task.title}`, "", `- 时间: ${task.createdAt}`, `- 模式: ${task.appMode}/${task.mode}`, "", "### 用户", "", task.prompt, "");
      for (const artifact of artifacts.filter((item) => item.taskId === task.id).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
        messageLines.push(`### ${artifact.providerId} (${artifact.kind})`, "", artifact.content, "");
      }
    }
    this.atomicWrite(path.join(destination, "messages.md"), messageLines.join("\n"));

    const artifactDirectory = path.join(destination, "artifacts");
    for (const artifact of artifacts) {
      fs.mkdirSync(artifactDirectory, { recursive: true });
      this.atomicWrite(path.join(artifactDirectory, `${safeSegment(artifact.providerId)}-${safeSegment(artifact.id)}.md`), artifact.content);
    }
    const evidenceDirectory = path.join(destination, "evidence");
    for (const bundle of evidence) {
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      this.atomicWrite(path.join(evidenceDirectory, `${safeSegment(bundle.id)}.json`), JSON.stringify(bundle, null, 2));
    }
  }

  private moveDirectory(fromRelative: string, toRelative: string): void {
    const from = this.resolveRelative(fromRelative);
    const to = this.resolveRelative(toRelative);
    if (!fs.existsSync(from)) return;
    if (fs.existsSync(to)) throw new Error(`历史目录目标已存在：${toRelative}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    let emptyParent = path.dirname(from);
    const resolvedRoot = path.resolve(this.root);
    while (emptyParent !== resolvedRoot && emptyParent.startsWith(`${resolvedRoot}${path.sep}`)) {
      if (fs.readdirSync(emptyParent).length > 0) break;
      fs.rmdirSync(emptyParent);
      emptyParent = path.dirname(emptyParent);
    }
  }

  private resolveRelative(relative: string): string {
    const resolvedRoot = path.resolve(this.root);
    const resolved = path.resolve(this.root, relative);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("历史目录越界");
    return resolved;
  }

  private readIndex(): HistoryIndex {
    try {
      const index = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as HistoryIndex;
      return index.version === 1 && index.conversations ? index : { version: 1, conversations: {} };
    } catch {
      return { version: 1, conversations: {} };
    }
  }

  private atomicWrite(filePath: string, content: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, content, "utf8");
    try { fs.renameSync(temporary, filePath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EEXIST", "EPERM"].includes(code ?? "")) throw error;
      fs.copyFileSync(temporary, filePath);
      fs.unlinkSync(temporary);
    }
  }
}

export function safeSegment(value: string): string {
  const cleaned = value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").replace(/\s+/g, " ").slice(0, 80);
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned);
  return reserved ? `_${cleaned}` : cleaned || "未命名";
}
