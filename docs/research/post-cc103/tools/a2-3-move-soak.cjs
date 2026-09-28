"use strict";
// A2-3 (docs/city/PHASE_A_DECISION_A2.md): `electron/state-core/platform-soak.ts` is the platform SOAK — a test
// instrument that drives a real database, writes the gate-6 soak report, and applies shared soak bounds. It is not
// Core behaviour, and it is the file that makes the `state-core` KERNEL reach `status` (soak-harness) and
// `knowledge` (data-retention, knowledge-staleness).
//
// It has no production importer anywhere: the only code that loads it is scripts/platform-soak.cjs and one unit
// test. So the repair is a MOVE into the capability that owns the soak vocabulary it already depends on, with the
// four state-core primitives it drives reached as a feature -> kernel import, which is the allowed direction.
const fs = require("node:fs");
const path = require("node:path");

const FROM = "electron/state-core/platform-soak.ts";
const TO = "electron/status/platform-soak.ts";
const REPLACEMENTS = [
  ['from "./database"', 'from "../state-core/database"'],
  ['from "./event-journal"', 'from "../state-core/event-journal"'],
  ['from "./state-repository"', 'from "../state-core/state-repository"'],
  ['from "./transaction"', 'from "../state-core/transaction"'],
];

if (fs.existsSync(TO) || !fs.existsSync(FROM)) {
  console.error("REFUSED: expected the file at " + FROM + " and nothing at " + TO);
  process.exit(1);
}
let source = fs.readFileSync(FROM, "utf8");
for (const [from, to] of REPLACEMENTS) {
  if (!source.includes(from)) { console.error("REFUSED: pattern not found: " + from); process.exit(1); }
  source = source.split(from).join(to);
}
fs.mkdirSync(path.dirname(TO), { recursive: true });
fs.writeFileSync(TO, source);
fs.unlinkSync(FROM);
console.log("moved", FROM, "->", TO, "and rewrote", REPLACEMENTS.length, "imports");
