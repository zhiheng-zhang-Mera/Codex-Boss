import { describe, expect, it } from "vitest";
import type { BossTask } from "../src/shared/contracts";
import { shortTime, taskCounts } from "../src/renderer/state";

const task = (status: BossTask["status"]): BossTask => ({
  id: status, title: status, prompt: "test", providerId: "chatgpt", status,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z"
});

describe("renderer state", () => {
  it("counts every lifecycle state", () => {
    expect(taskCounts([task("queued"), task("running"), task("running"), task("completed")])).toEqual({
      queued: 1, running: 2, waiting: 0, completed: 1, failed: 0
    });
  });

  it("formats persisted timestamps", () => {
    expect(shortTime("2026-09-01T00:00:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
