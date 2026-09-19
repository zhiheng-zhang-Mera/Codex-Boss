import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTINUATION_V1_FROZEN_AT,
  CONTINUATION_V1_FROZEN_AT_COMMIT,
  EVIDENCE_CLASSES,
  POLICY_STATUSES,
  RETROSPECTIVE_CORPUS_VERSION,
  checkPolicyIdentity,
  classifyEvidence,
  frozenContinuationPolicy,
  policyFingerprint,
  policyIdentity,
  policyRegistry,
  type EvidenceClass,
  type PolicyArea,
  type PolicyIdentity,
  type PolicyIdentityCheck,
  type PolicyStatus
} from "../../../src/shared/runtime-intelligence/policy-registry";
import {
  PROSPECTIVE_EVIDENCE_CLASSES,
  PROSPECTIVE_TARGETS,
  PROSPECTIVE_WINDOW_SCHEMA_VERSION,
  STOP_SUPPORT_MINIMUM,
  appendProspectiveAdvisory,
  buildPolicyDefectReport,
  closeProspectiveRecord,
  decisionClassSupport,
  openProspectiveRecord,
  prospectiveMetrics,
  stopSafetyStatement,
  type PolicyDefectReport,
  type PolicyDefectReportInput,
  type ProspectiveMetrics,
  type ProspectiveWindowRecord
} from "../../../src/shared/runtime-intelligence/prospective-window";
import { ProspectiveWindowStore, PROSPECTIVE_WINDOW_FILENAME, PROSPECTIVE_WINDOW_ROWS_PER_WINDOW, type ProspectiveStoreOptions, type ProspectiveStoreStatus } from "../../../electron/runtime-intelligence/prospective-store";
import { stepObservationOf } from "../../../src/shared/runtime-intelligence/live-capture";
import { CONTINUATION_DECISION_CLASSES } from "../../../src/shared/runtime-intelligence/continuation-evaluator";

/**
 * The prospective phase. The rules under test are the ones that make prospective evidence worth
 * anything: the policy hash is fixed before the outcome exists, an advisory cannot arrive after
 * the outcome, a policy that changed mid-window invalidates the window, and a low false-stop count
 * with a small denominator is never called safe.
 */

const AFTER_FREEZE = "2026-09-20T00:00:00.000Z";
const BEFORE_FREEZE = "2026-09-01T00:00:00.000Z";

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-prospective-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

function opened(taskId = "task-1", openedAt = AFTER_FREEZE): ProspectiveWindowRecord {
  const result = openProspectiveRecord({ taskId, openedAt });
  if (result.record === undefined) throw new Error("the window did not open");
  return result.record;
}

