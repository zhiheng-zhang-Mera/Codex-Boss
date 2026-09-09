import { expect, it } from "vitest";
import { timelineForTask } from "../src/shared/task-timeline";
import type { AuditEvent } from "../src/shared/contracts";

it("builds a chronological task timeline without inventing missing telemetry", () => {
  const events = [
    { id: "2", at: "2026-01-01T00:00:02Z", type: "artifact.captured", taskId: "t", message: "captured", stepId: "s", runtimeId: "web:chatgpt", evidenceRef: "artifact" },
    { id: "1", at: "2026-01-01T00:00:01Z", type: "task.created", taskId: "t", message: "created" },
    { id: "x", at: "2026-01-01T00:00:00Z", type: "task.created", taskId: "other", message: "other" }
  ] as AuditEvent[];
  const result = timelineForTask(events, "t");
  expect(result.map(item => item.message)).toEqual(["created", "captured"]);
  expect(result[1]).toMatchObject({ stepId: "s", runtimeId: "web:chatgpt", evidenceRef: "artifact" });
  expect(result.every(item => item.budgetDelta === undefined)).toBe(true);
});
