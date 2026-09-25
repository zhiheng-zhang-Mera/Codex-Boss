import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * P2-F — the city flatness registry, and the cross-check that makes it a gate rather than a declaration.
 *
 * THE DESIGN POINT
 *
 *   Section 20 requires ONE machine-readable state per plot from five, with per-state obligations. A registry a
 *   maintainer fills in is a registry a maintainer can fill in wrongly, and the cheapest wrong entry is FLAT. So
 *   the validator does not only check the file's internal shape: it CROSS-CHECKS the registry against the three
 *   instruments the programme runs and fails when a plot implicated by a MEASURED defect is recorded FLAT. The
 *   registry can therefore be made true only by repairing the architecture or by declaring the migration.
 *
 *   That cross-check is what the seam in these cases is for: a registry that is falsely flat cannot be built in
 *   the real repository without breaking the real tree, so the reports are injected for those cases. The CLI
 *   never injects them, and a case asserts the real invocation uses the real instruments.
 */

const PROJECT = process.cwd();
const SCRIPT = "scripts/city-flatness-validator.cjs";
const REGISTRY = "config/city-flatness.json";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require(path.join(PROJECT, SCRIPT)) as {
  validate: (root?: string, options?: { seal?: boolean; reports?: Record<string, unknown> }) => {
    schema: string;
    plots: number;
    counts: Record<string, number>;
    sealBlockingPlots: string[];
    implicated: number;
    bridges: number;
    problems: string[];
    sealProblems: string[];
    verdict: string;
  };
  implicatedPlots: (root?: string, reports?: Record<string, unknown>) => Map<string, Set<string>>;
  plotSet: (root?: string) => string[];
  readRegistry: (root?: string) => Record<string, unknown>;
  STATES: string[];
  SEAL_BLOCKING: string[];
};

const realReports = {
  inventory: require(path.join(PROJECT, "scripts", "phase2-edge-inventory.cjs")).report,
  cycles: require(path.join(PROJECT, "scripts", "phase2-cycles.cjs")).report,
  privateState: require(path.join(PROJECT, "scripts", "phase2-private-state.cjs")).measure(),
};

/** A temp root carrying only what the validator reads: two manifests and a registry. */
function fixture(overrides: { capabilities?: string[]; registry?: unknown } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "city-flatness-"));
  const capabilities = overrides.capabilities ?? ["alpha", "beta"];
  const directory = path.join(root, "config", "capabilities");
  fs.mkdirSync(directory, { recursive: true });
  for (const id of capabilities) {
    fs.writeFileSync(path.join(directory, `${id}.yaml`), `id: ${id}\nversion: 1.0.0\nkind: feature\nprovides:\n  - ${id}.thing@1\nrequires: []\noptional: []\nstate: []\nhealth:\n  critical: false\nmodules:\n  - electron/${id}.ts\nbootModules: []\nsurface: []\npermissions: []\n`, "utf8");
  }
  const registry = overrides.registry ?? defaultRegistry(capabilities);
  fs.writeFileSync(path.join(root, "config", "city-flatness.json"), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  return root;
}

function defaultRegistry(capabilities: string[]): unknown {
  return {
    schema: "city-flatness-registry/1",
    states: validator.STATES,
    seal_blocking: validator.SEAL_BLOCKING,
    stages: { "P2-B": { exitCondition: "kernel -> feature file edges = 0, measured under the ownership map", trackedBy: "config/p2b-kernel-feature-ratchet.json", decidedBy: { all: [{ key: "p2b:kernelToFeatureFileEdges", target: 0 }] } } },
    bridges: {},
    plots: Object.fromEntries(capabilities.map((id) => [id, { state: "FLAT", why: "no defect was measured on this plot by any of the four instruments" }])),
  };
}

const NO_DEFECTS = { inventory: { kernelToFeaturePairs: [] }, cycles: { mutualPairs: [] }, privateState: { confirmed: [] } };

