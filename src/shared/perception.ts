/**
 * Perception–Action loop contracts (plan AP24 / §24). Pure and shareable.
 *
 * A closed act → observe → critic → requirement-compare → revise loop over a
 * software surface. Only key frames are retained (before / after / error /
 * final) so evidence stays bounded and auditable; the critic is deterministic
 * so "requirement compare" never depends on model self-report.
 */

export type PerceptionFrameKind = "before" | "after" | "error" | "final";
export const PERCEPTION_FRAME_KINDS: readonly PerceptionFrameKind[] = ["before", "after", "error", "final"];

/** A captured frame of the surface at a loop milestone. */
export interface PerceptionFrame {
  kind: PerceptionFrameKind;
  at: string;
  /** Surface identity (e.g. vision:surfaceId) the frame was captured from. */
  surfaceId?: string;
  /** Local path of the captured image, when a real frame exists. */
  imagePath?: string;
  /** Deterministic observation text associated with the frame (OCR/page text). */
  text?: string;
}

/** Verifiable requirement: the goal plus literals the observation must contain. */
export interface PerceptionRequirement {
  goal: string;
  /** Deterministic pass condition — every literal must appear in the observed text. */
  mustContain: string[];
}

export interface RequirementCritique {
  passed: boolean;
  missing: string[];
}

/**
 * Deterministic requirement compare: the observation passes when every
 * mustContain literal is present (case-insensitive). Missing literals are
 * first-class so a revise step can re-target precisely.
 */
export function critiqueRequirement(observation: string, requirement: PerceptionRequirement): RequirementCritique {
  const normalized = observation.toLocaleLowerCase();
  const missing = requirement.mustContain.filter((literal) => !normalized.includes(literal.toLocaleLowerCase()));
  return { passed: missing.length === 0, missing };
}

export type PerceptionOutcome = "PASSED" | "FAILED" | "STOPPED";

export interface PerceptionEpisode {
  id: string;
  requirement: PerceptionRequirement;
  /** Bounded attempt log (labels only — never model private reasoning). */
  steps: string[];
  /** Retained key frames only (≤ one per kind, plan §24). */
  frames: PerceptionFrame[];
  outcome: PerceptionOutcome;
  attempts: number;
  /** Why the loop stopped, surfaced for the operator. */
  reason: string;
  startedAt: string;
  completedAt: string;
}

/**
 * Key-frame retention policy (plan §24): of the frames captured during a loop,
 * only the milestones before / after / error / final are kept, newest wins per
 * kind, and the frame list never grows with revision attempts. Unknown kinds
 * are rejected (fail closed).
 */
export function retainKeyFrames(frames: PerceptionFrame[]): PerceptionFrame[] {
  const seen = new Map<PerceptionFrameKind, PerceptionFrame>();
  for (const frame of frames) {
    if (!PERCEPTION_FRAME_KINDS.includes(frame.kind)) throw new Error(`Unknown perception frame kind: ${String((frame as { kind?: string }).kind)}`);
    seen.set(frame.kind, frame);
  }
  return PERCEPTION_FRAME_KINDS.filter((kind) => seen.has(kind)).map((kind) => seen.get(kind)!);
}

export function validatePerceptionRequirement(requirement: PerceptionRequirement): void {
  if (!requirement || typeof requirement.goal !== "string" || !requirement.goal.trim() || requirement.goal.length > 20000) throw new Error("Perception goal must be 1–20000 characters");
  if (!Array.isArray(requirement.mustContain) || requirement.mustContain.length < 1 || requirement.mustContain.length > 20) throw new Error("Perception requirement must declare 1–20 mustContain literals");
  for (const literal of requirement.mustContain) {
    if (typeof literal !== "string" || !literal.trim() || literal.length > 1000) throw new Error("Invalid mustContain literal");
  }
}

export function validatePerceptionFrame(frame: PerceptionFrame): void {
  if (!frame || !PERCEPTION_FRAME_KINDS.includes(frame.kind) || typeof frame.at !== "string" || !frame.at) throw new Error("Invalid perception frame");
  if (frame.surfaceId !== undefined && (typeof frame.surfaceId !== "string" || !frame.surfaceId || frame.surfaceId.length > 150)) throw new Error("Invalid perception frame surface");
  if (frame.imagePath !== undefined && (typeof frame.imagePath !== "string" || frame.imagePath.length > 1000)) throw new Error("Invalid perception frame image path");
  if (frame.text !== undefined && (typeof frame.text !== "string" || frame.text.length > 100000)) throw new Error("Invalid perception frame text");
}
