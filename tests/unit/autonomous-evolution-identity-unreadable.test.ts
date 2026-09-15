import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareRequiredIdSurface, fileReadProblem, readRequirementRetirements } from "../../electron/engineering/autonomous-evolution-identity";

/**
 * Phase H — an unreadable record file is not an empty one (the last item).
 *
 * `readTextFile` answers "" and `readJsonFile` answers `undefined` for a file that is
 * not there and for one that cannot be read. For the retirement records that
 * mattered: the comparison turns an empty set into `retirement_records_required`, so
 * a damaged record file silently converted a legitimate retirement into a reported
 * regression — the right verdict for the wrong reason, and indistinguishable from a
 * real one for whoever has to act on it.
 *
 * This module is on the Root Trust Surface, so the change carried an epoch advance.
 */

const dirs: string[] = [];
function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-retirements-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function withRetirements(root: string, content: string): string {
  fs.mkdirSync(path.join(root, "trust-policy"), { recursive: true });
  fs.writeFileSync(path.join(root, "trust-policy", "requirement-retirements.json"), content, "utf8");
  return root;
}

describe("Phase H — requirement retirement records", () => {
  it("distinguishes a file that is not there from one that cannot be read", () => {
    const root = makeRoot();
    expect(fileReadProblem(path.join(root, "trust-policy", "requirement-retirements.json"))).toContain("does not exist");

    const present = withRetirements(root, "[]");
    expect(fileReadProblem(path.join(present, "trust-policy", "requirement-retirements.json"))).toBeUndefined();
  });

  it("reads no records when there is no file, which is a repository state", () => {
    expect(readRequirementRetirements(makeRoot())).toEqual([]);
  });

  it("refuses a record file it cannot parse instead of reporting no retirements", () => {
    const root = withRetirements(makeRoot(), "{ truncated");
    expect(() => readRequirementRetirements(root)).toThrow(/Requirement retirement records are unreadable/);
    expect(() => readRequirementRetirements(root)).toThrow(/requirement-retirements\.json/);
    // The file is untouched: a refusal is not a repair.
    expect(fs.readFileSync(path.join(root, "trust-policy", "requirement-retirements.json"), "utf8")).toBe("{ truncated");
  });

  it("reads records it can parse, in both accepted shapes", () => {
    const retirement = { old_id: "R-1", reason: "superseded", replacement: "R-9", migration: "moved", risk: "low" };
    const bare = withRetirements(makeRoot(), JSON.stringify([retirement]));
    expect(readRequirementRetirements(bare).map((record) => record.old_id)).toEqual(["R-1"]);
    const wrapped = withRetirements(makeRoot(), JSON.stringify({ retirements: [{ ...retirement, old_id: "R-2" }] }));
    expect(readRequirementRetirements(wrapped).map((record) => record.old_id)).toEqual(["R-2"]);
  });

  it("refuses the comparison rather than reporting a regression it cannot justify", () => {
    // The consequence the fix is for: with a damaged record file, a removal that IS
    // recorded elsewhere looked like a removal with no record at all.
    const root = withRetirements(makeRoot(), "{ truncated");
    expect(() => compareRequiredIdSurface({ gate: ["R-1"] }, { gate: [] }, { root })).toThrow(/unreadable/);
  });
});
