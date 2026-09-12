/**
 * checkpoint-1 §6 — dependency graph, impact analysis and capability discovery.
 *
 * The rules under test are the ones the plan states: the graph must expose
 * imports → downstream → tests → runtime entry, impact analysis must be derived
 * from the graph (not guessed), and capability discovery must distinguish
 * "exists" from "declared but unwired" so a planner never silently re-implements
 * something the repository already ships.
 */
import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  capabilityTerms,
  impactOf,
  packageNameOf,
  probeCapability,
  summarizeWorldModel,
  worldModelIdFor,
  type ModuleNode,
  type RepoWorldModel
} from "../../src/shared/repo-world-model";

function module(path: string, overrides: Partial<ModuleNode> = {}): ModuleNode {
  return {
    path,
    kind: overrides.kind ?? (path.includes(".test.") ? "TEST" : "SOURCE"),
    language: "TypeScript",
    bytes: 100,
    exports: overrides.exports ?? [],
    imports: overrides.imports ?? [],
    test_files: overrides.test_files ?? [],
    is_entry: overrides.is_entry ?? false,
    ...overrides
  };
}

function modelWith(modules: ModuleNode[], overrides: Partial<RepoWorldModel> = {}): RepoWorldModel {
  return {
    schemaVersion: 1,
    version: "repo-world-model-1",
    id: "wm-test",
    generated_at: "2026-01-01T00:00:00.000Z",
    fingerprint: "f".repeat(64),
    root: "/repo",
    package_managers: ["pnpm"],
    build_system: [{ tool: "tsc", evidence: ["tsconfig.json"] }],
    runtimes: ["node"],
    ci: [{ provider: "github-actions", files: [".github/workflows/ci.yml"] }],
    languages: [{ language: "TypeScript", files: 10 }],
    entry_points: ["electron/main.ts"],
    modules,
    tests: [],
    tests_by_directory: {},
    git: { is_repository: true, head: "abc", branch: "main", dirty_files: 0 },
    generated_surfaces: [],
    ignore_files: [".gitignore"],
    workspace: { kind: "SINGLE", packages: [{ path: "." }], evidence: ["single package root: no workspace marker found"] },
    truncated: false,
    ...overrides
  };
}

const GRAPH_FIXTURE: ModuleNode[] = [
  module("electron/main.ts", { is_entry: true, imports: [{ specifier: "./commander/plan", resolved: "electron/commander/plan.ts", external: false }], exports: ["bootstrap"] }),
  module("electron/commander/plan.ts", { imports: [{ specifier: "../store", resolved: "electron/store.ts", external: false }, { specifier: "node:fs", external: false, builtin: true }, { specifier: "yaml", external: true }], exports: ["compilePlan"] }),
  module("electron/store.ts", { imports: [], exports: ["StateStore"] }),
  module("tests/unit/plan.test.ts", { test_files: ["tests/unit/plan.test.ts"] }),
  module("tests/unit/commander/plan.test.ts", { test_files: ["tests/unit/commander/plan.test.ts"] })
];

describe("§6.2 dependency graph", () => {
  const model = modelWith(GRAPH_FIXTURE, { tests_by_directory: { "tests/unit/commander": ["tests/unit/commander/plan.test.ts"] } });
  const graph = buildDependencyGraph(model);

  it("records relative edges, reverse edges and external packages", () => {
    expect(graph.edges).toContainEqual({ from: "electron/main.ts", to: "electron/commander/plan.ts", kind: "relative" });
    expect(graph.reverse["electron/commander/plan.ts"]).toEqual(["electron/main.ts"]);
    expect(graph.external.map((entry) => entry.specifier)).toEqual(["yaml"]);
    expect(graph.external[0].importers).toEqual(["electron/commander/plan.ts"]);
  });

  it("keeps platform builtins visible but out of the dependency list", () => {
    const plan = model.modules.find((entry) => entry.path === "electron/commander/plan.ts")!;
    expect(plan.imports.find((entry) => entry.specifier === "node:fs")?.builtin).toBe(true);
    expect(graph.external.some((entry) => entry.specifier.includes("fs"))).toBe(false);
  });

  it("derives runtime entries by walking imports backwards from each entry point", () => {
    expect(graph.entries_by_module["electron/store.ts"]).toEqual(["electron/main.ts"]);
    expect(graph.entries_by_module["electron/main.ts"]).toEqual(["electron/main.ts"]);
    expect(graph.entries_by_module["tests/unit/plan.test.ts"]).toBeUndefined();
  });

  it("maps modules to their co-located tests", () => {
    expect(graph.tests_by_module["electron/commander/plan.ts"]).toBeUndefined();
    expect(graph.tests_by_module["tests/unit/commander/plan.test.ts"]).toEqual(["tests/unit/commander/plan.test.ts"]);
  });

  it("derives the bare package name of a scoped specifier", () => {
    expect(packageNameOf("@scope/pkg/deep/path")).toBe("@scope/pkg");
    expect(packageNameOf("yaml")).toBe("yaml");
  });
});

