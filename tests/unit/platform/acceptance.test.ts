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
  type OperandShape,
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
    expect(strength.weak[0]!.reason).toContain("no non-empty value reaches the assertion");
    // Nothing non-empty reached the assertion, which is the finding: `inputs.nonEmpty` stays 0.
    expect(strength.inputs.nonEmpty).toBe(0);
    // No input expression is recorded: the case supplies nothing, which is exactly the finding.
    expect(strength.inputs.expressions).toEqual([]);
    // The file-grain count is reported for a reader, and it must not be satisfied by the scaffold: the
    // `it("round-trips", …)` label is a description, not a value fed to the behaviour. Counting it made a
    // file whose only input was `[]` report "1 non-empty call argument" — a true count of the wrong thing.
    expect(strength.callInputs.nonEmpty).toBe(0);
    // And the case counts as EMPTY. It used to count as empty only when it carried no assertion site at
    // all, which made the field a count of assertion-less cases wearing the name of a count of empty ones.
    expect(strength.inputs.total).toBe(1);
    expect(strength.inputs.empty).toBe(1);
  });

  it("does not count a test's own label as an input it supplies", () => {
    // The same distinction the acceptance judgement turns on: `describe`/`it` arguments are names, and a
    // file consisting only of well-named empty cases has supplied nothing.
    const source = [
      'import { expect, it } from "vitest";',
      'it("round-trips a representative non-empty interventions array", () => {',
      "  const interventions = [];",
      "  expect(interventions).toEqual([]);",
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.discriminating).toBe(0);
    expect(strength.callInputs.nonEmpty).toBe(0);
  });

  it("still counts the values a case really supplies", () => {
    // The other side of the same guard: excluding the scaffolding must not exclude the fixture. A populated
    // binding and a non-empty literal argument both still show up.
    const source = [
      'import { expect, it } from "vitest";',
      'it("works", () => {',
      '  const cases = [{ id: "a" }];',
      "  const result = normalize(cases, 3);",
      "  expect(result).toEqual(cases);",
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.discriminating).toBe(1);
    expect(strength.callInputs.nonEmpty).toBeGreaterThan(0);
    // A case that exercised a non-empty value is not one of the empty ones.
    expect(strength.inputs.empty).toBe(0);
  });

  // The generated test from a real provider run, embedded verbatim from
  // `artifacts/platform-foundation/phase-07/case-B-meaningful.json` (`judgedFiles[0].content`). It is the
  // artifact of the third false negative, and keeping it here means the reader that must ACCEPT it is
  // re-tested on every run rather than only when a model happens to write this shape again.
  const PROVIDER_MEANINGFUL = "import { describe, expect, it } from \"vitest\";\nimport {\n  interventionFileDocument,\n  parseInterventionFile,\n  INTERVENTION_SCHEMA_VERSION,\n} from \"../../src/shared/intervention-file\";\nimport {\n  validateInterventionRequest,\n  type HumanInterventionRequest,\n} from \"../../src/shared/intervention\";\n\nconst interventionKind = (() => {\n  const base = {\n    id: \"intervention-1\",\n    taskId: \"task-1\",\n    question: \"Should the migration proceed?\",\n    blockingStepId: \"step-1\",\n    createdAt: \"2025-01-02T03:04:05.000Z\",\n  } as const;\n  const candidateKinds = [\n    \"question\",\n    \"approval\",\n    \"permission\",\n    \"clarification\",\n    \"review\",\n    \"confirm\",\n    \"confirmation\",\n    \"input\",\n    \"choice\",\n    \"manual\",\n    \"other\",\n    \"pause\",\n    \"resume\",\n  ];\n  for (const kind of candidateKinds) {\n    const candidate = { ...base, kind } as unknown as HumanInterventionRequest;\n    try {\n      validateInterventionRequest(candidate);\n      return kind as unknown as HumanInterventionRequest[\"kind\"];\n    } catch {\n      // Try the next candidate kind.\n    }\n  }\n  throw new Error(\"could not construct a valid HumanInterventionRequest fixture\");\n})();\n\nconst interventions: HumanInterventionRequest[] = [\n  {\n    id: \"intervention-1\",\n    taskId: \"task-1\",\n    kind: interventionKind,\n    question: \"Should the migration proceed?\",\n    blockingStepId: \"step-1\",\n    createdAt: \"2025-01-02T03:04:05.000Z\",\n  },\n  {\n    id: \"intervention-2\",\n    taskId: \"task-2\",\n    kind: interventionKind,\n    question: \"Is the backup complete?\",\n    blockingStepId: \"step-2\",\n    createdAt: \"2025-01-02T04:05:06.000Z\",\n    resolvedAt: \"2025-01-02T04:06:07.000Z\",\n  },\n];";

  const PROVIDER_CASE = "describe(\"intervention-file round-trip\", () => {\n  it(\"round-trips a representative non-empty interventions array\", () => {\n    const document = interventionFileDocument(interventions);\n\n    expect(document).toEqual({\n      schemaVersion: INTERVENTION_SCHEMA_VERSION,\n      interventions,\n    });\n\n    const parsed = parseInterventionFile(JSON.stringify(document));\n\n    expect(parsed).toEqual({\n      status: \"ok\",\n      interventions,\n    });\n\n    if (parsed.status !== \"ok\") {\n      throw new Error(`expected parsed interventions, got ${parsed.status}`);\n    }\n\n    expect(interventionFileDocument(parsed.interventions)).toEqual(document);\n  });\n});";

  it("accepts a meaningful test whose fixture is declared at MODULE scope", () => {
    // The third false negative, and the one a real provider produced. The fixture is `const interventions:
    // HumanInterventionRequest[] = […]` at module scope, referenced from inside the case; only the case's
    // OWN bindings were consulted, so a genuinely meaningful file was refused. A module-level fixture is
    // still a value the case supplied.
    const strength = summarizeAssertionStrength(`${PROVIDER_MEANINGFUL}\n\n${PROVIDER_CASE}`, "tests/unit/intervention-file-properties.test.ts");
    expect(strength.discriminating).toBeGreaterThan(0);
    expect(strength.inputs.empty).toBe(0);
    // And the citations are absolute to the file, not to the case body it was read from. A refusal that
    // cites `file:4` for an assertion on line 40 is a citation a reader cannot follow.
    for (const entry of strength.weak) {
      expect(entry.at).toMatch(/^tests\/unit\/intervention-file-properties\.test\.ts:\d+$/);
    }
  });

  it("still refuses an EMPTY module-scope fixture", () => {
    // The guard on that fallback, because widening the scope must not widen what counts. A module-level
    // `const cases = []` referenced by the assertion is exactly case A with the fixture moved up, and it
    // stays non-discriminating.
    const source = [
      'import { expect, it } from "vitest";',
      "const cases = [];",
      'it("round-trips", () => {',
      "  const result = parse(encode(cases));",
      "  expect(result).toEqual(cases);",
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.discriminating).toBe(0);
    expect(strength.inputs.nonEmpty).toBe(0);
    // Refused because what reaches the assertion is EMPTY, not because the reader could not see it. The
    // assertion does reference the fixture — `referencesInput` is true — and the refusal is the honest one:
    // the value it references is an empty literal, so the case exercised nothing that could vary.
    expect(strength.weak).toHaveLength(1);
    expect(strength.weak[0]!.reason).toContain("no non-empty value reaches the assertion");
  });

  it("does not let an unrelated module-scope fixture vouch for a case", () => {
    // The other guard: the wider scope is a FALLBACK for names the assertion actually mentions, not a
    // licence to search the file for any populated literal. The case supplies nothing and must be refused
    // even though a populated fixture exists at module scope.
    const source = [
      'import { expect, it } from "vitest";',
      'const unrelated = [{ id: "a" }, { id: "b" }];',
      'it("round-trips", () => {',
      "  const result = parse(encode([]));",
      '  expect(result.status).toBe("ok");',
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.discriminating).toBe(0);
  });

  it("reads a fixture whose declaration carries a TYPE ANNOTATION", () => {
    // A regression, from a real provider run. The generated test was meaningful — a populated two-element
    // fixture, a round-trip, an equality against the input — and the judgement still refused it, because
    // the declaration was `const interventions: HumanInterventionRequest[] = [...]`. The assignment pattern
    // expected `=` right after the name, found `:`, matched nothing, and so the fixture was never bound:
    // every reference to it read as an opaque variable. The reader was too strict where it had been too
    // loose, and refusing genuine evidence is the same class of error as accepting vacuous evidence — it
    // would fail real work instead of the fake version of it.
    const source = [
      'import { expect, it } from "vitest";',
      'import type { HumanInterventionRequest } from "../../src/shared/intervention";',
      'it("round-trips", () => {',
      "  const interventions: HumanInterventionRequest[] = [",
      '    { id: "intervention-1", taskId: "task-1", kind: "question" },',
      '    { id: "intervention-2", taskId: "task-2", kind: "approval" },',
      "  ];",
      "  const document = interventionFileDocument(interventions);",
      "  const result = parseInterventionFile(JSON.stringify(document));",
      '  expect(result.status).toBe("ok");',
      "  expect(result.interventions).toEqual(interventions);",
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    // One of the two sites is the discriminating one — the equality against the input — and the other is
    // correctly weak on its own (`expect(result.status).toBe("ok")` compares a result-derived value with a
    // literal, which any constant status would satisfy). One is enough: the case could have failed.
    expect(strength.discriminating).toBe(1);
    expect(strength.weak).toHaveLength(1);
    expect(strength.weak[0]!.assertion).toBe("toBe");
    expect(strength.inputs.nonEmpty).toBe(1);
  });

  it("fails closed on another language rather than assuming its assertions discriminate", () => {
    // Phase 08 §5, and it is a prohibition rather than a preference: `unknown syntax → assume
    // discriminating` is forbidden, because an unreadable assertion is not evidence. The reader is a
    // LEXICAL reader for `expect(…)` / `assert(…)` / `expectTypeOf(…)` inside `it`/`test`/`describe`, and
    // this is the test that keeps it honest about that.
    //
    // It has been measured against a real external repository too (154 Python files in
    // `zhiheng-zhang-Mera/Quant-ultra`, `scripts/qualify-assertion-reader.cjs`: 0 files judged
    // discriminating). This fixture is the permanent guard so the property cannot silently regress.
    //
    // Note WHICH construct saves it, because it is narrower than "we don't parse Python": the reader
    // requires a CALL — `assert(` with a parenthesis — and Python's assertion is the `assert x == y`
    // statement, which never matches. `unittest`'s `self.assertEqual(a, b)` is a method call, and
    // `pytest.raises` is a context manager, so neither is an assertion entry point either.
    const python = [
      "import pytest",
      "from decimal import Decimal",
      "",
      "def test_round_trip(interventions):",
      "    document = intervention_file_document(interventions)",
      "    parsed = parse_intervention_file(json.dumps(document))",
      "    assert parsed.status == 'ok'",
      "    assert parsed.interventions == interventions",
      "",
      "class TestInterventionFile(unittest.TestCase):",
      "    def test_rejects_unknown_schema(self):",
      "        self.assertEqual(parse('{}').status, 'unreadable')",
      "        self.assertIsNotNone(parse('{}').reason)",
      "",
      "    def test_raises_on_bad_json(self):",
      "        with pytest.raises(ValueError):",
      "            parse('{not json')"
    ].join("\n");
    const strength = summarizeAssertionStrength(python, "tests/test_intervention_file.py");
    expect(strength.discriminating).toBe(0);
    expect(strength.inputs.nonEmpty).toBe(0);
    // The finding is stated positively too: the reader found no assertion SITE at all, which is why it
    // fails closed rather than reporting a weak assertion it half-understood.
    expect(strength.total).toBe(0);
  });

  it("does not count a Python `.py` test file as evidence at all", () => {
    // The second half of the same boundary, at the layer above the reader: `judgeGoalAcceptance` selects
    // evidence with `TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/`, so a Python test file is not even a
    // candidate. A change that added only `tests/test_x.py` therefore produces no test evidence and is
    // refused as `INSUFFICIENT_EVIDENCE` — fail-closed, and for a different reason than the reader's.
    // Asserted here as a fact about the pattern so a future "support Python tests" change has to confront
    // both layers rather than quietly reaching only one of them.
    const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
    expect(TEST_FILE.test("tests/x.test.ts")).toBe(true);
    expect(TEST_FILE.test("tests/x.spec.js")).toBe(true);
    expect(TEST_FILE.test("tests/test_x.py")).toBe(false);
    expect(TEST_FILE.test("tests/x_test.py")).toBe(false);
    expect(TEST_FILE.test("tests/x_test.go")).toBe(false);
  });

  it("reads the namespaced `assert.<method>` dialect that real external repositories use", () => {
    // The Phase 08 external exposure, and the third over-fitting this reader has had to shed. Two real
    // Owner repositories (`dsh-health-scheduler`, `dsh-restart`) assert with Node's built-in `assert` module
    // and contain **zero** `expect(` calls: measured, 798 `assert.<method>(` calls between them
    // (`scripts/measure-assertion-dialect.cjs`). The reader recognised NONE of them, so every change to
    // those repositories was judged `INSUFFICIENT_EVIDENCE` however good its evidence was.
    //
    // The subtlety worth pinning: the entry point is the IDENTIFIER, not `identifier(`, because a method
    // sits between the namespace and the parenthesis. A pattern requiring `(` right after `assert` cannot
    // match `assert.equal(a, b)` at all — the first attempt at this fix matched nothing and the branch
    // written to handle the form never ran, which looked exactly like "the fix did not work".
    const source = [
      'import assert from "node:assert/strict";',
      'import { describe, it } from "node:test";',
      'describe("intervention-file", () => {',
      '  it("round-trips a populated interventions array", () => {',
      '    const interventions = [{ id: "a", taskId: "t" }, { id: "b", taskId: "t" }];',
      "    const parsed = parseInterventionFile(JSON.stringify(interventionFileDocument(interventions)));",
      '    assert.equal(parsed.status, "ok");',
      "    assert.deepEqual(parsed.interventions, interventions);",
      "  });",
      "});"
    ].join("\n");
    const shapes = readAssertionShapes(source, "tests/x.test.js");
    expect(shapes.map((shape) => shape.assertion)).toEqual(["assert.equal", "assert.deepEqual"]);
    // The equality against the input is the discriminating one; the status comparison is correctly weak on
    // its own. Same verdict the Vitest spelling of this test gets — the dialect must not change the answer.
    const strength = summarizeAssertionStrength(source, "tests/x.test.js");
    expect(strength.discriminating).toBe(1);
    expect(strength.inputs.nonEmpty).toBe(1);
  });

  it("refuses `assert.ok` by name, exactly as it refuses `toBeTruthy`", () => {
    // `assert.ok(x)` is `toBeTruthy` under another name, so it goes through the SAME list rather than a
    // second rule that could drift from it.
    const shapes = readAssertionShapes('assert.ok(cases);\nassert.equal(a, b);', "t.js");
    expect(shapes.map((shape) => shape.assertion)).toEqual(["assert.ok", "assert.equal"]);
    expect(assertionDiscriminates({ ...shapes[0]!, operandShapes: ["variable", "non-empty-literal"], referencesInput: true, echoOfInput: true }).discriminating).toBe(false);
  });

  it("does not mistake a bare identifier for an assertion call", () => {
    // The guard on widening the entry point to the identifier: `assert` used as a name — a parameter, an
    // import, a property — must not produce an assertion site out of nothing.
    const source = [
      'import assert from "node:assert/strict";',
      "function check(assert) { return assert; }",
      "const value = assert;",
      "assert(true);"
    ].join("\n");
    const shapes = readAssertionShapes(source, "t.js");
    // Only the real call site is an assertion; the import, the parameter and the reference are not.
    expect(shapes.map((shape) => shape.assertion)).toEqual(["assert"]);
  });

  it("reads a fixture bound with a TYPE ASSERTION suffixed to the literal", () => {
    // The same run, one step later: the model annotated the literal instead of the declaration —
    // `] as unknown as HumanInterventionRequest[]`. The type is not part of the VALUE, and leaving it in
    // made a populated array shape as `unknown`, which is non-discriminating by construction.
    const source = [
      'import { expect, it } from "vitest";',
      'it("round-trips", () => {',
      "  const interventions = [",
      '    { id: "intervention-1", taskId: "task-1", kind: "question" },',
      '    { id: "intervention-2", taskId: "task-2", kind: "approval" },',
      "  ] as unknown as HumanInterventionRequest[];",
      "  const document = interventionFileDocument(interventions);",
      "  const result = parseInterventionFile(JSON.stringify(document));",
      "  expect(result.interventions).toEqual(interventions);",
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.discriminating).toBe(1);
    expect(strength.weak).toEqual([]);
  });

  it("keeps the vacuous case refused through a type annotation", () => {
    // The other direction, because the fix must not open a hole: the same constructs around an EMPTY
    // fixture stay vacuous. `[] as unknown as HumanInterventionRequest[]` is still an empty array, and a
    // type written on it does not make it representative.
    const source = [
      'import { expect, it } from "vitest";',
      'it("round-trips", () => {',
      "  const interventions: HumanInterventionRequest[] = [];",
      "  const result = parseInterventionFile(JSON.stringify(interventionFileDocument(interventions)));",
      "  expect(result.interventions).toEqual(interventions);",
      "});"
    ].join("\n");
    const strength = summarizeAssertionStrength(source, "tests/x.test.ts");
    expect(strength.discriminating).toBe(0);
    expect(strength.inputs.nonEmpty).toBe(0);
    // The binding resolves and the assertion does reference it — and it is STILL refused, because what
    // resolves is an empty literal. Discriminating is about the value, not about the syntax reaching it.
    expect(strength.weak[0]!.reason).toContain("no non-empty value reaches the assertion");
  });

  it("strips only a real type suffix, never a value expression", () => {
    // The guard on the fix. A suffix is only removed when it reads like a TYPE: `x as number` is an
    // assertion, whereas a comparison whose right-hand side happens to contain the word `as` is not, and
    // deleting it would report a constant where there was a varying operand.
    expect(operandShapeOf("[1, 2] as const")).toBe("non-empty-literal");
    expect(operandShapeOf("[] as const")).toBe("empty-literal");
    expect(operandShapeOf("[] as unknown as Foo[]")).toBe("empty-literal");
    // A named fixture the caller supplies is a VARIABLE — opaque, but a value. Reading it as `unknown`
    // would refuse every test that takes its input as a parameter, which is most of them.
    expect(operandShapeOf("cases as Case[]")).toBe("variable");
    // Not types, so left intact: an expression ending in a call, one whose suffix carries an operator, and
    // a string that merely contains the word.
    expect(operandShapeOf("value as string | undefined")).toBe("unknown");
    expect(operandShapeOf("has as")).toBe("unknown");
    expect(operandShapeOf('"as"')).toBe("non-empty-literal");
    // A nested type argument is a type: `Record<string, number>` is not a value.
    expect(operandShapeOf("{a:1} as Record<string, number>")).toBe("non-empty-literal");
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
    // The other classic vacuous shape. The assertion NAME alone refuses it, even when everything else about
    // the shape says strong — which is why the name is checked before any operand reasoning.
    const strong = { at: "t:1", operandShapes: ["variable", "variable"] as OperandShape[], referencesInput: true, echoOfInput: true };
    expect(assertionDiscriminates({ ...strong, assertion: "toBeDefined" }).discriminating).toBe(false);
    expect(assertionDiscriminates({ ...strong, assertion: "toBeTruthy" }).discriminating).toBe(false);
    expect(assertionDiscriminates({ ...strong, assertion: "not.toBeDefined" }).discriminating).toBe(false);
    // A real matcher over a non-empty input that the assertion ties back to the input is the shape that can
    // fail, and it is accepted.
    expect(assertionDiscriminates({ ...strong, assertion: "toEqual" }).discriminating).toBe(true);
    // Note the boundary: `assertionDiscriminates` judges the ASSERTION, and an echo over a resolvable
    // operand is discriminating. Whether the CASE supplies a non-empty value is the separate condition
    // `summarizeAssertionStrength` applies per case, which is where the vacuous shape is refused.
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
    expect(shapes.map((shape) => assertionDiscriminates(shape).discriminating)).toEqual([false, false, false, false, false]);
    // Every one of them is refused, and for the honest reason rather than by accident: none of them feeds a
    // non-empty value into a call, so none can establish a property of non-empty inputs.
    expect(hasDiscriminatingCase(shapes).ok).toBe(false);
    expect(hasDiscriminatingCase([shapes[1]!]).ok).toBe(false);
  });
});
