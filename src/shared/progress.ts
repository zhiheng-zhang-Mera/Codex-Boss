/**
 * Live progress model (plan 9-6 Phase 3). Pure and shareable.
 *
 * A controller shows operational stage summaries (waiting on provider i/n,
 * collecting answers, verifying…) without leaking private reasoning. This
 * module defines the ProgressEvent vocabulary and a deterministic
 * ProgressAggregator that keeps one latest summary per task (coalescing raw
 * stage/status updates) plus a bounded detail timeline for a collapsible log.
 */

export type ProgressStatus = "RUNNING" | "WAITING" | "SUCCESS" | "RECOVERING" | "ATTENTION" | "FAILED";
export type ProgressSource = "COMMANDER" | "WEB" | "RESEARCH" | "EXPERIMENT" | "ANALYSIS" | "SYSTEM";

export interface ProgressEvent {
  id: string;
  taskId: string;
  stage: string;
  status: ProgressStatus;
  label: string;
  detail?: string;
  source: ProgressSource;
  createdAt: string;
}

export function validateProgressEvent(event: ProgressEvent): void {
  if (!event || typeof event.id !== "string" || !event.id.trim()) throw new Error("Progress event requires an id");
  if (typeof event.taskId !== "string" || !event.taskId.trim()) throw new Error("Progress event requires a taskId");
  if (typeof event.stage !== "string" || event.stage.length > 100) throw new Error("Progress event stage invalid");
  if (!["RUNNING", "WAITING", "SUCCESS", "RECOVERING", "ATTENTION", "FAILED"].includes(event.status)) throw new Error("Invalid progress status");
  if (typeof event.label !== "string" || !event.label.trim() || event.label.length > 200) throw new Error("Progress event label invalid");
  if (event.detail && event.detail.length > 500) throw new Error("Progress detail exceeds bound");
  if (!["COMMANDER", "WEB", "RESEARCH", "EXPERIMENT", "ANALYSIS", "SYSTEM"].includes(event.source)) throw new Error("Invalid progress source");
}

export interface ProgressSummary {
  taskId: string;
  status: ProgressStatus;
  stage: string;
  label: string;
  source: ProgressSource;
  detail?: string;
  updatedAt: string;
}

/**
 * One summary per task (latest event wins by createdAt), a bounded detail
 * timeline, and a per-task waiting/complete count that the controller derives
 * from observed provider events (0/3 → 3/3). Terminal events keep their latest
 * status so the final line stays visible ("✓ 完成"), never reverting to a
 * stale "waiting".
 */
export class ProgressAggregator {
  private readonly byTask = new Map<string, ProgressEvent>();
  private readonly timeline: ProgressEvent[] = [];
  private readonly counts = new Map<string, { completed: number; expected: number }>();

  constructor(private readonly maxTimeline = 200, private readonly now: () => string = () => new Date().toISOString()) {}

  apply(event: Omit<ProgressEvent, "id" | "createdAt"> & { id?: string; createdAt?: string }): ProgressSummary {
    const full: ProgressEvent = { ...event, id: event.id ?? `${event.taskId}-${this.timeline.length}`, createdAt: event.createdAt ?? this.now() };
    validateProgressEvent(full);
    const previous = this.byTask.get(full.taskId);
    if (!previous || previous.createdAt <= full.createdAt) this.byTask.set(full.taskId, full);
    this.timeline.push(full);
    if (this.timeline.length > this.maxTimeline) this.timeline.splice(0, this.timeline.length - this.maxTimeline);
    return this.summaryFor(full.taskId);
  }

  /** Records a round-count observation (e.g. provider completed i of n). */
  observeCount(taskId: string, completed: number, expected: number): void {
    const previous = this.counts.get(taskId) ?? { completed: 0, expected: -1 };
    this.counts.set(taskId, { completed: Math.max(previous.completed, completed), expected: Math.max(previous.expected, expected) });
  }

  /** Live summary per task (latest event), newest task first. */
  summaries(): ProgressSummary[] {
    return [...this.byTask.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((event) => this.summaryFor(event.taskId));
  }

  detail(): ProgressEvent[] { return [...this.timeline]; }

  count(taskId: string): { completed: number; expected: number } | undefined {
    const value = this.counts.get(taskId);
    return value ? { ...value } : undefined;
  }

  private summaryFor(taskId: string): ProgressSummary {
    const latest = this.byTask.get(taskId);
    if (!latest) return { taskId, status: "RUNNING", stage: "pending", label: "等待中", source: "SYSTEM", updatedAt: this.now() };
    return { taskId, status: latest.status, stage: latest.stage, label: latest.label, source: latest.source, detail: latest.detail, updatedAt: latest.createdAt };
  }
}
