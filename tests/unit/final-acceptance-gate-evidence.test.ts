import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FINAL_ACCEPTANCE_RECORD, createFinalAcceptanceGate, type FinalAcceptanceConfig } from "../../electron/engineering/final-acceptance-gate";
import { emptyLedger } from "../../src/shared/evidence-ledger";

/**
 * Phase H — evidence that exists but cannot be read is not evidence that is absent.
 *
 * The gate's ANSWER was never wrong: an unreadable report and a missing one both
 * leave the item NOT_VERIFIED, which is the fail-safe direction §42 exists for.
 * What was wrong is the record: a corrupt `review-loop.json` was filed under
 * `artifacts_missing`, so the operator goes looking for a file that is sitting
 * right there, and the one fact a failed final acceptance must carry — "the
 * earlier checkpoint wrote a report this build cannot parse" — was dropped.
 *
 * These tests pin both halves: the distinction in the record, and the unchanged
 * decision.
 */

const dirs: string[] = [];
function makeTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-final-gate-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const INPUT = {
  requirements: [{ id: "R-1", type: "CONSTRAINT", text: "requirement R-1", visual: false, state: "VERIFIED" }],
  goal: "the gateway returns a receipt",
  served_requirements: ["R-1"]
};

/** A real root with a real artifacts directory, since the gate canonicalises its root. */
function workspace(): { root: string; artifacts: string } {
  const root = makeTree();
  const artifacts = path.join(root, "artifacts", "acceptance");
  fs.mkdirSync(artifacts, { recursive: true });
  return { root, artifacts };
}

function gateFor(config: { root: string; artifacts: string }) {
  const options: FinalAcceptanceConfig = { root: config.root, artifacts: config.artifacts, ledger: () => emptyLedger(), writtenFiles: () => [] };
  return createFinalAcceptanceGate(options);
}

describe("Phase H — the final acceptance gate", () => {
  it("names an artifact that exists but cannot be read, instead of calling it missing", () => {
    const { root, artifacts } = workspace();
    fs.writeFileSync(path.join(artifacts, "review-loop.json"), "{ this is not json", "utf8");
    const outcome = gateFor({ root, artifacts }).evaluate(INPUT);
    expect(outcome.artifacts.unreadable.some((entry) => entry.startsWith("review-loop.json:"))).toBe(true);
    expect(outcome.artifacts.unreadable.join(" ")).toMatch(/review-loop\.json: /);
    expect(outcome.artifacts.missing).not.toContain("review-loop.json");
    expect(outcome.artifacts.read).not.toContain("review-loop.json");
  });

  it("still calls an artifact that is not there missing", () => {
    const { root, artifacts } = workspace();
    const outcome = gateFor({ root, artifacts }).evaluate(INPUT);
    expect(outcome.artifacts.missing).toContain("review-loop.json");
    expect(outcome.artifacts.unreadable).toEqual([]);
  });

  it("writes both lists into the record, so the next reader is not sent to a file that exists", () => {
    const { root, artifacts } = workspace();
    fs.writeFileSync(path.join(artifacts, "review-loop.json"), "not json", "utf8");
    const outcome = gateFor({ root, artifacts }).evaluate(INPUT);
    const raw = JSON.parse(fs.readFileSync(outcome.recordPath, "utf8")) as { artifacts_missing: string[]; artifacts_unreadable: string[] };
    expect(raw.artifacts_unreadable.some((entry) => entry.startsWith("review-loop.json:"))).toBe(true);
    expect(raw.artifacts_missing).not.toContain("review-loop.json");
    // The other reports are genuinely absent, and stay in the missing list.
    expect(raw.artifacts_missing).toContain("ci-repair.json");
    expect(raw.artifacts_unreadable.some((entry) => entry.startsWith("ci-repair.json"))).toBe(false);
  });

  it("does not change the decision: corrupt and absent evidence both refuse the item", () => {
    // The fix is to the record, not to the gate. An unreadable report must never
    // turn into a pass, and it must not turn into a different refusal either.
    const corrupt = workspace();
    fs.writeFileSync(path.join(corrupt.artifacts, "review-loop.json"), "not json", "utf8");
    const absent = workspace();
    const corruptOutcome = gateFor(corrupt).evaluate(INPUT);
    const absentOutcome = gateFor(absent).evaluate(INPUT);
    expect(corruptOutcome.acceptance.decision).toBe(absentOutcome.acceptance.decision);
    expect(corruptOutcome.evidence.findings).toEqual(absentOutcome.evidence.findings);
  });

  it("tells a corrupt persisted record apart from a gate that never ran", () => {
    const { root, artifacts } = workspace();
    const never = gateFor({ root, artifacts });
    expect(never.record()).toBeUndefined();
    expect(never.recordDiagnostic()).toBeUndefined();

    fs.writeFileSync(path.join(artifacts, FINAL_ACCEPTANCE_RECORD), "{ truncated", "utf8");
    const corrupt = gateFor({ root, artifacts });
    expect(corrupt.record()).toBeUndefined();
    expect(corrupt.recordDiagnostic()).toBeTruthy();
    // …and the reason survives into the record the next evaluation writes.
    const raw = JSON.parse(fs.readFileSync(corrupt.evaluate(INPUT).recordPath, "utf8")) as { previous_record_unreadable?: string };
    expect(raw.previous_record_unreadable).toBeTruthy();
  });

  it("reads a record this build wrote, with no diagnostic", () => {
    const { root, artifacts } = workspace();
    const written = gateFor({ root, artifacts }).evaluate(INPUT);
    const reopened = gateFor({ root, artifacts });
    expect(reopened.recordDiagnostic()).toBeUndefined();
    expect(reopened.record()?.version).toBe("final-acceptance-1");
    expect(reopened.record()?.decision).toBe(written.acceptance.decision);
  });
});
