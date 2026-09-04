import { readJson, writeJson } from "./durable-json";
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
  constructor(private readonly file: string, private readonly changed: () => void = () => {}) {
    for (const record of readJson<RecoveryWakeup[]>(file) ?? []) {
      if (!record.id || !Number.isFinite(record.retryAt)) throw new Error("Invalid recovery deadline");
      this.records.set(record.id, { ...record, state: record.state === "RUNNING" ? "WAITING" : record.state });
    }
  }
  register(kind: string, handler: (record: RecoveryWakeup) => Promise<RecoveryResult>): void { this.handlers.set(kind, handler); }
  list(): RecoveryWakeup[] { return structuredClone([...this.records.values()]); }
  schedule(input: Omit<RecoveryWakeup, "attempts" | "state">): void {
    if (!Number.isFinite(input.retryAt)) throw new Error("Invalid recovery deadline");
    const previous = this.records.get(input.id);
    if (previous?.state === "RUNNING" || previous?.state === "PAUSED") return;
    this.records.set(input.id, { ...input, retryAt: previous ? Math.min(previous.retryAt, input.retryAt) : input.retryAt, attempts: previous?.attempts ?? 0, state: "WAITING" });
    this.persist(); this.arm();
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
