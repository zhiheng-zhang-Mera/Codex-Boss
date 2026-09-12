#!/usr/bin/env node
/**
 * Update-Plan/self-evlo.md sec. 27/28/33/49/50/73/74/75/95 - one trial round, in its own
 * process.
 *
 * The battery spawns this file (never in-process) so a round can be killed mid-flight for
 * the sec. 95 fault-injection case. The round runs the documented state machine:
 *
 *   CREATED -> BASELINE_VERIFIED -> PLANNED -> IMPLEMENTING -> CANDIDATE_READY ->
 *   VERIFYING -> REVIEWING -> CERTIFYING -> CERTIFIED -> ROLLED_BACK
 *
 * It appends to the run journal before and after every step, applies the catalog entry's
 * complete target content, runs the real verification profile (or the declared no-op
 * profile under --simulate), enforces the budget / scope / test-monotonicity rules on the
 * MEASURED diff, writes its evidence atomically and only at the very end, then rolls the
 * workspace back to the baseline and proves it is byte-clean again.
 *
 * Usage:
 *   node scripts/acceptance-evolution-round.cjs --round 1 --run-id <id> --baseline <sha>
 *        --catalog EV-01 --out <evidence.json> --journal <journal.ndjson>
 *        [--root .] [--goal "<text>"] [--simulate] [--runner-js <path>]
 *        [--kill-at plan|apply|verify|evidence] [--kill-window-ms <n>]
 *
 * Exit codes: 0 certified, 3 refused (structured), 4 internal error.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/* ------------------------------------------------------------------ *
 * arguments
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const options = {
    round: 0,
    runId: "",
    baseline: "",
    catalog: "",
    out: "",
    journal: "",
    root: process.cwd(),
    evidenceRoot: "",
    goal: "",
    simulate: false,
    runnerJs: "",
    trustJs: "",
    killAt: "",
    killWindowMs: 0
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };
    switch (key) {
      case "--round": options.round = Number(next()); break;
      case "--run-id": options.runId = String(next()); break;
      case "--baseline": options.baseline = String(next()); break;
      case "--catalog": options.catalog = String(next()); break;
      case "--out": options.out = String(next()); break;
      case "--journal": options.journal = String(next()); break;
      case "--root": options.root = path.resolve(String(next())); break;
      case "--evidence-root": options.evidenceRoot = path.resolve(String(next())); break;
      case "--goal": options.goal = String(next()); break;
      case "--simulate": options.simulate = true; break;
      case "--runner-js": options.runnerJs = String(next()); break;
      case "--trust-js": options.trustJs = String(next()); break;
      case "--kill-at": options.killAt = String(next()); break;
      case "--kill-window-ms": options.killWindowMs = Number(next()); break;
      default: break;
    }
  }
  if (options.evidenceRoot === "") options.evidenceRoot = options.root;
  return options;
}

const options = parseArgs(process.argv.slice(2));
const ROOT = options.root;
const EVIDENCE_ROOT = options.evidenceRoot;

/* ------------------------------------------------------------------ *
 * runner module (single source of truth for every rule)
 * ------------------------------------------------------------------ */

const REQUIRED_EXPORTS = [
  "ROUND_STATE_SEQUENCE",
  "ROUND_BUDGET",
  "ROUND_EXIT",
  "EVOLUTION_CATALOG",
  "EVOLUTION_VERIFICATION_PROFILE",
  "TRIAL_SURFACE_PATH",
  "TRIAL_TEST_PATH",
  "appendJournalSync",
  "assessRoundBudget",
  "assessRoundScope",
  "assessTestManifest",
  "baselineSurfaceContent",
  "baselineTestContent",
  "canonicalJson",
  "catalogDigest",
  "classifyRoundGoal",
  "collectChangedFiles",
  "collectTestManifest",
  "evidenceHash",
  "findCatalogEntry",
  "gitPorcelain",
  "hashOnceStable",
  "journalRecord",
  "normalizeRepoPath",
  "readJournalSync",
  "refusalCases",
  "roundVerificationCommands",
  "runGit",
  "sha256FileSync",
  "sha256Text",
  "validateRoundEvidence",
  "writeFileAtomicSync"
];

