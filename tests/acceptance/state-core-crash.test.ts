import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkIntegrity, openDatabase, stateDatabasePath, type DatabaseHandle } from "../../electron/state-core/database";
import { createStateRepository } from "../../electron/state-core/state-repository";
import { createEventJournal } from "../../electron/state-core/event-journal";
import { createEventConsumer } from "../../electron/state-core/event-consumer";
import { readSchemaState, appliedMigrations } from "../../electron/state-core/schema-version";

/**
 * Phase 02 acceptance gate 4 — a hard kill must not lose committed work, and must not
 * leave a half-applied state.
 *
 * Everything here kills a REAL child process (`scripts/state-core-crash-child.cjs`) rather
 * than simulating a crash in-process, because the claim is about durability: whether bytes
 * were on disk when the process died. A simulated crash would only prove that a function
 * returns, which is not the question.
 *
 * This suite is BUILD-DEPENDENT: the child loads the compiled modules under
 * `dist-electron/`, exactly as `scripts/r901-soak.cjs` and the other acceptance harnesses
 * do. It is therefore declared in `BUILD_DEPENDENT_TESTS` and runs in the postbuild tier,
 * after `pnpm run build`. Verified: with the compiled output present it spawns and passes;
 * it is not silently skipped when the build is missing, it fails to resolve and says so.
 */

const PROJECT = process.cwd();
const CHILD = path.join(PROJECT, "scripts", "state-core-crash-child.cjs");

const dirs: string[] = [];
const handles: DatabaseHandle[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-crash-"));
  dirs.push(dir);
  return dir;
}

function open(root: string): DatabaseHandle {
  const handle = openDatabase(stateDatabasePath(root));
  handles.push(handle);
  return handle;
}

/**
 * Run the child to completion (it exits by design) and return its structured output.
 *
 * A non-zero exit is NOT treated as a failure: `die-in-transaction` intentionally dies
 * without unwinding. Only an unparseable result is an error, because that would mean the
 * crash happened before the marker was written and the test would be asserting nothing.
 */
function runChild(mode: string, root: string, marker: string): Record<string, unknown> {
  let stdout = "";
  try {
    stdout = execFileSync(process.execPath, [CHILD, mode, root, marker], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    stdout = (error as { stdout?: string }).stdout ?? "";
  }
  const line = stdout.split("\n").map((entry) => entry.trim()).filter(Boolean).pop();
  if (!line) throw new Error(`the crash child produced no result for ${mode}`);
  return JSON.parse(line) as Record<string, unknown>;
}

/** Remove a data root, tolerating the brief handle release delay after a kill. */
function cleanup(dir: string): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { /* retry */ }
  }
}

afterEach(() => {
  for (const handle of handles.splice(0)) {
    try { handle.close(); } catch { /* already closed */ }
  }
  for (const dir of dirs.splice(0)) cleanup(dir);
});

