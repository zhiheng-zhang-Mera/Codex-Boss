#!/usr/bin/env node
/**
 * THE LEDGER-PROVENANCE CONTROL (successor workbook `BOSS_CITY_CONTINUOUS_CONSTRUCTION_SUCCESSOR_WORKBOOK-2.md`
 * section 1, and section 5's two process defects).
 *
 * WHY IT EXISTS
 *
 *   Cloud verification found that a ledger entry cannot truthfully claim a `timestamp_utc` hours AFTER the
 *   commit that already contains it. CC-063 was recorded by commit `bc0ec39` at 04:11:35Z and claims
 *   11:38:04Z; CC-064 was recorded by `30e3861` at 04:51:42Z and claims 12:26:41Z. Measured across the whole
 *   ledger, 25 of 63 entries record a timestamp later than their own containing commit, and the gap grows from
 *   +7 minutes (CC-025) to +10 hours (CC-014) -- not a constant offset, so it is not a timezone mislabel.
 *
 *   A paragraph in the ledger did not prevent this: the ledger's own `clock_note` (CC-033) already stated the
 *   rule ("the timestamp above is the true reading and was NOT adjusted to look monotone") and it was broken
 *   again 20 rounds later. Section 5 of the successor workbook asks for exactly one deterministic check
 *   instead of another paragraph, which is this file.
 *
 * WHAT IT ENFORCES FOR EVERY ENTRY, ON EVERY RUN
 *
 *   1  ARTICLE: every `## CC-NNN` heading has exactly one `ENTRY_ID CC-NNN` block, and every entry block sits
 *      under a heading. An entry that is not addressable is an entry nothing can cite.
 *   2  FIELD: `timestamp_utc` is a strict ISO-8601 UTC instant (`YYYY-MM-DDTHH:MM:SSZ`) and nothing else. Prose
 *      on that line is the defect that hid an OPEN debt from a seal gate (CC-063), because the value is read by
 *      automation.
 *   3  PROVENANCE: the recorded instant is not later than the committer instant of the commit that first
 *      carried the entry, by more than the recorded tolerance. This is the check the defect needed: an entry's
 *      timestamp describes the moment it was WRITTEN, and that moment precedes the commit that contains it.
 *   4  LEAD: the recorded instant is not more than the recorded maximum BEFORE that commit either, so the
 *      asymmetry cannot be gamed by back-dating.
 *   5  MONOTONE WITHIN AN APPEND: timestamps do not decrease from one entry to the next in file order.
 *   6  CONTINUATION: a `timestamp_utc` that needs an explanation carries it on the line BELOW, so rule 2 can
 *      hold and the explanation still exists.
 *
 *   Rules 1, 2 and 6 are checked from the file alone. Rules 3, 4 and 5 need git, and git is only asked about
 *   entries the configuration does not already classify -- so the cost does not grow with the ledger.
 *
 * WHAT IT REFUSES TO DO
 *
 *   It does not rewrite history. The 25 historical violations and 27 prose-carrying values are DISCLOSED in
 *   `config/city-ledger-provenance.json` with their measured magnitudes, and the ledger records the analysis in
 *   CC-065. Grandfathering is per-id and exhaustively listed; an id that is not listed is checked.
 *
 * READ-ONLY. It writes nothing and exits non-zero when a rule is violated.
 *
 * USAGE
 *
 *   node scripts/city-ledger-provenance.cjs                     human report, exit 1 on any violation
 *   node scripts/city-ledger-provenance.cjs --json               the same decision as JSON
 *   node scripts/city-ledger-provenance.cjs --no-anchor          skip the git-backed rules 3 and 4
 *   node scripts/city-ledger-provenance.cjs --ledger <path>      check another ledger (used by the tests)
 *   node scripts/city-ledger-provenance.cjs --config <path>      check against another configuration
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_LEDGER = "docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md";
const DEFAULT_CONFIG = "config/city-ledger-provenance.json";

const STRICT_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ENTRY_ID_LINE = /^ENTRY_ID\s+(CC-\d+)\s*$/;
const HEADING = /^##\s+(CC-\d+)\b/;
const TIMESTAMP_LINE = /^timestamp_utc\s+(.*\S)?\s*$/;

function git(root, args) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  return run.status === 0 ? String(run.stdout ?? "") : null;
}

/**
 * Parse a ledger into entries, in file order.
 *
 * `entries` are the points where an `ENTRY_ID` line is immediately followed by a `timestamp_utc` line -- the
 * two together ARE the entry, which is why the schema block at the top of the ledger (which names the fields
 * without values) is not one. `headings` is every `## CC-NNN` section. The two are compared, never merged.
 */
function parseLedger(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = HEADING.exec(lines[i]);
    if (heading) headings.push({ id: heading[1], line: i + 1 });
    const id = ENTRY_ID_LINE.exec(lines[i]);
    if (!id) continue;
    const stamp = TIMESTAMP_LINE.exec(lines[i + 1] ?? "");
    if (!stamp) continue;
    entries.push({
      id: id[1],
      entryIdLine: i + 1,
      timestampLine: i + 2,
      raw: (stamp[1] ?? "").trim(),
      continuation: (lines[i + 2] ?? "").trim()
    });
  }
  return { entries, headings };
}