function candidateRunnerPaths(root) {
  const paths = [];
  if (options.runnerJs) paths.push(path.resolve(options.runnerJs));
  const source = path.join(root, "electron", "engineering", "autonomous-evolution-runner.ts");
  const sourceMtime = (() => {
    try {
      return fs.statSync(source).mtimeMs;
    } catch {
      return 0;
    }
  })();
  const built = path.join(root, "dist-electron", "electron", "engineering", "autonomous-evolution-runner.js");
  const fresh = (() => {
    try {
      return fs.statSync(built).mtimeMs >= sourceMtime;
    } catch {
      return false;
    }
  })();
  if (fresh) paths.push(built);
  paths.push(path.join(root, "artifacts", "evolution", ".runner-build", "autonomous-evolution-runner.js"));
  if (!fresh) paths.push(built);
  return paths;
}

function loadRunner() {
  const problems = [];
  for (const candidate of candidateRunnerPaths(ROOT)) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    let loaded;
    try {
      loaded = require(candidate);
    } catch (error) {
      problems.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const missing = REQUIRED_EXPORTS.filter((name) => loaded[name] === undefined);
    if (missing.length > 0) {
      problems.push(`${candidate}: missing exports ${missing.join(",")}`);
      continue;
    }
    return { module: loaded, path: candidate, problems };
  }
  process.stderr.write(
    `[evolution-round] EVOLUTION_RUNNER_UNAVAILABLE: no usable runner module\n${problems.map((entry) => `  - ${entry}`).join("\n")}\n`
  );
  process.exit(4);
}

const loadedRunner = loadRunner();
const runner = loadedRunner.module;
const RUNNER_PATH = loadedRunner.path;

/**
 * sec. 49/50/51/75 - the shipped trust boundary (src/shared/autonomous-evolution-trust.ts) is
 * an independent, additional authority for the budget, the root-trust surface and the
 * self-certification rule. When it is loadable its verdicts are merged with the runner's
 * rules (the union refuses), never used to weaken them.
 */
const TRUST_EXPORTS = ["assessBudget", "assessScope", "classifySurface", "ROOT_TRUST_SURFACE_PATHS"];
const loadedTrust = loadTrustModule();
const trust = loadedTrust.module;

