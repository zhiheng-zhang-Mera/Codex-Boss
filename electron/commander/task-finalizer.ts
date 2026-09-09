import { reviewResponse } from "../../src/shared/execution";
import { currentArtifactIds } from "../../src/shared/final-response";
import { randomUUID } from "node:crypto";
import type { FinalizationPolicy, FinalResponse } from "../../src/shared/contracts";
import { buildEvidenceBundle } from "../evidence-engine";
import type { StateStore } from "../store";
import { continuationFor } from "./continuation-router";

/** Publishes accepted output, optionally synthesized by the controller; never executes worker instructions. */
export class TaskFinalizer {
  private readonly pending = new Map<string, Promise<FinalResponse | undefined>>();
  constructor(private readonly store: StateStore, private readonly publish: () => unknown = () => {},
    private readonly synthesize?: (taskId: string) => Promise<string | undefined>) {}

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
