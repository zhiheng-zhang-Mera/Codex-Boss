import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { candidateCompatibilityVerdicts, decideABPromotion, validateSelfModCandidate } from "../src/shared/self-modification";
import { SelfModificationSandbox, type SelfModOps } from "../electron/self-engineering/self-mod-sandbox";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-selfmod-")); dirs.push(dir); return dir; }

function ops(overrides: Partial<SelfModOps> = {}): SelfModOps {
  return {
    async createCandidateBranch() { return { branch: "boss-candidate/test", baseCommit: "abc123" }; },
    async applyModification() { return { headCommit: "def456" }; },
    async runTargetedTests() { return { passed: 5, failed: 0, total: 5 }; },
    async replayHistorical() { return { baselineRate: null, candidateRate: 1, goldens: ["g1", "g2"] }; },
    async productionBaseline() { return 0.9; },
    async promote() {},
    async discard() {},
    ...overrides
  };
}

describe("A/B promotion decision (pure)", () => {
  it("discards red candidates regardless of replay evidence", () => {
    const ab = decideABPromotion({ baselineRate: 0.9, candidateRate: 0.95, tests: { passed: 4, failed: 1, total: 5 } });
    expect(ab.verdict).toBe("DISCARD");
    expect(ab.reasons[0]).toContain("targeted tests failed");
  });

  it("promotes a clearly better candidate and blocks a regression beyond tolerance", () => {
    expect(decideABPromotion({ baselineRate: 0.8, candidateRate: 0.9, tests: { passed: 5, failed: 0, total: 5 } }).verdict).toBe("PROMOTE");
    const regression = decideABPromotion({ baselineRate: 0.9, candidateRate: 0.6, tests: { passed: 5, failed: 0, total: 5 } });
    expect(regression.verdict).toBe("HUMAN");
    expect(regression.reasons.join(" ")).toContain("below baseline");
  });

  it("promotes within tolerance and requires human when no evidence exists", () => {
    expect(decideABPromotion({ baselineRate: 0.9, candidateRate: 0.89, tests: { passed: 5, failed: 0, total: 5 } }).verdict).toBe("PROMOTE");
    expect(decideABPromotion({ baselineRate: null, candidateRate: null, requireBaseline: true, tests: { passed: 5, failed: 0, total: 5 } }).verdict).toBe("HUMAN");
    expect(decideABPromotion({ baselineRate: null, candidateRate: null, tests: { passed: 5, failed: 0, total: 5 } }).verdict).toBe("PROMOTE");
  });
});

describe("candidate compatibility verdicts (pure)", () => {
  it("flags adapters whose supported window excludes the candidate core version", () => {
    const verdicts = candidateCompatibilityVerdicts({
      candidateVersions: { core_api: "2" },
      adapters: [{ id: "web:chatgpt", kind: "web", windows: { core_api: { min: "1", max: "1" } } }]
    });
    expect(verdicts.some((verdict) => !verdict.ok && verdict.axis === "core_api")).toBe(true);
  });

  it("flags candidate downgrades of a core axis", () => {
    const verdicts = candidateCompatibilityVerdicts({ candidateVersions: { core_api: "0.5" }, adapters: [] });
    expect(verdicts.some((verdict) => !verdict.ok && verdict.reason.includes("downgrades"))).toBe(true);
  });

  it("verifies workspace schema compatibility against the oldest production workspace", () => {
    const ok = candidateCompatibilityVerdicts({ candidateWorkspaceSchema: "1", workspaces: [{ id: "w1", version: "2" }], minWorkspaceSchema: "1", adapters: [] });
    expect(ok.filter((verdict) => verdict.axis === "workspace_schema").every((verdict) => verdict.ok)).toBe(true);
    const bad = candidateCompatibilityVerdicts({ candidateWorkspaceSchema: "3", workspaces: [{ id: "w1", version: "1" }], minWorkspaceSchema: "1", adapters: [] });
    expect(bad.filter((verdict) => verdict.axis === "workspace_schema")).toHaveLength(1);
    expect(bad.filter((verdict) => verdict.axis === "workspace_schema")[0].ok).toBe(false);
  });

  it("validates candidates fail closed", () => {
    const valid = { id: "c1", goal: "improve routing", baseCommit: "abc", branch: "boss-candidate/c1", status: "CANDIDATE" as const, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() };
    expect(() => validateSelfModCandidate(valid)).not.toThrow();
    expect(() => validateSelfModCandidate({ ...valid, id: "../bad" })).toThrow();
    expect(() => validateSelfModCandidate({ ...valid, status: "MIDWAY" as never })).toThrow();
  });
});

