/**
 * Update-Plan/checkpoint-1.md §32 — the checks the *host* can decide by itself.
 *
 * §32 asks for an internal reviewer and an adversarial reviewer. A model may play
 * those roles, but §2.3 forbids the pipeline from depending on a model's opinion:
 * whatever the host can decide from real artifacts, the host must decide itself,
 * and it must say which artifacts it inspected. This module holds those checks.
 *
 * Each check takes observations that the host gathered (a §31.3 ledger, the change
 * unit that was applied, the bounded scope, secret-scan hits, generated-directory
 * classification, theme registry records) and returns §32.3 findings whose
 * evidence points back at those artifacts. Nothing here guesses at code meaning:
 * a check that cannot see the artifact it would need simply does not run, and the
 * corresponding dimension stays unreviewed.
 *
 * Pure: no fs, no clock, no process.
 */
import type { EvidenceKind } from "./requirements-graph";
import { GATE_RANK, type VerificationGate } from "./execution-planner";
import { signalsOf } from "./verification";
import { findingIdOf, type ReviewFinding, type ReviewPlan, type ReviewRecord } from "./review";

export const REVIEW_CHECKS_VERSION = "review-checks-1" as const;

/** True for a path a test belongs in (used to judge what a worker could repair). */
export function isTestPath(file: string): boolean {
  return /(^|\/)(tests?|__tests__)\//i.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file);
}

/** What the host observed about one requirement after verification. */
export interface RequirementObservation {
  id: string;
  type: string;
  text: string;
  /** True when the work claims this requirement is satisfied. */
  claims_complete: boolean;
  passed_gates: VerificationGate[];
  failed_gates: VerificationGate[];
  /** §31.3 ledger rows for this requirement. */
  evidence_ids: string[];
  /**
   * §31.2: the rungs this requirement's own wording and type demand. A rung here
   * that never passed means the requirement is unproven even when cheaper,
   * repository-wide gates (syntax, typecheck) passed for the whole workspace.
   */
  demanded_gates?: VerificationGate[];
  /**
   * Proof-bearing rungs the requirement demands that this host cannot climb at
   * all (no harness). A requirement needing a restart smoke cannot be claimed
   * complete on a host without one.
   */
  unavailable_gates?: VerificationGate[];
  /** §28.4 kinds this requirement still owes. */
  missing_evidence?: EvidenceKind[];
}

export interface ThemeObservation {
  id: string;
  active: boolean;
  /** ERROR-severity §20 diagnostics on the stored package. */
  error_diagnostics: number;
  /** Provenance pointer to another theme, if the package records one. */
  based_on?: string;
  /** False when the package carries no tokens of its own. */
  tokens_materialized: boolean;
  /** False when the registered package is no longer on disk. */
  package_present: boolean;
}

/**
 * Everything the host reviewer may look at. A field left `undefined` means the
 * host did not inspect that artifact — and then the matching probe is *not*
 * reviewed, rather than silently passing.
 */
export interface ReviewObservation {
  requirements: RequirementObservation[];
  scope: { allowed_files: string[]; requirement_ids: string[]; workspace: string };
  /** Files the change unit actually wrote. */
  changed_files: string[];
  /** Subset of `changed_files` that are test files. */
  changed_test_files: string[];
  /** Files that did not exist before this change. */
  new_files?: string[];
  /** Change units the host refused before writing anything. */
  refused_units?: { problems: string[] }[];
  /** Claims the host could not confirm against git/disk. */
  unconfirmed_claims?: { path: string; problem: string }[];
  /** Files whose content tripped the secret scanner, with the shapes found. */
  secret_hits?: { path: string; shapes: string[] }[];
  /** Changed files that live inside a generated directory. */
  generated_file_hits?: string[];
  /** Theme packages this change touched. */
  themes?: ThemeObservation[];
  /** Where the §31.3 ledger lives, cited when a finding owns no row. */
  ledger_path?: string;
}

function make(
  layer: ReviewFinding["layer"],
  subject: string,
  severity: ReviewFinding["severity"],
  statement: string,
  evidence: ReviewFinding["evidence"],
  raisedAt: string
): ReviewFinding {
  return {
    id: findingIdOf({ layer, subject, severity, statement }),
    layer,
    subject,
    severity,
    statement,
    evidence,
    host_decided: true,
    state: "OPEN",
    raised_at: raisedAt
  };
}

/**
 * §32.2 probes and §32.1 dimensions the host can decide.
 *
 * Ordering is stable (probe order, then dimension order) so two runs over the
 * same observation produce the same findings.
 */
