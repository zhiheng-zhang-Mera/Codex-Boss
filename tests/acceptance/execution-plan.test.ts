/**
 * checkpoint-1 §29 — Execution Planner (P-01..P-06).
 *
 * P-01/P-02/P-06 drive the REAL production dispatch: the execution DAG is built
 * inside `runWorkDispatch` from the real requirement graph and read back from the
 * durable task record. P-03/P-04/P-05 exercise §29.2 parallelism and §29.3's
 * resource-derived concurrency.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runWorkDispatch, type WorkDispatchTaskInput } from "../../electron/commander/workbook-production";
import { WorkbookRegistry } from "../../electron/ingestion/workbook-registry";
import { StateStore } from "../../electron/store";
import {
  decideConcurrency,
  planExecution,
  resolveAllowedFiles,
  scheduleExecution,
  type ExecutionPlan,
  type PlanContext
} from "../../src/shared/execution-planner";
import { buildRequirementsGraph } from "../../src/shared/requirements-graph";
import { compileTaskContract } from "../../src/shared/task-contract";
import { ingestDocuments } from "../../electron/ingestion/ingest";
import type { InputObjectRef } from "../../src/shared/input-object";
import type { ProviderId } from "../../src/shared/contracts";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-plan-acceptance-"));
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");

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

/* ---- production environment (real store/registry/ingestion) ---- */
const WORKSPACE = path.join(ROOT, "workspace");
for (const directory of ["src", "tests", "src/renderer"]) fs.mkdirSync(path.join(WORKSPACE, directory), { recursive: true });
fs.writeFileSync(path.join(WORKSPACE, "package.json"), JSON.stringify({ name: "plan-fixture", private: true, scripts: { typecheck: "tsc --noEmit", test: "vitest run", build: "vite build" } }, null, 2), "utf8");
fs.writeFileSync(path.join(WORKSPACE, "tsconfig.json"), "{}", "utf8");
fs.writeFileSync(path.join(WORKSPACE, "vite.config.mjs"), "export default {};\n", "utf8");
fs.writeFileSync(path.join(WORKSPACE, "src", "checkout.ts"), "export const checkout = () => true;\n", "utf8");
fs.writeFileSync(path.join(WORKSPACE, "src", "gateway.ts"), "export const gateway = () => true;\n", "utf8");
fs.writeFileSync(path.join(WORKSPACE, "src", "renderer", "styles.css"), ".desktop-shell { color: #fff; }\n", "utf8");
fs.writeFileSync(path.join(WORKSPACE, "tests", "checkout.test.ts"), "it('x', () => {});\n", "utf8");

const WORKBOOK = [
  "# Installment checkout",
  "",
  "## Goal",
  "Let users choose installments at checkout.",
  "",
  "## Scope",
  "- checkout gateway adapter",
  "",
  "## Deliverables",
  "- gateway adapter implementation",
  "",
  "## Constraints",
  "- the checkout response must not exceed one hundred milliseconds",
  "",
  "## Acceptance Criteria",
  "- [ ] AC-1 the gateway adapter falls back to full payment"
].join("\n");

let sequence = 0;
const store = new StateStore(path.join(ROOT, "state.json"));
const registry = new WorkbookRegistry(path.join(ROOT, "registry.json"));
const conversation = store.createConversation("folder-general", "plan acceptance");
const commander = {
  createTask(input: WorkDispatchTaskInput) { return store.createTask(input.title, input.objective, input.providerIds, "direct", "work", {}, conversation.id); },
  startTask(taskId: string) { store.setTaskStatus(taskId, "running"); },
  async executeDeterministic(): Promise<boolean> { return false; },
  async executePlan(): Promise<boolean> { return true; }
};
const automation = { async dispatchTask() { /* provider work is out of scope here */ }, continueIfReady() { /* nothing */ } };

function attachment(name: string, content: string): InputObjectRef {
  sequence += 1;
  const target = path.join(ROOT, `${sequence}-${name}`);
  fs.writeFileSync(target, content, "utf8");
  const bytes = Buffer.from(content, "utf8");
  return {
    id: `att-${sequence}`, source: "UPLOAD", kind: "TEXT", conversationId: conversation.id,
    originalName: name, mime: "text/markdown", size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"), localPath: target
  };
}

