import { interceptForMode, type QuestionInterception, type QuestionKind } from "../../src/shared/owner-result";
import type { InterventionKind } from "../../src/shared/intervention";

/**
 * §18 (Owner-Result.md Rev.2) raise-point interception policy for research
 * guidance waits. A run that is about to pause the whole research supervisor at
 * WAITING_FOR_USER first classifies its question:
 *
 * - AUTOPILOT runs behave as OWNER_RESULT: only a genuine HARD_BLOCKER
 *   (HB1–HB4) may surface; any DECIDABLE question is auto-decided (durable
 *   ledger record) and the run never parks.
 * - GUIDED runs keep the legacy human gate (ASSISTED semantics): everything
 *   still raises; classification is reported only.
 *
 * Deterministic and pure so supervisors and tests share one policy.
 */

export interface ResearchWaitPolicyInput {
  autonomy: "AUTOPILOT" | "GUIDED";
  kind: InterventionKind;
  question: string;
  options?: string[];
}

/** Intervention vocabulary → Owner-Result question-kind axis. */
export function questionKindForInterventionKind(kind: InterventionKind): QuestionKind {
  switch (kind) {
    case "AUTHORIZATION":
    case "LOGIN":
    case "CAPTCHA":
      return "AUTHORIZATION";
    case "BUDGET":
    case "EXTERNAL_ACTION":
      return "EXTERNAL_ACTION";
    case "RESEARCH_SCOPE":
      return "RESEARCH_SCOPE";
    case "DIRECTION":
      return "DIRECTION";
    default:
      return "UNKNOWN";
  }
}

/**
 * Returns the interception verdict for a guidance wait before it is raised.
 * AUTOPILOT ⇒ OWNER_RESULT policy; GUIDED ⇒ ASSISTED (legacy raise). Hard
 * blockers always raise in every mode (contract: only HB may surface to owner).
 */
export function researchWaitInterception(input: ResearchWaitPolicyInput): QuestionInterception {
  const mode = input.autonomy === "AUTOPILOT" ? "OWNER_RESULT" : "ASSISTED";
  return interceptForMode({ text: input.question, kind: questionKindForInterventionKind(input.kind), options: input.options }, mode);
}
