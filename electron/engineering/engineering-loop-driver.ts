import { EngineeringLoopStore } from "./engineering-loop-store";
import {
  classifyEngineeringChange, decideConvergence, isSignificantMedium, isStagnating,
  type EngineeringFinding, type EngineeringGoalContract, type EngineeringIterationRecord,
  type StagnationSignals
} from "../../src/shared/engineering-loop";

/**
 * Autonomous engineering loop driver (plan §26–§41). Consumes the durable
 * store and drives ONE iteration round: audit (real repo signals) → triage
 * (severity) → plan/implement/build/test/verify via injected real operations →
 * regression → re-audit → convergence gate. The heavy work (running tests,
 * applying edits, reviewing diffs) is injected so the control flow is
 * deterministic; production plugs the same engineering seams used by tasks.
 *
 * Discipline: the loop never closes its own findings; evidence (build/tests)
 * is what advances a round, stagnation detection stops repeated strategies
 * (§39), and product-boundary findings are recorded and skipped (§28).
 */

export interface EngineeringLoopOperations {
  /** Deterministic audit of the repo: findings with severity + evidence. */
  audit(goal: EngineeringGoalContract): Promise<EngineeringFinding[]>;
  /** One real build (typecheck/build). */
  build(goal: EngineeringGoalContract): Promise<{ passed: boolean; evidence?: string }>;
  /** Runs the affected + regression tests. */
  test(goal: EngineeringGoalContract): Promise<{ passed: boolean; evidence?: string }>;
  /** Applies a bounded change for one triaged finding; returns changed files. */
  implement(goal: EngineeringGoalContract, finding: EngineeringFinding): Promise<{ changedFiles: string[]; error?: string }>;
  /** Independent review of the merged diff. */
  review(goal: EngineeringGoalContract, finding: EngineeringFinding, changedFiles: string[]): Promise<{ findings: string[] }>;
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
    let findings: EngineeringFinding[] = [];
    let cleanRounds = this.store.cleanRounds;
    const required = goal.convergencePolicy.cleanRoundsRequired;

    for (let round = 0; round < this.maxIterations; round++) {
      const record = this.store.beginIteration();
      // AUDIT (real repo signals, not the previous round's self-report).
      findings = await this.operations.audit(goal);
      this.store.updateIteration(record.iteration, (item) => { item.findings = findings; item.stage = "AUDIT"; });

      const blockers = findings.filter((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH");
      const significant = findings.filter((finding) => isSignificantMedium(finding));
      const outOfContract = findings.filter((finding) => classifyEngineeringChange(goal, finding.description) === "PRODUCT_DECISION_REQUIRED");

      // TRIAGE: work the highest-priority significant finding in this round.
      const candidates = [...blockers, ...significant];
      const target = candidates.find((candidate) => !outOfContract.some((blocked) => blocked.id === candidate.id)) ?? undefined;
      let changedThisRound = 0;
      if (target) {        // PLAN → IMPLEMENT a bounded change for the one triaged finding.
        const implemented = await this.operations.implement(goal, target);
        changedThisRound = implemented.changedFiles.length;
        changedFiles.push(...implemented.changedFiles.filter((file) => !changedFiles.includes(file)));
        // REVIEW (independent reviewer; implementer never closes their own item).
        const review = await this.operations.review(goal, target, implemented.changedFiles);
        this.store.updateIteration(record.iteration, (item) => {
          item.stage = "REVIEW";
          item.changedFiles = [...new Set([...item.changedFiles, ...implemented.changedFiles])];
          item.reviewFindings = review.findings;
          item.remainingRisk = implemented.error ?? (review.findings.join("; ") || "none");
        });
        if (implemented.error) {
          // Build/test evidence gate — a failed change never advances as fixed.
          return this.close(record, "ABORTED", telemetry, changedFiles, findings, implemented.error);
        }
      }

      // BUILD → TEST → REGRESSION evidence over the current tree.
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

      // RE-AUDIT cleanliness: count this round clean only if nothing significant
      // remains after the change. Out-of-contract findings are recorded and
      // skipped (§28) — they never block convergence (they need a human), but
      // they also never count as clean work.
      const actionableBlockers = blockers.filter((finding) => !outOfContract.some((blocked) => blocked.id === finding.id));
      const actionableSignificant = significant.filter((finding) => !outOfContract.some((blocked) => blocked.id === finding.id));
      const cleanRound = actionableBlockers.length === 0 && actionableSignificant.length === 0;
      cleanRounds = cleanRound ? cleanRounds + 1 : 0;
      this.store.setCleanRounds(cleanRounds);
      telemetry.repeatedIssueCount = actionableBlockers.length > 0 || actionableSignificant.length > 0 ? telemetry.repeatedIssueCount + 1 : 0;
      telemetry.noImprovementRounds = changedThisRound > 0 || cleanRound ? 0 : telemetry.noImprovementRounds + 1;

      // CONVERGENCE CHECK (actionable findings only).
      const decision = decideConvergence({
        findings: findings.filter((finding) => !outOfContract.some((blocked) => blocked.id === finding.id) && finding.severity !== "LOW" && finding.severity !== "OPTIONAL"),
        buildPassed: build.passed,
        testsPassed: test.passed,
        regressionPassed: test.passed,
        cleanRounds,
        cleanRoundsRequired: required,
        acceptedRisks: this.store.acceptedRisks()
      });
      this.store.updateIteration(record.iteration, (item) => { item.stage = "CONVERGENCE_CHECK"; });
      if (decision.state === "ENGINEERING_CONVERGED") return this.close(record, "ENGINEERING_CONVERGED", telemetry, changedFiles, findings, "converged");
      if (decision.state === "OPTIONAL_IMPROVEMENTS") return this.close(record, "OPTIONAL_IMPROVEMENTS", telemetry, changedFiles, findings, "only optional improvements remain");
      // §39: a repeated significant finding with no change and no clean round
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
