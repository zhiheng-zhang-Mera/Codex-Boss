import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * P2-D — the cross-domain private-state validator, and the two rules it needed before it was right.
 *
 * WHAT THE PROPERTY IS
 *
 *   `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` section 18: "one durable state object has one
 *   authoritative owner; cross-capability private path access = forbidden; consumers use a contract, event, query
 *   API, or declared read model". So the defect is not naming a namespace -- it is RESOLVING a path into one
 *   another capability owns, which is what reaching the state without its owner's contract looks like in source.
 *
 * THE TWO RULES THIS INSTRUMENT GOT WRONG FIRST, AND WHY THE CASES BELOW EXIST
 *
 *   1  A NAME IS NOT AN ACCESS. Matching a declared namespace as a quoted string reported `"history"` inside a
 *      SKIP set, `FleetAggregate["tasks"]` and `"tasks"` as a component id. The rule is a PATH JOIN whose last
 *      segment is a declared namespace.
 *   2  A PATH JOIN IS NOT ALWAYS A DURABLE ACCESS. `path.join(artifacts, "history")` is a session's own
 *      subdirectory and `path.join(context.dir, "tasks")` is a sandbox. A join is CONFIRMED only when it carries
 *      a durable-root marker.
 *   3  AND THE MARKER LIST WAS TOO NARROW: `host-status` reaches the task ledger through
 *      `path.join(boss, "tasks")`, where `const boss = path.join(sources.dataRoot, ".boss")`. The workbook's OWN
 *      historical example classified as "unclassified" until the ROOT indirection was resolved, which is how the
 *      rule was found to be wrong rather than by reading it.
 */

const PROJECT = process.cwd();
const SCRIPT = "scripts/phase2-private-state.cjs";
const RATCHET_PATH = "config/p2d-private-state-ratchet.json";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require(path.join(PROJECT, SCRIPT)) as {
  measure: (root?: string) => {
    confirmedAccesses: number;
    confirmedPairs: number;
    pairs: string[];
    candidates: number;
    confirmed: Array<{ namespace: string; declaredOwner: string; accessedBy: string; file: string; line: number }>;
    candidateAccesses: Array<{ namespace: string; accessedBy: string; file: string; line: number }>;
    multiWriterCandidates: Array<{ namespace: string; declaredOwner: string; accessedBy: string[] }>;
    multiWriterClaim: string;
    declaredNamespaces: number;
    scannedSourceFiles: number;
  };
  decide: (report: unknown, ratchet: unknown) => { ok: boolean; problems: string[]; improvements: string[]; measured: Record<string, number | null> };
  readRatchet: () => { recorded: Record<string, number>; target: Record<string, number> };
  namespaceConstantsOf: (text: string, namespaces: Set<string>) => Map<string, string>;
  durableRootNamesOf: (text: string) => Set<string>;
  namespaceOfJoin: (argumentsText: string, constants: Map<string, string>, namespaces: Set<string>, durableRootNames?: Set<string>) => { namespace: string; confirmed: boolean } | undefined;
  namespaceJoinsIn: (text: string, constants: Map<string, string>, namespaces: Set<string>, durableRootNames?: Set<string>) => Array<{ namespace: string; confirmed: boolean; line: number }>;
};

const NAMESPACES = new Set(["tasks", "history", "decision-ledger"]);

