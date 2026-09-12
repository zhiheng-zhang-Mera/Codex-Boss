/**
 * Update-Plan/checkpoint-1.md §34 — Capability Gap → Self Improvement.
 *
 * §34 forbids ending a task with "Boss cannot do this". The gap must be recorded
 * (missing capability, task, failure, workaround, frequency, severity), and once
 * its conditions are met it walks a fixed chain: Capability Gap → Improvement
 * Task → Implementation → Regression Test → Knowledge Update → Capability
 * Registry. The Theme Generator's own gaps go through the same mechanism.
 *
 * This module is the chain's decision layer, and it is deliberately strict about
 * one thing: a gap is **not** closed by a task that ran. Closure needs a passing
 * regression test, an accepted knowledge update, AND a capability probe that
 * actually moved (MISSING/PARTIAL → EXISTS). Anything less leaves the chain open
 * and returns it to Implementation, with the reasons recorded.
 *
 * Pure: no fs, no clock, no process.
 */
import { contentHashOf } from "./workbook";
import type { CapabilityVerdict } from "./repo-world-model";
import type { KnowledgeCandidate, KnowledgeWriteOutcome } from "./knowledge-object";
import type { KnowledgeScope } from "./tenx/knowledge";
import type { CapabilityGap, FailureSeverity } from "./recovery";

export const CAPABILITY_CHAIN_VERSION = "capability-chain-1" as const;

/** §34's chain, in order. */
export const CAPABILITY_CHAIN = [
  "CAPABILITY_GAP",
  "IMPROVEMENT_TASK",
  "IMPLEMENTATION",
  "REGRESSION_TEST",
  "KNOWLEDGE_UPDATE",
  "CAPABILITY_REGISTRY"
] as const;
export type CapabilityChainStage = (typeof CAPABILITY_CHAIN)[number];

/* ------------------------------------------------------------------ *
 * aggregation: many occurrences, one capability
 * ------------------------------------------------------------------ */

export interface GapOccurrence {
  gap: CapabilityGap;
  /** What the gap blocked, for the improvement task's objective. */
  task: string;
  recorded_at: string;
}

export interface GapAggregate {
  /** Stable identity of the capability, so repeats aggregate instead of piling up. */
  key: string;
  capability: string;
  occurrences: number;
  /** The highest frequency a single record carried (a gap seen before this run). */
  frequency: number;
  severity: FailureSeverity;
  failure_classes: string[];
  tasks: string[];
  failures: string[];
  workarounds: string[];
  first_seen: string;
  last_seen: string;
}

/** §34 identity: the capability, normalized — not the task that hit it. */
export function gapKeyFor(missingCapability: string): string {
  return `cap-${contentHashOf(missingCapability.replace(/\s+/g, " ").trim().toLocaleLowerCase()).slice(0, 16)}`;
}

const SEVERITY_RANK: Readonly<Record<FailureSeverity, number>> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

export function worstSeverity(left: FailureSeverity, right: FailureSeverity): FailureSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

/**
 * §34 aggregation. Two tasks that hit the same missing capability are one gap
 * seen twice, which is exactly the "frequency" the plan asks to record.
 */
export function aggregateGaps(occurrences: readonly GapOccurrence[]): GapAggregate[] {
  const byKey = new Map<string, GapAggregate>();
  for (const occurrence of occurrences) {
    const capability = occurrence.gap.missing_capability.trim();
    if (!capability) continue;
    const key = gapKeyFor(capability);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, {
        key,
        capability,
        occurrences: 1,
        frequency: Math.max(1, occurrence.gap.frequency),
        severity: occurrence.gap.severity,
        failure_classes: [occurrence.gap.failure_class],
        tasks: [occurrence.task || occurrence.gap.task],
        failures: [occurrence.gap.failure],
        workarounds: [occurrence.gap.workaround],
        first_seen: occurrence.recorded_at,
        last_seen: occurrence.recorded_at
      });
      continue;
    }
    current.occurrences += 1;
    current.frequency = Math.max(current.frequency, occurrence.gap.frequency, current.occurrences);
    current.severity = worstSeverity(current.severity, occurrence.gap.severity);
    if (!current.failure_classes.includes(occurrence.gap.failure_class)) current.failure_classes.push(occurrence.gap.failure_class);
    const task = occurrence.task || occurrence.gap.task;
    if (task && !current.tasks.includes(task)) current.tasks.push(task);
    if (!current.failures.includes(occurrence.gap.failure)) current.failures.push(occurrence.gap.failure);
    if (occurrence.gap.workaround && !current.workarounds.includes(occurrence.gap.workaround)) current.workarounds.push(occurrence.gap.workaround);
    if (occurrence.recorded_at < current.first_seen) current.first_seen = occurrence.recorded_at;
    if (occurrence.recorded_at > current.last_seen) current.last_seen = occurrence.recorded_at;
  }
  return [...byKey.values()].sort((left, right) => SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] || right.occurrences - left.occurrences || left.key.localeCompare(right.key));
}

/* ------------------------------------------------------------------ *
 * "once the conditions are met" — when a gap becomes work
 * ------------------------------------------------------------------ */

export interface QualificationPolicy {
  /** Repeats needed before the gap is worth engineering time. */
  minOccurrences: number;
  /** A single gap this severe is always worth it. */
  alwaysSeverity: FailureSeverity;
}

export const DEFAULT_QUALIFICATION: QualificationPolicy = { minOccurrences: 2, alwaysSeverity: "HIGH" };

export interface Qualification {
  qualifies: boolean;
  reasons: string[];
}

/**
 * §34's "达到条件后": a gap becomes an improvement task when it repeats, or when a
 * single occurrence was severe enough that waiting for a repeat would be
 * negligent. Both thresholds are reported, so the decision is auditable.
 */
export function qualifiesForImprovement(aggregate: GapAggregate, policy: QualificationPolicy = DEFAULT_QUALIFICATION): Qualification {
  const reasons: string[] = [];
  const repeats = aggregate.occurrences >= policy.minOccurrences;
  reasons.push(`${aggregate.occurrences} occurrence(s) against the repeat threshold ${policy.minOccurrences}`);
  const severe = SEVERITY_RANK[aggregate.severity] >= SEVERITY_RANK[policy.alwaysSeverity];
  reasons.push(`severity ${aggregate.severity} against the always-worth-it threshold ${policy.alwaysSeverity}`);
  return { qualifies: repeats || severe, reasons };
}

/* ------------------------------------------------------------------ *
 * the improvement task
 * ------------------------------------------------------------------ */

export interface ImprovementProbe {
  capability: string;
  description?: string;
  terms?: string[];
  requires_paths?: string[];
}

export interface ImprovementTask {
  id: string;
  capability: string;
  gap_key: string;
  /** One line of intent, in the gap's own words. */
  objective: string;
  /** A §28-shaped requirement the implementation loop can be scored against. */
  requirement: { id: string; type: "DELIVERABLE"; text: string; visual: boolean };
  /** Where the worker may write (resolved by the caller against real files). */
  scope_terms: string[];
  /** The probe whose movement proves closure. */
  probe: ImprovementProbe;
  severity: FailureSeverity;
  frequency: number;
  failure_classes: string[];
  /** The verdict observed when the gap was recorded. */
  previous_verdict: CapabilityVerdict;
  opened_at: string;
}

/**
 * §34's Improvement Task, derived from the aggregated gap.
 *
 * The task carries the probe that will judge it: a capability gap is closed by the
 * capability becoming reachable, not by prose claiming it.
 */
export function planImprovement(input: {
  aggregate: GapAggregate;
  previous_verdict: CapabilityVerdict;
  probe?: Partial<ImprovementProbe>;
  now?: string;
}): ImprovementTask {
  const { aggregate } = input;
  const at = input.now ?? new Date(0).toISOString();
  const workload = aggregate.tasks[0] ?? aggregate.capability;
  return {
    id: `it-${contentHashOf([aggregate.key, aggregate.last_seen, workload].join("\u0000")).slice(0, 16)}`,
    capability: aggregate.capability,
    gap_key: aggregate.key,
    objective: `build the missing capability "${aggregate.capability}" so ${workload} no longer needs a workaround`,
    requirement: {
      id: `CG-${aggregate.key.slice(4, 12)}`,
      type: "DELIVERABLE",
      text: `the repository gains the capability: ${aggregate.capability}`,
      visual: false
    },
    scope_terms: [...new Set([aggregate.capability, ...aggregate.tasks].flatMap((text) => text.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length >= 4))].slice(0, 12),
    probe: {
      capability: input.probe?.capability ?? aggregate.capability,
      ...(input.probe?.description ? { description: input.probe.description } : {}),
      ...(input.probe?.terms ? { terms: input.probe.terms } : {}),
      ...(input.probe?.requires_paths ? { requires_paths: input.probe.requires_paths } : {})
    },
    severity: aggregate.severity,
    frequency: aggregate.frequency,
    failure_classes: [...aggregate.failure_classes],
    previous_verdict: input.previous_verdict,
    opened_at: at
  };
}

/* ------------------------------------------------------------------ *
 * walking the chain, and what actually closes a gap
 * ------------------------------------------------------------------ */

export interface ChainStep {
  stage: CapabilityChainStage;
  ok: boolean;
  detail: string;
  at: string;
}

export interface RegressionEvidence {
  passed: boolean;
  /** The gate that ran, and the §31.3 rows it produced. */
  gate?: string;
  evidence_ids?: string[];
  detail?: string;
}

export interface KnowledgeEvidence {
  outcome: KnowledgeWriteOutcome;
  subject?: string;
  reasons?: string[];
}

export interface ClosureInput {
  task: ImprovementTask;
  steps: readonly ChainStep[];
  regression: RegressionEvidence;
  knowledge: KnowledgeEvidence;
  current_verdict: CapabilityVerdict;
}

export interface ClosureVerdict {
  closed: boolean;
  /** True when the chain must go back to Implementation instead of closing. */
  returns_to: CapabilityChainStage;
  reasons: string[];
  label: "CAPABILITY_GAINED" | "PARTIAL_PROGRESS" | "NOT_CLOSED";
}

const VERDICT_RANK: Readonly<Record<CapabilityVerdict, number>> = { MISSING: 0, RESERVED: 1, PARTIAL: 2, EXISTS: 3 };

/**
 * §34 closure. Three doors, and the plan's own definition of done:
 *   1. the regression test passed (its evidence is cited),
 *   2. the knowledge update was accepted (or superseded a weaker fact),
 *   3. the capability probe moved — the capability is reachable now.
 *
 * A green test that leaves the capability just as missing is not a closed gap; it
 * returns the chain to Implementation with the probe's own evidence.
 */
export function closureFor(input: ClosureInput): ClosureVerdict {
  const reasons: string[] = [];
  const improved = VERDICT_RANK[input.current_verdict] > VERDICT_RANK[input.task.previous_verdict];
  const exists = input.current_verdict === "EXISTS";
  if (!input.regression.passed) reasons.push(`the regression test did not pass${input.regression.detail ? `: ${input.regression.detail}` : ""}`);
  if (!input.regression.evidence_ids?.length) reasons.push("the regression test cited no §31.3 evidence row");
  if (input.knowledge.outcome !== "ACCEPT" && input.knowledge.outcome !== "SUPERSEDE") {
    reasons.push(`the knowledge update was ${input.knowledge.outcome}${input.knowledge.reasons?.length ? `: ${input.knowledge.reasons.join("; ")}` : ""}`);
  }
  if (!improved) reasons.push(`the capability probe still reports ${input.current_verdict} (was ${input.task.previous_verdict}), so the capability was not gained`);
  const ordered = chainProblems(input.steps);
  reasons.push(...ordered);
  const closed = reasons.length === 0 && improved;
  return {
    closed,
    returns_to: closed ? "CAPABILITY_REGISTRY" : "IMPLEMENTATION",
    reasons,
    label: closed ? (exists ? "CAPABILITY_GAINED" : "PARTIAL_PROGRESS") : "NOT_CLOSED"
  };
}

/** §34's chain is a sequence: a stage cannot be recorded before its predecessor. */
export function chainProblems(steps: readonly ChainStep[]): string[] {
  const problems: string[] = [];
  let cursor = -1;
  for (const step of steps) {
    const index = CAPABILITY_CHAIN.indexOf(step.stage);
    if (index < 0) { problems.push(`unknown chain stage ${String(step.stage)}`); continue; }
    if (index <= cursor) { problems.push(`stage ${step.stage} was recorded out of order`); continue; }
    if (index > cursor + 1) problems.push(`stage ${step.stage} skipped ${CAPABILITY_CHAIN.slice(cursor + 1, index).join(", ")}`);
    cursor = index;
  }
  if (steps.length && steps[0]!.stage !== "CAPABILITY_GAP") problems.push(`the chain must start at CAPABILITY_GAP, not ${steps[0]!.stage}`);
  return problems;
}

/** The next stage the chain owes, given what has been recorded. */
export function nextChainStage(steps: readonly ChainStep[], closure?: ClosureVerdict): CapabilityChainStage | undefined {
  if (closure && !closure.closed) return closure.returns_to;
  const recorded = new Set(steps.map((step) => step.stage));
  return CAPABILITY_CHAIN.find((stage) => !recorded.has(stage));
}

