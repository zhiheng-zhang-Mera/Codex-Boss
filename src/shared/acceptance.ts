/**
 * Objective satisfaction — the acceptance model Phase 07 exists to build.
 *
 * ## The gap this closes
 *
 * Phase 06's goal loop can prove three things about a change: it compiles, the suite is green, and the
 * diff is clean. A real dogfooding run then produced a test whose round-trip case passed an **empty**
 * array, and the loop reported `CONVERGED` — because none of those three checks can tell a meaningful
 * assertion from a vacuous one. That is `PF-DEBT-011`, recorded as an evidence-tier note precisely
 * because the host *cannot* judge assertion quality and should not pretend to.
 *
 * This module is the honest version of that judgement. It does not ask a model whether the work "looks
 * right"; it states what a claim requires, reads what was actually observed, and answers
 * `SATISFIED` / `INSUFFICIENT_EVIDENCE` / `CONTRADICTED` — failing closed on everything it cannot
 * establish.
 *
 * ## The chain
 *
 *     Objective        the user's goal, verbatim
 *       ↓
 *     AcceptanceClaim  a VERIFIABLE statement, not a command outcome
 *       ↓
 *     EvidenceObligation  what evidence would support the claim
 *       ↓
 *     ObservedEvidence    what was actually found
 *       ↓
 *     SatisfactionResult  the verdict, per claim and overall
 *
 * ## What must never become acceptance
 *
 * `Update-Plan/Platform-Foundation/Phase-07-Semantic-Acceptance.md` §4 names the rule: `tests > 0`,
 * `assertions > 0`, a coverage percentage, "the file exists", and `exit 0` are PROXIES, not acceptance.
 * They are recorded as `weakSignals` so a reader can see them, and they are structurally incapable of
 * satisfying a mandatory claim: no obligation below accepts them. The specific regression that document
 * names — a test covering only `roundTrip([])` cannot establish "roundTrip works for arbitrary non-empty
 * supported values" — is enforced by `assertionShape`, which reads the arguments a case actually
 * exercises.
 *
 * Pure: no clock, no I/O, no network, no model. A verdict is reproducible from the evidence it cites.
 */

/** Where a claim came from, so a consumer knows how much to trust its formulation. */
type ClaimSource = "declared" | "extracted";

/**
 * How strongly a claim must be satisfied.
 *
 * `mandatory` claims decide the objective. `advisory` claims are reported and never block — they exist so
 * a consumer can surface a weaker observation without letting it veto the work.
 */
type ClaimCriticality = "mandatory" | "advisory";

/**
 * One verifiable statement about the objective.
 *
 * Deliberately NOT a command outcome. *"the serializer round-trips arbitrary supported values"* is a
 * claim; *"the test command exits 0"* is not, and cannot be expressed as one here.
 */
export interface AcceptanceClaim {
  id: string;
  /** The statement, phrased so a reader could say whether the evidence supports it. */
  statement: string;
  criticality: ClaimCriticality;
  source: ClaimSource;
  /** Which part of the objective it addresses, when known. */
  addresses?: string;
}

/**
 * What evidence would support a claim.
 *
 * Eight kinds, and each is a different SHAPE of evidence rather than a quantity. A claim needing
 * `non-empty-cases` cannot be satisfied by `error-cases`, however many of either there are — which is
 * what makes the model resistant to the count-based proxies the phase forbids.
 */
type ObligationKind =
  | "non-empty-cases"
  | "boundary-cases"
  | "error-cases"
  | "invariant"
  | "regression-suite"
  | "static-check"
  | "contradiction-check"
  | "no-evidence-required";

export interface EvidenceObligation {
  id: string;
  claimId: string;
  kind: ObligationKind;
  /** What a reader should be able to point at when this is met. */
  requires: string;
  mandatory: boolean;
}

/**
 * What was actually observed.
 *
 * `discriminating` is the load-bearing field. An observation is discriminating when it could have
 * FAILED had the claim been false — an assertion over a non-empty representative input can fail; an
 * assertion over `[]` mostly cannot. Evidence that cannot fail is not evidence, and the judgement below
 * will not count it.
 */
export interface ObservedEvidence {
  id: string;
  claimId: string;
  kind: ObligationKind;
  /** The command, file or check the observation came from, so a reader can re-run it. */
  source: string;
  /** Whether the observation passed. A failed check is evidence too — of contradiction. */
  passed: boolean;
  /** Whether this observation could have failed had the claim been false. */
  discriminating: boolean;
  /** Cases actually exercised, when the evidence is a test. */
  cases?: AssertionShape[];
  detail?: string;
}

