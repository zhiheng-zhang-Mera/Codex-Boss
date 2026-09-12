#!/usr/bin/env node
/**
 * Update-Plan/checkpoint-2.md §5.2/§5.3/§10.1 — start an acceptance session.
 *
 *   node scripts/acceptance-session-start.cjs --certify --clean
 *
 * It fixes the exact commit the run certifies, refuses a dirty working tree in
 * certification mode, and quarantines the previous run's transient evidence into
 * `artifacts/acceptance/history/<session_id>/` so nothing stale can join this
 * session. Run it after build/test and before the first acceptance gate.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const args = process.argv.slice(2);
const certify = args.includes("--certify");
const clean = args.includes("--clean");
const built = path.join(root, "dist-electron", "electron", "engineering", "acceptance-session.js");
if (!fs.existsSync(built)) {
  console.error(`[prestart-session] the built session module is missing (run \`pnpm run build\` first): ${built}`);
  process.exit(1);
}
const { startAcceptanceSession } = require(built);
const outcome = startAcceptanceSession({ root, certify, clean });
if (!outcome.ok) {
  console.error(`[prestart-session] ${outcome.reason}`);
  console.error("[prestart-session] no acceptance session was created; the run cannot be certified");
  process.exit(1);
}
console.log(`[prestart-session] session: ${outcome.session.session_id}`);
console.log(`[prestart-session] commit:  ${outcome.session.commit_sha}`);
console.log(`[prestart-session] mode:    ${outcome.session.certification_mode ? "CERTIFICATION" : "DEVELOPMENT"} (working tree ${outcome.session.working_tree_clean ? "clean" : "dirty"})`);
if (outcome.history) console.log(`[prestart-session] previous evidence archived to history/${outcome.history.label}/ (${outcome.history.moved.length} entr${outcome.history.moved.length === 1 ? "y" : "ies"})`);
console.log(`[prestart-session] manifest: ${path.relative(root, outcome.sessionPath)}`);
