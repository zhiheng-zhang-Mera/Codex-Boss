#!/usr/bin/env node
/**
 * Trust Epoch Finalization — the terminal step's command line.
 *
 * The finalization workflow calls this AFTER it has produced, `--check`-verified and pushed the epoch branch. It
 * decides the terminal state, writes the machine-readable handoff the Codex-Boss App consumes, and exits with the
 * code that state implies:
 *
 *     NO_MIGRATION                exit 0   nothing to do; the committed epoch already anchors the surface
 *     EPOCH_BRANCH_READY          exit 0   the branch was produced, verified and pushed
 *     EPOCH_BRANCH_ALREADY_READY  exit 0   the branch already carries exactly this record; reuse, do not re-advance
 *     EPOCH_BRANCH_CONFLICT       exit 1   the branch exists and disagrees; refuse to overwrite an Owner record
 *
 * Every input is a fact the workflow has already measured; this program decides nothing it was not told, and it
 * writes only the two files under `--out`'s directory. It never creates a pull request and holds no credential.
 *
 * Usage:
 *   node scripts/trust-epoch-finalize-handoff.cjs \
 *     --repository owner/name --run-id 123 --base-branch main --base-sha <sha> \
 *     --candidate-epoch 28 --branch trust-epoch/boss-root-trust-28 \
 *     --root-surface-hash <sha256> [--epoch-hash <sha256>] [--epoch-commit <sha>] \
 *     [--expected-record <trust-epoch.json>] [--existing-record <trust-epoch.json>] \
 *     --out artifacts/platform-foundation/trust/epoch-pr-handoff.json
 *
 * `--epoch-commit` and `--epoch-hash` name facts the CALLER measured: the commit the branch carries and the epoch
 * hash the record produces. This program never invents either -- a governance artifact that filled in a commit it
 * did not observe would be the one thing such an artifact must never do. When `--epoch-commit` is absent the
 * `EPOCH_COMMIT` environment variable is consulted, because that is how the producing workflow step publishes it.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const module_ = require("./trust-epoch-finalization-handoff.cjs");

function parseArgs(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  return {
    repository: value("--repository"),
    runId: value("--run-id"),
    baseBranch: value("--base-branch") ?? "main",
    baseSha: value("--base-sha"),
    candidateEpoch: value("--candidate-epoch"),
    branch: value("--branch"),
    rootSurfaceHash: value("--root-surface-hash"),
    expectedRecordPath: value("--expected-record"),
    existingRecordPath: value("--existing-record"),
    // The epoch hash to publish. It comes from the record the run produced, or -- for a rerun onto an
    // already-ready branch, where this run produced nothing -- from the record the branch already carries. The
    // workflow resolves which; this program only publishes what it is told.
    epochHash: value("--epoch-hash"),
    // The commit the epoch branch carries. On the producing path this step publishes it through EPOCH_COMMIT; on a
    // rerun onto an already-ready branch no new commit is produced in this run, so the workflow resolves the commit
    // from the branch itself and passes it here. Without it the already-ready handoff would name no commit and be
    // refused by its own validator -- making the idempotent success path unreachable.
    epochCommit: value("--epoch-commit") ?? process.env.EPOCH_COMMIT ?? "",
    // Section 9 B1: the checkout binding. `--dispatch-sha` is `${{ github.sha }}` from the dispatch and
    // `--checked-out-sha` is `git rev-parse HEAD`. The workflow asserts the two are equal before this program runs,
    // and the artifact states both so the equality is readable afterwards rather than inferred from the run id.
    dispatchSha: value("--dispatch-sha") ?? process.env.DISPATCH_SHA ?? null,
    checkedOutSha: value("--checked-out-sha") ?? process.env.CHECKED_OUT_SHA ?? null,
    out: value("--out"),
    // The workflow sets this when Stage A found nothing to migrate. It is passed as a flag rather than inferred so
    // the no-migration success is an explicit statement rather than a default reached by omission.
    noMigration: argv.includes("--no-migration"),
  };
}

function readJsonIfPresent(file) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // An unreadable record is deliberately NOT null-with-no-explanation: the decision module treats an unreadable
    // existing record as a conflict, and this returns a marker so the reason survives into the decision.
    return { __unreadable: true, path: file };
  }
}

function recordOf(value) {
  if (!value || value.__unreadable) return null;
  return value.record ? { ...value.record, epoch_hash: value.epoch_hash ?? null } : value;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ["repository", "runId", "baseSha", "candidateEpoch", "branch", "rootSurfaceHash", "out"];
  const missing = required.filter((name) => !args[name]);
  if (missing.length > 0) {
    process.stderr.write(`trust-epoch-finalize-handoff: missing ${missing.map((n) => `--${n.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(", ")}\n`);
    return 2;
  }

  const epoch = Number(args.candidateEpoch);
  if (!Number.isInteger(epoch) || epoch < 1) {
    process.stderr.write(`trust-epoch-finalize-handoff: --candidate-epoch must be a positive integer, got ${JSON.stringify(args.candidateEpoch)}\n`);
    return 2;
  }

  const expected = recordOf(readJsonIfPresent(args.expectedRecordPath));
  const existing = recordOf(readJsonIfPresent(args.existingRecordPath));

  const decision = module_.decideTerminalState({
    needsMigration: !args.noMigration,
    branchExists: Boolean(args.existingRecordPath),
    expectedRecord: expected,
    existingRecord: existing,
    candidateEpoch: epoch,
  });

  // The branch is ready either because this run produced it, or because a previous run already did and the record
  // matches. EPOCH_BRANCH_CONFLICT is the only state where the branch must NOT be handed off for merging.
  const branchReady = decision.state === module_.STATE.EPOCH_BRANCH_READY || decision.state === module_.STATE.EPOCH_BRANCH_ALREADY_READY;

  const handoff = module_.buildHandoff({
    repository: args.repository,
    finalizationRunId: args.runId,
    baseBranch: args.baseBranch,
    baseSha: args.baseSha,
    epoch,
    epochBranch: args.branch,
    // The commit the branch actually carries, as measured by the caller. For the already-ready case the commit
    // already exists on the branch and the caller resolves it from there, so it is reported rather than invented.
    epochCommit: args.epochCommit,
    rootSurfaceHash: args.rootSurfaceHash,
    epochHash: args.epochHash ?? expected?.epoch_hash ?? null,
    prRequired: branchReady,
    // Section 9 B1: what the run was dispatched on, and what it actually measured. Passed through verbatim -- this
    // program does not resolve a git ref itself, because a governance artifact that invented the commit it was
    // bound to would be the one thing such an artifact must never do.
    dispatchSha: args.dispatchSha,
    checkedOutSha: args.checkedOutSha,
    result: decision,
  });

  const validation = module_.validateHandoff(handoff);
  const outDir = path.dirname(path.resolve(args.out));
  fs.mkdirSync(outDir, { recursive: true });

  const decisionPath = path.join(outDir, "epoch-pr-decision.json");
  fs.writeFileSync(decisionPath, `${JSON.stringify({
    schema: module_.HANDOFF_SCHEMA,
    state: decision.state,
    success: decision.success,
    wrote_anything: decision.wrote_anything,
    re_advanced: decision.re_advanced ?? false,
    pr_required: branchReady,
    message: decision.message,
    comparison: decision.comparison ?? null,
    candidate_epoch: epoch,
    validation_problems: validation.problems,
  }, null, 2)}\n`, "utf8");

  // The handoff is written even on a conflict, so the failure is readable from the artifact rather than only from
  // the log, and it is written with pr_required false so nothing downstream can act on a refused branch.
  fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(handoff, null, 2)}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({
    state: decision.state,
    success: decision.success,
    pr_required: branchReady,
    handoff: path.relative(process.cwd(), path.resolve(args.out)).split(path.sep).join("/"),
    decision: path.relative(process.cwd(), decisionPath).split(path.sep).join("/"),
    validation_ok: validation.ok,
    validation_problems: validation.problems,
    message: decision.message,
  }, null, 2)}\n`);

  if (!validation.ok && decision.success) {
    // A handoff that does not validate is a broken transport, not a successful finalization: fail rather than hand
    // the App a malformed request.
    process.stderr.write(`trust-epoch-finalize-handoff: the handoff failed validation: ${validation.problems.join("; ")}\n`);
    return 1;
  }
  return decision.success ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`trust-epoch-finalize-handoff failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs };
