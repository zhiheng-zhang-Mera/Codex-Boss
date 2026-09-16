import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCapabilityRegistry, ARCHITECTURE_BASELINE_PATH } from "../../../electron/platform/capability-registry";
import { gatherArchitectureEvidence, countLiteralIpcRegistrations, importSpecifiers, resolveSpecifier } from "../../../electron/platform/repo-scan";
import {
  RATCHET_DECLARATIONS,
  baselineFrom,
  evaluateRatchet,
  measureMetrics,
  type ArchitectureBaseline,
  type ArchitectureEvidence
} from "../../../electron/platform/architecture-ratchet";
import { buildDependencyGraph } from "../../../electron/platform/dependency-graph";
import { buildStateOwnershipRegistry } from "../../../electron/platform/state-ownership";
import type { CapabilityManifest } from "../../../electron/platform/capability-contract";

/**
 * Phase 01 Task D — the architecture ratchets.
 *
 * The engineering book requires each ratchet to FAIL when its invariant is broken:
 * a cycle, a duplicate state owner, a kernel importing a feature, a feature reaching
 * into another capability's implementation, an unregistered boot module, or a
 * literal IPC registration in `main.ts`. A ratchet nobody has seen fail is not a
 * ratchet, so every absolute check below is exercised against a deliberately broken
 * synthetic repository before the real one is asserted clean.
 *
 * The baseline rules are asserted too: absolute ratchets are never baselined, and no
 * test may rewrite the baseline file.
 */

const PROJECT = process.cwd();

function manifest(id: string, options: {
  provides?: string[];
  requires?: string[];
  kind?: "kernel" | "feature";
  critical?: boolean;
  modules?: string[];
  surface?: string[];
  state?: string[];
} = {}): CapabilityManifest {
  return {
    id,
    version: "1.0.0",
    kind: options.kind ?? "feature",
    provides: options.provides ?? [`${id}.thing@1`],
    requires: (options.requires ?? []).map((ref) => ({ ref, capability: { id: ref.split("@")[0], major: Number(ref.split("@")[1]) }, kind: "required" as const, reason: `${id} needs ${ref}` })),
    optional: [],
    state: (options.state ?? []).map((namespace) => ({ namespace, owner: id })),
    health: { critical: options.critical ?? false },
    modules: options.modules ?? [],
    bootModules: [],
    surface: options.surface ?? [],
    permissions: [],
    source: `${id}.yaml`
  };
}

/** Evidence built entirely in memory, so a broken repository can be described exactly. */
function evidenceFor(manifests: CapabilityManifest[], overrides: Partial<ArchitectureEvidence> = {}): ArchitectureEvidence {
  const graph = buildDependencyGraph(manifests);
  const ownership = buildStateOwnershipRegistry(manifests);
  const capabilityKinds: Record<string, "kernel" | "feature"> = {};
  const capabilitySurfaces: Record<string, string[]> = {};
  const moduleOwners: Record<string, string> = {};
  for (const entry of manifests) {
    capabilityKinds[entry.id] = entry.kind;
    capabilitySurfaces[entry.id] = [...entry.surface].sort();
    for (const module of entry.modules) moduleOwners[module] = entry.id;
  }
  return {
    graph,
    ownership,
    moduleOwners,
    capabilityKinds,
    capabilitySurfaces,
    imports: [],
    wiredBootFactories: [],
    registeredBootFactories: [],
    literalIpcRegistrations: 0,
    mainEntry: "electron/main.ts",
    ...overrides
  };
}

function failedIds(evidence: ArchitectureEvidence, baseline?: ArchitectureBaseline): string[] {
  return evaluateRatchet(evidence, baseline).results.filter((result) => !result.pass).map((result) => result.id);
}

