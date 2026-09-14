import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRecoveryEngine } from "../../electron/engineering/recovery-engine";
import { emptyLedger } from "../../src/shared/evidence-ledger";

/**
 * Phase H — a capability-gap backlog that cannot be read is not an empty history.
 *
 * The loader returned `[]` for a missing file, a wrong-shaped document and a parse
 * error alike, while its comment claimed the damaged case was "not silently treated
 * as empty history". It was. The consequence is not cosmetic: the gap history is
 * what stops the engine re-recording a capability it has already recorded and
 * answered, so an unreadable backlog makes the engine behave as though nothing had
 * ever been tried — and the file it could not read is then overwritten by the next
 * save.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-backlog-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const engineFor = (backlogPath: string) => createRecoveryEngine({ root: path.dirname(backlogPath), ledger: () => emptyLedger(), backlogPath });

describe("Phase H — the capability-gap backlog", () => {
  it("says nothing when there is no backlog yet", () => {
    const backlog = path.join(makeTree(), "capability-gaps.json");
    const engine = engineFor(backlog);
    expect(engine.backlogDiagnostic()).toBeUndefined();
    expect(engine.gaps()).toEqual([]);
  });

  it("reports a backlog it cannot parse, and still starts from no history", () => {
    const backlog = path.join(makeTree(), "capability-gaps.json");
    fs.writeFileSync(backlog, "{ truncated", "utf8");
    const engine = engineFor(backlog);
    expect(engine.gaps()).toEqual([]);
    expect(engine.backlogDiagnostic()).toBeTruthy();
    // Left exactly as it was: the reason is reported, the evidence is not destroyed.
    expect(fs.readFileSync(backlog, "utf8")).toBe("{ truncated");
  });

  it("reports a backlog whose shape is wrong rather than a parse error", () => {
    const backlog = path.join(makeTree(), "capability-gaps.json");
    fs.writeFileSync(backlog, JSON.stringify({ schemaVersion: 1, version: "capability-gaps-1" }), "utf8");
    const engine = engineFor(backlog);
    expect(engine.gaps()).toEqual([]);
    expect(engine.backlogDiagnostic()).toContain("records");
  });

  it("reads a backlog this build wrote, with no diagnostic", () => {
    const backlog = path.join(makeTree(), "capability-gaps.json");
    fs.writeFileSync(backlog, JSON.stringify({ schemaVersion: 1, version: "capability-gaps-1", records: [] }), "utf8");
    const engine = engineFor(backlog);
    expect(engine.backlogDiagnostic()).toBeUndefined();
    expect(engine.gaps()).toEqual([]);
    // A save round trip keeps it readable.
    engine.save();
    const reopened = engineFor(backlog);
    expect(reopened.backlogDiagnostic()).toBeUndefined();
  });
});
