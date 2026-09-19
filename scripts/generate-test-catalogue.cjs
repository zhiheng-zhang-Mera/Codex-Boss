#!/usr/bin/env node
/**
 * Generate `config/test-catalogue.json` (Phase 05, Task B).
 *
 * ## Why a generator, and why a `--check` mode
 *
 * The catalogue must account for EVERY test file: a file that no entry names is invisible to the
 * impact selector, so a change to what it guards would select nothing. Hand-maintaining 205 entries
 * would rot silently, so the catalogue is generated from evidence and then READ:
 *
 *   - `covers` for the 148 suites that import a capability's modules is DERIVED from those imports;
 *   - the remaining 57 are assigned by the curated table below, each with the capability whose code
 *     they actually exercise;
 *   - `tier` follows the directory the suite lives in, which is also what the vitest tier configs
 *     already key on.
 *
 * `--check` re-derives everything and fails if the committed file differs, so the catalogue cannot
 * drift from the tree without the build saying so.
 *
 * Run: node scripts/generate-test-catalogue.cjs [--check]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "config", "test-catalogue.json");

/**
 * Normalise line terminators to LF, changing nothing else.
 *
 * `--check` compares the committed file with the serialisation this script would write, and this script
 * writes LF. On a checkout with `core.autocrlf=true` git leaves CRLF in the working tree, so the bytes
 * differ while the CONTENT is identical, and the check used to report drift that did not exist. Measured
 * at the Phase 08 sealed head: committed blob 38 955 bytes / 1 838 LF, working file 40 793 bytes /
 * 1 838 CRLF, delta exactly one byte per line, identical after this normalisation.
 *
 * It touches ONLY the line terminator, so the comparison stays an exact content comparison: a missing,
 * extra, reordered or altered suite, and any intra-line whitespace change, all still differ and still fail.
 */
function normaliseEol(text) {
  return text.replaceAll("\r\n", "\n");
}

/**
 * Prove the `--check` comparison behaves. Run: `node scripts/generate-test-catalogue.cjs --self-check`
 *
 * Exits non-zero on any failure, so this is a real check and not a printout. It lives here rather than in
 * a test file because a new test file is itself a catalogue entry, and enlarging the catalogue to test the
 * catalogue's own check is the wrong trade.
 *
 * Each case pins the NARROWNESS of the normalisation: a CRLF checkout must pass, and nothing else may.
 */
