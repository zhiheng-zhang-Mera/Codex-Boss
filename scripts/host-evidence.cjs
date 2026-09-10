#!/usr/bin/env node
/**
 * Host-M P5 — evidence / artifact inspector CLI.
 *
 *   node scripts/host-evidence.cjs [options]
 *
 * Options
 *   --root PATH        evidence root to inspect (default <repo>/Update-Plan/<program>,
 *                      falling back to <repo>/Update-Plan)
 *   --program NAME     program directory under Update-Plan (default Host-M)
 *   --all-programs     inspect every program under Update-Plan
 *   --orphans          also report evidence nothing in the scan cites (only
 *                      meaningful for a whole-tree scan)
 *   --include a,b      only inspect these subdirectories of the root
 *   --contains TEXT    list only records whose path contains TEXT
 *   --kind KIND        list only records of this kind
 *   --status STATUS    list only records declaring this status
 *   --since ISO        list only records modified at or after ISO
 *   --until ISO        list only records modified at or before ISO
 *   --min-bytes N      list only records at least N bytes
 *   --unreferenced     list only records nothing else cites
 *   --max-files N      scan budget (default 5000; hitting it is reported as degraded)
 *   --compare PATH     compare this baseline root against --root, hashes first
 *   --list             print the matching records as a table
 *   --json             print the inspection JSON
 *   --out PATH         also write the report here
 *
 * Read-only by construction: the inspector opens, hashes and parses artifacts and
 * has no write path. Issues it finds (orphan, invalid, dangling, unexpected) are
 * reported as findings; nothing is repaired, renamed or deleted.
 *
 * Exit codes: 0 no issues found, 1 issues found, 2 the inspection could not run.
 */
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function fail(message, code = 2) {
  console.error(`HOST_EVIDENCE_ERROR ${message}`);
  process.exit(code);
}

function compiled(relative) {
  const file = path.join(repoRoot, "dist-electron", ...relative);
  if (!fs.existsSync(file)) fail(`missing ${path.relative(repoRoot, file)} — run: npx tsc -p tsconfig.electron.json`);
  return require(file);
}

function parseArgs(argv) {
  const options = { json: false, list: false, include: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (value === undefined) fail(`${arg} needs a value`);
      return value;
    };
    if (arg === "--root") options.root = path.resolve(next());
    else if (arg === "--program") options.program = next();
    else if (arg === "--all-programs") options.allPrograms = true;
    else if (arg === "--orphans") options.orphans = true;
    else if (arg === "--include") options.include.push(...next().split(",").map((entry) => entry.trim()).filter(Boolean));
    else if (arg === "--contains") options.contains = next();
    else if (arg === "--kind") options.kind = next();
    else if (arg === "--status") options.status = next();
    else if (arg === "--since") options.since = next();
    else if (arg === "--until") options.until = next();
    else if (arg === "--min-bytes") options.minBytes = Number(next());
    else if (arg === "--unreferenced") options.unreferenced = true;
    else if (arg === "--max-files") options.maxFiles = Number(next());
    else if (arg === "--compare") options.compare = path.resolve(next());
    else if (arg === "--list") options.list = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--out") options.out = path.resolve(next());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else fail(`unknown option ${arg}`);
  }
  return options;
}

function helpText() {
  const source = fs.readFileSync(__filename, "utf8");
  const block = source.slice(source.indexOf("/**") + 3, source.indexOf("*/"));
  return block.split("\n").map((line) => line.replace(/^\s*\* ?/, "")).join("\n");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return 0;
  }

  const { inspectEvidence, compareEvidenceRoots } = compiled(["electron", "host", "evidence-inspector.js"]);
  const { queryEvidence, renderEvidenceInspection } = compiled(["src", "shared", "evidence-inspector.js"]);

  const planRoot = path.join(repoRoot, "Update-Plan");
  const program = options.program || "Host-M";
  const root = options.root || (options.allPrograms ? planRoot : path.join(planRoot, program));
  if (!fs.existsSync(root)) fail(`root does not exist: ${root}`);
  const wholePlan = options.allPrograms === true || path.resolve(root) === path.resolve(planRoot);

  let inspection;
  try {
    inspection = inspectEvidence({
      root,
      repoRoot,
      include: options.include,
      maxFiles: options.maxFiles,
      // A bounded scan cannot see the documents that cite artifacts outside it, so
      // orphan detection is only meaningful across the whole program tree.
      reportOrphans: options.orphans === true || wholePlan
    });
  } catch (error) {
    return fail(String(error && error.stack ? error.stack : error));
  }

  const matches = queryEvidence(inspection.records, {
    kind: options.kind,
    contains: options.contains,
    modifiedFrom: options.since,
    modifiedTo: options.until,
    withStatus: options.status,
    referenced: options.unreferenced ? false : undefined,
    minBytes: options.minBytes
  });

  let comparison;
  if (options.compare) {
    if (!fs.existsSync(options.compare)) fail(`baseline root does not exist: ${options.compare}`);
    comparison = compareEvidenceRoots({ baselineRoot: options.compare, candidateRoot: root, options: { include: options.include, maxFiles: options.maxFiles } });
    if (!options.json) {
      console.log(`Host-M evidence comparison — ${comparison.baseline} -> ${comparison.candidate}`);
      console.log(
        `unchanged ${comparison.summary.unchanged}, modified ${comparison.summary.modified}, added ${comparison.summary.added}, removed ${comparison.summary.removed}`
      );
      for (const entry of comparison.entries) {
        if (entry.change === "UNCHANGED") continue;
        console.log(`  ${entry.change.padEnd(9)} ${entry.path}  ${entry.detail}`);
      }
      console.log("");
    }
  }

  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, JSON.stringify(comparison ? { inspection, comparison } : inspection, null, 2), "utf8");
  }

  if (options.json) {
    console.log(JSON.stringify(comparison ? { inspection, comparison } : inspection, null, 2));
  } else {
    console.log(renderEvidenceInspection(inspection));
    if (options.list) {
      console.log("");
      console.log(`matching records: ${matches.length}`);
      for (const record of matches) {
        const status = record.declaredStatus ? ` [${record.declaredStatus}]` : "";
        console.log(`  ${record.kind.padEnd(20)} ${formatBytes(record.bytes).padStart(10)}  ${record.modifiedAt.slice(0, 10)}  ${record.path}${status}`);
      }
    }
    if (options.out) console.log(`\nreport: ${path.relative(repoRoot, options.out)}`);
  }

  return inspection.issues.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("HOST_EVIDENCE_ERROR " + (error && error.stack ? error.stack : String(error)));
    process.exit(2);
  });
