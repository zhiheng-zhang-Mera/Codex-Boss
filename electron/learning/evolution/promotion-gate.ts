import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../../commander/durable-json";
import { STABLE_POLICY, STABLE_POLICY_VERSION, newPolicyCandidate, type AdaptivePolicy, type EvaluationSummary, type PolicyCandidate } from "./policy-candidate";
import type { ReplayOutcome } from "./historical-replay";
import type { ShadowOutcome } from "./shadow-evaluator";

/**
 * Engine Phase 10 — promotion gate + rollback (book §14, acceptance A42-A46).
 *
 * A candidate policy may become the stable policy only after:
 *
 *   replay pass (A42/A43) → shadow pass (A44) → controlled trial pass
 *
 * Promotion records: policyVersion, parentVersion, promotedAt, the full
 * evaluation summary and a rollback pointer (A45). rollback() restores the
 * previous stable policy (A46). The gate never promotes on a failed or missing
 * stage, and it degrades safely when its own store is unreadable.
 */

export interface PromotionGateFile {
  schemaVersion: 1;
  stablePolicyVersion: string;
  stablePolicies: AdaptivePolicy[];
  candidates: PolicyCandidate[];
}

export interface PromotionResult {
  ok: boolean;
  reason: string;
  policy?: AdaptivePolicy;
}

export class PolicyPromotionGate {
  private stable: AdaptivePolicy = { ...STABLE_POLICY, params: { ...STABLE_POLICY.params } };
  private readonly stableHistory: AdaptivePolicy[] = [];
  private readonly candidates = new Map<string, PolicyCandidate>();
  private sequence = 0;
  private degraded?: string;

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  stablePolicy(): AdaptivePolicy {
    return { ...this.stable, params: { ...this.stable.params } };
  }

  /** Register a candidate policy (status DRAFT). */
  register(policy: Omit<AdaptivePolicy, "parentVersion"> & { parentVersion?: string }): PolicyCandidate {
    this.sequence += 1;
    const candidate = newPolicyCandidate({ policyVersion: policy.policyVersion, params: { ...policy.params } }, policy.parentVersion ?? this.stable.policyVersion, this.now());
    this.candidates.set(candidate.policy.policyVersion, candidate);
    this.persist();
    return structuredClone(candidate);
  }

  /** Stage 1: historical replay. A regression ⇒ REPLAY_FAILED (A43). */
  recordReplay(policyVersion: string, outcome: ReplayOutcome): PolicyCandidate | undefined {
    const candidate = this.candidates.get(policyVersion);
    if (!candidate) return undefined;
    const next: PolicyCandidate = {
      ...candidate,
      replay: summaryOf(outcome),
      status: outcome.passed ? "REPLAY_PASSED" : "REPLAY_FAILED",
      rejectionReason: outcome.passed ? undefined : outcome.notes.join("; ") || "replay failed",
      updatedAt: this.now()
    };
    this.candidates.set(policyVersion, next);
    this.persist();
    return structuredClone(next);
  }

  /** Stage 2: shadow evaluation. Only a replay-passed candidate may shadow (A42). */
  recordShadow(policyVersion: string, outcome: ShadowOutcome): PolicyCandidate | undefined {
    const candidate = this.candidates.get(policyVersion);
    if (!candidate) return undefined;
    if (candidate.status !== "REPLAY_PASSED") {
      return structuredClone(candidate); // stage order enforced: replay first
    }
    const next: PolicyCandidate = {
      ...candidate,
      shadow: summaryOf(outcome),
      status: outcome.passed ? "SHADOW_PASSED" : "SHADOW_FAILED",
      rejectionReason: outcome.passed ? undefined : outcome.notes.join("; ") || "shadow failed",
      updatedAt: this.now()
    };
    this.candidates.set(policyVersion, next);
    this.persist();
    return structuredClone(next);
  }

  /** Stage 3: controlled live trial. */
  recordTrial(policyVersion: string, outcome: EvaluationSummary & { passed: boolean }): PolicyCandidate | undefined {
    const candidate = this.candidates.get(policyVersion);
    if (!candidate) return undefined;
    if (candidate.status !== "SHADOW_PASSED") return structuredClone(candidate); // stage order enforced
    const next: PolicyCandidate = {
      ...candidate,
      trial: summaryOf(outcome),
      status: outcome.passed ? "READY_FOR_PROMOTION" : "TRIAL_FAILED",
      rejectionReason: outcome.passed ? undefined : outcome.notes.join("; ") || "trial failed",
      updatedAt: this.now()
    };
    this.candidates.set(policyVersion, next);
    this.persist();
    return structuredClone(next);
  }