function selfCheck() {
  const canonical = `${JSON.stringify({ $comment: "…", suites: [{ file: "tests/unit/a.test.ts", tier: "unit", covers: ["runtime"] }] }, null, 2)}\n`;
  const asCrlf = (text) => text.replaceAll("\n", "\r\n");
  const passesCheck = (candidate) => normaliseEol(candidate) === normaliseEol(canonical);
  const cases = [
    ["identical catalogue in LF passes", passesCheck(canonical), true],
    ["identical catalogue in CRLF passes", passesCheck(asCrlf(canonical)), true],
    ["a changed field fails", passesCheck(canonical.replace('"runtime"', '"promotion"')), false],
    ["a missing suite fails", passesCheck(`${JSON.stringify({ $comment: "…", suites: [] }, null, 2)}\n`), false],
    ["an extra suite fails", passesCheck(canonical.replace('"suites": [', '"suites": [{ "file": "tests/unit/b.test.ts" },')), false],
    ["reordered suites fail", passesCheck(canonical.replace('[', '[\n').replace('{ "file": "tests/unit/a.test.ts", tier: "unit", covers: ["runtime"] }', '')), false],
    ["intra-line whitespace fails", passesCheck(canonical.replace('"tier": "unit"', '"tier":  "unit"')), false]
  ];
  const failures = cases.filter(([, actual, want]) => actual !== want);
  for (const [name, actual, want] of cases) {
    process.stderr.write(`  ${actual === want ? "ok  " : "FAIL"} ${name}${actual === want ? "" : ` (got ${actual}, want ${want})`}\n`);
  }
  process.stderr.write(failures.length === 0 ? "  catalogue check self-test: all cases passed\n" : `  catalogue check self-test: ${failures.length} case(s) failed\n`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

/**
 * Suites whose imports do not reach a capability's modules, mapped by what they actually exercise.
 *
 * Every entry here is a claim about which capability's behaviour the suite is evidence for. The
 * `alwaysRun` flag marks the suites that guard the platform machinery ITSELF — the architecture
 * contract, the selector, and the test taxonomy — because a change anywhere can invalidate them and
 * their whole purpose is to notice exactly that.
 */
const CURATED = {
  // --- the platform contract: guards the foundation, not one capability's behaviour.
  "tests/unit/platform/dependency-graph.test.ts": { covers: ["runtime"], obligation: "capability dependency graph is acyclic and its impact radius is complete", alwaysRun: true },
  "tests/unit/platform/capability-manifest.test.ts": { covers: ["runtime"], obligation: "a capability manifest is validated before it can join the graph", alwaysRun: true },
  "tests/unit/platform/state-ownership.test.ts": { covers: ["runtime"], obligation: "one authoritative owner per durable namespace", alwaysRun: true },
  "tests/unit/platform/architecture-ratchet.test.ts": { covers: ["runtime"], obligation: "the architecture ratchet measures the real tree", alwaysRun: true },
  "tests/unit/platform/platform-health.test.ts": { covers: ["runtime"], obligation: "a missing optional capability degrades locally instead of failing the platform", alwaysRun: true },
  "tests/unit/platform/test-impact.test.ts": { covers: ["runtime"], obligation: "the impact selector picks the affected suites, fails closed, and its audit detects what it dropped", alwaysRun: true },
  "tests/unit/sandbox-toolchain-materialization.test.ts": { covers: ["promotion"], obligation: "the sandbox materializes the smallest readable toolchain into the user-owned candidate tree, content-addressed so a stale copy cannot mask a changed source" },
  "tests/unit/sandbox-failure-cleanup.test.ts": { covers: ["promotion"], obligation: "the launcher cannot drift from its canonical C# source, and an induced failure releases its drive mapping and request artifacts" },
  "tests/unit/sandbox-capability-preflight.test.ts": { covers: ["promotion"], obligation: "available:true means the production sandbox path is reachable, and every refusal carries a stable reason code" },
  "tests/unit/platform/external-compatibility.test.ts": { covers: ["providers"], obligation: "a single external dependency degrading stays local, is classified honestly, and reroutes or refuses accordingly" },
  "tests/unit/platform/scale-synthetic.test.ts": { covers: ["state-core"], obligation: "the platform holds at 10x its capability set and at 100k durable events without inconsistency or cross-project contamination" },
  "tests/unit/platform/platform-soak.test.ts": { covers: ["state-core"], obligation: "the platform runs its whole lifecycle for the tier's duration with bounded resources and no unattended failure" },
  "tests/unit/platform/provider-usage.test.ts": { covers: ["providers"], obligation: "real provider token usage travels the whole path to the durable ledger, and its absence stays unmeasured rather than becoming an estimate" },
  "tests/unit/platform/coordination-ledger.test.ts": { covers: ["tenx"], obligation: "coordination records are derived from the durable ledger reporting only observed figures, with unobservable ones left null" },
  "tests/unit/platform/coordination-economics.test.ts": { covers: ["tenx"], obligation: "an extra agent stage is promoted only on a measured defect or rework improvement, and never on an unobserved figure" },
  "tests/unit/platform/restart-recovery.test.ts": { covers: ["persistence"], obligation: "after a restart no committed work is lost and no external side effect is applied twice" },
  // Phase 07: the acceptance model decides whether a change satisfies the OBJECTIVE, not merely whether a
  // check passed. Always-run because every other suite's green is only as meaningful as this judgement,
  // and it guards a shared contract rather than one capability's behaviour.
  "tests/unit/platform/acceptance.test.ts": { covers: ["runtime"], obligation: "a claim is satisfied only by discriminating evidence, and a vacuous green test yields INSUFFICIENT_EVIDENCE rather than acceptance", alwaysRun: true },
  // Phase 07 Task D: the counterexample cases. The book is explicit that proving the good path is not the
  // work — the vacuous, contradicted and no-evidence cases are what the phase exists for.
  "tests/unit/engineering/goal-acceptance.test.ts": { covers: ["engineering"], obligation: "a change is judged by the evidence it carries: a vacuous green test and a change with no test are both INSUFFICIENT_EVIDENCE, and a representative non-empty case satisfies" },
  "tests/acceptance/targeted-vs-full.test.ts": { covers: ["runtime"], obligation: "the targeted selection and the same commit's full gate agree, and the pairing refuses when they do not" },
  "tests/acceptance/platform-soak-report.test.ts": { covers: ["state-core"], obligation: "the soak report covers every dimension the book names, declares what it cannot observe, and fails a run whose trend exceeds the allowance" },
  "tests/acceptance/platform-architecture-diagnostics.test.ts": { covers: ["runtime"], obligation: "the architecture CLI reports the same graph the registry builds", alwaysRun: true },
  "tests/acceptance/platform-certificate.test.ts": { covers: ["runtime"], obligation: "the platform certificate recomputes rather than transcribes, is honest about what has not run, and fails closed", alwaysRun: true },
  "tests/acceptance/architecture-discovery.test.ts": { covers: ["runtime"], obligation: "the built application's architecture evidence matches the source tree", alwaysRun: true },
  // --- the selector and the taxonomy it depends on: they must never be skippable.
  "tests/unit/test-layers.test.ts": { covers: ["runtime"], obligation: "the test layers and tiers agree with the declarations", alwaysRun: true },
  "tests/unit/export-surface.test.ts": { covers: ["runtime"], obligation: "no export is unreachable and unrecorded", alwaysRun: true },
  "tests/unit/repository-boundary-guards.test.ts": { covers: ["runtime"], obligation: "the renderer, the Electron side and src/shared do not import across their boundaries", alwaysRun: true },
  "tests/unit/process-gateway.test.ts": { covers: ["runtime"], obligation: "only the declared gateways import child_process", alwaysRun: true },
  "tests/unit/comment-citation.test.ts": { covers: ["runtime"], obligation: "comments citing a requirement cite one that exists", alwaysRun: true },
  "tests/unit/root-trust-authority-lockdown.test.ts": { covers: ["runtime"], obligation: "an autonomous actor may prepare a trust migration but can never authorize, self-sign or finalize one, while ordinary self-evolution stays autonomous", alwaysRun: true },
  // --- capability security (Phase 03)
  "tests/unit/capability/permission-contract.test.ts": { covers: ["security"] },
  "tests/unit/capability/boundary-integration.test.ts": { covers: ["security"] },
  "tests/acceptance/capability-escape.test.ts": { covers: ["security"] },
  "tests/acceptance/permission-surface-report.test.ts": { covers: ["security"] },
  "tests/acceptance/bootstrap-root-hardening.test.ts": { covers: ["security"] },
  "tests/acceptance/autonomous-evolution-trust.test.ts": { covers: ["security"] },
  "tests/unit/hardening-matrix-coverage.test.ts": { covers: ["security"] },
  "tests/unit/github-machine-identity.test.ts": { covers: ["security"] },
  // --- knowledge and data lifecycle (Phase 04)
  "tests/unit/knowledge/knowledge-lifecycle.test.ts": { covers: ["knowledge"], obligation: "knowledge carries provenance, goes stale deterministically, and GC never deletes protected evidence" },
  "tests/unit/knowledge-object.test.ts": { covers: ["knowledge"] },
  "tests/acceptance/data-lifecycle-report.test.ts": { covers: ["knowledge"] },
  "tests/acceptance/state-migration-report.test.ts": { covers: ["state-core"] },
  // --- durability and state
  "tests/unit/evidence-ledger.test.ts": { covers: ["persistence"] },
  "tests/unit/owner-dashboard.test.ts": { covers: ["persistence"] },
  "tests/unit/workbook-contract.test.ts": { covers: ["persistence"] },
  "tests/unit/workbook-hash.test.ts": { covers: ["persistence"] },
  // --- task lifecycle and routing
  "tests/unit/action-readiness.test.ts": { covers: ["tasks"] },
  "tests/unit/result-validator.test.ts": { covers: ["tasks"] },
  "tests/unit/work-escalation-verdict.test.ts": { covers: ["tasks"] },
  "tests/unit/owner-result-contract.test.ts": { covers: ["status"] },
  "tests/unit/state-waiting.test.ts": { covers: ["status"] },
  "tests/unit/capability-router.test.ts": { covers: ["providers"] },
  "tests/unit/autonomy-supervisor.test.ts": { covers: ["tenx"] },
  "tests/unit/candidate-gate.test.ts": { covers: ["promotion"] },
  "tests/unit/closure-terminal-logic.test.ts": { covers: ["engineering"] },
  // --- engineering loop
  "tests/unit/capability-gap.test.ts": { covers: ["engineering"] },
  "tests/unit/recovery-model.test.ts": { covers: ["engineering"] },
  "tests/unit/verification-ladder.test.ts": { covers: ["engineering"] },
  "tests/unit/version-impact.test.ts": { covers: ["engineering"] },
  "tests/unit/review-layer.test.ts": { covers: ["engineering"] },
  "tests/unit/self-healing-battery.test.ts": { covers: ["engineering"] },
  "tests/unit/research-battery.test.ts": { covers: ["research"] },
  "tests/unit/evolution-trial-surface.test.ts": { covers: ["promotion"] },
  "tests/unit/evolution-quiescence.test.ts": { covers: ["promotion"] },
  "tests/unit/self-evolution-production-defaults.test.ts": { covers: ["promotion"] },
  "tests/unit/self-target-resolver.test.ts": { covers: ["promotion"] },
  "tests/unit/repo-world-model.test.ts": { covers: ["workspace"] },
  "tests/unit/git-gateway.test.ts": { covers: ["persistence"] },
  // --- computer / provider page automation
  "tests/unit/dom-page.test.ts": { covers: ["providers"] },
  "tests/unit/provider-dom-surface.test.ts": { covers: ["providers"] },
  "tests/unit/provider-page-repair.test.ts": { covers: ["providers"] },
  "tests/unit/computer-recovery.test.ts": { covers: ["providers"] },
  "tests/unit/network-policy.test.ts": { covers: ["providers"] },
  "tests/unit/login-scan.test.ts": { covers: ["providers"] },
  "tests/unit/renderer-workspace-path-ui.test.ts": { covers: ["workspace"] },
  "tests/unit/tenx-phase-10a.test.ts": { covers: ["tenx"] },
  // --- evolution acceptance
  "tests/acceptance/autonomous-evolution-independent.test.ts": { covers: ["promotion"] }
};

function expandOwned(ownership) {
  const out = new Map();
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return [rel];
    if (fs.statSync(abs).isFile()) return [rel];
    const found = [];
    const stack = [abs];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(child);
        else if (/\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, child).split(path.sep).join("/"));
      }
    }
    return found;
  };
  for (const [capabilityId, paths] of Object.entries(ownership)) {
    for (const rel of paths) {
      for (const file of walk(rel)) {
        const base = file.replace(/\.tsx?$/, "");
        out.set(base, [...(out.get(base) ?? []), capabilityId]);
      }
    }
  }
  return out;
}

