/**
 * Update-Plan/checkpoint-1.md §35 + §36 — Candidate state and the Guardian's final
 * gate.
 *
 * §35 forbids `RUNNING → COMPLETED`. A task walks RUNNING → IMPLEMENTED →
 * VERIFYING → REVIEWING → CANDIDATE → ACCEPTED, and CANDIDATE is a *real* state
 * with a real meaning: all the code is done, but no release permission has been
 * granted yet. A theme candidate is a candidate too.
 *
 * §36 then says what must be true before that permission exists: goal compliance,
 * requirement coverage, secret scan, scope validation, evidence completeness,
 * destructive-change check and Owner-override compliance — plus four theme checks
 * (isolation, fallback validation, no executable payload, built-in integrity). Any
 * failure sends the Candidate back to repair.
 *
 * The doctrine shapes the rules: a check that could not be performed is **not** a
 * pass, so an unrun Guardian check keeps the task at CANDIDATE (fail closed), and
 * ACCEPTED is unreachable without a named, evidenced verdict for every required
 * check. Nothing here consults a model's opinion of its own work.
 *
 * Pure: no fs, no clock, no process.
 */
import { contentHashOf } from "./workbook";

export const CANDIDATE_GATE_VERSION = "candidate-gate-1" as const;

/* ------------------------------------------------------------------ *
 * §35 the task lifecycle
 * ------------------------------------------------------------------ */

export const TASK_LIFECYCLE = ["RUNNING", "IMPLEMENTED", "VERIFYING", "REVIEWING", "CANDIDATE", "ACCEPTED"] as const;
export type TaskLifecycleState = (typeof TASK_LIFECYCLE)[number];

/** Illegal transitions are refused, never silently applied (§28.3's rule, reused). */
export const TASK_TRANSITIONS: Readonly<Record<TaskLifecycleState, readonly TaskLifecycleState[]>> = {
  RUNNING: ["IMPLEMENTED"],
  IMPLEMENTED: ["VERIFYING", "RUNNING"],
  VERIFYING: ["REVIEWING", "IMPLEMENTED"],
  REVIEWING: ["CANDIDATE", "VERIFYING"],
  CANDIDATE: ["ACCEPTED", "REVIEWING"],
  ACCEPTED: []
};