describe("P2-D validator — the pure rules, each pinned against the mistake it was written to fix", () => {
  it("finds a module constant bound to a declared namespace, and ignores one that is not", () => {
    const found = validator.namespaceConstantsOf('export const HISTORY_DIRECTORY = "history";\nconst OTHER = "artifacts";', NAMESPACES);
    expect([...found.entries()]).toEqual([["HISTORY_DIRECTORY", "history"]]);
  });

  it("finds a local name bound to a DURABLE ROOT, which is what the marker list alone missed", () => {
    const names = validator.durableRootNamesOf('const boss = path.join(sources.dataRoot, ".boss");\nconst scratch = path.join(tmp, "scratch");');
    expect([...names]).toEqual(["boss"]);
    expect(names.has("scratch"), "a path join that is not under a durable root was treated as one").toBe(false);
  });

  it("classifies a join under a durable root as CONFIRMED and one under another directory as not", () => {
    const constants = new Map<string, string>();
    expect(validator.namespaceOfJoin('dataRoot, "tasks"', constants, NAMESPACES)?.confirmed).toBe(true);
    expect(validator.namespaceOfJoin('input.dataRoot, ".boss", "tasks"', constants, NAMESPACES)?.confirmed).toBe(true);
    expect(validator.namespaceOfJoin('context.dir, "tasks"', constants, NAMESPACES)?.confirmed, "a sandbox directory was treated as durable state").toBe(false);
    expect(validator.namespaceOfJoin('artifacts, HISTORY_DIRECTORY', new Map([["HISTORY_DIRECTORY", "history"]]), NAMESPACES)?.confirmed).toBe(false);
  });

  it("resolves the ROOT through a durable-root name, so the workbook's own example is not 'unclassified'", () => {
    const constants = new Map<string, string>();
    const roots = validator.durableRootNamesOf('const boss = path.join(sources.dataRoot, ".boss");');
    const resolved = validator.namespaceOfJoin('boss, "tasks"', constants, NAMESPACES, roots);
    expect(resolved?.namespace).toBe("tasks");
    expect(resolved?.confirmed, "host-status reaching the task ledger through `boss` was not recognised as durable").toBe(true);
  });

  it("does NOT treat a namespace name that is not the last path segment as an access", () => {
    // `path.join("tasks", fileName)` resolves a name INSIDE the namespace, and `"tasks"` as a field name is not a
    // path at all. Only the last segment names the directory.
    expect(validator.namespaceOfJoin('"tasks", name', new Map(), NAMESPACES)).toBeUndefined();
    expect(validator.namespaceOfJoin('dataRoot, "not-a-namespace"', new Map(), NAMESPACES)).toBeUndefined();
  });

  it("finds joins in a file and reports the line, through both indirections at once", () => {
    const text = [
      'import path from "node:path";',
      'export const HISTORY_DIRECTORY = "history";',
      'const boss = path.join(sources.dataRoot, ".boss");',
      'function a() { return path.join(boss, "tasks"); }',
      'function b() { return path.join(artifacts, HISTORY_DIRECTORY); }',
    ].join("\n");
    const joins = validator.namespaceJoinsIn(text, validator.namespaceConstantsOf(text, NAMESPACES), NAMESPACES, validator.durableRootNamesOf(text));
    expect(joins.map((join) => [join.namespace, join.confirmed, join.line])).toEqual([["tasks", true, 4], ["history", false, 5]]);
  });
});

