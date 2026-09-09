/**
 * R43 Phase G (R-703/R-704): cross-review loop + publication mode (pure).
 *
 * Review is not a one-shot comment: each structured objection gets a
 * response/rebuttal, sections are revised, and re-review proceeds until the
 * meta-review approves or an objection is explicitly retained. PUBLICATION mode
 * additionally requires: research contract present, sufficiency gate PASS,
 * every reviewer responded, meta-review approval. ACCEPTANCE/SMOKE mode stays
 * on the existing (unchanged) fast path.
 */

export type ReviewRole = "METHOD" | "EVIDENCE" | "CLAIM" | "WRITING" | "REPRODUCIBILITY" | "META";

export const REVIEW_ROLES: readonly ReviewRole[] = ["METHOD", "EVIDENCE", "CLAIM", "WRITING", "REPRODUCIBILITY", "META"];

export interface ReviewObjection {
  id: string;
  role: ReviewRole;
  issue: string;
  severity: "major" | "minor";
  revisedSections: string[];
}

export interface ReviewResponse {
  objectionId: string;
  /** Rebuttal text. */
  reply: string;
  /** Sections revised in response. */
  revisedSections: string[];
  /** Explicit retention (only allowed for minor, must carry a reason). */
  retainedReason?: string;
}

export interface ReviewRound {
  roundId: string;
  objections: ReviewObjection[];
  responses: ReviewResponse[];
}

export type ReviewVerdict = "APPROVED" | "REVISE";

/** Appends responses; validation: every response targets an existing objection. */
export function respondToObjections(round: ReviewRound, responses: ReviewResponse[]): ReviewRound {
  for (const response of responses) {
    if (!round.objections.some((objection) => objection.id === response.objectionId)) throw new Error(`Unknown objection ${response.objectionId}`);
  }
  const merged = [...round.responses];
  for (const response of responses) {
    const index = merged.findIndex((item) => item.objectionId === response.objectionId);
    if (index >= 0) merged[index] = response; else merged.push(response);
  }
  return { ...round, responses: merged };
}

/** A round is settled when every objection has a response and each is either
 *  addressed (revisedSections) or explicitly retained (minor only). */
export function reviewRoundSettled(round: ReviewRound): { settled: boolean; open: string[]; violations: string[] } {
  const open: string[] = [];
  const violations: string[] = [];
  for (const objection of round.objections) {
    const response = round.responses.find((item) => item.objectionId === objection.id);
    if (!response) { open.push(objection.id); continue; }
    if (response.retainedReason && objection.severity === "major") violations.push(`major objection ${objection.id} cannot be merely retained`);
    if (!response.reply?.trim()) violations.push(`objection ${objection.id} has no response`);
  }
  return { settled: open.length === 0 && violations.length === 0, open, violations };
}

/** Meta-review: approve only a settled round whose revisions landed. */
export function metaReview(round: ReviewRound): { verdict: ReviewVerdict; reasons: string[] } {
  const { settled, violations } = reviewRoundSettled(round);
  if (!settled) return { verdict: "REVISE", reasons: [...violations, "open objections remain"] };
  const revised = round.responses.some((response) => response.revisedSections.length);
  return { verdict: revised ? "APPROVED" : "REVISE", reasons: revised ? [] : ["no sections revised"] };
}

export interface PublicationState {
  contractPresent: boolean;
  sufficiencyPassed: boolean;
  reviewSettled: boolean;
  metaApproved: boolean;
}

/** PUBLICATION mode requires the full gate chain; ACCEPTANCE/SMOKE is untouched. */
export function publicationReady(state: PublicationState): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!state.contractPresent) missing.push("research contract missing");
  if (!state.sufficiencyPassed) missing.push("sufficiency gate failed");
  if (!state.reviewSettled) missing.push("review round unsettled");
  if (!state.metaApproved) missing.push("meta-review not approved");
  return { ready: missing.length === 0, missing };
}
