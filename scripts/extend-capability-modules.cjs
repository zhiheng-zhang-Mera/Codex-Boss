#!/usr/bin/env node
/**
 * Extend `config/capability-modules.json` to cover the rest of the source tree (Phase 05, Task A).
 *
 * The first pass mapped 71 paths and left 484 source files owned by no capability — half the tree,
 * which would have made the selector force a full run for most changes and be useless. This pass
 * assigns every remaining source file deterministically:
 *
 *   - `electron/<dir>` and `src/shared/<name>.ts` follow the table below, which pairs a path prefix
 *     with the capability whose behaviour it implements;
 *   - the composition root is written into `composition_root`, a third class beside `capabilities` and
 *     `exempt`, because it is owned by the platform and by no capability;
 *   - anything matching no rule is written into `exempt` WITH A REASON, so an unowned file is a
 *     recorded decision rather than an oversight. The engine reports that list, so it cannot grow
 *     quietly.
 *
 * Idempotent: rerunning rewrites the same file from the same table.
 *
 * Run: node scripts/extend-capability-modules.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG = path.join(ROOT, "config", "capability-modules.json");

/** Additional owned paths, by capability. Directories are listed as directories. */
const EXTRA = {
  providers: [
    "electron/computer",
    "electron/adapters",
    "electron/software",
    "electron/input/provider-capability-registry.ts",
    "electron/input/github-resolver.ts",
    "src/shared/provider-capabilities.ts",
    // The provider contract closure, extracted from src/shared/contracts.ts so that the provider types are owned
    // by the capability they describe rather than by `status`. See docs/city/PHASE2_P2A_PROVIDER_CLOSURE.md.
    "src/shared/provider-contracts.ts",
    "src/shared/provider-intelligence.ts",
    "src/shared/provider-outcome.ts",
    "src/shared/provider-policy.ts",
    "src/shared/provider-profile.ts",
    "src/shared/provider-state.ts",
    "src/shared/provider-view-profile.ts",
    "src/shared/network-policy.ts",
    "src/shared/computer-recovery.ts",
    "src/shared/semantic.ts",
    "src/shared/perception.ts",
    "src/shared/software-adapter.ts",
    "src/shared/software-commands.ts",
    "src/shared/software-session.ts",
    "src/shared/adaptive-routing.ts",
    "src/shared/cheapest-execution.ts",
    "src/shared/capability-router.ts",
    "src/shared/login-scan.ts",
    "src/shared/external-compatibility.ts"
  ],
  promotion: [
    "electron/self-evolution",
    "src/shared/autonomous-evolution-identity.ts",
    "src/shared/autonomous-evolution-trust.ts",
    "src/shared/behaviour-epoch.ts",
    "src/shared/candidate-gate.ts",
    "src/shared/evolution-trial-surface.ts",
    "src/shared/self-modification.ts",
    "src/shared/trust-problems.ts",
    "src/shared/root-authority"
  ],
  engineering: [
    "src/shared/engineering-loop.ts",
    "src/shared/correction.ts",
    "electron/self-engineering",
    "src/shared/ci-repair.ts",
    "src/shared/regression-sentinel.ts",
    "src/shared/self-healing-battery.ts",
    "src/shared/self-diagnosis.ts",
    "src/shared/capability-gap.ts",
    "src/shared/verification.ts",
    "src/shared/execution-planner.ts",
    "src/shared/version-impact.ts",
    "src/shared/git-checkpoint.ts",
    "src/shared/recovery.ts",
    "src/shared/review.ts",
    "src/shared/review-checks.ts",
    "src/shared/council-engine.ts",
    "src/shared/fault-lab.ts",
    "src/shared/hardening-matrix.ts",
    "src/shared/guardian.ts"
  ],
  knowledge: [
    "src/shared/knowledge.ts",
    "src/shared/knowledge-claim.ts",
    "src/shared/knowledge-extraction.ts",
    "src/shared/knowledge-governance.ts",
    "src/shared/knowledge-object.ts",
    "src/shared/knowledge-retrieval-guard.ts",
    "src/shared/knowledge-space.ts",
    "src/shared/knowledge-staleness.ts",
    "src/shared/data-lifecycle.ts",
    "src/shared/data-retention.ts",
    "src/shared/learned-concept.ts",
    "src/shared/learning-episode.ts",
    "src/shared/archive-policy.ts",
    "src/shared/workbook-knowledge.ts"
  ],
  research: [
    "src/shared/research-adjudicate.ts",
    "src/shared/research-battery.ts",
    "src/shared/research-bibliography.ts",
    "src/shared/research-capability-registry.ts",
    "src/shared/research-citation.ts",
    "src/shared/research-command.ts",
    "src/shared/research-contract.ts",
    "src/shared/research-figures.ts",
    "src/shared/research-input.ts",
    "src/shared/research-ir.ts",
    "src/shared/research-levela.ts",
    "src/shared/research-levelb.ts",
    "src/shared/research-manuscript.ts",
    "src/shared/research-protocol.ts",
    "src/shared/research-review.ts",
    "src/shared/research-roles.ts",
    "src/shared/research-statistics.ts"
  ],
  workspace: [
    "src/shared/workspace.ts",
    "src/shared/workspace-layout.ts",
    "src/shared/workspace-path.ts",
    "src/shared/workspace-selection.ts",
    "src/shared/project-tree.ts",
    "src/shared/repo-world-model.ts",
    "src/shared/context-capsule.ts",
    "src/shared/context-fingerprint.ts"
  ],
  theme: [
    "src/shared/theme.ts",
    "src/shared/theme-generation.ts",
    "src/shared/theme-intent.ts",
    "src/shared/theme-visual-check.ts",
    "src/shared/ui-surface.ts",
    "src/shared/ui-surface-ids.ts"
  ],
  tenx: [
    "src/shared/tenx/artifact.ts",
    "src/shared/tenx/contracts.ts",
    "src/shared/tenx/fleet.ts",
    "src/shared/tenx/index.ts",
    "src/shared/tenx/inspection.ts",
    "src/shared/tenx/knowledge.ts",
    "src/shared/tenx/network.ts",
    "src/shared/tenx/node.ts",
    "src/shared/tenx/scheduler.ts",
    "src/shared/tenx/session.ts",
    "src/shared/fleet.ts",
    "src/shared/node-capabilities.ts",
    "src/shared/autonomy-supervisor.ts",
    "src/shared/coordination-economics.ts",
    "src/shared/coordination-ledger.ts",
    "src/shared/microtask.ts",
    "src/shared/resource-model.ts"
  ],
  persistence: [
    "src/shared/decision-ledger.ts",
    "src/shared/session-lifecycle.ts",
    "src/shared/session-state.ts",
    "src/shared/external-session.ts",
    "src/shared/hash.ts",
    "src/shared/evaluation.ts",
    "src/shared/compatibility.ts",
    "src/shared/policy.ts",
    "src/shared/config-layering.ts",
    "src/shared/dsh-presets.ts"
  ],
  tasks: [
    "src/shared/task-contract.ts",
    "src/shared/task-fingerprint.ts",
    "src/shared/task-ir.ts",
    "src/shared/task-presentation.ts",
    "src/shared/task-timeline.ts",
    "src/shared/input-object.ts",
    "src/shared/action-readiness.ts",
    "src/shared/result-validator.ts",
    "src/shared/workbook.ts",
    "src/shared/workbook-dispatch.ts",
    "src/shared/execution.ts",
    "src/shared/progress.ts",
    "src/shared/final-response.ts",
    "src/shared/worker-response.ts",
    "src/shared/work-mode.ts",
    "src/shared/intervention.ts",
    "src/shared/auto-handoff.ts",
    "src/shared/conversation-policy.ts",
    "src/shared/requirements-graph.ts",
    "src/shared/publish-plan.ts",
    "src/shared/model-policy.ts",
    "src/shared/model-identity.ts",
    "src/shared/prompt-layout.ts",
    "src/shared/adaptive-flags.ts",
    "src/shared/host-maturity-flags.ts"
  ],
  status: [
    "src/shared/owner-dashboard.ts",
    "src/shared/owner-result.ts",
    "src/shared/owner-intervention.ts",
    "src/shared/doctor.ts",
    "src/shared/host-observer.ts",
    "src/shared/evidence-inspector.ts",
    "src/shared/evidence-ledger.ts",
    "src/shared/soak.ts",
    "src/shared/soak-harness.ts",
    "src/shared/final-acceptance.ts",
    "src/shared/acceptance-contracts.ts",
    "src/shared/acceptance-evidence.ts",
    "src/shared/acceptance-hub.ts",
    "src/shared/acceptance-record.ts",
    "src/shared/desktop-black-box-contract.ts",
    "src/shared/contracts.ts",
    // Self Cognition: Boss's description of its own components, capabilities and authority
    // boundaries. It observes the anatomy; it does not diagnose it and cannot change it.
    "src/shared/self-cognition",
    "electron/self-cognition",
    // Self Diagnosis: reads what the application already recorded through the generic
    // SelfObservationSource interface, ranks candidate causes and proposes advisory treatments.
    // It owns none of the sources it reads and cannot execute what it proposes.
    "src/shared/self-diagnosis",
    "electron/self-diagnosis",
    // Case Record: what happened, what was thought, what was done and how it turned out, as an
    // append-only timeline. It records; it does not diagnose, repair or define the self model.
    "src/shared/self-case-record",
    "electron/self-case-record"
  ],
  security: [
    "electron/github",
    "src/shared/github-machine.ts",
    "src/shared/github-url.ts",
    "src/shared/secret-scan.ts",
    "src/shared/secret-vault.ts",
    "src/shared/permission.ts"
  ],
  experience: [
    "src/shared/experience.ts",
    "electron/experience"
  ],
  runtime: [
    "electron/platform",
    "electron/platform/coordination-store.ts",
    "electron/capability",
    "electron/bootstrap/boot-module.ts",
    "electron/bootstrap/shared/require-provider.ts",
    "electron/git/git-gateway.ts",
    "electron/process/process-gateway.ts",
    "src/shared/bootstrap-audit.ts",
    "src/shared/capability-graph.ts",
    "src/shared/capability-needs.ts",
    "src/shared/semver.ts",
    "src/shared/test-impact.ts"
  ]
};

