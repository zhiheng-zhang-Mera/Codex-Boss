/**
 * The goal-driven engineering loop — the counterpart to `EngineeringLoopDriver`.
 *
 * ## Why this exists as a second loop rather than a change to the first
 *
 * `EngineeringLoopDriver` is a REPAIR loop, and correctly so. Every round it asks the workspace what is
 * wrong and fixes the first thing it finds; its two production callers are the autonomous engineering
 * goal (whose purpose is converging a repo to a clean audit) and self-evolution (which repairs the
 * platform itself). In both, "the audit found a failure ⇒ fix it" is the intended semantics.
 *
 * That is the wrong job for a goal. Given an objective such as "add this test file", a repair loop
 * audits, finds whatever was ALREADY failing, and works that instead — on a real dogfooding run it
 * targeted a pre-existing environment-blocked suite and aborted, never touching the objective. The
 * finding it chased was not caused by the goal and could never be cleared by it.
 *
 * So the roles are split, and the split is the whole design:
 *
 *  - the **audit is a PRECONDITION**, not a work list. It answers "is this workspace in a state where
 *    a change can be judged?" A workspace whose own tooling cannot run is refused up front
 *    (`PF-DEBT-009`), because nothing measured in it would mean anything — and that refusal names the
 *    reason instead of presenting it as an unscopable code finding.
 *  - pre-existing CODE findings are **recorded as pre-existing and not acted on**. They are carried in
 *    the result so a reader sees the state the goal started from; they are never the round's target.
 *  - the **objective is the work list**. Each iteration proposes a change for the goal, applies it
 *    whole-or-nothing through the host's own `ProposalRunner` (hash-bound, verified), and stops when
 *    verification passes and something actually changed.
 *
 * ## What it deliberately does not do
 *
 * It does not decide that the goal is met — the host's checks do. A worker saying "done" is not
 * evidence, so `CONVERGED` requires the host's own verification to pass over a non-empty change set.
 * It does not silently reach for a different objective when one attempt fails: a change that does not
 * verify is a `NOT_CONVERGED` result carrying the host's failure evidence, not a reason to try
 * something else and report success.
 */

import fs from "node:fs";
import path from "node:path";
import type { EngineeringFinding, EngineeringGoalContract, ReviewerFinding } from "../../src/shared/engineering-loop";
import { isEnvironmentFinding } from "../../src/shared/engineering-loop";
import type { SatisfactionResult } from "../../src/shared/acceptance";
import { judgeGoalAcceptance } from "./goal-acceptance";
import { ProposalRunner } from "./proposal-runner";
import { engineeringChecksFor } from "./verification-policy";
import type { EngineeringReviewEvidence } from "./engineering-loop-driver";
import { scanRepo } from "./repo-inspector";

type EngineeringGoalLoopState =
  | "CONVERGED"
  | "NOT_CONVERGED"
  /** The change applied and the checks passed, but the OBJECTIVE is contradicted by the evidence. */
  | "OBJECTIVE_CONTRADICTED"
  /** The change applied and the checks passed, but nothing establishes the objective. */
  | "OBJECTIVE_INSUFFICIENT_EVIDENCE"
  | "PRECONDITION_FAILED"
  | "NO_EDITOR";

interface EngineeringGoalLoopSummary {
  state: EngineeringGoalLoopState;
  iterations: number;
  /** Files the host actually applied and verified. */
  changedFiles: string[];
  /** Findings present BEFORE the goal was worked, recorded and not acted on. */
  preExisting: EngineeringFinding[];
  /** The host's verification result for the final attempt, when one ran. */
  verification?: { passed: boolean; checks: Array<{ kind: string; passed: boolean; detail?: string }> };
  /**
   * Whether the OBJECTIVE is satisfied, and why.
   *
   * Separate from `verification`, and the distinction is the point of Phase 07: `verification` says the
   * checks passed; this says the checks establish what the goal claimed. `CONVERGED` requires both, so a
   * green suite over an empty case can no longer be reported as success.
   */
  acceptance?: SatisfactionResult;
  /** Findings the independent reviewer raised about the final attempt. */
  reviewFindings: ReviewerFinding[];
  /** Machine-readable reason the run reached its terminal state. */
  terminalReason: string;
}

