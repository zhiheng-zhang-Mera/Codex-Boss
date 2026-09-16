/**
 * The OPTIONAL independent review Agent — the kind of stage Gate 8 exists to adjudicate.
 *
 * ## Why this is separate from verification
 *
 * The platform already has a mandatory verification gate: tests, typecheck, acceptance checks and the
 * durable `verificationState` that decides whether a task may be called complete. That gate is a
 * platform INVARIANT. It is present in every completed task, so there is no legal production pipeline
 * that omits it, and a live paired experiment confirmed it can never be an A/B variable — the
 * "without verification" arm does not exist.
 *
 * An independent review is a different thing entirely. It is optional work that costs provider tokens,
 * it is allowed to find nothing, and its only justification is that it catches something the
 * verification gate cannot: a change that passes its tests while still being wrong, incomplete or
 * inconsistent with what the objective actually asked for. That is a claim about cost and benefit, so
 * it is exactly what belongs in a Gate 8 comparison.
 *
 * ## What this module is and is not
 *
 * Pure: prompt construction and response parsing, no I/O, no clock, no provider. The caller supplies
 * the reviewer. That keeps the decision about *whether the review paid for itself* separate from the
 * mechanics of asking for one, and it lets the same code drive a provider-backed reviewer in
 * production and a deterministic one in a test.
 */

/** What a caller asks for, when they want the optional review stage to run. */
export interface OptionalReviewRequest {
  /**
   * How many independent review passes to run.
   *
   * A second pass is a distinct optional stage, not a repeat of the first: it reviews the same diff
   * with the first pass's findings withheld, which is how a review-of-a-review is kept independent
   * rather than merely repeated.
   */
  passes?: number;
  /** Extra context the reviewer should judge against, e.g. the acceptance criteria. */
  acceptance?: string;
}

/** One finding an independent reviewer raised. */
export interface OptionalReviewFinding {
  /** `blocking` findings are defects the reviewer believes must be fixed before completion. */
  severity: "blocking" | "advisory";
  /** What is wrong, in the reviewer's own words. Never invented by this module. */
  summary: string;
}

export interface OptionalReviewOutcome {
  /** Every finding, parsed from the reviewer's reply. Empty is a real answer: the review was clean. */
  findings: OptionalReviewFinding[];
  /** The reviewer's raw reply, kept so a caller can audit the parse rather than trust it. */
  raw: string;
  /** The prompt the reviewer was given, so the evidence a finding rests on is reproducible. */
  prompt: string;
}

/**
 * The review prompt.
 *
 * Deliberately asks for a strict shape and tells the reviewer that finding nothing is an acceptable
 * answer. A prompt that implies findings are expected manufactures them, and a manufactured finding
 * would inflate exactly the benefit this stage is being judged on.
 */
export function optionalReviewPrompt(input: { objective: string; diff: string; acceptance?: string }): string {
  return [
    "You are an INDEPENDENT reviewer of a completed change. You did not write it and you must not assume the author's reasoning.",
    "Judge the change against the objective and the acceptance criteria only. Do not judge style preferences.",
    "Report ONLY defects that would make the change wrong, incomplete, or inconsistent with the objective:",
    "a missing case, a behaviour that contradicts the stated goal, a claim in the summary the diff does not support, or a regression the tests do not cover.",
    "If the change satisfies the objective, say so. Finding nothing is a valid and expected answer; do not invent findings to appear useful.",
    "Return strict JSON only: {\"findings\":[{\"severity\":\"blocking\"|\"advisory\",\"summary\":\"...\"}]}",
    "",
    `OBJECTIVE: ${input.objective}`,
    ...(input.acceptance ? [`ACCEPTANCE CRITERIA: ${input.acceptance}`] : []),
    "",
    "DIFF UNDER REVIEW:",
    input.diff
  ].join("\n");
}

/**
 * Parse a reviewer's reply.
 *
 * Fail-closed in the direction that matters: a reply that cannot be parsed yields NO findings rather
 * than a fabricated one, because a phantom finding would credit the review stage with benefit it did
 * not produce. The raw reply travels with the outcome so the caller can see that the parse was empty
 * rather than the review being clean.
 */
export function parseOptionalReview(raw: string): OptionalReviewFinding[] {
  const fenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fenced);
  } catch {
    return [];
  }
  const findings = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(findings)) return [];
  return findings.flatMap((entry): OptionalReviewFinding[] => {
    const value = entry as { severity?: unknown; summary?: unknown };
    if (typeof value?.summary !== "string" || !value.summary.trim()) return [];
    return [{ severity: value.severity === "blocking" ? "blocking" : "advisory", summary: value.summary.trim() }];
  });
}

/**
 * Run the optional review stage.
 *
 * The reviewer is injected. `passes` runs that many independent passes and concatenates their
 * findings, so a two-pass review is measurable as one stage with more work rather than as two
 * stages with the same name.
 */
export async function runOptionalReview(input: {
  request: OptionalReviewRequest;
  objective: string;
  diff: string;
  /** One independent review pass. Rejected promise = the pass failed, which is reported not hidden. */
  reviewer: (prompt: string, pass: number) => Promise<string>;
}): Promise<OptionalReviewOutcome[]> {
  const passes = Math.max(1, Math.min(2, Math.trunc(input.request.passes ?? 1)));
  const outcomes: OptionalReviewOutcome[] = [];
  for (let pass = 1; pass <= passes; pass++) {
    // The acceptance criteria travel with every pass; the earlier passes' findings deliberately do
    // not, so pass two is independent rather than an echo of pass one.
    const prompt = optionalReviewPrompt({ objective: input.objective, diff: input.diff, ...(input.request.acceptance ? { acceptance: input.request.acceptance } : {}) });
    const raw = await input.reviewer(prompt, pass);
    outcomes.push({ findings: parseOptionalReview(raw), raw, prompt });
  }
  return outcomes;
}
