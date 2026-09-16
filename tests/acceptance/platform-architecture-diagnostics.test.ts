import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHITECTURE_BASELINE_PATH, ARCHITECTURE_SNAPSHOT_PATH } from "../../electron/platform/capability-registry";

/**
 * Phase 01 Task E — the read-only diagnostics.
 *
 * The engineering book asks for three commands an Agent can read:
 *
 *   pnpm run architecture:graph
 *   pnpm run architecture:impact -- knowledge.core
 *   pnpm run architecture:ownership
 *
 * "An Agent can read" is the requirement, so it is checked as one: every command is
 * exercised as a real process, its stdout is parsed as JSON rather than eyeballed,
 * and its exit code is asserted. A diagnostic whose output is prose, or whose exit
 * code is meaningless, is one an Agent has to guess at.
 *
 * This suite is an INTEGRATION suite by the repository's own definition in
 * `vitest.tiers.mjs` — it imports `node:child_process` and starts a real process —
 * which is why it lives under `tests/acceptance/` rather than `tests/unit/`.
 * `tests/unit/test-layers.test.ts` computes that classification from this import.
 */

const PROJECT = process.cwd();
const CLI = path.join(PROJECT, "scripts", "architecture.cjs");

function run(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { stdout, status: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; status?: number };
    return { stdout: failure.stdout ?? "", status: failure.status ?? 1 };
  }
}

function runJson(args: string[]): { body: any; status: number } {
  const { stdout, status } = run(args);
  return { body: JSON.parse(stdout), status };
}

describe("Phase 01 Task E — the diagnostics are readable by an Agent", () => {
  it("architecture:graph reports the graph as JSON and passes on a healthy repository", () => {
    const { body, status } = runJson(["graph"]);
    expect(status).toBe(0);
    expect(body.capabilities).toBeGreaterThanOrEqual(24);
    expect(body.edges).toBeGreaterThan(0);
    expect(Array.isArray(body.kernel)).toBe(true);
    expect(Array.isArray(body.features)).toBe(true);
    expect(body.kernel.length + body.features.length).toBe(body.capabilities);
    // The interesting claim, asserted rather than summarised in prose.
    expect(body.cycles).toEqual([]);
    expect(body.bootable).toBe(true);
    expect(body.bootOrder.length).toBe(body.capabilities);
    expect(body.edges_detail.every((line: string) => / -> .+ \(.+, (required|optional)\)$/.test(line))).toBe(true);
  });

  it("architecture:ownership reports one owner per namespace and passes", () => {
    const { body, status } = runJson(["ownership"]);
    expect(status).toBe(0);
    expect(body.conflicts).toEqual([]);
    expect(body.namespaces).toBe(Object.keys(body.ownerOf).length);
    for (const [namespace, owner] of Object.entries(body.ownerOf)) {
      expect(Array.isArray(body.ownedBy[owner as string]), `${namespace} owner has no index entry`).toBe(true);
      expect(body.ownedBy[owner as string]).toContain(namespace);
    }
  });

  it("architecture:impact explains the radius, and resolves a provided contract as a selector", () => {
    const byId = runJson(["impact", "persistence"]);
    expect(byId.status).toBe(0);
    expect(byId.body.capability).toBe("persistence");
    expect(byId.body.impactRadius).toContain("knowledge");
    expect(byId.body.impactRadius).toContain("research");
    // The explanation names the changed capability last, so the rendering reads
    // left-to-right as "changed -> dependent".
    const knowledge = byId.body.explains.find((entry: any) => entry.capability === "knowledge");
    expect(knowledge.via[knowledge.via.length - 1]).toBe("persistence");
    expect(knowledge.required).toBe(true);

    // Selecting by the contract it provides is the same question.
    const byContract = runJson(["impact", "persistence.store@1"]);
    expect(byContract.body.capability).toBe("persistence");
    expect(byContract.body.impactRadius).toEqual(byId.body.impactRadius);
  });

  it("architecture:impact refuses an unknown selector with a diagnostic, not a stack trace", () => {
    const { body, status } = runJson(["impact", "no.such.capability"]);
    expect(status).toBe(2);
    expect(body.error).toContain("unknown capability");
    expect(Array.isArray(body.known)).toBe(true);
  });

  it("architecture:ratchet passes and reports its metrics alongside the baseline", () => {
    const { body, status } = runJson(["ratchet"]);
    expect(status).toBe(0);
    expect(body.pass).toBe(true);
    expect(body.violations).toEqual([]);
    // 24 at Phase 01; Phase 02 added the state-core boot module and recorded the increase
    // through the explicit baseline command.
    expect(body.metrics.bootModuleCount).toBe(25);
    expect(body.baseline.reason).toBeTruthy();
  });

  it("exits non-zero on an unusable invocation, so CI can gate on the exit code", () => {
    // The positive control for the exit code: without it, a CLI that always exited 0
    // would satisfy every assertion above. A ratchet violation itself is covered by
    // the unit suite driving `evaluateRatchet` against a deliberately broken graph,
    // which is the only way to reach that branch without editing the real repository.
    expect(run(["not-a-command"]).status).toBe(2);
  });

  it("names every command in package.json, so the scripts exist where they are documented", () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(PROJECT, "package.json"), "utf8")).scripts as Record<string, string>;
    for (const [name, expected] of Object.entries({
      "architecture:graph": "graph",
      "architecture:impact": "impact",
      "architecture:ownership": "ownership",
      "architecture:ratchet": "ratchet",
      "architecture:snapshot": "snapshot"
    })) {
      expect(scripts[name], `${name} is not declared`).toBeTruthy();
      expect(scripts[name]).toContain(`architecture.cjs ${expected}`);
    }
    expect(scripts["architecture:baseline:update"]).toContain("architecture-baseline.cjs");
    expect(scripts["architecture:manifests:generate"]).toContain("generate-capability-manifests.cjs");
  });
});

