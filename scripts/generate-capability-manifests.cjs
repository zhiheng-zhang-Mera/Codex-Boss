#!/usr/bin/env node
/**
 * Generate the Phase 01 capability manifests.
 *
 * The manifests are data derived from one table, so they are written from that table
 * rather than transcribed by hand: a hand-written set is where two files end up
 * disagreeing about a boot module path, and the ratchet would then be enforcing a
 * typo. This script is the single source for the feature tier; the three kernel
 * manifests (`persistence`, `runtime`, `providers`) and the two with a considered
 * dependency edge (`knowledge`, `research`) are hand-written with their rationale.
 *
 * Run: node scripts/generate-capability-manifests.cjs
 * It is idempotent: running it twice produces byte-identical files.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "config", "capabilities");

/** `namespace: owner` is always the declaring capability — a manifest may only claim its own state. */
function manifest(entry) {
  const lines = [];
  lines.push(`id: ${entry.id}`);
  lines.push("version: 1.0.0");
  lines.push("kind: feature");
  lines.push("provides:");
  for (const provided of entry.provides) lines.push(`  - ${provided}`);
  if (entry.requires && entry.requires.length > 0) {
    lines.push("requires:");
    for (const requirement of entry.requires) {
      lines.push(`  - ref: ${requirement.ref}`);
      lines.push(`    reason: ${requirement.reason}`);
    }
  } else {
    lines.push("requires: []");
  }
  lines.push("optional: []");
  if (entry.state && entry.state.length > 0) {
    lines.push("state:");
    for (const namespace of entry.state) {
      lines.push(`  - namespace: ${namespace}`);
      lines.push(`    owner: ${entry.id}`);
    }
  } else {
    lines.push("state: []");
  }
  lines.push("health:");
  lines.push("  critical: false");
  // A bare `modules:` key parses as null, not as an empty list, so an empty list is
  // spelled explicitly. The same applies to surface below.
  if (entry.bootModules.length === 0) {
    lines.push("modules: []");
    lines.push("bootModules: []");
  } else {
    lines.push("modules:");
    for (const module of entry.bootModules) lines.push(`  - ${module}`);
    lines.push("bootModules:");
    for (const module of entry.bootModules) lines.push(`  - ${module}`);
  }
  lines.push("surface: []");
  lines.push("permissions: []");
  lines.push("");
  return lines.join("\n");
}

/**
 * The feature tier.
 *
 * `bootModules` is the composition root's own unit of wiring: each entry is one
 * `electron/bootstrap/*.ts` factory the root calls, so the mapping to the 24 boot
 * modules is checkable in both directions. `provides` names the contract the module
 * exposes rather than its file, which is what a dependent is allowed to reference.
 */
const FEATURES = [
  { id: "engineering", provides: ["engineering.service@1", "engineering.learning@1"], bootModules: ["electron/bootstrap/engineering.ts", "electron/bootstrap/engineering-surface-ipc.ts"], state: [] },
  { id: "task-creation", provides: ["task.creation@1"], bootModules: ["electron/bootstrap/task-creation-ipc.ts"], state: [] },
  { id: "tasks", provides: ["task.lifecycle@1", "task.state@1"], bootModules: ["electron/bootstrap/task-lifecycle-ipc.ts", "electron/bootstrap/task-state-ipc.ts"], state: [] },
  { id: "conversation", provides: ["conversation.registry@1"], bootModules: ["electron/bootstrap/conversation-ipc.ts"], state: [] },
  { id: "workspace", provides: ["workspace.selection@1"], bootModules: ["electron/bootstrap/workspace-ipc.ts"], state: [] },
  { id: "attachments", provides: ["attachment.store@1"], bootModules: ["electron/bootstrap/attachment-ipc.ts"], state: [] },
  { id: "settings", provides: ["settings.ipc@1", "settings.panes@1"], bootModules: ["electron/bootstrap/settings-ipc.ts"], state: [] },
  { id: "host-status", provides: ["host.status@1"], bootModules: ["electron/bootstrap/host-status-ipc.ts"], state: [] },
  { id: "status", provides: ["status.snapshot@1"], bootModules: ["electron/bootstrap/status-ipc.ts"], state: [] },
  { id: "dispatch", provides: ["dispatch.task@1"], bootModules: ["electron/bootstrap/dispatch-ipc.ts"], state: [] },
  { id: "identity", provides: ["identity.session@1"], bootModules: [], state: [] },
  { id: "security", provides: ["security.permission@1"], bootModules: [], state: [] },
  { id: "project", provides: ["project.state@1"], bootModules: [], state: [] },
  { id: "experience", provides: ["experience.record@1"], bootModules: [], state: [] },
  { id: "node", provides: ["node.capability@1"], bootModules: [], state: [] },
  { id: "tenx", provides: ["tenx.artifact@1", "tenx.network@1"], bootModules: [], state: [] },
  { id: "promotion", provides: ["promotion.gate@1"], bootModules: [], state: [] },
  { id: "learning", provides: ["learning.episode@1"], bootModules: [], state: [] },
  { id: "remote", provides: ["remote.relay@1"], bootModules: [], state: [] }
];

let written = 0;
for (const entry of FEATURES) {
  const file = path.join(OUT, `${entry.id}.yaml`);
  fs.writeFileSync(file, manifest(entry), "utf8");
  written++;
}
console.log(`wrote ${written} feature manifests under config/capabilities`);
