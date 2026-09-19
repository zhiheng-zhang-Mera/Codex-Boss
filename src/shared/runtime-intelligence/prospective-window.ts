/**
 * Runtime Intelligence Plane — the prospective observation window.
 *
 * The window exists to answer a question a retrospective corpus cannot: does the frozen
 * continuation policy generalise to tasks the policy was never fitted to?
 *
 * Three ordering rules make the answer trustworthy, and each is enforced rather than described:
 *
 *   1. **The policy hash is fixed when the task OPENS**, before any outcome exists. A record
 *      cannot be relabelled afterwards, and `closeTask` refuses a record whose stored hash no
 *      longer matches the policy that produced the advice — `NO_RETROACTIVE_POLICY_SELECTION`.
 *   2. **Advisor output is captured BEFORE the outcome.** An advisory appended after the outcome
 *      is refused, because an evaluator that could see the answer would score perfectly for the
 *      wrong reason.
 *   3. **The outcome is appended afterwards**, once, and the record is then closed.
 *
 * The metrics keep `STOP_SUPPORT_COUNT` next to `FALSE_STOP_RATE` deliberately. "0 false stops"
 * out of one STOP advisory is not a safety result, it is an absence of evidence, and
 * `stopSafetyStatement` says so in words rather than leaving a reader to notice a denominator.
 */

import { CONTINUATION_DECISION_CLASSES } from "./continuation-evaluator";
import { EVIDENCE_CLASSES, classifyEvidence, frozenContinuationPolicy, type EvidenceClass } from "./policy-registry";

export const PROSPECTIVE_WINDOW_SCHEMA_VERSION = 1;

/** STOP advisories needed before a false-stop rate may be called a safety result. */
export const STOP_SUPPORT_MINIMUM = 20;

/** Tasks and steps the phase brief asks for before the window is considered informative. */
export const PROSPECTIVE_TARGETS = { tasks: 20, continuationSteps: 100 } as const;

export interface ProspectiveAdvisory {
  stepIndex: number;
  decision: string;
  confidence: number;
  capturedAt: string;
}

export interface ProspectiveStepOutcome {
  stepIndex: number;
  taskComplete: boolean;
  continuedAfterStep: boolean;
}

export interface ProspectiveWindowRecord {
  schemaVersion: number;
  windowId: string;
  taskId: string;
  openedAt: string;
  /** Fixed at open time, before any outcome exists. */
  policyId: string;
  policyHash: string;
  evidenceClass: EvidenceClass;
  advisories: ProspectiveAdvisory[];
  outcome?: {
    closedAt: string;
    finalOutcome: string;
    steps: ProspectiveStepOutcome[];
  };
}

export interface WindowOperation {
  ok: boolean;
  record?: ProspectiveWindowRecord;
  problems: string[];
}

/** Opens a record, fixing the policy identity before the task does anything. */
export function openProspectiveRecord(input: { taskId: string; openedAt: string; policyId?: string }): WindowOperation {
  const policy = input.policyId === undefined ? frozenContinuationPolicy() : frozenContinuationPolicy();
  if (input.policyId !== undefined && input.policyId !== policy.policyId) {
    return { ok: false, problems: [`the window observes ${policy.policyId}; ${input.policyId} is not the frozen policy, and a candidate must be evaluated under its own window`] };
  }
  if (input.taskId.trim() === "") return { ok: false, problems: ["a window record needs a task id"] };
  const record: ProspectiveWindowRecord = {
    schemaVersion: PROSPECTIVE_WINDOW_SCHEMA_VERSION,
    windowId: `${policy.policyId}:${input.taskId}`,
    taskId: input.taskId,
    openedAt: input.openedAt,
    policyId: policy.policyId,
    policyHash: policy.policyHash,
    evidenceClass: classifyEvidence({ openedAt: input.openedAt, policyId: policy.policyId, claim: "PROSPECTIVE_EVIDENCE" }),
    advisories: []
  };
  return { ok: true, record, problems: [] };
}

/**
 * Appends one shadow advisory.
 *
 * Refused when the record is already closed: an advisory that arrives after the outcome is not
 * evidence about a decision that was made before it.
 */
export function appendProspectiveAdvisory(record: ProspectiveWindowRecord, advisory: ProspectiveAdvisory): WindowOperation {
  if (record.outcome !== undefined) {
    return { ok: false, problems: [`the window for ${record.taskId} closed at ${record.outcome.closedAt}; an advisory captured afterwards cannot be evidence about a decision made before it`] };
  }
  const existing = record.advisories.find((entry) => entry.stepIndex === advisory.stepIndex);
  const advisories = existing === undefined ? [...record.advisories, advisory].sort((left, right) => left.stepIndex - right.stepIndex) : record.advisories.map((entry) => (entry.stepIndex === advisory.stepIndex ? advisory : entry));
  return { ok: true, record: { ...record, advisories }, problems: [] };
}

/**
 * Closes a record with its outcome.
 *
 * Refuses a record whose policy hash no longer matches the registry — that is a policy change
 * mid-window, which would make the window's evidence a mixture of two policies.
 */