function loadTrustModule() {
  const candidates = [];
  if (options.trustJs) candidates.push(path.resolve(options.trustJs));
  candidates.push(path.join(ROOT, "artifacts", "evolution", ".runner-build", "autonomous-evolution-trust.js"));
  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      const module = require(candidate);
      if (TRUST_EXPORTS.every((name) => module[name] !== undefined)) return { module, path: candidate, error: "" };
      return { module: null, path: candidate, error: `missing exports` };
    } catch (error) {
      return { module: null, path: candidate, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { module: null, path: "", error: "src/shared/autonomous-evolution-trust.ts is not compiled in this checkout" };
}

function safeCall(label, body) {
  try {
    return { ok: true, value: body() };
  } catch (error) {
    return { ok: false, error: `${label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The shipped budget verdict, or null when the module is unavailable. */
function externalBudgetVerdict(changedFiles, changedLoc) {
  if (!trust) return null;
  const outcome = safeCall("assessBudget", () => trust.assessBudget({ usage: { changed_files: changedFiles.length, changed_loc: changedLoc } }));
  if (!outcome.ok) return { failed: outcome.error };
  return outcome.value;
}

/** The shipped root-trust classification of every changed path (sec. 3/51). */
function externalRootTrustPaths(changedFiles) {
  if (!trust) return null;
  const outcome = safeCall("classifySurface", () => changedFiles.filter((file) => trust.classifySurface(file) === "ROOT_TRUST_SURFACE"));
  if (!outcome.ok) return { failed: outcome.error };
  return outcome.value;
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

const startedAt = new Date().toISOString();
const stateTrace = [];
const journalFile = options.journal ? path.resolve(options.journal) : "";
const outFile = options.out ? path.resolve(options.out) : "";

function pushState(state) {
  stateTrace.push(state);
}

function journal(event, detail, extra) {
  if (!journalFile) return;
  try {
    runner.appendJournalSync(
      journalFile,
      runner.journalRecord({
        runId: options.runId,
        round: options.round,
        catalogId: options.catalog,
        event,
        detail,
        extra: { workspace: ROOT, ...(extra ?? {}) }
      })
    );
  } catch (error) {
    process.stderr.write(`[evolution-round] journal append failed: ${String(error)}\n`);
  }
}

function killWindow(stage) {
  if (options.killAt !== stage) return;
  journal("KILL_WINDOW_OPEN", stage, { kill_window_ms: options.killWindowMs });
  const ms = Number.isFinite(options.killWindowMs) && options.killWindowMs > 0 ? options.killWindowMs : 5000;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // deliberate, declared fault-injection window: the battery kills this process here
  }
}

function git(args) {
  return runner.runGit(ROOT, args);
}

function head() {
  const result = git(["rev-parse", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function resolveEntry() {
  const entry = runner.findCatalogEntry(options.catalog);
  if (entry) return { entry, negative: null };
  const negative = runner.refusalCases().find((candidate) => candidate.id === options.catalog);
  if (negative) return { entry: null, negative };
  return { entry: null, negative: null };
}

function isContained(file) {
  const relative = path.relative(path.join(EVIDENCE_ROOT, "artifacts"), file);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function finish(evidence, exitCode) {
  evidence.finished_at = new Date().toISOString();
  evidence.state_trace = stateTrace.slice();
  evidence.evidence_hash = runner.evidenceHash(evidence);
  const validation = runner.validateRoundEvidence(evidence);
  evidence.validation = { ok: validation.ok, codes: validation.codes };
  // The validation block is part of the sealed bytes, so the hash is recomputed over it:
  // a reader can re-validate and re-hash the exact file it was given.
  evidence.evidence_hash = runner.evidenceHash(evidence);
  if (!outFile || !isContained(outFile)) {
    process.stderr.write(`[evolution-round] EVIDENCE_PATH_NOT_CONTAINED: ${outFile}\n`);
    process.exit(4);
  }
  if (options.killAt === "evidence") killWindow("evidence");
  try {
    runner.writeFileAtomicSync(outFile, `${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`[evolution-round] evidence write failed: ${String(error)}\n`);
    process.exit(4);
  }
  journal("RUN_FINISHED", evidence.certified ? "CERTIFIED" : "REFUSED", {
    certified: evidence.certified,
    refusal_codes: evidence.refusal_codes,
    evidence_hash: evidence.evidence_hash,
    evidence: path.relative(EVIDENCE_ROOT, outFile).split(path.sep).join("/")
  });
  process.stdout.write(
    `${JSON.stringify({
      round: options.round,
      catalog_id: options.catalog,
      certified: evidence.certified,
      refusal_codes: evidence.refusal_codes,
      refusal_stage: evidence.refusal_stage,
      changed_files: evidence.changed_files,
      changed_loc: evidence.changed_loc,
      verification: evidence.verification,
      evidence: outFile,
      state_trace: evidence.state_trace
    })}\n`
  );
  process.exit(exitCode);
}

/* ------------------------------------------------------------------ *
 * round
 * ------------------------------------------------------------------ */

const resolved = resolveEntry();
pushState("CREATED");
journal("RUN_STARTED", resolved.entry ? resolved.entry.kind : resolved.negative ? resolved.negative.kind : "unknown-catalog", {
  runner: RUNNER_PATH,
  simulate: options.simulate,
  goal: options.goal || undefined
});

if (!resolved.entry && !resolved.negative) {
  pushState("BASELINE_VERIFIED");
  pushState("PLANNED");
  pushState("REFUSED");
  pushState("ROLLED_BACK");
  return finish(
    {
      round: options.round,
      run_id: options.runId,
      catalog_id: options.catalog,
      kind: "unknown-catalog",
      verification: options.simulate ? "SIMULATED" : "REAL",
      typecheck: { exit: null, ms: 0, not_run: true, simulated: options.simulate },
      tests: { exit: null, ms: 0, not_run: true, passed: null, failed: null, simulated: options.simulate },
      changed_files: [],
      changed_loc: 0,
      budget: { ok: false, codes: [{ code: "CATALOG_ENTRY_MISSING", detail: options.catalog }] },
      scope: { ok: false, codes: [{ code: "CATALOG_ENTRY_MISSING", detail: options.catalog }] },
      certified: false,
      refusal_codes: ["CATALOG_ENTRY_MISSING"],
      refusal_stage: "PLAN",
      started_at: startedAt,
      workspace: ROOT,
      baseline: options.baseline,
      runner: RUNNER_PATH
    },
    runner.ROUND_EXIT.REFUSED
  );
}

const entry = resolved.entry ?? {
  id: resolved.negative.id,
  kind: resolved.negative.kind,
  title: resolved.negative.title,
  goal: resolved.negative.goal,
  targets: resolved.negative.targets,
  declared_files: resolved.negative.declared_files ?? resolved.negative.targets.length,
  declared_loc: resolved.negative.declared_loc ?? 0
};
const negative = resolved.negative;

const evidence = {
  round: options.round,
  run_id: options.runId,
  catalog_id: entry.id,
  kind: entry.kind,
  title: entry.title,
  goal: options.goal || entry.goal,
  worker: "deterministic-catalog",
  workspace: ROOT,
  workspace_mode: "IN_PLACE",
  baseline: options.baseline,
  baseline_tree: "",
  verification: options.simulate ? "SIMULATED" : "REAL",
  verification_profile: runner.EVOLUTION_VERIFICATION_PROFILE,
  simulated_verification: options.simulate,
  runner: RUNNER_PATH,
  runner_sha256: runner.sha256FileSync(RUNNER_PATH),
  typecheck: { exit: null, ms: 0, not_run: true, simulated: options.simulate },
  tests: { exit: null, ms: 0, not_run: true, passed: null, failed: null, simulated: options.simulate },
  changed_files: [],
  changed_loc: 0,
  changed_file_stats: [],
  budget: { ok: false, codes: [] },
  scope: { ok: false, codes: [] },
  test_manifest: { ok: true, codes: [], deleted_titles: [], baseline_tests: 0, candidate_tests: 0 },
  goal_check: { refused: false, codes: [] },
  certified: false,
  refusal_codes: [],
  refusal_stage: null,
  started_at: startedAt,
  plan: {
    declared_files: entry.declared_files,
    declared_loc: entry.declared_loc,
    target_files: entry.targets.map((target) => target.path),
    under_declared: Boolean(negative && negative.under_declared)
  }
};

/* --- BASELINE_VERIFIED ------------------------------------------------- */

const baselineHead = head();
const porcelainBefore = runner.gitPorcelain(ROOT);
const pendingOps = runner.pendingGitOperations ? runner.pendingGitOperations(ROOT) : [];
const baselineTestManifest = runner.collectTestManifest(ROOT);
evidence.baseline_tree = (() => {
  const result = git(["rev-parse", "HEAD^{tree}"]);
  return result.status === 0 ? result.stdout.trim() : "";
})();
evidence.test_manifest_baseline_hash = baselineTestManifest.hash;
evidence.baseline_tests = Object.values(baselineTestManifest.files).reduce((total, titles) => total + titles.length, 0);

const baselineOk = baselineHead === options.baseline && porcelainBefore.length === 0 && pendingOps.length === 0;

// The frozen catalog must describe the frozen source: a mismatch means the trial would be
// measuring a different baseline than it claims.
let catalogBaselineMismatch = "";
if (resolved.entry) {
  for (const target of resolved.entry.targets) {
    const expected =
      target.path === runner.TRIAL_SURFACE_PATH
        ? runner.baselineSurfaceContent()
        : target.path === runner.TRIAL_TEST_PATH
          ? runner.baselineTestContent()
          : "";
    if (expected === "") continue;
    const full = path.join(ROOT, target.path);
    const current = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
    if (runner.normalizeEol(current) !== runner.normalizeEol(expected)) catalogBaselineMismatch = target.path;
  }
}
evidence.catalog_baseline_ok = catalogBaselineMismatch === "";

pushState("BASELINE_VERIFIED");
journal("BASELINE_VERIFIED", baselineOk && !catalogBaselineMismatch ? "clean" : "not-clean", {
  head: baselineHead,
  clean: porcelainBefore.length === 0,
  pending_git_operations: pendingOps,
  catalog_baseline_ok: catalogBaselineMismatch === ""
});
killWindow("baseline");
if (!baselineOk) {
  evidence.refusal_codes = ["BASELINE_NOT_VERIFIED"];
  evidence.refusal_stage = "BASELINE_VERIFIED";
  evidence.baseline_observation = {
    head: baselineHead,
    expected: options.baseline,
    porcelain: porcelainBefore,
    pending_git_operations: pendingOps
  };
  pushState("REFUSED");
  pushState("ROLLED_BACK");
  return finish(evidence, runner.ROUND_EXIT.INTERNAL_ERROR);
}
if (catalogBaselineMismatch !== "") {
  evidence.refusal_codes = ["CATALOG_BASELINE_MISMATCH"];
  evidence.refusal_stage = "BASELINE_VERIFIED";
  evidence.baseline_observation = { mismatched_path: catalogBaselineMismatch };
  pushState("REFUSED");
  pushState("ROLLED_BACK");
  return finish(evidence, runner.ROUND_EXIT.INTERNAL_ERROR);
}

/* --- PLANNED ----------------------------------------------------------- */

const plannedFiles = entry.targets.map((target) => target.path);
const plannedBudget = runner.assessRoundBudget({
  changed_files: plannedFiles,
  changed_loc: entry.declared_loc
});
const plannedScope = runner.assessRoundScope(plannedFiles);
const plannedExternalBudget = externalBudgetVerdict(plannedFiles, entry.declared_loc);
const plannedExternalRootTrust = externalRootTrustPaths(plannedFiles);
const plannedExternalFindings = [];
if (plannedExternalBudget && plannedExternalBudget.exceeded) {
  plannedExternalFindings.push({ code: "RUN_BUDGET_EXCEEDED", detail: `assessBudget: ${JSON.stringify(plannedExternalBudget.breaches)}` });
}
if (Array.isArray(plannedExternalRootTrust) && plannedExternalRootTrust.length > 0) {
  plannedExternalFindings.push({ code: "ROOT_TRUST_CHANGE", detail: `classifySurface: ${plannedExternalRootTrust.join(",")}` });
  plannedExternalFindings.push({ code: "SELF_CERTIFICATION_FORBIDDEN", detail: `classifySurface: ${plannedExternalRootTrust.join(",")}` });
}
pushState("PLANNED");
journal("PLAN_CREATED", entry.title, {
  planned_files: plannedFiles,
  budget_ok: plannedBudget.ok,
  scope_ok: plannedScope.ok
});

if (!plannedBudget.ok || !plannedScope.ok || plannedExternalFindings.length > 0) {
  evidence.budget = plannedBudget;
  evidence.scope = plannedScope;
  evidence.trust_rule_source = loadedTrust.path ? path.relative(EVIDENCE_ROOT, loadedTrust.path).split(path.sep).join("/") : loadedTrust.error;
  evidence.external_rules = {
    assessBudget: plannedExternalBudget,
    classifySurface_root_trust_paths: plannedExternalRootTrust,
    findings: plannedExternalFindings
  };
  evidence.refusal_codes = Array.from(
    new Set([...plannedBudget.codes, ...plannedScope.codes, ...plannedExternalFindings].map((finding) => finding.code))
  );
  evidence.refusal_stage = "PLAN";
  evidence.enforcement = "PLAN_DECLARED";
  pushState("REFUSED");
  const rollbackClean = rollback();
  pushState("ROLLED_BACK");
  evidence.rollback = rollbackClean;
  return finish(evidence, runner.ROUND_EXIT.REFUSED);
}

/* --- IMPLEMENTING ------------------------------------------------------ */

pushState("IMPLEMENTING");
journal("IMPLEMENTING", entry.title);
killWindow("plan");

const applied = [];
for (const target of entry.targets) {
  const full = path.join(ROOT, target.path);
  const before = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, target.content, "utf8");
  applied.push({ path: target.path, before_sha256: runner.sha256Text(before), after_sha256: runner.sha256Text(target.content) });
  journal("FILE_CHANGED", target.path, {
    before_sha256: runner.sha256Text(before),
    after_sha256: runner.sha256Text(target.content)
  });
}
evidence.applied = applied;
pushState("CANDIDATE_READY");

const diff = runner.collectChangedFiles(ROOT);
evidence.changed_files = diff.changed_files;
evidence.changed_loc = diff.changed_loc;
evidence.changed_file_stats = diff.files;
evidence.diff_numstat = diff.raw_numstat.trim();
journal("CANDIDATE_READY", "diff measured", {
  changed_files: diff.changed_files,
  changed_loc: diff.changed_loc
});
killWindow("apply");

/* --- VERIFYING --------------------------------------------------------- */

pushState("VERIFYING");
const commands = runner.roundVerificationCommands(ROOT, options.simulate);
const verificationResults = {};
for (const command of commands) {
  journal("TEST_STARTED", command.id, { command: command.display });
  if (command.id === "tests" && options.killAt === "verify") killWindow("verify");
  const started = Date.now();
  const result = spawnSync(command.command, command.args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: command.shell === true,
    maxBuffer: 64 * 1024 * 1024
  });
  const ms = Date.now() - started;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exit = typeof result.status === "number" ? result.status : -1;
  const block = { exit, ms, command: command.display, simulated: options.simulate };
  if (result.error) block.spawn_error = String(result.error.message);
  if (command.id === "typecheck") {
    block.output_tail = (stdout + stderr).trim().split(/\r?\n/).slice(-8).join("\n");
  } else if (options.simulate) {
    block.passed = null;
    block.failed = null;
    block.simulated = true;
    block.counts = "NOT_MEASURED_SIMULATED";
  } else {
    const counts = runner.parseVitestCounts(stdout + stderr);
    block.passed = counts.passed;
    block.failed = counts.failed;
    if (counts.passed === null && counts.failed === null) {
      // The profile really ran; the summary line could not be parsed. Declared explicitly so
      // the certificate says "no counts available" instead of inventing them.
      block.counts = "UNPARSED";
      block.counts_unparsed = true;
    }
  }
  verificationResults[command.id] = block;
  journal("TEST_FINISHED", command.id, { exit, ms, simulated: options.simulate });
}
evidence.typecheck = verificationResults.typecheck;
evidence.tests = verificationResults.tests;

