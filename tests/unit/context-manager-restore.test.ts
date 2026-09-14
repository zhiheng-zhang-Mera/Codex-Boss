import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContextManager, type TaskContext } from "../../electron/commander/context-manager";

/**
 * Phase H — a context file that cannot be read is not a workspace with no context.
 *
 * The policy this module already had is right and is preserved: a corrupt optional
 * context never replaces canonical task state, and it never throws into boot. What
 * it did was swallow the failure completely, so "there is no context file" and
 * "the context file could not be read" were the same answer — and a run whose
 * capsules are missing facts that are sitting on disk looked exactly like a first
 * run.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-context-restore-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function contextFor(taskId: string): TaskContext {
  return {
    taskId,
    objective: "ship the gateway",
    constraints: [],
    currentProtocol: "protocol-1",
    currentRound: "round-1",
    resolvedClaims: [],
    openDisputes: [],
    artifactRefs: [],
    summaries: [],
    executionHistory: []
  };
}

describe("Phase H — context restore", () => {
  it("restores what a previous process saved, and reports no failure", () => {
    const file = path.join(makeTree(), "task-contexts.json");
    const first = new ContextManager(file);
    expect(first.restoreDiagnostic()).toBeUndefined();
    first.save(contextFor("t1"));
    const second = new ContextManager(file);
    expect(second.get("t1")?.objective).toBe("ship the gateway");
    expect(second.restoreDiagnostic()).toBeUndefined();
  });

  it("distinguishes 'no file yet' from 'the file could not be read'", () => {
    const empty = path.join(makeTree(), "task-contexts.json");
    const fresh = new ContextManager(empty);
    expect(fs.existsSync(empty)).toBe(false);
    expect(fresh.restoreDiagnostic()).toBeUndefined();

    const corruptFile = path.join(makeTree(), "task-contexts.json");
    fs.writeFileSync(corruptFile, "{ this is not json", "utf8");
    const corrupt = new ContextManager(corruptFile);
    const diagnostic = corrupt.restoreDiagnostic();
    expect(diagnostic?.file).toBe(corruptFile);
    expect(diagnostic?.reason).toBeTruthy();
  });

  it("keeps the fail-safe direction: corrupt context never replaces canonical state", () => {
    const file = path.join(makeTree(), "task-contexts.json");
    const first = new ContextManager(file);
    first.save(contextFor("t1"));
    fs.writeFileSync(file, "{ truncated", "utf8");
    const second = new ContextManager(file);
    // Nothing is invented and nothing is thrown; the reason is what changes.
    expect(second.get("t1")).toBeUndefined();
    expect(second.restoreDiagnostic()?.reason).toBeTruthy();
  });

  it("does not treat a file written by another schema as usable context", () => {
    const file = path.join(makeTree(), "task-contexts.json");
    fs.writeFileSync(file, JSON.stringify({ schema_id: "something-else", schema_version: 1, created_by: "x", migration_history: [], data: [contextFor("t1")] }), "utf8");
    const manager = new ContextManager(file);
    expect(manager.get("t1")).toBeUndefined();
    expect(manager.restoreDiagnostic()?.reason).toBeTruthy();
  });
});
