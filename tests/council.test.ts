import { describe, expect, it } from "vitest";
import { buildPeerReviewPrompts, buildSynthesisPrompts, extractCouncilFindings } from "../src/shared/council-engine";
import type { RawArtifact } from "../src/shared/contracts";

function artifact(id: string, providerId: string, kind: RawArtifact["kind"], content: string): RawArtifact {
  return { id, taskId: "task", runId: `run-${id}`, providerId, kind, content, capturedAt: "2026-09-01T00:00:00.000Z", sourceUrl: "https://example.test", untrusted: true };
}

describe("Council protocol", () => {
  it("anonymizes proposals and directs reviewers to use evidence instead of votes", () => {
    const prompts = buildPeerReviewPrompts("decide", [artifact("b", "gemini", "proposal", "B evidence"), artifact("a", "chatgpt", "proposal", "A evidence")], ["claude"]);
    const prompt = prompts.get("claude")!;
    expect(prompt).toContain("Proposal A");
    expect(prompt).not.toContain("chatgpt");
    expect(prompt).toContain("not provider reputation or majority vote");
  });

  it("preserves structured conflicts and minority opinions while ignoring malformed output", () => {
    const reviews = [
      artifact("r1", "claude", "peer_review", 'Review\n{"conflicts":[{"topic":"latency","positions":["cache","no cache"]}],"minorityOpinions":["retain offline mode"]}'),
      artifact("r2", "gemini", "peer_review", "not-json")
    ];
    const analysis = extractCouncilFindings(reviews);
    expect(analysis.conflicts[0]).toEqual(expect.objectContaining({ topic: "latency", positions: ["cache", "no cache"] }));
    expect(analysis.minorityOpinions).toEqual(["retain offline mode"]);
    const synthesis = buildSynthesisPrompts("decide", [], reviews, ["chatgpt"], analysis).get("chatgpt")!;
    expect(synthesis).toContain("Do not decide by vote count");
    expect(synthesis).toContain("retain offline mode");
  });
});