export function closeProspectiveRecord(record: ProspectiveWindowRecord, outcome: Omit<NonNullable<ProspectiveWindowRecord["outcome"]>, "closedAt"> & { closedAt: string }): WindowOperation {
  if (record.outcome !== undefined) return { ok: false, problems: [`the window for ${record.taskId} is already closed`] };
  const policy = frozenContinuationPolicy();
  if (record.policyHash !== policy.policyHash) {
    return {
      ok: false,
      problems: [`the window opened under policy hash ${record.policyHash} but the frozen policy now hashes to ${policy.policyHash}: a policy changed mid-window, so this record cannot be attributed to either version`]
    };
  }
  return { ok: true, record: { ...record, outcome: { closedAt: outcome.closedAt, finalOutcome: outcome.finalOutcome, steps: [...outcome.steps].sort((left, right) => left.stepIndex - right.stepIndex) } }, problems: [] };
}

/**
 * The set of decisions the window has actually observed, which is what class support means.
 *
 * Expected classes come from the evaluator's own rule table, so the missing list cannot drift from
 * the policy under observation.
 */
export function decisionClassSupport(records: readonly ProspectiveWindowRecord[]): { seen: string[]; missing: string[] } {
  const seen = [...new Set(records.flatMap((record) => record.advisories.map((advisory) => advisory.decision)))].sort();
  return { seen, missing: CONTINUATION_DECISION_CLASSES.filter((decision) => !seen.includes(decision)) };
}

export interface ProspectiveMetrics {
  tasks: number;
  tasksClosed: number;
  continuationSteps: number;
  stopAdvisories: number;
  falseStops: number;
  falseStopRate: number | undefined;
  /** Correct stops over STOP advisories. The complement of the false-stop rate. */
  stopPrecision: number | undefined;
  /** The denominator behind the false-stop rate, reported so a rate is never read alone. */
  stopSupportCount: number;
  continueAdvisories: number;
  unnecessaryContinues: number;
  unnecessaryContinueRate: number | undefined;
  callsSaved: number;
  weightedPenalty: number;
  decisionsSeen: string[];
  classSupport: "SUFFICIENT_CLASS_SUPPORT" | "INSUFFICIENT_CLASS_SUPPORT";
  /** Whether the window holds enough evidence for a prospective verdict at all. */
  verdict: "PROSPECTIVE_VALIDATED" | "PROSPECTIVE_CONTRADICTED" | "INSUFFICIENT_EVIDENCE";
  safetyStatement: string;
  notes: string[];
}

/**
 * Computes the prospective metrics.
 *
 * Only two kinds of record are excluded, and both exclusions are the point of the window:
 *
 *   - a task still running, because its outcome is unknown and counting its advisories would put
 *     decisions in the denominator whose correctness is undefined;
 *   - a record whose `evidenceClass` is not `PROSPECTIVE_EVIDENCE` — a task that opened before the
 *     freeze is evidence about the policy's own corpus, so scoring the frozen policy on it would
 *     be the retrospective result restated under a prospective heading.
 */
