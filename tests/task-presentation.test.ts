import { expect, it } from "vitest";
import type { BossTask, FinalResponse } from "../src/shared/contracts";
import { taskPresentation } from "../src/shared/task-presentation";
const task = { status: "completed", executionPhase: "COMPLETED" } as BossTask;
it("does not advertise completion before a final answer exists", () => {
  expect(taskPresentation(task, []).state).toBe("CONTINUING");
  expect(taskPresentation({ ...task, status: "waiting", finalizationBlocker: "unavailable" }, []).state).toBe("WAITING_FOR_USER");
  expect(taskPresentation(task, [], { content: "answer" } as FinalResponse).state).toBe("COMPLETED");
});
it("keeps user cancellation and recovery deadlines visible", () => {
  expect(taskPresentation({ ...task, status: "cancelled" }, [], {} as FinalResponse).label).toBe("已取消");
  expect(taskPresentation({ ...task, status: "waiting", recoveryAt: 123, finalizationBlocker: "waiting" }, []).state).toBe("RECOVERING");
});
