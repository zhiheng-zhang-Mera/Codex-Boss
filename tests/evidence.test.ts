import { describe, expect, it } from "vitest";
import { buildEvidenceBundle, buildRehydrationPrompts } from "../electron/evidence-engine";
import type { BossTask, CouncilSession, RawArtifact } from "../src/shared/contracts";

const task: BossTask = { id: "task", title: "verify", prompt: "Choose a cache policy", providerIds: ["chatgpt", "gemini", "claude"], status: "completed", mode: "council", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
const council: CouncilSession = { id: "council", taskId: task.id, stage: "completed", providerIds: task.providerIds, round: 3, conflicts: [{ topic: "latency", positions: ["cache", "no cache"], providerIds: ["claude"] }], minorityOpinions: ["offline mode"], createdAt: task.createdAt, updatedAt: task.updatedAt };

function artifact(id: string, providerId: string, kind: RawArtifact["kind"], content: string): RawArtifact {
  return { id, taskId: task.id, runId: `run-${id}`, providerId, kind, content, capturedAt: task.createdAt, sourceUrl: "https://example.test", untrusted: true };
}

describe("Phase 4 evidence engine", () => {
  it("hashes every artifact and keeps referenced claims disputed when conflicts remain", () => {
    const artifacts = [
      artifact("a", "chatgpt", "proposal", "cache evidence"),
      artifact("b", "gemini", "proposal", "no cache evidence"),
      artifact("r", "claude", "peer_review", "latency conflict"),
      artifact("s", "chatgpt", "synthesis", 'Summary\n{"claims":[{"text":"Latency improves with cache","evidenceLabels":["Proposal A"]}]}')
    ];
    const bundle = buildEvidenceBundle(task, artifacts, council);
    expect(bundle.manifest).toHaveLength(4);
    expect(bundle.integrityRoot).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.claims[0]).toEqual(expect.objectContaining({ status: "DISPUTED", evidenceArtifactIds: expect.arrayContaining(["a", "s"]) }));
    expect(bundle.disputes).toHaveLength(1);
    expect(bundle.missingProviderIds).toEqual([]);
    expect(bundle.decision).toBe("HOLD_FOR_REVIEW");
  });

  it("fails closed on malformed synthesis and limits rehydration context", () => {
    const relevant = artifact("s", "chatgpt", "synthesis", "unstructured answer");
    const unrelated = artifact("x", "gemini", "peer_review", "unrelated secret context");
    const bundle = buildEvidenceBundle(task, [relevant, unrelated], { ...council, conflicts: [] });
    expect(bundle.claims[0].status).toBe("INSUFFICIENT");
    expect(bundle.missingProviderIds).toEqual(["claude"]);
    const prompt = buildRehydrationPrompts(task, bundle, [relevant, unrelated], ["claude"]).get("claude")!;
    expect(prompt).toContain("unstructured answer");
    expect(prompt).not.toContain("unrelated secret context");
  });
});
