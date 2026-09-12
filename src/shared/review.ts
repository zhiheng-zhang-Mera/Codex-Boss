/**
 * Update-Plan/checkpoint-1.md §32 — the multi-layer review gate (pure).
 *
 * §32 requires at least three layers (Implementation Worker, Internal Reviewer,
 * Adversarial Reviewer), §32.1 names the dimensions each internal review covers
 * (correctness, architecture, test coverage, scope, maintainability) plus four
 * theme-specific ones, §32.2 lists the twelve things the adversarial reviewer
 * deliberately hunts for, and §32.3 says HIGH/MEDIUM findings must return to the
 * Repair Loop automatically.
 *
 * The §2.3 doctrine shapes every rule in this module: a reviewer — model or not —
 * is not allowed to certify anything. A finding must point at something the host
 * can look at again (a requirement, a file, a gate, a ledger row, a command), and
 * "I reviewed it and it is fine" only counts when the dimension was actually
 * reviewed. A dimension that nobody reviewed is NOT_RUN, which is not a pass, and
 * an accepted risk is only legal as an explicit Owner decision.
 *
 * Pure: no fs, no clock, no process.
 */
import { contentHashOf } from "./workbook";
import type { VerificationGate } from "./execution-planner";

export const REVIEW_VERSION = "review-1" as const;

/* ------------------------------------------------------------------ *
 * §32 layers, §32.1 dimensions, §32.2 adversarial targets
 * ------------------------------------------------------------------ */

export const REVIEW_LAYERS = ["IMPLEMENTATION_WORKER", "INTERNAL_REVIEWER", "ADVERSARIAL_REVIEWER"] as const;
export type ReviewLayer = (typeof REVIEW_LAYERS)[number];

export const REVIEW_DIMENSIONS = ["correctness", "architecture", "test_coverage", "scope", "maintainability"] as const;
export const THEME_DIMENSIONS = ["visual_coherence", "surface_coverage", "fallback_safety", "theme_isolation"] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];
export type ThemeDimension = (typeof THEME_DIMENSIONS)[number];
export type ReviewSubject = ReviewDimension | ThemeDimension;