/**
 * Paths owned by the PLATFORM ITSELF rather than by any capability: the composition root.
 *
 * A third class, because the two that existed were both wrong for these files:
 *
 *   - a CAPABILITY is a building with one declared purpose. The composition root wires the buildings
 *     together, so attributing it to one of them is not a small inaccuracy: `electron/main.ts` imports
 *     `electron/commander/**` (owned by `tenx`), the research capability and the workspace capability,
 *     so calling it part of `runtime` -- a KERNEL -- counted every one of those imports as a
 *     kernel-into-feature INVERSION. Measured before this class existed, that reading produced 154
 *     kernel -> feature edges; the composition root's share of it is an artefact of the attribution,
 *     not a defect in the wiring.
 *   - `exempt` means NOBODY owns this and a change therefore forces a full run. That is a claim that
 *     the file is unattributed. These files are the most heavily attributed files in the repository:
 *     they are the wiring. Recording them as exempt would trade a false ownership claim for a false
 *     absence, which is the same error wearing the other hat.
 *
 * The value is the REASON, as in `exempt`, so the map states why each file is not a capability and the
 * decision is reviewable rather than merely encoded.
 */
const COMPOSITION_ROOT = {
  "electron/main.ts":
    "the composition root: it builds the window, registers every capability's boot module and wires "
    + "them to each other, so it is defined by the wiring BETWEEN the capabilities and not by any one of "
    + "them. It is a file the platform owns, not a file nobody owns.",
  "electron/preload.ts":
    "the other half of the composition root's boundary: it narrows the main process's surface down to "
    + "what the renderer may call, so its content is the set of capabilities it bridges rather than the "
    + "behaviour of one of them."
};

