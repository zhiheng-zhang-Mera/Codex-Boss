#!/usr/bin/env node
/**
 * Capability City Phase 1A — paper-evidence consolidation.
 *
 * Specification (normative): docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md, section 13.
 *
 * The continuous stream during construction is artifacts/city/phase1/paper-evidence.ndjson, appended at each
 * checkpoint as the work happened. This script consolidates that stream into the structured
 * artifacts/city/phase1/paper-evidence.json the acceptance record binds, and derives the registers from the
 * records' own classes rather than from a second hand-maintained list — so the two runtime artifacts cannot
 * drift apart, and there is one source of truth for each item.
 *
 * USAGE
 *   node scripts/phase1a-paper-evidence.cjs [--ndjson <path>] [--out <path>]
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_NDJSON = path.join(ROOT, "artifacts", "city", "phase1", "paper-evidence.ndjson");
const DEFAULT_OUT = path.join(ROOT, "artifacts", "city", "phase1", "paper-evidence.json");
const SCHEMA = "city-phase1a-paper-evidence/1";

function main() {
  const argv = process.argv.slice(2);
  const ndjsonIndex = argv.indexOf("--ndjson");
  const outIndex = argv.indexOf("--out");
  const ndjsonPath = ndjsonIndex >= 0 && argv[ndjsonIndex + 1] ? argv[ndjsonIndex + 1] : DEFAULT_NDJSON;
  const outPath = outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : DEFAULT_OUT;

  const raw = fs.readFileSync(ndjsonPath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  const records = [];
  const problems = [];
  lines.forEach((line, index) => {
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      problems.push({ line: index + 1, reason: String(error && error.message) });
    }
  });

  const byClass = {};
  for (const record of records) byClass[record.evidence_class] = (byClass[record.evidence_class] ?? 0) + 1;

  const registers = {
    corrections: records.filter((record) => record.evidence_class === "CORRECTION").map((record) => record.evidence_id),
    failures: records.filter((record) => record.evidence_class === "FAILURE").map((record) => record.evidence_id),
    governance: records.filter((record) => record.evidence_class === "GOVERNANCE").map((record) => record.evidence_id),
    reproduction: records.filter((record) => record.evidence_class === "REPRODUCTION").map((record) => record.evidence_id),
    policy_experiments: records.filter((record) => record.evidence_class === "POLICY_EXPERIMENT").map((record) => record.evidence_id),
    shadow: records.filter((record) => record.evidence_class === "SHADOW_ENFORCEMENT").map((record) => record.evidence_id),
    negative_controls: records.filter((record) => record.evidence_class === "NEGATIVE_CONTROL").map((record) => record.evidence_id),
    measurements: records.filter((record) => record.evidence_class === "MEASUREMENT").map((record) => record.evidence_id),
  };

  const payload = {
    schema: SCHEMA,
    generatedAt: new Date().toISOString(),
    source_ndjson: path.relative(ROOT, ndjsonPath).split(path.sep).join("/"),
    base: { tag: "city-phase0-observatory-v1", commit: "66440c1d360362a0bba38332d385feed41b64acb" },
    spec: "docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md",
    index: "artifacts/city/phase1/paper-evidence-index.md",
    counts: {
      records: records.length,
      by_class: Object.fromEntries(Object.entries(byClass).sort()),
      parse_problems: problems.length,
    },
    registers,
    parse_problems: problems,
    records,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    state: "PAPER_EVIDENCE_WRITTEN",
    path: path.relative(ROOT, outPath).split(path.sep).join("/"),
    records: records.length,
    by_class: payload.counts.by_class,
    parse_problems: problems.length,
  }, null, 2)}\n`);
  return problems.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`paper evidence consolidation failed: ${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
