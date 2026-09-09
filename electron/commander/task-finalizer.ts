import { reviewResponse } from "../../src/shared/execution";
import { currentArtifactIds } from "../../src/shared/final-response";
import { randomUUID } from "node:crypto";
import type { FinalizationPolicy, FinalResponse } from "../../src/shared/contracts";
import { buildEvidenceBundle } from "../evidence-engine";
import type { StateStore } from "../store";
import { continuationFor } from "./continuation-router";

/**
 * U3 (plan §2.3/§4, Evidence>Vote): an auto-published final response may never
 * carry unresolved structured claims (DISPUTED / INSUFFICIENT) or unresolved
 * disputes as if adjudicated. When the evidence bundle over the accepted
 * artifacts is HOLD_FOR_REVIEW for those reasons, finalization parks the task
 * at READY_FOR_USER_REVIEW instead of writing a completed final; the operator
 * either rehydrates (resolve the claims) or explicitly accepts the held
 * evidence (store.setEvidenceDecision → PASS) before publication.
 *
 * Direct single/multi-provider answers (no structured claims) and clean
 * councils keep the existing auto-publish behavior — their bundles decide
 * PASS because no claim is DISPUTED/INSUFFICIENT and no dispute remains.
 */
function evidenceHoldsUnresolvedClaims(bundle: import("../../src/shared/contracts").EvidenceBundle): boolean {
  if (bundle.decision !== "HOLD_FOR_REVIEW") return false;
  return bundle.disputes.length > 0 || bundle.claims.some((claim) => claim.status === "DISPUTED" || claim.status === "INSUFFICIENT");
}

/** Publishes accepted output, optionally synthesized by the controller; never executes worker instructions. */
export class TaskFinalizer {
  private readonly pending = new Map<string, Promise<FinalResponse | undefined>>();
  constructor(private readonly store: StateStore, private readonly publish: () => unknown = () => {},
    private readonly synthesize?: (taskId: string) => Promise<string | undefined>,
    /**
     * §20–§22 verification gate (Owner-Result.md Rev.2). When the task carries a
     * verification contract this hook returns the durable verdict of its
     * risk-gated plan (PASS or REWORK + the gates that are missing). REWORK means
     * MODEL_DONE must not become a completed final — fail-closed.
     */
    private readonly verificationGate?: (taskId: string) => { verdict: "PASS" | "REWORK"; missing: readonly string[] } | undefined) {}

  finalize(taskId: string, policy?: FinalizationPolicy): Promise<FinalResponse | undefined> {
    const pending = this.pending.get(taskId);
    if (pending) return pending;
    const work = this.finish(taskId, policy).finally(() => this.pending.delete(taskId));
    this.pending.set(taskId, work);
    return work;
  }

