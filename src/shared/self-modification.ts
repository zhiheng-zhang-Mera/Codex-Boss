/**
 * Self-modification sandbox + Dual BOSS contracts (plan AP27). Pure and
 * shareable.
 *
 * BOSS-A (production) creates a candidate branch / BOSS-B, applies changes,
 * runs targeted tests, replays historical goldens, A/B-evaluates against the
 * production baseline, then promotes or discards. Promotion is guarded (plan
 * §28 `promotion.gate`) and must verify that old Workspace / Adapter
 * declarations stay compatible with the candidate core versions.
 */

import { compareVersions, versionInWindow, CURRENT_VERSIONS, type CompatibilityAxis, type VersionWindow } from "./compatibility";

export type SelfModStatus =
  | "CANDIDATE"      // branch created; change may be applied
  | "TESTING"        // targeted tests running/completed
  | "REPLAYING"      // historical replay running/completed
  | "AB_EVALUATING"  // A/B decision computed
  | "PROMOTED"       // merged into production
  | "DISCARDED"      // rejected and branch removed
  | "ROLLED_BACK"    // promotion detected bad and reverted
  | "FAILED";        // test/replay hard failure

export const SELF_MOD_ORDER: readonly SelfModStatus[] = ["CANDIDATE", "TESTING", "REPLAYING", "AB_EVALUATING", "PROMOTED", "DISCARDED", "ROLLED_BACK", "FAILED"];

export interface SelfModTestSummary {
  passed: number;
  failed: number;
  total: number;
}

export interface SelfModReplaySummary {
  /** Production pass rate from the historical baseline (null = no baseline yet). */
  baselineRate: number | null;
  /** Candidate pass rate over the same goldens. */
  candidateRate: number | null;
  /** Golden ids the candidate actually ran. */
  goldens: string[];
}

export interface ABEvaluation {
  baselineRate: number | null;
  candidateRate: number | null;
  verdict: "PROMOTE" | "DISCARD" | "HUMAN";
  reasons: string[];
}

export interface CompatibilityVerdict {
  axis: CompatibilityAxis | "workspace_schema";
  current: string;
  candidate: string;
  ok: boolean;
  reason: string;
}

