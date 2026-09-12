/**
 * checkpoint-1 §28 — Requirements Graph acceptance (R-01..R-08).
 *
 * R-01/R-02/R-03 drive the REAL production dispatch: the graph is compiled
 * inside `runWorkDispatch` from the real ingestion + contract and read back from
 * the durable task record. R-04..R-08 exercise the §28.3 state machine and the
 * §28.4 acceptance binding, including the fail-closed rule that a claim is not
 * evidence.
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
  REQUIREMENT_TRANSITIONS,
  bindAcceptance,
  evidenceTemplate,
  findRequirementCycle,
  readyRequirements,
  requiredEvidenceKinds,
  topologicalRequirementOrder,
  transitionRequirement,
  type RequirementEvidence,
  type RequirementsGraph
} from "../../src/shared/requirements-graph";
import type { InputObjectRef } from "../../src/shared/input-object";
import type { ProviderId } from "../../src/shared/contracts";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-req-acceptance-"));
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");

const SPEC_A = [
  "# Checkout specification A",
  "",
  "## Goal",
  "Ship installment checkout.",
  "",
  "## Deliverables",
  "- installment selector",
  "",
  "## Constraints",
  "- the checkout response must complete within one hundred milliseconds under peak load",
  "",
  "## Acceptance Criteria",
  "- [ ] AC-A1 the selector is visible at checkout"
].join("\n");

const SPEC_B = [
  "# Checkout specification B",
  "",
  "## Goal",
  "Ship installment checkout.",
  "",
  "## Constraints",
  "- the checkout response is allowed to take up to five seconds while the cache warms",
  "",
  "## Acceptance Criteria",
  "- [ ] AC-B1 the gateway adapter logs every failure"
].join("\n");

const THEME_WORKBOOK = [
  "# Theme refresh",
  "",
  "## Goal",
  "Make the interface feel calmer.",
  "",
  "## Scope",
  "- sidebar and card styling",
  "",
  "## Acceptance Criteria",
  "- [ ] the sidebar colour matches the approved palette"
].join("\n");

/* ------------------------------------------------------------------ *
 * Report model
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
 * Production environment (same shape as the WB acceptance harness)
 * ------------------------------------------------------------------ */

const WORKSPACE = path.join(ROOT, "workspace");
fs.mkdirSync(path.join(WORKSPACE, "src"), { recursive: true });
fs.writeFileSync(path.join(WORKSPACE, "package.json"), JSON.stringify({ name: "req-fixture", private: true }), "utf8");
fs.writeFileSync(path.join(WORKSPACE, "src", "checkout.ts"), "export const checkout = () => true;\n", "utf8");

let sequence = 0;
const store = new StateStore(path.join(ROOT, "state.json"));
const registry = new WorkbookRegistry(path.join(ROOT, "registry.json"));
const conversation = store.createConversation("folder-general", "requirements acceptance");
const commander = {
  createTask(input: WorkDispatchTaskInput) {
    return store.createTask(input.title, input.objective, input.providerIds, "direct", "work", {}, conversation.id);
  },
  startTask(taskId: string) { store.setTaskStatus(taskId, "running"); },
  async executeDeterministic(): Promise<boolean> { return false; },
  async executePlan(): Promise<boolean> { return true; }
};
const automation = { async dispatchTask() { /* provider work is not part of this acceptance */ }, continueIfReady() { /* nothing */ } };

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

async function dispatch(files: InputObjectRef[], prompt = "") {
  const outcome = await runWorkDispatch({
    prompt, title: "", conversationId: conversation.id, providerIds: ["chatgpt"] as ProviderId[],
    attachments: files, workspacePath: WORKSPACE, mode: "direct", appMode: "work", registry
  }, { store, commander, automation });
  const taskId = (outcome as { taskId: string }).taskId;
  const task = store.snapshot().tasks.find((item) => item.id === taskId)!;
  return { outcome, taskId, graph: task.workbookDispatch?.requirements as RequirementsGraph | undefined, task };
}

const main = await dispatch([attachment("spec-a.md", SPEC_A), attachment("spec-b.md", SPEC_B)]);
const theme = await dispatch([attachment("theme.md", THEME_WORKBOOK)]);

