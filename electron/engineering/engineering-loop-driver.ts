import { EngineeringLoopStore } from "./engineering-loop-store";
import {
  classifyEngineeringChange, decideConvergence, isReviewerReflowFinding, isSignificantMedium, isStagnating,
  type EngineeringFinding, type EngineeringGoalContract, type EngineeringIterationRecord,
  type ReviewerFinding, type StagnationSignals
} from "../../src/shared/engineering-loop";

/**
 * Autonomous engineering loop driver (plan §26–§41). Consumes the durable
 * store and drives ONE iteration round: audit (real repo signals) → triage
 * (severity) → plan/implement → build/test evidence → INDEPENDENT REVIEW of
 * the merged diff → reviewer-finding reflow (§6.3) → regression → re-audit →
 * convergence gate. The heavy work (running tests, applying edits, reviewing
 * diffs) is injected so the control flow is deterministic; production plugs
 * the same engineering seams used by tasks.
 *
 * Discipline: the loop never closes its own findings; evidence (build/tests)
 * is what advances a round; a HIGH/significant-MEDIUM reviewer finding becomes
 * a NEW finding that re-enters triage → implement → verify (§6.3); stagnation
 * detection stops repeated strategies (§39); product-boundary findings are
 * recorded and skipped (§28). An implementer failure never advances as fixed.
 */

export interface EngineeringReviewEvidence {
  buildPassed: boolean;
  testsPassed: boolean;
}

export interface EngineeringLoopOperations {
  /** Deterministic audit of the repo: findings with severity + evidence. */
  audit(goal: EngineeringGoalContract): Promise<EngineeringFinding[]>;
  /** One real build (typecheck/build). */
  build(goal: EngineeringGoalContract): Promise<{ passed: boolean; evidence?: string }>;
  /** Runs the affected + regression tests. */
  test(goal: EngineeringGoalContract): Promise<{ passed: boolean; evidence?: string }>;
  /** Applies a bounded change for one triaged finding; returns changed files. */
  implement(goal: EngineeringGoalContract, finding: EngineeringFinding): Promise<{ changedFiles: string[]; error?: string }>;
  /**
   * Independent review of the merged diff given the acceptance evidence.
   * Reviewer findings are structured so the driver can reflow HIGH /
   * significant-MEDIUM items into the next triage round (§6.2/§6.3).
   */
  review(
    goal: EngineeringGoalContract,
    finding: EngineeringFinding,
    changedFiles: string[],
    evidence: EngineeringReviewEvidence
  ): Promise<{ findings: ReviewerFinding[]; raw?: string }>;
}

export interface EngineeringLoopOptions {
  store: EngineeringLoopStore;
  operations: EngineeringLoopOperations;
  maxIterations?: number;
}

export type EngineeringLoopState = "ENGINEERING_CONVERGED" | "OPTIONAL_IMPROVEMENTS" | "STAGNANT" | "ABORTED";

export interface EngineeringLoopSummary {
  state: EngineeringLoopState;
  iterations: number;
  telemetry: StagnationSignals;
  changedFiles: string[];
  findings: EngineeringFinding[];
}