export function reviewFindings(observation: ReviewObservation, raisedAt = new Date(0).toISOString()): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const ledgerPointer = observation.ledger_path;

  // --- §32.2 UNVERIFIED_COMPLETION -------------------------------------
  for (const requirement of observation.requirements) {
    if (!requirement.claims_complete) continue;
    if (requirement.passed_gates.length === 0) {
      findings.push(make("ADVERSARIAL_REVIEWER", "UNVERIFIED_COMPLETION", "HIGH",
        `${requirement.id} is claimed complete but no gate ever passed for it`,
        {
          requirement_ids: [requirement.id],
          ...(requirement.evidence_ids.length ? { ledger_entry_ids: requirement.evidence_ids } : {}),
          ...(ledgerPointer ? { reference: ledgerPointer } : {})
        }, raisedAt));
      continue;
    }
    // A rung above the cheap repository-wide baseline that this requirement's own
    // wording demands, and that never passed, leaves the requirement unproven:
    // a workspace-wide typecheck is not evidence that a restart survives.
    const unproven = (requirement.demanded_gates ?? [])
      .filter((gate) => GATE_RANK[gate] > GATE_RANK.UNIT && !requirement.passed_gates.includes(gate));
    const unclimbable = (requirement.unavailable_gates ?? []).filter((gate) => GATE_RANK[gate] > GATE_RANK.UNIT);
    if (unproven.length || unclimbable.length) {
      const detail = unclimbable.length
        ? `the host cannot climb ${unclimbable.join(", ")} and the requirement demands it`
        : `the rung(s) it demands never passed: ${unproven.join(", ")}`;
      findings.push(make("ADVERSARIAL_REVIEWER", "UNVERIFIED_COMPLETION", "HIGH",
        `${requirement.id} is claimed complete but ${detail}`,
        {
          requirement_ids: [requirement.id],
          ...(requirement.evidence_ids.length ? { ledger_entry_ids: requirement.evidence_ids } : {}),
          ...(unproven.length ? { gate: unproven[0]! } : {}),
          ...(ledgerPointer ? { reference: ledgerPointer } : {})
        }, raisedAt));
      continue;
    }
    if ((requirement.missing_evidence ?? []).length) {
      findings.push(make("INTERNAL_REVIEWER", "correctness", "MEDIUM",
        `${requirement.id} is claimed complete but still owes ${(requirement.missing_evidence ?? []).join(", ")} evidence`,
        { requirement_ids: [requirement.id], ...(requirement.evidence_ids.length ? { ledger_entry_ids: requirement.evidence_ids } : {}) }, raisedAt));
    }
  }

  // --- §32.1 correctness: a failed gate cannot be reported as done ------
  for (const requirement of observation.requirements) {
    if (!requirement.failed_gates.length) continue;
    for (const gate of requirement.failed_gates) {
      findings.push(make("INTERNAL_REVIEWER", "correctness", requirement.claims_complete ? "HIGH" : "MEDIUM",
        `${requirement.id} failed the ${gate} gate`,
        { requirement_ids: [requirement.id], gate, ...(requirement.evidence_ids.length ? { ledger_entry_ids: requirement.evidence_ids } : {}) }, raisedAt));
    }
  }

  // --- §32.2 PARTIAL_STATE: a failed verification left the change on disk
  const failedSomewhere = observation.requirements.flatMap((requirement) => requirement.failed_gates.map((gate) => ({ requirement, gate })));
  if (failedSomewhere.length && observation.changed_files.length) {
    const { requirement, gate } = failedSomewhere[0]!;
    findings.push(make("ADVERSARIAL_REVIEWER", "PARTIAL_STATE", "HIGH",
      `verification failed at ${gate} while ${observation.changed_files.length} file(s) from this change are still on disk`,
      { requirement_ids: [requirement.id], files: observation.changed_files, gate }, raisedAt));
  }

  // --- §32.2 SILENT_FALLBACK: recovery claimed, no fault-injection rung --
  for (const requirement of observation.requirements) {
    if (!requirement.claims_complete) continue;
    const signals = signalsOf(requirement.text);
    if (!signals.includes("recovery") && !signals.includes("persistence")) continue;
    const proven = requirement.passed_gates.some((gate) => gate === "INTEGRATION" || gate === "RUNTIME" || gate === "BLACKBOX");
    if (!proven) {
      findings.push(make("ADVERSARIAL_REVIEWER", "SILENT_FALLBACK", "MEDIUM",
        `${requirement.id} claims ${signals.includes("persistence") ? "persistence" : "failure recovery"} but no restart/fault-injection rung passed`,
        { requirement_ids: [requirement.id], ...(requirement.evidence_ids.length ? { ledger_entry_ids: requirement.evidence_ids } : {}) }, raisedAt));
    }
  }

  // --- §32.1 scope: the change stayed inside the grant ------------------
  const outOfScope = observation.changed_files.filter((file) => !observation.scope.allowed_files.includes(file));
  if (outOfScope.length) {
    findings.push(make("INTERNAL_REVIEWER", "scope", "HIGH",
      `${outOfScope.length} written file(s) are outside the worker's granted scope`,
      { files: outOfScope, requirement_ids: observation.scope.requirement_ids }, raisedAt));
  }
  for (const refused of observation.refused_units ?? []) {
    if (!refused.problems.length) continue;
    findings.push(make("INTERNAL_REVIEWER", "scope", "MEDIUM",
      `a change unit was refused before it was applied: ${refused.problems[0]}`,
      { files: observation.scope.allowed_files, requirement_ids: observation.scope.requirement_ids, reference: refused.problems.join("; ").slice(0, 200) }, raisedAt));
  }

  // --- §32.2 UNVERIFIED_COMPLETION: a claim git/disk did not confirm ----
  for (const claim of observation.unconfirmed_claims ?? []) {
    findings.push(make("ADVERSARIAL_REVIEWER", "UNVERIFIED_COMPLETION", "HIGH",
      `the worker claimed ${claim.path} but the host could not confirm it`,
      { files: [claim.path], reference: claim.problem }, raisedAt));
  }

  // --- §32.1 test_coverage: behaviour changed without a test change -----
  // A finding may only block when the repair is inside the worker's authority:
  // if the grant contains no test path, the worker cannot answer it, so the
  // observation is recorded as LOW (the plan's scope is what needs widening).
  const sourceChanges = observation.changed_files.filter((file) => !observation.changed_test_files.includes(file));
  if (sourceChanges.length && observation.changed_test_files.length === 0) {
    const demanding = observation.requirements.filter((requirement) => requirement.claims_complete && requirement.passed_gates.includes("UNIT"));
    const canWriteTests = observation.scope.allowed_files.some((file) => isTestPath(file));
    if (demanding.length && canWriteTests) {
      findings.push(make("INTERNAL_REVIEWER", "test_coverage", "MEDIUM",
        "a behaviour change passed the test rung without any test file changing",
        { files: sourceChanges, gate: "UNIT", requirement_ids: demanding.map((requirement) => requirement.id) }, raisedAt));
    } else if (demanding.length) {
      findings.push(make("INTERNAL_REVIEWER", "test_coverage", "LOW",
        "the change passed the test rung without a test change, and the granted scope contains no test path, so the worker cannot answer it",
        { files: sourceChanges, gate: "UNIT", requirement_ids: demanding.map((requirement) => requirement.id) }, raisedAt));
    }
  }

  // --- §32.2 SECRET_EXPOSURE -------------------------------------------
  for (const hit of observation.secret_hits ?? []) {
    findings.push(make("ADVERSARIAL_REVIEWER", "SECRET_EXPOSURE", "HIGH",
      `${hit.path} contains credential-shaped content (${hit.shapes.join(", ")})`,
      { files: [hit.path], reference: hit.shapes.join(", ") }, raisedAt));
  }

  // --- §32.1 architecture: generated artifacts edited by hand -----------
  for (const file of observation.generated_file_hits ?? []) {
    findings.push(make("INTERNAL_REVIEWER", "architecture", "MEDIUM",
      `${file} is a generated artifact and was edited directly`,
      { files: [file] }, raisedAt));
  }

  // --- §32.1 maintainability: new files no requirement links ------------
  for (const file of observation.new_files ?? []) {
    if (observation.changed_test_files.includes(file)) continue;
    const linked = observation.requirements.some((requirement) => requirement.text.toLocaleLowerCase().includes(file.toLocaleLowerCase()))
      || observation.scope.allowed_files.includes(file);
    if (!linked) {
      findings.push(make("INTERNAL_REVIEWER", "maintainability", "LOW",
        `${file} is a new file that no requirement or scope links to the work`,
        { files: [file] }, raisedAt));
    }
  }

  // --- §32.2 theme probes ----------------------------------------------
  for (const theme of observation.themes ?? []) {
    if (theme.active && theme.error_diagnostics > 0) {
      findings.push(make("ADVERSARIAL_REVIEWER", "THEME_RENDERER_CRASH", "HIGH",
        `active theme ${theme.id} carries ${theme.error_diagnostics} validation error(s)`,
        { reference: theme.id }, raisedAt));
    }
    if (!theme.package_present) {
      findings.push(make("ADVERSARIAL_REVIEWER", "THEME_REGISTRY_CORRUPTION", "HIGH",
        `theme ${theme.id} is in the registry but its package is missing from disk`,
        { reference: theme.id }, raisedAt));
    }
    if (theme.based_on && !theme.tokens_materialized) {
      findings.push(make("ADVERSARIAL_REVIEWER", "CROSS_THEME_DEPENDENCY", "MEDIUM",
        `theme ${theme.id} derives from ${theme.based_on} without materializing its own tokens`,
        { reference: `${theme.id} <- ${theme.based_on}` }, raisedAt));
    }
  }

  return findings;
}

