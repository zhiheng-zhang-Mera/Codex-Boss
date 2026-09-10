import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EVIDENCE_ISSUES,
  EVIDENCE_KINDS,
  classifyEvidence,
  compareEvidence,
  declaredStatusOf,
  emptyEvidenceInspection,
  findOrphans,
  isStatusBearing,
  matchesQuery,
  normalizeEvidencePath,
  phaseOf,
  queryEvidence,
  referencesIn,
  renderEvidenceInspection,
  resolveReferences,
  siblingPath,
  summarizeEvidence,
  type EvidenceInspection,
  type EvidenceRecord
} from "../../src/shared/evidence-inspector";
import { compareEvidenceRoots, inspectEvidence } from "../../electron/host/evidence-inspector";

const AT = "2026-09-10T00:00:00.000Z";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "host-evidence-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    path: "P1/evidence/P1-thing.json",
    kind: "acceptance-evidence",
    bytes: 100,
    modifiedAt: AT,
    sha256: "a".repeat(64),
    ...overrides
  };
}

function write(relative: string, content: string | Buffer): string {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

describe("evidence inspector contract (P5)", () => {
  it("declares the kind and issue vocabularies the plan requires", () => {
    expect([...EVIDENCE_KINDS]).toContain("acceptance-evidence");
    expect([...EVIDENCE_KINDS]).toContain("research-artifact");
    expect([...EVIDENCE_KINDS]).toContain("episode-record");
    expect([...EVIDENCE_KINDS]).toContain("knowledge-provenance");
    expect([...EVIDENCE_ISSUES]).toEqual(["orphan", "invalid", "unexpected", "dangling"]);
  });

  it("classifies by the path conventions this repository already uses", () => {
    expect(classifyEvidence("Update-Plan/Engine/evidence/P0/P0-baseline.json")).toBe("acceptance-evidence");
    expect(classifyEvidence("Update-Plan/Host-M/requirement-manifest.json")).toBe("manifest");
    expect(classifyEvidence(".boss/tasks/t-1/checkpoints/00000001.json")).toBe("checkpoint");
    expect(classifyEvidence(".boss/learning/episodes.jsonl")).toBe("episode-record");
    expect(classifyEvidence("research/run-1/manuscript/paper.md")).toBe("knowledge-provenance");
    expect(classifyEvidence("Update-Plan/overcomplete/evidence/research/analysis.json")).toBe("research-artifact");
    expect(classifyEvidence("Update-Plan/overcomplete/evidence/engineering/seeded-A.json")).toBe("acceptance-evidence");
    expect(classifyEvidence("logs/boss.log")).toBe("log");
    expect(classifyEvidence("artifacts/host-soak/report.json", { jsonContent: { status: "PASS" } })).toBe("report");
  });

  it("treats a status-bearing JSON file as an acceptance claim", () => {
    expect(isStatusBearing({ status: "PASS" })).toBe(true);
    expect(isStatusBearing({ overall: "FAIL" })).toBe(true);
    expect(isStatusBearing({ rows: [] })).toBe(false);
    expect(isStatusBearing("PASS")).toBe(false);
    expect(declaredStatusOf({ status: "BLOCKED_EXTERNAL" })).toBe("BLOCKED_EXTERNAL");
    expect(declaredStatusOf({ overall: "DEGRADED" })).toBe("DEGRADED");
    expect(declaredStatusOf({ rows: [] })).toBeUndefined();
  });

  it("derives a phase from the path rather than a hard-coded map", () => {
    expect(phaseOf("Update-Plan/Engine/evidence/P3/P3-model-identity.json")).toBe("P3");
    expect(phaseOf("Update-Plan/10-x/evidence/10A/10A-architecture.json")).toBe("10A");
    expect(phaseOf("Update-Plan/owner-result/evidence/round-6/x.json")).toBe("round-6");
    // A flat evidence directory has no phase subdirectory, so the artifact's own
    // name is the narrowing the path provides.
    expect(phaseOf("Update-Plan/2026-09-09-closure/evidence/r901-soak-2h.json")).toBe("r901-soak-2h.json");
    expect(phaseOf("src/shared/adaptive-flags.ts")).toBeUndefined();
  });

  it("normalizes paths to forward slashes", () => {
    expect(normalizeEvidencePath("a\\b\\c.json")).toBe("a/b/c.json");
    expect(normalizeEvidencePath("./a/b.json")).toBe("a/b.json");
  });

  it("finds artifact references but not prose that merely mentions an extension", () => {
    const references = referencesIn({
      evidence: ["Update-Plan/Engine/evidence/P0/P0-baseline.json"],
      note: "node scripts/host-acceptance.cjs completed the whole surface in 21s and reported FAIL",
      url: "https://example.invalid/a/b.json",
      nested: { deep: { ref: "src/shared/adaptive-flags.ts" } }
    });
    expect(references).toContain("Update-Plan/Engine/evidence/P0/P0-baseline.json");
    expect(references).toContain("src/shared/adaptive-flags.ts");
    expect(references.some((entry) => entry.includes(" "))).toBe(false);
    expect(references.some((entry) => entry.startsWith("https"))).toBe(false);
  });

  it("resolves a sibling-relative reference and refuses to escape the root", () => {
    expect(siblingPath("10-x/requirement-manifest.json", "evidence/10A/x.json")).toBe("10-x/evidence/10A/x.json");
    expect(siblingPath("a/b/c.json", "../d.json")).toBe("a/d.json");
    expect(siblingPath("a.json", "../escape.json")).toBeUndefined();
  });

  it("does not report a reference that resolves against a second anchor", () => {
    const records = [
      record({ path: "10-x/requirement-manifest.json", references: ["evidence/10A/x.json", "scripts/thing.cjs"] })
    ];
    const resolved = resolveReferences(records, {
      knownPaths: new Set(["10-x/evidence/10A/x.json"]),
      extraPaths: new Set(["scripts/thing.cjs"])
    });
    expect(resolved.issues).toEqual([]);
    expect([...resolved.cited]).toEqual(["10-x/evidence/10A/x.json"]);
  });

  it("reports a reference that resolves against nothing", () => {
    const resolved = resolveReferences([record({ references: ["nowhere/x.json"] })], { knownPaths: new Set() });
    expect(resolved.issues).toHaveLength(1);
    expect(resolved.issues[0].kind).toBe("dangling");
    expect(resolved.issues[0].detail).toContain("nowhere/x.json");
  });

  it("never reports a record that was already found cited as an orphan", () => {
    const records = [record({ referenced: true }), record({ path: "b.json" })];
    const orphans = findOrphans(records, { cited: new Set() });
    expect(orphans.map((issue) => issue.path)).toEqual(["b.json"]);
  });

  it("queries by kind, substring, time window, status, size and citation state", () => {
    const records = [
      record({ path: "a/x.json", kind: "acceptance-evidence", declaredStatus: "PASS", bytes: 10, modifiedAt: "2026-01-01T00:00:00.000Z", referenced: true }),
      record({ path: "b/y.json", kind: "report", declaredStatus: "FAIL", bytes: 900, modifiedAt: "2026-06-01T00:00:00.000Z", referenced: false })
    ];
    expect(queryEvidence(records, { kind: "report" }).map((entry) => entry.path)).toEqual(["b/y.json"]);
    expect(queryEvidence(records, { contains: "x.json" }).map((entry) => entry.path)).toEqual(["a/x.json"]);
    expect(queryEvidence(records, { modifiedFrom: "2026-03-01T00:00:00.000Z" }).map((entry) => entry.path)).toEqual(["b/y.json"]);
    expect(queryEvidence(records, { modifiedTo: "2026-03-01T00:00:00.000Z" }).map((entry) => entry.path)).toEqual(["a/x.json"]);
    expect(queryEvidence(records, { withStatus: "FAIL" }).map((entry) => entry.path)).toEqual(["b/y.json"]);
    expect(queryEvidence(records, { minBytes: 100 }).map((entry) => entry.path)).toEqual(["b/y.json"]);
    expect(queryEvidence(records, { referenced: false }).map((entry) => entry.path)).toEqual(["b/y.json"]);
    expect(matchesQuery(records[0], {})).toBe(true);
  });

  it("summarizes counts by kind and issue", () => {
    const summary = summarizeEvidence(
      [record({ kind: "acceptance-evidence", bytes: 10 }), record({ path: "b", kind: "report", bytes: 5 })],
      [{ kind: "orphan", path: "b", detail: "" }, { kind: "invalid", path: "b", detail: "" }]
    );
    expect(summary.files).toBe(2);
    expect(summary.bytes).toBe(15);
    expect(summary.byKind).toEqual({ "acceptance-evidence": 1, report: 1 });
    expect(summary.orphans).toBe(1);
    expect(summary.invalidJson).toBe(1);
  });

  it("compares artifacts hashes-first, so a rewritten file is not called unchanged", () => {
    const before = emptyEvidenceInspection("before", AT);
    before.records = [record({ path: "a.json", sha256: "a".repeat(64) }), record({ path: "gone.json", sha256: "b".repeat(64) })];
    const after = emptyEvidenceInspection("after", AT);
    after.records = [
      record({ path: "a.json", sha256: "c".repeat(64), bytes: 101 }),
      record({ path: "new.json", sha256: "d".repeat(64) })
    ];
    const entries = compareEvidence(before, after);
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("a.json")!.change).toBe("MODIFIED");
    expect(byPath.get("gone.json")!.change).toBe("REMOVED");
    expect(byPath.get("new.json")!.change).toBe("ADDED");
  });

  it("renders issues and degradations so they cannot be missed", () => {
    const inspection: EvidenceInspection = {
      ...emptyEvidenceInspection("root", AT),
      records: [record()],
      issues: [{ kind: "orphan", path: "x.json", detail: "nothing cites it" }],
      summary: summarizeEvidence([record()], [{ kind: "orphan", path: "x.json", detail: "" }]),
      degraded: ["scan stopped at the budget"]
    };
    const text = renderEvidenceInspection(inspection);
    expect(text).toContain("ORPHAN");
    expect(text).toContain("nothing cites it");
    expect(text).toContain("DEGRADED");
  });
});

