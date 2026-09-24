#!/usr/bin/env node
/**
 * S2 EXIT AUDIT (workbook Stage D; see docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md).
 *
 * WHAT IT ANSWERS
 *
 *   The Phase 1B specification's S2 exit condition is: ">= 10 consecutive runs in which enforce and shadow
 *   produce identical finding sets and enforce's exit code is explained by a declaration in the change, plus one
 *   deliberate negative control: a known-undeclared-edge PR fails enforce and passes shadow."
 *
 *   The workbook forbids inheriting that statement from a prior report. This program RECOMPUTES it from the real
 *   GitHub hosted history, and it does so from the artifacts the hosted job itself publishes rather than from a
 *   summary anyone wrote down:
 *
 *     `ARCHITECTURE_SHADOW_VERDICT=... FINDINGS=... DIGEST=... EPOCH=... NOT_YET_ENFORCED=...`
 *     `ARCHITECTURE_S2_ENFORCE_VERDICT=... FINDINGS=... VIOLATIONS=... ENGINE_ERRORS=...`
 *
 *   Those two lines are printed by ci.yml's own "evidence is present and complete" steps, which FAIL the job when
 *   the record is missing, empty, carries no digest, reports engine errors, or is unauthorised. So reading them is
 *   reading a value the gate already refused to proceed without.
 *
 * WHY A PROGRAM AND NOT A TABLE IN A DOCUMENT
 *
 *   A window is a claim about a sequence. A hand-written table cannot be re-derived when a run is re-run, a run is
 *   deleted, or the window is extended -- and the workbook's own instruction is to classify an unexpected run
 *   rather than restart. This program prints EVERY run it considered, including the ones it excluded and why, so
 *   the count cannot be raised by hiding a row.
 *
 * READ-ONLY
 *
 *   It reads the GitHub API through the `gh` CLI. It writes nothing, dispatches nothing, and cancels nothing. The
 *   only side effect is API traffic and, with `--json`, a report on stdout for the caller to redirect.
 *
 * USAGE
 *
 *   node scripts/s2-exit-audit.cjs                 human-readable audit of the default window
 *   node scripts/s2-exit-audit.cjs --json          the same audit as JSON
 *   node scripts/s2-exit-audit.cjs --limit 60      how many runs to consider (default 40)
 *   node scripts/s2-exit-audit.cjs --branch main   which branch (default main)
 */

"use strict";

const { spawnSync } = require("node:child_process");

const REPO = "zhiheng-zhang-Mera/Codex-Boss";
const ARCHITECTURE_JOB = "architecture";
const PARITY_STEP = "Hosted shadow/enforce parity (ENF-12)";

/**
 * The two published lines, parsed.
 *
 * Kept pure and exported so a test can pin the parsing against a fixture instead of against the network.
 * A `KEY=value` line is the job's whole contract to a reader, so a parser that silently returns zeroes for an
 * unreadable line would turn "the evidence was missing" into "the evidence was empty" -- the confusion the
 * hosted evidence step exists to prevent. Hence: absent keys stay `null`, never `0`.
 */
function parsePublishedLine(text) {
  const read = (source, key) => {
    const match = new RegExp(`${key}=([^\\s]+)`).exec(source);
    if (!match) return null;
    const raw = match[1];
    return /^-?\d+$/.test(raw) ? Number(raw) : raw;
  };
  return {
    shadowVerdict: read(text, "ARCHITECTURE_SHADOW_VERDICT"),
    findings: read(text, "FINDINGS"),
    digest: read(text, "DIGEST"),
    epoch: read(text, "EPOCH"),
    notYetEnforced: read(text, "NOT_YET_ENFORCED"),
    enforceVerdict: read(text, "ARCHITECTURE_S2_ENFORCE_VERDICT"),
    violations: read(text, "VIOLATIONS"),
    engineErrors: read(text, "ENGINE_ERRORS"),
  };
}

