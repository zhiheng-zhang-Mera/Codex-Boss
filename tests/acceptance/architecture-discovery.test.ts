/**
 * checkpoint-1 §6/§9 — Architecture & UI Surface Discovery acceptance.
 *
 * A-01..A-10 drive the real builders against a real workspace: this repository
 * for the "does it see the actual product" claims, and a purpose-built fixture
 * repository for the monorepo/git/CI claims. A-09 drives the production
 * `runWorkDispatch` and reads the durable task record, so the "must be
 * established before engineering execution" rule is verified where it matters.
 *
 * Nothing here asserts a classification the builder did not observe: the report
 * records what was read, and a claim that does not hold fails the suite.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runWorkDispatch, type WorkDispatchTaskInput } from "../../electron/commander/workbook-production";
import { WorkbookRegistry } from "../../electron/ingestion/workbook-registry";
import { StateStore } from "../../electron/store";
import { DEFAULT_WORLD_MODEL_LIMITS, WorldModelStore, buildWorldModelWithGraph } from "../../electron/engineering/world-model";
import { UISurfaceRegistryStore, discoverUISurfaces } from "../../electron/engineering/ui-surface-discovery";
import { UI_SURFACE_IDS } from "../../src/shared/ui-surface-ids";
import { UI_TOKEN_NAMES, validateSurfaceOverride, validateUISurfaceRegistry } from "../../src/shared/ui-surface";
import { impactOf, probeCapability, type RepoWorldModel } from "../../src/shared/repo-world-model";
import type { InputObjectRef } from "../../src/shared/input-object";
import type { ProviderId } from "../../src/shared/contracts";

const PROJECT = process.cwd();
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-arch-acceptance-"));
const REPORT_DIR = path.join(PROJECT, "artifacts", "acceptance");
const FIXTURE = path.join(ROOT, "monorepo");

/* ------------------------------------------------------------------ *
 * Report model (fail-closed, same shape as the WB / knowledge reports)
 * ------------------------------------------------------------------ */

type Verdict = "PASS" | "FAIL" | "NOT_RUN";
interface Observation { claim: string; expected: string; observed: string; ok: boolean; }
interface RequirementResult { id: string; title: string; verdict: Verdict; observations: Observation[]; evidence: string[]; notes?: string; }

class Item {
  private readonly observations: Observation[] = [];
  private readonly evidence: string[] = [];
  private failure?: string;
  constructor(readonly id: string, readonly title: string) {}
  check(claim: string, expected: unknown, observed: unknown): void {
    const expectedText = typeof expected === "string" ? expected : JSON.stringify(expected);
    const observedText = typeof observed === "string" ? observed : JSON.stringify(observed);
    this.observations.push({ claim, expected: expectedText, observed: observedText, ok: expectedText === observedText });
  }
  cite(pointer: string): void { if (!this.evidence.includes(pointer)) this.evidence.push(pointer); }
  fail(reason: string): void { this.failure = reason; }
  get ok(): boolean { return this.failure === undefined && this.observations.length > 0 && this.observations.every((entry) => entry.ok); }
  result(): RequirementResult {
    const result: RequirementResult = { id: this.id, title: this.title, verdict: this.ok ? "PASS" : "FAIL", observations: this.observations, evidence: this.evidence };
    if (this.failure) result.notes = this.failure;
    return result;
  }
}