describe("P2-F — the committed registry passes, and the SEAL correctly does not", () => {
  const report = validator.validate(PROJECT);

  it("passes, with one state per plot and every state from the declared set", () => {
    expect(report.problems, report.problems.join("; ")).toEqual([]);
    expect(report.verdict).toBe("PASS");
    const total = Object.values(report.counts).reduce((sum, count) => sum + count, 0);
    expect(total, "the state counts do not add up to the plot count").toBe(report.plots);
  });

  it("registers every capability the manifests declare, and nothing else", () => {
    // The plot set is DERIVED, so a capability added to the manifests cannot go unregistered.
    const declared = validator.plotSet(PROJECT);
    expect(report.plots).toBe(declared.length);
    expect(Object.keys((validator.readRegistry(PROJECT).plots as Record<string, unknown>) ?? {}).sort()).toEqual(declared);
  });

  it("records a non-FLAT state for EVERY plot a measured defect implicates", () => {
    const implicated = validator.implicatedPlots(PROJECT);
    expect(implicated.size, "no plot is implicated, so this case no longer tests anything").toBeGreaterThan(0);
    expect(report.implicated).toBe(implicated.size);
    const nonFlat = report.plots - report.counts.FLAT;
    expect(nonFlat, "a plot implicated by a measured defect is recorded FLAT").toBeGreaterThanOrEqual(implicated.size);
  });

  it("implicates the plots the instruments ACTUALLY name, not merely whatever the registry expects", () => {
    // WHY THIS CASE EXISTS, and what it is for. The cross-check above is necessarily CIRCULAR in one direction:
    // the registry was authored from these instruments, so an instrument that UNDER-REPORTS shrinks both sides
    // together and the check still passes. A deliberate mutation that dropped one side of every private-state
    // access was caught by only one case -- this gap. Naming the expected members closes it: the implicated set
    // must contain the plot the workbook's own historical example is about, and the three capabilities the
    // private-state measurement names.
    const implicated = validator.implicatedPlots(PROJECT);
    for (const capability of ["host-status", "persistence", "runtime", "tenx"]) {
      expect([...implicated.keys()], `the implicated set lost ${capability}`).toContain(capability);
    }
    // `host-status` is implicated ONLY by the private-state instrument, so it is the member that disappears
    // first if that half of the cross-check is weakened.
    expect([...implicated.get("host-status") ?? []]).toContain("cross-domain private-state access");
  });

  it("SEAL MODE fails, because section 20 permits only FLAT at the seal", () => {
    const sealed = validator.validate(PROJECT, { seal: true });
    expect(sealed.problems, "the registry is malformed, so the seal result is not the thing being tested").toEqual([]);
    expect(sealed.verdict, "the seal passed while plots are still migrating").toBe("SEAL_BLOCKED");
    expect(sealed.sealProblems.join(" ")).toMatch(/seal-blocking state/);
    // And the CLI agrees, so the mode is not only reachable from a test.
    const run = spawnSync(process.execPath, [SCRIPT, "--seal"], { cwd: PROJECT, encoding: "utf8", timeout: 300000 });
    expect(run.status, "the seal-mode CLI exited 0").toBe(1);
    expect(String(run.stdout)).toContain("VERDICT=SEAL_BLOCKED");
  });

  it("every migration names a declared stage, and every stage carries an exit condition", () => {
    // Section 20: "migration state requires source/target/exit". The exit is the STAGE's, because 22 plots
    // migrating in P2-B do not have 22 different exits -- and a stage without one would leave every one of them
    // without an exit.
    const registry = validator.readRegistry(PROJECT) as { stages: Record<string, { exitCondition?: string; trackedBy?: string }>; plots: Record<string, { migrations?: Array<{ stage: string }> }> };
    const used = new Set<string>();
    for (const entry of Object.values(registry.plots)) for (const migration of entry.migrations ?? []) used.add(migration.stage);
    expect(used.size, "no stage is used by any migration").toBeGreaterThan(0);
    for (const stage of used) {
      expect(registry.stages[stage], `a migration names stage ${stage}, which the registry does not declare`).toBeTruthy();
      expect(String(registry.stages[stage]?.exitCondition ?? "").length, `${stage} has no exit condition`).toBeGreaterThan(20);
      expect(String(registry.stages[stage]?.trackedBy ?? "").length, `${stage} names no instrument that tracks it`).toBeGreaterThan(5);
    }
  });

  it("declares NO bridge, and still carries the obligations of the one it retired", () => {
    const registry = validator.readRegistry(PROJECT) as { bridges: Record<string, Record<string, unknown>>; $bridges_comment?: string };
    // Ledger CC-044 retired P2A-BRIDGE-01, so the object is empty. That is a RESULT and this case pins it; the loop
    // below still runs, so a bridge reappearing here without a record and an exit condition fails.
    expect(Object.keys(registry.bridges)).toEqual([]);
    expect(report.bridges).toBe(0);
    for (const [id, bridge] of Object.entries(registry.bridges)) {
      for (const field of ["owner", "reason", "source", "target", "exitCondition", "deadline_phase", "tests", "record"]) {
        expect(String(bridge[field] ?? "").length, `bridge ${id} has no substantive ${field}`).toBeGreaterThan(10);
      }
      expect(fs.existsSync(path.join(PROJECT, String(bridge.record))), `bridge ${id} record does not exist`).toBe(true);
      expect(fs.existsSync(path.join(PROJECT, String(bridge.tests))), `bridge ${id} test file does not exist`).toBe(true);
    }
    // The obligations of the retired bridge stay on the record rather than being erased with the declaration.
    const closureDoc = fs.readFileSync(path.join(PROJECT, "docs/city/PHASE2_P2A_PROVIDER_CLOSURE.md"), "utf8");
    expect(closureDoc).toContain("P2A-BRIDGE-01");
    expect(closureDoc).toContain("NO LONGER EXISTS");
    expect(String(registry.$bridges_comment ?? "")).toContain("CC-044");
  });

  it("says out loud that FLAT is not a certification", () => {
    const registry = validator.readRegistry(PROJECT) as { $comment: string };
    expect(String(registry.$comment)).toMatch(/NOT a certification/);
  });
});