describe("Phase 01 Task D — absolute ratchets fire when the boundary is crossed", () => {
  it("has nothing to report for a clean synthetic architecture", () => {
    const evidence = evidenceFor([manifest("alpha", { provides: ["alpha.api@1"] }), manifest("beta", { requires: ["alpha.api@1"] })]);
    expect(evaluateRatchet(evidence, undefined).pass).toBe(true);
  });

  it("fires on a required dependency cycle", () => {
    const evidence = evidenceFor([manifest("alpha", { requires: ["beta.thing@1"] }), manifest("beta", { requires: ["alpha.thing@1"] })]);
    expect(failedIds(evidence)).toContain("required-dependency-cycles");
  });

  it("does not fire on an optional cycle, which is survivable rather than fatal", () => {
    const a = manifest("alpha", { requires: ["beta.thing@1"] });
    const b = manifest("beta");
    b.optional = [{ ref: "alpha.thing@1", capability: { id: "alpha.thing", major: 1 }, kind: "optional", reason: "refinement" }];
    const evidence = evidenceFor([a, b]);
    expect(failedIds(evidence)).not.toContain("required-dependency-cycles");
    expect(evidence.graph.cycles.length, "the loop is still reported").toBe(1);
  });

  it("fires on a required dependency nothing provides", () => {
    const evidence = evidenceFor([manifest("alpha", { requires: ["ghost.thing@1"] })]);
    expect(failedIds(evidence)).toContain("unresolved-required-dependencies");
  });

  it("fires on a duplicate state owner", () => {
    const evidence = evidenceFor([manifest("alpha", { state: ["shared.state"] }), manifest("beta", { state: ["shared.state"] })]);
    expect(failedIds(evidence)).toContain("duplicate-state-owners");
  });

  it("fires when a kernel module imports a feature module", () => {
    const evidence = evidenceFor(
      [manifest("kernel.cap", { kind: "kernel", critical: true, modules: ["electron/kernel/a.ts"] }), manifest("feature.cap", { modules: ["electron/feature/b.ts"] })],
      { imports: [{ from: "electron/kernel/a.ts", to: "electron/feature/b.ts", fromCapability: "kernel.cap", toCapability: "feature.cap" }] }
    );
    expect(failedIds(evidence)).toContain("kernel-imports-feature");
  });

  it("fires when a feature imports another capability's implementation module", () => {
    const evidence = evidenceFor(
      [manifest("alpha", { modules: ["electron/alpha/a.ts"], surface: ["electron/alpha/public.ts"] }), manifest("beta", { modules: ["electron/beta/internal.ts"] })],
      { imports: [{ from: "electron/alpha/a.ts", to: "electron/beta/internal.ts", fromCapability: "alpha", toCapability: "beta" }] }
    );
    expect(failedIds(evidence)).toContain("feature-imports-undeclared-surface");
  });

  it("allows a feature to import another capability's DECLARED surface", () => {
    // This is the positive control for the rule above: without it, a check that
    // simply failed on every cross-capability import would look identical.
    const evidence = evidenceFor(
      [manifest("alpha", { modules: ["electron/alpha/a.ts"], surface: ["electron/beta/public.ts"] }), manifest("beta", { modules: ["electron/beta/public.ts", "electron/beta/internal.ts"], surface: ["electron/beta/public.ts"] })],
      { imports: [{ from: "electron/alpha/a.ts", to: "electron/beta/public.ts", fromCapability: "alpha", toCapability: "beta" }] }
    );
    expect(failedIds(evidence)).not.toContain("feature-imports-undeclared-surface");
  });

  it("fires on a wired boot module no manifest names", () => {
    const evidence = evidenceFor([manifest("alpha")], {
      wiredBootFactories: ["electron/bootstrap/persistence.ts"],
      registeredBootFactories: []
    });
    expect(failedIds(evidence)).toContain("unregistered-boot-module");
  });

  it("fires on a literal IPC registration in main.ts", () => {
    const evidence = evidenceFor([manifest("alpha")], { literalIpcRegistrations: 1 });
    expect(failedIds(evidence)).toContain("literal-ipc-registration-in-main");
  });
});

