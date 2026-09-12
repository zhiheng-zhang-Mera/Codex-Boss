/**
 * checkpoint-1 §5 DoD — "same project second task".
 *
 * The plan's Phase 1 acceptance is explicit:
 *
 *   「至少证明：same project second task 可以自动复用第一次任务产生的
 *     architecture / constraints / test knowledge / prior decisions /
 *     UI surface knowledge，而无需重新扫描全部上下文」
 *
 * This suite drives the REAL production surface twice: `runWorkDispatch` with
 * the real store, registry, ingestion pipeline, classifier, Task Contract
 * compiler, Guardian screening and repository discovery — only the
 * provider-driving layers are 1:1 surface doubles, exactly as in the WB-01..WB-10
 * harness. The second task then asks the Knowledge Foundation for its bounded
 * knowledge section and the facts of the first task must come back.
 *
 * The reuse claim is proven the hard way: the project directory is DELETED
 * before the second task's retrieval, so nothing can be re-scanned or re-read
 * from the filesystem, and the retrieval reports `repositoryReads === 0`.
 *
 * Nothing here uses a model: every fact is host-derived and provenance-carrying.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { KnowledgeBase } from "../../electron/knowledge/knowledge-base";
import { KnowledgeFoundation } from "../../electron/knowledge/knowledge-foundation";
import { runWorkDispatch, type WorkDispatchTaskInput } from "../../electron/commander/workbook-production";
import { WorkbookRegistry } from "../../electron/ingestion/workbook-registry";
import { StateStore } from "../../electron/store";
import type { InputObjectRef } from "../../src/shared/input-object";
import type { KnowledgeObject, KnowledgeCandidate } from "../../src/shared/knowledge-object";
import type { ProviderId } from "../../src/shared/contracts";

/* ------------------------------------------------------------------ *
 * Fixtures: a small but real project directory
 * ------------------------------------------------------------------ */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "kb-reuse-"));
const WORKSPACE = path.join(ROOT, "project");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const KNOWLEDGE_FILE = path.join(ROOT, ".boss", "knowledge-base.json");

const WORKBOOK_A = [
  "# Latency guard work book",
  "",
  "## Goal",
  "Add a per-request latency guard to the checkout handler so slow gateway calls fail fast.",
  "",
  "## Scope",
  "- checkout request handler",
  "",
  "## Deliverables",
  "- latency guard module",
  "",
  "## Constraints",
  "- the guard must not add more than 100 ms of overhead",
  "",
  "## Acceptance Criteria",
  "- [ ] AC-1 the guard aborts a gateway call that exceeds its budget"
].join("\n");

const WORKBOOK_B = [
  "# Latency guard follow-up work book",
  "",
  "## Goal",
  "Report the latency guard's aborted calls in the checkout response.",
  "",
  "## Scope",
  "- checkout response payload",
  "",
  "## Deliverables",
  "- aborted-call reporting",
  "",
  "## Acceptance Criteria",
  "- [ ] AC-2 the response lists every aborted gateway call"
].join("\n");

