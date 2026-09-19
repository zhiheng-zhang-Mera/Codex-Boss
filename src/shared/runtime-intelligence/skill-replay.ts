/**
 * Runtime Intelligence Plane — historical skill loadout replay.
 *
 * This is the counterfactual half of Phase B. Nothing here changes a real loadout: it takes
 * a task that already ran, asks what minimal loadout the advisor would have chosen, and
 * reports the difference. The rule `PRUNE_CANDIDATE != DELETE` still holds — the output is a
 * comparison, not an instruction.
 *
 * The safety property is structural. A replay's recommended set is the advisor's choice
 * UNIONED with every skill the task actually invoked, so a skill that did work cannot be
 * dropped by construction. A skill that ran and has no card is not dropped either: it is
 * reported as unknown and preserved, because a saving computed by discarding something we
 * cannot describe is not a saving.
 *
 * The honesty property is separate and just as important: a task with no usage telemetry
 * cannot prove that anything was wasted. Its saving is reported in `unprovenTokenSaved`, not
 * in the proven totals, and its risk is `UNKNOWN`. Only tasks with observed usage contribute
 * to `estimatedTokenSaved`, which is the number a report is allowed to quote.
 */

import type { LoadoutRecommendation, SkillCard, SkillHealthSummary, TaskProfile } from "./contracts";
import { recommendLoadout } from "./skill-loadout";

export type UnderLoadingRisk = "NONE" | "LOW" | "HIGH" | "UNKNOWN";

export interface SkillReplayInput {
  task: TaskProfile;
  /** The skills that were actually mounted for the real run. */
  originalSkillIds: readonly string[];
  /** The skills that were actually invoked. The minimum the replay must preserve. */
  usedSkillIds: readonly string[];
  cards: readonly SkillCard[];
  summaries?: readonly SkillHealthSummary[];
}

export interface SkillReplayResult {
  taskId: string;
  originalSkillIds: string[];
  recommendedSkillIds: string[];
  /** Skills mounted for the real run that the replay would not mount. */
  droppedSkillIds: string[];
  /** Mounted skills that were never invoked. Wasted mounting, not evidence of a useless skill. */
  unusedOriginalSkillIds: string[];
  /** Skills the real run invoked, which the replay preserved. */
  preservedUsedSkillIds: string[];
  /** Invoked skills that would have been dropped. Must always be empty; a non-empty value is a defect. */
  droppedUsedSkillIds: string[];
  /** Invoked skills with no card, which are preserved but cannot be costed. */
  uncostedSkillIds: string[];
  suspectedRedundantSkillIds: string[];
  estimatedContextSaved: number;
  estimatedLatencySaved: number;
  estimatedTokenSaved: number;
  /** True when the task's usage was observed, so its saving is evidence rather than a guess. */
  usageObserved: boolean;
  riskOfUnderLoading: UnderLoadingRisk;
  reasons: string[];
}

function costOf(skillId: string, cards: readonly SkillCard[]): { contextTokens: number; latencyMs: number } | undefined {
  const card = cards.find((entry) => entry.skillId === skillId);
  return card === undefined ? undefined : { contextTokens: card.contextTokens, latencyMs: card.baseLatencyMs };
}

/**
 * Replays one historical task.
 *
 * `usageObserved` is the discriminator between a measurement and an assumption: with at
 * least one invoked skill the task's usage was real, and only then is the saving treated as
 * evidence. An empty `usedSkillIds` on a task that mounted skills means nobody recorded what
 * ran, which is not the same as "nothing ran".
 */
export function replaySkillLoadout(input: SkillReplayInput): SkillReplayResult {
  const original = [...new Set(input.originalSkillIds)];
  const used = [...new Set(input.usedSkillIds)];
  const usageObserved = used.length > 0;
  const reasons: string[] = [];

  const recommendation: LoadoutRecommendation = recommendLoadout({
    task: input.task,
    cards: input.cards.filter((card) => original.includes(card.skillId)),
    summaries: input.summaries ?? []
  });

  const uncostedSkillIds = used.filter((skillId) => costOf(skillId, input.cards) === undefined);
  // The advisor's choice, plus every skill that actually ran, plus anything we cannot cost.
  const recommended = [...new Set([...recommendation.mountedSkillIds, ...used, ...uncostedSkillIds])].sort();
  const dropped = original.filter((skillId) => !recommended.includes(skillId));
  const droppedUsed = used.filter((skillId) => !recommended.includes(skillId));
  const unusedOriginal = original.filter((skillId) => !used.includes(skillId));

  if (droppedUsed.length > 0) {
    reasons.push(`DEFECT: an invoked skill would have been dropped (${droppedUsed.join(", ")}); the union with the used set exists to make this impossible`);
  }
  if (uncostedSkillIds.length > 0) {
    reasons.push(`preserved without costing them, because no card describes ${uncostedSkillIds.join(", ")}`);
  }
  if (!usageObserved && original.length > 0) {
    reasons.push("no skill usage was recorded for this task, so any saving here is unproven: it is counted separately and never quoted as a measurement");
  }

  let contextSaved = 0;
  let latencySaved = 0;
  for (const skillId of dropped) {
    const cost = costOf(skillId, input.cards);
    if (cost === undefined) continue;
    contextSaved += cost.contextTokens;
    latencySaved += cost.latencyMs;
  }

  const suspectedRedundant = [
    ...new Set(
      (input.summaries ?? [])
        .filter((summary) => original.includes(summary.skillId) && summary.redundancy > 0 && summary.usageRate < 0.5)
        .map((summary) => summary.skillId)
    )
  ].sort();

  const riskOfUnderLoading: UnderLoadingRisk = (() => {
    if (droppedUsed.length > 0) return "HIGH";
    if (!usageObserved && original.length > 0) return "UNKNOWN";
    if (dropped.length === 0) return "NONE";
    if (uncostedSkillIds.length > 0) return "LOW";
    return "LOW";
  })();

  if (dropped.length === 0 && original.length > 0) reasons.push("the replay would mount exactly what the real run mounted");
  if (riskOfUnderLoading === "LOW") reasons.push(`dropped ${dropped.length} skill(s) that the task never invoked, while preserving every skill it did`);
  if (riskOfUnderLoading === "UNKNOWN") reasons.push("the under-loading risk cannot be assessed without usage telemetry, so it is UNKNOWN rather than LOW");

  return {
    taskId: input.task.taskId,
    originalSkillIds: original,
    recommendedSkillIds: recommended,
    droppedSkillIds: dropped,
    unusedOriginalSkillIds: unusedOriginal,
    preservedUsedSkillIds: used.filter((skillId) => recommended.includes(skillId)),
    droppedUsedSkillIds: droppedUsed,
    uncostedSkillIds,
    suspectedRedundantSkillIds: suspectedRedundant,
    estimatedContextSaved: contextSaved,
    estimatedLatencySaved: latencySaved,
    estimatedTokenSaved: contextSaved,
    usageObserved,
    riskOfUnderLoading,
    reasons
  };
}