export function prospectiveMetrics(records: readonly ProspectiveWindowRecord[], options: { falseStopPenalty?: number; unnecessaryContinuePenalty?: number } = {}): ProspectiveMetrics {
  const falseStopPenalty = options.falseStopPenalty ?? 5;
  const unnecessaryContinuePenalty = options.unnecessaryContinuePenalty ?? 1;
  const prospective = records.filter((record) => record.evidenceClass === "PROSPECTIVE_EVIDENCE");
  const excluded = records.length - prospective.length;
  const closed = prospective.filter((record) => record.outcome !== undefined);
  const notes: string[] = [];

  let continuationSteps = 0;
  let stopAdvisories = 0;
  let falseStops = 0;
  let continueAdvisories = 0;
  let unnecessaryContinues = 0;
  let callsSaved = 0;
  let weightedPenalty = 0;

  for (const record of closed) {
    const steps = new Map((record.outcome?.steps ?? []).map((step) => [step.stepIndex, step]));
    for (const advisory of record.advisories) {
      const step = steps.get(advisory.stepIndex);
      if (step === undefined) continue;
      continuationSteps += 1;
      if (advisory.decision === "STOP") {
        stopAdvisories += 1;
        if (step.taskComplete) callsSaved += 1;
        else {
          falseStops += 1;
          weightedPenalty += falseStopPenalty;
        }
      }
      if (advisory.decision === "CONTINUE") {
        continueAdvisories += 1;
        if (step.taskComplete) {
          unnecessaryContinues += 1;
          weightedPenalty += unnecessaryContinuePenalty;
        }
      }
    }
  }

  const rate = (numerator: number, denominator: number): number | undefined => (denominator === 0 ? undefined : Math.round((numerator / denominator) * 10000) / 10000);
  const support = decisionClassSupport(prospective);
  const enough = closed.length >= PROSPECTIVE_TARGETS.tasks && continuationSteps >= PROSPECTIVE_TARGETS.continuationSteps;

  if (excluded > 0) notes.push(`${excluded} record(s) in the window are not prospective evidence: their tasks opened before the freeze, so they measure the policy's own corpus and are excluded from every figure below`);
  if (closed.length < prospective.length) notes.push(`${prospective.length - closed.length} task(s) are still open and contribute no measurement`);
  if (stopAdvisories < STOP_SUPPORT_MINIMUM) notes.push(`only ${stopAdvisories} STOP advisory(ies); ${STOP_SUPPORT_MINIMUM} are needed before a false-stop rate means anything`);
  if (support.missing.length > 0) notes.push(`no advisory of class ${support.missing.join(", ")} has been observed, so the window cannot speak to ${support.missing.length} of the ${CONTINUATION_DECISION_CLASSES.length} decision classes this policy can emit`);
  if (!enough) notes.push(`${closed.length}/${PROSPECTIVE_TARGETS.tasks} task(s) and ${continuationSteps}/${PROSPECTIVE_TARGETS.continuationSteps} step(s): the window is below its target`);

  const falseStopRate = rate(falseStops, stopAdvisories);
  const verdict: ProspectiveMetrics["verdict"] =
    !enough || stopAdvisories < STOP_SUPPORT_MINIMUM
      ? "INSUFFICIENT_EVIDENCE"
      : falseStops === 0
        ? "PROSPECTIVE_VALIDATED"
        : falseStopRate !== undefined && falseStopRate > 0.02
          ? "PROSPECTIVE_CONTRADICTED"
          : "PROSPECTIVE_VALIDATED";

  return {
    tasks: prospective.length,
    tasksClosed: closed.length,
    continuationSteps,
    stopAdvisories,
    falseStops,
    falseStopRate,
    stopPrecision: rate(stopAdvisories - falseStops, stopAdvisories),
    stopSupportCount: stopAdvisories,
    continueAdvisories,
    unnecessaryContinues,
    unnecessaryContinueRate: rate(unnecessaryContinues, continueAdvisories),
    callsSaved,
    weightedPenalty,
    decisionsSeen: support.seen,
    classSupport: support.missing.length === 0 ? "SUFFICIENT_CLASS_SUPPORT" : "INSUFFICIENT_CLASS_SUPPORT",
    verdict,
    safetyStatement: stopSafetyStatement({ falseStops, stopAdvisories }),
    notes
  };
}

/**
 * Says what a false-stop count does and does not support.
 *
 * The phrase "0 false stops" invites a safety claim it cannot carry when the denominator is
 * small, so the denominator is always in the sentence.
 */
export function stopSafetyStatement(input: { falseStops: number; stopAdvisories: number }): string {
  if (input.stopAdvisories === 0) return "no STOP advisory has been observed, so nothing is known about stop safety";
  const rate = input.falseStops / input.stopAdvisories;
  const observed = `${input.falseStops} false stop(s) out of ${input.stopAdvisories} STOP advisory(ies), a rate of ${Math.round(rate * 10000) / 10000}`;
  if (input.stopAdvisories < STOP_SUPPORT_MINIMUM) {
    return `${observed}; with fewer than ${STOP_SUPPORT_MINIMUM} STOP advisories this is NOT evidence that stopping is safe, however low the rate looks`;
  }
  return input.falseStops === 0
    ? `${observed}; at this support level no false stop has been observed`
    : `${observed}; the rate is above zero, so stopping is not safe as it stands`;
}

export interface PolicyDefectReportInput {
  policyId: string;
  policyHash: string;
  failureMode: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  evidenceCases: Array<{ taskId: string; stepIndex: number; detail: string }>;
  candidateHypothesis: string;
  expectedTradeoff: string;
}

export interface PolicyDefectReport extends PolicyDefectReportInput {
  schemaVersion: number;
  kind: "RUNTIME_INTELLIGENCE_POLICY_DEFECT_REPORT";
  /** Literal: a defect report proposes, it never mutates a policy. */
  mutatesPolicy: false;
  proposedCandidateId: string;
  createdAt: string;
}

/**
 * Builds a defect report for a problem found in prospective data.
 *
 * The phase brief's rule is that a new problem is not fixed directly: it is reported, and only
 * then does a candidate policy exist to evaluate beside the frozen one. `mutatesPolicy` is a
 * literal `false` so a caller cannot mistake this for a change.
 */
export function buildPolicyDefectReport(input: PolicyDefectReportInput & { createdAt: string; candidateVersion: number }): PolicyDefectReport {
  return {
    schemaVersion: 1,
    kind: "RUNTIME_INTELLIGENCE_POLICY_DEFECT_REPORT",
    mutatesPolicy: false,
    policyId: input.policyId,
    policyHash: input.policyHash,
    failureMode: input.failureMode,
    severity: input.severity,
    evidenceCases: [...input.evidenceCases],
    candidateHypothesis: input.candidateHypothesis,
    expectedTradeoff: input.expectedTradeoff,
    proposedCandidateId: `continuation-policy-v${input.candidateVersion}`,
    createdAt: input.createdAt
  };
}

/** The four evidence identities, re-exported so a report and the registry cannot drift apart. */
export const PROSPECTIVE_EVIDENCE_CLASSES: readonly EvidenceClass[] = EVIDENCE_CLASSES;