describe("P2-F — the CROSS-CHECK is the gate: a falsely flat plot fails", () => {
  it("fails when a measured defect implicates a plot the registry calls FLAT", () => {
    // The seam exists for exactly this case. `conversation` IS flat in the committed registry; implicating it in
    // an injected report must fail, and the failure must name the plot and the reason.
    const report = validator.validate(PROJECT, { reports: { inventory: { kernelToFeaturePairs: [{ pair: "persistence -> conversation", count: 1 }] }, cycles: { mutualPairs: [] }, privateState: { confirmed: [] } } });
    expect(report.verdict, "a plot recorded FLAT while a measured defect implicates it passed").toBe("FAIL");
    expect(report.problems.join(" ")).toMatch(/recorded FLAT while a measured defect implicates them: conversation \(kernel -> feature inversion\)/);
  });

  it("does NOT fail when the same report implicates a plot that is already migrating", () => {
    // The check must be specific: a report implicating `persistence` (MIGRATION_IN_PROGRESS) is consistent with
    // the registry, so it passes. A cross-check that failed on every injected report would not be checking FLAT.
    const report = validator.validate(PROJECT, { reports: { inventory: { kernelToFeaturePairs: [{ pair: "runtime -> persistence", count: 1 }] }, cycles: { mutualPairs: [] }, privateState: { confirmed: [] } } });
    expect(report.problems, report.problems.join("; ")).toEqual([]);
    expect(report.verdict).toBe("PASS");
  });

  it("the seam is faithful: injecting the REAL reports reproduces the real implicated set", () => {
    const viaSeam = validator.implicatedPlots(PROJECT, realReports);
    const real = validator.implicatedPlots(PROJECT);
    expect([...viaSeam.keys()].sort()).toEqual([...real.keys()].sort());
    expect(viaSeam.size).toBe(real.size);
  });

  it("a private-state access implicates BOTH sides, because neither is flat while it stands", () => {
    const withAccess = validator.implicatedPlots(PROJECT, {
      inventory: { kernelToFeaturePairs: [] },
      cycles: { mutualPairs: [] },
      privateState: { confirmed: [{ namespace: "tasks", declaredOwner: "persistence", accessedBy: "conversation" }] },
    });
    expect([...withAccess.keys()].sort()).toEqual(["conversation", "persistence"]);
  });
});