  /** Promote the candidate to stable — only when every gate stage passed. */
  promote(policyVersion: string): PromotionResult {
    const candidate = this.candidates.get(policyVersion);
    if (!candidate) return { ok: false, reason: `unknown policy candidate ${policyVersion}` };
    if (!candidate.replay) return { ok: false, reason: "historical replay required before promotion (A42)" };
    if (candidate.replay.regressions > 0 || candidate.status === "REPLAY_FAILED") return { ok: false, reason: "replay regression blocks promotion (A43)" };
    if (!candidate.shadow || candidate.status === "SHADOW_FAILED") return { ok: false, reason: "shadow evaluation required/passed before promotion (A44)" };
    if (!candidate.trial || candidate.status === "TRIAL_FAILED") return { ok: false, reason: "controlled trial required/passed before promotion" };
    if (candidate.status !== "READY_FOR_PROMOTION") return { ok: false, reason: `candidate is ${candidate.status}, not ready for promotion` };

    const previousStable = this.stable;
    const promoted: AdaptivePolicy = { policyVersion: candidate.policy.policyVersion, parentVersion: previousStable.policyVersion, params: { ...candidate.policy.params } };
    this.stableHistory.push(previousStable);
    this.stable = promoted;
    const next: PolicyCandidate = {
      ...candidate,
      status: "PROMOTED",
      promotedAt: this.now(),
      rollbackPointer: previousStable.policyVersion,
      updatedAt: this.now()
    };
    this.candidates.set(policyVersion, next);
    this.persist();
    return { ok: true, reason: `promoted ${promoted.policyVersion} (parent ${promoted.parentVersion})`, policy: promoted };
  }

  /** Restore the previous stable policy (A46). */
  rollback(): PromotionResult {
    const previous = this.stableHistory.pop();
    if (!previous) return { ok: false, reason: "no previous stable policy to roll back to" };
    const failed = this.stable.policyVersion;
    this.stable = previous;
    const candidate = this.candidates.get(failed);
    if (candidate) {
      this.candidates.set(failed, { ...candidate, status: "ROLLED_BACK", rejectionReason: "rolled back by operator", updatedAt: this.now() });
    }
    this.persist();
    return { ok: true, reason: `rolled back ${failed} → ${previous.policyVersion}`, policy: { ...previous, params: { ...previous.params } } };
  }

  /** Disable adaptive routing entirely (last-resort fallback, Engine §7). */
  disableAdaptive(): AdaptivePolicy {
    return this.rollback().policy ?? this.stablePolicy();
  }

  get(policyVersion: string): PolicyCandidate | undefined {
    const candidate = this.candidates.get(policyVersion);
    return candidate ? structuredClone(candidate) : undefined;
  }

  list(): PolicyCandidate[] {
    return [...this.candidates.values()].map((candidate) => structuredClone(candidate)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.policy.policyVersion.localeCompare(b.policy.policyVersion));
  }

  status(): { stablePolicyVersion: string; candidates: number; degradedReason?: string } {
    return { stablePolicyVersion: this.stable.policyVersion, candidates: this.candidates.size, degradedReason: this.degraded };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<PromotionGateFile>;
      if (parsed.schemaVersion !== 1) throw new Error("Invalid promotion gate file");
      const stable = (parsed.stablePolicies ?? []).find((policy) => policy.policyVersion === parsed.stablePolicyVersion);
      if (stable) this.stable = stable;
      else if (parsed.stablePolicyVersion && parsed.stablePolicyVersion !== STABLE_POLICY_VERSION) throw new Error("Missing stable policy payload");
      for (const policy of parsed.stablePolicies ?? []) if (policy.policyVersion !== this.stable.policyVersion) this.stableHistory.push(policy);
      for (const candidate of parsed.candidates ?? []) {
        if (!candidate || typeof candidate.policy?.policyVersion !== "string") throw new Error("Invalid policy candidate row");
        this.candidates.set(candidate.policy.policyVersion, candidate);
        const numeric = Number(/candidate-(\d+)/.exec(candidate.policy.policyVersion)?.[1] ?? 0);
        if (Number.isFinite(numeric)) this.sequence = Math.max(this.sequence, numeric);
      }
    } catch (error) {
      this.stable = { ...STABLE_POLICY, params: { ...STABLE_POLICY.params } };
      this.stableHistory.length = 0;
      this.candidates.clear();
      this.degraded = `promotion gate unreadable: ${String(error)}`; // stays on the stable policy
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: PromotionGateFile = {
        schemaVersion: 1,
        stablePolicyVersion: this.stable.policyVersion,
        stablePolicies: [...this.stableHistory, this.stable],
        candidates: [...this.candidates.values()]
      };
      writeJson(this.filePath, file);
    } catch (error) {
      this.degraded = `promotion gate persist failed: ${String(error)}`;
    }
  }
}

function summaryOf(outcome: EvaluationSummary): EvaluationSummary {
  return {
    tasksEvaluated: outcome.tasksEvaluated,
    stableMean: outcome.stableMean,
    candidateMean: outcome.candidateMean,
    delta: outcome.delta,
    regressions: outcome.regressions,
    notes: [...outcome.notes]
  };
}