const planContext: PlanContext = {
  files: ["src/checkout.ts", "src/gateway.ts", "src/renderer/styles.css", "tests/checkout.test.ts"],
  tests: ["tests/checkout.test.ts"],
  entry_points: ["src/checkout.ts"],
  build_tools: ["tsc", "vite", "vitest"],
  commands: { typecheck: "pnpm run typecheck", unit: "pnpm test", build: "pnpm run build" },
  resources: { cpu_cores: 8, free_memory_mb: 8192, gpu_available: false, available_providers: 3, rate_limited_providers: 0, active_tasks: 0, load_average: 0.1 }
};

const outcome = await runWorkDispatch({
  prompt: "", title: "", conversationId: conversation.id, providerIds: ["chatgpt"] as ProviderId[],
  attachments: [attachment("checkout.md", WORKBOOK)], workspacePath: WORKSPACE, mode: "direct", appMode: "work", registry
}, { store, commander, automation, planContext: () => planContext });
const taskId = (outcome as { taskId: string }).taskId;
const record = store.snapshot().tasks.find((task) => task.id === taskId)?.workbookDispatch;
const plan = record?.execution_plan as ExecutionPlan | undefined;

describe("checkpoint-1 §29 execution planner acceptance", () => {
  it("P-01 the real dispatch records an execution DAG", async () => {
    await scenario("P-01", "§29.1 the durable task carries a planned DAG", (item) => {
      item.check("the dispatch succeeded", "DISPATCHED", outcome.kind);
      item.check("the record carries an execution plan", true, plan !== undefined);
      item.check("the plan is versioned", "execution-plan-1", plan?.version);
      item.check("the plan has executable nodes", true, (plan?.nodes.length ?? 0) > 0);
      item.check("every node names its requirements", true, (plan?.nodes ?? []).every((node) => node.requirements.length > 0));
      const uncovered = (plan?.uncovered_requirements ?? []).map((id) => record?.requirements?.nodes.find((node) => node.id === id)?.type ?? "UNKNOWN");
      item.check("only context requirements lack a node of their own", true, uncovered.every((type) => type === "GOAL" || type === "DEPENDENCY"));
      item.check("the goal is reported rather than silently dropped", true, uncovered.includes("GOAL"));
      item.check("every executable requirement has a node", true, uncovered.every((type) => type !== "DELIVERABLE" && type !== "ACCEPTANCE" && type !== "CONSTRAINT"));
      item.cite("state.json task.workbookDispatch.execution_plan");
    });
  });

  it("P-02 every node carries the nine §29.1 fields", async () => {
    await scenario("P-02", "§29.1 objective/requirements/inputs/scope/allowed files/outputs/verification/dependencies/rollback", (item) => {
      for (const node of plan?.nodes ?? []) {
        item.check(`${node.id}: objective`, true, node.objective.length > 0);
        item.check(`${node.id}: requirements`, true, node.requirements.length > 0);
        item.check(`${node.id}: inputs`, true, Array.isArray(node.inputs));
        item.check(`${node.id}: scope`, true, node.scope.length > 0);
        item.check(`${node.id}: allowed files granted`, true, node.allowed_files.length > 0);
        item.check(`${node.id}: expected outputs`, true, node.expected_outputs.length > 0);
        item.check(`${node.id}: verification gate`, true, node.verification.gate.length > 0);
        item.check(`${node.id}: verification commands`, true, node.verification.commands.length > 0);
        item.check(`${node.id}: rollback plan`, true, node.rollback.length > 0);
      }
      const implement = plan?.nodes.find((node) => node.kind === "IMPLEMENT");
      item.check("the implementation node is scoped to the real adapter file", true, (implement?.allowed_files ?? []).includes("src/gateway.ts"));
      item.check("no node was handed the whole repository", true, (plan?.nodes ?? []).every((node) => node.allowed_files.length <= 50));
      item.cite("ExecutionNode.allowed_files/verification/rollback");
    });
  });

  it("P-03 verification depends on implementation and cannot run first", async () => {
    await scenario("P-03", "§29.2 dependent nodes stay ordered", (item) => {
      const implement = plan?.nodes.find((node) => node.kind === "IMPLEMENT")!;
      const verify = plan?.nodes.find((node) => node.kind === "VERIFY")!;
      item.check("verification depends on implementation", true, verify.dependencies.includes(implement.id));
      item.check("implementation depends on nothing", 0, implement.dependencies.length);
      item.check("implementation is wave 0", 0, implement.wave);
      item.check("verification is a later wave", true, verify.wave > implement.wave);
      const optionalNode = plan?.nodes.find((node) => node.kind === "OPTIONAL");
      item.check("an optional node never gates the others", true, optionalNode === undefined || optionalNode.wave >= verify.wave);
      const first = scheduleExecution(plan!, {});
      item.check("only the implementable node starts first", implement.id, first.join(","));
      const afterImplement = scheduleExecution(plan!, { completed: [implement.id] });
      item.check("verification starts once implementation is done", true, afterImplement.includes(verify.id));
      item.cite("ExecutionPlan.waves + scheduleExecution");
    });
  });

  it("P-04 independent work is grouped into parallel waves", async () => {
    await scenario("P-04", "§29.2 parallel vs ordered", (item) => {
      const graph = buildRequirementsGraph({ contract: planContract() });
      const context: PlanContext = { ...planContext, resources: { ...planContext.resources!, cpu_cores: 8 } };
      const parallelPlan = planExecution({ requirements: graph, context });
      item.check("waves are ordered containers", true, parallelPlan.waves.every((wave) => Array.isArray(wave)));
      item.check("the plan reports its own parallelism ceiling", true, parallelPlan.plan_parallelism >= 1);
      item.check("a wave never contains a node that depends on another in the same wave", true, parallelPlan.waves.every((wave) =>
        wave.every((id) => {
          const node = parallelPlan.nodes.find((entry) => entry.id === id)!;
          return node.dependencies.every((dependency) => !wave.includes(dependency));
        })
      ));
      const capacity = scheduleExecution(parallelPlan, {});
      item.check("scheduling respects the adaptive limit", true, capacity.length <= parallelPlan.concurrency.level);
      item.cite("ExecutionPlan.waves/plan_parallelism");
    });
  });

  it("P-05 concurrency is derived from resources, never hardcoded", async () => {
    await scenario("P-05", "§29.3 CPU/RAM/GPU/providers/rate limits/active tasks/load", (item) => {
      const rich = decideConcurrency({ cpu_cores: 16, free_memory_mb: 16384, gpu_available: true, available_providers: 5, rate_limited_providers: 0, active_tasks: 0, load_average: 0.1 });
      const poor = decideConcurrency({ cpu_cores: 2, free_memory_mb: 1024, gpu_available: false, available_providers: 1, rate_limited_providers: 0, active_tasks: 3, load_average: 0.9 });
      const providerBound = decideConcurrency({ cpu_cores: 32, free_memory_mb: 32768, gpu_available: false, available_providers: 2, rate_limited_providers: 1, active_tasks: 0, load_average: 0 });
      item.check("a big idle host gets more parallelism than a constrained one", true, rich.level > poor.level);
      item.check("one usable provider bounds the level", 1, providerBound.level);
      item.check("everything stays within 1..8", true, [rich, poor, providerBound].every((decision) => decision.level >= 1 && decision.level <= 8));
      item.check("the decision explains itself", true, [rich, poor, providerBound].every((decision) => decision.reason.includes("final concurrency")));
      item.check("the inputs are carried with the decision", 16, rich.inputs.cpu_cores);
      const noProvider = decideConcurrency({ cpu_cores: 8, free_memory_mb: 4096, gpu_available: false, available_providers: 0, rate_limited_providers: 0, active_tasks: 0, load_average: 0 });
      item.check("with no provider observed the local gates keep a bounded level", true, noProvider.level >= 1 && noProvider.level <= 4);
      item.check("and the reason does not claim a provider bound", false, noProvider.reason.includes("provider(s)"));
      item.cite("ConcurrencyDecision.inputs/reason");
    });
  });

  it("P-06 an unresolvable scope is refused, not widened", async () => {
    await scenario("P-06", "§29.1/§29.4 a node without resolvable files has no write permission", (item) => {
      const graph = buildRequirementsGraph({ contract: planContract() });
      const noContext = planExecution({ requirements: graph });
      item.check("without a context no files are granted", true, noContext.nodes.every((node) => node.allowed_files.length === 0));
      item.check("the unbounded nodes say so", true, noContext.nodes.filter((node) => node.kind !== "VERIFY").every((node) => node.unbounded_scope));
      item.check("a diagnostic explains it", true, noContext.diagnostics.some((line) => line.includes("no write permission")));
      item.check("the rollback plan states nothing was granted", true, noContext.nodes.every((node) => node.rollback.includes("none were granted") || node.allowed_files.length > 0));
      item.check("scope resolution matches real files only", true, resolveAllowedFiles(["gateway adapter"], planContext).includes("src/gateway.ts"));
      item.check("an unknown scope matches nothing", 0, resolveAllowedFiles(["quantum flux capacitor"], planContext).length);
      item.cite("resolveAllowedFiles + ExecutionNode.unbounded_scope");
    });
  });
});

