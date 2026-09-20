/**
 * Runtime Intelligence Plane — skill cards and the shadow loadout evaluator.
 *
 * The plan's boundary for skills is one sentence: `PRUNE_CANDIDATE != DELETE`. That is
 * enforced structurally here — this module has no delete, remove, uninstall or prune
 * function, and `LoadoutRecommendation` can only say "mount" or "do not mount". A
 * `PRUNE_CANDIDATE` is a state a card is reported in, and the only consequence is that a
 * later loadout stops mounting it; the card and its source stay exactly where they are.
 *
 * Two facts are deliberately kept apart because conflating them hides the waste this
 * plane exists to find: a skill `selected` for a task and a skill `used` during it. A
 * skill that is mounted on every prompt and never invoked costs context and latency on
 * every task, and `unusedSelections` is that cost made visible.
 */

import {
  SKILL_STATES,
  type LoadoutRecommendation,
  type ReasoningFactor,
  type SkillCard,
  type SkillHealthSummary,
  type SkillState,
  type SkillStateAssessment,
  type SkillUsageTelemetry,
  type TaskProfile
} from "./contracts";

/** The thresholds a state is derived from. Exported so a report can quote the rule it applied. */
export const SKILL_THRESHOLDS = {
  /** Share of selections that must be followed by an invocation to count as hot. */
  hotUsageRate: 0.6,
  /** At or below this share a selected skill is rare rather than warm. */
  rareUsageRate: 0.25,
  /** Below this many selections no state beyond COLD is asserted from usage alone. */
  minSelectionsForState: 2,
  /** Unused selections needed before a redundant skill may be called a prune candidate. */
  minUnusedForPrune: 3,
  /** Tokens per prompt above which mounting is "high overhead". */
  highOverheadContextTokens: 4000,
  /** Mounting latency above which mounting is "high overhead". */
  highOverheadLatencyMs: 1500,
  /** A skill whose successes are mostly attributable to it. */
  minSuccessContribution: 0.6
} as const;

/** Ordering used by the recommender: earlier is preferred. */
export const SKILL_STATE_RANK: Readonly<Record<SkillState, number>> = {
  HOT: 0,
  WARM: 1,
  COLD: 2,
  RARE: 3,
  REDUNDANT: 4,
  PRUNE_CANDIDATE: 5
};

function union(values: readonly (readonly string[])[]): string[] {
  return [...new Set(values.flat())].sort();
}

/**
 * Aggregates one skill's telemetry.
 *
 * `successContribution` counts only telemetry where the skill was actually invoked: a
 * success on a task where the skill never ran is not evidence for the skill, which is why
 * an unused skill reports 0 rather than the task's success rate.
 */
export function summarizeSkillTelemetry(skillId: string, telemetry: readonly SkillUsageTelemetry[]): SkillHealthSummary {
  const entries = telemetry.filter((entry) => entry.skillId === skillId);
  const selections = entries.filter((entry) => entry.selected).length;
  const used = entries.filter((entry) => entry.used);
  const invocations = entries.reduce((total, entry) => total + (entry.used ? entry.invocationCount : 0), 0);
  const unusedSelections = entries.filter((entry) => entry.selected && !entry.used).length;
  const successes = used.filter((entry) => entry.success).length;
  const failures = used.filter((entry) => !entry.success).length;
  return {
    skillId,
    selections,
    uses: used.length,
    invocations,
    unusedSelections,
    usageRate: selections === 0 ? 0 : used.length / selections,
    contextTokensMounted: entries.reduce((total, entry) => total + (entry.selected ? entry.contextTokens : 0), 0),
    latencyMsMounted: entries.reduce((total, entry) => total + (entry.selected ? entry.latencyMs : 0), 0),
    successes,
    failures,
    successContribution: used.length === 0 ? 0 : successes / used.length,
    failureAssociation: used.length === 0 ? 0 : failures / used.length,
    conflicts: union(entries.map((entry) => entry.conflictsWith)),
    redundancy: union(entries.map((entry) => entry.overlappingWith)).length
  };
}