describe("P2-F — the registry's shape, each obligation failed on a fixture that breaks exactly it", () => {
  function withRegistry(registry: unknown, capabilities?: string[]): ReturnType<typeof validator.validate> {
    return validator.validate(fixture({ registry, ...(capabilities ? { capabilities } : {}) }), { reports: NO_DEFECTS });
  }
  const base = (): Record<string, unknown> => defaultRegistry(["alpha", "beta"]) as Record<string, unknown>;
  const plots = (registry: Record<string, unknown>): Record<string, Record<string, unknown>> => registry.plots as Record<string, Record<string, unknown>>;

  it("passes on the clean fixture, so the failures below are the fixture's doing", () => {
    const report = withRegistry(base());
    expect(report.problems, report.problems.join("; ")).toEqual([]);
    expect(report.verdict).toBe("PASS");
  });

  it("refuses a MEASUREMENT in a plot's reason, and accepts a ledger or stage reference in the same place", () => {
    // The third place this programme has found a typed measurement going stale: the matrix's prose (CC-039), this
    // registry's stage measurements (CC-041), and now the plots' reasons. The registry states WHY, in words, and the
    // instruments supply HOW MUCH.
    for (const claim of ["persistence reaches it in 3 kernel -> feature edges", "9 mutual pairs implicate it", "it holds 20 nodes"]) {
      const registry = base();
      plots(registry).alpha.why = claim;
      const report = withRegistry(registry);
      expect(report.problems.join("\n"), claim).toContain("states a MEASUREMENT");
    }
    // And the pattern is deliberately NARROW: naming a ledger entry or a stage must not trip it, or the rule would
    // forbid the very references that keep the reason traceable.
    for (const allowed of ["the BRIDGE it used to declare was retired by ledger CC-044", "stage P2-B owns this migration's exit condition"]) {
      const registry = base();
      plots(registry).alpha.why = `${allowed}, which is why the plot is not FLAT yet`;
      const report = withRegistry(registry);
      expect(report.problems.join("\n"), allowed).not.toContain("states a MEASUREMENT");
    }
  });

  it("fails when a declared capability has no state", () => {
    const registry = base();
    delete plots(registry).beta;
    expect(withRegistry(registry).problems.join(" ")).toMatch(/1 capability\(ies\) have no state: beta/);
  });

  it("fails when an entry names no declared capability", () => {
    const registry = base();
    plots(registry).ghost = { state: "FLAT", why: "a plot that does not exist, with a reason long enough to pass" };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/name no declared capability: ghost/);
  });

  it("fails when a state is not one of the five", () => {
    const registry = base();
    plots(registry).alpha = { state: "PROBABLY_FINE", why: "a state outside the declared set, with a long enough reason" };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/PROBABLY_FINE.*is not one of/);
  });

  it("fails on MIGRATION_IN_PROGRESS with no migration declared", () => {
    const registry = base();
    plots(registry).alpha = { state: "MIGRATION_IN_PROGRESS", why: "migrating, but with nothing said about what or where to" };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/MIGRATION_IN_PROGRESS with no migration declared/);
  });

  it("fails on a migration naming a stage the registry does not declare", () => {
    const registry = base();
    plots(registry).alpha = { state: "MIGRATION_IN_PROGRESS", why: "migrating under a stage nobody declared anywhere", migrations: [{ stage: "P2-Z", source: "a substantive source description", target: "a substantive target description" }] };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/names stage "P2-Z", which the registry does not declare/);
  });

  it("fails on a migration with no substantive source or target", () => {
    const registry = base();
    plots(registry).alpha = { state: "MIGRATION_IN_PROGRESS", why: "migrating with an empty source and target", migrations: [{ stage: "P2-B", source: "short", target: "short" }] };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/carries no substantive source/);
    expect(withRegistry(registry).problems.join(" ")).toMatch(/carries no substantive target/);
  });

  it("fails on PARTIALLY_DEGRADED with no declared missing element", () => {
    const registry = base();
    plots(registry).alpha = { state: "PARTIALLY_DEGRADED", why: "degraded, but the missing element is left unsaid" };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/PARTIALLY_DEGRADED without a declared missing element/);
  });

  it("fails on TEMPORARILY_BRIDGED naming no declared bridge", () => {
    const registry = base();
    plots(registry).alpha = { state: "TEMPORARILY_BRIDGED", why: "bridged, but no bridge is named or declared" };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/TEMPORARILY_BRIDGED without naming a declared bridge/);
  });

  it("fails on a bridge missing an obligation, and on an orphan bridge", () => {
    const missing = base();
    (missing.bridges as Record<string, unknown>)["B-1"] = { owner: "someone", reason: "a reason long enough to be substantive" };
    expect(withRegistry(missing).problems.join(" ")).toMatch(/bridge B-1: no substantive source/);

    const orphan = base();
    (orphan.bridges as Record<string, unknown>)["B-1"] = {
      owner: "someone with authority", reason: "a reason long enough to be substantive", source: "a substantive source", target: "a substantive target",
      exitCondition: "a substantive exit condition", deadline_phase: "a substantive deadline", tests: "tests/unit/does-not-exist.test.ts", record: "docs/does-not-exist.md",
    };
    const problems = withRegistry(orphan).problems.join(" ");
    expect(problems, "an orphan bridge was accepted").toMatch(/declared by no plot/);
    expect(problems, "a bridge whose test file does not exist was accepted").toMatch(/its test file .* does not exist/);
    expect(problems, "a bridge whose record does not exist was accepted").toMatch(/its record .* does not exist/);
  });

  it("fails on an entry that states no reason for its state", () => {
    const registry = base();
    plots(registry).alpha = { state: "FLAT", why: "short" };
    expect(withRegistry(registry).problems.join(" ")).toMatch(/alpha: the entry states no reason for its state/);
  });
});