describe("the registry freezes every policy with an identity", () => {
  it("names five policies across four areas, with the continuation pair frozen or retired", () => {
    const registry = policyRegistry();
    expect(registry.map((entry) => entry.policyId)).toEqual([
      "continuation-policy-v0",
      "continuation-policy-v1",
      "scheduler-policy-v0",
      "skill-loadout-policy-v0",
      "confidence-policy-v0"
    ]);
    expect(new Set(registry.map((entry) => entry.policyArea))).toEqual(new Set(["continuation", "scheduler", "skill-loadout", "confidence"]));
    const statuses: PolicyStatus[] = registry.map((entry) => entry.status);
    const areas: PolicyArea[] = registry.map((entry) => entry.policyArea);
    expect(statuses).toHaveLength(5);
    expect(areas).toHaveLength(5);
    expect(registry.every((entry) => POLICY_STATUSES.includes(entry.status))).toBe(true);
    expect(registry.filter((entry) => entry.status === "FROZEN_FOR_PROSPECTIVE_VALIDATION")).toHaveLength(4);
    expect(registry.find((entry) => entry.policyId === "continuation-policy-v0")?.status).toBe("RETIRED");
  });

  it("records the commit and corpus version each policy was frozen against", () => {
    const frozen: PolicyIdentity = frozenContinuationPolicy();
    expect(frozen.policyId).toBe("continuation-policy-v1");
    expect(frozen.status).toBe("FROZEN_FOR_PROSPECTIVE_VALIDATION");
    expect(frozen.frozenAtCommit).toBe(CONTINUATION_V1_FROZEN_AT_COMMIT);
    expect(frozen.frozenAtCorpusVersion).toBe(RETROSPECTIVE_CORPUS_VERSION);
    expect(Date.parse(CONTINUATION_V1_FROZEN_AT)).toBeGreaterThan(0);
    expect(frozen.note).toContain("frozen here so prospective tasks decide whether it generalises");
  });

  it("gives every policy a distinct, stable 64-character hash", () => {
    const hashes = policyRegistry().map((entry) => entry.policyHash);
    expect(hashes.every((hash) => hash.length === 64)).toBe(true);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(policyFingerprint("x", ["a", 1])).toBe(policyFingerprint("x", ["a", 1]));
    expect(policyFingerprint("x", ["a", 1])).not.toBe(policyFingerprint("x", ["a", 2]));
  });

  it("refuses evidence whose claimed hash does not match the rules that produced it", () => {
    const frozen = frozenContinuationPolicy();
    const matched: PolicyIdentityCheck = checkPolicyIdentity({ policyId: frozen.policyId, policyHash: frozen.policyHash });
    expect(matched.ok).toBe(true);
    expect(matched.problems).toEqual([]);
    const tampered = checkPolicyIdentity({ policyId: frozen.policyId, policyHash: "0".repeat(64) });
    expect(tampered.ok).toBe(false);
    expect(tampered.problems.join(" ")).toContain("the rules that produced it have changed");
    expect(checkPolicyIdentity({ policyId: "no-such-policy", policyHash: frozen.policyHash }).problems.join(" ")).toContain("not in the registry");
    expect(policyIdentity("no-such-policy")).toBeUndefined();
  });

  it("calls a task retrospective unless it opened after the freeze", () => {
    expect(classifyEvidence({ openedAt: AFTER_FREEZE, policyId: "continuation-policy-v1" })).toBe("PROSPECTIVE_EVIDENCE");
    expect(classifyEvidence({ openedAt: BEFORE_FREEZE, policyId: "continuation-policy-v1" })).toBe("RETROSPECTIVE_EVIDENCE");
    // A claim cannot make a pre-freeze task prospective.
    expect(classifyEvidence({ openedAt: BEFORE_FREEZE, policyId: "continuation-policy-v1", claim: "PROSPECTIVE_EVIDENCE" })).toBe("RETROSPECTIVE_EVIDENCE");
    // The retired baseline is never prospective evidence about the frozen policy.
    expect(classifyEvidence({ openedAt: AFTER_FREEZE, policyId: "continuation-policy-v0" })).toBe("RETROSPECTIVE_EVIDENCE");
    expect(classifyEvidence({ openedAt: AFTER_FREEZE, policyId: "unknown" })).toBe("RETROSPECTIVE_EVIDENCE");
    expect(EVIDENCE_CLASSES).toHaveLength(4);
    expect(PROSPECTIVE_EVIDENCE_CLASSES).toEqual(EVIDENCE_CLASSES);
  });
});