/** True when mounting this skill costs more than the thresholds allow for its usage rate. */
export function isHighOverhead(summary: SkillHealthSummary): boolean {
  return summary.contextTokensMounted >= SKILL_THRESHOLDS.highOverheadContextTokens || summary.latencyMsMounted >= SKILL_THRESHOLDS.highOverheadLatencyMs;
}

/**
 * Derives the state, first match wins, and always with the reasons that produced it.
 *
 * `PRUNE_CANDIDATE` requires BOTH evidence of waste (at least
 * `minUnusedForPrune` selections that never invoked the skill) and a replacement
 * (`redundancy >= 1`). A skill that is merely unused is `COLD` — a cold skill is kept
 * available, which is the whole difference between cold and pruned.
 */
export function classifySkillState(summary: SkillHealthSummary): SkillStateAssessment {
  const reasons: string[] = [];
  const rank = (state: SkillState, detail: string): SkillStateAssessment => ({ skillId: summary.skillId, state, reasons: [...reasons, detail], summary });

  if (summary.selections === 0) {
    reasons.push("never selected for any observed task");
    return rank("COLD", "kept available: no evidence of waste exists, and no evidence of value either");
  }

  if (summary.unusedSelections >= SKILL_THRESHOLDS.minUnusedForPrune && summary.redundancy >= 1) {
    reasons.push(`mounted ${summary.unusedSelections} time(s) and never invoked`);
    reasons.push(`${summary.redundancy} other skill(s) serve the same capability`);
    return rank("PRUNE_CANDIDATE", "recommendation only: the card is NOT deleted, and no code is removed");
  }

  if (summary.redundancy >= 1 && summary.usageRate < 0.5) {
    reasons.push(`usage rate ${summary.usageRate.toFixed(2)} while ${summary.redundancy} skill(s) overlap it`);
    return rank("REDUNDANT", "another mounted skill covers the same capability with better usage");
  }

  if (isHighOverhead(summary) && summary.usageRate < 0.5) {
    reasons.push(`mounting costs ${summary.contextTokensMounted} tokens and ${summary.latencyMsMounted}ms across ${summary.selections} selection(s)`);
    return rank("COLD", `high overhead for a usage rate of ${summary.usageRate.toFixed(2)}`);
  }

  if (summary.usageRate >= SKILL_THRESHOLDS.hotUsageRate && summary.selections >= SKILL_THRESHOLDS.minSelectionsForState) {
    reasons.push(`invoked on ${summary.uses} of ${summary.selections} selections`);
    return rank("HOT", "consistently used and worth its mounting cost");
  }

  if (summary.usageRate <= SKILL_THRESHOLDS.rareUsageRate) {
    reasons.push(`usage rate ${summary.usageRate.toFixed(2)} is at or below ${SKILL_THRESHOLDS.rareUsageRate}`);
    return rank("RARE", "keep mounted only for the task kinds that actually invoke it");
  }

  reasons.push(`usage rate ${summary.usageRate.toFixed(2)}`);
  return rank("WARM", "ordinary usage; no action recommended");
}

export interface LoadoutInput {
  task: TaskProfile;
  cards: readonly SkillCard[];
  summaries?: readonly SkillHealthSummary[];
  /** Skills an operator pinned; a pin is mounted regardless of state. */
  pinned?: readonly string[];
  /** Token budget for the mounted instructions, when one applies. */
  maxContextTokens?: number;
}

function summaryFor(card: SkillCard, summaries: readonly SkillHealthSummary[]): SkillHealthSummary {
  return summaries.find((summary) => summary.skillId === card.skillId) ?? summarizeSkillTelemetry(card.skillId, []);
}

/**
 * Recommends a loadout: what to mount, what to omit, and why.
 *
 * Fail-closed on unknown need: a task that declares no capability gets no skill, because
 * there is nothing a mounting decision could be justified by. Capability coverage is the
 * first sort key and the skill state is the second, so a redundant skill is only dropped
 * when another mounted card already covers the capability.
 */