describe("P2-D validator — the real tree", () => {
  const report = validator.measure();

  it("measures the tree rather than a subset, and finds the accesses section 18 is about", () => {
    expect(report.declaredNamespaces, "the manifests declare no durable namespaces").toBeGreaterThan(20);
    expect(report.scannedSourceFiles, "the scan found almost no source files").toBeGreaterThan(500);
    expect(report.confirmedAccesses, "section 18 is complete: there are no cross-domain accesses left, and this case must be replaced rather than deleted").toBeGreaterThan(0);
  });

  it("every confirmed access reaches a namespace whose declared owner is a DIFFERENT capability", () => {
    for (const access of report.confirmed) {
      expect(access.declaredOwner, `${access.file} claims to cross a domain but the namespace has no owner`).toBeTruthy();
      expect(access.accessedBy, `${access.file} is its own namespace's owner`).not.toBe(access.declaredOwner);
    }
  });

  it("FINDS THE WORKBOOK'S OWN HISTORICAL EXAMPLE, which is why the rule was corrected", () => {
    // "host-status parsing persistence state.json" is named in section 18 as a historical example. An instrument
    // that cannot find the defect it was written for is measuring something else, and the first version of this
    // one could not -- the access was real but classified as unclassified.
    const pairs = report.pairs;
    expect(pairs, `the historical example is gone: if that is a real repair, change this case deliberately (pairs: ${JSON.stringify(pairs)})`).toContain("tasks <- host-status");
    const hostStatus = report.confirmed.filter((access) => access.accessedBy === "host-status");
    expect(hostStatus.length).toBeGreaterThan(0);
    expect(hostStatus.every((access) => access.namespace === "tasks")).toBe(true);
  });

  it("keeps the unclassified tier SEPARATE, and says what it is not", () => {
    // The unclassified joins have reasons (a session's own subdirectory, a sandbox, the path-layout module), and
    // reporting them as accesses would make the number depend on how many directories share a namespace's name.
    expect(report.candidates).toBeGreaterThan(0);
    for (const access of report.candidateAccesses) {
      expect(report.confirmed.some((entry) => entry.file === access.file && entry.line === access.line), `${access.file} is counted in both tiers`).toBe(false);
    }
  });

  it("does NOT claim to measure multiple WRITERS, and machine-enforces the declared property instead", () => {
    // Read-versus-write is not statically decidable here: the stores are constructed with a path and the open mode
    // is not in the source. A validator that guessed it would be inventing the number section 18 asks for.
    expect(report.multiWriterClaim).toMatch(/NOT CLAIMED/);
    for (const entry of report.multiWriterCandidates) {
      expect(entry.accessedBy.length, `${entry.namespace} is listed as a multi-writer candidate with one accessor`).toBeGreaterThan(1);
      expect(entry.accessedBy).not.toContain(entry.declaredOwner);
    }
  });

  it("its two ceilings and two floors hold on the committed tree", () => {
    const decision = validator.decide(report, validator.readRatchet());
    expect(decision.problems, decision.problems.join("; ")).toEqual([]);
    expect(decision.ok).toBe(true);
    expect(decision.improvements, "a recorded ceiling is now above the measurement; lower it in this commit").toEqual([]);
  });
});

describe("P2-D validator — the ratchet refuses both directions", () => {
  const baseline = {
    ownershipModel: "config/capability-modules.json -- the OWNERSHIP MAP, not the manifests",
    measuredAt: "2026-09-25T03:20Z",
    recorded: { cross_domain_state_accesses: 5, cross_domain_state_pairs: 3, namespace_joins_into_anothers_state: 10, unclassified_namespace_joins: 5, declared_namespaces: 32, scanned_source_files: 612 },
    target: { cross_domain_state_accesses: 0 },
  };
  const shaped = (overrides: Record<string, number> = {}): unknown => ({
    confirmedAccesses: overrides.confirmedAccesses ?? 5,
    confirmedPairs: overrides.confirmedPairs ?? 3,
    candidates: overrides.candidates ?? 5,
    declaredNamespaces: overrides.declaredNamespaces ?? 32,
    scannedSourceFiles: overrides.scannedSourceFiles ?? 612,
  });

  const refusals: Array<[string, unknown, RegExp]> = [
    ["a new confirmed access", shaped({ confirmedAccesses: 6 }), /cross-domain private-state accesses ROSE to 6/],
    ["a new (namespace, capability) pair", shaped({ confirmedPairs: 4 }), /cross-domain private-state pairs ROSE to 4/],
    ["a namespace dropped from the manifests", shaped({ declaredNamespaces: 31 }), /declared durable namespaces FELL to 31/],
    ["fewer files scanned", shaped({ scannedSourceFiles: 611 }), /scanned source files FELL to 611/],
  ];
  for (const [name, constructed, expected] of refusals) {
    it(`refuses ${name}`, () => {
      const decision = validator.decide(constructed, baseline);
      expect(decision.ok, `${name} passed the ratchet`).toBe(false);
      expect(decision.problems.join(" | ")).toMatch(expected);
    });
  }

  it("has a TOTAL ceiling, so an access cannot hide by being unclassifiable", () => {
    // The design point: with only the confirmed ceiling an access could grow inside the unclassified tier, and
    // with only the total the confirmed/unclassified split would be unrecorded. Both are asserted.
    const decision = validator.decide(shaped({ candidates: 6 }), baseline);
    expect(decision.ok, "an unclassified join grew and the ratchet did not notice").toBe(false);
    expect(decision.problems.join(" ")).toMatch(/unclassified namespace joins ROSE to 6/);
  });

  it("reports a fall as the improvement to record", () => {
    const decision = validator.decide(shaped({ confirmedAccesses: 2, confirmedPairs: 1, candidates: 3 }), baseline);
    expect(decision.ok, decision.problems.join("; ")).toBe(true);
    expect(decision.improvements.join(" ")).toMatch(/cross-domain private-state accesses fell from 5 to 2/);
  });

  it("fails closed when a value cannot be compared", () => {
    const decision = validator.decide({}, baseline);
    expect(decision.ok, "an unreadable measurement passed the ratchet").toBe(false);
    expect(decision.problems.length).toBeGreaterThanOrEqual(4);
    expect(decision.problems.join(" ")).toMatch(/not comparable/);
  });
});

