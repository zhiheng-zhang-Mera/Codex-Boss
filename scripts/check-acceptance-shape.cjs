/**
 * Can the acceptance layer satisfy a realistic, self-contained Node-`assert` test?
 *
 * This is the dry run that decides whether the Phase 08 external qualification is even reachable: the
 * reader has just been taught the `assert.<method>` dialect, and the way to find out whether that is ENOUGH
 * is to write the shape of test a real task would add and ask the production judgement what it says —
 * before spending provider calls on the real run.
 *
 * Usage: node scripts/check-acceptance-shape.cjs
 */
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");

function load(relative) {
  const file = path.join(ROOT, "dist-electron", relative);
  if (!fs.existsSync(file)) throw new Error(`the compiled module ${relative} is missing; run \`pnpm run build:electron\` first.`);
  return require(file);
}

const { summarizeAssertionStrength } = load("src/shared/assertion-shape.js");
const { assertionDiscriminates, judgeObjective } = load("src/shared/acceptance.js");

/**
 * The shape a real task would add: a module-scope populated fixture, a round trip through the behaviour,
 * and an equality against the input — all in one self-contained file, Node style.
 */
const CANDIDATE = [
  'import assert from "node:assert/strict";',
  'import { describe, it } from "node:test";',
  "",
  'import { RestartLock } from "../lib/index.js";',
  "",
  "const tickets = [",
  '  { id: "t-1", mode: "application", requestedAt: 1_000, reason: "operator" },',
  '  { id: "t-2", mode: "application", requestedAt: 2_000, reason: "operator" },',
  "];",
  "",
  'describe("restart lock", () => {',
  '  it("round-trips a populated ticket set through the durable store", () => {',
  "    const lock = new RestartLock({ nowMs: () => 5_000 });",
  "    const stored = lock.persist(tickets);",
  "    const parsed = lock.load(stored);",
  "",
  "    assert.deepEqual(parsed, tickets);",
  "  });",
  "});"
].join("\n");

const strength = summarizeAssertionStrength(CANDIDATE, "tests/restart-lock.test.js");
process.stdout.write(`assertion sites: ${strength.total}\n`);
process.stdout.write(`discriminating: ${strength.discriminating} (needs >= 1)\n`);
process.stdout.write(`non-empty inputs reaching an assertion: ${strength.inputs.nonEmpty}\n`);
for (const weak of strength.weak) process.stdout.write(`  weak: ${weak.at} ${weak.assertion} — ${weak.reason}\n`);

// The same thing through the production judgement, so the answer is the one a real run would get.
const claim = { id: "objective-established", statement: "the change establishes the objective with evidence that could have failed", criticality: "mandatory", source: "extracted" };
const obligation = { id: "discriminating-exercise", claimId: claim.id, kind: "non-empty-cases", requires: "a test in the change that exercises a representative input and could have failed", mandatory: true };
const evidence = [{
  id: "assertions:tests/restart-lock.test.js",
  claimId: claim.id,
  kind: "non-empty-cases",
  source: "tests/restart-lock.test.js",
  passed: true,
  discriminating: strength.discriminating > 0 && strength.inputs.nonEmpty > 0,
  detail: `${strength.total} site(s), ${strength.discriminating} discriminating`
}];
const verdict = judgeObjective({ claims: [claim], obligations: [obligation], evidence, weakSignals: [] });
process.stdout.write(`production verdict: ${verdict.verdict}\n`);
for (const reason of verdict.reasons) process.stdout.write(`  ${reason}\n`);

process.exit(verdict.verdict === "SATISFIED" ? 0 : 1);
