/**
 * Update-Plan/checkpoint-1.md §30 — the implementation loop.
 *
 * The plan's cycle is Plan → Worker → Host Verification → Review → Repair →
 * Reverify. Checkpoint 8 delivered the host-verification stage
 * (`verification-engine.ts`) and checkpoint 9 the review stage
 * (`review-engine.ts`); this module is the loop that drives them, so the stages
 * are not merely available but actually used in order:
 *
 *   1. the §29 plan node grants the worker a bounded scope (§30.1);
 *   2. the worker proposes a change unit for that scope;
 *   3. the host applies it whole-or-nothing and verifies the claims (§30.2/§30.3);
 *   4. the §31 ladder climbs for every requirement the node serves;
 *   5. the §32 review runs over the real artifacts and routes HIGH/MEDIUM back;
 *   6. a repair iteration receives the blocking findings and tries again;
 *   7. the label comes from the §2.3 completion gate — never from the worker.
 *
 * The worker is injected because a worker is a model or a Candidate, and §2.3
 * forbids the loop from trusting one: whatever the worker returns is applied
 * through the same bounded, guarded seam as any other change, and is believed
 * only where git, the hash and a gate agree. A loop with no worker attached does
 * nothing and says so.
 */
import type { ExecutionNode, VerificationGate } from "../../src/shared/execution-planner";
import type { ChangeClaim, ClaimVerdict, GateRun, LadderOutcome, VerifiableRequirement, WorkerScope } from "../../src/shared/verification";
import { summarizeLedger, type EvidenceLedgerFile, type GateOutcome } from "../../src/shared/evidence-ledger";
import { completionGate, routeFindings, type ReviewFinding, type ReviewReport, type ReviewRecord } from "../../src/shared/review";
import type { ReviewOutcome } from "./review-engine";
import type { ApplyResult, VerificationEngine } from "./verification-engine";

export const IMPLEMENTATION_LOOP_VERSION = "implementation-loop-1" as const;
export const DEFAULT_MAX_ITERATIONS = 3;

export interface WorkerRequest {
  node: ExecutionNode;
  /** 1-based iteration number. */
  iteration: number;
  /** Blocking findings from the previous iteration, for the repair attempt. */
  findings: ReviewFinding[];
  previous: IterationRecord[];
}

export interface WorkerProposal {
  changes: { path: string; content: string }[];
  /** What the worker says it changed; the host verifies each claim. */
  claims?: ChangeClaim[];
  note?: string;
}

/**
 * A worker. Returning `undefined` means "nothing to change", which the loop
 * records as NOTHING_TO_DO rather than treating as success.
 */
export type ImplementationWorker = (request: WorkerRequest) => Promise<WorkerProposal | undefined> | WorkerProposal | undefined;

export interface IterationRecord {
  iteration: number;
  worker_note?: string;
  applied: boolean;
  refused_problems: string[];
  changed_files: string[];
  new_files: string[];
  claims: { confirmed: number; refused: number; problems: string[] };
  gates: { gate: VerificationGate; result: GateOutcome }[];
  ladders: { requirement_id: string; outcome: LadderOutcome["outcome"]; failed_at?: VerificationGate }[];
  findings: {
    blocking: string[];
    /** §30.3 traceability: what the blocking findings actually said. */
    blocking_detail: { id: string; subject: string; severity: string; statement: string }[];
    total: number;
    refused: string[];
  };
  /** §33: how this iteration's failure was classified, and what recovery is due. */
  recovery?: {
    failure_class: string;
    severity: string;
    reason: string;
    next_step?: string;
    hard_blocker: boolean;
    requires_owner?: string;
  };
  coverage_not_run: string[];
  label: ReviewReport["label"];
  reason: string;
}

export interface LoopInput {
  node: ExecutionNode;
  requirements: readonly VerifiableRequirement[];
  worker?: ImplementationWorker;
  engine: VerificationEngine;
  /** §32 review over the real artifacts. */
  review: (request: {
    requirements: readonly (VerifiableRequirement & { claims_complete: boolean })[];
    scope: WorkerScope;
    change: { changed_files: string[]; new_files: string[] };
    refused_units?: { problems: string[] }[];
    unconfirmed_claims?: { path: string; problem: string }[];
    extra_records?: ReviewRecord[];
    extra_findings?: ReviewFinding[];
  }) => ReviewOutcome;
  /** The §32 plan, so a review layer can be told exactly what to answer. */
  reviewPlan?: (requirements: readonly VerifiableRequirement[]) => { probes: string[]; dimensions: readonly unknown[] };
  /**
   * §33: the repair stage asks for a failure classification and the recovery step
   * that is due. Absent means no classification was made, which the record shows
   * as such rather than inventing one.
   */
  recover?: (input: {
    iteration: number;
    gateFailures: { gate: VerificationGate; detail?: string; exit_code?: number }[];
    findings: ReviewFinding[];
    changedFiles: string[];
  }) => {
    failure_class: string;
    severity: string;
    reason: string;
    next_step?: string;
    hard_blocker: boolean;
    requires_owner?: { kind: string; reason: string };
  } | undefined;
  /** Records supplied by another review layer (e.g. a model reviewer). */
  reviewerRecords?: (context: { iteration: number; changedFiles: string[]; findings: ReviewFinding[]; probes: string[]; dimensions: string[] }) => ReviewRecord[];
  reviewerFindings?: (context: { iteration: number; changedFiles: string[] }) => ReviewFinding[];
  maxIterations?: number;
  now?: () => Date;
}

export interface LoopOutcome {
  schemaVersion: 1;
  version: typeof IMPLEMENTATION_LOOP_VERSION;
  node_id: string;
  label: ReviewReport["label"] | "NOTHING_TO_DO";
  iterations: IterationRecord[];
  /** §31.3 ledger summary after the loop finished. */
  ledger: ReturnType<typeof summarizeLedger>;
  final: {
    report?: ReviewReport;
    outstanding_requirements: string[];
    failed_requirements: string[];
    reasons: string[];
  };
  diagnostics: string[];
}

export async function runImplementationLoop(input: LoopInput): Promise<LoopOutcome> {
  const maxIterations = Math.max(1, Math.min(5, input.maxIterations ?? DEFAULT_MAX_ITERATIONS));
  const now = input.now ?? (() => new Date());
  const iterations: IterationRecord[] = [];
  const diagnostics: string[] = [];
  let finalReview: ReviewOutcome | undefined;
  let ledger: EvidenceLedgerFile;

  if (!input.worker) {
    diagnostics.push("no worker is attached to this loop; §30.1 work may only be proposed by a worker, so nothing was changed");
    ledger = input.engine.ledger();
    return {
      schemaVersion: 1,
      version: IMPLEMENTATION_LOOP_VERSION,
      node_id: input.node.id,
      label: "NOTHING_TO_DO",
      iterations,
      ledger: summarizeLedger(ledger),
      final: { outstanding_requirements: input.requirements.map((requirement) => requirement.id), failed_requirements: [], reasons: ["no worker was attached"] },
      diagnostics
    };
  }

  let blocking: ReviewFinding[] = [];
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const proposal = await input.worker({ node: input.node, iteration, findings: blocking, previous: iterations });
    if (!proposal || !proposal.changes.length) {
      diagnostics.push(`iteration ${iteration}: the worker proposed no change`);
      break;
    }
    const scope = input.engine.scopeFor(input.node);
    const applied: ApplyResult = input.engine.applyChangeUnit(scope, { changes: proposal.changes });
    const changedFiles = applied.applied ? applied.changes.map((change) => change.path) : [];
    const newFiles = applied.applied ? applied.changes.filter((change) => change.before_sha256 === null).map((change) => change.path) : [];

    // §30.2: the host believes a claim only where git, the hash and the disk agree.
    let claims: { confirmed: number; refused: number; problems: string[] } = { confirmed: 0, refused: 0, problems: [] };
    let claimVerdicts: ClaimVerdict[] = [];
    if (applied.applied && proposal.claims?.length) {
      const verification = input.engine.verifyClaims(proposal.claims, applied.changes);
      claimVerdicts = verification.verdicts;
      claims = {
        confirmed: claimVerdicts.filter((verdict) => verdict.ok).length,
        refused: claimVerdicts.filter((verdict) => !verdict.ok).length,
        problems: claimVerdicts.filter((verdict) => !verdict.ok).map((verdict) => `${verdict.path}: ${verdict.problem}`)
      };
    } else if (applied.applied) {
      // No explicit claim: the applied unit itself is the claim, verified by git.
      const verification = input.engine.verifyClaims(changedFiles.map((file) => ({ path: file })), applied.changes);
      claimVerdicts = verification.verdicts;
      claims = {
        confirmed: claimVerdicts.filter((verdict) => verdict.ok).length,
        refused: claimVerdicts.filter((verdict) => !verdict.ok).length,
        problems: claimVerdicts.filter((verdict) => !verdict.ok).map((verdict) => `${verdict.path}: ${verdict.problem}`)
      };
    }

    // §31.1: climb the ladder for every requirement this node serves.
    const gates: { gate: VerificationGate; result: GateOutcome }[] = [];
    const gateRuns: GateRun[] = [];
    const ladders: IterationRecord["ladders"] = [];
    for (const requirement of input.requirements) {
      const selection = input.engine.selectFor(requirement);
      const run = await input.engine.verifyRequirement(selection);
      const record: IterationRecord["ladders"][number] = { requirement_id: requirement.id, outcome: run.outcome.outcome };
      if (run.outcome.failed_at) record.failed_at = run.outcome.failed_at;
      ladders.push(record);
      for (const gateRun of run.outcome.ran) { gates.push({ gate: gateRun.gate, result: gateRun.result }); gateRuns.push(gateRun); }
    }

    // §32: review the real artifacts of this iteration.
    const claimed = input.requirements.map((requirement) => ({ ...requirement, claims_complete: true }));
    const plan = input.reviewPlan?.(claimed);
    const reviewOutcome = input.review({
      requirements: claimed,
      scope,
      change: { changed_files: changedFiles, new_files: newFiles },
      ...(applied.problems.length ? { refused_units: [{ problems: applied.problems }] } : {}),
      ...(claims.problems.length ? { unconfirmed_claims: claimVerdicts.filter((verdict) => !verdict.ok).map((verdict) => ({ path: verdict.path, problem: verdict.problem ?? "unconfirmed" })) } : {}),
      ...(input.reviewerRecords ? { extra_records: input.reviewerRecords({ iteration, changedFiles, findings: blocking, probes: plan?.probes ?? [], dimensions: plan?.dimensions.map((subject) => String(subject)) ?? [] }) } : {}),
      ...(input.reviewerFindings ? { extra_findings: input.reviewerFindings({ iteration, changedFiles }) } : {})
    });
    finalReview = reviewOutcome;
    const routed = routeFindings(reviewOutcome.findings);
    blocking = routed.repair;

    // §33: classify this iteration's failure and record the recovery that is due.
    const gateFailures = gateRuns
      .filter((run) => run.result === "FAIL")
      .map((run) => ({ gate: run.gate, ...(run.detail ? { detail: run.detail } : {}), ...(run.exit_code !== undefined ? { exit_code: run.exit_code } : {}) }));
    const recovery = input.recover && (gateFailures.length || routed.repair.length)
      ? input.recover({ iteration, gateFailures, findings: routed.repair, changedFiles })
      : undefined;
    const recoveryRecord: IterationRecord["recovery"] = recovery
      ? {
          failure_class: recovery.failure_class,
          severity: recovery.severity,
          reason: recovery.reason,
          ...(recovery.next_step ? { next_step: recovery.next_step } : {}),
          hard_blocker: recovery.hard_blocker,
          ...(recovery.requires_owner ? { requires_owner: `${recovery.requires_owner.kind}: ${recovery.requires_owner.reason}` } : {})
        }
      : undefined;

    iterations.push({
      iteration,
      ...(proposal.note ? { worker_note: proposal.note } : {}),
      applied: applied.applied,
      refused_problems: [...applied.problems],
      changed_files: changedFiles,
      new_files: newFiles,
      claims,
      gates,
      ladders,
      findings: {
        blocking: routed.repair.map((finding) => finding.id),
        blocking_detail: routed.repair.map((finding) => ({ id: finding.id, subject: finding.subject, severity: finding.severity, statement: finding.statement })),
        total: reviewOutcome.findings.length,
        refused: routed.refused.map((entry) => entry.finding.id)
      },
      ...(recoveryRecord ? { recovery: recoveryRecord } : {}),
      coverage_not_run: reviewOutcome.report.coverage.not_run,
      label: reviewOutcome.report.label,
      reason: reviewOutcome.report.reasons.join("; ") || reviewOutcome.report.label
    });

    if (!routed.blocking) break;
    diagnostics.push(`iteration ${iteration}: ${routed.repair.length} open HIGH/MEDIUM finding(s) return to the repair loop (§32.3)`);
  }

  ledger = input.engine.ledger();
  const observed = finalReview?.observation.requirements ?? [];
  const outstanding = observed.filter((requirement) => (requirement.missing_evidence ?? []).length > 0).map((requirement) => requirement.id);
  const failed = observed.filter((requirement) => requirement.failed_gates.length > 0).map((requirement) => requirement.id);
  const completion = finalReview
    ? completionGate({ findings: finalReview.findings, coverage: finalReview.report.coverage, outstanding_requirements: outstanding, failed_requirements: failed })
    : undefined;

  const last = iterations.at(-1);
  return {
    schemaVersion: 1,
    version: IMPLEMENTATION_LOOP_VERSION,
    node_id: input.node.id,
    label: iterations.length ? (completion?.label ?? last?.label ?? "INCOMPLETE") : "NOTHING_TO_DO",
    iterations,
    ledger: summarizeLedger(ledger),
    final: {
      ...(finalReview ? { report: finalReview.report } : {}),
      outstanding_requirements: outstanding,
      failed_requirements: failed,
      reasons: completion?.reasons ?? diagnostics
    },
    diagnostics
  };
}