export function recommendLoadout(input: LoadoutInput): LoadoutRecommendation {
  const pinned = new Set(input.pinned ?? []);
  const summaries = input.summaries ?? [];
  const factors: ReasoningFactor[] = [];
  const omittedBecause: Array<{ skillId: string; reason: string }> = [];
  const required = [...new Set(input.task.requiredCapabilities.map((token) => token.trim()).filter(Boolean))];

  if (required.length === 0) {
    factors.push({
      factor: "task.capabilities",
      weight: 0,
      detail: "the task declares no capability, so no skill can be justified",
      evidence: [input.task.taskId]
    });
    return {
      taskId: input.task.taskId,
      authority: "ADVISORY_ONLY",
      mountedSkillIds: input.cards.filter((card) => pinned.has(card.skillId)).map((card) => card.skillId),
      omittedSkillIds: input.cards.filter((card) => !pinned.has(card.skillId)).map((card) => card.skillId),
      omittedBecause: input.cards.filter((card) => !pinned.has(card.skillId)).map((card) => ({ skillId: card.skillId, reason: "the task declares no capability for this skill to serve" })),
      projectedContextTokens: 0,
      projectedLatencyMs: 0,
      factors
    };
  }

  const relevant = input.cards.filter((card) => card.providesCapabilities.some((capability) => required.includes(capability)));
  for (const card of input.cards) {
    if (!relevant.includes(card)) omittedBecause.push({ skillId: card.skillId, reason: `serves none of this task's capabilities (${required.join(", ")})` });
  }

  const scored = relevant
    .map((card) => {
      const summary = summaryFor(card, summaries);
      const assessment = classifySkillState(summary);
      const coverage = card.providesCapabilities.filter((capability) => required.includes(capability)).length;
      return { card, summary, assessment, coverage };
    })
    .sort((left, right) => {
      if (left.coverage !== right.coverage) return right.coverage - left.coverage;
      const rankDifference = SKILL_STATE_RANK[left.assessment.state] - SKILL_STATE_RANK[right.assessment.state];
      if (rankDifference !== 0) return rankDifference;
      if (left.card.contextTokens !== right.card.contextTokens) return left.card.contextTokens - right.card.contextTokens;
      return left.card.skillId.localeCompare(right.card.skillId);
    });

  const mounted: string[] = [];
  const covered = new Set<string>();
  let projectedContextTokens = 0;
  let projectedLatencyMs = 0;

  for (const entry of scored) {
    if (pinned.has(entry.card.skillId)) {
      mounted.push(entry.card.skillId);
      projectedContextTokens += entry.card.contextTokens;
      projectedLatencyMs += entry.card.baseLatencyMs;
      for (const capability of entry.card.providesCapabilities) covered.add(capability);
      factors.push({ factor: "skill.pinned", weight: 0, detail: `${entry.card.skillId} is pinned and is mounted regardless of its state`, evidence: [entry.card.skillId] });
      continue;
    }
    const newCapabilities = entry.card.providesCapabilities.filter((capability) => required.includes(capability) && !covered.has(capability));
    if (newCapabilities.length === 0) {
      omittedBecause.push({ skillId: entry.card.skillId, reason: `every capability it serves (${entry.card.providesCapabilities.join(", ")}) is already covered by a mounted skill` });
      continue;
    }
    if (entry.assessment.state === "PRUNE_CANDIDATE" || entry.assessment.state === "REDUNDANT") {
      omittedBecause.push({ skillId: entry.card.skillId, reason: `${entry.assessment.state}: ${entry.assessment.reasons.join("; ")}` });
      continue;
    }
    if (input.maxContextTokens !== undefined && projectedContextTokens + entry.card.contextTokens > input.maxContextTokens) {
      omittedBecause.push({ skillId: entry.card.skillId, reason: `mounting it would exceed the ${input.maxContextTokens}-token loadout budget` });
      continue;
    }
    mounted.push(entry.card.skillId);
    projectedContextTokens += entry.card.contextTokens;
    projectedLatencyMs += entry.card.baseLatencyMs;
    for (const capability of entry.card.providesCapabilities) covered.add(capability);
    factors.push({
      factor: `skill.${entry.assessment.state.toLowerCase()}`,
      weight: entry.coverage,
      detail: `${entry.card.skillId} covers ${newCapabilities.join(", ")} and is ${entry.assessment.state}`,
      evidence: [entry.card.skillId, ...newCapabilities]
    });
  }

  const uncovered = required.filter((capability) => !covered.has(capability));
  if (uncovered.length > 0) {
    factors.push({
      factor: "capability.uncovered",
      weight: uncovered.length,
      detail: `no available skill card covers ${uncovered.join(", ")}; this is reported rather than papered over`,
      evidence: uncovered
    });
  }

  return {
    taskId: input.task.taskId,
    authority: "ADVISORY_ONLY",
    mountedSkillIds: mounted,
    omittedSkillIds: [...input.cards.map((card) => card.skillId).filter((skillId) => !mounted.includes(skillId))],
    omittedBecause,
    projectedContextTokens,
    projectedLatencyMs,
    factors
  };
}

export interface LoadoutShadowInput {
  observationId: string;
  taskId: string;
  recommended: readonly string[];
  actual: readonly string[];
  used: readonly string[];
  cards: readonly SkillCard[];
}

export interface LoadoutShadowEvaluation {
  observationId: string;
  taskId: string;
  /** Whether the executed loadout matched the recommendation exactly. */
  followed: boolean;
  /** Mounted skills that were never invoked — the measurable cost of the loadout. */
  unusedMounted: string[];
  /** Skills that ran even though the recommendation omitted them. */
  usedButOmitted: string[];
  /** Skills the recommendation wanted but that were not mounted. */
  recommendedButNotMounted: string[];
  /** Token overhead actually paid for skills that did nothing. */
  wastedContextTokens: number;
  findings: string[];
  /** Literal, so a caller cannot mistake this evaluation for permission to delete a card. */
  deletesNothing: true;
}

/**
 * Compares what was recommended with what happened, without changing anything.
 *
 * This is the shadow half of Phase B: the executed loadout is the real one, and the
 * evaluation only reports where the advice and reality diverged. It never edits a card,
 * never lowers a skill's availability, and never removes anything.
 */
export function evaluateLoadoutShadow(input: LoadoutShadowInput): LoadoutShadowEvaluation {
  const recommended = [...new Set(input.recommended)];
  const actual = [...new Set(input.actual)];
  const used = new Set(input.used);
  const unusedMounted = actual.filter((skillId) => !used.has(skillId));
  const usedButOmitted = [...used].filter((skillId) => !recommended.includes(skillId)).sort();
  const recommendedButNotMounted = recommended.filter((skillId) => !actual.includes(skillId)).sort();
  const tokenCost = new Map(input.cards.map((card) => [card.skillId, card.contextTokens]));
  const wastedContextTokens = unusedMounted.reduce((total, skillId) => total + (tokenCost.get(skillId) ?? 0), 0);

  const findings: string[] = [];
  if (recommendedButNotMounted.length > 0) findings.push(`recommended but not mounted: ${recommendedButNotMounted.join(", ")} — the recommendation did not reach execution`);
  if (usedButOmitted.length > 0) findings.push(`used though omitted: ${usedButOmitted.join(", ")} — the recommendation would have missed a skill that helped`);
  if (unusedMounted.length > 0) findings.push(`mounted but unused: ${unusedMounted.join(", ")} — ${wastedContextTokens} tokens of prompt overhead produced no invocation`);
  if (findings.length === 0) findings.push("the executed loadout matched the recommendation and every mounted skill was invoked");

  return {
    observationId: input.observationId,
    taskId: input.taskId,
    followed: recommended.length === actual.length && recommended.every((skillId, index) => skillId === actual[index]),
    unusedMounted,
    usedButOmitted,
    recommendedButNotMounted,
    wastedContextTokens,
    findings,
    deletesNothing: true
  };
}

/** The declared vocabulary, re-exported so a report and the classifier cannot drift apart. */
export const SKILL_STATE_VOCABULARY: readonly SkillState[] = SKILL_STATES;
