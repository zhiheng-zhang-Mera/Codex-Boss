import { clamp01 } from "../../../src/shared/adaptive-routing";

/**
 * Engine Phase 9 — contextual exploration policy (pure, deterministic).
 *
 * Pure exploitation would freeze early conclusions, so a BOUNDED amount of
 * exploration is allowed for candidates that are uncertain but potentially
 * competitive (book §13):
 *
 *   Primary  = high expected utility + high confidence
 *   Explorer = uncertain but potentially competitive
 *   Avoid    = low utility + high confidence  (never explored)
 *
 * Guarantees:
 *  - a high-confidence, low-performing candidate is NEVER force-explored (A31);
 *  - at most one explorer per decision (bounded exploration cost);
 *  - the deterministic draw is seeded, so behaviour is reproducible in tests;
 *  - an explicit user pin can never be overridden by an exploration bonus;
 *  - this policy has no authority over eligibility: it only reorders the
 *    candidates the hard layer already produced, so permissions / ExecutionGate /
 *    irreversible-action boundaries are untouched (Engine §16, A38/A39).
 */

export type ExplorationClass = "PRIMARY" | "EXPLORER" | "AVOID";

export interface ExplorationCandidate {
  runtimeId: string;
  expectedUtility: number;
  confidence: number;
}

export interface ExplorationOptions {
  /** Probability of taking the exploratory branch (deterministic draw). */
  epsilon?: number;
  /** Maximum utility bonus granted to the chosen explorer. */
  uncertaintyBonus?: number;
  /** Confidence below which a candidate counts as uncertain. */
  uncertainBelowConfidence?: number;
  /** Utility below which a confident candidate is avoided outright. */
  avoidBelowUtility?: number;
  /** How far below the best utility a candidate may still be "competitive". */
  competitivenessMargin?: number;
  /** Explicit user pin — always keeps the top position. */
  pinnedRuntime?: string;
  seed?: number;
}

export interface ExplorationAssignment {
  runtimeId: string;
  class: ExplorationClass;
  baseUtility: number;
  adjustedUtility: number;
  reason: string;
}

export interface ExplorationPlan {
  assignments: ExplorationAssignment[];
  /** Ordered runtime ids after exploration adjustment. */
  order: string[];
  explore: boolean;
  explorerId?: string;
  selectedRuntimeId?: string;
  reason: string;
}

const DEFAULTS = {
  epsilon: 0.15,
  uncertaintyBonus: 0.12,
  uncertainBelowConfidence: 0.5,
  avoidBelowUtility: -0.1,
  competitivenessMargin: 0.35,
  seed: 1
} as const;

function deterministicDraw(seed: number, salt: string): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < salt.length; index++) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}

export function planExploration(candidates: ExplorationCandidate[], options: ExplorationOptions = {}): ExplorationPlan {
  const epsilon = options.epsilon ?? DEFAULTS.epsilon;
  const uncertaintyBonus = options.uncertaintyBonus ?? DEFAULTS.uncertaintyBonus;
  const uncertainBelow = options.uncertainBelowConfidence ?? DEFAULTS.uncertainBelowConfidence;
  const avoidBelow = options.avoidBelowUtility ?? DEFAULTS.avoidBelowUtility;
  const margin = options.competitivenessMargin ?? DEFAULTS.competitivenessMargin;
  const seed = options.seed ?? DEFAULTS.seed;
  const pinned = options.pinnedRuntime;

  if (!candidates.length) {
    return { assignments: [], order: [], explore: false, reason: "no candidates" };
  }
  const bestUtility = Math.max(...candidates.map((candidate) => candidate.expectedUtility));

  const classified = candidates.map((candidate) => {
    const confident = candidate.confidence >= uncertainBelow;
    const competitive = candidate.expectedUtility >= bestUtility - margin;
    if (confident && candidate.expectedUtility < avoidBelow) {
      return { candidate, class: "AVOID" as ExplorationClass, reason: `confident low utility ${candidate.expectedUtility.toFixed(3)} (conf ${candidate.confidence}) → avoided, never explored` };
    }
    if (!confident && competitive) {
      return { candidate, class: "EXPLORER" as ExplorationClass, reason: `uncertain (conf ${candidate.confidence}) but competitive (${candidate.expectedUtility.toFixed(3)}) → exploration candidate` };
    }
    return { candidate, class: "PRIMARY" as ExplorationClass, reason: `primary candidate (utility ${candidate.expectedUtility.toFixed(3)}, conf ${candidate.confidence})` };
  });

  // Deterministic: pick the most uncertain competitive explorer (tie by id).
  const explorers = classified
    .filter((entry) => entry.class === "EXPLORER")
    .sort((a, b) => a.candidate.confidence - b.candidate.confidence || a.candidate.runtimeId.localeCompare(b.candidate.runtimeId));
  const explorer = explorers[0];
  const salt = `${candidates.map((candidate) => candidate.runtimeId).join(",")}|${bestUtility.toFixed(4)}`;
  const draw = deterministicDraw(seed, salt);
  const explore = Boolean(explorer) && draw < epsilon;

  const assignments: ExplorationAssignment[] = classified.map((entry) => {
    const isExplorer = explore && explorer?.candidate.runtimeId === entry.candidate.runtimeId;
    const adjusted = isExplorer ? clamp01(entry.candidate.expectedUtility + uncertaintyBonus) : entry.candidate.expectedUtility;
    return {
      runtimeId: entry.candidate.runtimeId,
      class: entry.class,
      baseUtility: entry.candidate.expectedUtility,
      adjustedUtility: Number(adjusted.toFixed(4)),
      reason: isExplorer ? `${entry.reason}; exploration bonus +${uncertaintyBonus} (draw ${draw.toFixed(3)} < ε ${epsilon})` : entry.reason
    };
  });

  const order = [...assignments]
    .sort((a, b) => {
      if (pinned) {
        if (a.runtimeId === pinned && b.runtimeId !== pinned) return -1;
        if (b.runtimeId === pinned && a.runtimeId !== pinned) return 1;
      }
      // Exploration must be able to actually SELECT the explorer, not merely
      // nudge its score — otherwise exploration would be a no-op in practice.
      const aExplorer = explore && a.runtimeId === explorer?.candidate.runtimeId;
      const bExplorer = explore && b.runtimeId === explorer?.candidate.runtimeId;
      if (aExplorer !== bExplorer) return aExplorer ? -1 : 1;
      const delta = b.adjustedUtility - a.adjustedUtility;
      if (delta !== 0) return delta;
      return a.runtimeId.localeCompare(b.runtimeId);
    })
    .map((assignment) => assignment.runtimeId);

  return {
    assignments,
    order,
    explore,
    explorerId: explore ? explorer?.candidate.runtimeId : undefined,
    selectedRuntimeId: order[0],
    reason: explore
      ? `bounded exploration of ${explorer?.candidate.runtimeId}`
      : pinned && order[0] === pinned
        ? "explicit pin retained (exploration cannot override)"
        : "exploitation (no exploration warranted)"
  };
}
