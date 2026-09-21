/**
 * Runtime Intelligence Plane — context and knowledge lifecycle.
 *
 * The plan's rule is `ARCHIVE != DELETE`, and this module enforces it in the type: every
 * placement carries `restorable: true` and the plan carries `deletesNothing: true`. There
 * is no delete function to call, and `requestRestore` is the only operation on a placement,
 * so an archived record can always be brought back — archiving changes where a record
 * lives, never whether it exists.
 *
 * The problem being solved is runtime context load rather than storage: a task should not
 * carry its whole history into every prompt. So the plan is budgeted. Records are ranked,
 * the highest-ranked are injected, and once the injection budget is spent the remaining
 * candidates are demoted to a retrieval candidate with the budget named as the reason —
 * they are not dropped, because "not in this prompt" and "not available" are different.
 *
 * A dependency floor keeps pairs together: if an injected record depends on another
 * record, that dependency may not fall below the retrieval-candidate tier, or the injected
 * record would be citing something the next step cannot fetch.
 *
 * Everything here is pure: the caller supplies `now`.
 */

import {
  RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
  type AdvisoryAuthority,
  type ContextAction,
  type ContextLifecyclePlan,
  type ContextPlacement,
  type ContextRecord,
  type ContextTier
} from "./contracts";

/** The one authority a lifecycle plan carries. */
export const CONTEXT_LIFECYCLE_AUTHORITY: AdvisoryAuthority = "ADVISORY_ONLY";

/** Every threshold the placement is derived from, so a report can quote the rule it applied. */
export const CONTEXT_THRESHOLDS = {
  /** A record used within this window is hot. */
  hotWindowHours: 24,
  /** Within this window a record stays warm even before its score is considered. */
  warmWindowHours: 24 * 7,
  /** Beyond this window a record is archived unless its score still earns it a warmer tier. */
  coldWindowHours: 24 * 90,
  /** Recency half-life: a record last used this long ago scores half the recency weight. */
  recencyHalfLifeHours: 24,
  /** Retrieval count at which the usage term saturates. */
  usageSaturation: 5,
  /** Dependencies at which the dependency term saturates. */
  dependencySaturation: 3,
  /** Token size at which the size penalty saturates. */
  tokenSaturation: 8000,
  /** Score at or above which a record is injected, given it is also recent enough. */
  hotScore: 0.5,
  /** Score at or above which a record stays a retrieval candidate. */
  warmScore: 0.35,
  /** Score at or above which a record is kept in cold storage. */
  coldScore: 0.15,
  /** Default token budget for injected context. */
  hotTokenBudget: 24000
} as const;

