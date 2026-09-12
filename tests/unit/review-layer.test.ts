/**
 * checkpoint-1 §32 (checkpoint-9 part 1): the multi-layer review layer.
 *
 * These cases pin the three layers, §32.1's dimensions (and the four theme ones),
 * §32.2's adversarial probes, §32.3's routing, and the §2.3 rules that make the
 * review gate meaningful: an unfalsifiable finding cannot block, and a dimension
 * nobody reviewed is NOT_RUN rather than a clearance.
 */
import { describe, expect, it } from "vitest";
import {
  ADVERSARIAL_PROBES,
  buildReviewReport,
  completionGate,
  findingIdOf,
  planReview,
  probeById,
  reviewCoverage,
  routeFindings,
  REVIEW_DIMENSIONS,
  REVIEW_LAYERS,
  THEME_DIMENSIONS,
  validateFinding,
  type ReviewFinding,
  type ReviewPlan,
  type ReviewRecord
} from "../../src/shared/review";

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  id: "rf-1",
  layer: "INTERNAL_REVIEWER",
  subject: "correctness",
  severity: "HIGH",
  statement: "the fallback path swallows the provider error",
  evidence: { requirement_ids: ["R-1"], files: ["src/gateway.ts"], gate: "UNIT", ledger_entry_ids: ["ev-1"] },
  host_decided: false,
  state: "OPEN",
  raised_at: "2026-01-01T00:00:00.000Z",
  ...overrides
});

const reviewed = (plan: ReviewPlan, subject: string): ReviewRecord => ({ layer: "INTERNAL_REVIEWER", subject, inspected: ["diff", "ledger"], findings: [] });

function fullCoverage(plan: ReviewPlan): ReviewRecord[] {
  return [...plan.dimensions, ...plan.probes].flatMap((subject) => [
    { layer: "INTERNAL_REVIEWER", subject, inspected: ["diff"] } as ReviewRecord,
    { layer: "ADVERSARIAL_REVIEWER", subject, inspected: ["adversarial probe"] } as ReviewRecord
  ]);
}

describe("checkpoint-9 §32 review planning", () => {
  it("always requires the three layers of §32", () => {
    const plan = planReview();
    expect([...plan.layers]).toEqual([...REVIEW_LAYERS]);
    expect(plan.layers).toHaveLength(3);
    expect(plan.version).toBe("review-1");
  });

  it("requires every §32.1 dimension", () => {
    const plan = planReview();
    for (const dimension of REVIEW_DIMENSIONS) expect(plan.dimensions).toContain(dimension);
    expect(plan.dimensions.filter((subject) => THEME_DIMENSIONS.includes(subject as never))).toEqual([]);
  });

  it("adds the four theme dimensions for a theme change", () => {
    const plan = planReview({ touches_theme: true });
    for (const dimension of THEME_DIMENSIONS) expect(plan.dimensions).toContain(dimension);
    expect(plan.diagnostics.some((line) => line.includes("theme change"))).toBe(true);
  });

  it("plans the §32.2 probes the change can actually hit", () => {
    const base = planReview();
    expect(base.probes).toContain("UNVERIFIED_COMPLETION");
    expect(base.probes).not.toContain("THEME_REGISTRY_CORRUPTION");
    expect(planReview({ touches_persistence: true }).probes).toEqual(expect.arrayContaining(["RESTART_ISSUE", "PARTIAL_STATE"]));
    expect(planReview({ touches_secrets_or_ipc: true }).probes).toEqual(expect.arrayContaining(["SECURITY", "SECRET_EXPOSURE"]));
    const theme = planReview({ touches_theme: true });
    expect(theme.probes).toEqual(expect.arrayContaining(["THEME_RENDERER_CRASH", "THEME_REGISTRY_CORRUPTION", "CROSS_THEME_DEPENDENCY"]));
  });

  it("catalogues all twelve §32.2 targets with an actionable artifact list", () => {
    expect(ADVERSARIAL_PROBES).toHaveLength(12);
    expect(ADVERSARIAL_PROBES.every((probe) => probe.host_checks.length > 0 && probe.severity_if_found !== undefined)).toBe(true);
    expect(probeById("THEME_RENDERER_CRASH")?.severity_if_found).toBe("HIGH");
    expect(probeById("nope")).toBeUndefined();
  });
});

