import { structuralSignature, tokensOfSignature, type ConceptPrototype } from "../../../src/shared/learned-concept";
import type { LearningEpisode } from "../../../src/shared/learning-episode";
import { ConceptRegistry, type ConceptMutationResult } from "./concept-registry";

/**
 * Engine Phase 7 — concept miner (deterministic, fail-open).
 *
 * Mines semantic clusters from episode history WITHOUT a hard-coded topic enum:
 * the structural signature of each task fingerprint forms the cluster key, and
 * an optional embedding vector refines the prototype when one exists. Mining a
 * cluster that was never seen before simply creates a new concept — no schema
 * migration, no enum edit (A21).
 *
 * The miner never throws: a broken miner leaves previously learned concepts in
 * place and basic routing keeps working (A29).
 */

export interface ConceptMinerOptions {
  /** Minimum cluster support to create/reinforce a concept. */
  minSupport?: number;
  /** Resolve an episode's semantic vector (when an embedding backend is wired). */
  vectorOf?: (episode: LearningEpisode) => number[] | undefined;
  vectorRefOf?: (episode: LearningEpisode) => string | undefined;
}

export interface ConceptMiningResult {
  created: string[];
  promoted: string[];
  reinforced: string[];
  skippedEpisodes: number;
  errors: string[];
}

export class ConceptMiner {
  private readonly minSupport: number;
  private readonly vectorOf?: (episode: LearningEpisode) => number[] | undefined;
  private readonly vectorRefOf?: (episode: LearningEpisode) => string | undefined;

  constructor(private readonly registry: ConceptRegistry, options: ConceptMinerOptions = {}) {
    this.minSupport = options.minSupport ?? 2;
    this.vectorOf = options.vectorOf;
    this.vectorRefOf = options.vectorRefOf;
  }

  /** Mine the registry from a full episode history (idempotent per episode id). */
  mine(episodes: LearningEpisode[], at = new Date().toISOString()): ConceptMiningResult {
    const result: ConceptMiningResult = { created: [], promoted: [], reinforced: [], skippedEpisodes: 0, errors: [] };
    const seenSupport = new Map<string, Set<string>>(); // signature → episode ids (dedup per episode)
    for (const episode of episodes) {
      const fingerprint = episode.taskFingerprint;
      if (!fingerprint || !fingerprint.role) {
        result.skippedEpisodes += 1;
        continue;
      }
      const signature = structuralSignature(fingerprint);
      const support = seenSupport.get(signature) ?? new Set<string>();
      support.add(episode.episodeId);
      seenSupport.set(signature, support);
    }
    for (const [signature, episodeIds] of [...seenSupport.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (episodeIds.size < this.minSupport) {
        result.skippedEpisodes += episodeIds.size;
        continue;
      }
      try {
        const firstEpisode = episodes.find((episode) => episodeIds.has(episode.episodeId))!;
        const prototype: ConceptPrototype = {
          kind: this.vectorRefOf?.(firstEpisode) ? "embedding" : "structural",
          signature,
          vectorRef: this.vectorRefOf?.(firstEpisode),
          tokens: tokensOfSignature(signature)
        };
        const existing = this.registry.find(prototype, 0.999);
        if (existing) {
          for (const episodeId of episodeIds) {
            const mutation = this.registry.reinforce(existing.conceptId, { signature, vectorRef: prototype.vectorRef, episodeId, at });
            if (mutation.promoted) result.promoted.push(existing.conceptId);
          }
          result.reinforced.push(existing.conceptId);
          continue;
        }
        let conceptId: string | undefined;
        for (const episodeId of episodeIds) {
          const mutation: ConceptMutationResult = this.registry.upsert(prototype, { signature, vectorRef: prototype.vectorRef, episodeId, at });
          conceptId = mutation.concept.conceptId;
          if (mutation.promoted) result.promoted.push(conceptId);
        }
        if (conceptId) result.created.push(conceptId);
        void this.vectorOf; // vectors refine clustering in later phases; structural mining is canonical
      } catch (error) {
        result.errors.push(`cluster ${signature}: ${String(error)}`);
      }
    }
    return result;
  }
}