/* ------------------------------------------------------------------ *
 * §24/§5 bridge: the gap becomes knowledge, through the CP2 gate
 * ------------------------------------------------------------------ */

/**
 * The §34 chain's Knowledge Update step, expressed as a §5.3 candidate.
 *
 * It is written as host-verified information: the source is the probe evidence,
 * the hash is over that evidence, and the verification state is VERIFIED only
 * because the host ran the probe and the regression test itself.
 */
export function knowledgeCandidateFor(input: {
  task: ImprovementTask;
  closure: ClosureVerdict;
  regression: RegressionEvidence;
  current_verdict: CapabilityVerdict;
  /** The probe's own evidence pointers. */
  probe_evidence: readonly string[];
  scope: KnowledgeScope;
  captured_at: string;
  task_ref: string;
}): KnowledgeCandidate {
  const content = [
    `capability: ${input.task.capability}`,
    `gap: ${input.task.failure_classes.join(", ")} (severity ${input.task.severity}, frequency ${input.task.frequency})`,
    `probe: ${input.task.previous_verdict} → ${input.current_verdict}`,
    `regression: ${input.regression.gate ?? "gate"} ${input.regression.passed ? "PASS" : "FAIL"}`,
    `closure: ${input.closure.label}`,
    `evidence: ${input.probe_evidence.slice(0, 8).join(" | ")}`
  ].join("\n");
  return {
    type: "CAPABILITY_GAP",
    scope: input.scope,
    subject: `capability gap: ${input.task.capability}`,
    source: "capability-probe",
    source_hash: contentHashOf([content, ...input.probe_evidence].join("\u0000")),
    content,
    summary: `${input.task.capability}: ${input.task.previous_verdict} → ${input.current_verdict} (${input.closure.label})`,
    task_ref: input.task_ref,
    captured_at: input.captured_at,
    producer: "VERIFICATION",
    produced_by: "improvement-loop",
    verification: input.closure.closed && input.regression.passed ? "VERIFIED" : "UNVERIFIED",
    verification_evidence: [...input.probe_evidence, ...(input.regression.evidence_ids ?? [])],
    confidence: input.closure.closed ? 0.9 : 0.5,
    authority: "VERIFIED_HOST",
    freshness: input.captured_at
  };
}

/* ------------------------------------------------------------------ *
 * the registry entry the chain ends with
 * ------------------------------------------------------------------ */

export interface CapabilityRegistryEntry {
  key: string;
  capability: string;
  verdict: CapabilityVerdict;
  previous_verdict: CapabilityVerdict;
  /** The gap that produced it, and the evidence that closed it. */
  gap_key: string;
  task_id: string;
  frequency: number;
  severity: FailureSeverity;
  evidence: string[];
  closed_at: string;
  status: "GAINED" | "PARTIAL" | "OPEN";
}

/**
 * §34's final stage: what the capability registry learns. An unclosed gap is
 * registered as OPEN with its reasons, so a capability that resisted one
 * improvement round is visible rather than forgotten.
 */
export function registryEntryFor(input: {
  task: ImprovementTask;
  closure: ClosureVerdict;
  current_verdict: CapabilityVerdict;
  evidence: readonly string[];
  closed_at: string;
}): CapabilityRegistryEntry {
  return {
    key: input.task.gap_key,
    capability: input.task.capability,
    verdict: input.current_verdict,
    previous_verdict: input.task.previous_verdict,
    gap_key: input.task.gap_key,
    task_id: input.task.id,
    frequency: input.task.frequency,
    severity: input.task.severity,
    evidence: [...input.evidence],
    closed_at: input.closed_at,
    status: input.closure.closed ? (input.current_verdict === "EXISTS" ? "GAINED" : "PARTIAL") : "OPEN"
  };
}

/** The whole chain's result for one capability, as the host records it. */
export interface ImprovementOutcome {
  task: ImprovementTask;
  /** The chain as it was actually recorded, in order. */
  steps: ChainStep[];
  /** The §30 loop's own label for the implementation stage. */
  loop_label?: string;
  regression: RegressionEvidence;
  previous_verdict: CapabilityVerdict;
  current_verdict: CapabilityVerdict;
  closure: ClosureVerdict;
  knowledge?: KnowledgeEvidence;
  registry: CapabilityRegistryEntry;
  /** The probe's evidence pointers, so closure can be re-checked. */
  probe_evidence: string[];
}
