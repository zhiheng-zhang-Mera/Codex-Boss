/**
 * The production acceptance model — how a goal's objective is judged against evidence.
 *
 * ## What this is
 *
 * Phase 07's contract (`src/shared/acceptance.ts`) says what a verdict MEANS. This module says where the
 * claims, obligations and evidence come from for a real run, and it does so **deterministically**:
 * everything below is read from the workspace's own source files, with no model in the loop.
 *
 * ## The claim a goal makes, and the obligation it carries
 *
 * A goal's objective is reduced to one mandatory claim — *"the applied change establishes the objective
 * with evidence that could have failed"* — and that claim carries the obligation this phase exists for:
 * evidence exercising the behaviour must be **discriminating**. The mechanism is the assertion reader:
 * a change whose tests pass an empty array and compare the result against a constant produces
 * non-discriminating evidence, which is `INSUFFICIENT_EVIDENCE` — not acceptance.
 *
 * ## Why one claim rather than many
 *
 * A richer decomposition (splitting the objective into several claims by reading it) would need a model
 * to interpret the prose, and Phase 07's book forbids a model deciding acceptance. One claim whose
 * obligation is checkable from the diff is honest about what the platform can actually establish. Where
 * it cannot establish more, it says `INSUFFICIENT_EVIDENCE` rather than guessing — which is the whole
 * point.
 */

import fs from "node:fs";
import path from "node:path";
import { summarizeAssertionStrength } from "../../src/shared/assertion-shape";
import { judgeObjective, type AcceptanceClaim, type EvidenceObligation, type ObservedEvidence, type SatisfactionResult } from "../../src/shared/acceptance";

/** Which changed files can carry evidence at all. A non-test change is judged on its tests. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

interface AcceptanceEvidenceInput {
  /** The goal's objective, verbatim. */
  objective: string;
  /** Files the run actually applied. */
  changedFiles: string[];
  /** The workspace they were applied to. */
  workspace: string;
}

/**
 * Read the evidence a change carries, and judge the objective against it.
 *
 * Fail-closed at every step, and each refusal names what was missing:
 *
 *  - no changed test file → nothing exercises the behaviour → `INSUFFICIENT_EVIDENCE`;
 *  - a test file whose assertions are all non-discriminating → green, but incapable of having been red →
 *    `INSUFFICIENT_EVIDENCE`;
 *  - a test file with at least one discriminating, passing assertion → `SATISFIED`.
 *
 * A FAILING check never reaches here: the goal loop only asks once the host's checks have passed. A
 * discriminating observation that failed is therefore reported by the host's own verification, and this
 * model does not duplicate that judgement — it reports what the checks cannot.
 */
export function judgeGoalAcceptance(input: AcceptanceEvidenceInput): SatisfactionResult {
  const testFiles = input.changedFiles.filter((file) => TEST_FILE.test(file));

  const claim: AcceptanceClaim = {
    id: "objective-established",
    statement: `the applied change establishes the objective with evidence that could have failed: ${input.objective.slice(0, 300)}`,
    criticality: "mandatory",
    source: "extracted",
    addresses: input.objective.slice(0, 300)
  };
  const obligation: EvidenceObligation = {
    id: "discriminating-exercise",
    claimId: claim.id,
    kind: "non-empty-cases",
    requires: "a test in the change that exercises a representative input and could have failed",
    mandatory: true
  };

  if (!testFiles.length) {
    // No test changed, so nothing in this change exercises the behaviour. That is a statement about the
    // evidence, not about the code — which is exactly why the verdict is INSUFFICIENT rather than a
    // failure.
    return judgeObjective({
      claims: [claim],
      obligations: [obligation],
      evidence: [],
      weakSignals: [`the change modified ${input.changedFiles.length} file(s), none of them a test`]
    });
  }

  const evidence: ObservedEvidence[] = [];
  const weakSignals: string[] = [];
  for (const file of testFiles) {
    const absolute = path.join(input.workspace, file.split("/").join(path.sep));
    let source: string;
    try {
      source = fs.readFileSync(absolute, "utf8");
    } catch {
      // A test the change claims to have added but which cannot be read is not evidence. Reported as a
      // weak signal so the gap is visible rather than silently absent.
      weakSignals.push(`${file} is named in the change but could not be read`);
      continue;
    }
    const strength = summarizeAssertionStrength(source, file);
    const discriminating = strength.discriminating > 0 && strength.inputs.nonEmpty > 0;
    const detail = discriminating
      ? `${file} carries ${strength.discriminating} discriminating assertion(s) over ${strength.inputs.nonEmpty} varying input(s)`
      : `${file} has ${strength.total} assertion(s) but none discriminating: ${strength.weak[0]?.reason ?? "no varying input was exercised"}`;
    // The proxies this phase forbids are recorded as signals a reader may see, and are structurally
    // incapable of satisfying the obligation.
    weakSignals.push(`${file}: ${strength.total} assertion(s), ${strength.inputs.total} call argument(s)`);
    evidence.push({
      id: `assertions:${file}`,
      claimId: claim.id,
      kind: "non-empty-cases",
      source: file,
      passed: true,
      discriminating,
      detail
    });
  }

  if (!evidence.length) {
    weakSignals.push("no readable test evidence was found in the change");
  }

  return judgeObjective({ claims: [claim], obligations: [obligation], evidence, weakSignals });
}