/* ------------------------------------------------------------------ *
 * R-01..R-08
 * ------------------------------------------------------------------ */

describe("checkpoint-1 §28 requirements graph acceptance", () => {
  it("R-01 the real dispatch compiles a requirement graph onto the durable task", async () => {
    await scenario("R-01", "§28.1 the production path records typed requirements with contract provenance", (item) => {
      const graph = main.graph;
      item.check("the task carries a requirements graph", true, graph !== undefined);
      item.check("the graph is versioned", "requirements-graph-1", graph?.version);
      item.check("the dispatch succeeded", "DISPATCHED", main.outcome.kind);
      item.check("every node carries contract provenance", true, (graph?.nodes ?? []).every((node) => node.provenance.document_id.length > 0 && node.text.trim().length > 0));
      item.check("the goal requirement exists", true, (graph?.nodes ?? []).some((node) => node.type === "GOAL"));
      item.check("an acceptance requirement exists", true, (graph?.nodes ?? []).some((node) => node.type === "ACCEPTANCE"));
      item.check("a constraint requirement exists", true, (graph?.nodes ?? []).some((node) => node.type === "CONSTRAINT" || node.type === "PROHIBITION"));
      item.check("the graph counts by type", true, Object.keys(graph?.counts ?? {}).length >= 3);
      item.check("the graph names its workbook hash", true, (graph?.workbook_hash ?? "").length === 64 || (main.task.workbookDispatch?.workbook_hash ?? "").length === 64);
      item.cite("state.json task.workbookDispatch.requirements");
    });
  });

  it("R-02 the dependency graph is explained, acyclic and orderable", async () => {
    await scenario("R-02", "§28.2 edges carry reasons; the graph is a DAG with a dependencies-first order", (item) => {
      const graph = main.graph!;
      item.check("the graph has edges", true, graph.edges.length > 0);
      item.check("every edge explains itself", true, graph.edges.every((edge) => edge.reason.length > 0));
      item.check("no cycle was detected", 0, findRequirementCycle(graph.nodes).length);
      item.check("no cycle diagnostic was recorded", 0, graph.diagnostics.filter((line) => line.includes("cycle")).length);
      item.check("depends_on and blocks stay consistent", true, graph.edges.every((edge) => {
        const from = graph.nodes.find((node) => node.id === edge.from);
        const to = graph.nodes.find((node) => node.id === edge.to);
        return Boolean(from?.depends_on.includes(edge.to)) && Boolean(to?.blocks.includes(edge.from));
      }));
      const order = topologicalRequirementOrder(graph);
      item.check("the topological order covers every node", graph.nodes.length, order.length);
      const position = new Map(order.map((id, index) => [id, index]));
      item.check("dependencies come first", true, graph.edges.filter((edge) => edge.kind !== "DERIVES").every((edge) => position.get(edge.from)! > position.get(edge.to)!));
      item.check("ready requirements are the ones without open dependencies", true, readyRequirements(graph).every((node) => node.depends_on.every((id) => ["VERIFIED", "IMPLEMENTED"].includes(graph.nodes.find((entry) => entry.id === id)?.state ?? "VERIFIED"))));
      item.cite("RequirementsGraph.edges[].reason");
    });
  });

  it("R-03 conflicting requirements are quarantined, the rest stay executable", async () => {
    await scenario("R-03", "§28.3 a requirement inside a conflicting section starts QUARANTINED", (item) => {
      const graph = main.graph!;
      const quarantined = graph.nodes.filter((node) => node.state === "QUARANTINED");
      item.check("the conflicting requirement is quarantined", true, quarantined.length > 0);
      item.check("the quarantine reason is recorded", true, quarantined.every((node) => node.state_reason.length > 0));
      item.check("the quarantined item is the contradictory constraint", true, quarantined.some((node) => /one hundred milliseconds|five seconds/.test(node.text)));
      item.check("non-conflicting requirements stay executable", true, graph.nodes.some((node) => node.state === "UNSTARTED"));
      item.check("the goal is not quarantined", "UNSTARTED", graph.nodes.find((node) => node.type === "GOAL")?.state);
      item.cite("IsolationView → RequirementsGraph QUARANTINED nodes");
    });
  });

  it("R-04 the state machine refuses illegal transitions", async () => {
    await scenario("R-04", "§28.3 UNSTARTED → READY → RUNNING → IMPLEMENTED → VERIFIED, and nothing else", (item) => {
      const graph = structuredClone(main.graph!);
      const id = graph.nodes.find((node) => node.type === "DELIVERABLE")!.id;
      item.check("a jump to VERIFIED is refused", false, transitionRequirement(graph, id, "VERIFIED", "claim").ok);
      item.check("a jump to RUNNING is refused", false, transitionRequirement(graph, id, "RUNNING", "skip").ok);
      item.check("READY is allowed", true, transitionRequirement(graph, id, "READY", "dependencies satisfied").ok);
      item.check("RUNNING is allowed next", true, transitionRequirement(graph, id, "RUNNING", "worker started").ok);
      item.check("IMPLEMENTED is allowed next", true, transitionRequirement(graph, id, "IMPLEMENTED", "files changed").ok);
      item.check("VERIFIED is allowed next", true, transitionRequirement(graph, id, "VERIFIED", "tests passed").ok);
      item.check("VERIFIED cannot go back to READY", false, transitionRequirement(graph, id, "READY", "regression").ok);
      item.check("VERIFIED can re-open as RUNNING", true, transitionRequirement(graph, id, "RUNNING", "regression found").ok);
      item.check("SUPERSEDED is terminal", 0, REQUIREMENT_TRANSITIONS.SUPERSEDED.length);
      item.cite("REQUIREMENT_TRANSITIONS table");
    });
  });

  it("R-05 acceptance binding needs implementation + test + review evidence", async () => {
    await scenario("R-05", "§28.4 Requirement → implementation/test/review evidence", (item) => {
      const graph = structuredClone(main.graph!);
      const acceptance = graph.nodes.find((node) => node.type === "ACCEPTANCE" && !node.visual)!;
      const required = requiredEvidenceKinds(acceptance);
      item.check("an acceptance criterion needs three kinds", "IMPLEMENTATION,TEST,REVIEW", required.join(","));
      const partial = bindAcceptance({ graph, evidence: [
        evidence(acceptance.id, "IMPLEMENTATION", "PASS"), evidence(acceptance.id, "TEST", "PASS")
      ] });
      const binding = partial.bindings.find((entry) => entry.requirement_id === acceptance.id)!;
      item.check("two of three kinds leaves it unverified", false, binding.verified);
      item.check("the missing kind is named", "REVIEW", binding.missing.join(","));
      const complete = bindAcceptance({ graph, evidence: [
        evidence(acceptance.id, "IMPLEMENTATION", "PASS"), evidence(acceptance.id, "TEST", "PASS"), evidence(acceptance.id, "REVIEW", "PASS")
      ] });
      const verified = complete.bindings.find((entry) => entry.requirement_id === acceptance.id)!;
      item.check("all three kinds verify it", true, verified.verified);
      item.check("the state advanced to VERIFIED", "VERIFIED", graph.nodes.find((node) => node.id === acceptance.id)?.state);
      item.cite("AcceptanceBindingReport.bindings[].missing");
    });
  });

  it("R-06 a visual requirement demands the visual branch", async () => {
    await scenario("R-06", "§28.4 VISUAL → preview → screenshot → visual verification", (item) => {
      const graph = theme.graph!;
      const visual = graph.nodes.find((node) => node.visual || node.type === "VISUAL")!;
      item.check("the theme work book produced a visual requirement", true, visual !== undefined);
      item.check("the required kinds are the visual branch", "IMPLEMENTATION,PREVIEW,SCREENSHOT,VISUAL_VERIFICATION", requiredEvidenceKinds(visual).join(","));
      const report = bindAcceptance({ graph, evidence: [
        evidence(visual.id, "IMPLEMENTATION", "PASS"), evidence(visual.id, "PREVIEW", "PASS"), evidence(visual.id, "SCREENSHOT", "PASS")
      ], apply: false });
      const binding = report.bindings.find((entry) => entry.requirement_id === visual.id)!;
      item.check("without visual verification it is not verified", false, binding.verified);
      item.check("the missing kind is the visual verification", "VISUAL_VERIFICATION", binding.missing.join(","));
      item.check("the visual requirement is listed in the report", true, report.visual.includes(visual.id));
      item.cite("AcceptanceBindingReport.visual");
    });
  });

  it("R-07 a completion claim is not evidence", async () => {
    await scenario("R-07", "§2.3 MODEL_DONE != COMPLETED: unevidenced requirements stay open", (item) => {
      const graph = structuredClone(main.graph!);
      const deliverable = graph.nodes.find((node) => node.type === "DELIVERABLE")!;
      const claimed = bindAcceptance({ graph, evidence: [
        evidence(deliverable.id, "IMPLEMENTATION", "PASS"), evidence(deliverable.id, "TEST", "FAIL")
      ] });
      const binding = claimed.bindings.find((entry) => entry.requirement_id === deliverable.id)!;
      item.check("a failing test keeps it unverified", false, binding.verified);
      item.check("the failure is recorded", "TEST", binding.failed.join(","));
      item.check("implementation alone reports IMPLEMENTED", "IMPLEMENTED", graph.nodes.find((node) => node.id === deliverable.id)?.state);
      const nothing = bindAcceptance({ graph, evidence: [], apply: false });
      item.check("no evidence verifies nothing", 0, nothing.totals.verified);
      item.check("every requirement is listed as unverified", graph.nodes.length, nothing.unverified.length);
      const full = bindAcceptance({ graph, evidence: evidenceTemplate(graph).flatMap((entry) => entry.required.map((kind) => evidence(entry.requirement_id, kind, "PASS"))) });
      const quarantined = graph.nodes.filter((node) => node.state === "QUARANTINED").length;
      item.check("complete evidence verifies every non-quarantined requirement", graph.nodes.length - quarantined, full.totals.verified);
      item.check("the quarantined requirements are the only ones left open", quarantined, full.totals.unverified);
      item.check("the open ones are the quarantined ones", true, full.unverified.every((id) => graph.nodes.find((node) => node.id === id)?.state === "QUARANTINED"));
      item.cite("AcceptanceBindingReport.totals");
    });
  });

  it("R-08 the report is machine-readable and durable", async () => {
    await scenario("R-08", "the acceptance binding report is emitted as evidence", (item) => {
      const graph = main.graph!;
      const evidenceEntries = evidenceTemplate(graph).flatMap((entry) => entry.required.map((kind) => evidence(entry.requirement_id, kind, "PASS")));
      const report = bindAcceptance({ graph, evidence: evidenceEntries });
      item.check("the report is versioned", "requirements-graph-1", report.version);
      item.check("every requirement has a binding", graph.nodes.length, report.bindings.length);
      item.check("every binding explains itself", true, report.bindings.every((entry) => entry.reason.length > 0));
      item.check("the evidence ledger names its source", true, evidenceEntries.every((entry) => entry.source.length > 0));
      item.check("totals agree with the bindings", report.bindings.filter((entry) => entry.state === "VERIFIED").length, report.totals.verified);
      item.cite("artifacts/acceptance/requirements-graph.json");
    });
  });
});

function evidence(requirementId: string, kind: string, status: "PASS" | "FAIL" | "NOT_RUN"): RequirementEvidence {
  return {
    id: `ev-${requirementId}-${kind}-${status}`,
    requirement_id: requirementId,
    kind: kind as RequirementEvidence["kind"],
    status,
    source: "host:acceptance",
    detail: `${kind} ${status.toLowerCase()}`,
    captured_at: "2026-01-01T00:00:00.000Z",
    command: "pnpm test"
  };
}

afterAll(() => {
  const graph = main.graph;
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_6_REQUIREMENTS_GRAPH",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    graph: graph ? {
      taskId: graph.task_id, nodes: graph.nodes.length, edges: graph.edges.length,
      counts: graph.counts, states: graph.states, visual: graph.visual_requirements.length,
      diagnostics: graph.diagnostics
    } : undefined,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "requirements-graph.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "requirements-graph.md"), [
    "# checkpoint-1 §28 requirements graph acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Graph: ${graph?.nodes.length ?? 0} nodes, ${graph?.edges.length ?? 0} edges, types ${JSON.stringify(graph?.counts ?? {})}`,
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