export interface EngineeringGoalLoopOperations {
  /** The precondition check. Returns what is wrong with the workspace as it stands. */
  audit(goal: EngineeringGoalContract): Promise<EngineeringFinding[]>;
  /** Propose, apply and verify one bounded change for the objective. Undefined change set = nothing to do. */
  implement(goal: EngineeringGoalContract, objective: string, attempt: number): Promise<{ changedFiles: string[]; status: "PASS" | "FAIL"; checks: Array<{ kind: string; passed: boolean; detail?: string }>; error?: string }>;
  /**
   * Judge whether the objective is satisfied by evidence.
   *
   * REQUIRED. A caller must say how acceptance is decided — `return { verdict: "SATISFIED", … }` is
   * allowed, but it has to be written down. Leaving the judgement optional made it possible to converge
   * having judged nothing, which is the defect this phase exists to close; requiring it means the
   * production composition root names its acceptance model, and a caller who has none must say so
   * explicitly rather than inherit silence.
   */
  acceptance(goal: EngineeringGoalContract, changedFiles: string[]): Promise<SatisfactionResult>;
  /** Independent review of the applied change. Absent means no reviewer is configured. */
  review?(goal: EngineeringGoalContract, changedFiles: string[], evidence: EngineeringReviewEvidence): Promise<{ findings: ReviewerFinding[] }>;
}

interface EngineeringGoalLoopOptions {
  goal: EngineeringGoalContract;
  operations: EngineeringGoalLoopOperations;
  /** Attempts allowed for the objective. Each is a full propose → apply → verify cycle. */
  maxAttempts?: number;
}

/**
 * Run one goal through the goal-driven loop.
 *
 * The order is the design: precondition, then work, then judge.
 */
export async function runEngineeringGoalLoop(options: EngineeringGoalLoopOptions): Promise<EngineeringGoalLoopSummary> {
  const goal = options.goal;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);

  // PRECONDITION. An environment finding means the workspace cannot build or test itself, so no
  // judgement made inside it is trustworthy — including the judgement that the goal succeeded. Refuse
  // here, by name, rather than letting the attempt fail for a reason that has nothing to do with it.
  const audit = await options.operations.audit(goal);
  const environment = audit.filter(isEnvironmentFinding);
  if (environment.length > 0) {
    return {
      state: "PRECONDITION_FAILED",
      iterations: 0,
      changedFiles: [],
      preExisting: audit,
      reviewFindings: [],
      terminalReason: `workspace precondition failed: ${environment.map((finding) => finding.description).join(" | ").slice(0, 500)}`
    };
  }

  // Pre-existing CODE findings are recorded, not worked. They are the state the goal starts from.
  const preExisting = audit.filter((finding) => !isEnvironmentFinding(finding));

  let changedFiles: string[] = [];
  let verification: EngineeringGoalLoopSummary["verification"];
  let terminalReason = "";
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts = attempt;
    const outcome = await options.operations.implement(goal, goal.objective, attempt);
    if (outcome.error) {
      // An implementer failure is reported as itself. It is never smoothed into a pass, and it is not
      // retried blindly against a different scope.
      //
      // `NO_EDITOR` means nothing was applied at all — the loop never got a change to judge. Once any
      // attempt HAS applied something, the run made progress and is reported as not converged, so a
      // partial result cannot be mistaken for a run that never started.
      const applied = [...new Set([...changedFiles, ...outcome.changedFiles])];
      return {
        state: applied.length === 0 ? "NO_EDITOR" : "NOT_CONVERGED",
        iterations: attempt,
        changedFiles: applied,
        preExisting,
        reviewFindings: [],
        terminalReason: `attempt ${attempt} could not apply a change: ${outcome.error}`
      };
    }

    changedFiles = [...new Set([...changedFiles, ...outcome.changedFiles])];
    verification = { passed: outcome.status === "PASS", checks: outcome.checks };

    if (outcome.changedFiles.length === 0 && outcome.status === "PASS") {
      // The host verified a workspace it did not change. That is a real answer — the goal needed no
      // change — but it is NOT the goal having been implemented, so it says which it is.
      return {
        state: "NOT_CONVERGED",
        iterations: attempt,
        changedFiles,
        preExisting,
        verification,
        reviewFindings: [],
        terminalReason: "the objective produced no change; the goal was not implemented by this run"
      };
    }

    if (outcome.status === "PASS") {
      // VERIFIED. An independent review runs over the applied change before the result is reported,
      // and reviewer findings travel with it rather than being swallowed.
      let reviewFindings: ReviewerFinding[] = [];
      if (options.operations.review && outcome.changedFiles.length > 0) {
        const review = await options.operations.review(goal, outcome.changedFiles, { buildPassed: true, testsPassed: true });
        reviewFindings = review.findings;
      }

      // OBJECTIVE SATISFACTION. The checks passing is not the same claim as the checks establishing what
      // the goal asked for, and Phase 07 exists because that difference was invisible: a green suite over
      // an empty case reached CONVERGED. The judgement is required, so this cannot be skipped by omission.
      const acceptance = await options.operations.acceptance(goal, outcome.changedFiles);
      const converged = acceptance.verdict === "SATISFIED";
      return {
        state: converged
          ? "CONVERGED"
          : acceptance.verdict === "CONTRADICTED"
            ? "OBJECTIVE_CONTRADICTED"
            : "OBJECTIVE_INSUFFICIENT_EVIDENCE",
        iterations: attempt,
        changedFiles: [...changedFiles].sort(),
        preExisting,
        verification,
        acceptance,
        reviewFindings,
        terminalReason: converged
          ? `attempt ${attempt} applied ${outcome.changedFiles.length} file(s); the host's checks passed and the objective is satisfied (${acceptance.reasons[0] ?? "no reason recorded"})`
          : `attempt ${attempt} applied ${outcome.changedFiles.length} file(s) and the host's checks passed, but the objective is ${acceptance.verdict}: ${acceptance.reasons.slice(0, 3).join(" | ")}`
      };
    }

    terminalReason = `attempt ${attempt} applied ${outcome.changedFiles.length} file(s) but the host's checks did not pass`;
  }

  return { state: "NOT_CONVERGED", iterations: attempts, changedFiles, preExisting, ...(verification ? { verification } : {}), reviewFindings: [], terminalReason };
}

