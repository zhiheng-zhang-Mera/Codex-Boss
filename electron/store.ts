import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppSnapshot, AuditEvent, BossTask, Provider, ProviderId, TaskStatus } from "../src/shared/contracts";

export const providerSeed: Provider[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", accent: "#6ee7b7", windowOpen: false, isCustom: false },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", accent: "#8ab4f8", windowOpen: false, isCustom: false },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", accent: "#f0a46b", windowOpen: false, isCustom: false },
  { id: "deepseek", name: "DeepSeek", url: "https://chat.deepseek.com/", accent: "#5b8cff", windowOpen: false, isCustom: false },
  { id: "qwen", name: "Qwen", url: "https://chat.qwen.ai/", accent: "#8b7cf6", windowOpen: false, isCustom: false },
  { id: "kimi", name: "Kimi", url: "https://www.kimi.com/", accent: "#48c7b5", windowOpen: false, isCustom: false },
  { id: "grok", name: "Grok", url: "https://grok.com/", accent: "#d8d8d8", windowOpen: false, isCustom: false },
  { id: "perplexity", name: "Perplexity", url: "https://www.perplexity.ai/", accent: "#20b8a7", windowOpen: false, isCustom: false },
  { id: "copilot", name: "Microsoft Copilot", url: "https://copilot.microsoft.com/", accent: "#8d74ff", windowOpen: false, isCustom: false },
  { id: "mistral", name: "Mistral", url: "https://chat.mistral.ai/chat", accent: "#ff8c42", windowOpen: false, isCustom: false },
  { id: "doubao", name: "豆包", url: "https://www.doubao.com/chat/", accent: "#31a8ff", windowOpen: false, isCustom: false }
];

export class StateStore {
  private snapshotValue: AppSnapshot;

  constructor(private readonly filePath: string) {
    this.snapshotValue = this.read();
  }

  snapshot(): AppSnapshot {
    return structuredClone(this.snapshotValue);
  }

  createTask(title: string, prompt: string, providerIds: ProviderId[]): BossTask {
    const now = new Date().toISOString();
    const task: BossTask = { id: randomUUID(), title, prompt, providerIds, status: "queued", createdAt: now, updatedAt: now };
    this.snapshotValue.tasks.unshift(task);
    this.event("task.created", `任务“${title}”已加入队列`, { taskId: task.id });
    this.persist();
    return task;
  }

  addCustomProvider(name: string, url: string): Provider {
    const provider: Provider = {
      id: `custom-${randomUUID()}`,
      name,
      url,
      accent: "#d9f99d",
      windowOpen: false,
      isCustom: true
    };
    this.snapshotValue.providers.push(provider);
    this.event("provider.added", `自定义网页 AI“${name}”已添加`, { providerId: provider.id });
    this.persist();
    return provider;
  }

  removeCustomProvider(providerId: ProviderId): void {
    const index = this.snapshotValue.providers.findIndex((item) => item.id === providerId && item.isCustom);
    if (index < 0) throw new Error(`Unknown custom provider: ${providerId}`);
    const [provider] = this.snapshotValue.providers.splice(index, 1);
    this.event("provider.removed", `自定义网页 AI“${provider.name}”已移除`, { providerId });
    this.persist();
  }

  setTaskStatus(taskId: string, status: TaskStatus): void {
    const task = this.snapshotValue.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    task.status = status;
    task.updatedAt = new Date().toISOString();
    this.event(status === "running" ? "task.started" : "task.status", `任务“${task.title}”状态变更为 ${status}`, { taskId });
    this.persist();
  }

  setWindow(providerId: ProviderId, open: boolean): void {
    const provider = this.snapshotValue.providers.find((item) => item.id === providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    if (provider.windowOpen === open) return;
    provider.windowOpen = open;
    this.event(open ? "window.opened" : "window.closed", `${provider.name} 子窗口已${open ? "打开" : "关闭"}`, { providerId });
    this.persist();
  }

  private event(type: AuditEvent["type"], message: string, refs: Pick<AuditEvent, "taskId" | "providerId">): void {
    this.snapshotValue.events.unshift({ id: randomUUID(), at: new Date().toISOString(), type, message, ...refs });
    this.snapshotValue.events = this.snapshotValue.events.slice(0, 200);
  }

  private read(): AppSnapshot {
    try {
      const saved = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AppSnapshot>;
      const builtins = providerSeed.map((seed) => ({ ...seed, ...(saved.providers?.find((item) => item.id === seed.id) ?? {}), windowOpen: false, isCustom: false }));
      const custom = (saved.providers ?? []).filter((item) => item.isCustom).map((item) => ({ ...item, windowOpen: false }));
      const providers = [...builtins, ...custom];
      const tasks = (saved.tasks ?? []).map((task) => {
        const legacy = task as BossTask & { providerId?: ProviderId };
        return { ...task, providerIds: task.providerIds ?? (legacy.providerId ? [legacy.providerId] : ["chatgpt"]) };
      });
      return { providers, tasks, events: saved.events ?? [] };
    } catch {
      return { providers: structuredClone(providerSeed), tasks: [], events: [] };
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.snapshotValue, null, 2), "utf8");
    try {
      fs.renameSync(temp, this.filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      fs.copyFileSync(temp, this.filePath);
      fs.unlinkSync(temp);
    }
  }
}
