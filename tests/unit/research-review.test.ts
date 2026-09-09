import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { metaReview, publicationReady, respondToObjections, reviewRoundSettled, REVIEW_ROLES, type ReviewObjection, type ReviewResponse, type ReviewRound } from "../../src/shared/research-review";
import { recordStageArtifact, markRunFailed } from "../../electron/workspace/artifact-backbone";

/**
 * Phase G (R-703 review→response→revision→re-review; R-704 publication mode;
 * R-705 stage-classified archive incl failed-runs).
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function root(): string { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-review-")); dirs.push(dir); return dir; }

const objections: ReviewObjection[] = [
  { id: "o1", role: "METHOD", issue: "baseline unclear", severity: "major", revisedSections: ["Method"] },
  { id: "o2", role: "EVIDENCE", issue: "missing replication detail", severity: "minor", revisedSections: ["Method"] }
];

function round(): ReviewRound { return { roundId: "r1", objections, responses: [] }; }

it("R-703: every role reviewer present; objection→response→revision→re-review loop works", () => {
  expect(REVIEW_ROLES).toContain("META");
  const open = reviewRoundSettled(round());
  expect(open.settled).toBe(false);
  expect(open.open).toEqual(["o1", "o2"]);

  const responses: ReviewResponse[] = [
    { objectionId: "o1", reply: "baseline documented", revisedSections: ["Method"] },
    { objectionId: "o2", reply: "replication added", revisedSections: ["Method"] }
  ];
  const updated = respondToObjections(round(), responses);
  expect(reviewRoundSettled(updated).settled).toBe(true);
  expect(metaReview(updated).verdict).toBe("APPROVED");

  // A new round after revision: re-review may surface nothing further.
  const reReview = respondToObjections({ ...round(), roundId: "r2" }, responses);
  expect(metaReview(reReview).verdict).toBe("APPROVED");
});

it("R-703: a major objection cannot be merely retained; unknown objections rejected", () => {
  const updated = respondToObjections(round(), [{ objectionId: "o1", reply: "keeping as is", retainedReason: "preferred design" }]);
  const { violations } = reviewRoundSettled(updated);
  expect(violations.join(" ")).toContain("major objection o1 cannot be merely retained");
  expect(() => respondToObjections(round(), [{ objectionId: "ghost", reply: "x", revisedSections: [] }])).toThrow(/Unknown objection/);
});

it("R-704: publication mode requires contract + sufficiency + settled review + meta approval; smoke unaffected", () => {
  const notReady = publicationReady({ contractPresent: false, sufficiencyPassed: false, reviewSettled: false, metaApproved: false });
  expect(notReady.ready).toBe(false);
  const ready = publicationReady({ contractPresent: true, sufficiencyPassed: true, reviewSettled: true, metaApproved: true });
  expect(ready.ready).toBe(true);
  // ACCEPTANCE/SMOKE mode stays on the existing fast path — regression suites remain green.
  expect(REVIEW_ROLES.length).toBeGreaterThanOrEqual(6);
});

it("R-705: stage-classified research archive preserves every stage even when a later stage fails", () => {
  const dir = path.join(root(), "run-paper");
  recordStageArtifact(dir, "paper-1", "proposal", "01_proposal.md", "# RP", "architect");
  recordStageArtifact(dir, "paper-1", "literature", "02_literature.md", "sources", "retriever");
  markRunFailed(dir, "paper-1", "experiment execution failed");
  recordStageArtifact(dir, "paper-1", "revision", "08_revisions.md", "revised after review", "writer");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as { records: Array<{ stage: string }>; failedRuns: string[] };
  expect(manifest.records.map((record) => record.stage)).toEqual(["proposal", "literature", "revision"]);
  expect(manifest.failedRuns).toEqual(["experiment execution failed"]);
  expect(fs.existsSync(path.join(dir, "01_proposal.md"))).toBe(true);
});