/** The line as the job printed it, with the workflow's `job\tstep\t` prefix and any ANSI removed. */
function publishedLines(log) {
  const clean = String(log).replace(/\u001b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/).map((line) => {
    // `gh run view --job --log` prefixes each line with the job and step, tab-separated. The timestamp shares a
    // field with the content, so it is stripped by shape rather than by position.
    const parts = line.split("\t");
    const withoutPrefix = parts.length >= 3 ? parts.slice(2).join("\t") : line;
    return withoutPrefix.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "").trim();
  });
  return {
    shadow: lines.find((line) => /^ARCHITECTURE_SHADOW_VERDICT=/.test(line)) ?? null,
    enforce: lines.find((line) => /^ARCHITECTURE_S2_ENFORCE_VERDICT=/.test(line)) ?? null,
  };
}

/**
 * Classify one run. Returns `{ valid, reason }` where a non-valid run ALWAYS carries a reason.
 *
 * The reasons are deliberately separate strings rather than one "invalid": the workbook asks for "all excluded
 * runs and why", and "the architecture job was skipped" and "the digest was unreadable" are different findings
 * about different machinery.
 */
function classifyRun(run) {
  if (!run.architectureJob) return { valid: false, reason: "the run has no `architecture` job" };
  if (run.architectureJob.conclusion === "skipped") return { valid: false, reason: "the `architecture` job was skipped (an earlier job failed)" };
  if (run.architectureJob.conclusion !== "success") return { valid: false, reason: `the \`architecture\` job concluded ${run.architectureJob.conclusion}` };
  if (!run.parityStep) return { valid: false, reason: `the run has no step named "${PARITY_STEP}"` };
  if (run.parityStep.conclusion !== "success") return { valid: false, reason: `the ENF-12 parity step concluded ${run.parityStep.conclusion}` };
  if (!run.shadowLine) return { valid: false, reason: "the shadow evidence line was not published" };
  if (!run.enforceLine) return { valid: false, reason: "the enforce evidence line was not published" };
  const p = run.published;
  if (p.shadowVerdict !== "PASS") return { valid: false, reason: `shadow verdict was ${p.shadowVerdict}` };
  if (p.enforceVerdict !== "PASS") return { valid: false, reason: `enforce verdict was ${p.enforceVerdict}` };
  if (p.violations !== 0) return { valid: false, reason: `enforce reported ${p.violations} policy violation(s)` };
  if (p.engineErrors !== 0) return { valid: false, reason: `enforce reported ${p.engineErrors} engine error(s)` };
  if (p.findings === null || p.digest === null) return { valid: false, reason: "the shadow line carried no findings count or digest" };
  return { valid: true, reason: null };
}

/**
 * Split runs into those that can be JUDGED and those that cannot yet be.
 *
 * A run still in progress has not failed the gate, it has not finished being measured. Counting it as an
 * exclusion would break the streak at the newest position and report a window of zero -- understating the
 * evidence because a run had not finished, which is the mirror image of the overstatement this audit is
 * otherwise built to prevent. Pending runs are listed separately and are part of neither the numerator nor the
 * denominator.
 */
function partitionByStatus(runs) {
  return {
    pending: runs.filter((run) => run.status !== "completed"),
    completed: runs.filter((run) => run.status === "completed"),
  };
}

/**
 * The window: the LONGEST run of consecutive valid runs ending at the newest run considered.
 *
 * "Consecutive" is over runs in the order they were considered (newest first), and a run that is merely a re-run
 * of another does not break it -- see `attempt` below.
 */