/**
 * Paths deliberately owned by nobody, with the reason.
 *
 * A file here selects no suite, so a change to it forces a full run. Each entry states why that is
 * the right answer rather than a mapping the phase has not got to yet.
 *
 * `src/shared/compatibility.ts` USED TO BE LISTED HERE AND IS NOT ANY MORE. It was both owned by
 * `persistence` (in `EXTRA`) and exempt, which is a contradiction rather than a policy: the file had a
 * capability whose blast radius claimed it and an exemption saying nobody owned it, so the two answers
 * disagreed about whether a change to it selects a suite. Its own exemption reason stated the problem
 * out loud -- "owning it here as well would make two capabilities claim the same file" -- but the
 * second claimant it was guarding against was `persistence`, which had it all along. Removing the
 * exemption is the repair: the file keeps exactly one owner, and
 * `scripts/capability-closure-validator.cjs` fails if any file becomes owned-and-exempt again.
 */
const EXEMPT = {
  "src/renderer":
    "the renderer is exercised by the desktop black-box contract, which launches the real application; that suite is always-run, so a renderer change cannot be under-tested by being unowned"
};

function walkFiles(rel) {
  const absolute = path.join(ROOT, rel);
  if (!fs.existsSync(absolute)) return [];
  if (fs.statSync(absolute).isFile()) return [rel];
  const found = [];
  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (/\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, child).split(path.sep).join("/"));
    }
  }
  return found;
}

