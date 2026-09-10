#!/usr/bin/env node
/**
 * Host-A Phase L: minimal test curation.
 *
 * Removes the heavy/expansion suites from the GitHub-facing test surface,
 * keeping only the retained set documented in MINIMAL-TEST-MAP.md (every
 * retained test must trace to protected subsystems / requirements). Deleted
 * files stay fully recoverable from git history.
 *
 * Run ONLY after the final full regression is green (Host-A §14).
 *
 * Usage:
 *   node scripts/closure-curate-tests.mjs --dry-run   # list what would change
 *   node scripts/closure-curate-tests.mjs --apply     # actually remove
 */
import fs from "node:fs";
import path from "node:path";

const testsDir = path.join("tests", "unit");
const dryRun = !process.argv.includes("--apply");

/** Retained set — mirrors MINIMAL-TEST-MAP.md sections 1..13. */
const RETAINED = [
  // 1. closure terminal evaluator
  "closure-terminal-logic.test.ts",
  // 2. completion / result validation
  "result-validator.test.ts", "gate-runner.test.ts", "verification-contract.test.ts",
  "owner-result-contract.test.ts", "work-escalation-verdict.test.ts",
  // 3. task state
  "task-state-machine.test.ts", "task-ledger.test.ts", "state-waiting.test.ts",
  // 4. retry / recovery / fault isolation
  "recovery-resume-battery.test.ts", "recovery-scheduler.test.ts", "self-healing-battery.test.ts",
  "computer-recovery.test.ts", "execution-fault-injection.test.ts", "multi-fault-isolation.test.ts",
  "degraded-controller-battery.test.ts", "human-guidance-gate.test.ts",
  // 5. Web-AI readiness / repair
  "action-readiness.test.ts", "provider-page-repair.test.ts", "web-recovery-r6.test.ts",
  "dom-page.test.ts", "provider-dom-surface.test.ts",
  // 6. session lifecycle
  "session-lifecycle.test.ts", "conversation-policy.test.ts", "login-scan.test.ts",
  // 7. standalone / fleet
  "standalone-node.test.ts", "node-capabilities.test.ts", "capability-router.test.ts",
  "fleet.test.ts", "fleet-two-node.test.ts",
  // 8. network / proxy
  "network-policy.test.ts",
  // 9. KB fallback / artifact backbone
  "knowledge-phase-f.test.ts",
  // 10. research contract / review / publication
  "research-contract.test.ts", "research-review.test.ts", "research-battery.test.ts",
  "research-partial-failure.test.ts", "research-wait-policy.test.ts",
  // 11. self-iteration
  "worker-response.test.ts", "engineering-goal-rollback.test.ts",
  // 12. UI isolation / status display
  "ui-isolation.test.ts", "owner-dashboard.test.ts",
  // 13. multi-fault acceptance scenarios
  "phase-j-scenarios.test.ts",
];

const present = fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.ts")).sort();
const missing = RETAINED.filter((f) => !present.includes(f));
const toRemove = present.filter((f) => !RETAINED.includes(f));

console.log(JSON.stringify({
  mode: dryRun ? "dry-run" : "apply",
  present: present.length,
  retained: RETAINED.length,
  removeCount: toRemove.length,
  missingFromRetainedSet: missing,
  removing: toRemove,
}, null, 2));

if (missing.length) {
  console.error("RETAINED_SET_INCOMPLETE: listed retained test(s) not present on disk");
  process.exit(2);
}

if (!dryRun) {
  for (const f of toRemove) fs.rmSync(path.join(testsDir, f));
  console.log(`CURATED: removed ${toRemove.length} suites; ${RETAINED.length} retained`);
  const after = fs.readdirSync(testsDir).filter((f) => f.endsWith(".test.ts")).length;
  console.log(`AFTER: ${after} test files present`);
}
