import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P2-I — the principle enforcement matrix, and the falsification of every rule that makes it honest.
 *
 * THE DESIGN POINT
 *
 *   Section 23 asks for a matrix over principles 15.1-15.9 and closes with "do not fake semantic certainty". The
 *   forgery a matrix of this kind invites is PROMOTION: writing MACHINE ENFORCED beside a principle whose only
 *   guard is a regression ratchet. So the matrix is data and `scripts/principle-enforcement-validator.cjs` checks
 *   it, and these cases BUILD A MATRIX THAT BREAKS EACH RULE and assert the validator rejects it. A guard whose
 *   failure mode has never been observed is a guard nobody has evidence for.
 *
 *   The measured values are not part of the matrix at all -- they are resolved from each guard's own live output.
 *   That is why the seam here injects GUARD RESULTS and MEASUREMENTS rather than a matrix with numbers typed into
 *   it: the property under test is that no number CAN be typed in.
 */

const PROJECT = process.cwd();
const MATRIX = "config/principle-enforcement.json";
const DOC = "docs/city/PHASE2_PRINCIPLE_ENFORCEMENT_MATRIX.md";
const P2B = "scripts/p2b-kernel-feature-ratchet.cjs";
const P2D = "scripts/phase2-private-state.cjs";
const FLATNESS = "scripts/city-flatness-validator.cjs";
const CLOSURE = "scripts/capability-closure-validator.cjs";
const CORE = "scripts/core-budget-validator.cjs";
const T_P2B = "tests/unit/city/p2b-kernel-feature-ratchet.test.ts";
const T_P2D = "tests/unit/city/phase2-private-state.test.ts";
const T_FLATNESS = "tests/unit/city/city-flatness-validator.test.ts";
const T_CLOSURE = "tests/unit/city/capability-closure-validator.test.ts";
const T_CORE = "tests/unit/city/core-budget-validator.test.ts";
const T_UNRELATED = "tests/unit/city/s2-exit-audit.test.ts";
const CLOSURE_DOC = "docs/city/PHASE2_P2A_PROVIDER_CLOSURE.md";
const SPEC_DOC = "docs/city/PHASE2_ARCHITECTURE_MIGRATION_SPEC.md";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require(path.join(PROJECT, "scripts/principle-enforcement-validator.cjs")) as {
  validateMatrix: (
    matrix: unknown,
    root?: string,
    options?: Record<string, unknown>,
  ) => { ok: boolean; problems: string[]; counts: Record<string, number>; rows: Array<{ id: string; strength: string; measured: Array<{ key: string; value: number; target: number }> }> };
  renderTable: (report: unknown) => string;
  readMatrix: (root?: string) => { principles: Array<Record<string, unknown>> };
  runGuard: (relPath: string, root?: string) => { exists: boolean; readOnly: boolean | null; writeTokens: string[]; exitCode: number | null; json: unknown };
  docRegion: (root?: string) => { current: string; eol: string } | null;
  regionMatches: (text: string, table: string) => boolean;
  KEY_GUARD: Record<string, string>;
  REQUIRED_IDS: string[];
  MATRIX_PATH: string;
  DOC_PATH: string;
};

type Row = Record<string, unknown>;

const BASE_MEASURED: Record<string, number> = {
  "p2b:kernelToFeatureFileEdges": 73,
  "p2b:addedLateralLoad": 0,
  "flatness:shapeProblems": 0,
  "p2b:mutualCapabilityPairs": 38,
  "p2b:largestSccSize": 20,
  "p2d:confirmedAccesses": 5,
  "core:growth": 0,
};