describe("Phase 01 Task D — the baseline may only ratchet, never silently widen", () => {
  it("declares absolute ratchets as unbaselineable and monotone ones as baselined", () => {
    const absolute = RATCHET_DECLARATIONS.filter((declaration) => declaration.kind === "absolute");
    const monotone = RATCHET_DECLARATIONS.filter((declaration) => declaration.kind === "monotone");
    expect(absolute.map((declaration) => declaration.id).sort()).toEqual([
      "duplicate-state-owners",
      "feature-imports-undeclared-surface",
      "kernel-imports-feature",
      "literal-ipc-registration-in-main",
      "required-dependency-cycles",
      "unregistered-boot-module",
      "unresolved-required-dependencies"
    ]);
    // An absolute ratchet with a metric would be a violation someone could baseline away.
    for (const declaration of absolute) expect(declaration.metric, `${declaration.id} must not read a baseline metric`).toBeUndefined();
    for (const declaration of monotone) expect(declaration.metric, `${declaration.id} needs a metric`).toBeTruthy();
    for (const declaration of RATCHET_DECLARATIONS) expect(declaration.remedy, `${declaration.id} has no remedy`).toBeTruthy();
  });

  it("passes a monotone ratchet with no baseline yet, describing rather than failing", () => {
    const evidence = evidenceFor([manifest("alpha")]);
    const report = evaluateRatchet(evidence, undefined);
    expect(report.exceeded).toBe(false);
    const density = report.results.find((result) => result.id === "boot-module-density");
    expect(density?.pass).toBe(true);
    expect(density?.expectation).toBe("not yet recorded");
  });

  it("fails a monotone ratchet only once the metric exceeds the recorded baseline", () => {
    const evidence = evidenceFor([manifest("alpha")], { wiredBootFactories: ["a", "b", "c"], registeredBootFactories: ["a", "b", "c"] });
    const atBaseline = baselineFrom(measureMetrics(evidence), "recorded at three", new Date().toISOString());
    expect(evaluateRatchet(evidence, atBaseline).pass).toBe(true);

    const smaller = { ...atBaseline, metrics: { ...atBaseline.metrics, bootModuleCount: 2 } };
    const report = evaluateRatchet(evidence, smaller);
    expect(report.pass).toBe(false);
    expect(report.exceeded).toBe(true);
    expect(report.absoluteFailure).toBe(false);
    expect(report.results.find((result) => result.id === "boot-module-density")?.violationKind).toBe("exceeded");
  });

  it("keeps a recorded baseline's reason and timestamp, so a bump is auditable", () => {
    const evidence = evidenceFor([manifest("alpha")]);
    const baseline = baselineFrom(measureMetrics(evidence), "phase 01 initial baseline", "2026-01-01T00:00:00.000Z");
    expect(baseline.reason).toBe("phase 01 initial baseline");
    expect(baseline.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(baseline.metrics.capabilityCount).toBe(1);
  });
});

describe("Phase 01 Task D — the real repository satisfies every ratchet", () => {
  const registry = buildCapabilityRegistry(PROJECT);
  const evidence = gatherArchitectureEvidence({ repoRoot: PROJECT, registry });
  const baselineFile = path.join(PROJECT, ...ARCHITECTURE_BASELINE_PATH.split("/"));
  const baseline: ArchitectureBaseline | undefined = fs.existsSync(baselineFile)
    ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) as ArchitectureBaseline
    : undefined;

  it("passes with zero violations", () => {
    const report = evaluateRatchet(evidence, baseline);
    const detail = report.results.filter((result) => !result.pass).map((result) => `${result.id}: ${result.observed} (expected ${result.expectation}) ${JSON.stringify(result.violations)}`).join("\n");
    expect(report.pass, detail).toBe(true);
  });

  it("keeps a required dependency cycle at zero", () => {
    expect(registry.graph.fatalCycles).toEqual([]);
    expect(registry.graph.bootable).toBe(true);
  });

  it("keeps duplicate state owners at zero", () => {
    expect(registry.ownership.conflicts).toEqual([]);
  });

  it("keeps main.ts free of literal IPC registrations", () => {
    const main = fs.readFileSync(path.join(PROJECT, "electron", "main.ts"), "utf8");
    expect(countLiteralIpcRegistrations(main)).toBe(0);
    // The positive control: the same counter must find a registration when one exists.
    expect(countLiteralIpcRegistrations('ipcMain.handle("boss:example", () => {});')).toBe(1);
  });

  it("registers every wired boot module in exactly one manifest", () => {
    expect(evidence.wiredBootFactories.length).toBe(24);
    expect(evidence.wiredBootFactories).toEqual(evidence.registeredBootFactories);
    expect(evidence.moduleOwnershipConflicts).toEqual([]);
  });

  it("imports across capabilities only through a declared surface", () => {
    const undeclared = evidence.imports
      .filter((edge) => edge.fromCapability !== edge.toCapability)
      .filter((edge) => !(evidence.capabilitySurfaces[edge.toCapability] ?? []).includes(edge.to));
    expect(undeclared).toEqual([]);
  });

  it("does not allow a test to rewrite the baseline (the update is a separate command)", () => {
    // The rule is that only the explicit baseline command writes this file. If the
    // ratchet itself had update behaviour, running the suite would mutate a tracked
    // file, which is the "test rewrites its own fixture" failure mode the book names.
    const before = fs.existsSync(baselineFile) ? fs.readFileSync(baselineFile, "utf8") : "";
    evaluateRatchet(evidence, baseline);
    measureMetrics(evidence);
    const after = fs.existsSync(baselineFile) ? fs.readFileSync(baselineFile, "utf8") : "";
    expect(after).toBe(before);
    // And the update path is a declared package script, not a test side effect.
    const scripts = JSON.parse(fs.readFileSync(path.join(PROJECT, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["architecture:baseline:update"], "no explicit baseline update command is declared").toBeTruthy();
  });
});

describe("Phase 01 Task D — the import scanner reads real sources", () => {
  it("finds static, side-effect, require and dynamic imports", () => {
    const text = [
      'import { a } from "./a";',
      'import type { B } from "./b";',
      'import "./side-effect";',
      'const c = require("./c");',
      'const d = await import("./d");'
    ].join("\n");
    expect(importSpecifiers(text)).toEqual(["./a", "./b", "./side-effect", "./c", "./d"]);
  });

  it("resolves a relative specifier to a real module, and refuses a bare package", () => {
    expect(resolveSpecifier("./boot-module", "electron/bootstrap/runtime.ts", PROJECT)).toBe("electron/bootstrap/boot-module.ts");
    expect(resolveSpecifier("../platform/capability-contract", "electron/bootstrap/runtime.ts", PROJECT)).toBe("electron/platform/capability-contract.ts");
    // A package import is an external dependency, never a capability coupling.
    expect(resolveSpecifier("electron", "electron/main.ts", PROJECT)).toBeUndefined();
    expect(resolveSpecifier("./does-not-exist", "electron/main.ts", PROJECT)).toBeUndefined();
  });
});
