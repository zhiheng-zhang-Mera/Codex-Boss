#!/usr/bin/env node
/**
 * Host-M P1 — the single acceptance command.
 *
 *   node scripts/host-acceptance.cjs [options]
 *
 * Options
 *   --only a,b           run just these check ids (unknown ids are a hard error)
 *   --exclude a,b        drop these check ids
 *   --program p[,p]      restrict to legacy|closure|tenx|engine|host|build
 *   --extended           also make the opt-in rows selectable (nothing is forced)
 *   --all                select every catalog row, including not-yet-built entry points
 *   --soak               opt-in request for the bounded 30m soak and the 2h closure soak
 *   --json               print the report JSON instead of the table
 *   --out PATH           write the full report here (default artifacts/host-acceptance/latest.json)
 *   --record PATH        write the small P6 comparison record here
 *   --quiet              suppress per-check progress lines
 *   --build-first        emit dist-electron before running (the host modules load from it)
 *
 * Exit codes: 0 only when the hub verdict is PASS. Every other verdict
 * (FAIL / BLOCKED_EXTERNAL / DEGRADED / SKIPPED_WITH_REASON) is a non-zero exit,
 * because a caller that treats "blocked" as success is exactly the failure mode
 * this hub exists to prevent.
 *
 * Loads the compiled host modules from dist-electron, so it needs
 * `npx tsc -p tsconfig.electron.json` first — or pass --build-first.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

function fail(message, code = 2) {
  console.error(`HOST_ACCEPTANCE_ERROR ${message}`);
  process.exit(code);
}

function compiled(relative) {
  const file = path.join(repoRoot, "dist-electron", ...relative);
  if (!fs.existsSync(file)) {
    fail(`missing ${path.relative(repoRoot, file)} — build the electron project first (npx tsc -p tsconfig.electron.json)`);
  }
  return require(file);
}

function parseArgs(argv) {
  const options = { only: [], exclude: [], program: [], includeOptIn: [], extended: false, json: false, quiet: false, buildFirst: false, all: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    const list = (value) =>
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (arg === "--only") options.only.push(...list(next()));
    else if (arg === "--exclude") options.exclude.push(...list(next()));
    else if (arg === "--program") options.program.push(...list(next()));
    else if (arg === "--extended") options.extended = true;
    else if (arg === "--all") options.all = true;
    else if (arg === "--soak") options.includeOptIn.push("host:soak-30m", "closure:soak-2h");
    else if (arg === "--json") options.json = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--build-first") options.buildFirst = true;
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--record") options.record = path.resolve(next());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else fail(`unknown option ${arg}`);
  }
  return options;
}

function helpText() {
  const source = fs.readFileSync(__filename, "utf8");
  const block = source.slice(source.indexOf("/**") + 3, source.indexOf("*/"));
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*\*ct? /, "").replace(/^\s*\* ?/, ""))
    .join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  if (options.buildFirst) {
    console.log("HOST_ACCEPTANCE_BUILD emitting dist-electron …");
    const build = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.electron.json"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false
    });
    if (build.status !== 0) fail("--build-first failed; dist-electron was not updated", 2);
  }

  const { runAcceptanceHub, selectAcceptanceChecks } = compiled(["electron", "host", "acceptance-hub-runner.js"]);
  const { acceptanceCatalog } = compiled(["electron", "host", "acceptance-catalog.js"]);
  const { createNodeProcessRunner } = compiled(["electron", "host", "process-runner.js"]);
  const { collectHostProbes, currentBranch, currentRevision } = compiled(["electron", "host", "host-probes.js"]);
  const { buildAcceptanceReport, renderAcceptanceReport } = compiled(["src", "shared", "acceptance-hub.js"]);
  const { recordFromReport } = compiled(["src", "shared", "acceptance-record.js"]);

  // Program filtering narrows the catalog before selection, so probes and
  // preflight only consider what is actually in scope.
  let catalog = acceptanceCatalog();
  if (options.program.length) {
    const wanted = new Set(options.program);
    for (const program of wanted) {
      if (!catalog.some((check) => check.program === program)) fail(`unknown program ${program}`);
    }
    catalog = catalog.filter((check) => wanted.has(check.program));
  }

  const probes = await collectHostProbes({ repoRoot });

  let selection;
  try {
    selection = selectAcceptanceChecks({
      checks: catalog,
      extended: options.extended,
      only: options.only,
      exclude: options.exclude,
      includeOptIn: options.includeOptIn,
      includeAll: options.all
    });
  } catch (error) {
    return fail(String(error && error.message ? error.message : error));
  }

  // Rows that were in the catalog but deliberately out of scope are reported as
  // SKIPPED_WITH_REASON (a choice) rather than silently dropped or dressed up as
  // BLOCKED_EXTERNAL (a missing prerequisite).
  const now = new Date().toISOString();
  const selectedIds = new Set(selection.map((check) => check.id));
  const skipped = catalog
    .filter((check) => check.enabledByDefault === false && !selectedIds.has(check.id))
    .map((check) => ({
      id: check.id,
      label: check.label,
      program: check.program,
      device: check.device,
      requires: check.requires,
      status: "SKIPPED_WITH_REASON",
      reason: `opt-in: ${check.optIn || "not requested"}`,
      durationMs: 0,
      startedAt: now,
      finishedAt: now
    }));

  const runner = createNodeProcessRunner();
  const started = Date.now();
  const { report, fatal } = await runAcceptanceHub(runner, {
    repoRoot,
    probes,
    only: selection.map((check) => check.id),
    onResult: (result) => {
      if (options.quiet) return;
      const detail = result.status === "PASS" ? "" : ` — ${result.reason || ""}`;
      console.log(`[${result.status}] ${result.id} (${Math.round(result.durationMs)}ms)${detail}`);
    }
  });
  if (fatal) return fail(fatal);

  const finalReport = buildAcceptanceReport({
    repoRoot,
    results: [...report.results, ...skipped],
    generatedAt: report.generatedAt
  });

  const outFile = options.out || path.join(repoRoot, "artifacts", "host-acceptance", "latest.json");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(finalReport, null, 2), "utf8");

  const record = recordFromReport(finalReport, { branch: currentBranch(repoRoot), revision: currentRevision(repoRoot) });
  const recordFile = options.record || path.join(repoRoot, "artifacts", "host-acceptance", "latest-record.json");
  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), "utf8");

  if (options.json) console.log(JSON.stringify(finalReport, null, 2));
  else {
    console.log("");
    console.log(renderAcceptanceReport(finalReport));
    console.log("");
    console.log(`wall clock: ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`report:     ${path.relative(repoRoot, outFile)}`);
    console.log(`record:     ${path.relative(repoRoot, recordFile)}`);
  }

  return finalReport.overall === "PASS" ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("HOST_ACCEPTANCE_ERROR " + (error && error.stack ? error.stack : String(error)));
    process.exit(2);
  });