function baseRow(id: string): Row {
  switch (id) {
    case "15.1":
      return {
        id,
        claim: "foundation must not depend on building",
        requiredStrength: "MACHINE ENFORCED",
        strength: "MACHINE_RATCHET",
        guards: [P2B],
        wiredBy: [T_P2B],
        measuredFrom: "p2b:kernelToFeatureFileEdges",
        target: 0,
        why_not_enforced: "the guard refuses a RISE and the count is 73, not 0",
        gap: "stage P2-B",
      };
    case "15.2":
      return {
        id,
        claim: "size is not itself a defect signal",
        requiredStrength: "MACHINE SEMANTICS PINNED",
        strength: "EVIDENCE_REQUIRED",
        guards: [],
        wiredBy: [],
        measuredFrom: null,
        target: null,
        evidenceRequirement: "every structural change records the minimum stable semantic closure it migrated and why",
        decisionRecords: [CLOSURE_DOC],
        why_not_enforced: "nothing machine-checks that a rule does not key on a file count",
        gap: "the evidence requirement is enforced only as the existence of a record",
      };
    case "15.3":
      return {
        id,
        claim: "minimum stable closure is the unit of migration",
        requiredStrength: "MACHINE CHECKED where decidable + explicit review record",
        strength: "EVIDENCE_REQUIRED",
        guards: [CLOSURE],
        wiredBy: [T_CLOSURE],
        measuredFrom: null,
        target: null,
        evidenceRequirement: "each migration step states the closure it moved and what it deliberately did not move",
        decisionRecords: [CLOSURE_DOC, SPEC_DOC],
        why_not_enforced: "whether a bundle of files is one purpose or seven is a design judgement",
        gap: "the judgement half is a review record, not a check",
      };
    case "15.5":
      return {
        id,
        claim: "least-sufficient repair: no prohibited added lateral load",
        requiredStrength: "MACHINE CHECK on prohibited added lateral load",
        strength: "MACHINE_ENFORCED",
        guards: [P2B],
        wiredBy: [T_P2B],
        measuredFrom: "p2b:addedLateralLoad",
        target: 0,
        why_not_enforced: null,
      };
    case "15.6":
      return {
        id,
        claim: "every plot has exactly one valid flatness state",
        requiredStrength: "MACHINE ENFORCED",
        strength: "MACHINE_ENFORCED",
        guards: [FLATNESS],
        wiredBy: [T_FLATNESS],
        measuredFrom: "flatness:shapeProblems",
        target: 0,
        why_not_enforced: null,
      };
    case "15.7":
      return {
        id,
        claim: "no cycles, no uncontrolled lateral bearing, no cross-domain private state access",
        requiredStrength: "MACHINE ENFORCED",
        strength: "MACHINE_RATCHET",
        guards: [P2B, P2D],
        wiredBy: [T_P2B, T_P2D],
        measuredFrom: null,
        target: 0,
        composite: [
          { part: "mutual capability pairs", measuredFrom: "p2b:mutualCapabilityPairs", target: 0 },
          { part: "largest strongly connected component", measuredFrom: "p2b:largestSccSize", target: 0 },
          { part: "cross-domain private-state accesses", measuredFrom: "p2d:confirmedAccesses", target: 0 },
        ],
        why_not_enforced: "all guards refuse a regression and every part is still above zero",
        gap: "stages P2-C and P2-D",
      };
    case "15.9":
      return {
        id,
        claim: "Core growth ban",
        requiredStrength: "MACHINE ENFORCED",
        strength: "MACHINE_ENFORCED",
        guards: [CORE],
        wiredBy: [T_CORE],
        measuredFrom: "core:growth",
        target: 0,
        why_not_enforced: null,
      };
    default:
      return {
        id,
        claim: `principle ${id}`,
        requiredStrength: "MACHINE ENFORCED",
        strength: "NOT_GUARDED",
        guards: [],
        wiredBy: [],
        measuredFrom: null,
        target: null,
        why_not_enforced: "no mechanism exists, so there is nothing to check",
        gap: `stage ${id} has not been started`,
      };
  }
}

function baseMatrix(): { schema: string; principles: Row[] } {
  return {
    schema: "city-principle-enforcement/1",
    principles: ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7", "15.8", "15.9"].map(baseRow),
  };
}

function row(matrix: { principles: Row[] }, id: string): Row {
  const found = matrix.principles.find((entry) => entry.id === id);
  if (!found) throw new Error(`fixture has no row ${id}`);
  return found;
}

