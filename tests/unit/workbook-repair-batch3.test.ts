/**
 * REPAIR_BATCH_3 focused tests (3 cases, one per production fix).
 *
 * Each one exercises the real boundary rather than a stand-in: the actual
 * group-size guard, the real StateStore, and the real WorkbookRegistry.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DISPATCH_GROUP_ERROR, assertDispatchGroupSize } from "../../electron/commander/provider-dispatch-guard";
import { runWorkBookDispatch } from "../../electron/commander/workbook-dispatch";
import { WorkbookRegistry } from "../../electron/ingestion/workbook-registry";
import { StateStore } from "../../electron/store";
import { compileIntent } from "../../src/shared/task-ir";
import type { InputObjectRef } from "../../src/shared/input-object";

const conversationId = "conv-repair3";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wb-repair3-"));

const EXECUTABLE = [
  "# Installment Workbook",
  "",
  "## Goal",
  "Let users choose installments at checkout.",
  "",
  "## Scope",
  "- checkout UI",
  "",
  "## Deliverables",
  "- installment selector",
  "",
  "## Acceptance Criteria",
  "- [ ] FR-1 selector visible"
].join("\n");

let fileCounter = 0;

function attachmentOnDisk(fileName: string, text: string): InputObjectRef {
  fileCounter += 1;
  const file = path.join(root, `input-${fileCounter}-${fileName}`);
  fs.writeFileSync(file, text, "utf8");
  return {
    id: `att-${fileCounter}`,
    source: "UPLOAD",
    kind: "TEXT",
    conversationId,
    originalName: fileName,
    mime: "text/markdown",
    size: Buffer.byteLength(text),
    localPath: file
  };
}

function newStore(name: string): StateStore {
  return new StateStore(path.join(root, `${name}-state.json`));
}

describe("REPAIR_BATCH_3", () => {
  it("validates dispatch group size without compileIntent when the prompt is blank", () => {
    // Root cause, asserted directly: compileIntent rejects an empty objective,
    // which is exactly what an attachment-only dispatch used to hit.
    expect(() => compileIntent("")).toThrow();
    expect(assertDispatchGroupSize("", "", 1)).toBeUndefined();

    // The reported defect: an attachment-only dispatch blew up because
    // compileIntent("") rejects the empty objective.
    expect(() => assertDispatchGroupSize("", "", 1)).not.toThrow();
    expect(() => assertDispatchGroupSize("", "", 5)).not.toThrow();

    // Out-of-range counts still throw, with or without a prompt, because there
    // is no intent text to infer a trivially simple task from.
    expect(() => assertDispatchGroupSize("", "", 0)).toThrow(DISPATCH_GROUP_ERROR);
    expect(() => assertDispatchGroupSize("", "", 6)).toThrow(DISPATCH_GROUP_ERROR);
    expect(() => assertDispatchGroupSize("refactor the parser", "", 6)).toThrow(DISPATCH_GROUP_ERROR);

    // A compiled WorkBook objective is the authoritative intent for an
    // attachment-only request, so it participates in the check.
    expect(() => assertDispatchGroupSize("", "Let users choose installments at checkout.", 6)).toThrow(DISPATCH_GROUP_ERROR);
    expect(() => assertDispatchGroupSize("", "", 1)).not.toThrow();
  });

  it("completes an analysis-only WorkBook task without weakening evidence-gated completion", async () => {
    const store = newStore("analysis");
    const ref = attachmentOnDisk("spec.md", EXECUTABLE);
    const outcome = await runWorkBookDispatch(
      { prompt: "请分析这份需求文档，只做分析，不要修改任何文件", conversationId, attachments: [ref], workspacePath: root },
      {}
    );
    expect(outcome.analysisOnly).toBe(true);
    expect(outcome.record.contract).toBeDefined();

    const task = store.createTask("analysis", "analyse the workbook", ["chatgpt"], "direct", "work");
    store.setWorkbookDispatch(task.id, outcome.record);

    // The real narrow path: analysis_only + compiled contract.
    store.completeWorkbookAnalysis(task.id);
    const completed = store.snapshot().tasks.find((item) => item.id === task.id)!;
    expect(completed.status).toBe("completed");
    expect(completed.executionPhase).toBe("COMPLETED");
    expect(completed.nextAction).toBe("REPORT_EVIDENCE");
    expect(store.runsForTask(task.id)).toEqual([]);
    const stages = completed.workbookDispatch!.stageHistory.map((entry) => entry.stage);
    expect(stages[stages.length - 1]).toBe("COMPLETED");
    expect(stages.filter((stage) => stage === "COMPLETED")).toHaveLength(1);
    // The intake ladder is preserved, not rewritten.
    expect(stages.slice(0, 3)).toEqual(["INPUT_RECEIVED", "INGESTING", "CLASSIFYING"]);

    // The normal, evidence-gated path is untouched: no provider run means no
    // completion, even for a record that exists.
    const plain = store.createTask("plain", "do the work", ["chatgpt"], "direct", "work");
    store.setWorkbookDispatch(plain.id, outcome.record);
    expect(() => store.setTaskStatus(plain.id, "completed")).toThrow(/Completion requires persisted passing evidence/);

    // And the narrow path refuses a record that is not analysis-only, or one
    // without a compiled contract.
    const executable = await runWorkBookDispatch(
      { prompt: "", conversationId, attachments: [attachmentOnDisk("exec.md", EXECUTABLE)], workspacePath: root },
      {}
    );
    expect(executable.record.analysis_only).toBe(false);
    const gated = store.createTask("gated", "run it", ["chatgpt"], "direct", "work");
    store.setWorkbookDispatch(gated.id, executable.record);
    expect(() => store.completeWorkbookAnalysis(gated.id)).toThrow(/Completion requires persisted passing evidence/);
    expect(store.snapshot().tasks.find((item) => item.id === gated.id)!.status).not.toBe("completed");

    const noContract = store.createTask("nocontract", "x", ["chatgpt"], "direct", "work");
    store.setWorkbookDispatch(noContract.id, { ...outcome.record, contract: undefined });
    expect(() => store.completeWorkbookAnalysis(noContract.id)).toThrow(/Completion requires persisted passing evidence/);

    const noRecord = store.createTask("norecord", "y", ["chatgpt"], "direct", "work");
    expect(() => store.completeWorkbookAnalysis(noRecord.id)).toThrow(/Completion requires persisted passing evidence/);
  });

  it("discards only provider placeholders that never started", () => {
    const store = newStore("not-run-truth");
    const untouched = store.createTask("blocked", "unsafe request", ["chatgpt"], "direct", "work");
    expect(store.runsForTask(untouched.id)).toHaveLength(1);
    store.discardUnstartedRuns(untouched.id);
    expect(store.runsForTask(untouched.id)).toEqual([]);

    const started = store.createTask("started", "real work", ["chatgpt"], "direct", "work");
    const run = store.runsForTask(started.id)[0];
    store.updateRun(run.id, "opening", null, "provider page opening");
    expect(() => store.discardUnstartedRuns(started.id)).toThrow(/after execution has started/);
    expect(store.runsForTask(started.id)).toHaveLength(1);
  });

  it("parks reference work across restart and prepares runs only when explicitly started", () => {
    const file = path.join(root, "reference-parked-state.json");
    const store = new StateStore(file);
    const task = store.createTask("reference", "Review attached reference input", ["chatgpt"], "direct", "work");
    store.discardUnstartedRuns(task.id);
    expect(store.runsForTask(task.id)).toEqual([]);

    const reloaded = new StateStore(file);
    expect(reloaded.snapshot().tasks.find((item) => item.id === task.id)?.status).toBe("queued");
    expect(reloaded.runsForTask(task.id)).toEqual([]);
    reloaded.ensureUnstartedRuns(task.id);
    expect(reloaded.runsForTask(task.id)).toHaveLength(1);
    expect(reloaded.runsForTask(task.id)[0].phase).toBe("queued");
  });

  it("links pre-creation registry revisions to the real task id, idempotently", async () => {
    const registry = new WorkbookRegistry(path.join(root, "registry-link.json"));
    const ref = attachmentOnDisk("spec.md", EXECUTABLE);

    // Intake records revisions before the task exists, so task_id is unset.
    const outcome = await runWorkBookDispatch(
      { prompt: "", conversationId, attachments: [ref], workspacePath: root },
      { registry }
    );
    const before = registry.list().flatMap((entry) => entry.revisions);
    expect(before).toHaveLength(1);
    expect(before[0].task_id).toBeUndefined();
    const hash = before[0].hash;

    // Linking binds the recorded revision to the created task.
    expect(registry.linkRevisionTask(hash, "task-linked")).toBe(true);
    expect(registry.list().flatMap((entry) => entry.revisions)[0].task_id).toBe("task-linked");

    // Idempotent: repeating the link neither duplicates nor rewrites.
    expect(registry.linkRevisionTask(hash, "task-linked")).toBe(true);
    const after = registry.list().flatMap((entry) => entry.revisions);
    expect(after).toHaveLength(1);
    expect(after[0].task_id).toBe("task-linked");

    // Durable across a reload, and a never-ingested hash is not invented.
    const reopened = new WorkbookRegistry(path.join(root, "registry-link.json"));
    expect(reopened.list().flatMap((entry) => entry.revisions)[0].task_id).toBe("task-linked");
    expect(reopened.linkRevisionTask("f".repeat(64), "task-linked")).toBe(false);
    expect(reopened.list().flatMap((entry) => entry.revisions)).toHaveLength(1);
  });
});
