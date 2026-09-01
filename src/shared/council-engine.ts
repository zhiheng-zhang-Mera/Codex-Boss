import type { CouncilFinding, ProviderId, RawArtifact } from "./contracts";

export interface CouncilAnalysis {
  conflicts: CouncilFinding[];
  minorityOpinions: string[];
}

function anonymousBundle(artifacts: RawArtifact[]): string {
  return artifacts
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((artifact, index) => `## Proposal ${String.fromCharCode(65 + index)}\n${artifact.content}`)
    .join("\n\n");
}

export function buildPeerReviewPrompts(originalPrompt: string, artifacts: RawArtifact[], reviewers: ProviderId[]): Map<ProviderId, string> {
  const bundle = anonymousBundle(artifacts);
  return new Map(reviewers.map((providerId) => [providerId, `You are an anonymous peer reviewer in a multi-AI council. Review evidence and reasoning, not provider reputation or majority vote. Preserve credible minority positions.\n\nOriginal task:\n${originalPrompt}\n\nAnonymous proposals:\n${bundle}\n\nReturn a concise review followed by one JSON object with this exact shape:\n{"conflicts":[{"topic":"...","positions":["...","..."]}],"minorityOpinions":["..."]}`]));
}

export function buildSynthesisPrompts(originalPrompt: string, proposals: RawArtifact[], reviews: RawArtifact[], synthesizers: ProviderId[], analysis: CouncilAnalysis): Map<ProviderId, string> {
  const proposalBundle = anonymousBundle(proposals);
  const reviewBundle = anonymousBundle(reviews);
  return new Map(synthesizers.map((providerId) => [providerId, `You are a synthesis member in a multi-AI council. Produce a decision-ready answer grounded in evidence. Do not decide by vote count. State unresolved conflicts, preserve credible minority views, and distinguish observed evidence from inference.\n\nOriginal task:\n${originalPrompt}\n\nAnonymous proposals:\n${proposalBundle}\n\nAnonymous peer reviews:\n${reviewBundle}\n\nDetected conflicts:\n${JSON.stringify(analysis.conflicts)}\n\nMinority opinions to preserve:\n${JSON.stringify(analysis.minorityOpinions)}\n\nEnd with one JSON object using this exact shape. evidenceLabels may contain only labels such as Proposal A from the bundle above:\n{"claims":[{"text":"...","evidenceLabels":["Proposal A"]}]}`]));
}

export function extractCouncilFindings(reviews: RawArtifact[]): CouncilAnalysis {
  const conflicts: CouncilFinding[] = [];
  const minorityOpinions: string[] = [];
  for (const review of reviews) {
    const matches = review.content.matchAll(/\{[\s\S]*?"minorityOpinions"[\s\S]*?\}/g);
    for (const match of matches) {
      try {
        const parsed = JSON.parse(match[0]) as { conflicts?: Array<{ topic?: unknown; positions?: unknown }>; minorityOpinions?: unknown };
        for (const conflict of parsed.conflicts ?? []) {
          if (typeof conflict.topic !== "string" || !Array.isArray(conflict.positions)) continue;
          const positions = conflict.positions.filter((item): item is string => typeof item === "string");
          if (positions.length >= 2) conflicts.push({ topic: conflict.topic, positions, providerIds: [review.providerId] });
        }
        if (Array.isArray(parsed.minorityOpinions)) minorityOpinions.push(...parsed.minorityOpinions.filter((item): item is string => typeof item === "string"));
      } catch {
        // Raw external output is allowed to be malformed; it is ignored rather than repaired or promoted to evidence.
      }
    }
  }
  return { conflicts, minorityOpinions: [...new Set(minorityOpinions)] };
}
