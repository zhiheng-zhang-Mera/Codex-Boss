import { describe, expect, it } from "vitest";
import {
  assertionDiscriminates,
  judgeClaim,
  judgeObjective,
  hasDiscriminatingCase,
  type AcceptanceClaim,
  type AssertionShape,
  type ClaimSatisfaction,
  type EvidenceObligation,
  type ObservedEvidence,
  type SatisfactionResult
} from "../../../src/shared/acceptance";
import { operandShapeOf, readAssertionShapes, splitArguments, summarizeAssertionStrength } from "../../../src/shared/assertion-shape";

/**
 * Phase 07 — objective satisfaction.
 *
 * The regression this file exists for is Phase 07 book §4, and it is stated as a negative: a test that
 * covers only `roundTrip([])` must NOT establish *"roundTrip works for arbitrary non-empty supported
 * values"*, and the system must be able to say `INSUFFICIENT_EVIDENCE` instead of `CONVERGED`.
 *
 * That is the shape of the real Phase 06 dogfooding run — a generated test whose round-trip case passed
 * an empty array, reported as CONVERGED because the host could verify that a check passes, not that it
 * asserts anything (`PF-DEBT-011`).
 */

const claim = (overrides: Partial<AcceptanceClaim> = {}): AcceptanceClaim => ({
  id: "c1",
  statement: "the serializer round-trips arbitrary non-empty supported values",
  criticality: "mandatory",
  source: "declared",
  ...overrides
});

const obligation = (overrides: Partial<EvidenceObligation> = {}): EvidenceObligation => ({
  id: "o1",
  claimId: "c1",
  kind: "non-empty-cases",
  requires: "at least one representative non-empty case",
  mandatory: true,
  ...overrides
});

const evidence = (overrides: Partial<ObservedEvidence> = {}): ObservedEvidence => ({
  id: "e1",
  claimId: "c1",
  kind: "non-empty-cases",
  source: "tests/x.test.ts",
  passed: true,
  discriminating: true,
  ...overrides
});

/* ------------------------------------------------------------------ *
 * the mandated vacuous-pass regression
 * ------------------------------------------------------------------ */