export const CONTEXT_SCORE_WEIGHTS = {
  recency: 0.35,
  usage: 0.2,
  success: 0.2,
  dependency: 0.1,
  confidence: 0.15,
  sizePenalty: 0.2
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ageHoursOf(record: ContextRecord, now: string): number {
  const used = Date.parse(record.lastUsedAt);
  const at = Date.parse(now);
  if (!Number.isFinite(used) || !Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (at - used) / 3_600_000);
}

export interface ContextScore {
  id: string;
  score: number;
  ageHours: number;
  terms: Array<{ term: string; weight: number; detail: string }>;
}

/**
 * Scores one record for the current task.
 *
 * An unparseable `lastUsedAt` gives an infinite age, which drives the recency term to
 * zero rather than to a fresh-looking value: a record with no usable timestamp is not
 * treated as recently used.
 */
export function scoreContextRecord(record: ContextRecord, now: string): ContextScore {
  const ageHours = ageHoursOf(record, now);
  const recency = Number.isFinite(ageHours) ? 1 / (1 + ageHours / CONTEXT_THRESHOLDS.recencyHalfLifeHours) : 0;
  const usage = clamp01(record.retrievalCount / CONTEXT_THRESHOLDS.usageSaturation);
  const success = clamp01(record.successContribution);
  const dependency = clamp01(record.dependencyIds.length / CONTEXT_THRESHOLDS.dependencySaturation);
  const confidence = clamp01(record.confidence);
  const sizePenalty = clamp01(record.tokens / CONTEXT_THRESHOLDS.tokenSaturation);
  const score = clamp01(
    CONTEXT_SCORE_WEIGHTS.recency * recency +
      CONTEXT_SCORE_WEIGHTS.usage * usage +
      CONTEXT_SCORE_WEIGHTS.success * success +
      CONTEXT_SCORE_WEIGHTS.dependency * dependency +
      CONTEXT_SCORE_WEIGHTS.confidence * confidence -
      CONTEXT_SCORE_WEIGHTS.sizePenalty * sizePenalty
  );
  return {
    id: record.id,
    score: round(score),
    ageHours: Number.isFinite(ageHours) ? Math.round(ageHours * 100) / 100 : Number.POSITIVE_INFINITY,
    terms: [
      { term: "recency", weight: round(CONTEXT_SCORE_WEIGHTS.recency * recency), detail: Number.isFinite(ageHours) ? `${Math.round(ageHours * 100) / 100}h since last use` : "lastUsedAt is not a usable timestamp" },
      { term: "usage", weight: round(CONTEXT_SCORE_WEIGHTS.usage * usage), detail: `${record.retrievalCount} retrieval(s)` },
      { term: "success", weight: round(CONTEXT_SCORE_WEIGHTS.success * success), detail: `success contribution ${success.toFixed(2)}` },
      { term: "dependency", weight: round(CONTEXT_SCORE_WEIGHTS.dependency * dependency), detail: `${record.dependencyIds.length} dependency(ies)` },
      { term: "confidence", weight: round(CONTEXT_SCORE_WEIGHTS.confidence * confidence), detail: `confidence ${confidence.toFixed(2)}` },
      { term: "size", weight: round(-CONTEXT_SCORE_WEIGHTS.sizePenalty * sizePenalty), detail: `${record.tokens} tokens` }
    ]
  };
}

export interface ContextLifecycleInput {
  taskId: string;
  records: readonly ContextRecord[];
  now: string;
  /** Records this task explicitly asked for; an explicit request is injected regardless of score. */
  requestedIds?: readonly string[];
  hotTokenBudget?: number;
}

/**
 * Places every record into a tier and says why.
 *
 * The budget pass runs after the ranking: a record that would have been injected but does
 * not fit becomes a retrieval candidate with the budget named in its reasons. Nothing is
 * ever removed from the plan, so a caller can always retrieve what was not injected.
 */
export function planContextLifecycle(input: ContextLifecycleInput): ContextLifecyclePlan {
  const requested = new Set(input.requestedIds ?? []);
  const budget = input.hotTokenBudget ?? CONTEXT_THRESHOLDS.hotTokenBudget;
  const scored = input.records.map((record) => ({ record, score: scoreContextRecord(record, input.now) }));
  const byId = new Map(scored.map((entry) => [entry.record.id, entry]));
  const ranked = [...scored].sort((left, right) => (right.score.score === left.score.score ? left.record.id.localeCompare(right.record.id) : right.score.score - left.score.score));

  const placements = new Map<string, ContextPlacement>();
  for (const entry of ranked) {
    const { record, score } = entry;
    const reasons = score.terms.map((term) => `${term.term}: ${term.detail} (${term.weight})`);
    if (record.pinned) {
      placements.set(record.id, { id: record.id, tier: "HOT", action: "INJECT_NOW", score: score.score, reasons: [...reasons, "pinned: a pinned record is never demoted"], restorable: true });
      continue;
    }
    if (requested.has(record.id)) {
      placements.set(record.id, { id: record.id, tier: "HOT", action: "INJECT_NOW", score: score.score, reasons: [...reasons, "explicitly requested for this task"], restorable: true });
      continue;
    }
    const age = score.ageHours;
    const recent = Number.isFinite(age);
    const withinHot = recent && age <= CONTEXT_THRESHOLDS.hotWindowHours;
    const withinWarm = recent && age <= CONTEXT_THRESHOLDS.warmWindowHours;
    const withinCold = recent && age <= CONTEXT_THRESHOLDS.coldWindowHours;
    if (withinHot && score.score >= CONTEXT_THRESHOLDS.hotScore) {
      placements.set(record.id, { id: record.id, tier: "HOT", action: "INJECT_NOW", score: score.score, reasons: [...reasons, `used within ${CONTEXT_THRESHOLDS.hotWindowHours}h and scored at or above ${CONTEXT_THRESHOLDS.hotScore}`], restorable: true });
    } else if (withinWarm || score.score >= CONTEXT_THRESHOLDS.warmScore) {
      placements.set(record.id, { id: record.id, tier: "WARM", action: "CANDIDATE_RETRIEVAL", score: score.score, reasons: [...reasons, withinWarm ? `used within ${CONTEXT_THRESHOLDS.warmWindowHours}h, so it stays a retrieval candidate rather than being injected` : `scored at or above ${CONTEXT_THRESHOLDS.warmScore}, so it stays a retrieval candidate`], restorable: true });
    } else if (withinCold || score.score >= CONTEXT_THRESHOLDS.coldScore) {
      placements.set(record.id, { id: record.id, tier: "COLD", action: "COLD_STORE", score: score.score, reasons: [...reasons, withinCold ? `used within ${CONTEXT_THRESHOLDS.coldWindowHours}h, so it moves to cold storage` : `scored at or above ${CONTEXT_THRESHOLDS.coldScore}, so it moves to cold storage`, "cold storage is retrievable on demand, never deleted"], restorable: true });
    } else {
      placements.set(record.id, { id: record.id, tier: "ARCHIVE", action: "ARCHIVE", score: score.score, reasons: [...reasons, `unused for more than ${CONTEXT_THRESHOLDS.coldWindowHours}h and scored below ${CONTEXT_THRESHOLDS.coldScore}`, "archived: still restorable, and never deleted"], restorable: true });
    }
  }

  /* --------------------------------------------------------- injection budget */
  let projected = 0;
  const injectionOrder = [...placements.values()]
    .filter((placement) => placement.action === "INJECT_NOW")
    .sort((left, right) => (right.score === left.score ? left.id.localeCompare(right.id) : right.score - left.score));
  for (const placement of injectionOrder) {
    const record = byId.get(placement.id)!.record;
    if (projected + record.tokens <= budget) {
      projected += record.tokens;
      continue;
    }
    placements.set(placement.id, {
      id: placement.id,
      tier: "WARM",
      action: "CANDIDATE_RETRIEVAL",
      score: placement.score,
      reasons: [...placement.reasons, `demoted from injection: adding ${record.tokens} tokens would exceed the ${budget}-token budget (${projected} already committed)`],
      restorable: true
    });
  }

  /* -------------------------------------------------------- dependency floor */
  for (const placement of [...placements.values()]) {
    if (placement.action !== "INJECT_NOW") continue;
    const record = byId.get(placement.id)!.record;
    for (const dependencyId of record.dependencyIds) {
      const dependency = placements.get(dependencyId);
      if (!dependency) continue;
      if (dependency.tier === "ARCHIVE" || dependency.tier === "COLD") {
        placements.set(dependencyId, {
          id: dependency.id,
          tier: "WARM",
          action: "CANDIDATE_RETRIEVAL",
          score: dependency.score,
          reasons: [...dependency.reasons, `dependency floor: the injected record ${placement.id} depends on it, so it may not fall below a retrieval candidate`],
          restorable: true
        });
      }
    }
  }

  const finalPlacements = [...placements.values()].sort((left, right) => (left.score === right.score ? left.id.localeCompare(right.id) : right.score - left.score));
  const idsWith = (predicate: (placement: ContextPlacement) => boolean): string[] => finalPlacements.filter(predicate).map((placement) => placement.id);
  const injectedIds = idsWith((placement) => placement.action === "INJECT_NOW");

  return {
    schemaVersion: RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
    kind: "CONTEXT_LIFECYCLE_PLAN",
    taskId: input.taskId,
    createdAt: input.now,
    authority: CONTEXT_LIFECYCLE_AUTHORITY,
    placements: finalPlacements,
    injectedIds,
    candidateIds: idsWith((placement) => placement.action === "CANDIDATE_RETRIEVAL"),
    archivedIds: idsWith((placement) => placement.tier === "ARCHIVE"),
    projectedInjectedTokens: injectedIds.reduce((total, id) => total + (byId.get(id)?.record.tokens ?? 0), 0),
    deletesNothing: true
  };
}

/** The placement of one record in a plan, or `undefined` when the plan does not know it. */
export function placementFor(plan: ContextLifecyclePlan, id: string): ContextPlacement | undefined {
  return plan.placements.find((placement) => placement.id === id);
}

export interface ContextRestoreResult {
  id: string;
  /** The tier the record was in. */
  from: ContextTier;
  action: ContextAction;
  restorable: true;
  note: string;
}

/**
 * Brings a record back, including from ARCHIVE.
 *
 * This is the operational meaning of `ARCHIVE != DELETE`: any id in the plan can be
 * restored, and the result says which tier it came from. There is no failure branch,
 * because there is no tier a record can be lost in.
 */
export function requestRestore(plan: ContextLifecyclePlan, id: string): ContextRestoreResult {
  const placement = placementFor(plan, id);
  if (!placement) {
    return { id, from: "ARCHIVE", action: "CANDIDATE_RETRIEVAL", restorable: true, note: "the plan does not contain this id, so there is nothing to restore from it" };
  }
  return {
    id,
    from: placement.tier,
    action: placement.action,
    restorable: true,
    note: placement.tier === "ARCHIVE"
      ? "restored from ARCHIVE: archiving changed where the record lives, never whether it exists"
      : `restored from ${placement.tier}: the record was already retrievable`
  };
}

/** True when a plan moved a record to a colder tier without losing it. */
export function planMovesWithoutLosing(plan: ContextLifecyclePlan, records: readonly ContextRecord[]): boolean {
  const planned = new Set(plan.placements.map((placement) => placement.id));
  return records.every((record) => planned.has(record.id)) && plan.deletesNothing;
}