describe("checkpoint-9 §32.3 findings and the §2.3 evidence rule", () => {
  it("refuses a HIGH finding that cannot be reproduced", () => {
    const noSubject = validateFinding(finding({ evidence: { gate: "UNIT" } }));
    expect(noSubject.accepted).toBe(false);
    expect(noSubject.reason).toContain("must name the requirement or file");
    const noReproduction = validateFinding(finding({ evidence: { files: ["src/gateway.ts"] } }));
    expect(noReproduction.accepted).toBe(false);
    expect(noReproduction.reason).toContain("must be reproducible");
  });

  it("refuses a finding that names neither a dimension nor a probe", () => {
    expect(validateFinding(finding({ subject: "vibes" })).accepted).toBe(false);
    expect(validateFinding(finding({ subject: "THEME_ISOLATION" })).accepted).toBe(false);
    expect(validateFinding(finding({ subject: "theme_isolation" })).accepted).toBe(true);
    expect(validateFinding(finding({ subject: "CROSS_THEME_DEPENDENCY" })).accepted).toBe(true);
  });

  it("records LOW/INFO observations without demanding proof", () => {
    expect(validateFinding(finding({ severity: "INFO", evidence: {} })).accepted).toBe(true);
    expect(validateFinding(finding({ severity: "LOW" })).accepted).toBe(true);
  });

  it("lets only the Owner accept a risk, and treats an accepted risk as non-blocking", () => {
    const accepted = finding({ state: "ACCEPTED_RISK", accepted_by: "owner" });
    expect(validateFinding(accepted).accepted).toBe(true);
    expect(routeFindings([accepted]).blocking).toBe(false);
    const unnamed = finding({ state: "ACCEPTED_RISK" });
    expect(validateFinding(unnamed).accepted).toBe(false);
    expect(routeFindings([unnamed]).blocking).toBe(false);
    expect(routeFindings([unnamed]).refused).toHaveLength(1);
  });

  it("returns open HIGH/MEDIUM findings to the repair loop and files the rest", () => {
    const routed = routeFindings([
      finding({ id: "rf-high", severity: "HIGH" }),
      finding({ id: "rf-medium", severity: "MEDIUM" }),
      finding({ id: "rf-low", severity: "LOW", evidence: {} }),
      finding({ id: "rf-info", severity: "INFO", evidence: {} }),
      finding({ id: "rf-repaired", severity: "HIGH", state: "REPAIRED", repaired_by: "unit-3" })
    ]);
    expect(routed.blocking).toBe(true);
    expect(routed.repair.map((entry) => entry.id)).toEqual(["rf-high", "rf-medium"]);
    expect(routed.recorded.map((entry) => entry.id)).toEqual(["rf-low", "rf-info", "rf-repaired"]);
    expect(routed.reason).toContain("§32.3");
  });

  it("cannot be blocked by an unfalsifiable HIGH claim", () => {
    const routed = routeFindings([finding({ id: "rf-vague", evidence: { reference: "  " } })]);
    expect(routed.blocking).toBe(false);
    expect(routed.refused[0]?.finding.id).toBe("rf-vague");
    expect(routed.reason).toContain("refused for lack of evidence");
  });

  it("gives one statement one stable id", () => {
    const first = findingIdOf({ layer: "INTERNAL_REVIEWER", subject: "scope", severity: "MEDIUM", statement: "touches files outside the grant" });
    const second = findingIdOf({ layer: "INTERNAL_REVIEWER", subject: "scope", severity: "MEDIUM", statement: "  touches files outside the grant " });
    expect(first).toBe(second);
    expect(first).toMatch(/^rf-[0-9a-f]{16}$/);
  });
});

describe("checkpoint-9 §2.3 coverage and completion", () => {
  it("counts a dimension nobody reviewed as NOT_RUN, not as a clearance", () => {
    const plan = planReview();
    const coverage = reviewCoverage(plan, [reviewed(plan, "correctness")]);
    expect(coverage.covered).toBe(false);
    expect(coverage.not_run).toContain("architecture");
    expect(coverage.not_run).toContain("UNVERIFIED_COMPLETION");
    expect(coverage.entries.find((entry) => entry.subject === "correctness")?.status).toBe("REVIEWED");
  });

  it("does not accept a review record that inspected nothing", () => {
    const plan = planReview();
    const coverage = reviewCoverage(plan, [{ layer: "ADVERSARIAL_REVIEWER", subject: "correctness", inspected: [], findings: [] }]);
    expect(coverage.not_run).toContain("correctness");
  });

  it("reports full coverage once every dimension and probe named an artifact", () => {
    const plan = planReview();
    const coverage = reviewCoverage(plan, fullCoverage(plan));
    expect(coverage.not_run).toEqual([]);
    expect(coverage.covered).toBe(true);
    expect(coverage.entries.every((entry) => entry.layers.length > 0 && entry.inspected.length > 0)).toBe(true);
  });

  it("refuses to call work complete while a HIGH finding is open", () => {
    const plan = planReview();
    const verdict = completionGate({ findings: [finding()], coverage: reviewCoverage(plan, fullCoverage(plan)) });
    expect(verdict.can_complete).toBe(false);
    expect(verdict.label).toBe("REPAIR_REQUIRED");
    expect(verdict.repair.map((entry) => entry.id)).toEqual(["rf-1"]);
  });

  it("refuses to call work complete with a coverage gap or outstanding evidence", () => {
    const plan = planReview();
    const gap = completionGate({ findings: [], coverage: reviewCoverage(plan, [reviewed(plan, "correctness")]) });
    expect(gap.label).toBe("INCOMPLETE");
    const owed = completionGate({ findings: [], coverage: reviewCoverage(plan, fullCoverage(plan)), outstanding_requirements: ["R-7"], failed_requirements: ["R-8"] });
    expect(owed.can_complete).toBe(false);
    expect(owed.reasons.join(" ")).toContain("R-7");
    expect(owed.reasons.join(" ")).toContain("R-8");
  });

  it("calls work complete only with no blocking finding, full coverage and no owed evidence", () => {
    const plan = planReview();
    const verdict = completionGate({
      findings: [finding({ id: "rf-note", severity: "INFO", evidence: {} })],
      coverage: reviewCoverage(plan, fullCoverage(plan))
    });
    expect(verdict.can_complete).toBe(true);
    expect(verdict.label).toBe("COMPLETED");
    expect(verdict.reasons).toEqual([]);
  });

  it("puts the label, the routing and the reasons into the §32 report", () => {
    const plan = planReview({ touches_theme: true });
    const report = buildReviewReport({
      plan,
      records: fullCoverage(plan),
      findings: [finding({ id: "rf-theme", subject: "theme_isolation", severity: "MEDIUM", statement: "the dark theme reads the light theme's file" })],
      now: "2026-01-01T00:00:00.000Z"
    });
    expect(report.version).toBe("review-1");
    expect(report.label).toBe("REPAIR_REQUIRED");
    expect(report.routed.repair).toEqual(["rf-theme"]);
    expect(report.coverage.covered).toBe(true);
    expect(report.created_at).toBe("2026-01-01T00:00:00.000Z");
  });
});