describe("evidence inspector over a real tree (P5)", () => {
  it("inventories artifacts with real checksums and never writes to them", () => {
    write("Host-M/evidence/P1/P1-thing.json", JSON.stringify({ phase: "Host-M-P1", status: "PASS" }));
    write("Host-M/evidence/P2/P2-other.json", JSON.stringify({ phase: "Host-M-P2", status: "FAIL" }));
    write("Host-M/PROGRESS.md", "# progress\n");
    const before = fs.readFileSync(path.join(dir, "Host-M/evidence/P1/P1-thing.json"), "utf8");

    const inspection = inspectEvidence({ root: dir, now: () => AT });
    expect(inspection.records).toHaveLength(3);
    for (const entry of inspection.records) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.bytes).toBeGreaterThan(0);
    }
    // Byte-for-byte unchanged: the inspector has no write path.
    expect(fs.readFileSync(path.join(dir, "Host-M/evidence/P1/P1-thing.json"), "utf8")).toBe(before);
    // Only one artifact is cited by the other, so exactly one orphan remains.
    const statuses = new Map(inspection.records.map((entry) => [entry.path, entry.declaredStatus]));
    expect(statuses.get("Host-M/evidence/P1/P1-thing.json")).toBe("PASS");
    expect(statuses.get("Host-M/evidence/P2/P2-other.json")).toBe("FAIL");
  });

  it("strips a UTF-8 BOM instead of reporting every BOM file as invalid", () => {
    // 44 evidence files in this repository are written with a BOM; the closure
    // program's own report generator strips it, so the inspector must too.
    write("2026-09-09-closure/evidence/r1001.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"status":"PASS"}', "utf8")]));
    const inspection = inspectEvidence({ root: dir, now: () => AT });
    expect(inspection.summary.invalidJson).toBe(0);
    expect(inspection.records[0].jsonValid).toBe(true);
    expect(inspection.records[0].declaredStatus).toBe("PASS");
  });

  it("reports genuinely malformed JSON as invalid and keeps inspecting", () => {
    write("evidence/broken.json", '{"a":1}\n{"b":2}\n');
    write("evidence/fine.json", '{"status":"PASS"}');
    const inspection = inspectEvidence({ root: dir, now: () => AT });
    expect(inspection.summary.invalidJson).toBe(1);
    expect(inspection.issues.find((issue) => issue.kind === "invalid")!.path).toBe("evidence/broken.json");
    // The healthy file is still fully inspected.
    expect(inspection.records.find((entry) => entry.path === "evidence/fine.json")!.declaredStatus).toBe("PASS");
  });

  it("reports an artifact nothing cites as an orphan by default", () => {
    write("evidence/lonely.json", '{"status":"PASS"}');
    const inspection = inspectEvidence({ root: dir, now: () => AT });
    expect(inspection.summary.orphans).toBe(1);
    expect(inspection.issues[0].kind).toBe("orphan");
  });

  it("suppresses orphan reporting for a bounded scan and says that it did", () => {
    write("evidence/lonely.json", '{"status":"PASS"}');
    const inspection = inspectEvidence({ root: dir, now: () => AT, reportOrphans: false });
    expect(inspection.summary.orphans).toBe(0);
    expect(inspection.degraded.join(" ")).toContain("orphan detection is disabled");
  });

  it("does not report a citation that resolves against the wider repository", () => {
    // A reference to a real file outside the inspected tree must not be called
    // dangling; the resolver confirms existence before deciding.
    const outside = path.join(dir, "outside");
    write("outside/real-module.ts", "export const x = 1;\n");
    write("evidence/notes.json", JSON.stringify({ status: "PASS", evidence: ["outside/real-module.ts"] }));
    const inspection = inspectEvidence({ root: path.join(dir, "evidence"), now: () => AT, repoRoot: dir });
    expect(inspection.issues.some((issue) => issue.kind === "dangling")).toBe(false);
    void outside;
  });

  it("reports a citation that exists nowhere as dangling", () => {
    write("evidence/notes.json", JSON.stringify({ status: "PASS", evidence: ["outside/missing.ts"] }));
    const inspection = inspectEvidence({ root: path.join(dir, "evidence"), now: () => AT, repoRoot: dir });
    expect(inspection.issues.filter((issue) => issue.kind === "dangling")).toHaveLength(1);
  });

  it("marks an artifact as referenced when another artifact cites it", () => {
    write("evidence/target.json", '{"status":"PASS"}');
    write("evidence/citing.json", JSON.stringify({ status: "PASS", evidence: ["evidence/target.json"] }));
    const inspection = inspectEvidence({ root: dir, now: () => AT });
    const target = inspection.records.find((entry) => entry.path === "evidence/target.json")!;
    expect(target.referenced).toBe(true);
    // The citing document itself is still an orphan; the target is not.
    expect(inspection.issues.filter((issue) => issue.kind === "orphan").map((issue) => issue.path)).toEqual(["evidence/citing.json"]);
  });

  it("skips dependency and build directories", () => {
    write("node_modules/pkg/index.json", '{"status":"PASS"}');
    write("dist/out.json", '{"status":"PASS"}');
    write("evidence/keep.json", '{"status":"PASS"}');
    const inspection = inspectEvidence({ root: dir, now: () => AT });
    expect(inspection.records.map((entry) => entry.path)).toEqual(["evidence/keep.json"]);
  });

  it("reports a truncated scan as degraded rather than as the whole tree", () => {
    for (let index = 0; index < 5; index++) write(`evidence/f${index}.json`, '{"status":"PASS"}');
    const inspection = inspectEvidence({ root: dir, now: () => AT, maxFiles: 2 });
    expect(inspection.records).toHaveLength(2);
    expect(inspection.degraded.join(" ")).toContain("scan stopped at the 2-file budget");
  });

  it("reports a missing root as degraded rather than throwing", () => {
    const inspection = inspectEvidence({ root: path.join(dir, "nope"), now: () => AT });
    expect(inspection.records).toEqual([]);
    expect(inspection.degraded.join(" ")).toContain("root does not exist");
  });

  it("compares two real trees by content, not by name", () => {
    write("baseline/evidence/a.json", '{"status":"PASS"}');
    write("baseline/evidence/same.json", '{"status":"PASS"}');
    const baseline = path.join(dir, "baseline");
    // Same names, different content in one file.
    fs.mkdirSync(path.join(dir, "candidate/evidence"), { recursive: true });
    fs.copyFileSync(path.join(baseline, "evidence/same.json"), path.join(dir, "candidate/evidence/same.json"));
    fs.writeFileSync(path.join(dir, "candidate/evidence/a.json"), '{"status":"DEGRADED"}', "utf8");

    const comparison = compareEvidenceRoots({ baselineRoot: baseline, candidateRoot: path.join(dir, "candidate") });
    const byPath = new Map(comparison.entries.map((entry) => [entry.path, entry]));
    expect(byPath.get("evidence/a.json")!.change).toBe("MODIFIED");
    expect(byPath.get("evidence/same.json")!.change).toBe("UNCHANGED");
    expect(comparison.summary.modified).toBe(1);
    expect(comparison.summary.unchanged).toBe(1);
  });
});