function summarize(runs) {
  const valid = runs.filter((run) => run.valid);
  const digests = [...new Set(valid.map((run) => run.published.digest))];
  const epochs = [...new Set(valid.map((run) => run.published.epoch))];
  let streak = 0;
  for (const run of runs) {
    if (!run.valid) break;
    streak += 1;
  }
  const retried = runs.filter((run) => (run.attempt ?? 1) > 1);
  const flaked = runs.filter((run) => (run.attempt ?? 1) > 1 && run.conclusion === "success");
  return {
    considered: runs.length,
    valid: valid.length,
    excluded: runs.length - valid.length,
    consecutiveValidFromNewest: streak,
    distinctDigests: digests,
    distinctEpochs: epochs,
    sameDigestThroughout: digests.length === 1,
    retries: retried.map((run) => ({ databaseId: run.databaseId, attempt: run.attempt, conclusion: run.conclusion, headSha: run.headSha })),
    flakes: flaked.map((run) => ({ databaseId: run.databaseId, attempt: run.attempt, headSha: run.headSha })),
    firstValid: valid.length > 0 ? { databaseId: valid[valid.length - 1].databaseId, headSha: valid[valid.length - 1].headSha } : null,
    lastValid: valid.length > 0 ? { databaseId: valid[0].databaseId, headSha: valid[0].headSha } : null,
  };
}

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true, maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed (${result.status}): ${String(result.stderr ?? "").trim().slice(0, 400)}`);
  }
  return String(result.stdout ?? "");
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function main(argv) {
  const limitIndex = argv.indexOf("--limit");
  const limit = limitIndex === -1 ? 40 : Number(argv[limitIndex + 1]);
  const branchIndex = argv.indexOf("--branch");
  const branch = branchIndex === -1 ? "main" : argv[branchIndex + 1];
  const asJson = argv.includes("--json");

  const list = ghJson([
    "run", "list", "--repo", REPO, "--branch", branch, "--limit", String(limit),
    "--json", "databaseId,headSha,status,conclusion,event,createdAt,attempt,workflowName",
  ]);

  // Only completed runs can be judged, and only the branch's own pushes describe the gate on the branch: a
  // pull_request run measures a head that is not on main, and a workflow_dispatch run is an Owner ceremony.
  // Those are listed rather than dropped, so "how many runs were considered" cannot be raised by quietly
  // narrowing the window.
  const desktopCi = list.filter((run) => run.workflowName === "Desktop CI");
  const notConsidered = desktopCi
    .filter((run) => run.event !== "push")
    .map((run) => ({
      databaseId: run.databaseId,
      headSha: run.headSha,
      event: run.event,
      conclusion: run.conclusion,
      reason: `event is \`${run.event}\`, not a push to ${branch}`,
    }));
  const considered = desktopCi
    .filter((run) => run.event === "push")
    .sort((left, right) => (left.createdAt < right.createdAt ? 1 : -1));

  // A run still in progress cannot be judged either way. It is reported, and it is in neither the numerator nor
  // the denominator, so an unfinished run at the head of the window reports the window that actually exists.
  const { pending, completed } = partitionByStatus(considered);

  const runs = completed.map((run) => {
    const record = {
      databaseId: run.databaseId,
      headSha: run.headSha,
      createdAt: run.createdAt,
      status: run.status,
      conclusion: run.conclusion,
      attempt: run.attempt ?? 1,
      architectureJob: null,
      failedJobs: [],
      skippedJobs: [],
      parityStep: null,
      shadowLine: null,
      enforceLine: null,
      published: null,
      valid: false,
      reason: null,
    };
    try {
      const jobs = ghJson(["run", "view", String(run.databaseId), "--repo", REPO, "--json", "jobs"]).jobs ?? [];
      const job = jobs.find((entry) => entry.name === ARCHITECTURE_JOB) ?? null;
      record.architectureJob = job === null ? null : { databaseId: job.databaseId, conclusion: job.conclusion };
      // Every job that did not conclude success, so a run whose OVERALL outcome was red is classified by which
      // job actually failed rather than by its headline conclusion. This matters for the S2 claim: a run that
      // failed in `unit` still produced valid architecture evidence, and calling such a run "excluded" would
      // throw away an observation the gate really made.
      record.failedJobs = jobs
        .filter((entry) => entry.conclusion !== "success" && entry.conclusion !== "skipped")
        .map((entry) => `${entry.name}:${entry.conclusion}`);
      record.skippedJobs = jobs.filter((entry) => entry.conclusion === "skipped").map((entry) => entry.name);
      record.parityStep = job === null ? null : (job.steps ?? []).find((step) => step.name === PARITY_STEP) ?? null;
      record.parityStep = record.parityStep === null ? null : { number: record.parityStep.number, conclusion: record.parityStep.conclusion };
      if (job !== null && job.conclusion !== "skipped") {
        const log = gh(["run", "view", "--repo", REPO, "--job", String(job.databaseId), "--log"]);
        const lines = publishedLines(log);
        record.shadowLine = lines.shadow;
        record.enforceLine = lines.enforce;
        record.published = parsePublishedLine(`${lines.shadow ?? ""} ${lines.enforce ?? ""}`);
      }
    } catch (error) {
      record.reason = `the run could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (record.reason === null) {
      const verdict = classifyRun(record);
      record.valid = verdict.valid;
      record.reason = verdict.reason;
    }
    return record;
  });

  const summary = summarize(runs);
  const report = {
    schema: "city-s2-exit-audit/1",
    repository: REPO,
    branch,
    window: {
      definition: "consecutive completed Desktop CI `push` runs on the branch, newest first; a run is VALID when "
        + "its `architecture` job succeeded, its ENF-12 parity step succeeded, and the two evidence lines it "
        + "published report shadow PASS, enforce PASS, 0 violations and 0 engine errors",
      requiredConsecutiveRuns: 10,
      requirementSource: "docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md section 3, stage S2",
    },
    summary,
    meetsS2MinusNegativeControl:
      summary.consecutiveValidFromNewest >= 10 && summary.sameDigestThroughout && summary.distinctDigests.length === 1,
    pending: pending.map((run) => ({ databaseId: run.databaseId, headSha: run.headSha, status: run.status, reason: "the run has not completed, so it can be judged neither valid nor excluded" })),
    notConsidered,
    runs,
  };

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const lines = [];
  lines.push(`[s2] repository ${REPO} branch ${branch}`);
  lines.push(`[s2] considered ${summary.considered} push run(s); valid ${summary.valid}; excluded ${summary.excluded}`);
  lines.push(`[s2] consecutive valid runs from the newest: ${summary.consecutiveValidFromNewest} (required 10)`);
  lines.push(`[s2] distinct finding digests across valid runs: ${summary.distinctDigests.length} ${JSON.stringify(summary.distinctDigests)}`);
  lines.push(`[s2] distinct epochs across valid runs: ${JSON.stringify(summary.distinctEpochs)}`);
  lines.push(`[s2] retries: ${summary.retries.length}; flakes (failed then green on re-run): ${summary.flakes.length}`);
  if (summary.firstValid) lines.push(`[s2] first valid run ${summary.firstValid.databaseId} @ ${String(summary.firstValid.headSha).slice(0, 8)}`);
  if (summary.lastValid) lines.push(`[s2] last valid run ${summary.lastValid.databaseId} @ ${String(summary.lastValid.headSha).slice(0, 8)}`);
  lines.push(`[s2] S2 minus the negative control: ${report.meetsS2MinusNegativeControl ? "MET" : "NOT MET"}`);
  lines.push(`[s2] push runs still in progress (judged neither way): ${pending.length}`);
  for (const run of pending) {
    lines.push(`[s2]   PENDING ${run.databaseId} ${String(run.headSha).slice(0, 8)} status=${run.status}`);
  }
  lines.push(`[s2] Desktop CI runs listed but NOT considered: ${notConsidered.length}`);
  for (const run of notConsidered) {
    lines.push(`[s2]   SKIP    ${run.databaseId} ${String(run.headSha).slice(0, 8)} ${run.conclusion} ${run.reason}`);
  }
  lines.push("[s2] every run considered:");
  for (const run of runs) {
    const mark = run.valid ? "VALID  " : "EXCLUDE";
    const digest = run.published?.digest ? String(run.published.digest).slice(0, 12) : "-";
    const failed = run.failedJobs.length > 0 ? `failed_jobs=[${run.failedJobs.join(" ")}]` : "";
    lines.push(`[s2]   ${mark} ${run.databaseId} ${String(run.headSha).slice(0, 8)} attempt=${run.attempt} ${run.conclusion} digest=${digest} ${failed} ${run.reason ?? ""}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`s2-exit-audit failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parsePublishedLine, publishedLines, classifyRun, summarize, partitionByStatus };
