import { prototypeSimilarity, type LearnedConcept } from "../../../src/shared/learned-concept";
import { episodeContributesToProfile, type LearningEpisode } from "../../../src/shared/learning-episode";
import { ConceptRegistry } from "./concept-registry";

/**
 * Engine Phase 7 — concept merge (book §4.2).
 *
 * Merge condition: two concepts are semantic neighbours AND their provider
 * outcome distributions have been highly consistent for a long time. The merge
 * itself is a registry operation: the absorbed concept is marked MERGED with a
 * pointer to the survivor and its history is preserved.
 */

export interface MergeCandidate {
  primaryId: string;
  secondaryId: string;
  similarity: number;
  outcomeDelta: number;
  reason: string;
}

export interface MergeOptions {
  similarityThreshold?: number;
  maxOutcomeDelta?: number;
  minSamples?: number;
}

function meanCompletion(episodes: LearningEpisode[], conceptId: string): { mean: number; samples: number } {
  const scoped = episodes.filter(
    (episode) => episodeContributesToProfile(episode) && (episode.taskFingerprint.concepts ?? []).some((concept) => concept.conceptId === conceptId)
  );
  if (!scoped.length) return { mean: 0, samples: 0 };
  const mean = scoped.reduce((sum, episode) => sum + (episode.semanticEvaluation?.axes.completion ?? 0), 0) / scoped.length;
  return { mean, samples: scoped.length };
}

/** Deterministic merge-candidate detection over the registry. */
export function findMergeCandidates(registry: ConceptRegistry, episodes: LearningEpisode[], options: MergeOptions = {}): MergeCandidate[] {
  const similarityThreshold = options.similarityThreshold ?? 0.8;
  const maxOutcomeDelta = options.maxOutcomeDelta ?? 0.08;
  const minSamples = options.minSamples ?? 4;
  const concepts = registry.usable().sort((a, b) => a.conceptId.localeCompare(b.conceptId));
  const candidates: MergeCandidate[] = [];
  for (let left = 0; left < concepts.length; left++) {
    for (let right = left + 1; right < concepts.length; right++) {
      const a = concepts[left];
      const b = concepts[right];
      const similarity = prototypeSimilarity(a.prototype, b.prototype);
      if (similarity < similarityThreshold) continue;
      const outcomeA = meanCompletion(episodes, a.conceptId);
      const outcomeB = meanCompletion(episodes, b.conceptId);
      if (outcomeA.samples < minSamples || outcomeB.samples < minSamples) continue;
      const outcomeDelta = Number(Math.abs(outcomeA.mean - outcomeB.mean).toFixed(4));
      if (outcomeDelta > maxOutcomeDelta) continue;
      candidates.push({
        primaryId: a.conceptId,
        secondaryId: b.conceptId,
        similarity,
        outcomeDelta,
        reason: `similarity ${similarity} with consistent outcomes (delta ${outcomeDelta} over ${outcomeA.samples}/${outcomeB.samples} samples)`
      });
    }
  }
  return candidates;
}

/** Apply a merge through the registry (auditable, history preserved). */
export function applyMerge(registry: ConceptRegistry, candidate: MergeCandidate, at = new Date().toISOString()): { merged: LearnedConcept; absorbed: LearnedConcept } | undefined {
  return registry.absorb(candidate.primaryId, candidate.secondaryId, at);
}