/**
 * What the host reviewer may honestly report as inspected.
 *
 * A record exists only for a subject whose artifact was actually supplied: no
 * `secret_hits` field means the reviewer did not look for secret exposure, and
 * the §2.3 rule then leaves that probe `NOT_RUN` instead of treating the silence
 * as clearance. Dimensions such as `maintainability` only appear as reviewed for
 * the artifacts they name, which is why a change can still be INCOMPLETE after
 * every host check ran clean.
 */
export function hostReviewRecords(observation: ReviewObservation, plan: Pick<ReviewPlan, "probes">): ReviewRecord[] {
  const records: ReviewRecord[] = [];
  const internal = new Set(["scope", "correctness", "test_coverage", "architecture", "maintainability"]);
  const record = (subject: string, inspected: string[]): void => {
    records.push({
      layer: internal.has(subject) ? "INTERNAL_REVIEWER" : "ADVERSARIAL_REVIEWER",
      subject,
      inspected,
      findings: findings.filter((finding) => finding.subject === subject).map((finding) => finding.id)
    });
  };
  const findings = reviewFindings(observation);
  const persistenceClaimed = observation.requirements.some((requirement) => signalsOf(requirement.text).includes("persistence"));

  if (observation.changed_files.length || observation.scope.allowed_files.length) {
    record("scope", ["change unit paths", "granted scope", "refused change units"]);
  }
  if (observation.requirements.length) {
    record("correctness", ["§31.3 ledger rows", "gate results per requirement"]);
  }
  if (observation.changed_files.length) {
    record("test_coverage", ["changed files", "changed test files", "UNIT gate result"]);
  }
  if (observation.generated_file_hits !== undefined) {
    record("architecture", ["generated-directory classification of the changed files"]);
  }
  if (observation.new_files !== undefined) {
    record("maintainability", ["new files in the change unit", "requirement texts"]);
  }
  // Adversarial probes the host can actually answer, and only when the artifact
  // it needs was supplied. RACE, HIDDEN_FAILURE, SECURITY and FALSE_POSITIVE_TEST
  // are deliberately absent: they need a reader of the code, so they stay NOT_RUN
  // unless a reviewer layer supplies its own evidence-bearing record.
  for (const probe of plan.probes) {
    if (probe === "UNVERIFIED_COMPLETION" && observation.requirements.length) record(probe, ["§31.3 ledger rows", "per-requirement gate results"]);
    else if (probe === "PARTIAL_STATE" && observation.changed_files.length) record(probe, ["applied change unit", "failed gate rows"]);
    else if (probe === "SILENT_FALLBACK" && observation.requirements.length) record(probe, ["requirement wording", "passed rungs"]);
    else if (probe === "RESTART_ISSUE" && persistenceClaimed) record(probe, ["requirement wording", "runtime/restart rung results"]);
    else if (probe === "SECRET_EXPOSURE" && observation.secret_hits !== undefined) record(probe, ["secret scan of every written file"]);
    else if (probe === "THEME_RENDERER_CRASH" && observation.themes !== undefined) record(probe, ["stored theme validation reports"]);
    else if (probe === "THEME_REGISTRY_CORRUPTION" && observation.themes !== undefined) record(probe, ["theme registry entries", "package presence on disk"]);
    else if (probe === "CROSS_THEME_DEPENDENCY" && observation.themes !== undefined) record(probe, ["theme provenance and token materialization"]);
  }
  return records;
}