describe("P2-D validator — the artifact and the program's own boundaries", () => {
  it("the artifact names its model, its command, its target and its multi-writer disclaimer", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(PROJECT, RATCHET_PATH), "utf8")) as Record<string, unknown>;
    expect(raw.schema).toBe("city-p2d-private-state-ratchet/1");
    expect(String(raw.ownership_model)).toContain("capability-modules.json");
    expect(String(raw.measured_by)).toContain("phase2-private-state.cjs");
    expect(String(raw.reason ?? "").length, "the artifact carries no substantive reason").toBeGreaterThan(80);
    expect((raw.target as Record<string, number>).cross_domain_state_accesses, "section 18's target is 0").toBe(0);
    const multiWriter = raw.multi_writer as Record<string, string>;
    expect(String(multiWriter.claim)).toMatch(/NOT CLAIMED/);
    // Every unclassified (namespace, capability) PAIR has a recorded reason, so the tier is a classification and
    // not a dumping ground. Keyed by pair rather than by join because the three `runtime-paths` joins share one
    // reason -- they are one decision about the path-layout module, not three.
    const unclassified = raw.the_five_unclassified as Record<string, string>;
    const reasons = Object.keys(unclassified).filter((key) => key !== "$comment");
    const pairs = new Set(validator.measure().candidateAccesses.map((access) => `${access.namespace} <- ${access.accessedBy}`));
    for (const pair of pairs) {
      expect(reasons.some((reason) => reason.includes(pair)), `the unclassified pair ${pair} has no recorded reason`).toBe(true);
    }
    expect(reasons.length, "the artifact records a reason for something the measurement no longer reports").toBe(pairs.size);
  });

  it("is a plain Node program, and is read-only", () => {
    const probe = spawnSync(process.execPath, ["-e", `const m=require(${JSON.stringify(path.join(PROJECT, SCRIPT))}); if(!m.measure||!m.decide||!m.readRatchet) process.exit(1);`], { encoding: "utf8", timeout: 60000 });
    expect(probe.status, `the validator could not be loaded by plain node: ${probe.stderr}`).toBe(0);
    const source = fs.readFileSync(path.join(PROJECT, SCRIPT), "utf8");
    for (const forbidden of ["writeFileSync", "appendFileSync", "unlinkSync", "rmSync"]) {
      expect(source.includes(forbidden), `the read-only validator calls ${forbidden}`).toBe(false);
    }
  });

  it("the CLI exits 0 on the real tree and states its definition", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { cwd: PROJECT, encoding: "utf8", timeout: 300000 });
    expect(run.status, `the validator CLI failed on the committed tree: ${run.stdout}${run.stderr}`).toBe(0);
    expect(String(run.stdout)).toContain("VERDICT=HOLDS");
    expect(String(run.stdout)).toContain("definition:");
  });
});
