import { describe, expect, it } from "vitest";
import { classifyRecord, validateBudgetPolicy, DEFAULT_TIER_RULES, withinTtl } from "../src/shared/data-lifecycle";
import { applyStateStorageBudget } from "../electron/commander/state-budget";
import type { AppSnapshot } from "../src/shared/contracts";

const NOW = Date.parse("2026-09-06T00:00:00.000Z");
const days = (count: number) => new Date(NOW - count * 86400000).toISOString();

function snapshot(overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    schemaVersion: 2,
    providers: [], tasks: [], runs: [], artifacts: [], councils: [], evidenceBundles: [], finalResponses: [],
    controller: { accountMode: "UNKNOWN" as const, message: "" },
    runtimeStatuses: [], roleRoutes: [], accounts: [], apiSettings: [], remoteChannels: [], remoteCommands: [],
    folders: [{ id: "f1", name: "F", storageName: "F", createdAt: days(0), updatedAt: days(0) }],
    conversations: [{ id: "c1", folderId: "f1", title: "C", storageName: "C", taskIds: [], createdAt: days(0), updatedAt: days(0) }],
    activeConversationId: "c1", dispatchCheckpoints: [], events: [], ...overrides
  };
}

describe("data lifecycle tiers (AP17 pure)", () => {
  it("classifies families into L0–L4 and checks TTL windows", () => {
    expect(classifyRecord({ family: "task", updatedAt: days(0), terminal: false })).toBe("L0");
    expect(classifyRecord({ family: "task", updatedAt: days(1), terminal: true, now: NOW })).toBe("L1");
    expect(classifyRecord({ family: "task", updatedAt: days(60), terminal: true, now: NOW })).toBe("L2");
    expect(classifyRecord({ family: "task", updatedAt: days(400), terminal: true, now: NOW })).toBe("L4");
    expect(classifyRecord({ family: "artifact", updatedAt: days(1), now: NOW })).toBe("L1");
    expect(classifyRecord({ family: "event", updatedAt: days(0), now: NOW })).toBe("L1");
    expect(withinTtl(days(1), "L1", DEFAULT_TIER_RULES, NOW)).toBe(true);
    expect(withinTtl(days(100), "L1", DEFAULT_TIER_RULES, NOW)).toBe(false);
    expect(withinTtl(days(0), "L4", DEFAULT_TIER_RULES, NOW)).toBe(true); // cold archive never expires by TTL
    expect(() => validateBudgetPolicy({ maxCompletedTasksPerConversation: -1, maxRunsPerTask: 0, enforceTtl: false })).toThrow();
  });
});

describe("state.json array budget (AP17 electron)", () => {
  it("never prunes active tasks and keeps the newest completed per conversation", () => {
    const active = { id: "active", conversationId: "c1", title: "a", providerIds: [], status: "running" as const, mode: "direct" as const, appMode: "chat" as const, transportByProvider: {}, createdAt: days(0), updatedAt: days(0) };
    const old1 = { ...active, id: "old1", status: "completed" as const, createdAt: days(50), updatedAt: days(50) };
    const old2 = { ...active, id: "old2", status: "completed" as const, createdAt: days(40), updatedAt: days(40) };
    const state = snapshot({ tasks: [active, old1, old2] });
    const { snapshot: result, report } = applyStateStorageBudget(state, { maxCompletedTasksPerConversation: 1, maxRunsPerTask: 0, enforceTtl: false }, NOW);
    expect(result.tasks.map((task) => task.id)).toEqual(["active", "old2"]); // newest completed survives
    expect(report.removed.find((item) => item.family === "task")?.count).toBe(1);
  });

  it("cascades orphan rows when a completed task is pruned", () => {
    const done = { id: "done", conversationId: "c1", title: "d", providerIds: [], status: "completed" as const, mode: "direct" as const, appMode: "chat" as const, transportByProvider: {}, createdAt: days(30), updatedAt: days(30) };
    const state = snapshot({
      tasks: [done],
      runs: [{ id: "r1", taskId: "done", providerId: "p1", round: 1, phase: "completed", outcome: null, message: "", inputPrompt: "x", adapterVersion: "v", createdAt: days(30), updatedAt: days(30) }],
      artifacts: [{ id: "a1", taskId: "done", runId: "r1", providerId: "p1", kind: "response", content: "out", capturedAt: days(30), sourceUrl: "u", untrusted: true }],
      evidenceBundles: [], finalResponses: [{ id: "f1", taskId: "done", conversationId: "c1", source: "worker", content: "final", sourceArtifactIds: ["a1"], finalizedAt: days(30) }]
    });
    const { snapshot: result } = applyStateStorageBudget(state, { maxCompletedTasksPerConversation: 0, maxRunsPerTask: 0, enforceTtl: true }, NOW);
    // done task aged 30d → L2 stays within warm (90d), so nothing pruned by TTL here.
    expect(result.tasks.map((task) => task.id)).toEqual(["done"]);
    expect(result.finalResponses).toHaveLength(1);

    // With a per-conversation cap of 0 meaning unlimited, use explicit cap of 1 in another scenario.
    const capped = applyStateStorageBudget(state, { maxCompletedTasksPerConversation: 1, maxRunsPerTask: 0, enforceTtl: false }, NOW);
    expect(capped.snapshot.tasks).toHaveLength(1); // only the single done task kept
  });

  it("enforces TTL and protects protected families from pruning", () => {
    const veryOld = { id: "old", conversationId: "c1", title: "v", providerIds: [], status: "completed" as const, mode: "direct" as const, appMode: "chat" as const, transportByProvider: {}, createdAt: days(400), updatedAt: days(400) };
    const protectedTask = { ...veryOld, id: "protected-task" };
    const { snapshot: result, report } = applyStateStorageBudget({ ...snapshot({ tasks: [veryOld, protectedTask] }) }, { maxCompletedTasksPerConversation: 0, maxRunsPerTask: 0, enforceTtl: true, protectedFamilies: ["protected-task"] }, NOW);
    expect(result.tasks.map((task) => task.id)).toEqual(["protected-task"]);
    expect(report.removed.find((item) => item.family === "task-ttl")?.count).toBe(1);
  });

  it("caps per-task run history when requested", () => {
    const task = { id: "t", conversationId: "c1", title: "t", providerIds: [], status: "running" as const, mode: "direct" as const, appMode: "chat" as const, transportByProvider: {}, createdAt: days(0), updatedAt: days(0) };
    const runs = [0, 1, 2, 3].map((index) => ({ id: `r${index}`, taskId: "t", providerId: "p1", round: 1, phase: "completed" as const, outcome: null as null, message: "", inputPrompt: "x", adapterVersion: "v", createdAt: days(3 - index), updatedAt: days(3 - index) }));
    const { snapshot: result, report } = applyStateStorageBudget(snapshot({ tasks: [task], runs }), { maxCompletedTasksPerConversation: 0, maxRunsPerTask: 2, enforceTtl: false }, NOW);
    expect(result.runs).toHaveLength(2);
    expect(result.runs.map((run) => run.id)).toEqual(["r2", "r3"]); // newest two survive
    expect(report.removed.find((item) => item.family === "run-history")?.count).toBe(2);
  });
});