describe("Phase 07 §4 — a vacuous green test cannot satisfy a claim", () => {
  it("refuses `roundTrip([])` as evidence for a claim about non-empty values", () => {
    // THE regression. Green, and structurally incapable of having been red.
    const result = judgeClaim({
      claim: claim(),
      obligations: [obligation()],
      evidence: [
        evidence({
          discriminating: false,
          cases: [{ at: "tests/x.test.ts:4", assertion: "toEqual", operandShapes: ["empty-literal"] }],
          detail: "roundTrip([]) round-trips the empty array"
        })
      ]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("non-discriminating");
    expect(result.unsatisfiedObligations).toEqual(["o1"]);
  });

  it("does not let test counts, assertion counts or existence stand in for acceptance", () => {
    // Every proxy the book forbids, presented as if it were evidence. None of them is a kind of evidence,
    // so none of them can satisfy an obligation — stated as a structural fact rather than a rule.
    const proxies: ObservedEvidence[] = [
      { id: "p1", claimId: "c1", kind: "non-empty-cases", source: "tests are present", passed: true, discriminating: false, detail: "12 tests found" },
      { id: "p2", claimId: "c1", kind: "non-empty-cases", source: "coverage", passed: true, discriminating: false, detail: "coverage 91%" },
      { id: "p3", claimId: "c1", kind: "non-empty-cases", source: "test command", passed: true, discriminating: false, detail: "exit code 0" }
    ];
    expect(judgeClaim({ claim: claim(), obligations: [obligation()], evidence: proxies }).verdict).toBe("INSUFFICIENT_EVIDENCE");
    // And the proxies are carried for a reader without ever being consulted as proof.
    const objective = judgeObjective({ claims: [claim()], obligations: [obligation()], evidence: proxies, weakSignals: ["exit 0", "91% coverage"] });
    expect(objective.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(objective.weakSignals).toEqual(["exit 0", "91% coverage"]);
  });

  it("satisfies the same claim when the evidence exercises a non-empty case", () => {
    // The positive half. Without this the model would be a machine that refuses everything.
    const result = judgeClaim({
      claim: claim(),
      obligations: [obligation()],
      evidence: [
        evidence({
          cases: [
            { at: "tests/x.test.ts:4", assertion: "toEqual", operandShapes: ["empty-literal"] },
            { at: "tests/x.test.ts:9", assertion: "toEqual", operandShapes: ["non-empty-literal"] }
          ],
          detail: "round-trips a representative non-empty document"
        })
      ]
    });
    expect(result.verdict).toBe("SATISFIED");
    expect(result.satisfiedObligations).toEqual(["o1"]);
  });

  it("is not fooled by a mix: one weak case cannot carry a claim on its own", () => {
    // Two observations, one weak and one strong, but the STRONG one is for a different obligation kind.
    // The claim still needs its own non-empty evidence.
    const result = judgeClaim({
      claim: claim(),
      obligations: [obligation()],
      evidence: [evidence({ id: "e2", kind: "error-cases", discriminating: true })]
    });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("non-empty-cases");
  });
});

/* ------------------------------------------------------------------ *
 * the three verdicts
 * ------------------------------------------------------------------ */

describe("Phase 07 — the three verdicts, and contradiction outranking everything", () => {
  it("reports CONTRADICTED when a discriminating observation fails", () => {
    const result = judgeClaim({ claim: claim(), obligations: [obligation()], evidence: [evidence({ passed: false, detail: "the round trip dropped a field" })] });
    expect(result.verdict).toBe("CONTRADICTED");
    expect(result.reasons.join(" ")).toContain("contradicts");
  });

  it("lets a measured failure outrank any number of passes", () => {
    // A contradiction is a stronger statement than a gap, and it must survive a pile of green.
    const result = judgeClaim({
      claim: claim(),
      obligations: [obligation()],
      evidence: [evidence({ id: "ok", passed: true }), evidence({ id: "bad", passed: false, detail: "dropped a field" })]
    });
    expect(result.verdict).toBe("CONTRADICTED");
  });

  it("reports INSUFFICIENT_EVIDENCE when an obligation has no evidence at all", () => {
    const result = judgeClaim({ claim: claim(), obligations: [obligation()], evidence: [] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("missing");
  });

  it("refuses a claim that declares no obligation, rather than inventing one", () => {
    // Nothing a reader could point at. Inventing an obligation here would be this module deciding the
    // contract on the caller's behalf.
    const result = judgeClaim({ claim: claim(), obligations: [], evidence: [evidence()] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("no evidence obligation was declared");
  });
});

/* ------------------------------------------------------------------ *
 * the objective
 * ------------------------------------------------------------------ */

describe("Phase 07 — the objective verdict", () => {
  const obligations: EvidenceObligation[] = [
    obligation({ id: "o1", kind: "non-empty-cases" }),
    obligation({ id: "o2", kind: "boundary-cases" })
  ];

  it("is SATISFIED only when every mandatory claim is", () => {
    const result: SatisfactionResult = judgeObjective({
      claims: [claim()],
      obligations,
      evidence: [evidence({ id: "a", kind: "non-empty-cases" }), evidence({ id: "b", kind: "boundary-cases" })]
    });
    expect(result.verdict).toBe("SATISFIED");
    expect(result.reasons.join(" ")).toContain("all 1 mandatory claim");
    // The per-claim detail travels with the overall verdict, so a reader can see WHY.
    const perClaim: ClaimSatisfaction = result.claims[0]!;
    expect(perClaim.claimId).toBe("c1");
    expect(perClaim.satisfiedObligations.sort()).toEqual(["o1", "o2"]);
  });

  it("is INSUFFICIENT_EVIDENCE when one mandatory obligation is unmet, and names it", () => {
    const result = judgeObjective({ claims: [claim()], obligations, evidence: [evidence({ id: "a", kind: "non-empty-cases" })] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("boundary-cases");
  });

  it("is CONTRADICTED when any mandatory claim is contradicted", () => {
    const result = judgeObjective({
      claims: [claim(), claim({ id: "c2", statement: "the serializer rejects malformed input" })],
      obligations: [...obligations, obligation({ id: "o3", claimId: "c2", kind: "error-cases" })],
      evidence: [
        evidence({ id: "a", kind: "non-empty-cases" }),
        evidence({ id: "b", kind: "boundary-cases" }),
        evidence({ id: "c", claimId: "c2", kind: "error-cases", passed: false, detail: "malformed input was accepted" })
      ]
    });
    expect(result.verdict).toBe("CONTRADICTED");
    expect(result.reasons.join(" ")).toContain("malformed input was accepted");
  });

  it("never lets an advisory claim block, but still reports its gaps", () => {
    const result = judgeObjective({
      claims: [claim(), claim({ id: "c2", statement: "the API is documented", criticality: "advisory" })],
      obligations: [...obligations, obligation({ id: "o3", claimId: "c2", kind: "static-check" })],
      evidence: [evidence({ id: "a", kind: "non-empty-cases" }), evidence({ id: "b", kind: "boundary-cases" })]
    });
    expect(result.verdict).toBe("SATISFIED");
    expect(result.claims.find((entry) => entry.claimId === "c2")!.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("refuses an objective that declares no claim", () => {
    expect(judgeObjective({ claims: [], obligations: [], evidence: [] }).verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("refuses an objective whose claims are all advisory", () => {
    // `SATISFIED` because nothing could block would be exactly the vacuity this model refuses.
    const result = judgeObjective({ claims: [claim({ criticality: "advisory" })], obligations: [obligation({ mandatory: false })], evidence: [evidence()] });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("every acceptance claim is advisory");
  });
});

/* ------------------------------------------------------------------ *
 * reading assertion shapes from real source
 * ------------------------------------------------------------------ */

describe("Phase 07 — assertion shapes are read from the source, deterministically", () => {
  it("recognises the empty-literal shapes that cannot discriminate", () => {
    for (const source of ["[]", "{}", '""', "''", "new Map()", "new Set()", "0"]) {
      expect(operandShapeOf(source), source).toBe("empty-literal");
    }
  });

  it("recognises non-empty literals and variables", () => {
    for (const source of ["[1,2]", '{a:1}', '"hello"', "42"]) expect(operandShapeOf(source), source).toBe("non-empty-literal");
    for (const source of ["cases", "build()", "input.value"]) expect(operandShapeOf(source), source).toBe("variable");
  });

  it("splits arguments respecting nesting and strings", () => {
    expect(splitArguments("a, b")).toEqual(["a", "b"]);
    expect(splitArguments("f(1, 2), [3, 4]")).toEqual(["f(1, 2)", "[3, 4]"]);
    expect(splitArguments('"a,b", c')).toEqual(['"a,b"', "c"]);
    expect(splitArguments("")).toEqual([]);
  });

  it("reads the exact vacuous pattern the phase names", () => {
    // The real generated test from the Phase 06 dogfood run, reduced to its decisive line. The emptiness
    // is one binding away from the call site — `const interventions = []` then passed to the encoder —
    // which is why the reader resolves the file's own simple assignments rather than treating the
    // argument as an opaque variable.
    const source = [
      'import { expect, it } from "vitest";',
      'it("round-trips", () => {',
      "  const interventions = [];",
      "  const result = parseInterventionFile(JSON.stringify(interventionFileDocument(interventions)));",
      '  expect(result).toEqual({ status: "ok", interventions: [] });',
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.total).toBe(1);
    expect(strength.discriminating).toBe(0);
    // BOTH signals agree it is vacuous: the assertion's own operand is an empty collection, and the only
    // input the case supplies is the empty array reached through the binding.
    expect(strength.weak[0]!.reason).toContain("single varying operand");
    expect(strength.inputs.empty).toBe(1);
    expect(strength.inputs.expressions).toContain("JSON.stringify(interventionFileDocument(interventions))");
  });

  it("counts a discriminating case when the test exercises a representative value", () => {
    const source = [
      'import { expect, it } from "vitest";',
      'it("round-trips", () => {',
      '  const input = [{ id: "a", taskId: "t", kind: "LOGIN", question: "q", blockingStepId: "s", createdAt: "now" }];',
      "  const result = parseInterventionFile(JSON.stringify(interventionFileDocument(input)));",
      '  expect(result).toEqual({ status: "ok", interventions: input });',
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.discriminating).toBe(1);
    expect(strength.weak).toEqual([]);
    expect(strength.inputs.nonEmpty).toBeGreaterThan(0);
  });

  it("treats a truthiness-only assertion as non-discriminating", () => {
    // The other classic vacuous shape: it passes for almost any value, however many varying operands it
    // has. The assertion name alone is enough to refuse it.
    expect(assertionDiscriminates({ at: "t:1", operandShapes: ["variable", "variable"], assertion: "toBeDefined" }).discriminating).toBe(false);
    expect(assertionDiscriminates({ at: "t:1", operandShapes: ["variable", "variable"], assertion: "toBeTruthy" }).discriminating).toBe(false);
    expect(assertionDiscriminates({ at: "t:1", operandShapes: ["variable", "variable"], assertion: "not.toBeDefined" }).discriminating).toBe(false);
    // A real matcher over two varying operands is the shape that can fail.
    expect(assertionDiscriminates({ at: "t:1", operandShapes: ["variable", "variable"], assertion: "toEqual" }).discriminating).toBe(true);
    // And an echo of the input is stronger still.
    expect(assertionDiscriminates({ at: "t:1", operandShapes: ["variable", "variable"], assertion: "toEqual", echoOfInput: true }).discriminating).toBe(true);
  });

  it("treats an unreadable assertion as non-discriminating, so it can never count as evidence", () => {
    // Fail-closed by construction: the modest reader's failure mode is `unknown`, not a wrong "strong".
    expect(assertionDiscriminates({ at: "t:1", operandShapes: [], assertion: "toEqual" }).discriminating).toBe(false);
    expect(assertionDiscriminates({ at: "t:1", operandShapes: ["unknown"], assertion: "toEqual" }).discriminating).toBe(false);
  });

  it("finds every assertion site in a file with several", () => {
    const source = [
      "expect(a).toBe(1);",
      "expect(b).toEqual([]);",
      "expect(c).not.toBeDefined();",
      "expect(d).toBeTruthy();",
      "expect(e).toBeDefined();"
    ].join("\n");
    const shapes = readAssertionShapes(source, "t.ts");
    expect(shapes.map((shape) => shape.assertion)).toEqual(["toBe", "toEqual", "not.toBeDefined", "toBeTruthy", "toBeDefined"]);
    // Only the first is both a real matcher and exercising a varying operand.
    expect(shapes.map((shape) => assertionDiscriminates(shape).discriminating)).toEqual([true, false, false, false, false]);
    expect(hasDiscriminatingCase(shapes).ok).toBe(true);
    expect(hasDiscriminatingCase([shapes[1]!]).ok).toBe(false);
  });
});