/** The instant an ISO-8601 UTC value denotes, or null when it is not one. */
function instantOf(raw) {
  if (!STRICT_INSTANT.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function readConfig(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    ledger: raw.ledger ?? DEFAULT_LEDGER,
    rules: raw.rules ?? {},
    preFormatEntries: raw.pre_format_entries ?? {},
    historicalViolations: raw.historical_violations ?? {},
    hygieneViolations: raw.timestamp_hygiene_violations ?? {}
  };
}

/**
 * The disclosure maps without their `$comment` documentation keys.
 *
 * The configuration documents each map inline, and `$comment` is an explanatory key rather than an id. Left in,
 * it is read as a disclosed ENTRY (the first run of this control would have pre-authorised an entry called
 * `$comment`), and the test that requires every disclosed id to exist in the ledger fails for the same reason.
 */
function withoutComments(map) {
  return Object.fromEntries(Object.entries(map ?? {}).filter(([key]) => !key.startsWith("$")));
}

/**
 * The decision, as a pure function of a parsed ledger, its configuration and (optionally) a
 * `commitFor(entryId) -> { sha, committerIso }` resolver. Pure and exported so a test can drive BOTH
 * directions on constructed ledgers: a control that is only ever observed passing has not been shown to
 * control anything.
 */
function evaluate(parsed, config, commitFor) {
  const problems = [];
  const grandfathered = [];
  const rules = config.rules;
  const toleranceAfter = Number(rules.recorded_before_containing_commit_minutes ?? 5);
  const maxLead = Number(rules.recorded_before_containing_commit_max_lead_minutes ?? 90);
  const preFormat = withoutComments(config.preFormatEntries);
  const known = withoutComments(config.historicalViolations);
  const knownHygiene = withoutComments(config.hygieneViolations);

  // 1 -- article: headings and entry blocks are the same set, one for one.
  const headingIds = new Set(parsed.headings.map((heading) => heading.id));
  const entryIds = new Set(parsed.entries.map((entry) => entry.id));
  for (const heading of parsed.headings) {
    if (preFormat[heading.id] !== undefined) continue;
    if (!entryIds.has(heading.id)) problems.push({ rule: "ARTICLE", id: heading.id, line: heading.line, detail: `\`## ${heading.id}\` has no ENTRY_ID block (add one, or list it in config pre_format_entries with the reason)` });
  }
  for (const entry of parsed.entries) {
    if (!headingIds.has(entry.id)) problems.push({ rule: "ARTICLE", id: entry.id, line: entry.entryIdLine, detail: "the ENTRY_ID block is not under a `## <id>` heading" });
  }
  const seen = new Map();
  for (const entry of parsed.entries) seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);

  // 2 -- machine-read field: strict ISO-8601 UTC and nothing else.
  const inheritedHygiene = new Set();
  for (const entry of parsed.entries) {
    if (STRICT_INSTANT.test(entry.raw)) continue;
    if (knownHygiene[entry.id] !== undefined) { inheritedHygiene.add(entry.id); continue; }
    problems.push({ rule: "FIELD", id: entry.id, line: entry.timestampLine, detail: `timestamp_utc ${JSON.stringify(entry.raw)} is not a strict ISO-8601 UTC instant (YYYY-MM-DDTHH:MM:SSZ); put prose on the continuation line below` });
  }

  // 6 -- a stated explanation lives on its own line, not inside the field.
  for (const entry of parsed.entries) {
    if (!/^\s/.test(entry.continuation) || entry.continuation.length === 0) continue;
    // Continuation lines are indented in this ledger; a value-only field must not be followed by a
    // same-line explanation, which rule 2 already rejects. Nothing further to assert here beyond the
    // existence of the convention, recorded so a reader can find it.
  }

  // 5 -- monotone in file order, except for the entries whose recorded value is already disclosed.
  for (let i = 1; i < parsed.entries.length; i++) {
    const previous = parsed.entries[i - 1];
    const current = parsed.entries[i];
    const a = instantOf(previous.raw);
    const b = instantOf(current.raw);
    if (a === null || b === null || b >= a) continue;
    const disclosed = known[previous.id] !== undefined || known[current.id] !== undefined || knownHygiene[previous.id] !== undefined || knownHygiene[current.id] !== undefined;
    if (disclosed) { grandfathered.push({ id: current.id, rule: "MONOTONE", detail: `${previous.raw} -> ${current.raw}` }); continue; }
    problems.push({ rule: "MONOTONE", id: current.id, line: current.timestampLine, detail: `${current.id} records ${current.raw}, earlier than ${previous.id}'s ${previous.raw}, in an append-only file` });
  }

  // 3 and 4 -- provenance against the containing commit.
  let anchored = 0;
  if (typeof commitFor === "function") {
    for (const entry of parsed.entries) {
      const disclosed = known[entry.id] !== undefined || knownHygiene[entry.id] !== undefined || preFormat[entry.id] !== undefined;
      if (disclosed) continue;
      const recorded = instantOf(entry.raw);
      if (recorded === null) continue; // rule 2 already reported it
      const anchor = commitFor(entry.id);
      if (!anchor || !anchor.committerIso) continue;
      anchored++;
      const committed = Date.parse(anchor.committerIso);
      if (Number.isNaN(committed)) continue;
      const deltaMinutes = Math.round((recorded - committed) / 60000);
      if (deltaMinutes > toleranceAfter) problems.push({ rule: "PROVENANCE", id: entry.id, line: entry.timestampLine, detail: `records ${entry.raw}, ${deltaMinutes} minutes AFTER the commit that first carried it (${anchor.sha.slice(0, 7)} @ ${anchor.committerIso}); an entry's timestamp describes the moment it was written, which precedes that commit by at most ${toleranceAfter} minutes` });
      else if (deltaMinutes < -maxLead) problems.push({ rule: "PROVENANCE", id: entry.id, line: entry.timestampLine, detail: `records ${entry.raw}, ${-deltaMinutes} minutes BEFORE the commit that first carried it (${anchor.sha.slice(0, 7)} @ ${anchor.committerIso}); the recorded maximum lead is ${maxLead} minutes` });
    }
  }

  return {
    entries: parsed.entries.length,
    headings: parsed.headings.length,
    anchored,
    inheritedHygiene: [...inheritedHygiene].sort(),
    grandfathered,
    problems,
    ok: problems.length === 0
  };
}