/**
 * The shape of one assertion site, read from the test source rather than assumed.
 *
 * This is where a vacuous test is caught, deterministically and without a model: an assertion is weak
 * when its arguments are all empty, or when it asserts only that something is defined/truthy.
 */
export interface AssertionShape {
  /** Where it is, e.g. `tests/x.test.ts:12`. */
  at: string;
  /**
   * Literal shapes of every operand the case puts in play.
   *
   * Both sides matter. The assertion's own operands say what is being compared; the ARGUMENTS of the
   * calls the case makes say what input the behaviour is being exercised WITH. A test whose assertion is
   * rich but which only ever feeds `roundTrip([])` is still vacuous about non-empty values — and that was
   * the real Phase 06 run, where `expect(result).toEqual({ status: "ok", interventions: [] })` reads as a
   * substantial assertion and the emptiness lives in the input.
   */
  operandShapes: OperandShape[];
  /** The matcher or assertion name, e.g. `toEqual`, `toBe`, `toBeDefined`. */
  assertion: string;
  /** Call arguments seen in this case, so a reader can see what input was exercised. */
  callArguments?: string[];
  /**
   * Whether the assertion compares the behaviour's result against the very input it was given.
   *
   * The shape that can actually fail. `expect(result).toEqual(input)` is refuted by any implementation
   * that drops or mangles `input`; `expect(result).toEqual({ status: "ok" })` is refuted by nothing except
   * a wrong status string, so it cannot carry a claim about round-tripping.
   */
  echoOfInput?: boolean;
}

/** The literal shape of one operand, reduced to what decides strength. */
export type OperandShape = "empty-literal" | "empty-collection" | "non-empty-literal" | "variable" | "unknown";

export type ClaimVerdict = "SATISFIED" | "INSUFFICIENT_EVIDENCE" | "CONTRADICTED";

export interface ClaimSatisfaction {
  claimId: string;
  statement: string;
  criticality: ClaimCriticality;
  verdict: ClaimVerdict;
  /** Every reason, so a refusal names each gap rather than the first. */
  reasons: string[];
  satisfiedObligations: string[];
  unsatisfiedObligations: string[];
}

export interface SatisfactionResult {
  verdict: ClaimVerdict;
  claims: ClaimSatisfaction[];
  /** Signals that were present but are structurally incapable of satisfying a claim. */
  weakSignals: string[];
  /**
   * Why the overall verdict is what it is. For `SATISFIED` this names the claims that carried it; for a
   * refusal it names what was missing.
   */
  reasons: string[];
}

/* -------------------------------------------------------------------------- */
/* Assertion strength                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Assertions that cannot fail for a non-trivial reason.
 *
 * `toBeDefined`/`toBeTruthy`/`not.toBeNull` are the classic shape of a test that passes without checking
 * anything a reader would call the behaviour. They are only weak when they are ALL a case has, which is
 * why this is consulted per-case rather than per-file.
 */
const NON_DISCRIMINATING_ASSERTIONS = new Set([
  "toBeDefined", "toBeTruthy", "toBeNull", "toBeUndefined", "toBeInstanceOf",
  "not.toBeNull", "not.toBeUndefined", "not.toBeDefined", "not.toBeFalsy"
]);

/**
 * Whether one assertion site is capable of failing.
 *
 * The rule the phase names: an assertion over ONLY empty literals cannot establish a property of
 * non-empty supported values. `roundTrip([])` may exercise a real code path, but it cannot show that
 * `roundTrip` works for the inputs the claim is about.
 *
 * Two shapes count as empty, and the distinction matters for honesty rather than for strictness:
 *
 *  - `empty-literal` — the operand IS `[]`, `{}`, `""`, `0`;
 *  - `empty-collection` — the operand is a collection that CONTAINS nothing, e.g. `{ interventions: [] }`.
 *    Nothing in it varies, so an assertion over only those still cannot fail for the reason the claim
 *    cares about. A mixed literal like `{ status: "ok", interventions: [] }` is NOT in this category: it
 *    carries a real value, so it can discriminate.
 */