  private async finish(taskId: string, policy?: FinalizationPolicy): Promise<FinalResponse | undefined> {
    const existing = this.store.finalResponseForTask(taskId);
    if (existing) return existing;
    const snapshot = this.store.snapshot();
    if (continuationFor(snapshot, taskId) !== "COMPLETE") return;
    const task = snapshot.tasks.find((item) => item.id === taskId)!;
    const runs = snapshot.runs.filter((run) => run.taskId === taskId);
    const round = Math.max(...runs.map((run) => run.round));
    const ids = runs.filter((run) => run.round === round).map((run) => run.artifactId);
    const artifacts = ids.map((id) => snapshot.artifacts.find((item) => item.id === id));
    if (artifacts.some((item) => !item || !item.content.trim())) throw new Error("Accepted final artifacts missing");
    const accepted = artifacts.filter((item) => item !== undefined);
    const council = snapshot.councils.find((item) => item.taskId === taskId);
    let bundle = snapshot.evidenceBundles.find((item) => item.taskId === taskId && accepted.every(artifact => item.manifest.some(entry => entry.artifactId === artifact.id)));
    if (!bundle) { bundle = buildEvidenceBundle(task, snapshot.artifacts, council); this.store.saveEvidence(bundle); }
    // U3 Evidence>Vote gate: never auto-publish a final while the accepted
    // evidence bundle still holds unresolved structured claims or disputes.
    if (evidenceHoldsUnresolvedClaims(bundle)) {
      this.store.setEvidenceDecision(bundle.id, "READY_FOR_USER_REVIEW");
      this.store.setFinalizationPolicy(taskId, policy ?? task.finalizationPolicy ?? "DIRECT", "证据存在未决争议（DISPUTED/INSUFFICIENT claims 或 disputes）。请先选择性回填，或明确确认接收当前证据后再交付最终答复。");
      this.store.setTaskStatus(taskId, "waiting");
      this.publish();
      return;
    }
    // §20 fail-closed: a task under a verification contract may not finalize
    // while its risk-gated verification plan is REWORK (missing gates). This
    // guard sits inside the finalizer so every entry point (plan completion,
    // synthesis recovery, explicit finalize) obeys MODEL_DONE ≠ COMPLETED.
    if (this.verificationGate) {
      const gate = this.verificationGate(taskId);
      if (gate && gate.verdict === "REWORK") {
        const detail = gate.missing.length ? gate.missing.join(", ") : "全部验证门";
        this.store.setFinalizationPolicy(taskId, policy ?? task.finalizationPolicy ?? "DIRECT", `验证门未通过（MODEL_DONE ≠ COMPLETED）：缺少 ${detail}。请先补齐验证证据或修复后重跑，任务不会被标记完成。`);
        this.store.setTaskStatus(taskId, "waiting");
        this.publish();
        return;
      }
    }
    const effectivePolicy = policy ?? task.finalizationPolicy ?? (accepted.length === 1 ? "DIRECT" : "CODEX_IF_AVAILABLE");
    this.store.setFinalizationPolicy(taskId, effectivePolicy);
    let synthesis: string | undefined;
    if (effectivePolicy !== "DIRECT") {
      try { synthesis = await this.synthesize?.(taskId); } catch { /* Optional runtime failure retains accepted answers. */ }
      if (continuationFor(this.store.snapshot(), taskId) !== "COMPLETE" || JSON.stringify(currentArtifactIds(this.store.snapshot(), taskId)) !== JSON.stringify(accepted.map(item => item.id).sort())) return;
      if (synthesis?.trim() && reviewResponse({ taskId, workerId: "codex:cli", responseId: "final-synthesis", content: synthesis, outcome: "SUCCESS" }, { mode: "BALANCED", maxRetries: 0, output: task.reviewPolicy?.output }).status !== "PASS") synthesis = undefined;
      if (!synthesis?.trim() && effectivePolicy === "CODEX_REQUIRED") {
        this.store.setFinalizationPolicy(taskId, effectivePolicy, "Required Codex synthesis unavailable; accepted answer retained. Retry when runtime is available.");
        this.store.setTaskStatus(taskId, "waiting");

        this.publish(); return;
      }
    }
    if (JSON.stringify(currentArtifactIds(this.store.snapshot(), taskId)) !== JSON.stringify(accepted.map(item => item.id).sort())) return;
    // A user may pause or cancel while synthesis is in flight.
    if (continuationFor(this.store.snapshot(), taskId) !== "COMPLETE") return;
    this.store.setFinalizationPolicy(taskId, effectivePolicy);
    const response: FinalResponse = { id: randomUUID(), taskId, conversationId: task.conversationId,
      source: synthesis?.trim() ? "codex_synthesis" : council ? "council_synthesis" : accepted.length === 1 && !["commander:plan", "native:tools"].includes(accepted[0].providerId) ? "worker" : "deterministic",
      content: synthesis?.trim() || (accepted.length === 1 ? accepted[0].content : accepted.map((item) => `${item.providerId}\n\n${item.content}`).join("\n\n---\n\n")),
      evidenceBundleId: bundle.id, sourceArtifactIds: accepted.map((item) => item.id), finalizedAt: new Date().toISOString() };
    this.store.saveFinalResponse(response);
    this.publish();
    return response;
  }
}
