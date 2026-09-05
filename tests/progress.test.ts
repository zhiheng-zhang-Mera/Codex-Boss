import { describe, expect, it } from "vitest";
import { ProgressAggregator, validateProgressEvent, type ProgressEvent } from "../src/shared/progress";
import { attachProgressRecorder } from "../electron/commander/progress-recorder";
import { DomainEventBus } from "../electron/commander/event-bus";

let at = 1000;
const NOW = () => new Date(at += 1000).toISOString();

function event(taskId: string, overrides: Partial<ProgressEvent> = {}): Omit<ProgressEvent, "id" | "createdAt"> {
  return { taskId, stage: "dispatch", status: "RUNNING", label: "处理中", source: "SYSTEM", ...overrides };
}

describe("progress aggregator (Phase 3)", () => {
  it("coalesces same-stage updates and removes terminal stages from live summaries", () => {
    const aggregate = new ProgressAggregator(100, NOW);
    const waiting = aggregate.apply(event("t1", { stage: "collect", status: "WAITING", label: "等待网页 AI" }));
    expect(waiting.label).toBe("等待网页 AI");
    expect(aggregate.summaries()).toHaveLength(1);
    aggregate.apply(event("t1", { stage: "collect", status: "SUCCESS", label: "回答已收到" }));
    const live = aggregate.summaries();
    expect(live.some((summary) => summary.stage === "collect" && summary.status === "SUCCESS")).toBe(true);
    aggregate.apply(event("t1", { stage: "done", status: "SUCCESS", label: "完成" }));
    expect(aggregate.summaries()[0].label).toBe("完成");
    // Detail timeline grows but is bounded.
    expect(aggregate.detail().length).toBeGreaterThanOrEqual(3);
  });

  it("keeps the newest label per task and bounds the timeline", () => {
    const aggregate = new ProgressAggregator(2, NOW);
    aggregate.apply(event("t1", { label: "A" }));
    aggregate.apply(event("t1", { label: "B" }));
    aggregate.apply(event("t1", { label: "C" }));
    expect(aggregate.detail().length).toBe(2);
    expect(aggregate.summaries()[0].label).toBe("C");
  });

  it("validates events fail closed", () => {
    const valid: ProgressEvent = { id: "p1", taskId: "t", stage: "s", status: "RUNNING", label: "l", source: "SYSTEM", createdAt: NOW() };
    expect(() => validateProgressEvent(valid)).not.toThrow();
    expect(() => validateProgressEvent({ ...valid, status: "BAD" as never })).toThrow();
    expect(() => validateProgressEvent({ ...valid, label: "" })).toThrow();
    expect(() => validateProgressEvent({ ...valid, id: "" })).toThrow();
  });
});

describe("progress recorder (Phase 3)", () => {
  it("turns domain events into progress summaries and detaches cleanly", () => {
    const events = new DomainEventBus();
    const { aggregator, detach } = attachProgressRecorder(events, { now: NOW });
    events.publish({ type: "WORKER_COMPLETED", taskId: "t1", jobId: "j1", result: { runtimeId: "web:chatgpt", jobId: "j1", status: "SUCCESS" } });
    events.publish({ type: "WORKER_FAILED", taskId: "t2", jobId: "j2", message: "timeout", result: { runtimeId: "web:gemini", jobId: "j2", status: "RETRYABLE_FAILURE", failure: { code: "TIMEOUT", message: "timeout", retryable: true } } });
    events.publish({ type: "HUMAN_APPROVED", taskId: "t1", message: "ok" });
    const summaries = aggregator.summaries();
    expect(summaries.map((summary) => summary.taskId).sort()).toEqual(["t1", "t2"]);
    detach();
    events.publish({ type: "WORKER_COMPLETED", taskId: "t3", jobId: "j3", result: { runtimeId: "r", jobId: "j3", status: "SUCCESS" } });
    expect(aggregator.summaries().some((summary) => summary.taskId === "t3")).toBe(false);
  });
});