describe("P2-F — the program's own boundaries", () => {
  it("is a plain Node program, and is read-only", () => {
    const probe = spawnSync(process.execPath, ["-e", `const m=require(${JSON.stringify(path.join(PROJECT, SCRIPT))}); if(!m.validate||!m.implicatedPlots||!m.plotSet) process.exit(1);`], { encoding: "utf8", timeout: 60000 });
    expect(probe.status, `the validator could not be loaded by plain node: ${probe.stderr}`).toBe(0);
    const source = fs.readFileSync(path.join(PROJECT, SCRIPT), "utf8");
    for (const forbidden of ["writeFileSync", "appendFileSync", "unlinkSync", "rmSync"]) {
      expect(source.includes(forbidden), `the read-only validator calls ${forbidden}`).toBe(false);
    }
  });

  it("the CLI uses the REAL instruments, never the seam", () => {
    // The seam takes injected reports, so the property that matters is that no CLI path can reach it: the report
    // the seal decision rests on must come from the tree, not from a caller's data.
    const source = fs.readFileSync(path.join(PROJECT, SCRIPT), "utf8");
    const main = source.slice(source.indexOf("function main("));
    expect(main, "the CLI passes reports into validate").not.toMatch(/reports\s*:/);
    const run = spawnSync(process.execPath, [SCRIPT, "--json"], { cwd: PROJECT, encoding: "utf8", timeout: 300000 });
    expect(run.status, `the CLI failed on the committed tree: ${run.stdout}${run.stderr}`).toBe(0);
    const parsed = JSON.parse(String(run.stdout)) as { implicated: number };
    expect(parsed.implicated, "the CLI's implicated count disagrees with the real instruments").toBe(validator.implicatedPlots(PROJECT).size);
  });

  it("the committed registry's plot set is not hand-supplied", () => {
    // A registry whose plot list is authored can omit a plot; deriving it from the manifests is what stops that.
    const root = fixture({ capabilities: ["alpha", "beta", "gamma"], registry: defaultRegistry(["alpha", "beta"]) });
    const report = validator.validate(root, { reports: NO_DEFECTS });
    expect(report.problems.join(" ")).toMatch(/1 capability\(ies\) have no state: gamma/);
  });
});
