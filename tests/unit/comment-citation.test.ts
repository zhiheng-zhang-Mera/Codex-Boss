import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanCommentCitations } from "../helpers/comment-citations";

/**
 * Phase Q — a comment may not lean on a section number a reader cannot look up.
 *
 * Measured state when this guard was written: 1470 section citations in comments under
 * `electron/**`, `src/**` and `scripts/**`, of which 231 name a document that exists here and
 * **1239 do not** — they point at supplied plan/convergence documents ("plan §9", "U6 §12.1",
 * "Engine §18") that are not tracked in this repository. Rewriting all of them would be a mass edit
 * of other people's explanations, so the debt is frozen instead: this file fails when a file grows
 * more bare citations than it had, when a file that had none gains one, and when the recorded total
 * rises. Reducing any file's count is always allowed, and the baseline is expected to shrink.
 *
 * The policy for new code is the one the modules this round touched follow: state the rule, or name
 * a `docs/*.md` (or other tracked) document next to the number.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE_FILE = path.join(ROOT, "tests", "fixtures", "comment-citation-baseline.json");

interface Baseline {
  total: number;
  byFile: Record<string, number>;
}

function readBaseline(): Baseline {
  const parsed = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8")) as { total?: number; byFile?: Record<string, number> };
  return { total: parsed.total ?? 0, byFile: parsed.byFile ?? {} };
}

describe("comment citations", () => {
  const scan = scanCommentCitations(ROOT);
  const baseline = readBaseline();

  it("scans the application source", () => {
    // A scan that silently finds nothing would pass every assertion below.
    expect(scan.files).toBeGreaterThan(500);
    expect(scan.comments).toBeGreaterThan(5000);
    expect(scan.citations.length).toBeGreaterThan(1000);
  });

  it("no file has more bare section citations than it is recorded with", () => {
    const grown = Object.entries(scan.bareByFile)
      .filter(([file, count]) => count > (baseline.byFile[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} (baseline ${baseline.byFile[file] ?? 0})`);
    expect(
      grown,
      "a new comment cites a section number without naming a document that exists in this repository. " +
        "State the rule instead, or name the tracked document (e.g. `docs/9-4-plan.md §12`). Files that grew:\n" +
        grown.join("\n")
    ).toEqual([]);
  });

  it("the recorded debt only shrinks", () => {
    expect(
      scan.bareTotal,
      `bare section citations: ${scan.bareTotal} (baseline ${baseline.total}). This number may fall, never rise; ` +
        "when it falls, lower tests/fixtures/comment-citation-baseline.json in the same commit."
    ).toBeLessThanOrEqual(baseline.total);
  });

  it("the baseline describes files that still exist", () => {
    const missing = Object.keys(baseline.byFile).filter((file) => !fs.existsSync(path.join(ROOT, file)));
    expect(missing, "these baseline entries point at files that no longer exist: remove them").toEqual([]);
  });
});
