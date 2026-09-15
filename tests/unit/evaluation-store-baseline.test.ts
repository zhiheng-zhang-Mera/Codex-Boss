import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvaluationStore } from "../../electron/evaluation/evaluation-store";
import type { EvaluationRecord } from "../../src/shared/evaluation";

/**
 * Phase H — a baseline that cannot be read refuses legibly, and records why.
 *
 * The audit's description of this store said a corrupt baseline "reads as no
 * baseline" and that the next `record()` overwrites the file. Checking before
 * fixing showed that is not the mechanism: `readJson` THROWS on an unparseable file
 * (it returns `undefined` only when the file is absent), so the store already
 * refused — by surfacing a raw `SyntaxError` from inside a JSON parse, with no file
 * name, no statement that the durable measurement history is damaged, nothing for a
 * later reader to find, and `record()` never reaching its write. What is fixed here
 * is the refusal's legibility and its record, not its direction.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-eval-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function record(goldenId: string): EvaluationRecord {
  return {
    goldenId,
    complexity: "simple",
    status: "PASS",
    modelCalls: 0,
    estimatedTokens: 0,
    workerCalls: 1,
    retries: 0,
    latencyMs: 5,
    humanIntervention: false,
    sideEffects: false,
    completedAt: new Date().toISOString()
  };
}

describe("Phase H — the evaluation baseline", () => {
  it("says nothing when there is no store yet", () => {
    const store = new EvaluationStore(path.join(makeRoot(), "evaluation.json"));
    expect(store.load().records).toEqual([]);
    expect(store.loadDiagnostic()).toBeUndefined();
  });

  it("refuses a damaged baseline by name, and records the reason", () => {
    const file = path.join(makeRoot(), "evaluation.json");
    fs.writeFileSync(file, "{ truncated", "utf8");
    const store = new EvaluationStore(file);
    // The refusal names the file and says the baseline is unreadable, instead of
    // letting a JSON parser's exception stand for the whole story.
    expect(() => store.load()).toThrow(/Evaluation baseline is unreadable/);
    expect(() => store.load()).toThrow(new RegExp(file.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")));
    expect(store.loadDiagnostic()).toContain("could not be parsed");
    // Nothing was destroyed by asking.
    expect(fs.readFileSync(file, "utf8")).toBe("{ truncated");
  });

  it("never replaces a damaged baseline, because the write is never reached", () => {
    const file = path.join(makeRoot(), "evaluation.json");
    fs.writeFileSync(file, "{ truncated", "utf8");
    const store = new EvaluationStore(file);
    expect(() => store.record(record("golden-1"))).toThrow(/Evaluation baseline is unreadable/);
    expect(fs.readFileSync(file, "utf8")).toBe("{ truncated");
  });

  it("still throws on a file that parses but is not an evaluation store", () => {
    const file = path.join(makeRoot(), "evaluation.json");
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 2 }), "utf8");
    const store = new EvaluationStore(file);
    expect(() => store.load()).toThrow(/Invalid evaluation store/);
    expect(store.loadDiagnostic()).toContain("is not an evaluation store");
  });

  it("reads a store it wrote, and keeps one record per golden", () => {
    const file = path.join(makeRoot(), "evaluation.json");
    const store = new EvaluationStore(file);
    store.record(record("golden-1"));
    store.record(record("golden-2"));
    store.record({ ...record("golden-1"), status: "FAIL" });
    const reopened = new EvaluationStore(file);
    expect(reopened.loadDiagnostic()).toBeUndefined();
    expect(reopened.load().records.map((entry) => `${entry.goldenId}:${entry.status}`).sort()).toEqual(["golden-1:FAIL", "golden-2:PASS"]);
  });
});
