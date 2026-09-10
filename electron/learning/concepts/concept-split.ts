import type { LearnedConcept } from "../../../src/shared/learned-concept";
import { episodeContributesToProfile, type LearningEpisode } from "../../../src/shared/learning-episode";
import { ConceptRegistry } from "./concept-registry";

/**
 * Engine Phase 7 — concept split (book §4.2).
 *
 * Split condition: a single concept contains a STABLE, clearly different
 * distribution of provider behaviour. Detection is deterministic: split the
 * concept's episodes by observed completion (high vs low) and require both sides
 * to have enough samples plus a large enough mean separation.
 */

export interface SplitOptions {
  minSamplesPerSide?: number;
  minMeanSeparation?: number;
  splitThreshold?: number;
}

export interface SplitProposal {
  conceptId: string;
  high: string[];
  low: string[];
  highMean: number;
  lowMean: number;
  separation: number;
  reason: string;
}

function completionOf(episode: LearningEpisode): number | undefined {
  return episodeContributesToProfile(episode) ? episode.semanticEvaluation!.axes.completion : undefined;
}

/** Deterministic split proposal for one concept (undefined when behaviour is uniform). */
export function proposeSplit(registry: ConceptRegistry, episodes: LearningEpisode[], conceptId: string, options: SplitOptions = {}): SplitProposal | undefined {
  const concept = registry.get(conceptId);
  if (!concept) return undefined;
  const minSamplesPerSide = options.minSamplesPerSide ?? 3;
  const minMeanSeparation = options.minMeanSeparation ?? 0.35;
  const splitThreshold = options.splitThreshold ?? 0.5;
  const scoped = episodes.filter((episode) => (episode.taskFingerprint.concepts ?? []).some((item) => item.conceptId === conceptId));
  const high: string[] = [];
  const low: string[] = [];
  for (const episode of scoped) {
    const completion = completionOf(episode);
    if (completion === undefined) continue;
    if (completion >= splitThreshold) high.push(episode.episodeId);
    else low.push(episode.episodeId);
  }
  if (high.length < minSamplesPerSide || low.length < minSamplesPerSide) return undefined;
  const meanOf = (ids: string[]) => {
    const values = scoped.filter((episode) => ids.includes(episode.episodeId)).map((episode) => completionOf(episode) ?? 0);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  const highMean = Number(meanOf(high).toFixed(4));
  const lowMean = Number(meanOf(low).toFixed(4));
  const separation = Number(Math.abs(highMean - lowMean).toFixed(4));
  if (separation < minMeanSeparation) return undefined;
  return {
    conceptId,
    high,
    low,
    highMean,
    lowMean,
    separation,
    reason: `bimodal behaviour: ${high.length} episodes at ${highMean} vs ${low.length} at ${lowMean} (separation ${separation})`
  };
}

/** Apply a split through the registry: parent ⇒ SPLIT with pointers, children created. */
export function applySplit(registry: ConceptRegistry, proposal: SplitProposal, at = new Date().toISOString()): LearnedConcept[] {
  const parent = registry.get(proposal.conceptId);
  if (!parent) return [];
  return registry.split(
    proposal.conceptId,
    [
      { signature: `${parent.prototype.signature}#high`, displayName: `${parent.displayName} (strong)`, episodeIds: proposal.high },
      { signature: `${parent.prototype.signature}#low`, displayName: `${parent.displayName} (weak)`, episodeIds: proposal.low }
    ],
    at
  );
}