export interface SkillReplayAggregate {
  replays: number;
  /** Tasks whose usage was observed, so their savings are evidence. */
  replaysWithUsageObserved: number;
  originalSkillCount: number;
  recommendedSkillCount: number;
  unusedOriginalSkillCount: number;
  droppedUsedSkillCount: number;
  riskCounts: Record<UnderLoadingRisk, number>;
  /** Savings summed over tasks whose usage was observed. These are the quotable numbers. */
  estimatedContextSaved: number;
  estimatedTokenSaved: number;
  estimatedLatencySaved: number;
  /** Savings from tasks with no usage telemetry. Reported, never quoted as a measurement. */
  unprovenContextSaved: number;
  /** The share of originally mounted skill instances the replay would not mount (proven tasks only). */
  loadReduction: number;
  reason: "OK" | "INSUFFICIENT_EVIDENCE";
  notes: string[];
}

/** The minimum number of usage-observed replays before the aggregate is called evidence. */
export const MIN_SKILL_REPLAYS_FOR_EVIDENCE = 5;

/**
 * Aggregates replays.
 *
 * Proven and unproven savings are kept apart all the way to the report, and the verdict is
 * `INSUFFICIENT_EVIDENCE` until enough tasks with observed usage exist. A single task's
 * counterfactual is an anecdote.
 */
export function replaySkillLoadouts(results: readonly SkillReplayResult[]): SkillReplayAggregate {
  const riskCounts: Record<UnderLoadingRisk, number> = { NONE: 0, LOW: 0, HIGH: 0, UNKNOWN: 0 };
  let originalSkillCount = 0;
  let recommendedSkillCount = 0;
  let unusedOriginalSkillCount = 0;
  let droppedUsedSkillCount = 0;
  let provenContext = 0;
  let provenLatency = 0;
  let unprovenContext = 0;
  let proven = 0;

  for (const result of results) {
    riskCounts[result.riskOfUnderLoading] += 1;
    droppedUsedSkillCount += result.droppedUsedSkillIds.length;
    if (result.usageObserved) {
      proven += 1;
      originalSkillCount += result.originalSkillIds.length;
      recommendedSkillCount += result.recommendedSkillIds.length;
      unusedOriginalSkillCount += result.unusedOriginalSkillIds.length;
      provenContext += result.estimatedContextSaved;
      provenLatency += result.estimatedLatencySaved;
    } else {
      unprovenContext += result.estimatedContextSaved;
    }
  }

  const notes: string[] = [];
  if (proven < MIN_SKILL_REPLAYS_FOR_EVIDENCE) {
    notes.push(`${proven} replay(s) with observed usage; the aggregate needs ${MIN_SKILL_REPLAYS_FOR_EVIDENCE} before it is evidence`);
  }
  if (droppedUsedSkillCount > 0) notes.push(`${droppedUsedSkillCount} invoked skill(s) would have been dropped, which is a replay defect`);
  const unknown = riskCounts.UNKNOWN;
  if (unknown > 0) notes.push(`${unknown} replay(s) had no usage telemetry, so their risk is UNKNOWN and their saving is not quoted`);

  return {
    replays: results.length,
    replaysWithUsageObserved: proven,
    originalSkillCount,
    recommendedSkillCount,
    unusedOriginalSkillCount,
    droppedUsedSkillCount,
    riskCounts,
    estimatedContextSaved: provenContext,
    estimatedTokenSaved: provenContext,
    estimatedLatencySaved: provenLatency,
    unprovenContextSaved: unprovenContext,
    loadReduction: originalSkillCount === 0 ? 0 : (originalSkillCount - recommendedSkillCount) / originalSkillCount,
    reason: proven >= MIN_SKILL_REPLAYS_FOR_EVIDENCE ? "OK" : "INSUFFICIENT_EVIDENCE",
    notes
  };
}