export interface SelfModCandidate {
  id: string;
  goal: string;
  baseCommit: string;
  branch: string;
  headCommit?: string;
  status: SelfModStatus;
  tests?: SelfModTestSummary;
  replay?: SelfModReplaySummary;
  ab?: ABEvaluation;
  compatibility?: CompatibilityVerdict[];
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface ABDecisionInput {
  baselineRate: number | null;
  candidateRate: number | null;
  tests?: SelfModTestSummary;
  /** Allow a candidate whose evidence is thin (no baseline yet) to promote on green tests. */
  requireBaseline?: boolean;
  /** Candidate may not drop more than this below baseline without human review. */
  regressionTolerance?: number;
}

/**
 * A/B promotion decision. Deterministic rules:
 *  - red tests → DISCARD;
 *  - replay evidence present and candidate clearly better → PROMOTE;
 *  - candidate within tolerance (or no baseline and requireBaseline=false with
 *    green tests) → PROMOTE;
 *  - candidate worse beyond tolerance → HUMAN (never auto-promote a regression).
 */
export function decideABPromotion(input: ABDecisionInput): ABEvaluation {
  const reasons: string[] = [];
  const baseline = input.baselineRate ?? null;
  const candidate = input.candidateRate ?? null;
  const tolerance = input.regressionTolerance ?? 0.02;
  if (input.tests && input.tests.failed > 0) {
    return { baselineRate: baseline, candidateRate: candidate, verdict: "DISCARD", reasons: [`targeted tests failed (${input.tests.failed}/${input.tests.total})`] };
  }
  if (baseline === null && candidate === null) {
    return input.requireBaseline ? { baselineRate: null, candidateRate: null, verdict: "HUMAN", reasons: ["no baseline or candidate replay evidence"] }
      : { baselineRate: null, candidateRate: null, verdict: "PROMOTE", reasons: ["no replay baseline; green targeted tests"] };
  }
  if (candidate === null) {
    return { baselineRate: baseline, candidateRate: null, verdict: "HUMAN", reasons: ["candidate produced no replay rate"] };
  }
  if (baseline === null) {
    reasons.push(`first measured candidate rate ${formatRate(candidate)}`);
    return { baselineRate: null, candidateRate: candidate, verdict: "PROMOTE", reasons };
  }
  const delta = candidate - baseline;
  if (delta > 0) { reasons.push(`candidate +${formatRate(delta)} over baseline`); return { baselineRate: baseline, candidateRate: candidate, verdict: "PROMOTE", reasons }; }
  if (delta >= -tolerance) { reasons.push(`candidate within ${formatRate(tolerance)} regression tolerance`); return { baselineRate: baseline, candidateRate: candidate, verdict: "PROMOTE", reasons }; }
  reasons.push(`candidate ${formatRate(delta)} below baseline; requires human review`);
  return { baselineRate: baseline, candidateRate: candidate, verdict: "HUMAN", reasons };
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Compatibility impact of a candidate core-version bump: every existing
 * adapter's declared window must still include the candidate's new core
 * version, and the candidate must never drop a core version below what
 * production currently ships. Workspace schema compatibility is checked the
 * same way (a candidate may not require a newer workspace schema than the
 * oldest workspace still in production).
 */
export function candidateCompatibilityVerdicts(input: {
  /** Candidate versions the change would introduce (defaults to current core). */
  candidateVersions?: Partial<Record<CompatibilityAxis, string>>;
  /** Candidate workspace schema version the change would introduce. */
  candidateWorkspaceSchema?: string;
  /** Existing adapter declarations: id → supported windows. */
  adapters: Array<{ id: string; kind: string; windows: Partial<Record<CompatibilityAxis, VersionWindow>> }>;
  /** Production workspace schema versions still in use (id → version). */
  workspaces?: Array<{ id: string; version: string }>;
  /** Oldest workspace schema version a candidate must keep reading. */
  minWorkspaceSchema?: string;
}): CompatibilityVerdict[] {
  const verdicts: CompatibilityVerdict[] = [];
  const candidateVersions = { ...CURRENT_VERSIONS, ...(input.candidateVersions ?? {}) };
  for (const axis of Object.keys(candidateVersions) as CompatibilityAxis[]) {
    const candidate = candidateVersions[axis];
    const current = CURRENT_VERSIONS[axis];
    if (compareVersions(candidate, current) < 0) {
      verdicts.push({ axis, current, candidate, ok: false, reason: `candidate downgrades ${axis} ${current} → ${candidate}` });
    }
  }
  for (const adapter of input.adapters) {
    for (const axis of Object.keys(adapter.windows) as CompatibilityAxis[]) {
      const window = adapter.windows[axis];
      if (!window) continue;
      const candidate = candidateVersions[axis];
      if (candidate === undefined) continue;
      if (!versionInWindow(candidate, window)) {
        verdicts.push({ axis, current: CURRENT_VERSIONS[axis], candidate, ok: false, reason: `${adapter.kind} ${adapter.id} supports ${axis} ${window.min}..${window.max}; candidate core ${axis}=${candidate}` });
      }
    }
  }
  if (input.minWorkspaceSchema !== undefined) {
    const oldest = input.workspaces?.map((workspace) => workspace.version).sort(compareVersions)[0];
    const minActual = oldest && compareVersions(oldest, input.minWorkspaceSchema) < 0 ? oldest : input.minWorkspaceSchema;
    const candidate = input.candidateWorkspaceSchema ?? input.minWorkspaceSchema;
    const ok = compareVersions(candidate, minActual) <= 0;
    verdicts.push({ axis: "workspace_schema", current: minActual, candidate, ok, reason: ok ? `candidate workspace schema ${candidate} ≤ oldest in production ${minActual}` : `candidate requires workspace schema ${candidate} > oldest ${minActual}` });
  }
  return verdicts;
}

export function validateSelfModCandidate(candidate: SelfModCandidate): void {
  if (!candidate || typeof candidate.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(candidate.id)) throw new Error("Invalid candidate id");
  if (typeof candidate.goal !== "string" || !candidate.goal.trim() || candidate.goal.length > 20000) throw new Error("Candidate goal must be 1–20000 characters");
  if (typeof candidate.baseCommit !== "string" || !candidate.baseCommit) throw new Error("Candidate requires a base commit");
  if (typeof candidate.branch !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,127}$/.test(candidate.branch)) throw new Error("Invalid candidate branch");
  if (!SELF_MOD_ORDER.includes(candidate.status)) throw new Error("Invalid candidate status");
}
