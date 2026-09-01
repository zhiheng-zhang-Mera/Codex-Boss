import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppSnapshot, AuditEvent, BossTask, Provider, ProviderId, TaskStatus } from "../src/shared/contracts";

const providerSeed: Provider[] = [
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/", accent: "#6ee7b7", windowOpen: false },
  { id: "claude", name: "Claude", url: "https://claude.ai/new", accent: "#f0a46b", windowOpen: false },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/app", accent: "#8ab4f8", windowOpen: false }
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
      const providers = providerSeed.map((seed) => ({ ...seed, ...(saved.providers?.find((item) => item.id === seed.id) ?? {}), windowOpen: false }));
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