/* --- REVIEWING --------------------------------------------------------- */

pushState("REVIEWING");
const measuredBudget = runner.assessRoundBudget({
  changed_files: diff.changed_files,
  changed_loc: diff.changed_loc
});
const measuredScope = runner.assessRoundScope(diff.changed_files);
const candidateManifest = runner.collectTestManifest(ROOT);
const manifestCheck = runner.assessTestManifest(baselineTestManifest, candidateManifest);
const goalCheck = runner.classifyRoundGoal(evidence.goal);
const measuredExternalBudget = externalBudgetVerdict(diff.changed_files, diff.changed_loc);
const measuredExternalRootTrust = externalRootTrustPaths(diff.changed_files);
const externalFindings = [];
if (measuredExternalBudget && measuredExternalBudget.exceeded) {
  externalFindings.push({ code: "RUN_BUDGET_EXCEEDED", detail: `assessBudget: ${JSON.stringify(measuredExternalBudget.breaches)}` });
}
if (Array.isArray(measuredExternalRootTrust) && measuredExternalRootTrust.length > 0) {
  externalFindings.push({ code: "ROOT_TRUST_CHANGE", detail: `classifySurface: ${measuredExternalRootTrust.join(",")}` });
  externalFindings.push({ code: "SELF_CERTIFICATION_FORBIDDEN", detail: `classifySurface: ${measuredExternalRootTrust.join(",")}` });
}
evidence.trust_rule_source = loadedTrust.path ? path.relative(EVIDENCE_ROOT, loadedTrust.path).split(path.sep).join("/") : loadedTrust.error;
evidence.external_rules = {
  assessBudget: measuredExternalBudget,
  classifySurface_root_trust_paths: measuredExternalRootTrust,
  findings: externalFindings
};
evidence.budget = measuredBudget;
evidence.scope = measuredScope;
evidence.test_manifest = {
  ok: manifestCheck.ok,
  codes: manifestCheck.codes,
  deleted_titles: manifestCheck.deleted_titles,
  deleted_files: manifestCheck.deleted_files,
  baseline_tests: manifestCheck.baseline_tests,
  candidate_tests: manifestCheck.candidate_tests,
  baseline_hash: baselineTestManifest.hash,
  candidate_hash: candidateManifest.hash
};
evidence.goal_check = { refused: goalCheck.refused, codes: goalCheck.codes, matched: goalCheck.matched };
journal("REVIEWING", manifestCheck.ok ? "manifest monotone" : "manifest regression", {
  budget_ok: measuredBudget.ok,
  scope_ok: measuredScope.ok,
  deleted_titles: manifestCheck.deleted_titles
});

