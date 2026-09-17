/**
 * `Update-Plan/Platform-Foundation/Phase-08-Production-Qualification-and-Promotion.md` §5 — does the
 * Phase 07 assertion reader over-fit Boss/Vitest?
 *
 * `docs/... Phase-08-...md` §5 requires this to be MEASURED rather than assumed: an external project whose
 * syntax the reader does not understand must fail closed, and the forbidden outcome is
 * `unknown syntax -> assume discriminating`.
 *
 * The reader is lexical and built for `expect(…)` / `assert(…)` / `expectTypeOf(…)` inside
 * `it` / `test` / `describe`. Pointed at a Python project it must find nothing it can call evidence — and
 * "nothing" has to be the verified answer, because the whole safety argument rests on it.
 *
 * Usage: node scripts/qualify-assertion-reader.cjs --repo <path> [--out <file>]
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

function load(relative) {
  const file = path.join(ROOT, "dist-electron", relative);
  if (!fs.existsSync(file)) throw new Error(`the compiled module ${relative} is missing; run \`pnpm run build:electron\` first.`);
  return require(file);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token.startsWith("--")) options[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = typeof options.repo === "string" ? options.repo : "";
  if (!repo.trim()) { process.stderr.write("reader-qualify: --repo is required\n"); return 2; }
  if (!fs.existsSync(repo)) { process.stderr.write(`reader-qualify: ${repo} does not exist\n`); return 2; }

  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
  const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
    .split("\n").filter(Boolean);

  const { summarizeAssertionStrength } = load("src/shared/assertion-shape.js");

  // Every tracked source file the reader could be pointed at. The relevant population is the files that
  // LOOK like tests in their own language, because that is what a change to this repository would add.
  const candidates = tracked.filter((file) => /\.(?:py|js|ts|tsx|mjs|cjs|rb|go|java|rs)$/i.test(file) && !file.includes("__pycache__"));
  const testish = candidates.filter((file) => /(?:^|[/_.-])(?:test|spec|tests)/i.test(file));

  const results = [];
  let accepted = 0;
  for (const file of [...testish, ...candidates.filter((file) => !testish.includes(file))]) {
    const absolute = path.join(repo, file.split("/").join(path.sep));
    let source;
    try { source = fs.readFileSync(absolute, "utf8"); } catch { continue; }
    const strength = summarizeAssertionStrength(source, file);
    if (strength.discriminating > 0) accepted += 1;
    results.push({
      file,
      language: path.extname(file).slice(1),
      isTestNamed: testish.includes(file),
      assertionSites: strength.total,
      discriminating: strength.discriminating,
      inputsNonEmpty: strength.inputs.nonEmpty,
      callInputsNonEmpty: strength.callInputs.nonEmpty
    });
  }

  const report = {
    kind: "ASSERTION_READER_GENERALISATION_PROBE",
    generatedAt: new Date().toISOString(),
    repository: { path: repo, base },
    population: { tracked: tracked.length, sourceFilesScanned: results.length, testNamedFiles: testish.length },
    /**
     * The requirement from that same book document, stated as the pass condition rather than left implied:
     * no file in a non-TypeScript repository may be judged discriminating.
     */
    requirement: "no file in a non-TypeScript repository may be judged discriminating; the reader must fail closed",
    filesJudgedDiscriminating: accepted,
    failsClosed: accepted === 0,
    filesWithAnyAssertionSite: results.filter((entry) => entry.assertionSites > 0).length,
    results: results.filter((entry) => entry.assertionSites > 0 || entry.isTestNamed)
  };

  const out = typeof options.out === "string"
    ? path.resolve(options.out)
    : path.join(ROOT, "artifacts", "platform-foundation", "phase-08", "assertion-reader-generalisation.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`[reader] repo=${path.basename(repo)} base=${base.slice(0, 12)} scanned=${report.population.sourceFilesScanned} testNamed=${testish.length}\n`);
  process.stdout.write(`[reader] files with any readable assertion site: ${report.filesWithAnyAssertionSite}\n`);
  process.stdout.write(`[reader] files judged DISCRIMINATING: ${accepted} (must be 0) -> failsClosed=${report.failsClosed}\n`);
  process.stdout.write(`[reader] evidence: ${path.relative(ROOT, out).split(path.sep).join("/")}\n`);
  return report.failsClosed ? 0 : 1;
}

process.exit(main());