export function assertionDiscriminates(shape: AssertionShape): { discriminating: boolean; reason: string } {
  if (NON_DISCRIMINATING_ASSERTIONS.has(shape.assertion)) {
    return { discriminating: false, reason: `${shape.at} asserts only \`${shape.assertion}\`, which passes for almost any value` };
  }
  if (shape.operandShapes.length === 0) {
    return { discriminating: false, reason: `${shape.at} carries no readable operand, so what it exercises cannot be established` };
  }
  if (shape.operandShapes.some((operand) => operand === "unknown")) {
    // Unreadable stays unreadable rather than being assumed strong.
    return { discriminating: false, reason: `${shape.at} has an operand that could not be read, so its strength cannot be established` };
  }
  if (shape.echoOfInput === true) {
    // The strongest shape available: the assertion says the behaviour RETURNS what it was given. Any
    // implementation that drops, reorders or mangles the input is refuted by it.
    return { discriminating: true, reason: `${shape.at} asserts the behaviour echoes the input it was given` };
  }
  // An assertion between two CONSTANTS cannot depend on the behaviour, so it cannot fail because of it.
  // `expect(result).toEqual({ status: "ok" })` is refuted by nothing except a wrong status string; a real
  // round-trip could be broken in a dozen ways and this would still pass.
  if (!shape.operandShapes.some((operand) => operand === "non-empty-literal" || operand === "variable")) {
    const inputs = shape.callArguments ?? [];
    const inputNote = inputs.length ? ` The case only calls with: ${inputs.slice(0, 3).join(", ")}.` : "";
    return { discriminating: false, reason: `${shape.at} compares constant operand(s), so its outcome cannot depend on the behaviour under test.${inputNote}` };
  }
  // At least one operand varies, but the assertion does not tie the result back to the input: a constant
  // expected value plus a variable receiver is weak, because a wrong-but-constant result would pass.
  const varyingOperands = shape.operandShapes.filter((operand) => operand === "non-empty-literal" || operand === "variable").length;
  if (varyingOperands === 1) {
    return { discriminating: false, reason: `${shape.at} has a single varying operand against a constant, so a constant result would satisfy it` };
  }
  return { discriminating: true, reason: `${shape.at} compares two varying operands, so its outcome depends on the behaviour` };
}

/** Whether a set of assertion shapes contains at least one that could fail. */
export function hasDiscriminatingCase(cases: readonly AssertionShape[]): { ok: boolean; reason: string } {
  if (!cases.length) return { ok: false, reason: "no assertion site was read from the evidence" };
  const judgements = cases.map(assertionDiscriminates);
  const winner = judgements.find((judgement) => judgement.discriminating);
  return winner ? { ok: true, reason: winner.reason } : { ok: false, reason: judgements.map((judgement) => judgement.reason).join("; ") };
}

/* -------------------------------------------------------------------------- */
/* The judgement                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Judge the evidence for one claim.
 *
 * Fail-closed in three directions at once, which is the whole design:
 *
 *  - a **failed discriminating** observation is `CONTRADICTED` — the work was measured and found
 *    wanting. This outranks everything: no amount of passing evidence rescues a contradiction.
 *  - a **mandatory obligation with no discriminating evidence** is `INSUFFICIENT_EVIDENCE`. A passing
 *    check that could not have failed is not evidence, and neither is a proxy.
 *  - only when every mandatory obligation is met by discriminating, passing evidence is the claim
 *    `SATISFIED`.
 */