/* --- CERTIFYING -------------------------------------------------------- */

pushState("CERTIFYING");
const refusalFindings = [
  ...measuredBudget.codes,
  ...measuredScope.codes,
  ...manifestCheck.codes,
  ...goalCheck.codes,
  ...externalFindings
];
const uniqueRefusals = [];
for (const finding of refusalFindings) {
  if (!uniqueRefusals.some((entryFinding) => entryFinding.code === finding.code)) uniqueRefusals.push(finding);
}
const verified = evidence.typecheck.exit === 0 && evidence.tests.exit === 0;
evidence.certified = uniqueRefusals.length === 0 && verified;
evidence.enforcement = "MEASURED_DIFF";
journal("CERTIFYING", evidence.certified ? "certified" : "refused", {
  refusal_codes: uniqueRefusals.map((finding) => finding.code),
  typecheck_exit: evidence.typecheck.exit,
  tests_exit: evidence.tests.exit
});

if (evidence.certified) {
  pushState("CERTIFIED");
  journal("CERTIFIED", entry.title, { changed_loc: evidence.changed_loc });
} else {
  evidence.refusal_codes = uniqueRefusals.map((finding) => finding.code);
  if (uniqueRefusals.length === 0) {
    evidence.refusal_codes = ["VERIFICATION_FAILED"];
  }
  evidence.refusal_details = uniqueRefusals;
  evidence.refusal_stage = "CERTIFYING";
  pushState("REFUSED");
  journal("REFUSED", evidence.refusal_codes.join(","), { refusal_codes: evidence.refusal_codes });
}

