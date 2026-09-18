/**
 * Phase 08 — measure the assertion dialect a real external repository actually uses.
 *
 * `Update-Plan/Platform-Foundation/Phase-08-Production-Qualification-and-Promotion.md` §5 requires
 * over-fitting to be found by real exposure and fixed only to the extent that exposure proves. This
 * script IS the exposure: it reports, per repository, which assertion call forms appear and which of
 * them the Phase 07 reader currently recognises as a matcher.
 *
 * Usage: node scripts/measure-assertion-dialect.cjs --repo <path> [--out <file>]
 */
const fs = require("node:fs");
const path = require("node:path");

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

/** Every `assert.<method>(`, `expect(`, `expectTypeOf(` form, counted. */
function countForms(source) {
  const forms = {};
  for (const match of source.matchAll(/\b(assert|expect|expectTypeOf)\s*(?:\.\s*([A-Za-z_$][\w$]*))?\s*\(/g)) {
    const form = match[2] ? `${match[1]}.${match[2]}` : `${match[1]}(`;
    forms[form] = (forms[form] ?? 0) + 1;
  }
  return forms;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = typeof options.repo === "string" ? options.repo : "";
  if (!repo.trim() || !fs.existsSync(repo)) { process.stderr.write("dialect: --repo <existing path> is required\n"); return 2; }

  const files = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(repo, relative), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "lib") continue;
      const next = relative ? path.join(relative, entry.name) : entry.name;
      if (entry.isDirectory()) { walk(next); continue; }
      if (/\.(?:js|mjs|cjs|ts|tsx)$/.test(entry.name)) files.push(next.split(path.sep).join("/"));
    }
  };
  walk("");

  const tests = files.filter((file) => /(?:^|\/)(?:tests?|__tests__)\//.test(file) || /\.(?:test|spec)\./.test(file));
  const totals = {};
  for (const file of tests) {
    for (const [form, count] of Object.entries(countForms(fs.readFileSync(path.join(repo, file.split("/").join(path.sep)), "utf8")))) {
      totals[form] = (totals[form] ?? 0) + count;
    }
  }

  // What the READER currently sees in the same population: assertion sites it can name, and how many it
  // judges discriminating.
  const { summarizeAssertionStrength } = load("src/shared/assertion-shape.js");
  let sites = 0;
  let discriminating = 0;
  const perFile = [];
  for (const file of tests) {
    const strength = summarizeAssertionStrength(fs.readFileSync(path.join(repo, file.split("/").join(path.sep)), "utf8"), file);
    sites += strength.total;
    discriminating += strength.discriminating;
    perFile.push({ file, sites: strength.total, discriminating: strength.discriminating, callInputsNonEmpty: strength.callInputs.nonEmpty });
  }

  const report = {
    kind: "ASSERTION_DIALECT_MEASUREMENT",
    generatedAt: new Date().toISOString(),
    repository: path.basename(repo),
    testFiles: tests.length,
    assertionForms: Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1])),
    reader: { sitesReadable: sites, judgedDiscriminating: discriminating, perFile }
  };

  const out = typeof options.out === "string"
    ? path.resolve(options.out)
    : path.join(ROOT, "artifacts", "platform-foundation", "phase-08", `dialect-${path.basename(repo)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`[dialect] ${report.repository}: ${tests.length} test file(s)\n`);
  for (const [form, count] of Object.entries(report.assertionForms)) process.stdout.write(`[dialect]   ${form.padEnd(18)} ${count}\n`);
  process.stdout.write(`[dialect] reader: ${sites} assertion site(s) readable, ${discriminating} judged discriminating\n`);
  process.stdout.write(`[dialect] evidence: ${path.relative(ROOT, out).split(path.sep).join("/")}\n`);
  return 0;
}

process.exit(main());