/** Maps a reviewer finding onto a re-flowable engineering finding (§6.3). */
function carriedFinding(target: EngineeringFinding, changedFiles: string[], review: ReviewerFinding): EngineeringFinding {
  const seed = `${target.id}\n${review.summary}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  return {
    id: `review:${target.id}:${Math.abs(hash).toString(36)}`,
    area: `review(${target.area})`,
    severity: review.severity,
    description: review.summary,
    evidence: `Reviewer reflow on ${target.id} after ${changedFiles.length} changed file(s):\n${changedFiles.join("\n")}\n${review.summary}`
  };
}

export class EngineeringLoopDriver {
  private readonly store: EngineeringLoopStore;
  private readonly operations: EngineeringLoopOperations;
  private readonly maxIterations: number;

  constructor(options: EngineeringLoopOptions) {
    this.store = options.store;
    this.operations = options.operations;
    this.maxIterations = Math.max(1, options.maxIterations ?? 10);
  }

  async run(): Promise<EngineeringLoopSummary> {
    const goal = this.store.goal;
    if (!goal) throw new Error("No frozen engineering goal");
    const telemetry: StagnationSignals = { repeatedIssueCount: 0, sameTestFailCount: 0, noImprovementRounds: 0 };
    const changedFiles: string[] = [];
    const findings: EngineeringFinding[] = [];
    // §6.3: reviewer findings that must re-enter triage survive across audit
    // rounds (a clean compiler never dismisses a reviewer issue by itself).
    const carried = new Map<string, EngineeringFinding>();
    let cleanRounds = this.store.cleanRounds;
    const required = goal.convergencePolicy.cleanRoundsRequired;

    const outOfContract = (finding: EngineeringFinding) => classifyEngineeringChange(goal, finding.description) === "PRODUCT_DECISION_REQUIRED";
    const actionableAudit = (audit: EngineeringFinding[]) => audit.filter((finding) => !outOfContract(finding) && (finding.severity === "CRITICAL" || finding.severity === "HIGH" || isSignificantMedium(finding)));

    for (let round = 0; round < this.maxIterations; round++) {
      const record = this.store.beginIteration();
      // AUDIT (real repo signals, not the previous round's self-report).
      const audit = await this.operations.audit(goal);
      findings.length = 0;
      findings.push(...audit);
      this.store.updateIteration(record.iteration, (item) => { item.findings = audit; item.stage = "AUDIT"; });

      const blockers = audit.filter((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH");
      const significant = audit.filter((finding) => isSignificantMedium(finding));
      // TRIAGE: audit blockers/significant first, then carried reviewer
      // findings; out-of-contract findings never become work.
      const target = [...blockers, ...significant, ...carried.values()].find((candidate) => !outOfContract(candidate));
      let changedThisRound = 0;

      if (target) {
        const wasCarried = [...carried.values()].some((item) => item.id === target.id);
        // PLAN → IMPLEMENT a bounded change for the one triaged finding.
        const implemented = await this.operations.implement(goal, target);
        changedThisRound = implemented.changedFiles.length;
        changedFiles.push(...implemented.changedFiles.filter((file) => !changedFiles.includes(file)));
        this.store.updateIteration(record.iteration, (item) => {
          item.stage = "IMPLEMENT";
          item.changedFiles = [...new Set([...item.changedFiles, ...implemented.changedFiles])];
          item.remainingRisk = implemented.error ?? "implemented; awaiting build/test/review";
        });
        if (implemented.error) {
          // An implementer failure never advances as fixed; the goal is rolled
          // back by the caller (ABORTED) — evidence stays in the ledger.
          return this.close(record, "ABORTED", telemetry, changedFiles, findings, implemented.error);
        }

        // BUILD → TEST evidence over the current tree BEFORE the reviewer sees it.
        const build = await this.operations.build(goal);
        const test = await this.operations.test(goal);
        this.store.updateIteration(record.iteration, (item) => {
          item.stage = "VERIFY";
          item.buildPassed = build.passed;
          item.testsPassed = test.passed;
          item.regressionPassed = test.passed;
        });
        if (!build.passed || !test.passed) {
          this.store.setCleanRounds(0);
          telemetry.sameTestFailCount = test.passed ? 0 : telemetry.sameTestFailCount + 1;
          this.store.updateIteration(record.iteration, (item) => {
            item.status = "RUNNING";
            item.remainingRisk = `build=${build.passed ? "PASS" : "FAIL"} test=${test.passed ? "PASS" : "FAIL"}`;
          });
          if (isStagnating(telemetry)) return this.close(record, "STAGNANT", telemetry, changedFiles, findings, "same test failure across rounds");
          continue;
        }

        // REVIEW (independent reviewer; implementer never closes their own item).
        const review = await this.operations.review(goal, target, implemented.changedFiles, { buildPassed: build.passed, testsPassed: test.passed });
        const reflow = review.findings.filter((item) => isReviewerReflowFinding(item));
        const reflowFindings = reflow.map((item) => carriedFinding(target, implemented.changedFiles, item));
        for (const finding of reflowFindings) {
          carried.set(finding.id, finding);
          if (!findings.some((existing) => existing.id === finding.id)) findings.push(finding);
        }
        this.store.updateIteration(record.iteration, (item) => {
          item.stage = "REVIEW";
          item.reviewFindings = review.findings.map((item) => `${item.severity}: ${item.summary}`);
          // Reviewer reflow is durable evidence on the SAME iteration: it was
          // produced by this round's change and must re-enter triage (§6.3).
          item.findings = [...new Map([...item.findings, ...reflowFindings].map((finding) => [finding.id, finding])).values()];
          item.remainingRisk = reflow.length ? `reviewer reflow: ${reflow.map((item) => item.summary).join(" | ")}` : "review clean";
        });
        if (wasCarried && reflow.length === 0) carried.delete(target.id);
      } else {
        // Nothing actionable this round — still confirm build/test over the tree.
        const build = await this.operations.build(goal);
        const test = await this.operations.test(goal);
        this.store.updateIteration(record.iteration, (item) => {
          item.stage = "VERIFY";
          item.buildPassed = build.passed;
          item.testsPassed = test.passed;
          item.regressionPassed = test.passed;
        });
        if (!build.passed || !test.passed) {
          this.store.setCleanRounds(0);
          telemetry.sameTestFailCount = test.passed ? 0 : telemetry.sameTestFailCount + 1;
          this.store.updateIteration(record.iteration, (item) => { item.status = "RUNNING"; item.remainingRisk = `build=${build.passed ? "PASS" : "FAIL"} test=${test.passed ? "PASS" : "FAIL"}`; });
          if (isStagnating(telemetry)) return this.close(record, "STAGNANT", telemetry, changedFiles, findings, "same test failure across rounds");
          continue;
        }
        // Audit was clean, no carried reviewer findings, and the tree verifies:
        // a clean round that counts toward convergence.
        if (actionableAudit(audit).length === 0 && carried.size === 0) cleanRounds++;
      }

      // RE-AUDIT cleanliness: count this round clean only if nothing significant
      // remains (audit findings + carried reviewer reflows). Out-of-contract
      // findings are recorded and skipped (§28) — they never count as work.
      const openActionable = actionableAudit(audit);
      const cleanRound = openActionable.length === 0 && carried.size === 0;
      if (target && cleanRound) cleanRounds++;
      if (!cleanRound) {
        cleanRounds = 0;
        this.store.setCleanRounds(0);
      } else {
        this.store.setCleanRounds(cleanRounds);
      }
      telemetry.repeatedIssueCount = openActionable.length > 0 || carried.size > 0 ? telemetry.repeatedIssueCount + 1 : 0;
      telemetry.noImprovementRounds = changedThisRound > 0 || cleanRound ? 0 : telemetry.noImprovementRounds + 1;

      // CONVERGENCE CHECK (actionable audit findings + carried reviewer items).
      const decision = decideConvergence({
        findings: [...audit.filter((finding) => !outOfContract(finding) && finding.severity !== "LOW" && finding.severity !== "OPTIONAL"), ...carried.values()],
        buildPassed: true,
        testsPassed: true,
        regressionPassed: true,
        cleanRounds,
        cleanRoundsRequired: required,
        acceptedRisks: this.store.acceptedRisks()
      });
      this.store.updateIteration(record.iteration, (item) => { item.stage = "CONVERGENCE_CHECK"; });
      if (decision.state === "ENGINEERING_CONVERGED") return this.close(record, "ENGINEERING_CONVERGED", telemetry, changedFiles, findings, "converged");
      if (decision.state === "OPTIONAL_IMPROVEMENTS") return this.close(record, "OPTIONAL_IMPROVEMENTS", telemetry, changedFiles, findings, "only optional improvements remain");
      // §39: repeated significant findings with no change and no clean round
      // across the limit is stagnation — stop and replan, never spin.
      if (isStagnating(telemetry) && !cleanRound) return this.close(record, "STAGNANT", telemetry, changedFiles, findings, "no measurable improvement across rounds");
    }
    return this.close(undefined, "ABORTED", telemetry, changedFiles, findings, `iteration cap ${this.maxIterations} reached`);
  }

  private close(record: EngineeringIterationRecord | undefined, state: EngineeringLoopState, telemetry: StagnationSignals, changedFiles: string[], findings: EngineeringFinding[], risk: string): EngineeringLoopSummary {
    if (record) {
      this.store.updateIteration(record.iteration, (item) => { item.status = state === "ENGINEERING_CONVERGED" ? "CONVERGED" : state === "OPTIONAL_IMPROVEMENTS" ? "OPTIONAL_IMPROVEMENTS" : state === "STAGNANT" ? "STAGNANT" : "ABORTED"; item.remainingRisk = risk; });
    }
    return { state, iterations: this.store.iterations().length, telemetry, changedFiles: [...new Set(changedFiles)], findings };
  }
}
