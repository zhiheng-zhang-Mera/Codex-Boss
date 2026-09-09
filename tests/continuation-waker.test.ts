import { describe, expect, it } from "vitest";
import { DomainEventBus } from "../electron/commander/event-bus";
import { attachContinuationWaker, taskIdForEvent } from "../electron/commander/continuation-waker";

describe("event-driven continuation (AP13 seam)", () => {
  it("maps continuation-relevant events to task ids and ignores failures and empty ids", () => {
    expect(taskIdForEvent({ type: "HUMAN_APPROVED", taskId: "t1", at: 1 })).toBe("t1");
    expect(taskIdForEvent({ type: "TOOL_RESULT_READY", taskId: "t2", at: 1 })).toBe("t2");
    expect(taskIdForEvent({ type: "WORKER_COMPLETED", taskId: "t3", result: { runtimeId: "r", jobId: "j", status: "SUCCESS" }, at: 1 })).toBe("t3");
    expect(taskIdForEvent({ type: "WORKER_COMPLETED", taskId: "t4", result: { runtimeId: "r", jobId: "j", status: "PERMANENT_FAILURE", failure: { code: "TIMEOUT", message: "x", retryable: true } }, at: 1 })).toBeUndefined();
    expect(taskIdForEvent({ type: "DEPENDENCY_READY", taskId: "t5", at: 1 })).toBeUndefined();
    expect(taskIdForEvent({ type: "HUMAN_APPROVED", at: 1 })).toBeUndefined();
  });

  it("wakes continuation once per task within the cooldown and detaches cleanly", () => {
    const events = new DomainEventBus();
    const woken: string[] = [];
    let now = 1000;
    const detach = attachContinuationWaker(events, (taskId) => { woken.push(taskId); }, { cooldownMs: 500, now: () => now });
    events.publish({ type: "HUMAN_APPROVED", taskId: "t1", at: now });
    events.publish({ type: "HUMAN_APPROVED", taskId: "t1", at: now });
    expect(woken).toEqual(["t1"]); // coalesced inside cooldown
    now = 1600;
    events.publish({ type: "TOOL_RESULT_READY", taskId: "t1", at: now });
    expect(woken).toEqual(["t1", "t1"]);
    detach();
    events.publish({ type: "HUMAN_APPROVED", taskId: "t1", at: 2200 });
    expect(woken).toEqual(["t1", "t1"]);
  });

  it("supports extra event types and isolates waker failures", async () => {
    const events = new DomainEventBus();
    const woken: string[] = [];
    const detach = attachContinuationWaker(events, async (taskId) => {
      woken.push(taskId);
      if (taskId === "boom") throw new Error("continuation failed");
    }, { cooldownMs: 0, extraTypes: ["DEPENDENCY_READY"] });
    events.publish({ type: "DEPENDENCY_READY", taskId: "d1", at: 1 });
    events.publish({ type: "HUMAN_APPROVED", taskId: "boom", at: 2 });
    events.publish({ type: "HUMAN_APPROVED", taskId: "after", at: 3 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(woken).toEqual(["d1", "boom", "after"]);
    detach();
  });
});
