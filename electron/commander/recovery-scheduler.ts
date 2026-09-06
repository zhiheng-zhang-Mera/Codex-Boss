import { readJson, writeJson } from "./durable-json";
import type { DomainEventBus } from "./event-bus";
export interface RecoveryWakeup {
  id: string; taskId: string; kind: string; retryAt: number; payload: unknown;
  attempts: number; state: "WAITING" | "RUNNING" | "PAUSED"; error?: string;
}
export type RecoveryResult = { done: true } | { done: false; retryAt?: number; error?: string };
/** Persisted deadlines, not a long-lived sleeping worker. Handlers must reconcile prior effects. */
export class RecoveryScheduler {
  private readonly records = new Map<string, RecoveryWakeup>();
  private readonly handlers = new Map<string, (record: RecoveryWakeup) => Promise<RecoveryResult>>();
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  private stopped = true;
  constructor(private readonly file: string, private readonly changed: () => void = () => {}, private readonly events?: DomainEventBus) {
    for (const record of readJson<RecoveryWakeup[]>(file) ?? []) {
      if (!record.id || !Number.isFinite(record.retryAt)) throw new Error("Invalid recovery deadline");
      this.records.set(record.id, { ...record, state: record.state === "RUNNING" ? "WAITING" : record.state });
    }
    // Event-driven wakeup (plan §13.1): a fresh due record triggers the
    // single-flight run immediately instead of waiting for the timer tick.
    events?.subscribe("DEPENDENCY_READY", () => { void this.runDue(); });
  }
  register(kind: string, handler: (record: RecoveryWakeup) => Promise<RecoveryResult>): void { this.handlers.set(kind, handler); }
  list(): RecoveryWakeup[] { return structuredClone([...this.records.values()]); }
  schedule(input: Omit<RecoveryWakeup, "attempts" | "state">): void {
    if (!Number.isFinite(input.retryAt)) throw new Error("Invalid recovery deadline");
    const previous = this.records.get(input.id);
    if (previous?.state === "RUNNING" || previous?.state === "PAUSED") return;
    const dueNow = previous ? previous.retryAt <= Date.now() && input.retryAt <= Date.now() : input.retryAt <= Date.now();
    this.records.set(input.id, { ...input, retryAt: previous ? Math.min(previous.retryAt, input.retryAt) : input.retryAt, attempts: previous?.attempts ?? 0, state: "WAITING" });
    this.persist(); this.arm();
    // Emit a domain event when the wakeup is already due so subscribers can run
    // immediately rather than wait for the next timer tick (plan §13.1).
    if (dueNow) this.events?.publish({ type: "DEPENDENCY_READY", taskId: input.taskId, retryAt: input.retryAt, message: `recovery ${input.id} due` });
  }
  resumeTask(taskId: string, now = Date.now()): number {
    let resumed = 0;
    for (const record of this.records.values()) {
      if (record.taskId !== taskId || record.state !== "PAUSED") continue;
      record.state = "WAITING"; record.attempts = 0; record.error = undefined;
      record.retryAt = Math.max(now, record.retryAt); resumed++;
    }
    if (resumed) { this.persist(); this.arm(); }
    return resumed;
  }
  cancel(id: string): void { this.records.delete(id); this.persist(); this.arm(); }
  start(): void { this.stopped = false; this.arm(); }
  dispose(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  async runDue(now = Date.now()): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      for (const record of [...this.records.values()].filter((item) => item.state === "WAITING" && item.retryAt <= now)) {
        const handler = this.handlers.get(record.kind);
        if (!handler) continue;
        if (record.attempts >= 3) { record.state = "PAUSED"; record.error = "Recovery attempts exhausted"; this.persist(); continue; }
        record.state = "RUNNING"; record.attempts++; this.persist();
        let result: RecoveryResult;
        try { result = await handler(structuredClone(record)); }
        catch (error) { result = { done: false, retryAt: Date.now() + Math.min(60000, 2000 * 2 ** record.attempts), error: String(error) }; }
        if (this.records.get(record.id) !== record) continue;
        if (result.done) this.records.delete(record.id);
        else { record.state = result.retryAt && record.attempts < 3 ? "WAITING" : "PAUSED"; record.retryAt = result.retryAt ?? record.retryAt; record.error = result.error; }
        this.persist();
      }
    } finally { this.active = false; this.arm(); }
  }
  private persist(): void { writeJson(this.file, this.list()); this.changed(); }
  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stopped || this.active) return;
    const due = this.list().filter((item) => item.state === "WAITING" && this.handlers.has(item.kind));
    if (!due.length) return;
    const delay = Math.min(2147483647, Math.max(10, Math.min(...due.map((item) => item.retryAt)) - Date.now()));
    this.timer = setTimeout(() => { void this.runDue().catch(() => this.dispose()); }, delay);
    this.timer.unref?.();
  }
}
