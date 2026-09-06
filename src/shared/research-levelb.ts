/**
 * Level-B research selection core (plan 9-6 Phase 8). Pure and shareable.
 *
 * Given candidate research questions produced by repo inspection + web-AI
 * reviewers, the supervisor selects a falsifiable question whose hypothesis is
 * testable by a deterministic experiment, then runs the protocol. Decisions
 * follow the plan's rule: evidence > vote — a claim backed by verified
 * experiment evidence outranks majority opinion that lacks evidence.
 */

export interface CandidateQuestion {
  id: string;
  question: string;
  hypothesis?: string;
  /** Whether a deterministic experiment can produce a measurable primary metric. */
  measurable: boolean;
  /** Whether the hypothesis can be falsified (a disconfirming outcome exists). */
  falsifiable: boolean;
  proposedBy: string;   // reviewer/runtime id
  noveltyScore?: number;
  feasibilityScore?: number;
}

export interface QuestionSelection {
  selectedId: string | null;
  rejected: Array<{ id: string; reason: string }>;
  reason: string;
}

/** A question is research-ready only when both measurable and falsifiable. */
export function isFalsifiable(candidate: Pick<CandidateQuestion, "measurable" | "falsifiable">): boolean {
  return candidate.measurable && candidate.falsifiable;
}

export function validateCandidateQuestion(candidate: CandidateQuestion): void {
  if (!candidate || typeof candidate.id !== "string" || !candidate.id) throw new Error("Candidate requires an id");
  if (typeof candidate.question !== "string" || !candidate.question.trim() || candidate.question.length > 2000) throw new Error("Candidate question invalid");
  if (typeof candidate.proposedBy !== "string" || !candidate.proposedBy.trim()) throw new Error("Candidate requires a proposer");
}

/**
 * Selects the falsifiable candidate with the best (novelty + feasibility)
 * heuristic; unmeasurable/unfalsifiable candidates are rejected with reasons
 * (never silently dropped). Evidence > vote: novelty/feasibility heuristics may
 * rank proposals, but a hypothesis may only be adopted when a protocol can
 * produce falsifying evidence — it is never adopted by reviewer vote alone.
 */
export function selectFalsifiableQuestion(candidates: CandidateQuestion[]): QuestionSelection {
  const rejected: Array<{ id: string; reason: string }> = [];
  const ready: CandidateQuestion[] = [];
  for (const candidate of candidates) {
    validateCandidateQuestion(candidate);
    if (!candidate.measurable) { rejected.push({ id: candidate.id, reason: "no measurable primary metric proposed" }); continue; }
    if (!candidate.falsifiable) { rejected.push({ id: candidate.id, reason: "hypothesis is not falsifiable" }); continue; }
    ready.push(candidate);
  }
  if (!ready.length) return { selectedId: null, rejected, reason: rejected.length ? "no falsifiable candidate" : "no candidates" };
  const best = [...ready].sort((a, b) => score(b) - score(a))[0];
  return { selectedId: best.id, rejected, reason: `falsifiable + measurable: ${best.question}` };
}

function score(candidate: CandidateQuestion): number {
  return (candidate.noveltyScore ?? 0) + (candidate.feasibilityScore ?? 0);
}