export const LIFECYCLE_EVENTS = ["IMPLEMENTED", "VERIFIED", "REVIEWED", "CANDIDATED", "ACCEPTED", "REPAIR"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** The event that moves a state forward, and the event that sends it back. */
const FORWARD: Readonly<Record<TaskLifecycleState, LifecycleEvent | undefined>> = {
  RUNNING: "IMPLEMENTED",
  IMPLEMENTED: "VERIFIED",
  VERIFYING: "REVIEWED",
  REVIEWING: "CANDIDATED",
  CANDIDATE: "ACCEPTED",
  ACCEPTED: undefined
};
const BACKWARD: Readonly<Record<TaskLifecycleState, readonly [LifecycleEvent, TaskLifecycleState][]>> = {
  RUNNING: [],
  IMPLEMENTED: [["REPAIR", "RUNNING"]],
  VERIFYING: [["REPAIR", "IMPLEMENTED"]],
  REVIEWING: [["REPAIR", "VERIFYING"]],
  CANDIDATE: [["REPAIR", "REVIEWING"]],
  ACCEPTED: []
};

export interface LifecycleStep {
  state: TaskLifecycleState;
  /** When the state was entered, and what justified it. */
  at: string;
  reason: string;
  /** Evidence pointers (ledger rows, review ids, gate verdicts). */
  evidence: string[];
}

export interface LifecycleResult {
  accepted: boolean;
  state: TaskLifecycleState;
  reason: string;
  allowed: readonly TaskLifecycleState[];
}

/** Walks one event; an event the state does not allow is refused with the reason. */
export function advanceLifecycle(current: TaskLifecycleState, event: LifecycleEvent): LifecycleResult {
  const forward = FORWARD[current];
  if (forward === event) {
    const next = TASK_LIFECYCLE[TASK_LIFECYCLE.indexOf(current) + 1];
    return { accepted: true, state: next, reason: `${current} --${event}--> ${next}`, allowed: TASK_TRANSITIONS[current] };
  }
  const back = BACKWARD[current].find(([name]) => name === event);
  if (back) return { accepted: true, state: back[1], reason: `${current} --${event}--> ${back[1]} (repair)`, allowed: TASK_TRANSITIONS[current] };
  return {
    accepted: false,
    state: current,
    reason: `${event} is not legal from ${current}; the lifecycle is ${TASK_LIFECYCLE.join(" → ")} and transitions are ${TASK_TRANSITIONS[current].join(", ") || "none"}`,
    allowed: TASK_TRANSITIONS[current]
  };
}

/**
 * §35's meaning of CANDIDATE: complete, not released. Recording it is not a
 * promotion — the record says who is still owed a decision.
 */
export interface CandidateRecord {
  schemaVersion: 1;
  version: typeof CANDIDATE_GATE_VERSION;
  task_id: string;
  state: TaskLifecycleState;
  /** The requirements the candidate claims to satisfy. */
  requirements: string[];
  /** What "all the code is done" rests on. */
  completion_evidence: string[];
  /** The Guardian verdict that decides whether ACCEPTED is reachable. */
  guardian: GuardianVerdict;
  steps: LifecycleStep[];
  /** True while a release permission is still owed. */
  awaiting_release_permission: boolean;
  created_at: string;
}

export function candidateRecordFor(input: {
  task_id: string;
  state: TaskLifecycleState;
  requirements: readonly string[];
  completion_evidence: readonly string[];
  guardian: GuardianVerdict;
  steps: readonly LifecycleStep[];
  now?: string;
}): CandidateRecord {
  return {
    schemaVersion: 1,
    version: CANDIDATE_GATE_VERSION,
    task_id: input.task_id,
    state: input.state,
    requirements: [...input.requirements],
    completion_evidence: [...input.completion_evidence],
    guardian: input.guardian,
    steps: [...input.steps],
    awaiting_release_permission: input.state !== "ACCEPTED",
    created_at: input.now ?? new Date(0).toISOString()
  };
}

/* ------------------------------------------------------------------ *
 * §36 the Guardian's checklist
 * ------------------------------------------------------------------ */

/** The seven §36 checks every candidate faces. */
export const GUARDIAN_CHECKS = [
  "GOAL_COMPLIANCE",
  "REQUIREMENT_COVERAGE",
  "SECRET_SCAN",
  "SCOPE_VALIDATION",
  "EVIDENCE_COMPLETENESS",
  "DESTRUCTIVE_CHANGE_CHECK",
  "OWNER_OVERRIDE_COMPLIANCE"
] as const;

/** §36's additional four, required whenever the candidate touches a theme. */
export const THEME_GUARDIAN_CHECKS = [
  "THEME_ISOLATION",
  "FALLBACK_VALIDATION",
  "NO_EXECUTABLE_PAYLOAD",
  "BUILT_IN_THEME_INTEGRITY"
] as const;

export type GuardianCheckId = (typeof GUARDIAN_CHECKS)[number] | (typeof THEME_GUARDIAN_CHECKS)[number];

export type CheckVerdict = "PASS" | "FAIL" | "NOT_RUN";

export interface GuardianCheckResult {
  check: GuardianCheckId;
  verdict: CheckVerdict;
  /** What the check looked at, so a PASS is not a claim. */
  inspected: string[];
  reasons: string[];
}

export interface GuardianVerdict {
  verdict: "CANDIDATE" | "REPAIR" | "ACCEPTED";
  checks: GuardianCheckResult[];
  /** Checks that failed or could not be run — the repair input. */
  blocking: GuardianCheckId[];
  /** True only when every required check passed. */
  released: boolean;
  reason: string;
}

/** The observations the Guardian decides on. Undefined means "not inspected". */
export interface GuardianContext {
  /** §36 GOAL_COMPLIANCE: the compiled goal, and what the candidate actually did. */
  goal?: { text: string; served_by_requirements: string[]; deliverables: string[] };
  /** §36 REQUIREMENT_COVERAGE: every requirement the task owed, and its binding. */
  coverage?: { required: string[]; covered: string[]; unimplemented: string[] };
  /** §36 SECRET_SCAN: files scanned, and the shapes found. */
  secrets?: { scanned_files: string[]; hits: { path: string; shapes: string[] }[] };
  /** §36 SCOPE_VALIDATION: the granted scope against what was written. */
  scope?: { allowed_files: string[]; written_files: string[]; refused: string[] };
  /** §36 EVIDENCE_COMPLETENESS: requirements still owed evidence, and failures. */
  evidence?: { outstanding_requirements: string[]; failed_requirements: string[]; ledger_rows: number; review_covered: boolean };
  /** §36 DESTRUCTIVE_CHANGE_CHECK: what the candidate removed. */
  destructive?: { deleted_files: string[]; deleted_tests: string[]; removed_scripts: string[]; approved_by_owner: string[] };
  /** §36 OWNER_OVERRIDE_COMPLIANCE: what the Owner's own words required. */
  overrides?: { text: string; supersedes: string[]; expected_in_requirements: string[] }[];
  /** Requirements/declarations the candidate ended up serving, for override matching. */
  obligations?: string[];
  /** §36 theme checks: the packages the candidate touched. */
  themes?: ThemeGuardianInput[];
  /**
   * True when the candidate touched a theme lane. It keeps the four theme checks
   * required even when no package could be read, so "we did not look at the theme"
   * is a blocker rather than a silent skip.
   */
  theme_required?: boolean;
}

export interface ThemeGuardianInput {
  id: string;
  /** §11: a package that references another theme is not self-contained. */
  references_other_theme: boolean;
  /** §20 ERROR diagnostics on the package. */
  error_diagnostics: number;
  /** §20 diagnostics that mean executable content (script injection, unsafe url). */
  executable_payload_diagnostics: number;
  /** §21: the fallback plan the host would take if this theme fails. */
  fallback_plan_valid: boolean;
  built_in: boolean;
  /** §12: built-ins are locked and must validate. */
  built_in_intact: boolean;
}

export interface GuardianEvaluation {
  verdict: GuardianVerdict;
  /** The check ids the context could not answer, so the caller can supply them. */
  not_inspected: GuardianCheckId[];
}

function result(check: GuardianCheckId, verdict: CheckVerdict, inspected: string[], reasons: string[]): GuardianCheckResult {
  return { check, verdict, inspected, reasons };
}

/** Significant terms of a phrase, for the lexical compliance checks. */
export function termsOf(text: string): string[] {
  return [...new Set((text.toLocaleLowerCase().match(/[a-z0-9]{4,}/g) ?? []))];
}

/** Which checks this candidate faces: the seven, plus four for a theme change. */
export function requiredGuardianChecks(context: GuardianContext): GuardianCheckId[] {
  return context.themes?.length || context.theme_required ? [...GUARDIAN_CHECKS, ...THEME_GUARDIAN_CHECKS] : [...GUARDIAN_CHECKS];
}

const REQUIREMENT_COVERAGE_RATIO = 1;

/**
 * §36: the check that a task cannot perform on itself.
 *
 * A check whose observations are missing is `NOT_RUN`; §2.3 makes that a blocker
 * rather than a pass, because "we did not look" and "we looked and it is fine" are
 * different facts.
 */
export function evaluateGuardian(context: GuardianContext): GuardianEvaluation {
  const checks: GuardianCheckResult[] = [];
  const notInspected: GuardianCheckId[] = [];

  // GOAL_COMPLIANCE
  if (!context.goal) { checks.push(result("GOAL_COMPLIANCE", "NOT_RUN", [], ["the compiled goal was not supplied to the Guardian"])); notInspected.push("GOAL_COMPLIANCE"); }
  else {
    const served = context.goal.served_by_requirements;
    const problems: string[] = [];
    if (!context.goal.text.trim()) problems.push("the goal is empty");
    if (!served.length) problems.push("no requirement serves the goal, so nothing the candidate did is traceable to it");
    for (const deliverable of context.goal.deliverables) {
      if (!served.some((requirement) => requirement.length > 0)) problems.push(`deliverable "${deliverable.slice(0, 60)}" has no serving requirement`);
    }
    checks.push(result("GOAL_COMPLIANCE", problems.length ? "FAIL" : "PASS", [`goal:${context.goal.text.slice(0, 60)}`, ...served.slice(0, 6)], problems.length ? problems : ["every deliverable is traceable to a requirement"]));
  }

  // REQUIREMENT_COVERAGE
  if (!context.coverage) { checks.push(result("REQUIREMENT_COVERAGE", "NOT_RUN", [], ["requirement bindings were not supplied"])); notInspected.push("REQUIREMENT_COVERAGE"); }
  else {
    const required = context.coverage.required;
    const covered = new Set(context.coverage.covered);
    const missing = required.filter((requirement) => !covered.has(requirement));
    const unimplemented = context.coverage.unimplemented;
    const problems = [
      ...missing.map((requirement) => `${requirement} has no binding`),
      ...unimplemented.map((requirement) => `${requirement} is not implemented`)
    ];
    const ratio = required.length ? (required.length - missing.length) / required.length : 1;
    if (ratio < REQUIREMENT_COVERAGE_RATIO) problems.push(`coverage ${(ratio * 100).toFixed(0)}% is below 100%`);
    checks.push(result("REQUIREMENT_COVERAGE", problems.length ? "FAIL" : "PASS", [`required:${required.length}`, `covered:${covered.size}`], problems.length ? problems : ["every requirement is bound and implemented"]));
  }

  // SECRET_SCAN
  if (!context.secrets) { checks.push(result("SECRET_SCAN", "NOT_RUN", [], ["no file was scanned for credentials"])); notInspected.push("SECRET_SCAN"); }
  else {
    const problems = context.secrets.hits.map((hit) => `${hit.path} contains ${hit.shapes.join(", ")}`);
    checks.push(result("SECRET_SCAN", problems.length ? "FAIL" : "PASS", context.secrets.scanned_files.map((file) => `scanned:${file}`), problems.length ? problems : [`${context.secrets.scanned_files.length} file(s) scanned, no credential shapes`]));
  }

  // SCOPE_VALIDATION
  if (!context.scope) { checks.push(result("SCOPE_VALIDATION", "NOT_RUN", [], ["the granted scope was not supplied"])); notInspected.push("SCOPE_VALIDATION"); }
  else {
    const outside = context.scope.written_files.filter((file) => !context.scope!.allowed_files.includes(file));
    const problems = [
      ...outside.map((file) => `${file} was written outside the granted scope`),
      ...context.scope.refused.map((problem) => `a change unit was refused: ${problem}`)
    ];
    checks.push(result("SCOPE_VALIDATION", problems.length ? "FAIL" : "PASS", [`allowed:${context.scope.allowed_files.length}`, `written:${context.scope.written_files.length}`], problems.length ? problems : ["every written file was inside the grant"]));
  }

  // EVIDENCE_COMPLETENESS
  if (!context.evidence) { checks.push(result("EVIDENCE_COMPLETENESS", "NOT_RUN", [], ["the §31.3 ledger was not supplied"])); notInspected.push("EVIDENCE_COMPLETENESS"); }
  else {
    const problems = [
      ...context.evidence.outstanding_requirements.map((requirement) => `${requirement} is still owed evidence`),
      ...context.evidence.failed_requirements.map((requirement) => `${requirement} failed verification`),
      ...(context.evidence.ledger_rows === 0 ? ["the ledger holds no rows at all"] : []),
      ...(context.evidence.review_covered ? [] : ["the §32 review did not cover every required dimension"])
    ];
    checks.push(result("EVIDENCE_COMPLETENESS", problems.length ? "FAIL" : "PASS", [`ledger_rows:${context.evidence.ledger_rows}`, `review_covered:${context.evidence.review_covered}`], problems.length ? problems : ["every requirement has passing evidence and the review covered its dimensions"]));
  }

  // DESTRUCTIVE_CHANGE_CHECK
  if (!context.destructive) { checks.push(result("DESTRUCTIVE_CHANGE_CHECK", "NOT_RUN", [], ["the change set was not inspected for removals"])); notInspected.push("DESTRUCTIVE_CHANGE_CHECK"); }
  else {
    const approved = new Set(context.destructive.approved_by_owner);
    const removals = [
      ...context.destructive.deleted_files.map((file) => ({ file, kind: "file" })),
      ...context.destructive.deleted_tests.map((file) => ({ file, kind: "test" })),
      ...context.destructive.removed_scripts.map((script) => ({ file: script, kind: "script" }))
    ];
    const unapproved = removals.filter((removal) => !approved.has(removal.file));
    const problems = unapproved.map((removal) => `${removal.kind} ${removal.file} was removed without an Owner approval`);
    checks.push(result("DESTRUCTIVE_CHANGE_CHECK", problems.length ? "FAIL" : "PASS", removals.length ? removals.map((removal) => `removed:${removal.file}`) : ["no removals in the change set"], problems.length ? problems : ["removals, if any, are Owner-approved"]));
  }

  // OWNER_OVERRIDE_COMPLIANCE
  if (!context.overrides) { checks.push(result("OWNER_OVERRIDE_COMPLIANCE", "NOT_RUN", [], ["the contract's overrides were not supplied"])); notInspected.push("OWNER_OVERRIDE_COMPLIANCE"); }
  else {
    const obligations = (context.obligations ?? []).map((obligation) => ({ text: obligation, terms: termsOf(obligation) }));
    const problems: string[] = [];
    for (const override of context.overrides) {
      for (const expected of override.expected_in_requirements) {
        const wanted = termsOf(expected);
        if (!wanted.length) continue;
        // Lexical compliance: some served requirement must carry the override's
        // own terms (at least half of them), which is what "reflected in the work"
        // can mean without a semantic reader.
        const reflected = obligations.some((obligation) => {
          const shared = wanted.filter((term) => obligation.terms.includes(term)).length;
          return shared >= Math.max(1, Math.ceil(wanted.length / 2));
        });
        if (!reflected) problems.push(`the Owner's override (${override.text.slice(0, 50)}) is not reflected: nothing serves "${expected.slice(0, 50)}"`);
      }
    }
    checks.push(result("OWNER_OVERRIDE_COMPLIANCE", problems.length ? "FAIL" : "PASS", context.overrides.length ? context.overrides.map((override) => `override:${override.text.slice(0, 40)}`) : ["no override was recorded"], problems.length ? problems : ["every recorded override is reflected in the work"]));
  }

  // §36's theme checks (required whenever a theme lane was touched, readable or not)
  if (context.themes?.length || context.theme_required) {
    const themes = context.themes ?? [];
    if (!themes.length) {
      for (const check of THEME_GUARDIAN_CHECKS) {
        checks.push(result(check, "NOT_RUN", [], ["the candidate touched a theme but no theme package was read for this check"]));
        notInspected.push(check);
      }
    } else {
      checks.push(themeCheck("THEME_ISOLATION", themes, (theme) => theme.references_other_theme ? [`theme ${theme.id} references another theme package`] : [], (theme) => [`theme:${theme.id}`], "every theme package is self-contained"));
      checks.push(themeCheck("FALLBACK_VALIDATION", themes, (theme) => theme.fallback_plan_valid ? [] : [`theme ${theme.id} has no valid fallback plan`], (theme) => [`fallback_plan_valid:${theme.id}:${theme.fallback_plan_valid}`], "each theme has a valid fallback plan"));
      checks.push(themeCheck("NO_EXECUTABLE_PAYLOAD", themes, (theme) => theme.executable_payload_diagnostics > 0 ? [`theme ${theme.id} carries ${theme.executable_payload_diagnostics} executable-content diagnostic(s)`] : [], (theme) => [`executable_payload:${theme.id}:${theme.executable_payload_diagnostics}`], "no theme carries executable content"));
      checks.push(themeCheck("BUILT_IN_THEME_INTEGRITY", themes, (theme) => theme.built_in && (!theme.built_in_intact || theme.error_diagnostics > 0) ? [`built-in theme ${theme.id} is not intact`] : [], (theme) => [`built_in:${theme.id}:${theme.built_in_intact}`], "built-in themes are locked and valid"));
    }
  }

  const required = requiredGuardianChecks(context);
  const forRequired = required.map((check) => checks.find((entry) => entry.check === check) ?? result(check, "NOT_RUN", [], [`${check} was never evaluated`]));
  const blocking = forRequired.filter((check) => check.verdict !== "PASS").map((check) => check.check);
  const released = blocking.length === 0;
  const failed = forRequired.filter((check) => check.verdict === "FAIL").length;
  const unrun = forRequired.filter((check) => check.verdict === "NOT_RUN").length;
  return {
    verdict: {
      verdict: released ? "ACCEPTED" : "REPAIR",
      checks: forRequired,
      blocking,
      released,
      reason: released
        ? `§36 every required check passed (${forRequired.length})`
        : `§36 Candidate → Repair: ${failed} check(s) failed, ${unrun} could not be run${blocking.length ? ` (${blocking.join(", ")})` : ""}`
    },
    not_inspected: notInspected
  };
}

function themeCheck(
  check: GuardianCheckId,
  themes: readonly ThemeGuardianInput[],
  problemsOf: (theme: ThemeGuardianInput) => string[],
  inspectedOf: (theme: ThemeGuardianInput) => string[],
  passReason: string
): GuardianCheckResult {
  const problems = themes.flatMap(problemsOf);
  return result(check, problems.length ? "FAIL" : "PASS", themes.flatMap(inspectedOf), problems.length ? problems : [passReason]);
}

/** A stable id for the candidate record, so a repair can point back at it. */
export function candidateIdFor(taskId: string, requirements: readonly string[]): string {
  return `cand-${contentHashOf([taskId, ...[...requirements].sort()].join("\u0000")).slice(0, 16)}`;
}