function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const capabilities = config.capabilities;
  const problems = [];

  // The composition root is owned by the platform, not by a capability, so it is subtracted from every
  // capability BEFORE anything is validated. This ordering is the whole repair: `capabilities` is read
  // from the file and then widened by `EXTRA`, so a path deleted from `EXTRA` alone would survive in
  // the file for ever -- the union would keep re-asserting the old attribution and the table would stop
  // being the artifact's description. Subtracting first means re-running this generator REPAIRS the
  // misattribution instead of preserving it.
  const compositionRootPaths = Object.keys(COMPOSITION_ROOT).sort();
  for (const [capabilityId, paths] of Object.entries(capabilities)) {
    const kept = paths.filter((rel) => !compositionRootPaths.includes(rel));
    if (kept.length !== paths.length) capabilities[capabilityId] = kept;
  }

  // Every EXTRA path must exist, and no file may be claimed by two capabilities.
  const claimed = new Map();
  for (const [capabilityId, paths] of Object.entries(capabilities)) {
    for (const rel of paths) for (const file of walkFiles(rel)) {
      claimed.set(file, [...(claimed.get(file) ?? []), capabilityId]);
    }
  }
  for (const [capabilityId, paths] of Object.entries(EXTRA)) {
    if (!capabilities[capabilityId]) { problems.push(`EXTRA names unknown capability ${capabilityId}`); continue; }
    for (const rel of paths) {
      if (!fs.existsSync(path.join(ROOT, rel))) { problems.push(`${capabilityId}: ${rel} does not exist`); continue; }
      for (const file of walkFiles(rel)) {
        const owners = claimed.get(file) ?? [];
        if (owners.length > 0 && !owners.includes(capabilityId)) {
          problems.push(`${file} would be owned by both ${owners.join(" and ")} and ${capabilityId}`);
          continue;
        }
        claimed.set(file, [...new Set([...owners, capabilityId])]);
      }
    }
  }
  // The composition root must be a real FILE, owned by nothing else, and not exempt: "the platform
  // owns this" and "nobody owns this" are contradictory claims about one file, so both at once is a
  // contradiction rather than a policy. Named file by file rather than by directory so that each entry
  // has to state its own reason.
  for (const rel of compositionRootPaths) {
    if (!fs.existsSync(path.join(ROOT, rel))) { problems.push(`COMPOSITION_ROOT: ${rel} does not exist`); continue; }
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { problems.push(`COMPOSITION_ROOT: ${rel} is a directory; the composition root is named file by file`); continue; }
    if (claimed.has(rel)) problems.push(`${rel} is the composition root and is also claimed by ${[...new Set(claimed.get(rel))].join(" and ")}`);
    if (Object.prototype.hasOwnProperty.call(EXEMPT, rel)) problems.push(`${rel} is the composition root and is also exempt: the platform owns it, so it is not owned by nobody`);
    if (String(COMPOSITION_ROOT[rel] ?? "").trim().length < 20) problems.push(`COMPOSITION_ROOT: ${rel} carries no substantive reason`);
  }

  if (problems.length > 0) {
    process.stderr.write(`the ownership table is inconsistent:\n  ${problems.join("\n  ")}\n`);
    process.exitCode = 1;
    return;
  }

  for (const [capabilityId, paths] of Object.entries(EXTRA)) {
    const merged = new Set([...capabilities[capabilityId], ...paths]);
    capabilities[capabilityId] = [...merged].sort();
  }
  config.capabilities = Object.fromEntries(Object.entries(capabilities).sort(([left], [right]) => (left < right ? -1 : 1)));
  config.composition_root = Object.fromEntries(compositionRootPaths.map((rel) => [rel, COMPOSITION_ROOT[rel]]));
  config.exempt = Object.fromEntries(Object.entries(EXEMPT).sort(([left], [right]) => (left < right ? -1 : 1)));
  config.$comment = "Phase 05 Task A: the implementation surface each capability owns, beyond the boot module its manifest declares. A changed file that maps to no capability is reported by the impact selector and forces a full run, so this list is deliberately conservative: a path listed is a claim that the capability's suites cover it. `composition_root` records the paths the PLATFORM owns -- the wiring between the capabilities, which is defined by the set of capabilities it bridges and so belongs to no single one of them -- each with the reason it is not a capability. `exempt` records paths deliberately owned by nobody, each with its reason.";
  fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  let paths = 0;
  for (const list of Object.values(config.capabilities)) paths += list.length;
  process.stdout.write(`wrote config/capability-modules.json: ${Object.keys(config.capabilities).length} capabilities, ${paths} owned paths, ${Object.keys(config.composition_root).length} composition-root file(s), ${Object.keys(config.exempt).length} exempt\n`);
}

main();
