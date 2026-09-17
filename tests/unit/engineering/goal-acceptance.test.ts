import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { judgeGoalAcceptance } from "../../../electron/engineering/goal-acceptance";

/**
 * Phase 07 Task D — the counterexample cases, at the acceptance-model level.
 *
 * The book is explicit that proving the good path is not the work: **A / C / D are the core**, because an
 * implementation that only ever says `SATISFIED` for good evidence has not closed `PF-DEBT-011` at all.
 *
 * | case | construction | expected |
 * | --- | --- | --- |
 * | A | green, but only an empty input | `INSUFFICIENT_EVIDENCE` |
 * | B | representative non-empty input plus the invariant | `SATISFIED` |
 * | D | the code changed with no evidence for the claim | `INSUFFICIENT_EVIDENCE` |
 *
 * Case C (explicit contradiction) is the goal loop's own verification and is covered in
 * `engineering-goal-loop.test.ts`: a discriminating failure comes from the host's checks, and this model
 * deliberately does not duplicate that judgement.
 *
 * The sources below are REAL test code — case A is the shape the Phase 06 dogfood run actually produced,
 * and case B is the shape that would have established the same claim.
 */

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "boss-acceptance-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

/** Write a changed file into the fixture workspace, creating directories as needed. */
function write(relative: string, content: string): void {
  const target = path.join(workspace, relative.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

const OBJECTIVE = "Add a property test proving the intervention document round-trips arbitrary non-empty values.";

/** CASE A — the exact shape the Phase 06 dogfood run generated. */
const VACUOUS = [
  'import { describe, expect, it } from "vitest";',
  'import { interventionFileDocument, parseInterventionFile } from "../../src/shared/intervention-file";',
  'describe("intervention-file", () => {',
  '  it("round-trips the same interventions array", () => {',
  "    const interventions = [];",
  "    const document = interventionFileDocument(interventions);",
  "    const result = parseInterventionFile(JSON.stringify(document));",
  '    expect(result).toEqual({ status: "ok", interventions: [] });',
  "  });",
  "});"
].join("\n");

/** CASE B — the same claim, established: a representative value echoed back. */
const MEANINGFUL = [
  'import { describe, expect, it } from "vitest";',
  'import { interventionFileDocument, parseInterventionFile } from "../../src/shared/intervention-file";',
  'describe("intervention-file", () => {',
  '  it("round-trips a representative non-empty document", () => {',
  "    const interventions = [",
  '      { id: "i-1", taskId: "t-1", kind: "LOGIN", question: "sign in", blockingStepId: "s-1", contextSummary: "waiting", createdAt: "2026-01-01T00:00:00.000Z" }',
  "    ];",
  "    const result = parseInterventionFile(JSON.stringify(interventionFileDocument(interventions)));",
  '    expect(result).toEqual({ status: "ok", interventions });',
  "  });",
  "});"
].join("\n");

describe("Phase 07 Task D — A: a vacuous green test", () => {
  it("yields INSUFFICIENT_EVIDENCE, not acceptance", () => {
    write("tests/unit/vacuous.test.ts", VACUOUS);
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/vacuous.test.ts"], workspace });

    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    // The refusal names the file and says why, so a reader can act on it.
    expect(result.reasons.join(" ")).toContain("non-discriminating");
    expect(result.reasons.join(" ")).toContain("vacuous.test.ts");
    // And the proxies are recorded WITHOUT being consulted.
    expect(result.weakSignals.join(" ")).toContain("assertion(s)");
    expect(result.claims[0]!.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("refuses a test that only asserts something is defined", () => {
    write("tests/unit/defined.test.ts", [
      'import { expect, it } from "vitest";',
      'it("works", () => {',
      "  const cases = [1, 2, 3];",
      "  const result = cases.map((value) => value * 2);",
      "  expect(result).toBeDefined();",
      "});"
    ].join("\n"));
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/defined.test.ts"], workspace });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("refuses a test whose only assertion compares against a constant", () => {
    // The subtle shape: the assertion LOOKS substantial, and a broken round-trip would still pass it.
    write("tests/unit/constant.test.ts", [
      'import { expect, it } from "vitest";',
      'it("returns ok", () => {',
      '  const result = parse(encode([{ id: "x" }]));',
      '  expect(result.status).toBe("ok");',
      "});"
    ].join("\n"));
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/constant.test.ts"], workspace });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("Phase 07 Task D — B: meaningful evidence", () => {
  it("yields SATISFIED for a representative non-empty case that echoes its input", () => {
    write("tests/unit/meaningful.test.ts", MEANINGFUL);
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/meaningful.test.ts"], workspace });

    expect(result.verdict).toBe("SATISFIED");
    expect(result.reasons.join(" ")).toContain("all 1 mandatory claim");
    expect(result.claims[0]!.verdict).toBe("SATISFIED");
  });
});

describe("Phase 07 Task D — D: no evidence", () => {
  it("yields INSUFFICIENT_EVIDENCE when the change carries no test at all", () => {
    write("src/shared/serializer.ts", "export const encode = (value: unknown): string => JSON.stringify(value);\n");
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["src/shared/serializer.ts"], workspace });

    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reasons.join(" ")).toContain("non-empty-cases` evidence is missing");
    expect(result.weakSignals.join(" ")).toContain("none of them a test");
  });

  it("yields INSUFFICIENT_EVIDENCE when a named test cannot be read", () => {
    // A change that CLAIMS a test it did not produce is not evidence. Reported, not silently skipped.
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/missing.test.ts"], workspace });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.weakSignals.join(" ")).toContain("could not be read");
  });

  it("yields INSUFFICIENT_EVIDENCE when the change is empty", () => {
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: [], workspace });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });
});

describe("Phase 07 — the model is deterministic and cannot be talked into acceptance", () => {
  it("returns the same verdict for the same evidence", () => {
    write("tests/unit/meaningful.test.ts", MEANINGFUL);
    const first = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/meaningful.test.ts"], workspace });
    const second = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/meaningful.test.ts"], workspace });
    expect(second).toEqual(first);
  });

  it("does not accept on the strength of many weak assertions", () => {
    // Quantity is exactly what the book forbids as acceptance. Twenty vacuous cases are still vacuous.
    const manyWeak = [
      'import { expect, it } from "vitest";',
      ...Array.from({ length: 20 }, (_value, index) => `it("case ${index}", () => { const cases = []; expect(cases).toEqual([]); });`)
    ].join("\n");
    write("tests/unit/many-weak.test.ts", manyWeak);
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/many-weak.test.ts"], workspace });
    expect(result.verdict).toBe("INSUFFICIENT_EVIDENCE");
    // The count is visible as a signal, and made no difference to the verdict.
    expect(result.weakSignals.join(" ")).toMatch(/20 assertion/);
  });

  it("accepts when even one discriminating case is present among weak ones", () => {
    // The other direction: the model must not be a machine that refuses everything.
    const mixed = [VACUOUS, MEANINGFUL].join("\n\n");
    write("tests/unit/mixed.test.ts", mixed);
    const result = judgeGoalAcceptance({ objective: OBJECTIVE, changedFiles: ["tests/unit/mixed.test.ts"], workspace });
    expect(result.verdict).toBe("SATISFIED");
  });
});