describe("the window fixes the policy before the outcome exists", () => {
  it("records the frozen hash at open time", () => {
    const record = opened();
    expect(record.policyId).toBe("continuation-policy-v1");
    expect(record.policyHash).toBe(frozenContinuationPolicy().policyHash);
    expect(record.evidenceClass).toBe("PROSPECTIVE_EVIDENCE");
    expect(record.advisories).toEqual([]);
    expect(record.outcome).toBeUndefined();
    expect(record.schemaVersion).toBe(PROSPECTIVE_WINDOW_SCHEMA_VERSION);
  });

  it("refuses a window under a policy that is not the frozen one", () => {
    const result = openProspectiveRecord({ taskId: "t", openedAt: AFTER_FREEZE, policyId: "continuation-policy-v0" });
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("not the frozen policy");
    expect(openProspectiveRecord({ taskId: "  ", openedAt: AFTER_FREEZE }).problems.join(" ")).toContain("needs a task id");
  });

  it("keeps advisories in step order and replaces a step rather than duplicating it", () => {
    const withTwo = appendProspectiveAdvisory(appendProspectiveAdvisory(opened(), { stepIndex: 5, decision: "CONTINUE", confidence: 0.4, capturedAt: AFTER_FREEZE }).record!, { stepIndex: 2, decision: "STOP", confidence: 0.9, capturedAt: AFTER_FREEZE });
    expect(withTwo.record?.advisories.map((entry) => entry.stepIndex)).toEqual([2, 5]);
    const replaced = appendProspectiveAdvisory(withTwo.record!, { stepIndex: 2, decision: "CONTINUE", confidence: 0.3, capturedAt: AFTER_FREEZE });
    expect(replaced.record?.advisories).toHaveLength(2);
    expect(replaced.record?.advisories[0].decision).toBe("CONTINUE");
  });

  it("refuses an advisory that arrives after the outcome", () => {
    const closed = closeProspectiveRecord(opened(), { closedAt: AFTER_FREEZE, finalOutcome: "SUCCESS", steps: [] }).record!;
    const late = appendProspectiveAdvisory(closed, { stepIndex: 1, decision: "STOP", confidence: 0.9, capturedAt: AFTER_FREEZE });
    expect(late.ok).toBe(false);
    expect(late.problems.join(" ")).toContain("cannot be evidence about a decision made before it");
  });

  it("refuses to close a window twice, and refuses a policy that changed mid-window", () => {
    const closed = closeProspectiveRecord(opened(), { closedAt: AFTER_FREEZE, finalOutcome: "SUCCESS", steps: [] }).record!;
    expect(closeProspectiveRecord(closed, { closedAt: AFTER_FREEZE, finalOutcome: "FAILURE", steps: [] }).problems.join(" ")).toContain("already closed");
    const tampered = { ...opened(), policyHash: "f".repeat(64) };
    const refused = closeProspectiveRecord(tampered, { closedAt: AFTER_FREEZE, finalOutcome: "SUCCESS", steps: [] });
    expect(refused.ok).toBe(false);
    expect(refused.problems.join(" ")).toContain("a policy changed mid-window");
  });

  it("reports which decision classes the window has actually seen", () => {
    const one = appendProspectiveAdvisory(opened(), { stepIndex: 1, decision: "CONTINUE", confidence: 0.4, capturedAt: AFTER_FREEZE }).record!;
    const support = decisionClassSupport([one]);
    expect(support.seen).toEqual(["CONTINUE"]);
    // The expected set is the policy's own rule table, so every class the evaluator can emit is
    // named as missing rather than only the four a hand-written list remembered.
    expect(support.missing).toContain("STOP");
    expect(support.missing).toContain("DECOMPOSE_TASK");
    expect(support.missing).toContain("SWITCH_MODEL");
    expect(support.missing).not.toContain("CONTINUE");
    expect(new Set([...support.seen, ...support.missing])).toEqual(new Set(CONTINUATION_DECISION_CLASSES));
  });
});

