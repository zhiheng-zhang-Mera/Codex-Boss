#!/usr/bin/env node
/**
 * Update-Plan/checkpoint-2.md §7.4 — the authoritative acceptance run's entry point
 * for declaring an Owner intervention.
 *
 *   node scripts/acceptance-intervention.cjs --source <route> --class <HB?> --reason "<why>" [--action "<what>"] [--outcome "<state>"]
 *
 * It records through the one central ledger function. If no acceptance session is
 * active it exits non-zero instead of pretending the event was accounted for.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}
const source = option("source");
const reason = option("reason");
if (!source || !reason) {
  console.error("[intervention] usage: node scripts/acceptance-intervention.cjs --source <route> --reason \"<why>\" [--class HB1_AUTHORITY] [--action \"<what>\"] [--outcome \"<state>\"]");
  process.exit(2);
}
const built = path.join(root, "dist-electron", "electron", "engineering", "owner-intervention-ledger.js");
if (!fs.existsSync(built)) {
  console.error(`[intervention] the built ledger module is missing (run \`pnpm run build\` first): ${built}`);
  process.exit(1);
}
const { recordOwnerIntervention, inspectOwnerLedger } = require(built);
const sessionModule = require(path.join(root, "dist-electron", "electron", "engineering", "acceptance-session.js"));
const { acceptanceDirectory } = sessionModule;

const artifacts = acceptanceDirectory(root);
const session = sessionModule.readSession(artifacts);
if (!session) {
  console.error("[intervention] no acceptance session is active; refusing to record an unaccounted intervention");
  process.exit(1);
}
const event = recordOwnerIntervention({
  source,
  reason,
  ...(option("class") !== undefined ? { blocker_class: option("class") } : {}),
  ...(option("action") !== undefined ? { requested_action: option("action") } : {}),
  ...(option("outcome") !== undefined ? { outcome: option("outcome") } : {})
});
if (!event) {
  console.error("[intervention] the ledger refused the event; the run cannot account for it");
  process.exit(1);
}
const inspection = inspectOwnerLedger(session, artifacts);
console.log(`[intervention] recorded ${event.id} from ${event.source} (${event.blocker_class})`);
console.log(`[intervention] owner interventions for session ${session.session_id}: ${inspection.count}`);
if (inspection.problems.length) {
  console.error(`[intervention] ledger problems: ${inspection.problems.join(", ")}`);
  process.exit(1);
}