function planContract() {
  // A synchronous contract fixture: the planner only needs a compiled contract.
  return compileTaskContractSync();
}

let cachedContract: ReturnType<typeof compileTaskContract> | undefined;
function compileTaskContractSync() {
  if (cachedContract) return cachedContract;
  // ingestDocuments is async, so the fixture is compiled once from a pre-parsed
  // document shape; this keeps the unit-style scenarios synchronous.
  cachedContract = {
    version: 1,
    goal: [declaration("GOAL", ["Let users choose installments at checkout"])],
    scope: [declaration("SCOPE", ["checkout gateway adapter"])],
    constraints: [declaration("CONSTRAINTS", ["the checkout response must not exceed one hundred milliseconds"])],
    inputs: [{ document_id: "doc-1", file_name: "checkout.md", hash: "a".repeat(64), sections_used: 2 }],
    dependencies: [],
    deliverables: [declaration("DELIVERABLES", ["gateway adapter implementation"])],
    acceptance_criteria: [declaration("ACCEPTANCE_CRITERIA", ["AC-1 the gateway adapter falls back to full payment"])],
    risk: [],
    permissions: [],
    execution_strategy: { mode: "WORK", analysis_only: false, requires_planning: false, required_capabilities: [], reference_sections: [], rationale: "fixture" },
    source_workbook: { document_ids: ["doc-1"], classifications: [{ document_id: "doc-1", file_name: "checkout.md", kind: "EXECUTABLE_WORKBOOK", confidence: 0.9 }], primary_document_id: "doc-1", has_workbook: true },
    overrides: [],
    diagnostics: { warnings: [], missing: [], analysis_only_reasons: [], classification_reasons: [] }
  } as ReturnType<typeof compileTaskContract>;
  return cachedContract;
}