describe("Phase 02 gate 4 — crash before/after commit", () => {
  it("keeps a COMMITTED state change and event when the process dies without closing", () => {
    const root = tempRoot();
    const marker = "commit-survives";
    const child = runChild("commit-then-crash", root, marker);
    expect(child.committed).toBe(true);
    expect(Number(child.sequence)).toBeGreaterThan(0);

    // No handle was closed in the child; the parent opens the same file and reads it.
    const handle = open(root);
    const repository = createStateRepository(handle);
    const journal = createEventJournal(handle);
    expect(repository.get("pilot.tasks", "task-1")?.value).toMatchObject({ status: "RUNNING", marker });
    const events = journal.read(0);
    expect(events).toHaveLength(1);
    expect(events[0].idempotencyKey).toBe(`task-1:created:${marker}`);
    expect(events[0].payload).toMatchObject({ marker });
    expect(checkIntegrity(handle).ok).toBe(true);
  });

  it("shows NO half-state when the process dies INSIDE a transaction", () => {
    const root = tempRoot();
    const marker = "uncommitted";
    const child = runChild("die-in-transaction", root, marker);
    expect(child.insideTransaction).toBe(true);

    const handle = open(root);
    const repository = createStateRepository(handle);
    const journal = createEventJournal(handle);
    // Neither half of the uncommitted transaction exists: not the state row, not the event.
    expect(repository.get("pilot.tasks", "ghost"), "an uncommitted state write must not survive").toBeUndefined();
    expect(repository.count("pilot.tasks")).toBe(0);
    expect(journal.stats().events, "an uncommitted event must not survive").toBe(0);
    expect(journal.hasIdempotencyKey("persistence", `ghost:${marker}`)).toBe(false);
    expect(checkIntegrity(handle).ok).toBe(true);
  });

  it("makes an uncommitted write invisible even before reopening, via rollback on open", () => {
    const root = tempRoot();
    // After a die-in-transaction the file may still hold an uncommitted frame; SQLite
    // discards it during WAL recovery at open. Opening twice must agree.
    runChild("die-in-transaction", root, "double-open");
    const first = open(root);
    const firstCount = createStateRepository(first).count("pilot.tasks");
    first.close();
    const second = open(root);
    expect(createStateRepository(second).count("pilot.tasks")).toBe(firstCount);
    expect(firstCount).toBe(0);
  });

  it("keeps EVERY commit from a multi-commit run and preserves their order", () => {
    const root = tempRoot();
    const marker = "multi";
    const child = runChild("multi-commit-crash", root, marker);
    expect(child.committed).toBe(true);
    const sequences = child.sequences as number[];
    expect(sequences).toHaveLength(3);
    // Strictly increasing: the journal's order IS the commit order.
    expect(sequences[0]).toBeLessThan(sequences[1]);
    expect(sequences[1]).toBeLessThan(sequences[2]);

    const handle = open(root);
    const journal = createEventJournal(handle);
    const events = journal.read(0);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.aggregateId)).toEqual(["task-0", "task-1", "task-2"]);
    expect(events.map((event) => event.sequence)).toEqual(sequences);
  });

  it("resumes a consumer at the cursor after a crash, delivering only what is new", async () => {
    const root = tempRoot();
    const marker = "resume";
    runChild("multi-commit-crash", root, marker);

    const handle = open(root);
    const journal = createEventJournal(handle);
    const consumer = createEventConsumer(handle, journal, "crash-resume");
    const seen: string[] = [];
    await consumer.deliver((event) => { seen.push(event.aggregateId); });
    expect(seen).toEqual(["task-0", "task-1", "task-2"]);
    const cursorAfterFirstRun = consumer.cursor().lastSequence;
    handle.close();

    // A second process appends one more committed event, then the original consumer
    // resumes: it must deliver ONLY the new one, which is "crash recovery from cursor".
    const reopened = open(root);
    const journal2 = createEventJournal(reopened);
    journal2.append({ type: "TASK_CREATED", aggregateId: "task-3", payload: {}, producer: "persistence", idempotencyKey: "task-3:created" });
    const consumer2 = createEventConsumer(reopened, journal2, "crash-resume");
    expect(consumer2.cursor().lastSequence, "the cursor survived the restart").toBe(cursorAfterFirstRun);
    const secondSeen: string[] = [];
    await consumer2.deliver((event) => { secondSeen.push(event.aggregateId); });
    expect(secondSeen).toEqual(["task-3"]);
  });

  it("keeps a committed MIGRATION when the process dies right after it", () => {
    const root = tempRoot();
    const child = runChild("migrate-then-crash", root, "migrate");
    expect(child.applied).toEqual([1]);
    expect(child.current).toBe(1);

    const handle = open(root);
    expect(readSchemaState(handle, 1).current).toBe(1);
    expect(appliedMigrations(handle).map((record) => record.version)).toEqual([1]);
    // The step's DDL really is there: the version alone would not prove it.
    const table = handle.raw.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='pilot_marker'").get();
    expect(table).toBeTruthy();
  });

  it("leaves the database usable after every crash mode", () => {
    for (const mode of ["commit-then-crash", "die-in-transaction", "multi-commit-crash", "migrate-then-crash"]) {
      const root = tempRoot();
      runChild(mode, root, `usable-${mode}`);
      const handle = open(root);
      expect(checkIntegrity(handle).ok, `${mode} left an inconsistent database`).toBe(true);
      handle.close();
    }
  });
});