describe("Phase 01 Task E — the CLI cannot silently disagree with the test tier", () => {
  it("loads exactly the manifests the registry loads", async () => {
    // The CLI re-derives the graph without importing TypeScript (it runs under plain
    // Node), so the two implementations could drift. This is the guard: the CLI's
    // counts must equal the registry's, so a drift fails here rather than showing up
    // as a snapshot that disagrees with the tests.
    const { body } = runJson(["graph"]);
    const { buildCapabilityRegistry } = await import("../../electron/platform/capability-registry");
    const registry = buildCapabilityRegistry(PROJECT);
    expect(body.capabilities).toBe(registry.manifests.length);
    expect(body.edges).toBe(registry.graph.edges.length);
    expect([...body.kernel, ...body.features].sort()).toEqual(registry.manifests.map((manifest) => manifest.id).sort());
    expect(body.bootOrder).toEqual(registry.graph.bootOrder);
  });

  it("reads the same baseline file the ratchet tests read", () => {
    const baselineFile = path.join(PROJECT, ...ARCHITECTURE_BASELINE_PATH.split("/"));
    expect(fs.existsSync(baselineFile)).toBe(true);
    const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    const { body } = runJson(["ratchet"]);
    expect(body.baseline.metrics).toEqual(baseline.metrics);
  });
});

describe("Phase 01 — the phase artifact", () => {
  it("exists, is valid JSON, and records what the acceptance gate asks for", () => {
    // Gate 7: manifest count, edge count, kernel/feature lists, state ownership and
    // the ratchet baseline. Each is read out of the file rather than trusted.
    const file = path.join(PROJECT, ...ARCHITECTURE_SNAPSHOT_PATH.split("/"));
    expect(fs.existsSync(file), `the phase artifact is missing: ${ARCHITECTURE_SNAPSHOT_PATH}`).toBe(true);
    const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));

    expect(snapshot.capabilities.count).toBeGreaterThanOrEqual(24);
    expect(snapshot.capabilities.kernel.length).toBeGreaterThan(0);
    expect(snapshot.capabilities.features.length).toBeGreaterThan(0);
    expect(snapshot.capabilities.kernel.length + snapshot.capabilities.features.length).toBe(snapshot.capabilities.count);
    expect(snapshot.capabilities.manifests.length).toBe(snapshot.capabilities.count);
    expect(snapshot.capabilities.critical.length).toBeGreaterThan(0);

    expect(snapshot.dependencyGraph.requiredCycleCount).toBe(0);
    expect(snapshot.dependencyGraph.bootable).toBe(true);
    expect(snapshot.dependencyGraph.edgeCount).toBeGreaterThan(0);
    expect(snapshot.dependencyGraph.requiredEdges + snapshot.dependencyGraph.optionalEdges).toBe(snapshot.dependencyGraph.edgeCount);
    expect(snapshot.dependencyGraph.edges.length).toBe(snapshot.dependencyGraph.edgeCount);

    expect(snapshot.stateOwnership.duplicateOwnerCount).toBe(0);
    expect(snapshot.stateOwnership.namespaces).toBeGreaterThanOrEqual(25);
    expect(snapshot.stateOwnership.conflicts).toEqual([]);

    expect(snapshot.bootModules.wiredCount).toBe(25);
    expect(snapshot.bootModules.unregistered).toEqual([]);
    expect(snapshot.bootModules.registeredNotWired).toEqual([]);

    expect(snapshot.ratchet.literalIpcRegistrationsInMain).toBe(0);
    expect(snapshot.ratchet.moduleOwnershipConflicts).toEqual([]);
    expect(snapshot.ratchet.baseline.reason).toBeTruthy();
    expect(snapshot.ratchet.metrics.bootModuleCount).toBe(25);
  });

  it("is regenerated identically from the same sources", () => {
    // The snapshot is derived data, not a hand-maintained document: running the
    // command twice must produce the same content apart from the timestamp.
    const file = path.join(PROJECT, ...ARCHITECTURE_SNAPSHOT_PATH.split("/"));
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    execFileSync(process.execPath, [CLI, "snapshot"], {
      cwd: PROJECT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BOSS_BASELINE_SHA: String(before.baselineCommit ?? "") }
    });
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect({ ...after, generatedAt: null }).toEqual({ ...before, generatedAt: null });
  });
});