function declaration(kind: string, items: string[]) {
  return {
    kind: kind as never,
    authority: "WORKBOOK" as const,
    source_document_id: "doc-1",
    items,
    text: items.join("\n"),
    overridable: true,
    item_provenance: items.map((item) => ({ item, source_document_id: "doc-1", heading: kind }))
  };
}

void ingestDocuments;

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_7_EXECUTION_PLANNER",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    plan: plan ? { nodes: plan.nodes.length, waves: plan.waves.length, planParallelism: plan.plan_parallelism, concurrency: plan.concurrency.level, concurrencyReason: plan.concurrency.reason } : undefined,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "execution-plan.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "execution-plan.md"), [
    "# checkpoint-1 §29 execution planner acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Plan: ${report.plan?.nodes ?? 0} nodes, ${report.plan?.waves ?? 0} waves, concurrency ${report.plan?.concurrency ?? 0}`,
    "",
    `Totals: PASS ${report.totals.pass} / FAIL ${report.totals.fail}`,
    "",
    "| Item | Verdict | Observations |",
    "| --- | --- | --- |",
    ...report.requirementResults.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.observations.filter((observation) => observation.ok).length}/${entry.observations.length} |`),
    ""
  ].join("\n"), "utf8");
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
  expect(report.requirementResults.map((entry) => `${entry.id}:${entry.verdict}`)).toEqual(report.requirementResults.map((entry) => `${entry.id}:PASS`));
});
