/**
 * Phase H1 verification — the exact check cleanup.md section 11.1 specifies:
 * every committed JSON file must be parseable by a standard JSON reader.
 *
 * Uses Node's JSON.parse (not a lenient PowerShell cmdlet), on the tree as committed
 * in git, so the verdict describes the committed blobs rather than the working
 * directory.
 *
 * READ-ONLY: writes one JSON report.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i += 1) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const repoRoot = findRepoRoot(__dirname);
process.chdir(repoRoot);

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

const jsonFiles = tracked.filter((f) => f.endsWith(".json"));
const jsonlFiles = tracked.filter((f) => f.endsWith(".jsonl"));

const failures = [];
const bomFiles = [];
let parsed = 0;

for (const f of jsonFiles) {
  let raw;
  try {
    // Read the blob exactly as committed.
    raw = execFileSync("git", ["show", `HEAD:${f}`], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    failures.push({ path: f, error: `could not read blob: ${e.message}` });
    continue;
  }

  // BOM detection on the raw bytes.
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    bomFiles.push(f);
  }

  let text = raw.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip, then parse

  try {
    JSON.parse(text);
    parsed += 1;
  } catch (e) {
    failures.push({ path: f, error: e.message });
  }
}

// JSONL: every non-empty line must parse.
let jsonlLinesParsed = 0;
const jsonlFailures = [];
for (const f of jsonlFiles) {
  let raw;
  try {
    raw = execFileSync("git", ["show", `HEAD:${f}`], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    jsonlFailures.push({ path: f, line: 0, error: `could not read blob: ${e.message}` });
    continue;
  }
  let text = raw.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    try {
      JSON.parse(t);
      jsonlLinesParsed += 1;
    } catch (e) {
      jsonlFailures.push({ path: f, line: i + 1, error: e.message });
    }
  });
}

const report = {
  schemaVersion: 1,
  kind: "BRANCH_CLEANUP_JSON_PARSE_VERIFICATION",
  generatedAt: new Date().toISOString(),
  parsedRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  authority: "Update-Plan/cleanup.md section 11.1 — all committed JSON parseable by standard JSON.parse",
  reader: "Node.js JSON.parse, applied to git blobs at HEAD (UTF-8 BOM stripped before parsing)",
  totals: {
    jsonFiles: jsonFiles.length,
    jsonFilesParsed: parsed,
    jsonFilesFailed: failures.length,
    jsonFilesWithBom: bomFiles.length,
    jsonlFiles: jsonlFiles.length,
    jsonlLinesParsed,
    jsonlLinesFailed: jsonlFailures.length,
  },
  verdict: failures.length === 0 && jsonlFailures.length === 0 && bomFiles.length === 0 ? "PASS" : "FAIL",
  bomFiles,
  failures,
  jsonlFailures,
};

const outPath = path.join(repoRoot, "Update-Plan", "Branch-Cleanup", "evidence", "evidence-cleanup", "json-parse-verification.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log(`revision        : ${report.parsedRevision}`);
console.log(`json files      : ${jsonFiles.length}`);
console.log(`  parsed OK     : ${parsed}`);
console.log(`  failed        : ${failures.length}`);
console.log(`  with BOM      : ${bomFiles.length}`);
console.log(`jsonl files     : ${jsonlFiles.length} (${jsonlLinesParsed} lines parsed, ${jsonlFailures.length} failed)`);
console.log(`VERDICT         : ${report.verdict}`);
if (bomFiles.length) {
  console.log("BOM files:");
  bomFiles.forEach((f) => console.log(`  ${f}`));
}
if (failures.length) {
  console.log("failures:");
  failures.forEach((f) => console.log(`  ${f.path}: ${f.error}`));
}
