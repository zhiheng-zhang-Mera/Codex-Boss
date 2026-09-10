import { episodeContributesToProfile, type LearningEpisode } from "../../../src/shared/learning-episode";
import { ProviderProfileBuilder } from "../providers/provider-profile";
import { planExploration } from "../routing/exploration-policy";
import type { AdaptivePolicy, EvaluationSummary } from "./policy-candidate";

/**
 * Engine Phase 10 — historical replay (book §14, acceptance A42/A43).
 *
 * A candidate policy is FIRST replayed against the recorded episode history and
 * compared with the current stable policy. Only a replay without regressions is
 * allowed to continue toward shadow evaluation; the replay is deterministic, so
 * the same history always produces the same verdict.
 *
 * Replay semantics (deliberately conservative):
 *  - episodes are grouped per taskId; a group must contain >= 2 distinct runtimes
 *    to be a meaningful routing decision;
 *  - each policy ranks those runtimes using the profiles built from the history
 *    and its own exploration parameters;
 *  - the score of a policy for a group is the OBSERVED semantic completion of the
 *    runtime it would have picked (groups lacking that observation are skipped);
 *  - a regression is a group where the candidate scored worse than stable by more
 *    than `regressionTolerance`.
 */

export interface ReplayOptions {
  regressionTolerance?: number;
  minGroups?: number;
}

export interface ReplayOutcome extends EvaluationSummary {
  passed: boolean;
  skippedGroups: number;
}

export function replayPolicy(policy: AdaptivePolicy, stable: AdaptivePolicy, episodes: LearningEpisode[], options: ReplayOptions = {}): ReplayOutcome {
  const regressionTolerance = options.regressionTolerance ?? 0.05;
  const minGroups = options.minGroups ?? 3;
  const profiles = new ProviderProfileBuilder().buildAll(episodes, { builtAt: "1970-01-01T00:00:00.000Z" });
  const profileFor = (runtimeId: string) => profiles.find((profile) => profile.runtimeId === runtimeId);

  const groups = new Map<string, LearningEpisode[]>();
  for (const episode of episodes) {
    const list = groups.get(episode.taskId) ?? [];
    list.push(episode);
    groups.set(episode.taskId, list);
  }

  let stableTotal = 0;
  let candidateTotal = 0;
  let evaluated = 0;
  let regressions = 0;
  let skipped = 0;
  const notes: string[] = [];

  const observe = (group: LearningEpisode[], runtimeId: string): number | undefined => {
    const hit = group.find((episode) => episode.runtimeId === runtimeId && episodeContributesToProfile(episode));
    return hit?.semanticEvaluation?.axes.completion;
  };

  const choose = (chosenPolicy: AdaptivePolicy, group: LearningEpisode[]): string | undefined => {
    const candidates = [...new Set(group.map((episode) => episode.runtimeId))].sort();
    if (candidates.length < 2) return undefined;
    const scored = candidates.map((runtimeId) => {
      const profile = profileFor(runtimeId);
      const samples = profile?.global.completion.samples ?? 0;
      const completion = samples >= chosenPolicy.params.minSamplesPerProfile ? profile!.global.completion.mean : 0.5; // neutral prior
      const reliability = profile?.global.runtimeReliability.samples ? profile.global.runtimeReliability.mean : 0.8;
      const confidence = samples >= chosenPolicy.params.minSamplesPerProfile ? profile!.global.completion.confidence : 0;
      const utility = Number((completion * completion - (1 - reliability) * 0.5).toFixed(4));
      return { runtimeId, expectedUtility: utility, confidence };
    });
    const plan = planExploration(scored, {
      epsilon: chosenPolicy.params.epsilon,
      uncertaintyBonus: chosenPolicy.params.uncertaintyBonus,
      avoidBelowUtility: chosenPolicy.params.avoidBelowUtility,
      competitivenessMargin: chosenPolicy.params.competitivenessMargin,
      seed: 7
    });
    return plan.selectedRuntimeId;
  };

  for (const [taskId, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const stablePick = choose(stable, group);
    const candidatePick = choose(policy, group);
    if (!stablePick || !candidatePick) {
      skipped += 1;
      continue;
    }
    const stableScore = observe(group, stablePick);
    const candidateScore = observe(group, candidatePick);
    if (stableScore === undefined || candidateScore === undefined) {
      skipped += 1;
      continue;
    }
    evaluated += 1;
    stableTotal += stableScore;
    candidateTotal += candidateScore;
    if (candidateScore < stableScore - regressionTolerance) regressions += 1;
    void taskId;
  }

  const stableMean = evaluated ? Number((stableTotal / evaluated).toFixed(4)) : 0;
  const candidateMean = evaluated ? Number((candidateTotal / evaluated).toFixed(4)) : 0;
  const delta = Number((candidateMean - stableMean).toFixed(4));
  if (evaluated < minGroups) notes.push(`only ${evaluated} replayable group(s) (min ${minGroups})`);
  if (regressions) notes.push(`${regressions} regression group(s) beyond tolerance ${regressionTolerance}`);
  const passed = evaluated >= minGroups && regressions === 0 && delta >= -regressionTolerance;
  return { passed, tasksEvaluated: evaluated, stableMean, candidateMean, delta, regressions, notes, skippedGroups: skipped };
}