/* --- ROLLED_BACK ------------------------------------------------------- */

function rollback() {
  for (const target of entry.targets) {
    const relative = runner.normalizeRepoPath(target.path);
    const blob = git(["cat-file", "-p", `${options.baseline}:${relative}`]);
    const full = path.join(ROOT, relative);
    if (blob.status === 0) {
      // Restore the exact blob bytes rather than running `git checkout`: the checkout would
      // re-apply the host's line-ending policy, and the trial's baseline is the blob.
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, blob.stdout, "utf8");
      const add = git(["add", "--", relative]);
      if (add.status !== 0) {
        process.stderr.write(`[evolution-round] index refresh failed for ${relative}: ${add.stderr}\n`);
      }
    } else {
      if (fs.existsSync(full)) fs.rmSync(full, { force: true });
      git(["rm", "--cached", "--force", "--quiet", "--", relative]);
    }
  }
  const porcelain = runner.gitPorcelain(ROOT);
  const diffQuiet = git(["diff", "--quiet", options.baseline, "--"]);
  const headNow = head();
  const clean = porcelain.length === 0 && diffQuiet.status === 0 && headNow === options.baseline;
  journal("ROLLBACK", clean ? "byte-clean" : "residue", {
    porcelain,
    head: headNow,
    diff_quiet_exit: diffQuiet.status
  });
  return {
    ok: clean,
    porcelain,
    head: headNow,
    head_matches_baseline: headNow === options.baseline,
    worktree_matches_baseline: diffQuiet.status === 0,
    tree: (() => {
      const result = git(["rev-parse", "HEAD^{tree}"]);
      return result.status === 0 ? result.stdout.trim() : "";
    })()
  };
}

const rollbackResult = rollback();
pushState("ROLLED_BACK");
evidence.rollback = rollbackResult;
if (!rollbackResult.ok) {
  evidence.certified = false;
  evidence.refusal_codes = Array.from(new Set([...(evidence.refusal_codes ?? []), "ROLLBACK_NOT_CLEAN"]));
  evidence.refusal_stage = evidence.refusal_stage ?? "ROLLED_BACK";
  return finish(evidence, runner.ROUND_EXIT.INTERNAL_ERROR);
}

return finish(evidence, evidence.certified ? runner.ROUND_EXIT.CERTIFIED : runner.ROUND_EXIT.REFUSED);