/**
 * Build the operations for the goal-driven loop from the pieces the platform already has.
 *
 * `ProposalRunner` is reused rather than reimplemented: it is what makes a change hash-bound and
 * whole-or-nothing, and it is the same code path the repair loop uses. The only new decision here is
 * SCOPE — which files the coder may touch for this goal — and it is derived from the objective's own
 * named paths, the repository snapshot, and an explicit allowance.
 */
export function createGoalLoopOperations(input: {
  workspace: string;
  /** Ask the coder. Receives the proposal contract, returns the coder's reply. */
  coder: (prompt: string) => Promise<string>;
  /** Ask the reviewer. Absent means no independent review is configured. */
  reviewer?: (prompt: string) => Promise<string>;
  /** Files the goal names, relative to the workspace. These are always in scope. */
  namedFiles?: string[];
  /**
   * Paths the caller authorises for this goal.
   *
   * Two forms, and the difference matters:
   *
   *  - a FILE path authorises that file, and only if it already exists;
   *  - a path ending in `/` authorises a PREFIX, which is how a goal that asks for a NEW file is
   *    allowed to create one. A file that does not exist yet cannot appear in the repository snapshot,
   *    so without a prefix there is no way to authorise creating it — a real run failed with
   *    "Change outside authorized scope" for exactly that reason.
   *
   * A prefix is a deliberate grant over a directory, never an inference. It is still bounded by
   * `maxScopeFiles`, and the host's checks still decide whether the result is acceptable.
   */
  allowPaths?: string[];
  /** Hard cap on how many files the coder may be handed. */
  maxScopeFiles?: number;
  /** Audit and verification are the host's, injected so the loop does not invent its own. */
  audit: (goal: EngineeringGoalContract) => Promise<EngineeringFinding[]>;
  /**
   * Override the acceptance model.
   *
   * Optional here because the default is the production one (`judgeGoalAcceptance`); a caller supplying
   * its own is making a deliberate choice rather than leaving the judgement undone.
   */
  acceptance?: (goal: EngineeringGoalContract, changedFiles: string[]) => Promise<SatisfactionResult>;
}): EngineeringGoalLoopOperations {
  const maxScopeFiles = Math.max(1, input.maxScopeFiles ?? 12);

  const normalize = (value: string): string => value.split("\\").join("/").replace(/^\.\//, "");

  /**
   * The authorised file set for this goal.
   *
   * Deliberately conservative. The coder is handed the files the objective NAMES plus anything the
   * caller explicitly allows, capped — never the whole repository, and never a directory it inferred.
   * A goal whose scope cannot be established produces an empty set, and the attempt reports that
   * rather than proposing a change to files nobody authorised.
   */
  const scopeFor = (goal: EngineeringGoalContract): string[] => {
    const snapshot = scanRepo(input.workspace);
    const known = new Set(snapshot.files.map((file) => file.split("\\").join("/")));
    const existing: string[] = [];
    for (const candidate of [...(input.namedFiles ?? []), ...(input.allowPaths ?? [])]) {
      const normalized = normalize(candidate);
      // A prefix grant is not a file. It authorises creations, which the host accepts separately; it
      // contributes nothing to the list of files the coder reads.
      if (normalized.endsWith("/")) continue;
      if (known.has(normalized)) existing.push(normalized);
    }
    const ordered = [...new Set(existing)].sort((a, b) => a.localeCompare(b));
    return ordered.length > maxScopeFiles ? ordered.slice(0, maxScopeFiles) : ordered;
  };

  /**
   * Treat an allowance that names an existing DIRECTORY as a prefix grant.
   *
   * A caller writing `"tests/unit"` means the directory; requiring the trailing slash made that read as
   * a file allowance, authorise nothing creatable, and fail with the same "Change outside authorized
   * scope" a real run already hit twice. The distinction the API draws is still between "this file" and
   * "under here" — it just no longer depends on the caller remembering one character.
   */
  const isPrefixGrant = (value: string): boolean => {
    const clean = normalize(value);
    if (clean.endsWith("/")) return true;
    try {
      return fs.statSync(path.join(input.workspace, clean)).isDirectory();
    } catch {
      return false;
    }
  };

  /**
   * Whether the goal authorises CREATING a file at this path.
   *
   * A new file is authorised only by an explicit prefix grant. It is never added to the scope handed to
   * the coder (that lists files to read), but it IS accepted by the host — otherwise a goal that asks
   * for a new file could never succeed, which is what the first clone run demonstrated.
   */
  const mayCreate = (file: string): boolean => {
    const normalized = normalize(file);
    return (input.allowPaths ?? []).some((prefix) => {
      const clean = normalize(prefix);
      return isPrefixGrant(prefix) && normalized.startsWith(clean) && normalized.length > clean.length;
    });
  };

  const grantsCreation = (): boolean => (input.allowPaths ?? []).some(isPrefixGrant);

  return {
    audit: input.audit,
    // The production acceptance model, unless the caller supplies its own. It is never absent: the loop
    // requires a judgement, so a caller who has a different model must say so rather than inherit silence.
    acceptance: input.acceptance ?? (async (goal, changedFiles) => judgeGoalAcceptance({ objective: goal.objective, changedFiles, workspace: input.workspace })),
    async implement(goal, objective, attempt) {
      const scope = scopeFor(goal);
      // A goal that names only a NEW file has no existing file to hand the coder, but it is still
      // workable when the caller granted a prefix. Demanding an existing file would have made
      // "add this test" impossible.
      if (!scope.length && !grantsCreation()) {
        return { changedFiles: [], status: "FAIL" as const, checks: [], error: `the goal authorises no existing file to change and grants no creatable directory, so there is nothing to propose (attempt ${attempt}); name the target files or grant a prefix allowance` };
      }
      // Checks are selected by the host over what will be judged. When only a new file is authorised,
      // the grant's own directory decides which check applies.
      const checkTargets = scope.length ? scope : [`${normalize((input.allowPaths ?? []).find(isPrefixGrant) ?? "tests/")}probe.test.ts`];
      const checks = engineeringChecksFor(input.workspace, checkTargets);
      if (!checks.length) {
        return { changedFiles: [], status: "FAIL" as const, checks: [], error: `no host check applies to the authorised scope (${checkTargets.join(", ")}), so a change to it could not be judged` };
      }
      try {
        const proposal = await new ProposalRunner(input.coder).run(input.workspace, objective, scope, checks, { mayCreate });
        return {
          changedFiles: proposal.changes.map((change) => change.path),
          status: proposal.status,
          checks: proposal.checks.map((check) => ({ kind: String(check.check.kind ?? "unknown"), passed: check.passed }))
        };
      } catch (error) {
        return { changedFiles: [], status: "FAIL" as const, checks: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    ...(input.reviewer
      ? {
          async review(_goal: EngineeringGoalContract, changedFiles: string[], _evidence: EngineeringReviewEvidence) {
            const answer = await input.reviewer!(`Review the change to ${changedFiles.join(", ")} for correctness and completeness. Report only real defects. Return strict JSON {"findings":[]} when the change is sound.`);
            try {
              const parsed = JSON.parse(answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { findings?: ReviewerFinding[] };
              return { findings: Array.isArray(parsed.findings) ? parsed.findings : [] };
            } catch {
              // An unparseable review yields no findings rather than an invented one, and the raw
              // answer is not promoted to evidence it does not support.
              return { findings: [] };
            }
          }
        }
      : {})
  };
}
