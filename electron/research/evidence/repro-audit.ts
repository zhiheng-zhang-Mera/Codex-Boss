import type { RunAnalysisResult } from "./run-analysis";

/**
 * Reproducibility audit summary (plan 9-6 Phase 10/11 audit). Deterministic
 * verdict over the recorded-run analysis produced by round 11: a primary
 * finding is REPRODUCED only when the claim was adopted on real evidence
 * (statistic supported + independent replication = ≥2 distinct-seed runs under
 * the same frozen protocol). Pure — the manuscript assembler writes this shape
 * into audit/reproducibility.json instead of a PENDING stub.
 */

export type ReproducibilityStatus = "REPRODUCED" | "NOT_REPRODUCED" | "PENDING";

export interface ReproducibilityAudit {
  claimId: string;
  status: ReproducibilityStatus;
  protocolHash: string;
  runsAnalyzed: number;
  distinctSeeds: number;
  mean: number | null;
  ci: { lower: number | null; upper: number | null } | null;
  reason: string;
  at: string;
}

export function buildReproducibilityAudit(analysis: RunAnalysisResult, at = new Date().toISOString()): ReproducibilityAudit {
  const reasons: string[] = [];
  let status: ReproducibilityStatus;
  if (analysis.eligibleRuns.length === 0) {
    status = "PENDING";
    reasons.push("no recorded runs to audit");
  } else {
    if (!analysis.independentReplication) reasons.push("fewer than two distinct-seed runs");
    if (!analysis.verdict.adopted) reasons.push(analysis.verdict.reason);
    status = analysis.independentReplication && analysis.verdict.adopted ? "REPRODUCED" : "NOT_REPRODUCED";
    if (status === "NOT_REPRODUCED" && !analysis.independentReplication) reasons.push("replication did not pass");
  }
  return {
    claimId: analysis.verdict.claimId,
    status,
    protocolHash: analysis.eligibleRuns[0]?.protocolHash ?? "none",
    runsAnalyzed: analysis.eligibleRuns.length,
    distinctSeeds: analysis.eligibleRuns.length ? new Set(analysis.eligibleRuns.map((run) => run.seed)).size : 0,
    mean: Number.isNaN(analysis.mean) ? null : analysis.mean,
    ci: Number.isNaN(analysis.ci.lower) || Number.isNaN(analysis.ci.upper) ? null : { lower: analysis.ci.lower, upper: analysis.ci.upper },
    reason: reasons.join("; ") || "original run + independent replication reproduced the finding",
    at
  };
}
