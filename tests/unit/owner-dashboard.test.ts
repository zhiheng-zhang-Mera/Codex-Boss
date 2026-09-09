import { describe, expect, it } from "vitest";
import { blockerForIntervention, buildOwnerDashboard, progressLabelFor } from "../../src/shared/owner-dashboard";
import type { AppSnapshot, BossTask, EvidenceBundle, FinalResponse } from "../../src/shared/contracts";
import type { DecisionLedgerEntry } from "../../src/shared/decision-ledger";

function task(overrides: Partial<BossTask>): BossTask {
  return {
    id: "task-1",
    conversationId: "c1",
    title: "把 X 做成生产级",
    prompt: "goal",
    providerIds: ["chatgpt"],
    status: "running",
    mode: "direct",
    appMode: "work",
    transportByProvider: {},
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    ...overrides
  } as BossTask;
}

function bundle(overrides: Partial<EvidenceBundle>): EvidenceBundle {
  return {
    id: "b1",
    taskId: "task-1",
    manifest: [{ artifactId: "a1", providerId: "chatgpt", sha256: "x", bytes: 1, capturedAt: "t" }],
    integrityRoot: "root",
    claims: [],
    disputes: [],
    missingProviderIds: [],
    decision: "PASS",
    codexReview: { status: "NOT_RUN" },
    createdAt: "2026-09-09T01:00:00.000Z",
    ...overrides
  } as EvidenceBundle;
}

function finalResponse(overrides: Partial<FinalResponse>): FinalResponse {
  return {
    id: "f1",
    taskId: "task-1",
    conversationId: "c1",
    source: "council_synthesis",
    content: "最终结果……",
    sourceArtifactIds: [],
    finalizedAt: "2026-09-09T02:00:00.000Z",
    ...overrides
  } as FinalResponse;
}

function ledger(overrides: Partial<DecisionLedgerEntry>): DecisionLedgerEntry {
  return {
    id: "d1",
    taskId: "task-1",
    createdAt: "2026-09-09T00:30:00.000Z",
    question: "是否继续？",
    candidates: [],
    chosen: "continue",
    evidence: [],
    outcome: "APPLIED",
    source: "question-interceptor",
    ...overrides
  } as DecisionLedgerEntry;
}

function snapshot(tasks: BossTask[], bundles: EvidenceBundle[] = [], finals: FinalResponse[] = []): Pick<AppSnapshot, "tasks" | "finalResponses" | "evidenceBundles"> {
  return { tasks, finalResponses: finals, evidenceBundles: bundles };
}

describe("owner-dashboard: blocker mapping", () => {
  it("maps intervention kinds to HB buckets and operator questions", () => {
    expect(blockerForIntervention("CAPTCHA")).toBe("HB1");
    expect(blockerForIntervention("LOGIN")).toBe("HB1");
    expect(blockerForIntervention("AUTHORIZATION")).toBe("HB1");
    expect(blockerForIntervention("BUDGET")).toBe("HB2");
    expect(blockerForIntervention("EXTERNAL_ACTION")).toBe("HB2");
    expect(blockerForIntervention("DIRECTION")).toBe("OPERATOR_QUESTION");
  });
});

describe("owner-dashboard: read-model (§37/§44)", () => {
  it("renders GOAL/STATUS/PROGRESS/RESULT/EVIDENCE/HARD_BLOCKER per task", () => {
    const dashboard = buildOwnerDashboard({
      snapshot: snapshot(
        [task({ id: "task-1", status: "completed", nextAction: "NEXT_STEP" })],
        [bundle({})],
        [finalResponse({})]
      ),
      interventions: [],
      ledgerEntries: [],
      now: () => "2026-09-09T03:00:00.000Z"
    });
    const card = dashboard.tasks[0];
    expect(card.goal).toBe("把 X 做成生产级");
    expect(card.status).toBe("completed");
    expect(card.runMode).toBe("OWNER_RESULT"); // work task default
    expect(card.result?.source).toBe("council_synthesis");
    expect(card.evidence?.decision).toBe("PASS");
    expect(card.evidence?.artifacts).toBe(1);
    expect(card.hardBlocker).toBe("NONE");
    expect(dashboard.counts.completed).toBe(1);
  });

  it("surfaces HB1 as HARD_BLOCKER and counts internal auto decisions from the ledger", () => {
    const dashboard = buildOwnerDashboard({
      snapshot: snapshot([task({ id: "task-1", status: "paused" })]),
      interventions: [{ taskId: "task-1", kind: "CAPTCHA", question: "需要验证码" }],
      ledgerEntries: [
        ledger({}),
        ledger({ id: "d2", source: "direction-stall" }),
        ledger({ id: "d3", source: "operator", outcome: "DEFERRED" }) // not an internal auto decision
      ],
      now: () => "2026-09-09T03:00:00.000Z"
    });
    const card = dashboard.tasks[0];
    expect(card.hardBlocker).toBe("HB1");
    expect(card.blockerDetail).toContain("验证码");
    expect(dashboard.counts.hardBlockers).toBe(1);
    expect(dashboard.counts.internalAutoDecisions).toBe(2);
  });

  it("chat tasks default to ASSISTED and show progress labels", () => {
    const chat = task({ id: "task-2", appMode: "chat", status: "waiting", recoveryAt: 1725897600000, executionPhase: "WAITING_FOR_RESPONSE" });
    const dashboard = buildOwnerDashboard({
      snapshot: snapshot([chat]),
      interventions: [],
      ledgerEntries: [],
      now: () => "2026-09-09T03:00:00.000Z"
    });
    expect(dashboard.tasks[0].runMode).toBe("ASSISTED");
    expect(progressLabelFor(chat)).toContain("WAITING_FOR_RESPONSE");
    expect(progressLabelFor(chat)).toContain("recovery at");
  });
});