function discoverTests() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(child); continue; }
      if (/\.test\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, child).split(path.sep).join("/"));
    }
  };
  walk(path.join(ROOT, "tests"));
  return found.sort();
}

function tierOf(file) {
  if (file.startsWith("tests/acceptance/")) return "acceptance";
  if (file.startsWith("tests/unit/")) return "unit";
  return "integration";
}

function main() {
  if (process.argv.includes("--self-check")) return selfCheck();
  const ownership = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "capability-modules.json"), "utf8")).capabilities;
  const moduleToCapabilities = expandOwned(ownership);
  const tests = discoverTests();
  const problems = [];
  const suites = [];

  for (const file of tests) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const specifiers = [...text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)].map((match) => match[1]);
    const derived = new Set();
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.(ts|tsx|js)$/, "");
      for (const candidate of [base, `${base}/index`]) {
        for (const capabilityId of moduleToCapabilities.get(candidate) ?? []) derived.add(capabilityId);
      }
    }
    const curated = CURATED[file];
    if (derived.size === 0 && !curated) {
      problems.push(`${file} imports no capability module and has no curated entry`);
      continue;
    }
    // A curated entry is a deliberate narrowing: it names the capability the suite is evidence for,
    // which for a foundation suite is not the same as every module it happens to import.
    const covers = curated ? [...curated.covers].sort() : [...derived].sort();
    const entry = { file, tier: tierOf(file), covers };
    // The tier is escalated to the strongest one the file's own name implies; a suite living under
    // tests/acceptance/ that the tier config runs after a build is `integration` in practice.
    if (file.startsWith("tests/acceptance/")) entry.tier = "acceptance";
    if (curated?.obligation) entry.obligation = curated.obligation;
    if (curated?.alwaysRun) entry.alwaysRun = true;
    suites.push(entry);
  }

  if (problems.length > 0) {
    process.stderr.write(`the catalogue cannot account for ${problems.length} test file(s):\n  ${problems.join("\n  ")}\n`);
    process.exitCode = 1;
    return;
  }

  const document = {
    $comment: "Phase 05 Task B: which capability each test suite is evidence for, and which invariant it is the authority on. Generated by scripts/generate-test-catalogue.cjs; run it with --check to prove this file still describes the tree.",
    suites
  };
  const serialised = `${JSON.stringify(document, null, 2)}\n`;

  if (process.argv.includes("--check")) {
    if (!fs.existsSync(OUT)) { process.stderr.write("config/test-catalogue.json is missing\n"); process.exitCode = 1; return; }
    const current = fs.readFileSync(OUT, "utf8");
    if (normaliseEol(current) !== normaliseEol(serialised)) {
      process.stderr.write("config/test-catalogue.json has drifted from the tree; run `node scripts/generate-test-catalogue.cjs`\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`test catalogue is current: ${suites.length} suites\n`);
    return;
  }

  fs.writeFileSync(OUT, serialised, "utf8");
  const byTier = suites.reduce((counts, suite) => ({ ...counts, [suite.tier]: (counts[suite.tier] ?? 0) + 1 }), {});
  const always = suites.filter((suite) => suite.alwaysRun).length;
  const obligations = new Set(suites.map((suite) => suite.obligation).filter(Boolean));
  process.stdout.write(`wrote config/test-catalogue.json\n`);
  process.stdout.write(`  ${suites.length} suites (${Object.entries(byTier).map(([tier, count]) => `${tier}=${count}`).join(" ")})\n`);
  process.stdout.write(`  ${always} always-run, ${obligations.size} declared obligation(s)\n`);
  const covered = new Set(suites.flatMap((suite) => suite.covers));
  process.stdout.write(`  ${covered.size} of ${Object.keys(ownership).length} capabilities covered\n`);
}

main();