function prepareProject(): void {
  for (const directory of ["src/renderer", "src/gateway", "tests", "electron"]) {
    fs.mkdirSync(path.join(WORKSPACE, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(WORKSPACE, "package.json"), JSON.stringify({ name: "latency-guard-fixture", private: true, scripts: { test: "vitest run" } }, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "index.html"), "<!doctype html><div id=root></div>\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "electron", "main.ts"), "export const main = true;\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "src", "checkout.js"), "'use strict';\nasync function checkout(gateway) { return gateway.charge({ amount: 100 }); }\nmodule.exports = { checkout };\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "src", "gateway", "adapter.js"), "'use strict';\nmodule.exports = { charge: async () => ({ ok: true }) };\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "src", "renderer", "main.tsx"), "export const App = () => null;\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "src", "renderer", "styles.css"), ".checkout { color: #fff; }\n", "utf8");
  fs.writeFileSync(path.join(WORKSPACE, "tests", "checkout.test.js"), "'use strict';\nconst assert = require('node:assert');\nassert.ok(true);\n", "utf8");
}

/* ------------------------------------------------------------------ *
 * Report model (fail-closed, same shape as the WB acceptance report)
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
 * Production environment (real store/registry/ingestion; provider doubles)
 * ------------------------------------------------------------------ */

interface Environment {
  store: StateStore;
  registry: WorkbookRegistry;
  foundation: KnowledgeFoundation;
  conversationId: string;
  calls: string[];
  file: (name: string, content: string) => InputObjectRef;
  run: (refs: InputObjectRef[]) => Promise<Awaited<ReturnType<typeof runWorkDispatch>>>;
}

let fileSequence = 0;

function environment(foundation: KnowledgeFoundation): Environment {
  const store = new StateStore(path.join(ROOT, "state.json"));
  const registry = new WorkbookRegistry(path.join(ROOT, "registry.json"));
  const conversation = store.createConversation("folder-general", "knowledge reuse");
  const calls: string[] = [];
  const commander = {
    createTask(input: WorkDispatchTaskInput) {
      calls.push("createTask");
      return store.createTask(input.title, input.objective, input.providerIds, "direct", "work", {}, input.conversationId ?? conversation.id);
    },
    startTask(taskId: string) { calls.push("startTask"); store.setTaskStatus(taskId, "running"); },
    async executeDeterministic(): Promise<boolean> { calls.push("executeDeterministic"); return false; },
    async executePlan(taskId: string): Promise<boolean> {
      calls.push("executePlan");
      const run = store.snapshot().runs.find((item) => item.taskId === taskId);
      if (run) store.updateRun(run.id, "sending", null, "sent");
      return true;
    }
  };
  const automation = {
    async dispatchTask(taskId: string) {
      calls.push("automation.dispatchTask");
      const run = store.snapshot().runs.find((item) => item.taskId === taskId);
      if (run) store.updateRun(run.id, "sending", null, "sent");
    },
    continueIfReady() { calls.push("continueIfReady"); }
  };
  const file = (name: string, content: string): InputObjectRef => {
    fileSequence += 1;
    const target = path.join(ROOT, `${fileSequence}-${name}`);
    fs.writeFileSync(target, content, "utf8");
    const bytes = Buffer.from(content, "utf8");
    return {
      id: `att-${fileSequence}`,
      source: "UPLOAD",
      kind: "TEXT",
      conversationId: conversation.id,
      originalName: name,
      mime: "text/markdown",
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      localPath: target
    };
  };
  return {
    store,
    registry,
    foundation,
    conversationId: conversation.id,
    calls,
    file,
    run: (refs) => runWorkDispatch({
      prompt: "",
      title: "",
      conversationId: conversation.id,
      providerIds: ["chatgpt"] as ProviderId[],
      attachments: refs,
      workspacePath: WORKSPACE,
      mode: "direct",
      appMode: "work",
      registry
    }, { store, commander, automation, knowledge: foundation })
  };
}

function textOf(object: KnowledgeObject): string {
  return `${object.id} ${object.type} ${object.subject}\n${object.summary}\n${object.content}`;
}

/* ------------------------------------------------------------------ *
 * The scenario: task 1 writes, task 2 reuses with the project deleted
 * ------------------------------------------------------------------ */

describe("checkpoint-1 §5 DoD — same-project knowledge reuse", () => {
  prepareProject();
  const foundation = new KnowledgeFoundation(new KnowledgeBase(KNOWLEDGE_FILE), () => new Date().toISOString());
  const scope = foundation.projectScopeFor({ workspacePath: WORKSPACE });
  const env = environment(foundation);
  let taskOneId = "";
  let taskTwoId = "";
  let section: ReturnType<KnowledgeFoundation["sectionForTask"]> | undefined;

  it("K-01 task one produces provenance-carrying knowledge for the project", async () => {
    await scenario("K-01", "first WorkBook task records architecture, tests, UI surface, constraints, requirements and the dispatch decision", async (item) => {
      const outcome = await env.run([env.file("latency-guard.md", WORKBOOK_A)]);
      taskOneId = (outcome as { taskId: string }).taskId;

      // The facts must have been recorded by the PRODUCTION path
      // (runWorkDispatch -> knowledge hook), not by this test calling the facade.
      const logged = foundation.gateLog().filter((entry) => entry.task_ref === taskOneId);
      const active = foundation.active(scope).filter((object) => object.provenance.task_ref === taskOneId);
      const types = [...new Set(active.map((object) => object.type))].sort();

      item.check("the dispatch reached the provider boundary", "DISPATCHED", outcome.kind);
      item.check("the production dispatch recorded knowledge by itself", true, logged.length > 0);
      item.check("the production dispatch recorded matching facts", logged.length, active.length);
      item.check("nothing recorded for this task was refused", 0, logged.filter((entry) => entry.outcome === "REJECT" || entry.outcome === "QUARANTINE").length);
      item.check("architecture knowledge exists", true, types.includes("ARCHITECTURE"));
      item.check("test knowledge exists", true, types.includes("TEST"));
      item.check("UI surface knowledge exists", true, types.includes("UI_SURFACE"));
      item.check("constraint knowledge exists", true, types.includes("CONSTRAINT"));
      item.check("requirement knowledge exists", true, types.includes("REQUIREMENT"));
      item.check("a prior decision was recorded", true, types.includes("DECISION"));
      item.check("every object carries a sha256 source hash", true, active.every((object) => /^[0-9a-f]{64}$/.test(object.provenance.source_hash)));
      item.check("every object names a task and a timestamp", true, active.every((object) => Boolean(object.provenance.task_ref) && Number.isFinite(Date.parse(object.provenance.captured_at))));
      item.check("every object names its producer", true, active.every((object) => object.provenance.produced_by.length > 0));
      item.check("every object is host-verified", true, active.every((object) => object.provenance.verification === "VERIFIED" && object.provenance.verification_evidence.length > 0));
      item.check("the architecture fact describes the real project", true, active.filter((object) => object.type === "ARCHITECTURE").some((object) => object.content.includes("src") && object.content.includes("tests")));
      item.check("the decision fact names the dispatch outcome", true, active.filter((object) => object.type === "DECISION").some((object) => object.content.includes("DISPATCHED")));
      item.cite("artifacts/acceptance/knowledge-foundation.json");
      item.cite(`${KNOWLEDGE_FILE} (objects + gate_log)`);
    });
  });

  it("K-02 the second task reuses the first task's facts with the project deleted", async () => {
    await scenario("K-02", "second task in the same project reuses architecture/test/decision/UI knowledge without any repository read", async (item) => {
      if (!taskOneId) { item.fail("K-01 must run first: no first task is recorded"); return; }
      const before = foundation.summary();
      // A real second task in the same project, with its own WorkBook.
      const second = await env.run([env.file("latency-reporting.md", WORKBOOK_B)]);
      taskTwoId = (second as { taskId: string }).taskId;
      item.check("the second task is a distinct task", true, taskTwoId !== taskOneId);
      item.check("the second task also recorded its own knowledge", true, foundation.active(scope).some((object) => object.provenance.task_ref === taskTwoId));

      // Delete the project: no rescan and no file read can produce these facts.
      fs.rmSync(WORKSPACE, { recursive: true, force: true });
      item.check("the project directory is gone", false, fs.existsSync(WORKSPACE));

      section = foundation.sectionForTask({
        taskId: taskTwoId,
        goal: "implement the latency guard module and its tests against the existing repository layout",
        scope,
        characterBudget: 3000,
        maxObjects: 8,
        excludeTaskRef: taskTwoId
      });
      const reusedTaskRefs = [...new Set(section.retrieval.selected.map((object) => object.provenance.task_ref))];

      item.check("retrieval performed zero repository reads", 0, section.repositoryReads);
      item.check("a knowledge section was produced", true, section.text.includes("REUSED_PROJECT_KNOWLEDGE"));
      item.check("the reused facts include the architecture of the project", true, section.text.includes("Repository layout"));
      item.check("the reused facts include the test layout", true, section.text.includes("Test layout"));
      item.check("the reused facts include the UI surface", true, section.text.includes("UI surface"));
      item.check("the reused facts include the constraint from the first work book", true, section.text.includes("100 ms"));
      item.check("the reused facts include the first task's dispatch decision", true, section.text.includes("EXECUTABLE_WORKBOOK"));
      item.check("every reused fact carries its provenance", true, (section.text.match(/source: /g) ?? []).length === section.retrieval.selected.length);
      item.check("the reused facts come from the FIRST task, not the second", taskOneId, reusedTaskRefs.join(","));
      item.check("the second task's own facts are not cited back to it", false, reusedTaskRefs.includes(taskTwoId));
      item.check("the section is bounded by the budget", true, section.text.length <= 3000 + 400);
      item.check("the base was not dumped wholesale", true, section.retrieval.selected.length < before.active + 4);
      item.check("the ranking explains every drop", true, section.retrieval.ranking.every((step) => step.reason.length > 0));
      item.check("nothing was dropped for lack of a budget", false, section.retrieval.truncated);
      item.cite("artifacts/acceptance/knowledge-foundation.json retrievals[]");
      item.cite("KnowledgeFoundation.sectionForTask repositoryReads=0");
    });
  });

  it("K-03 a model claim cannot overwrite the verified fact", async () => {
    await scenario("K-03", "the write gate quarantines a self-certified model claim and leaves the active fact byte-identical", (item) => {
      const architecture = foundation.active(scope).find((object) => object.type === "ARCHITECTURE");
      item.check("an active architecture fact exists", true, architecture !== undefined);
      const before = architecture ? textOf(architecture) : "";
      const claim: KnowledgeCandidate = {
        type: "ARCHITECTURE",
        scope,
        subject: architecture?.subject ?? "repository layout",
        source: "provider:chatgpt",
        source_hash: "c".repeat(64),
        content: "the repository is actually a Python monorepo with no tests",
        summary: "model claim about the repository layout",
        captured_at: new Date().toISOString(),
        producer: "MODEL",
        produced_by: "provider:chatgpt",
        verification: "UNVERIFIED",
        verification_evidence: [],
        confidence: 0.4,
        authority: "MODEL",
        freshness: new Date().toISOString(),
        task_ref: "task-2"
      };
      const commit = foundation.base.commit(claim);
      const after = foundation.active(scope).find((object) => object.type === "ARCHITECTURE");
      item.check("the model claim was not accepted", true, commit.outcome !== "ACCEPT" && commit.outcome !== "SUPERSEDE");
      item.check("the model claim was parked, not dropped", "QUARANTINE", commit.outcome);
      item.check("the verified fact is unchanged", before, after ? textOf(after) : "");
      item.check("the refused claim is visible to an owner", true, foundation.base.quarantine().length > 0);
      item.check("the refusal carries its phase reasons", true, (commit.reasons.join(" ").length > 0));
      item.cite("knowledge-base.json quarantine[] + gate_log[]");
    });
  });

  it("K-04 a restart keeps the knowledge and the reuse still works", async () => {
    await scenario("K-04", "a fresh process reads the same durable base and still serves the project's knowledge", (item) => {
      const reloaded = new KnowledgeFoundation(new KnowledgeBase(KNOWLEDGE_FILE), () => new Date().toISOString());
      const summary = reloaded.summary();
      item.check("the base was reloaded without error", undefined, reloaded.base.loadFailure());
      item.check("active knowledge survived the restart", true, summary.active > 0);
      item.check("the quarantine survived the restart", true, summary.quarantined > 0);
      const section = reloaded.sectionForTask({
        taskId: "task-3",
        goal: "implement the latency guard module and its tests against the existing repository layout",
        scope,
        characterBudget: 3000,
        maxObjects: 8
      });
      item.check("reuse still works after the restart", true, section.text.includes("REUSED_PROJECT_KNOWLEDGE"));
      item.check("and still performs zero repository reads", 0, section.repositoryReads);
      item.cite("knowledge-base.json reload");
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_2_KNOWLEDGE_FOUNDATION",
    generatedAt: new Date().toISOString(),
    providerExecution: "IN_PROCESS_SURFACE_DOUBLES",
    externalLiveProviderExecution: "NOT_RUN",
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "knowledge-foundation.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "knowledge-foundation.md"), [
    "# checkpoint-1 §5 Knowledge Foundation acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    `Provider execution: ${report.providerExecution}`,
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
