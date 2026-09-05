import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvidenceGraph, type PrimaryRunRecord } from "../electron/research/evidence/evidence-graph";
import { analyzeRecordedRuns } from "../electron/research/evidence/run-analysis";
import { buildReproducibilityAudit } from "../electron/research/evidence/repro-audit";
import { assembleManuscript, type ManuscriptOptions } from "../electron/research/manuscript/manuscript-assembler";
import type { ManuscriptPlan } from "../src/shared/research-manuscript";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-repro-")); dirs.push(dir); return dir; }

function runRecord(seed: number, accuracy: number, protocolHash = "frozen-abc"): PrimaryRunRecord {
  return { runId: `run-${seed}`, experimentId: "exp-acc", protocolHash, gitCommit: "c", gitDirty: false, command: ["node", "bench.mjs"], environmentFingerprint: "env", dependencyLockHash: "lock", seed, inputHashes: [], outputHash: "o", stdoutStderrHash: "s", metrics: { accuracy }, durationMs: 10, hardware: "ci", timestamp: new Date(seed).toISOString() };
}

const votes = [{ reviewerId: "r1", claimId: "claim:acc", stance: "supports" as const }];

describe("reproducibility audit (Phase 10→11)", () => {
  it("marks REPRODUCED only with evidence + independent replication", () => {
    const graph = new EvidenceGraph(root());
    graph.addRun("r1", runRecord(1, 9));
    graph.addRun("r1", runRecord(2, 11));
    const analysis = analyzeRecordedRuns(graph, "r1", { claimId: "claim:acc", metric: "accuracy", protocolHash: "frozen-abc", votes, requiredVotes: 1 });
    const audit = buildReproducibilityAudit(analysis, new Date(0).toISOString());
    expect(audit.status).toBe("REPRODUCED");
    expect(audit.distinctSeeds).toBe(2);
    expect(audit.runsAnalyzed).toBe(2);
    expect(audit.protocolHash).toBe("frozen-abc");
    expect(audit.ci).not.toBeNull();
  });

  it("never marks REPRODUCED without replication or evidence", () => {
    const dir = root();
    const single = new EvidenceGraph(dir);
    single.addRun("r1", runRecord(1, 9));
    const oneRun = buildReproducibilityAudit(analyzeRecordedRuns(single, "r1", { claimId: "claim:acc", metric: "accuracy", protocolHash: "frozen-abc", votes, requiredVotes: 1 }), new Date(0).toISOString());
    expect(oneRun.status).toBe("NOT_REPRODUCED");
    expect(oneRun.reason).toContain("independent replication");

    const contradictory = new EvidenceGraph(dir);
    contradictory.addRun("r1", runRecord(1, 9));
    contradictory.addRun("r1", runRecord(2, 11));
    // Votes oppose → claim not adopted even with two seeds → NOT_REPRODUCED.
    const opposed = buildReproducibilityAudit(analyzeRecordedRuns(contradictory, "r1", {
      claimId: "claim:acc", metric: "accuracy", protocolHash: "frozen-abc",
      votes: [{ reviewerId: "r1", claimId: "claim:acc", stance: "opposes" }], requiredVotes: 1
    }), new Date(0).toISOString());
    expect(opposed.status).toBe("NOT_REPRODUCED");
  });
});

describe("manuscript audit integration", () => {
  const plan: ManuscriptPlan = { id: "r1", claimsToSections: { "claim:acc": ["results"] } };
  const claims = [{ id: "claim:acc", evidenceIds: ["stat:claim:acc"] }];
  const writer = { async write(brief: { section: string; evidenceIds: string[] }) { return `results draft for ${brief.evidenceIds.join(",")}`; } };

  it("writes the real reproducibility audit into audit/reproducibility.json when supplied", async () => {
    const dir = root();
    const graph = new EvidenceGraph(path.join(dir, ".evidence"));
    graph.addRun("r1", runRecord(1, 9));
    graph.addRun("r1", runRecord(2, 11));
    const analysis = analyzeRecordedRuns(graph, "r1", { claimId: "claim:acc", metric: "accuracy", protocolHash: "frozen-abc", votes, requiredVotes: 1 });
    const audit = buildReproducibilityAudit(analysis, new Date(0).toISOString());
    const options: ManuscriptOptions = { title: "T", plan, claims, evidenceIds: ["stat:claim:acc"], writer, reproducibility: audit };
    const output = await assembleManuscript(path.join(dir, "research"), options);
    const written = JSON.parse(fs.readFileSync(output.audit.reproducibilityFile, "utf8"));
    expect(written.status).toBe("REPRODUCED");
    expect(written.runsAnalyzed).toBe(2);
    const final = JSON.parse(fs.readFileSync(output.audit.finalAuditFile, "utf8"));
    expect(final.reproducibility).toBe("REPRODUCED");
    expect(fs.existsSync(output.audit.finalAuditFile)).toBe(true);
  });

  it("still writes a PENDING reproducibility stub when none is supplied (backward compatible)", async () => {
    const dir = root();
    const options: ManuscriptOptions = { title: "T", plan, claims, evidenceIds: ["stat:claim:acc"], writer };
    const output = await assembleManuscript(path.join(dir, "research"), options);
    const written = JSON.parse(fs.readFileSync(output.audit.reproducibilityFile, "utf8"));
    expect(written.status).toBe("PENDING");
    expect(written.reason).toBe("not audited");
  });
});