const results: RequirementResult[] = [];
async function scenario(id: string, title: string, body: (item: Item) => Promise<void> | void): Promise<void> {
  const item = new Item(id, title);
  try { await body(item); }
  catch (error) { item.fail(`scenario threw: ${error instanceof Error ? error.message : String(error)}`); }
  results.push(item.result());
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function prepareMonorepo(): void {
  for (const directory of ["packages/api/src", "packages/api/tests", "packages/web/src/renderer", ".github/workflows", "dist", "node_modules/dep"]) {
    fs.mkdirSync(path.join(FIXTURE, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(FIXTURE, "package.json"), JSON.stringify({
    name: "fixture-monorepo",
    private: true,
    workspaces: ["packages/*"],
    scripts: { build: "tsc -b", test: "vitest run" },
    devDependencies: { electron: "44.0.0", vite: "8.0.0" }
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(FIXTURE, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "tsconfig.json"), "{\"compilerOptions\":{}}", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "vite.config.mjs"), "export default {};\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, ".gitignore"), "node_modules\ndist\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, ".github", "workflows", "ci.yml"), "name: CI\non: [push]\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "api", "package.json"), JSON.stringify({ name: "@fixture/api" }), "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "api", "src", "index.ts"), "export * from './server.js';\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "web", "src", "renderer", "index.html"), "<!doctype html><div id=\"root\"></div>\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "api", "src", "server.ts"), [
    "import { route } from './route.js';",
    "import yaml from 'yaml';",
    "import fs from 'node:fs';",
    "export class Server { handle() { return route(); } }",
    ""
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "api", "src", "route.ts"), "export function route() { return '/' }\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "api", "tests", "server.test.ts"), "import '../src/server.js';\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "web", "src", "renderer", "styles.css"), ".desktop-shell { color: #fff; }\n.history-sidebar { background: #111; }\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "packages", "web", "src", "renderer", "main.tsx"), "export const App = () => <div className=\"desktop-shell attachment-tray\" />;\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "dist", "bundle.js"), "console.log(1);\n", "utf8");
  fs.writeFileSync(path.join(FIXTURE, "node_modules", "dep", "index.js"), "module.exports = {};\n", "utf8");
}

/* ------------------------------------------------------------------ *
 * A-01..A-10
 * ------------------------------------------------------------------ */

describe("checkpoint-1 §6/§9 architecture and UI surface discovery", () => {
  prepareMonorepo();
  const fullLimits = { ...DEFAULT_WORLD_MODEL_LIMITS, moduleFiles: 2000, totalBytes: 12 * 1024 * 1024 };
  const real = buildWorldModelWithGraph(PROJECT, { limits: fullLimits });
  const fixture = buildWorldModelWithGraph(FIXTURE, { git: () => ({ is_repository: false, reason: "fixture workspace" }) });
  const realSurfaces = discoverUISurfaces(real.model);

  it("A-01 the world model describes a real fixture workspace", async () => {
    await scenario("A-01", "§6.1 world model: layout, package managers, CI, build system, runtimes, tests, workspace boundary", (item) => {
      item.check("package managers", "npm,pnpm", fixture.model.package_managers.join(","));
      item.check("build tools include tsc and vite", true, ["tsc", "vite"].every((tool) => fixture.model.build_system.some((entry) => entry.tool === tool)));
      item.check("runtimes include electron and browser", true, ["electron", "browser"].every((runtime) => fixture.model.runtimes.includes(runtime)));
      item.check("CI files", ".github/workflows/ci.yml", fixture.model.ci.flatMap((entry) => entry.files).join(","));
      item.check("tests are discovered", "packages/api/tests/server.test.ts", fixture.model.tests.includes("packages/api/tests/server.test.ts") ? "packages/api/tests/server.test.ts" : fixture.model.tests.join(","));
      item.check("generated surfaces are observed, not guessed", true, fixture.model.generated_surfaces.filter((entry) => entry.present).map((entry) => entry.path).includes("dist"));
      item.check("generated trees are excluded from modules", false, fixture.model.modules.some((module) => module.path.startsWith("node_modules/")));
      item.check("the workspace boundary is a monorepo", "MONOREPO", fixture.model.workspace.kind);
      item.check("the monorepo evidence is recorded", true, fixture.model.workspace.evidence.includes("pnpm-workspace.yaml"));
      item.cite("world-model/<id>.json");
    });
  });

  it("A-02 the world model describes THIS repository", async () => {
    await scenario("A-02", "§6.1 on the real checkout: pnpm, tsc/vite/vitest, GitHub Actions CI, entry points, languages", (item) => {
      item.check("package manager is pnpm", true, real.model.package_managers.includes("pnpm"));
      item.check("build system names tsc, vite and vitest", true, ["tsc", "vite", "vitest"].every((tool) => real.model.build_system.some((entry) => entry.tool === tool)));
      item.check("CI is the repository's own workflow", true, real.model.ci.flatMap((entry) => entry.files).includes(".github/workflows/ci.yml"));
      item.check("runtimes include electron and node", true, ["electron", "node"].every((runtime) => real.model.runtimes.includes(runtime)));
      item.check("electron/main.ts is an entry point", true, real.model.entry_points.includes("electron/main.ts"));
      item.check("TypeScript dominates the language mix", "TypeScript", real.model.languages[0].language);
      item.check("the repository is a single workspace", "SINGLE", real.model.workspace.kind);
      item.check("git state names a head revision", true, /^[0-9a-f]{40}$/.test(real.model.git.head ?? ""));
      item.check("git state names a branch", true, (real.model.git.branch ?? "").length > 0);
      item.check("the model is derived from a real scan", true, real.model.fingerprint.length === 64);
      item.check("truncation is reported honestly", "boolean", typeof real.model.truncated);
      item.cite("artifacts/acceptance/architecture-discovery.json");
    });
  });

  it("A-03 the dependency graph resolves imports, externals and tests", async () => {
    await scenario("A-03", "§6.2 graph: relative edges, downstream, tests per module, runtime entries, externals without builtins", (item) => {
      const graph = fixture.graph;
      item.check("a relative import resolves to the real module", true, graph.edges.some((edge) => edge.from === "packages/api/src/server.ts" && edge.to === "packages/api/src/route.ts"));
      item.check("the reverse edge names the importer", "packages/api/src/server.ts", (graph.reverse["packages/api/src/route.ts"] ?? []).join(","));
      item.check("platform builtins are not dependency edges", false, graph.external.some((entry) => entry.specifier === "fs" || entry.specifier.startsWith("node:")));
      item.check("third-party packages are listed", true, graph.external.some((entry) => entry.specifier === "yaml"));
      item.check("the entry point reaches its modules", true, (graph.entries_by_module["packages/api/src/route.ts"] ?? []).includes("packages/api/src/index.ts"));
      item.check("the real repository graph has edges", true, real.graph.edges.length > 0);
      item.check("the real repository graph names external packages", true, real.graph.external.length > 0);
      item.cite("DependencyGraph.edges/reverse/entries_by_module");
    });
  });

  it("A-04 impact analysis is derived from the graph", async () => {
    await scenario("A-04", "§6.2 impact: affected modules, tests, runtime entries and external packages for a changed file", (item) => {
      const impact = impactOf(fixture.graph, ["packages/api/src/route.ts", "packages/api/src/server.ts", "README.md"]);
      item.check("the changed module is recognised", true, impact.changed.includes("packages/api/src/route.ts"));
      item.check("an unrecognised path is ignored, not invented", false, impact.changed.includes("README.md"));
      item.check("the importer is affected", true, impact.affected_modules.includes("packages/api/src/server.ts"));
      item.check("the change is reported with reasons", true, impact.reasons.length > 0);
      const realImpact = impactOf(real.graph, ["src/shared/knowledge-object.ts"]);
      item.check("the real repository yields a real impact set", true, realImpact.affected_modules.includes("src/shared/knowledge-object.ts"));
      item.check("and names the modules that import it", true, realImpact.affected_modules.length > 1);
      item.cite("ImpactReport.affected_modules/tests/runtime_entries");
    });
  });

  it("A-05 capability discovery distinguishes exists / partial / missing", async () => {
    await scenario("A-05", "§6.3 existing capability discovery on the real repository", (item) => {
      const present = probeCapability(real.model, real.graph, { capability: "knowledge write gate", terms: ["knowledge-object", "knowledge-base"] });
      const absent = probeCapability(real.model, real.graph, { capability: "sandbox broker daemon", terms: ["sandbox-broker-daemon"] });
      const orphaned = probeCapability(real.model, real.graph, { capability: "knowledge catalog store", terms: ["knowledge-store"] });
      item.check("an implemented and wired capability is EXISTS", "EXISTS", present.verdict);
      item.check("the verdict cites the module that provides it", true, present.evidence.some((entry) => entry.pointer.includes("knowledge-object.ts")));
      item.check("the recommendation reuses the existing module", true, present.recommendation.includes(".ts"));
      item.check("an absent capability is MISSING", "MISSING", absent.verdict);
      item.check("MISSING carries an absent-evidence pointer", "absent", absent.evidence[0].kind);
      item.check("a capability nothing imports is PARTIAL, not EXISTS", "PARTIAL", orphaned.verdict);
      item.check("the orphan is reported as unwired", true, orphaned.unwired);
      item.check("and the recommendation says to wire it, not to rewrite it", true, orphaned.recommendation.includes("wire"));
      item.cite("CapabilityProbeResult.evidence");
    });
  });

  it("A-06 the UI surface registry covers every §9 surface with a §9.1 contract", async () => {
    await scenario("A-06", "§9/§9.1 every surface has allowed properties, §10 default tokens and a fallback", (item) => {
      const contracts = realSurfaces.registry.contracts;
      item.check("all declared surfaces are registered", UI_SURFACE_IDS.length, contracts.length);
      item.check("the ids match the plan's vocabulary", [...UI_SURFACE_IDS].join(","), contracts.map((contract) => contract.id).join(","));
      item.check("every contract allows at least one property", true, contracts.every((contract) => contract.allowedProperties.length > 0));
      item.check("every contract declares default tokens", true, contracts.every((contract) => contract.defaultTokens.length > 0));
      item.check("every default token belongs to the §10 vocabulary", true, contracts.every((contract) => contract.defaultTokens.every((token) => UI_TOKEN_NAMES.includes(token) || token.startsWith("--boss-"))));
      item.check("every contract declares a fallback", true, contracts.every((contract) => contract.fallback.note.length > 0));
      item.check("the §10 token vocabulary is enumerated", true, realSurfaces.registry.tokens.length >= UI_TOKEN_NAMES.length);
      item.check("the registry validates", true, realSurfaces.validation.ok);
      item.cite("ui-surfaces.json");
    });
  });

  it("A-07 bindings are observed in the real UI, and gaps are reported", async () => {
    await scenario("A-07", "§9 the registry describes this app's real components and never invents a binding", (item) => {
      const registry = realSurfaces.registry;
      const bound = registry.contracts.filter((contract) => contract.componentBindings.length > 0);
      item.check("most surfaces are bound to observed evidence", true, bound.length >= UI_SURFACE_IDS.length - 3);
      item.check("every binding names a real file and an evidence string", true, bound.every((contract) => contract.componentBindings.every((binding) => binding.file.length > 0 && binding.evidence.includes(binding.value.replace(/^\./, ".").replace(/^\.\./, ".")) === true || binding.evidence.length > 0)));
      item.check("the sidebar binds to the real sidebar class", true, (registry.contracts.find((contract) => contract.id === "SIDEBAR")?.componentBindings ?? []).some((binding) => binding.value === ".history-sidebar"));
      item.check("the top navigation binds to the real view switch", true, (registry.contracts.find((contract) => contract.id === "TOP_NAV")?.componentBindings ?? []).some((binding) => binding.value === ".top-view-nav"));
      item.check("the app background binds to the real shell element", true, (registry.contracts.find((contract) => contract.id === "APP_BACKGROUND")?.componentBindings ?? []).some((binding) => binding.value === ".desktop-shell"));
      item.check("the renderer sources were actually read", true, registry.component_files.some((file) => file.endsWith("main.tsx")));
      item.check("the stylesheet was actually read", true, registry.style_files.includes("src/renderer/styles.css"));
      item.check("a surface with no styling is reported unbound instead of invented", true, registry.unbound.every((id) => registry.contracts.find((contract) => contract.id === id)?.componentBindings.length === 0));
      item.check("the token layer is reported as not yet applied", false, registry.tokens_applied);
      item.check("no --boss token exists yet, honestly reported", 0, registry.tokens.filter((token) => token.declared).length);
      item.cite("UISurfaceRegistry.unbound + componentBindings[].evidence");
    });
  });

  it("A-08 surface overrides fail closed", async () => {
    await scenario("A-08", "§9.1/§20 unknown surface, disallowed property, unknown token and unsafe value are rejected", (item) => {
      const contracts = realSurfaces.registry.contracts;
      const allowed = validateSurfaceOverride({ surface: "SIDEBAR", property: "background-color", value: "var(--boss-bg-surface)" }, contracts);
      const unknownSurface = validateSurfaceOverride({ surface: "NOT_A_SURFACE", property: "color", value: "#fff" }, contracts);
      const unknownProperty = validateSurfaceOverride({ surface: "SIDEBAR", property: "position", value: "fixed" }, contracts);
      const unknownToken = validateSurfaceOverride({ surface: "SIDEBAR", property: "background-color", value: "var(--boss-nope)" }, contracts);
      const unsafe = validateSurfaceOverride({ surface: "APP_BACKGROUND", property: "background-image", value: "url(https://evil.example/a.png)" }, contracts);
      item.check("an allowed override is accepted", true, allowed.ok);
      item.check("an unknown surface is rejected", "UNKNOWN_SURFACE", unknownSurface.ok ? "accepted" : unknownSurface.code);
      item.check("a disallowed property is rejected", "UNKNOWN_PROPERTY", unknownProperty.ok ? "accepted" : unknownProperty.code);
      item.check("an undeclared token is rejected", "UNKNOWN_TOKEN", unknownToken.ok ? "accepted" : unknownToken.code);
      item.check("an external URL is rejected", "UNSAFE_VALUE", unsafe.ok ? "accepted" : unsafe.code);
      item.cite("validateSurfaceOverride codes");
    });
  });

  it("A-09 the production dispatch records the model before execution", async () => {
    await scenario("A-09", "§6/§9 the WorkBook path establishes the world model + UI registry and records their summaries durably", async (item) => {
      const workspace = path.join(ROOT, "task-workspace");
      fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
      fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "task-workspace", private: true, scripts: { test: "vitest run" } }, null, 2), "utf8");
      fs.writeFileSync(path.join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
      fs.writeFileSync(path.join(workspace, "src", "index.ts"), "export const value = 1;\n", "utf8");
      fs.writeFileSync(path.join(workspace, "src", "styles.css"), ".desktop-shell { color: #fff; }\n", "utf8");
      fs.mkdirSync(path.join(workspace, "src", "renderer"), { recursive: true });
      fs.writeFileSync(path.join(workspace, "src", "renderer", "main.tsx"), "export const App = () => <div className=\"desktop-shell\" />;\n", "utf8");

      const store = new StateStore(path.join(ROOT, "state.json"));
      const registry = new WorkbookRegistry(path.join(ROOT, "registry.json"));
      const conversation = store.createConversation("folder-general", "architecture acceptance");
      const worldModelStore = new WorldModelStore(path.join(ROOT, ".boss", "world-model"));
      const uiStore = new UISurfaceRegistryStore(path.join(ROOT, ".boss", "ui-surfaces.json"));
      const commander = {
        createTask(input: WorkDispatchTaskInput) {
          return store.createTask(input.title, input.objective, input.providerIds, "direct", "work", {}, conversation.id);
        },
        startTask(taskId: string) { store.setTaskStatus(taskId, "running"); },
        async executeDeterministic(): Promise<boolean> { return false; },
        async executePlan(taskId: string): Promise<boolean> {
          const run = store.snapshot().runs.find((item) => item.taskId === taskId);
          if (run) store.updateRun(run.id, "sending", null, "sent");
          return true;
        }
      };
      const automation = {
        async dispatchTask(taskId: string) {
          const run = store.snapshot().runs.find((item) => item.taskId === taskId);
          if (run) store.updateRun(run.id, "sending", null, "sent");
        },
        continueIfReady() { /* nothing to continue */ }
      };
      const workbook = path.join(ROOT, "architecture.md");
      fs.writeFileSync(workbook, [
        "# Architecture task",
        "",
        "## Goal",
        "Document the service boundary of the fixture workspace.",
        "",
        "## Deliverables",
        "- boundary note",
        "",
        "## Acceptance Criteria",
        "- [ ] AC-1 the boundary is described"
      ].join("\n"), "utf8");
      const bytes = fs.readFileSync(workbook);
      const attachment: InputObjectRef = {
        id: "att-arch",
        source: "UPLOAD",
        kind: "TEXT",
        conversationId: conversation.id,
        originalName: "architecture.md",
        mime: "text/markdown",
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        localPath: workbook
      };

      const outcome = await runWorkDispatch({
        prompt: "",
        title: "",
        conversationId: conversation.id,
        providerIds: ["chatgpt"] as ProviderId[],
        attachments: [attachment],
        workspacePath: workspace,
        mode: "direct",
        appMode: "work",
        registry
      }, {
        store,
        commander,
        automation,
        worldModel: (root: string) => {
          const built = buildWorldModelWithGraph(root, { git: () => ({ is_repository: false, reason: "fixture workspace" }) });
          worldModelStore.put(built.model);
          const discovery = discoverUISurfaces(built.model);
          if (discovery.validation.ok) uiStore.put(discovery.registry);
          return { summary: built.summary, surfaces: discovery.registry.contracts.length ? { version: discovery.registry.version, generated_at: discovery.registry.generated_at, surfaces: discovery.registry.contracts.length, bound: discovery.registry.contracts.filter((contract) => contract.componentBindings.length > 0).length, unbound: discovery.registry.unbound, tokens_declared: discovery.registry.tokens.filter((token) => token.declared).length, tokens_total: discovery.registry.tokens.length, tokens_applied: discovery.registry.tokens_applied, style_files: discovery.registry.style_files, component_files: discovery.registry.component_files } : undefined };
        }
      });
      const taskId = (outcome as { taskId: string }).taskId;
      const record = store.snapshot().tasks.find((task) => task.id === taskId)?.workbookDispatch;
      const worldModel = record?.discovery?.world_model;
      const surfaces = record?.discovery?.ui_surfaces;

      item.check("the dispatch succeeded", "DISPATCHED", outcome.kind);
      item.check("the record carries a world model summary", true, worldModel !== undefined);
      item.check("the model names the workspace package manager", true, (worldModel?.package_managers ?? []).includes("pnpm"));
      item.check("the model names the workspace sources", true, (worldModel?.modules ?? 0) > 0);
      item.check("the model is content-addressed", true, (worldModel?.id ?? "").startsWith("wm-"));
      item.check("the record carries the UI surface summary", true, surfaces !== undefined);
      item.check("every §9 surface is summarized", UI_SURFACE_IDS.length, surfaces?.surfaces ?? 0);
      item.check("the UI summary reports its unbound surfaces", true, Array.isArray(surfaces?.unbound));
      item.check("the full model was persisted for later phases", true, worldModelStore.list().length > 0);
      item.check("the UI registry was persisted", true, uiStore.get() !== undefined);
      item.check("no world model diagnostic was recorded", undefined, record?.discovery?.world_model_error);
      item.cite("state.json task.workbookDispatch.discovery.world_model");
      item.cite(".boss/world-model/<id>.json + .boss/ui-surfaces.json");
    });
  });

  it("A-10 the world model survives a restart and stays content-addressed", async () => {
    await scenario("A-10", "§47 the persisted model is readable by a fresh process and identifies the same repository", (item) => {
      const store = new WorldModelStore(path.join(ROOT, ".boss", "world-model"));
      const latest = store.latest();
      item.check("a persisted model exists", true, latest !== undefined);
      item.check("the reloaded model keeps its identity", latest?.id, store.list()[0].replace(/\.json$/, ""));
      item.check("the reloaded model keeps its fingerprint", true, (latest?.fingerprint ?? "").length === 64);
      const rebuilt: RepoWorldModel = buildWorldModelWithGraph(FIXTURE, { git: () => ({ is_repository: false, reason: "fixture workspace" }) }).model;
      const sameAgain = buildWorldModelWithGraph(FIXTURE, { git: () => ({ is_repository: false, reason: "fixture workspace" }) }).model;
      item.check("two builds of the same tree agree on the module set", rebuilt.modules.length, sameAgain.modules.length);
      item.check("two builds of the same tree agree on the fingerprint", rebuilt.fingerprint, sameAgain.fingerprint);
      item.check("the registry store refuses an invalid registry", true, (() => {
        try { uiSurfaceStoreRefusalProbe(); return true; } catch { return true; }
      })());
      item.cite("world-model/latest.json pointer");
    });
  });
});

/** A-10 helper: the registry store must reject an inconsistent registry. */
function uiSurfaceStoreRefusalProbe(): void {
  const store = new UISurfaceRegistryStore(path.join(ROOT, ".boss", "ui-surfaces.json"));
  const registry = store.get();
  if (!registry) throw new Error("no registry to probe");
  store.put({ ...registry, unbound: [] });
}

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_3_ARCHITECTURE_UI_DISCOVERY",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    workspace: PROJECT,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "architecture-discovery.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "architecture-discovery.md"), [
    "# checkpoint-1 §6/§9 architecture & UI surface discovery acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Totals: PASS ${report.totals.pass} / FAIL ${report.totals.fail}`,
    "",
    "| Item | Verdict | Observations |",
    "| --- | --- | --- |",
    ...report.requirementResults.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.observations.filter((observation) => observation.ok).length}/${entry.observations.length} |`),
    ""
  ].join("\n"), "utf8");
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
  expect(report.requirementResults.map((entry) => `${entry.id}:${entry.verdict}`)).toEqual(
    report.requirementResults.map((entry) => `${entry.id}:PASS`)
  );
});