export function judgeClaim(input: {
  claim: AcceptanceClaim;
  obligations: readonly EvidenceObligation[];
  evidence: readonly ObservedEvidence[];
}): ClaimSatisfaction {
  const { claim } = input;
  const obligations = input.obligations.filter((obligation) => obligation.claimId === claim.id);
  const evidence = input.evidence.filter((observation) => observation.claimId === claim.id);
  const reasons: string[] = [];
  const satisfied: string[] = [];
  const unsatisfied: string[] = [];

  // A claim with no obligation cannot be judged. Refusing is the only honest answer: there is nothing a
  // reader could point at, and inventing an obligation here would be this module deciding the contract.
  const required = obligations.filter((obligation) => obligation.mandatory && obligation.kind !== "no-evidence-required");
  if (!obligations.length) {
    return { claimId: claim.id, statement: claim.statement, criticality: claim.criticality, verdict: "INSUFFICIENT_EVIDENCE", reasons: [`no evidence obligation was declared for \`${claim.id}\`, so nothing could establish it`], satisfiedObligations: [], unsatisfiedObligations: [] };
  }

  // CONTRADICTION first, and it outranks every pass.
  for (const obligation of obligations) {
    const contradicting = evidence.filter((observation) => observation.kind === obligation.kind && observation.discriminating && !observation.passed);
    for (const observation of contradicting) {
      reasons.push(`${observation.source} contradicts \`${claim.statement}\` (${obligation.kind}${observation.detail ? `: ${observation.detail}` : ""})`);
      unsatisfied.push(obligation.id);
    }
  }
  if (reasons.length) {
    return { claimId: claim.id, statement: claim.statement, criticality: claim.criticality, verdict: "CONTRADICTED", reasons, satisfiedObligations: [], unsatisfiedObligations: [...new Set(unsatisfied)] };
  }

  for (const obligation of obligations) {
    if (obligation.kind === "no-evidence-required") {
      satisfied.push(obligation.id);
      continue;
    }
    const candidates = evidence.filter((observation) => observation.kind === obligation.kind);
    if (!candidates.length) {
      reasons.push(`\`${obligation.kind}\` evidence is missing for \`${claim.statement}\` (${obligation.requires})`);
      unsatisfied.push(obligation.id);
      continue;
    }
    const passing = candidates.filter((observation) => observation.passed);
    if (!passing.length) {
      // Every observation of this kind failed; the contradiction branch above has already returned for a
      // discriminating failure, so reaching here means the failures were non-discriminating.
      reasons.push(`the ${obligation.kind} evidence for \`${claim.statement}\` did not pass, and none of it could establish the claim either way`);
      unsatisfied.push(obligation.id);
      continue;
    }
    const discriminating = passing.filter((observation) => observation.discriminating);
    if (!discriminating.length) {
      // THE CORE REFUSAL. Green, but incapable of having been red.
      reasons.push(`${passing.length} passing ${obligation.kind} observation(s) for \`${claim.statement}\` are non-discriminating: ${passing.map((observation) => observation.detail ?? observation.source).join("; ")}`);
      unsatisfied.push(obligation.id);
      continue;
    }
    satisfied.push(obligation.id);
  }

  // An advisory claim never blocks, but its gaps are still reported.
  const verdict: ClaimVerdict = unsatisfied.length === 0 ? "SATISFIED" : "INSUFFICIENT_EVIDENCE";
  return { claimId: claim.id, statement: claim.statement, criticality: claim.criticality, verdict, reasons, satisfiedObligations: satisfied, unsatisfiedObligations: [...new Set(unsatisfied)] };
}

/**
 * Judge the objective.
 *
 * `SATISFIED` requires EVERY mandatory claim satisfied. A single contradicted mandatory claim makes the
 * whole objective `CONTRADICTED`, because a measured failure is a stronger statement than a gap. Anything
 * else is `INSUFFICIENT_EVIDENCE`.
 *
 * `weakSignals` are carried through untouched and are never consulted: they are what a consumer should
 * display as context and never as proof.
 */
export function judgeObjective(input: {
  claims: readonly AcceptanceClaim[];
  obligations: readonly EvidenceObligation[];
  evidence: readonly ObservedEvidence[];
  weakSignals?: readonly string[];
}): SatisfactionResult {
  const claims = input.claims.map((claim) => judgeClaim({ claim, obligations: input.obligations, evidence: input.evidence }));
  const mandatory = claims.filter((judgement) => judgement.criticality === "mandatory");
  const weakSignals = [...(input.weakSignals ?? [])];

  if (!claims.length) {
    return { verdict: "INSUFFICIENT_EVIDENCE", claims, weakSignals, reasons: ["the objective has no acceptance claim, so there is nothing to satisfy"] };
  }
  if (!mandatory.length) {
    // An objective whose every claim is advisory cannot be established, and saying `SATISFIED` because
    // nothing could block would be the vacuity this module exists to refuse.
    return { verdict: "INSUFFICIENT_EVIDENCE", claims, weakSignals, reasons: ["every acceptance claim is advisory, so no claim could establish the objective"] };
  }

  const contradicted = mandatory.filter((judgement) => judgement.verdict === "CONTRADICTED");
  if (contradicted.length) {
    return {
      verdict: "CONTRADICTED",
      claims,
      weakSignals,
      reasons: contradicted.flatMap((judgement) => judgement.reasons)
    };
  }

  const unsatisfied = mandatory.filter((judgement) => judgement.verdict !== "SATISFIED");
  if (unsatisfied.length) {
    return {
      verdict: "INSUFFICIENT_EVIDENCE",
      claims,
      weakSignals,
      reasons: [
        `${unsatisfied.length} of ${mandatory.length} mandatory claim(s) are not satisfied: ${unsatisfied.map((judgement) => judgement.claimId).join(", ")}`,
        ...unsatisfied.flatMap((judgement) => judgement.reasons)
      ]
    };
  }

  return {
    verdict: "SATISFIED",
    claims,
    weakSignals,
    reasons: [`all ${mandatory.length} mandatory claim(s) are supported by discriminating evidence: ${mandatory.map((judgement) => judgement.claimId).join(", ")}`]
  };
}