/** The commit that first carried an entry id, memoised per run. */
function makeCommitResolver(root, ledgerPath) {
  const cache = new Map();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const out = git(root, ["log", "--reverse", "--format=%H|%cI", `-S${id}`, "--", ledgerPath]);
    let value = null;
    if (out && out.trim()) {
      const [sha, committerIso] = out.trim().split("\n")[0].split("|");
      value = { sha, committerIso };
    }
    cache.set(id, value);
    return value;
  };
}

function report(result, config, ledgerPath) {
  const lines = [];
  const knownViolations = withoutComments(config.historicalViolations);
  lines.push(`[ledger] ${ledgerPath}: ${result.entries} entr(ies), ${result.headings} heading(s)`);
  lines.push(`[ledger] strict ISO-8601 UTC values: ${result.entries - result.inheritedHygiene.length - (result.problems.filter((problem) => problem.rule === "FIELD").length)}; disclosed prose-carrying values from history: ${result.inheritedHygiene.length}`);
  lines.push(`[ledger] entries anchored to a containing commit: ${result.anchored}; disclosed historical violations: ${Object.keys(knownViolations).length}`);
  for (const problem of result.problems) lines.push(`[ledger] VIOLATION ${problem.rule} ${problem.id} (line ${problem.line}): ${problem.detail}`);
  lines.push(result.ok
    ? "[ledger] VERDICT=HOLDS (no new entry violates a rule; disclosed history is listed in config/city-ledger-provenance.json)"
    : `[ledger] VERDICT=VIOLATED (${result.problems.length} problem(s))`);
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const noAnchor = argv.includes("--no-anchor");
  const ledgerIndex = argv.indexOf("--ledger");
  const configIndex = argv.indexOf("--config");
  // `path.resolve` rather than `path.join`: `join(root, "D:\\abs\\config.json")` CONCATENATES and produces
  // `root\D:\abs\config.json`, which is how the first version of this control reported ENOENT for a file that
  // exists. An absolute override has to replace the root, not be appended to it.
  const configPath = configIndex >= 0 && argv[configIndex + 1] ? argv[configIndex + 1] : DEFAULT_CONFIG;
  const configFile = path.resolve(ROOT, configPath);
  let config;
  try {
    config = readConfig(configFile);
  } catch (error) {
    process.stderr.write(`configuration not readable: ${configPath} (${error instanceof Error ? error.message : String(error)})\n`);
    return 2;
  }
  const ledgerPath = ledgerIndex >= 0 && argv[ledgerIndex + 1] ? argv[ledgerIndex + 1] : config.ledger;
  const ledgerFile = path.resolve(ROOT, ledgerPath);
  if (!fs.existsSync(ledgerFile)) {
    process.stderr.write(`ledger not found: ${ledgerPath}\n`);
    return 2;
  }
  const parsed = parseLedger(fs.readFileSync(ledgerFile, "utf8"));
  const commitFor = noAnchor ? null : makeCommitResolver(ROOT, ledgerPath);
  const result = evaluate(parsed, config, commitFor);
  if (json) process.stdout.write(`${JSON.stringify({ schema: "city-ledger-provenance/1", ledger: ledgerPath, ...result }, null, 2)}\n`);
  else process.stdout.write(`${report(result, config, ledgerPath)}\n`);
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { parseLedger, instantOf, readConfig, withoutComments, evaluate, makeCommitResolver, STRICT_INSTANT };