describe("prospective metrics never read a rate without its denominator", () => {
  function closedTask(taskId: string, advisories: Array<{ stepIndex: number; decision: string; taskComplete: boolean; continued?: boolean }>): ProspectiveWindowRecord {
    let record = opened(taskId);
    for (const entry of advisories) record = appendProspectiveAdvisory(record, { stepIndex: entry.stepIndex, decision: entry.decision, confidence: 0.5, capturedAt: AFTER_FREEZE }).record!;
    return closeProspectiveRecord(record, { closedAt: AFTER_FREEZE, finalOutcome: "SUCCESS", steps: advisories.map((entry) => ({ stepIndex: entry.stepIndex, taskComplete: entry.taskComplete, continuedAfterStep: entry.continued ?? !entry.taskComplete })) }).record!;
  }

  it("counts a correct stop as a saved call and a wrong one as a false stop", () => {
    const metrics: ProspectiveMetrics = prospectiveMetrics([closedTask("t1", [{ stepIndex: 1, decision: "STOP", taskComplete: true }, { stepIndex: 2, decision: "STOP", taskComplete: false }])]);
    expect(metrics.stopAdvisories).toBe(2);
    expect(metrics.falseStops).toBe(1);
    expect(metrics.falseStopRate).toBe(0.5);
    expect(metrics.stopPrecision).toBe(0.5);
    expect(metrics.stopSupportCount).toBe(2);
    expect(metrics.callsSaved).toBe(1);
    expect(metrics.weightedPenalty).toBe(5);
    expect(metrics.tasksClosed).toBe(1);
  });

  it("counts an unnecessary continue and prices it lower than a false stop", () => {
    const metrics = prospectiveMetrics([closedTask("t1", [{ stepIndex: 1, decision: "CONTINUE", taskComplete: true }])]);
    expect(metrics.continueAdvisories).toBe(1);
    expect(metrics.unnecessaryContinues).toBe(1);
    expect(metrics.unnecessaryContinueRate).toBe(1);
    expect(metrics.weightedPenalty).toBe(1);
  });

  it("ignores an advisory whose step has no outcome, rather than scoring it", () => {
    let record = opened("t1");
    record = appendProspectiveAdvisory(record, { stepIndex: 1, decision: "STOP", confidence: 0.5, capturedAt: AFTER_FREEZE }).record!;
    record = closeProspectiveRecord(record, { closedAt: AFTER_FREEZE, finalOutcome: "SUCCESS", steps: [] }).record!;
    const metrics = prospectiveMetrics([record]);
    expect(metrics.continuationSteps).toBe(0);
    expect(metrics.stopAdvisories).toBe(0);
    expect(metrics.falseStopRate).toBeUndefined();
  });

  it("excludes an open task, because its outcome is not known yet", () => {
    const open = appendProspectiveAdvisory(opened("t1"), { stepIndex: 1, decision: "STOP", confidence: 0.5, capturedAt: AFTER_FREEZE }).record!;
    const metrics = prospectiveMetrics([open]);
    expect(metrics.tasks).toBe(1);
    expect(metrics.tasksClosed).toBe(0);
    expect(metrics.continuationSteps).toBe(0);
    expect(metrics.notes.join(" ")).toContain("still open");
  });

  it("reports INSUFFICIENT_EVIDENCE for the target it has not reached", () => {
    const metrics = prospectiveMetrics([closedTask("t1", [{ stepIndex: 1, decision: "STOP", taskComplete: true }])]);
    expect(metrics.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(metrics.classSupport).toBe("INSUFFICIENT_CLASS_SUPPORT");
    expect(metrics.notes.join(" ")).toContain(`only 1 STOP advisory(ies)`);
    expect(metrics.notes.join(" ")).toContain(`${PROSPECTIVE_TARGETS.tasks} task(s)`);
    expect(metrics.decisionsSeen).toEqual(["STOP"]);
  });

  it("refuses to call a small-sample zero false-stop rate safe", () => {
    const statement = stopSafetyStatement({ falseStops: 0, stopAdvisories: 1 });
    expect(statement).toContain("0 false stop(s) out of 1 STOP advisory(ies)");
    expect(statement).toContain("NOT evidence that stopping is safe");
    expect(STOP_SUPPORT_MINIMUM).toBe(20);
    const supported = stopSafetyStatement({ falseStops: 0, stopAdvisories: STOP_SUPPORT_MINIMUM });
    expect(supported).toContain("no false stop has been observed");
    expect(supported).not.toContain("NOT evidence");
    expect(stopSafetyStatement({ falseStops: 0, stopAdvisories: 0 })).toContain("nothing is known about stop safety");
    expect(stopSafetyStatement({ falseStops: 3, stopAdvisories: 30 })).toContain("stopping is not safe as it stands");
  });

  it("refuses to score the frozen policy on tasks that opened before the freeze", () => {
    // The real corpus is exactly this shape: five tasks that all predate the freeze. Counting
    // them would restate the retrospective result as a prospective one, which is the single
    // failure this window exists to prevent.
    const retrospective = closeProspectiveRecord(appendProspectiveAdvisory(opened("real-1", BEFORE_FREEZE), { stepIndex: 1, decision: "STOP", confidence: 0.9, capturedAt: BEFORE_FREEZE }).record!, {
      closedAt: AFTER_FREEZE,
      finalOutcome: "FAILURE",
      steps: [{ stepIndex: 1, taskComplete: false, continuedAfterStep: false }]
    }).record!;
    expect(retrospective.evidenceClass).toBe("RETROSPECTIVE_EVIDENCE");
    const metrics = prospectiveMetrics([retrospective]);
    expect(metrics.tasks).toBe(0);
    expect(metrics.tasksClosed).toBe(0);
    expect(metrics.stopAdvisories).toBe(0);
    expect(metrics.falseStopRate).toBeUndefined();
    expect(metrics.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(metrics.notes.join(" ")).toContain("1 record(s) in the window are not prospective evidence");
    // A prospective record beside it still counts, so the exclusion is by class and not a filter
    // that discards the window wholesale.
    const mixed = prospectiveMetrics([retrospective, closedTask("t2", [{ stepIndex: 1, decision: "STOP", taskComplete: true }])]);
    expect(mixed.tasks).toBe(1);
    expect(mixed.callsSaved).toBe(1);
    expect(mixed.falseStops).toBe(0);
  });

  it("builds a defect report that proposes a candidate and mutates nothing", () => {
    const input: PolicyDefectReportInput = {
      policyId: "continuation-policy-v1",
      policyHash: frozenContinuationPolicy().policyHash,
      failureMode: "a false stop on a task whose work list had not been created",
      severity: "HIGH",
      evidenceCases: [{ taskId: "t1", stepIndex: 1, detail: "advice STOP, task incomplete" }],
      candidateHypothesis: "treat an absent work list as unknown rather than empty",
      expectedTradeoff: "more continues on genuinely empty steps"
    };
    const report: PolicyDefectReport = buildPolicyDefectReport({
      ...input,
      createdAt: AFTER_FREEZE,
      candidateVersion: 2
    });
    expect(report.kind).toBe("RUNTIME_INTELLIGENCE_POLICY_DEFECT_REPORT");
    expect(report.mutatesPolicy).toBe(false);
    expect(report.proposedCandidateId).toBe("continuation-policy-v2");
    expect(report.severity).toBe("HIGH");
  });
});

describe("the store holds the ordering across restarts", () => {
  it("opens, appends and closes a task, then reads it back", () => {
    const root = makeRoot();
    const store = new ProspectiveWindowStore({ rootDir: root, now: () => AFTER_FREEZE });
    expect(store.openTask({ taskId: "task-1" }).ok).toBe(true);
    expect(store.appendAdvisory({ taskId: "task-1", advisory: { stepIndex: 1, decision: "STOP", confidence: 0.9, capturedAt: AFTER_FREEZE } }).ok).toBe(true);
    expect(store.closeTask({ taskId: "task-1", finalOutcome: "SUCCESS", steps: [{ stepIndex: 1, taskComplete: true, continuedAfterStep: false }] }).ok).toBe(true);

    // A fresh instance reads the same log, which is the point of the durability.
    const reopened = new ProspectiveWindowStore({ rootDir: root, now: () => AFTER_FREEZE });
    const record = reopened.record("task-1");
    expect(record?.advisories).toHaveLength(1);
    expect(record?.outcome?.finalOutcome).toBe("SUCCESS");
    expect(reopened.metrics().callsSaved).toBe(1);
    expect(reopened.metrics().falseStopRate).toBe(0);
  });

  it("refuses a duplicate window, an unknown task and an advisory after close", () => {
    const store = new ProspectiveWindowStore({ rootDir: makeRoot(), now: () => AFTER_FREEZE });
    store.openTask({ taskId: "task-1" });
    expect(store.openTask({ taskId: "task-1" }).problems.join(" ")).toContain("already exists");
    expect(store.appendAdvisory({ taskId: "nope", advisory: { stepIndex: 1, decision: "STOP", confidence: 0.5, capturedAt: AFTER_FREEZE } }).problems.join(" ")).toContain("no window is open");
    expect(store.closeTask({ taskId: "nope", finalOutcome: "SUCCESS", steps: [] }).problems.join(" ")).toContain("no window is open");
    store.closeTask({ taskId: "task-1", finalOutcome: "SUCCESS", steps: [] });
    expect(store.appendAdvisory({ taskId: "task-1", advisory: { stepIndex: 2, decision: "STOP", confidence: 0.5, capturedAt: AFTER_FREEZE } }).problems.join(" ")).toContain("closed");
  });

  it("reports its status with the frozen policy identity", () => {
    const options: ProspectiveStoreOptions = { rootDir: makeRoot(), now: () => AFTER_FREEZE };
    const store = new ProspectiveWindowStore(options);
    store.openTask({ taskId: "task-1" });
    store.openTask({ taskId: "task-2" });
    store.closeTask({ taskId: "task-2", finalOutcome: "SUCCESS", steps: [] });
    const status: ProspectiveStoreStatus = store.status();
    expect(status.records).toBe(2);
    expect(status.open).toBe(1);
    expect(status.closed).toBe(1);
    expect(status.policyId).toBe("continuation-policy-v1");
    expect(status.policyHash).toBe(frozenContinuationPolicy().policyHash);
    expect(status.file.endsWith(PROSPECTIVE_WINDOW_FILENAME)).toBe(true);
    expect(PROSPECTIVE_WINDOW_FILENAME).toBe("prospective-window.jsonl");
    expect(status.bytes).toBeGreaterThan(0);
    expect(status.degradedReason).toBeUndefined();
  });

  it("reports an empty window for a root with no log, and still names the frozen policy", () => {
    const store = new ProspectiveWindowStore({ rootDir: makeRoot(), now: () => AFTER_FREEZE });
    expect(store.records()).toEqual([]);
    expect(store.status().records).toBe(0);
    expect(store.status().policyId).toBe("continuation-policy-v1");
    expect(store.metrics().verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("skips an unparseable row instead of losing the window", () => {
    const root = makeRoot();
    const store = new ProspectiveWindowStore({ rootDir: root, now: () => AFTER_FREEZE });
    store.openTask({ taskId: "task-1" });
    fs.appendFileSync(path.join(root, "prospective-window.jsonl"), "{ torn\n", "utf8");
    expect(new ProspectiveWindowStore({ rootDir: root }).records()).toHaveLength(1);
  });

  it("keeps the log bounded per window while every record keeps its own ordering evidence", () => {
    const root = makeRoot();
    const store = new ProspectiveWindowStore({ rootDir: root, now: () => AFTER_FREEZE });
    store.ensureTask({ taskId: "task-1" });
    const stepFor = (index: number) => {
      const built = stepObservationOf({
        facts: { taskId: "task-1", revision: index, completedSteps: ["a"], pendingSteps: index % 2 === 0 ? [] : ["b"], nextAction: "DISPATCHING" },
        capturedAt: AFTER_FREEZE,
        sourceClass: "REAL_USER_TASK"
      });
      if (built.observation === undefined) throw new Error(built.problems.join("; "));
      return built.observation;
    };
    for (let index = 1; index <= PROSPECTIVE_WINDOW_ROWS_PER_WINDOW * 3; index += 1) {
      expect(store.appendObservation({ taskId: "task-1", observation: stepFor(index) }).ok).toBe(true);
    }
    // The log was rewritten rather than left to grow: one row per window, and the window itself is
    // unchanged by the rewrite.
    const log = fs.readFileSync(path.join(root, "prospective-window.jsonl"), "utf8").split(/\r?\n/).filter((line) => line.trim() !== "");
    expect(log.length).toBe(1);
    expect(store.status().logRows).toBe(1);
    const [record] = new ProspectiveWindowStore({ rootDir: root }).records();
    expect(record.steps).toHaveLength(PROSPECTIVE_WINDOW_ROWS_PER_WINDOW * 3);
    expect(record.eventIds.length).toBeGreaterThan(0);
    expect(record.steps.every((step) => step.recordKind === "DECISION_TIME_RECORD")).toBe(true);
    // The ordering the evidence rests on is in the records themselves, not in row order.
    expect(record.steps[record.steps.length - 1].capturedAt).toBe(AFTER_FREEZE);
  });

  it("picks up a log changed by another writer", () => {
    const root = makeRoot();
    const store = new ProspectiveWindowStore({ rootDir: root, now: () => AFTER_FREEZE });
    store.ensureTask({ taskId: "task-1" });
    expect(store.records()).toHaveLength(1);
    // A second process opens a window: the cached read must not hide it.
    const other = new ProspectiveWindowStore({ rootDir: root, now: () => AFTER_FREEZE });
    other.ensureTask({ taskId: "task-2" });
    expect(store.records().map((record) => record.taskId).sort()).toEqual(["task-1", "task-2"]);
  });
});