describe("§6.2 impact analysis", () => {
  const graph = buildDependencyGraph(modelWith(GRAPH_FIXTURE, { tests_by_directory: { "tests/unit/commander": ["tests/unit/commander/plan.test.ts"] } }));

  it("follows imports upwards and reports the affected tests, entries and packages", () => {
    const report = impactOf(graph, ["electron/store.ts"]);
    expect(report.affected_modules).toEqual(["electron/commander/plan.ts", "electron/main.ts", "electron/store.ts"]);
    expect(report.runtime_entries).toEqual(["electron/main.ts"]);
    expect(report.external_dependencies).toEqual(["yaml"]);
    expect(report.untested).toContain("electron/store.ts");
    expect(report.reasons.length).toBeGreaterThan(0);
  });

  it("ignores paths that are not modules of this repository instead of widening the scope", () => {
    const report = impactOf(graph, ["README.md", "electron/store.ts"]);
    expect(report.changed).toEqual(["electron/store.ts"]);
    expect(report.reasons.join(" ")).toContain("not modules of this repository");
  });

  it("returns an empty, honest report when nothing is known", () => {
    const report = impactOf(graph, []);
    expect(report.affected_modules).toEqual([]);
    expect(report.tests).toEqual([]);
    expect(report.runtime_entries).toEqual([]);
  });
});

describe("§6.3 existing capability discovery", () => {
  const modules: ModuleNode[] = [
    module("src/theme/theme-registry.ts", { exports: ["ThemeRegistry", "registerTheme"] }),
    module("src/theme/manifest-schema.ts", { exports: [] }),
    module("src/cache/cache-store.ts", { exports: ["CacheStore"] }),
    module("src/main.ts", { is_entry: true, exports: ["main"], imports: [{ specifier: "./theme/theme-registry", resolved: "src/theme/theme-registry.ts", external: false }] })
  ];
  const model = modelWith(modules);
  const graph = buildDependencyGraph(model);

  it("derives deterministic terms from a capability description", () => {
    const terms = capabilityTerms({ capability: "theme registry", description: "locked built-in themes" });
    expect(terms).toContain("theme");
    expect(terms).toContain("registry");
    expect(terms).toContain("themes");
    expect(terms).not.toContain("the");
  });

  it("reports EXISTS for an implemented and reachable capability", () => {
    const result = probeCapability(model, graph, { capability: "theme registry", terms: ["theme-registry"] });
    expect(result.verdict).toBe("EXISTS");
    expect(result.evidence.some((entry) => entry.pointer.includes("theme-registry.ts"))).toBe(true);
    expect(result.recommendation).toContain("theme-registry.ts");
  });

  it("reports PARTIAL for an implementation nothing imports (dead code)", () => {
    const result = probeCapability(model, graph, { capability: "cache store", terms: ["cache-store"] });
    expect(result.verdict).toBe("PARTIAL");
    expect(result.unwired).toBe(true);
    expect(result.recommendation).toContain("wire it into a real caller");
  });

  it("reports RESERVED when only declarations match", () => {
    const result = probeCapability(model, graph, { capability: "manifest schema", terms: ["manifest-schema"] });
    expect(result.verdict).toBe("RESERVED");
    expect(result.recommendation).toContain("interface");
  });

  it("reports MISSING for a capability the repository does not have", () => {
    const result = probeCapability(model, graph, { capability: "sandbox broker", terms: ["sandbox-broker"] });
    expect(result.verdict).toBe("MISSING");
    expect(result.evidence[0].kind).toBe("absent");
  });

  it("downgrades to PARTIAL when a required path is absent", () => {
    const result = probeCapability(model, graph, { capability: "theme registry", terms: ["theme-registry"], requiresPaths: ["src/theme/theme-manager.ts"] });
    expect(result.verdict).toBe("PARTIAL");
    expect(result.evidence.some((entry) => entry.kind === "absent")).toBe(true);
  });
});

describe("§6.1 model identity and summary", () => {
  it("derives a content-addressed model id", () => {
    const first = worldModelIdFor({ fingerprint: "a".repeat(64), modules: 10, generatedAt: "2026-01-01T00:00:00.000Z" });
    const second = worldModelIdFor({ fingerprint: "a".repeat(64), modules: 10, generatedAt: "2026-01-01T00:00:00.000Z" });
    const other = worldModelIdFor({ fingerprint: "b".repeat(64), modules: 10, generatedAt: "2026-01-01T00:00:00.000Z" });
    expect(first).toMatch(/^wm-[0-9a-f]{8}$/);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
  });

  it("summarizes the model for a durable task record", () => {
    const summary = summarizeWorldModel(modelWith(GRAPH_FIXTURE));
    expect(summary.modules).toBe(5);
    expect(summary.ci_files).toEqual([".github/workflows/ci.yml"]);
    expect(summary.build_system).toEqual(["tsc"]);
    expect(summary.workspace).toBe("SINGLE");
    expect(summary.git.head).toBe("abc");
  });
});