describe("SelfModificationSandbox Dual BOSS flow", () => {
  it("walks candidate → modify → test → replay → evaluate(PROMOTED w/ token) → conclude(promote)", async () => {
    const file = path.join(root(), "sandbox.json");
    const promoted: string[] = [];
    const sandbox = new SelfModificationSandbox(file, ops({ async promote(input) { promoted.push(input.branch); } }), "workspace:default");
    const candidate = await sandbox.begin({ goal: "improve routing", id: "c1" });
    expect(candidate.status).toBe("CANDIDATE");
    expect((await sandbox.modify("c1")).headCommit).toBe("def456");
    expect((await sandbox.test("c1")).tests).toEqual({ passed: 5, failed: 0, total: 5 });
    const replayed = await sandbox.replay("c1");
    expect(replayed.replay?.candidateRate).toBe(1);
    const evaluated = await sandbox.evaluate("c1", { guardToken: true });
    expect(evaluated.status).toBe("PROMOTED");
    expect(evaluated.ab?.verdict).toBe("PROMOTE");
    const concluded = await sandbox.conclude("c1");
    expect(concluded.status).toBe("PROMOTED");
    expect(promoted).toEqual(["boss-candidate/test"]);
    // Durability: a new sandbox on the same file sees the promoted candidate.
    expect(new SelfModificationSandbox(file, ops()).get("c1")?.status).toBe("PROMOTED");
  });

  it("refuses auto-promotion without a Guardian token and discards on conclude", async () => {
    const file = path.join(root(), "sandbox.json");
    const discarded: string[] = [];
    const sandbox = new SelfModificationSandbox(file, ops({ async discard(input) { discarded.push(input.branch); } }), "workspace:default");
    await sandbox.begin({ goal: "improve routing", id: "c1" });
    await sandbox.modify("c1"); await sandbox.test("c1"); await sandbox.replay("c1");
    const evaluated = await sandbox.evaluate("c1", { guardToken: false });
    expect(evaluated.status).toBe("FAILED");
    expect(evaluated.error).toContain("Guardian denial");
    await sandbox.conclude("c1");
    expect(discarded).toEqual(["boss-candidate/test"]);
  });

  it("discards incompatible candidates and red-test failures, and rolls back with a token", async () => {
    const file = path.join(root(), "sandbox.json");
    const discarded: string[] = [];
    const sandbox = new SelfModificationSandbox(file, ops({
      async discard(input) { discarded.push(input.branch); },
      async runTargetedTests() { return { passed: 0, failed: 2, total: 2 }; }
    }), "workspace:default");
    await sandbox.begin({ goal: "risky change", id: "c1" });
    await sandbox.modify("c1");
    const failed = await sandbox.test("c1");
    expect(failed.status).toBe("FAILED");
    await sandbox.conclude("c1");
    expect(discarded).toEqual(["boss-candidate/test"]);
    await expect(sandbox.rollback("c1", false)).rejects.toThrow(/Guardian denial/);
  });

  it("keeps HUMAN decisions durable and pending rather than auto-promoting", async () => {
    const file = path.join(root(), "sandbox.json");
    const sandbox = new SelfModificationSandbox(file, ops({
      async productionBaseline() { return 0.9; },
      async replayHistorical() { return { baselineRate: 0.9, candidateRate: 0.5, goldens: ["g1"] }; }
    }), "workspace:default");
    await sandbox.begin({ goal: "regression candidate", id: "c1" });
    await sandbox.modify("c1"); await sandbox.test("c1"); await sandbox.replay("c1");
    const pending = await sandbox.evaluate("c1", { guardToken: true });
    expect(pending.status).toBe("AB_EVALUATING");
    expect(pending.error).toContain("HUMAN");
    await expect(sandbox.conclude("c1")).rejects.toThrow(/awaits a final decision/);
  });

  it("fails closed on corrupt sandbox state", () => {
    const file = path.join(root(), "sandbox.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 9, candidates: [] }));
    expect(() => new SelfModificationSandbox(file, ops())).toThrow();
  });
});