export const SEVERITIES = ["HIGH", "MEDIUM", "LOW", "INFO"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** §32.3: OPEN HIGH/MEDIUM goes back to the repair loop; nothing else blocks. */
export const BLOCKING_SEVERITIES: readonly Severity[] = ["HIGH", "MEDIUM"];

export const FINDING_STATES = ["OPEN", "REPAIRED", "ACCEPTED_RISK", "DISMISSED"] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export interface AdversarialProbe {
  id: string;
  /** What the probe is looking for, in §32.2's own words. */
  phenomenon: string;
  /** Host-decidable artifacts a reviewer must inspect to answer the probe. */
  host_checks: string[];
  /** Severity a confirmed hit carries. */
  severity_if_found: Severity;
}

/**
 * The twelve §32.2 targets. `host_checks` is deliberately about *artifacts*: a
 * probe is answerable only by looking at something, so a reviewer that answers it
 * must be able to say what it looked at.
 */
export const ADVERSARIAL_PROBES: readonly AdversarialProbe[] = [
  { id: "HIDDEN_FAILURE", phenomenon: "a failure path that is never surfaced to the Owner", host_checks: ["error handling in the changed files", "task timeline events for the change"], severity_if_found: "HIGH" },
  { id: "RACE", phenomenon: "concurrent work over shared state", host_checks: ["shared writers touched by the change", "lock/queue boundaries"], severity_if_found: "HIGH" },
  { id: "RESTART_ISSUE", phenomenon: "state that does not survive a restart", host_checks: ["durable stores written by the change", "restart acceptance evidence"], severity_if_found: "HIGH" },
  { id: "PARTIAL_STATE", phenomenon: "a half-applied change left behind", host_checks: ["atomic change units", "rollback evidence"], severity_if_found: "HIGH" },
  { id: "SECURITY", phenomenon: "a new trust boundary or widened permission", host_checks: ["IPC surface", "allow-lists", "mutation guard"], severity_if_found: "HIGH" },
  { id: "SECRET_EXPOSURE", phenomenon: "a credential or token reaching logs, artifacts or the renderer", host_checks: ["security scan report", "knowledge write gate", "captured artifacts"], severity_if_found: "HIGH" },
  { id: "FALSE_POSITIVE_TEST", phenomenon: "a test that passes without exercising the behaviour", host_checks: ["targeted test evidence", "assertions in the changed tests"], severity_if_found: "MEDIUM" },
  { id: "SILENT_FALLBACK", phenomenon: "a fallback that hides a failure instead of recording it", host_checks: ["fallback branches", "diagnostics written on the fallback path"], severity_if_found: "MEDIUM" },
  { id: "UNVERIFIED_COMPLETION", phenomenon: "a requirement reported done without evidence", host_checks: ["evidence ledger", "§28.4 requirement binding"], severity_if_found: "HIGH" },
  { id: "THEME_RENDERER_CRASH", phenomenon: "theme CSS that can crash or blank the renderer", host_checks: ["theme validation report", "visual runtime check"], severity_if_found: "HIGH" },
  { id: "THEME_REGISTRY_CORRUPTION", phenomenon: "a registry write that can leave themes unreadable", host_checks: ["theme registry file", "theme integrity check"], severity_if_found: "HIGH" },
  { id: "CROSS_THEME_DEPENDENCY", phenomenon: "one theme depending on another theme's package", host_checks: ["theme package manifests", "derivedFrom/basedOn use"], severity_if_found: "MEDIUM" }
];

export function probeById(id: string): AdversarialProbe | undefined {
  return ADVERSARIAL_PROBES.find((probe) => probe.id === id);
}

/* ------------------------------------------------------------------ *
 * findings
 * ------------------------------------------------------------------ */

/**
 * What a finding points at. §2.3: without at least one of these the finding is
 * unverifiable and is refused rather than argued about.
 */
export interface FindingEvidence {
  requirement_ids?: string[];
  files?: string[];
  /** The gate whose result the finding is about. */
  gate?: VerificationGate;
  /** §31.3 ledger rows the finding cites. */
  ledger_entry_ids?: string[];
  /** A command the host can re-run to see the same thing. */
  command?: string;
  /** Free-form pointer for things that are neither (a report path, an event id). */
  reference?: string;
}

export interface ReviewFinding {
  id: string;
  layer: ReviewLayer;
  /** A §32.1 dimension or a §32.2 probe id. */
  subject: ReviewSubject | string;
  severity: Severity;
  statement: string;
  evidence: FindingEvidence;
  /** True when the host itself decided this from real artifacts. */
  host_decided: boolean;
  state: FindingState;
  raised_at: string;
  repaired_by?: string;
  /** Only the Owner may accept a risk (§2.3/§2.4). */
  accepted_by?: string;
}

export interface FindingVerdict {
  accepted: boolean;
  reason: string;
  /** Severity the finding keeps after validation. */
  severity: Severity;
}

/**
 * §32.3/§2.3: may this finding exist as stated?
 *
 * A HIGH or MEDIUM finding must be reproducible — it needs a requirement or file
 * plus something re-checkable (gate, ledger row, command or reference). A finding
 * without any pointer is refused: "something feels wrong" is not a finding, and a
 * reviewer must not be able to block work on an unfalsifiable statement. LOW and
 * INFO findings are recorded without that requirement.
 *
 * A finding whose subject is unknown is refused too: every finding must name
 * either a §32.1 dimension or a §32.2 probe, so the report can show what was
 * actually reviewed.
 */
export function validateFinding(finding: ReviewFinding): FindingVerdict {
  const known = [...REVIEW_DIMENSIONS, ...THEME_DIMENSIONS].includes(finding.subject as ReviewDimension)
    || probeById(finding.subject) !== undefined;
  if (!known) return { accepted: false, reason: `unknown review subject "${finding.subject}"; name a §32.1 dimension or a §32.2 probe`, severity: finding.severity };
  if (!finding.statement.trim()) return { accepted: false, reason: "a finding must state what is wrong", severity: finding.severity };
  if (!BLOCKING_SEVERITIES.includes(finding.severity)) return { accepted: true, reason: "low/INFO findings are recorded as observed", severity: finding.severity };
  const hasSubject = (finding.evidence?.requirement_ids?.length ?? 0) > 0 || (finding.evidence?.files?.length ?? 0) > 0;
  const hasReproduction = Boolean(finding.evidence?.gate || (finding.evidence?.ledger_entry_ids?.length ?? 0) > 0 || finding.evidence?.command?.trim() || finding.evidence?.reference?.trim());
  if (!hasSubject) return { accepted: false, reason: `a ${finding.severity} finding must name the requirement or file it is about`, severity: finding.severity };
  if (!hasReproduction) return { accepted: false, reason: `a ${finding.severity} finding must be reproducible: cite a gate, a ledger row, a command or a report`, severity: finding.severity };
  if (finding.state === "ACCEPTED_RISK" && !finding.accepted_by?.trim()) {
    return { accepted: false, reason: "only the Owner may accept a risk; an accepted risk must name who accepted it", severity: finding.severity };
  }
  return { accepted: true, reason: `§32.3 ${finding.severity} finding carries a reproducible pointer`, severity: finding.severity };
}

/** Stable id for a finding, so a repair can point back at the exact statement. */
export function findingIdOf(input: Pick<ReviewFinding, "layer" | "subject" | "severity" | "statement">): string {
  return `rf-${contentHashOf([input.layer, input.subject, input.severity, input.statement.trim()].join("\u0000")).slice(0, 16)}`;
}

export interface RoutedFindings {
  /** §32.3: HIGH/MEDIUM and still open — must go back to the repair loop. */
  repair: ReviewFinding[];
  /** Recorded but not blocking (LOW/INFO, repaired, dismissed, owner-accepted). */
  recorded: ReviewFinding[];
  /** Findings that failed validation and therefore cannot drive anything. */
  refused: { finding: ReviewFinding; reason: string }[];
  blocking: boolean;
  reason: string;
}

/**
 * §32.3 routing. A finding blocks only when it is HIGH/MEDIUM, still OPEN, and
 * passes validation (§2.3) — an unfalsifiable HIGH cannot stop the pipeline, and
 * a repaired or Owner-accepted one no longer does.
 */
export function routeFindings(findings: readonly ReviewFinding[]): RoutedFindings {
  const repair: ReviewFinding[] = [];
  const recorded: ReviewFinding[] = [];
  const refused: { finding: ReviewFinding; reason: string }[] = [];
  for (const finding of findings) {
    const verdict = validateFinding(finding);
    if (!verdict.accepted) { refused.push({ finding, reason: verdict.reason }); continue; }
    if (BLOCKING_SEVERITIES.includes(finding.severity) && finding.state === "OPEN") repair.push(finding);
    else recorded.push(finding);
  }
  return {
    repair,
    recorded,
    refused,
    blocking: repair.length > 0,
    reason: repair.length
      ? `§32.3 ${repair.length} open HIGH/MEDIUM finding(s) return to the repair loop: ${repair.map((finding) => finding.id).join(", ")}`
      : refused.length ? `no blocking finding, but ${refused.length} finding(s) were refused for lack of evidence` : "no blocking finding"
  };
}

/* ------------------------------------------------------------------ *
 * §32.1 what must be reviewed
 * ------------------------------------------------------------------ */

export interface ReviewContext {
  /** Requirement types/probes that widen the review. */
  touches_theme?: boolean;
  touches_ui?: boolean;
  touches_persistence?: boolean;
  touches_secrets_or_ipc?: boolean;
  /** Files the change unit is allowed to write (for the diagnostic trail). */
  files?: string[];
}

export interface ReviewPlan {
  schemaVersion: 1;
  version: typeof REVIEW_VERSION;
  layers: ReviewLayer[];
  /** Dimensions a review must cover for this change. */
  dimensions: ReviewSubject[];
  /** §32.2 probes worth running for this change. */
  probes: string[];
  diagnostics: string[];
}

/** Probes that matter for a given change; the rest are simply not planned. */
function probesFor(context: ReviewContext): string[] {
  const probes = new Set<string>(["HIDDEN_FAILURE", "FALSE_POSITIVE_TEST", "SILENT_FALLBACK", "UNVERIFIED_COMPLETION"]);
  if (context.touches_ui) probes.add("RACE");
  if (context.touches_persistence) { probes.add("RESTART_ISSUE"); probes.add("PARTIAL_STATE"); }
  if (context.touches_secrets_or_ipc) { probes.add("SECURITY"); probes.add("SECRET_EXPOSURE"); }
  if (context.touches_theme) { probes.add("THEME_RENDERER_CRASH"); probes.add("THEME_REGISTRY_CORRUPTION"); probes.add("CROSS_THEME_DEPENDENCY"); }
  return ADVERSARIAL_PROBES.filter((probe) => probes.has(probe.id)).map((probe) => probe.id);
}

/**
 * §32.1/§32.2: the review a change must receive. The three layers are always
 * present — a change that only the worker looked at has not been reviewed at all.
 */
export function planReview(context: ReviewContext = {}): ReviewPlan {
  const dimensions: ReviewSubject[] = [...REVIEW_DIMENSIONS];
  const diagnostics: string[] = [];
  if (context.touches_theme) {
    dimensions.push(...THEME_DIMENSIONS);
    diagnostics.push("theme change: §32.1 theme dimensions (visual coherence, surface coverage, fallback safety, theme isolation) are required");
  }
  return {
    schemaVersion: 1,
    version: REVIEW_VERSION,
    layers: [...REVIEW_LAYERS],
    dimensions,
    probes: probesFor(context),
    diagnostics
  };
}

/* ------------------------------------------------------------------ *
 * coverage and the §2.3 completion gate
 * ------------------------------------------------------------------ */

/** What a layer reports it actually looked at. A claim, not a clearance. */
export interface ReviewRecord {
  layer: ReviewLayer;
  subject: ReviewSubject | string;
  /** The artifacts inspected; empty means the review did not happen. */
  inspected: string[];
  findings: string[];
}

export interface CoverageEntry {
  subject: ReviewSubject | string;
  status: "REVIEWED" | "NOT_RUN";
  layers: ReviewLayer[];
  inspected: string[];
}

export interface CoverageReport {
  entries: CoverageEntry[];
  /** §2.3: dimensions nobody reviewed. Never a pass. */
  not_run: string[];
  covered: boolean;
  reason: string;
}

/**
 * §32.1/§2.3: which required dimensions were actually reviewed.
 *
 * A dimension counts as reviewed only when a record names it AND lists at least
 * one inspected artifact. "Zero findings" from a reviewer that inspected nothing
 * is NOT_RUN, because a review nobody performed cannot clear anything.
 */
export function reviewCoverage(plan: Pick<ReviewPlan, "dimensions" | "probes">, records: readonly ReviewRecord[]): CoverageReport {
  const wanted = [...plan.dimensions, ...plan.probes];
  const entries: CoverageEntry[] = wanted.map((subject) => {
    const matching = records.filter((record) => record.subject === subject && record.inspected.length > 0);
    return {
      subject,
      status: matching.length ? "REVIEWED" : "NOT_RUN",
      layers: [...new Set(matching.map((record) => record.layer))],
      inspected: [...new Set(matching.flatMap((record) => record.inspected))]
    };
  });
  const notRun = entries.filter((entry) => entry.status === "NOT_RUN").map((entry) => entry.subject);
  return {
    entries,
    not_run: notRun,
    covered: notRun.length === 0,
    reason: notRun.length
      ? `${notRun.length} required review subject(s) were never reviewed: ${notRun.slice(0, 8).join(", ")}`
      : "every required dimension and adversarial probe was reviewed with a named artifact"
  };
}

export interface CompletionInput {
  findings: readonly ReviewFinding[];
  coverage: CoverageReport;
  /** Requirement ids the §31.3 ledger still owes evidence for. */
  outstanding_requirements?: string[];
  /** Requirements whose verification FAILed. */
  failed_requirements?: string[];
}

export interface CompletionVerdict {
  can_complete: boolean;
  reasons: string[];
  repair: ReviewFinding[];
  /** The honest label to record: COMPLETED is only reachable with evidence. */
  label: "COMPLETED" | "INCOMPLETE" | "REPAIR_REQUIRED";
}

/**
 * §2.3/§32.3: may this work be called done?
 *
 * Three independent doors, and all three must be open:
 *   1. no open HIGH/MEDIUM finding (unfalsifiable ones were already refused),
 *   2. every §32.1 dimension and planned §32.2 probe actually reviewed,
 *   3. no requirement still owed evidence and none whose verification failed.
 *
 * `MODEL_DONE` is not one of the inputs, which is the point.
 */
export function completionGate(input: CompletionInput): CompletionVerdict {
  const routed = routeFindings(input.findings);
  const reasons: string[] = [];
  if (!routed.blocking && routed.refused.length) reasons.push(`${routed.refused.length} finding(s) were refused for lack of evidence and cannot clear or block the work: ${routed.refused.map((entry) => entry.finding.id).join(", ")}`);
  if (!input.coverage.covered) reasons.push(input.coverage.reason);
  if ((input.outstanding_requirements ?? []).length) reasons.push(`${(input.outstanding_requirements ?? []).length} requirement(s) are still owed evidence: ${(input.outstanding_requirements ?? []).slice(0, 8).join(", ")}`);
  if ((input.failed_requirements ?? []).length) reasons.push(`${(input.failed_requirements ?? []).length} requirement(s) failed verification: ${(input.failed_requirements ?? []).slice(0, 8).join(", ")}`);
  if (routed.blocking) reasons.push(routed.reason);
  const blocking = routed.blocking;
  // A refused finding cannot block (nothing actionable), but it is never silent:
  // it is listed in `reasons` and kept in the report's `routed.refused`.
  const canComplete = !blocking && input.coverage.covered
    && !(input.outstanding_requirements ?? []).length
    && !(input.failed_requirements ?? []).length;
  return {
    can_complete: canComplete,
    reasons,
    repair: routed.repair,
    label: blocking ? "REPAIR_REQUIRED" : canComplete ? "COMPLETED" : "INCOMPLETE"
  };
}

/* ------------------------------------------------------------------ *
 * the review report
 * ------------------------------------------------------------------ */

export interface ReviewReport {
  schemaVersion: 1;
  version: typeof REVIEW_VERSION;
  plan: ReviewPlan;
  records: ReviewRecord[];
  coverage: CoverageReport;
  findings: ReviewFinding[];
  routed: { repair: string[]; recorded: string[]; refused: { id: string; reason: string }[] };
  /** §2.4: the honest label produced by the completion gate for this change. */
  label: CompletionVerdict["label"];
  reasons: string[];
  created_at: string;
}

export function buildReviewReport(input: {
  plan: ReviewPlan;
  records: readonly ReviewRecord[];
  findings: readonly ReviewFinding[];
  outstanding_requirements?: string[];
  failed_requirements?: string[];
  now?: string;
}): ReviewReport {
  const coverage = reviewCoverage(input.plan, input.records);
  const completion = completionGate({
    findings: input.findings,
    coverage,
    ...(input.outstanding_requirements ? { outstanding_requirements: input.outstanding_requirements } : {}),
    ...(input.failed_requirements ? { failed_requirements: input.failed_requirements } : {})
  });
  const routed = routeFindings(input.findings);
  return {
    schemaVersion: 1,
    version: REVIEW_VERSION,
    plan: input.plan,
    records: [...input.records],
    coverage,
    findings: [...input.findings],
    routed: {
      repair: routed.repair.map((finding) => finding.id),
      recorded: routed.recorded.map((finding) => finding.id),
      refused: routed.refused.map((entry) => ({ id: entry.finding.id, reason: entry.reason }))
    },
    label: completion.label,
    reasons: completion.reasons,
    created_at: input.now ?? new Date(0).toISOString()
  };
}