function validateFixture(
  matrix: { schema: string; principles: Row[] },
  options: { guards?: Record<string, Record<string, unknown>>; measured?: Record<string, number> } = {},
) {
  const getGuard = (relPath: string) => ({
    path: relPath,
    exists: true,
    readOnly: true,
    writeTokens: [],
    exitCode: 0,
    json: {},
    parseError: null,
    ...(options.guards?.[relPath] ?? {}),
  });
  const measured = { ...BASE_MEASURED, ...(options.measured ?? {}) };
  const resolve = (key: string) =>
    key in measured ? { key, ok: true, value: measured[key] } : { key, ok: false, reason: `no instrument publishes ${key}` };
  return validator.validateMatrix(matrix, PROJECT, { getGuard, resolve });
}

describe("P2-I the principle enforcement matrix is checked against the tree, not asserted", () => {
  it("accepts the fixture baseline, so every rejection below is caused by the mutation under test", () => {
    const report = validateFixture(baseMatrix());
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("rejects a principle with no row", () => {
    const matrix = baseMatrix();
    matrix.principles = matrix.principles.filter((entry) => entry.id !== "15.5");
    const report = validateFixture(matrix);
    expect(report.ok).toBe(false);
    expect(report.problems.join("\n")).toContain("principle 15.5 has no row");
  });

  it("rejects an invented principle and a duplicated one", () => {
    const invented = baseMatrix();
    invented.principles.push({ ...baseRow("15.4"), id: "15.10" });
    expect(validateFixture(invented).problems.join("\n")).toContain("15.10 is not one of 15.1-15.9");

    const duplicated = baseMatrix();
    duplicated.principles.push({ ...baseRow("15.9"), id: "15.9" });
    expect(validateFixture(duplicated).problems.join("\n")).toContain("principle 15.9 has 2 rows");
  });

  it("rejects a strength below the required one that does not explain the shortfall", () => {
    const matrix = baseMatrix();
    row(matrix, "15.1").why_not_enforced = null;
    expect(validateFixture(matrix).problems.join("\n")).toContain("falls short of the required");
  });

  it("rejects a strength outside the declared set", () => {
    const matrix = baseMatrix();
    row(matrix, "15.1").strength = "PROBABLY_FINE";
    expect(validateFixture(matrix).problems.join("\n")).toContain("is not one of");
  });

  it("rejects a guard that does not exist", () => {
    const matrix = baseMatrix();
    row(matrix, "15.1").guards = ["scripts/no-such-guard.cjs"];
    const report = validateFixture(matrix, { guards: { "scripts/no-such-guard.cjs": { exists: false } } });
    expect(report.problems.join("\n")).toContain("scripts/no-such-guard.cjs does not exist");
  });

  it("rejects a guard that writes to the tree", () => {
    const matrix = baseMatrix();
    const report = validateFixture(matrix, { guards: { [P2B]: { readOnly: false, writeTokens: ["writeFileSync"] } } });
    expect(report.problems.join("\n")).toContain("writes to the tree");
  });

  it("rejects a row citing a guard that is currently failing", () => {
    const matrix = baseMatrix();
    const report = validateFixture(matrix, { guards: { [P2B]: { exitCode: 1 } } });
    expect(report.problems.join("\n")).toContain("exits 1");
  });

  it("rejects a test that reaches none of the guards it is cited for", () => {
    const matrix = baseMatrix();
    row(matrix, "15.1").wiredBy = [T_UNRELATED];
    expect(validateFixture(matrix).problems.join("\n")).toContain("mentions none of the guards");
  });

  it("rejects a guard that no cited test reaches", () => {
    const matrix = baseMatrix();
    row(matrix, "15.1").guards = [P2B, CLOSURE];
    expect(validateFixture(matrix).problems.join("\n")).toContain(`${CLOSURE} is reached by no cited test`);
  });

  it("rejects MACHINE_ENFORCED whose measurement is above the target -- the promotion forgery", () => {
    const matrix = baseMatrix();
    row(matrix, "15.1").strength = "MACHINE_ENFORCED";
    row(matrix, "15.1").why_not_enforced = null;
    const report = validateFixture(matrix);
    expect(report.problems.join("\n")).toContain("claims MACHINE_ENFORCED but p2b:kernelToFeatureFileEdges measures 73");
  });

  it("rejects MACHINE_ENFORCED with a target other than zero", () => {
    const matrix = baseMatrix();
    row(matrix, "15.6").target = 5;
    expect(validateFixture(matrix).problems.join("\n")).toContain("enforcement means the target is 0");
  });

  it("rejects a ratchet whose measurement reached the target, because the row must then be promoted", () => {
    const matrix = baseMatrix();
    const report = validateFixture(matrix, { measured: { "p2b:kernelToFeatureFileEdges": 0 } });
    expect(report.problems.join("\n")).toContain("promote the row to MACHINE_ENFORCED");
  });

  it("rejects a measurement key that no instrument publishes, and a key read from a guard the row did not name", () => {
    const unresolvable = baseMatrix();
    row(unresolvable, "15.1").measuredFrom = "p2b:inventedQuantity";
    expect(validateFixture(unresolvable).problems.join("\n")).toContain("cannot resolve p2b:inventedQuantity");

    const borrowed = baseMatrix();
    row(borrowed, "15.1").measuredFrom = "p2d:confirmedAccesses";
    expect(validateFixture(borrowed).problems.join("\n")).toContain(`${P2D}, which the row does not name as a guard`);
  });

  it("rejects a machine claim with nothing to measure it against", () => {
    const matrix = baseMatrix();
    row(matrix, "15.1").measuredFrom = null;
    expect(validateFixture(matrix).problems.join("\n")).toContain("names nothing to measure it against");
  });

  it("rejects EVIDENCE_REQUIRED with no record, an empty record, or a record that does not exist", () => {
    const none = baseMatrix();
    row(none, "15.2").decisionRecords = [];
    expect(validateFixture(none).problems.join("\n")).toContain("EVIDENCE_REQUIRED without a decision record");

    const empty = baseMatrix();
    row(empty, "15.2").evidenceRequirement = "too short";
    expect(validateFixture(empty).problems.join("\n")).toContain("without a substantive evidenceRequirement");

    const missing = baseMatrix();
    row(missing, "15.2").decisionRecords = ["docs/city/NO_SUCH_RECORD.md"];
    expect(validateFixture(missing).problems.join("\n")).toContain("docs/city/NO_SUCH_RECORD.md does not exist");
  });

  it("rejects NOT_GUARDED without naming the stage that owns the gap", () => {
    const matrix = baseMatrix();
    row(matrix, "15.8").gap = null;
    expect(validateFixture(matrix).problems.join("\n")).toContain("NOT_GUARDED without naming the stage");
  });
});

describe("P2-I the committed matrix, its guards, and its document", () => {
  it("has exactly the nine required principles and no others", () => {
    const matrix = validator.readMatrix(PROJECT);
    expect(matrix.principles.map((entry) => entry.id)).toEqual(validator.REQUIRED_IDS);
  });

  it("passes against the real guards, and resolves its measurements from them rather than from the file", () => {
    const report = validator.validateMatrix(validator.readMatrix(PROJECT), PROJECT);
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);

    const measured = (id: string) => report.rows.find((entry) => entry.id === id)!.measured.map((item) => [item.key, item.value]);
    // These literals are the INDEPENDENT readback of the live instruments: the same numbers are recorded in
    // config/p2b-kernel-feature-ratchet.json and config/p2d-private-state-ratchet.json, and this case fails if
    // the validator resolves something other than what those instruments publish. They move only when an
    // instrument's measurement moves -- 61/22/33 became 60/21/32 in the atomic attachments migration
    // (ledger CC-065), then 59/20/31 in the atomic identity migration (CC-066), then 58/19/31 in the
    // atomic node migration (CC-067), then 57/18/31 in the atomic experience migration (CC-068), while
    // the confirmed private-state accesses and the flatness problems were unchanged by all four.
    expect(measured("15.1")).toEqual([["p2b:kernelToFeatureFileEdges", 57]]);
    expect(measured("15.5")).toEqual([["p2b:addedLateralLoad", 0]]);
    expect(measured("15.6")).toEqual([["flatness:shapeProblems", 0]]);
    expect(measured("15.7")).toEqual([
      ["p2b:mutualCapabilityPairs", 31],
      ["p2b:largestSccSize", 19],
      ["p2d:confirmedAccesses", 5],
    ]);
    expect(measured("15.9")).toEqual([["core:growth", 0]]);
    // The distribution section 23's targets produce today: three enforced, two ratchets, three requiring only that
    // the evidence exists (15.8 joined them when P2-E built the road class), and one whose stage has not started.
    expect(report.counts).toEqual({ MACHINE_ENFORCED: 3, MACHINE_RATCHET: 2, EVIDENCE_REQUIRED: 4, NOT_GUARDED: 0 });
  });

  it("records no measurement as a number in the matrix file, so none can drift", () => {
    const source = fs.readFileSync(path.join(PROJECT, MATRIX), "utf8");
    // Every key the matrix names must be one the validator knows how to resolve from a live instrument. The
    // reverse direction is deliberately NOT asserted: a registered key that no row uses is a key that has been
    // retired, not a defect.
    const named = [...source.matchAll(/"(?:p2b|p2d|flatness):[A-Za-z]+"/g)].map((match) => match[0].slice(1, -1));
    expect(named.length).toBeGreaterThan(0);
    for (const key of named) expect(Object.keys(validator.KEY_GUARD)).toContain(key);
    // No row carries a measured field at all, and every target is zero: this matrix has no non-zero target.
    expect(source).not.toContain('"measured"');
    const targets = [...source.matchAll(/"target"\s*:\s*(-?\d+)/g)].map((match) => match[1]);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((value) => value === "0")).toBe(true);
  });

  it("cites only guards that are read-only and exit zero when run directly", () => {
    for (const guard of [P2B, P2D, FLATNESS, CLOSURE, CORE]) {
      const result = validator.runGuard(guard, PROJECT);
      expect(result.exists).toBe(true);
      expect(result.writeTokens).toEqual([]);
      expect(result.readOnly).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.json).not.toBeNull();
    }
  });

  it("keeps the committed document's table identical to the table it generates, across line endings", () => {
    const report = validator.validateMatrix(validator.readMatrix(PROJECT), PROJECT);
    const table = validator.renderTable(report);
    const text = fs.readFileSync(path.join(PROJECT, DOC), "utf8");

    expect(validator.regionMatches(text, table)).toBe(true);
    // Line-ending agnostic, and that is not a convenience: the table is generated with LF while git checks the
    // document out with CRLF on Windows, so a byte comparison passes on the machine that wrote the file and fails
    // on the runner that verifies it -- which is exactly how the first CI run of this stage failed.
    expect(validator.regionMatches(text.replace(/\r?\n/g, "\r\n"), table)).toBe(true);
    expect(validator.regionMatches(text.replace(/\r?\n/g, "\n"), table)).toBe(true);

    // And it still bites on real staleness, so being EOL-agnostic did not turn it into a check that always passes.
    const stale = text.replace("| 15.1 ", "| 15.1x ");
    expect(stale).not.toBe(text);
    expect(validator.regionMatches(stale, table)).toBe(false);
  });

  it("names the one remaining unguarded principle explicitly rather than leaving it to inference", () => {
    const region = validator.docRegion(PROJECT)!;
    expect(region.current).toContain("15.4");
    const text = fs.readFileSync(path.join(PROJECT, DOC), "utf8");
    for (const id of ["15.4", "15.8", "15.9"]) expect(text).toContain(`\`${id}\``);
    // 15.9 left the unguarded list when P2-H gave it a mechanism, 15.8 when P2-E gave it a classification, and 15.4
    // when P2-G built the replacement lifecycle -- the list is now EMPTY, and the document must not still call any
    // principle unguarded.
    expect(text).toContain("**0 unguarded**");
    expect(text).toContain("**3 enforced**");
    expect(text).toContain("**4 evidence-required**");
  });
});
