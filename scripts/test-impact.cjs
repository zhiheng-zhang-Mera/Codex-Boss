#!/usr/bin/env node
/**
 * Phase 05 Task A — the impact selector, from the command line.
 *
 * Usage:
 *   node scripts/test-impact.cjs select --base <commit> [--changed <path>]... [--trigger merge-gate|scheduled|promotion]
 *   node scripts/test-impact.cjs audit
 *   node scripts/test-impact.cjs verify --base <commit> [--files <path>]...
 *
 * `select`   answers "which suites does this change require", and always names its reasons.
 * `audit`    reports the catalogue itself: how many suites cover each capability, which
 *            capabilities have NO authoritative suite, and where two suites claim one obligation.
 * `verify`   re-derives the selection and compares it with the full suite's file list, which is the
 *            only way to detect a selector that skipped something it should have run.
 *
 * Runs against the COMPILED Electron modules, so `pnpm run build:electron` must have run. That is
 * deliberate rather than incidental: the selector reads the capability registry and the dependency
 * graph, and those are what the built application actually uses.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const COMPILED = path.join(ROOT, "dist-electron", "electron", "platform");

function loadPlatform() {
  const entry = path.join(COMPILED, "test-impact.js");
  if (!fs.existsSync(entry)) {
    throw new Error("the compiled impact selector is missing: run `pnpm run build:electron` first.");
  }
  return require(entry);
}

function git(args) {
  const result = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function parseArgs(argv) {
  const options = { changed: [], files: [], trigger: undefined, base: undefined };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--base") options.base = argv[++index];
    else if (token === "--changed") options.changed.push(argv[++index]);
    else if (token === "--files") options.files.push(argv[++index]);
    else if (token === "--trigger") options.trigger = argv[++index];
    else { process.stderr.write(`unknown argument: ${token}\n`); process.exitCode = 2; return undefined; }
  }
  return options;
}

/** Every changed file, from an explicit list or from git. `undefined` means "could not be computed". */
function changedFiles(options) {
  if (options.changed.length > 0) return [...options.changed].sort();
  if (!options.base) return undefined;
  const merge = git(["merge-base", "--is-ancestor", options.base, "HEAD"]);
  if (merge.status !== 0) return undefined;
  const diff = git(["diff", "--name-only", `${options.base}...HEAD`]);
  if (diff.status !== 0) return undefined;
  const committed = diff.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [...new Set(committed)].sort();
}

/** The full suite as the repository defines it: every test file the default tier would run. */
function fullSuiteFiles() {
  const platform = loadPlatform();
  return platform.discoverTestFiles(ROOT);
}

function commandSelect(options) {
  const platform = loadPlatform();
  const files = changedFiles(options);
  const changedSetUnknown = options.changed.length === 0 && files === undefined;
  const repository = platform.loadImpactRepository(ROOT);
  const selection = platform.selectForChange(repository, files ?? [], {
    ...(options.trigger === undefined ? {} : { trigger: options.trigger }),
    ...(changedSetUnknown ? { changedSetUnknown: true } : {})
  });
  process.stdout.write(`${JSON.stringify({
    changedFiles: selection.changedFiles,
    seeds: selection.seeds,
    affected: selection.affected,
    selected: selection.selected,
    skipped: selection.skipped,
    fullRunRequired: selection.fullRunRequired,
    fullRunReasons: selection.fullRunReasons,
    unattributedFiles: selection.unattributedFiles,
    blind: selection.blind,
    decisionReason: selection.decisionReason,
    shouldRecord: selection.shouldRecord
  }, null, 2)}\n`);
  // A selection that cannot justify itself is not a success. It fails the command so a caller
  // cannot treat "the selector shrugged" as "the change is safe".
  if (selection.blind) {
    process.stderr.write("the selector chose nothing; a full run is required and this is not a pass\n");
    process.exitCode = 1;
  }
  return 0;
}

function commandAudit() {
  const platform = loadPlatform();
  const repository = platform.loadImpactRepository(ROOT);
  const shared = require(path.join(ROOT, "dist-electron", "src", "shared", "test-impact.js"));
  const covered = new Map();
  for (const suite of repository.catalogue) {
    for (const capabilityId of suite.covers) covered.set(capabilityId, (covered.get(capabilityId) ?? 0) + 1);
  }
  const capabilities = [...repository.modulesByCapability.keys()].sort();
  const uncovered = capabilities.filter((capabilityId) => !covered.has(capabilityId));
  const duplicates = shared.duplicateObligations(repository.catalogue);
  const unattributed = platform.unattributedSourceFiles(ROOT, repository.modulesByCapability);
  process.stdout.write(`${JSON.stringify({
    suites: repository.catalogue.length,
    capabilities: capabilities.length,
    capabilitiesWithoutASuite: uncovered,
    suitesPerCapability: Object.fromEntries(capabilities.map((id) => [id, covered.get(id) ?? 0])),
    alwaysRun: repository.catalogue.filter((suite) => suite.alwaysRun).map((suite) => suite.file),
    duplicateObligations: duplicates,
    sourceFilesOwnedByNoCapability: unattributed,
    note: "a source file owned by no capability cannot select anything, so a change to it forces a full run; this list is the size of that gap"
  }, null, 2)}\n`);
  return 0;
}

function commandVerify(options) {
  const platform = loadPlatform();
  const shared = require(path.join(ROOT, "dist-electron", "src", "shared", "test-impact.js"));
  const files = changedFiles(options);
  const changedSetUnknown = options.changed.length === 0 && files === undefined;
  const repository = platform.loadImpactRepository(ROOT);
  const selection = platform.selectForChange(repository, files ?? [], changedSetUnknown ? { changedSetUnknown: true } : {});
  const fullRun = options.files.length > 0 ? options.files : fullSuiteFiles();
  const audit = shared.auditSelectionAgainstFullRun(selection, fullRun, repository.catalogue);
  process.stdout.write(`${JSON.stringify({ selection: { changedFiles: selection.changedFiles, selected: selection.selected.map((suite) => suite.file), fullRunRequired: selection.fullRunRequired, decisionReason: selection.decisionReason }, audit }, null, 2)}\n`);
  if (!audit.agrees) {
    process.stderr.write(`the selection and the full run disagree:\n  ${audit.problems.join("\n  ")}\n`);
    process.exitCode = 1;
  }
  return 0;
}

const COMMANDS = { select: commandSelect, audit: commandAudit, verify: commandVerify };

function main() {
  const command = process.argv[2];
  if (!command || !COMMANDS[command]) {
    process.stderr.write("usage: node scripts/test-impact.cjs <select|audit|verify> [--base <commit>] [--changed <path>]... [--files <path>]... [--trigger <merge-gate|scheduled|promotion>]\n");
    return 2;
  }
  const options = parseArgs(process.argv.slice(3));
  if (!options) return 2;
  return COMMANDS[command](options);
}

try {
  const code = main();
  if (typeof code === "number") process.exitCode = code;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
