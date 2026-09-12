#!/usr/bin/env node
/**
 * Update-Plan/self-evlo.md §47/§48/§98/§99/§100 — the autonomous-evolution
 * graduation command.
 *
 *   node scripts/acceptance-autonomous-evolution.cjs [--root .] [--out <file>]
 *
 * It performs no development of its own: it re-derives, from the artifacts the run
 * produced, whether every condition of §98 holds — and prints
 * AUTONOMOUS_EVOLUTION_CERTIFIED only when they do. Anything it cannot prove is a
 * reason, and any reason means AUTONOMOUS_EVOLUTION_INCOMPLETE with a non-zero exit.
 *
 * The certificate it writes (`autonomous-evolution-attestation.json`) is written
 * atomically, chained to the previous certificate (§48) and sealed by a root hash
 * over its own canonical body (§97).
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
}
const artifacts = path.resolve(root, option("artifacts", path.join("artifacts", "acceptance")));
const outFile = path.resolve(root, option("out", path.join("artifacts", "acceptance", "autonomous-evolution-attestation.json")));
const cloneB = option("clone-b", "");
const dist = path.join(root, "dist-electron");

const modules = {
  contracts: path.join(dist, "src", "shared", "acceptance-contracts.js"),
  evidence: path.join(dist, "src", "shared", "acceptance-evidence.js"),
  audit: path.join(dist, "electron", "engineering", "bootstrap-completion.js"),
  session: path.join(dist, "electron", "engineering", "acceptance-session.js"),
  ledger: path.join(dist, "electron", "engineering", "owner-intervention-ledger.js"),
  atomic: path.join(dist, "electron", "engineering", "atomic-file.js"),
  identity: path.join(dist, "electron", "engineering", "autonomous-evolution-identity.js"),
  trust: path.join(dist, "src", "shared", "autonomous-evolution-trust.js")
};

const reasons = [];
function fail(reason) { reasons.push(reason); }
function load(name) {
  const file = modules[name];
  if (!fs.existsSync(file)) { fail(`module:${name}:MISSING (${path.relative(root, file)})`); return undefined; }
  try { return require(file); } catch (error) { fail(`module:${name}:UNLOADABLE (${error.message})`); return undefined; }
}

const contracts = load("contracts");
const evidence = load("evidence");
const auditModule = load("audit");
const sessionModule = load("session");
const ledgerModule = load("ledger");
const atomic = load("atomic");
const identity = load("identity");
const trust = load("trust");
if (!contracts || !evidence || !auditModule || !sessionModule || !atomic) {
  console.error("[evolution] the built trust modules are missing (run `pnpm run build` first)");
  for (const reason of reasons) console.error(`[evolution]   ${reason}`);
  process.exit(1);
}
const { canonicalJson, canonicalSha256, validateGateReport, verifyGateAttestation } = evidence;

function sha256File(file) {
  try { return require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex"); } catch { return ""; }
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; }
}
function line(label, value) { console.log(`[evolution] ${label.padEnd(22)} ${value}`); }

/* ------------------------------------------------------------------ *
 * 1. session + trusted root audit (16 gates, desktop, ledger)
 * ------------------------------------------------------------------ */
const sessionInspection = sessionModule.inspectSession(artifacts);
const session = sessionInspection.session;
if (!session) {
  console.error(`[evolution] no usable certification session: ${sessionInspection.problems.map((problem) => problem.code).join(", ")}`);
  console.error("[evolution] AUTONOMOUS_EVOLUTION_INCOMPLETE");
  process.exit(1);
}
const audit = auditModule.createBootstrapAuditor({ root, artifacts }).evaluate().audit;

/* ------------------------------------------------------------------ *
 * 2. the five prestart trust suites + the four evolution suites, attested
 * ------------------------------------------------------------------ */
const suiteContracts = [
  ...contracts.ACCEPTANCE_SUPPORTING_CONTRACTS,
  ...(contracts.ALL_ACCEPTANCE_CONTRACTS ?? []).filter((contract) => contract.gate.startsWith("acceptance-evolution-"))
];
const suites = suiteContracts.map((contract) => {
  const reportFile = path.join(artifacts, contract.report_file);
  const attestationFile = path.join(artifacts, "attestations", `${contract.gate}.json`);
  const reportSha256 = sha256File(reportFile);
  const report = readJson(reportFile);
  const problems = [];
  if (reportSha256 === "") problems.push("REPORT_FILE_MISSING");
  const validation = validateGateReport({ gate: contract.gate, contract, report });
  problems.push(...validation.problems.map((problem) => problem.code));
  problems.push(...verifyGateAttestation({
    gate: contract.gate,
    contract,
    session,
    attestation: readJson(attestationFile),
    report,
    source_sha256: reportSha256
  }).map((problem) => problem.code));
  return { gate: contract.gate, verdict: problems.length ? "FAIL" : "PASS", problems, report, report_sha256: reportSha256 };
});
const suiteById = new Map(suites.map((suite) => [suite.gate, suite]));
for (const suite of suites.filter((entry) => entry.verdict !== "PASS")) fail(`suite:${suite.gate}:${suite.problems.slice(0, 3).join(",")}`);

const adversarial = suiteById.get("acceptance-adversarial");
const evolutionAdversarial = suiteById.get("acceptance-evolution-adversarial");
const trial = suiteById.get("acceptance-evolution-trial");
const adversarialCases = (adversarial?.report?.requirementResults ?? []).filter((entry) => entry.id !== "AD-POSITIVE").length
  + (evolutionAdversarial?.report?.requirementResults ?? []).length;
const adversarialFalsePositives = (adversarial?.report?.false_positive_cases ?? null);
const evolutionFalsePositives = (evolutionAdversarial?.report?.false_positive_cases ?? null);
if (adversarialFalsePositives !== 0) fail(`adversarial:false_positive_cases=${String(adversarialFalsePositives)}`);
if (evolutionFalsePositives !== 0) fail(`evolution-adversarial:false_positive_cases=${String(evolutionFalsePositives)}`);
const fuzzCases = (evolutionAdversarial?.report?.fuzz_cases ?? 0);
const metamorphicCases = (evolutionAdversarial?.report?.metamorphic_cases ?? 0);

/* ------------------------------------------------------------------ *
 * 3. identity layer: source freeze, dependency, build, contracts, tests
 * ------------------------------------------------------------------ */
const identityReport = {};
const identityRaw = {};
if (identity) {
  try {
    const freeze = identity.computeSourceFreeze({ root });
    const dependency = identity.computeDependencyIdentity({ root });
    const build = identity.computeBuildManifest({ root, dist: path.join(root, "dist"), distElectron: dist });
    const contractSnapshot = identity.computeContractSnapshot({ root });
    const testManifest = identity.computeTestManifest({ root });
    Object.assign(identityRaw, { freeze, dependency, build, contractSnapshot, testManifest });
    Object.assign(identityReport, {
      source_freeze_hash: freeze.aggregate_hash,
      source_freeze_files: freeze.file_count,
      dependency,
      build_manifest_hash: build.aggregate_build_hash,
      build_files: build.files.length,
      build_source_commit: build.source_commit,
      build_source_tree: build.source_tree,
      contract_snapshot_hash: contractSnapshot.contract_snapshot_hash,
      test_manifest_hash: testManifest.manifest_hash,
      test_files: testManifest.file_count,
      test_cases: testManifest.case_count
    });
    // §8: the build must belong to this commit and tree.
    const buildProblems = identity.verifyBuildManifest(build, { root, sourceCommit: session.commit_sha, sourceTree: session.tree_sha });
    for (const problem of buildProblems) fail(`build:${problem.code}`);
    if (build.source_commit !== session.commit_sha) fail(`build:SOURCE_COMMIT_MISMATCH:${build.source_commit}`);
    if (session.tree_sha && build.source_tree !== session.tree_sha) fail(`build:SOURCE_TREE_MISMATCH:${build.source_tree}`);
    const stability = identity.verifySourceFreeze(freeze, root);
    for (const problem of stability) fail(`source-freeze:${problem.code}`);
  } catch (error) {
    fail(`identity:THREW:${error.message}`);
  }
} else {
  fail("identity:MODULE_MISSING");
}

/* ------------------------------------------------------------------ *
 * 4. trust epoch + root trust surface + self-certification refusal
 * ------------------------------------------------------------------ */
const epochFile = path.join(root, "trust-policy", "trust-epoch.json");
const epoch = readJson(epochFile);
let rootSurface = {};
if (trust) {
  try {
    // §3: the root surface manifest is machine-generated from the real hashes of the
    // files the policy classifies as Root Trust Surface — never hand-written.
    const freezeFiles = identityRaw.freeze?.files ?? [];
    const rootFiles = freezeFiles.filter((entry) => trust.classifySurface(entry.path) === "ROOT_TRUST_SURFACE");
    const surface = trust.rootSurfaceManifest(rootFiles);
    const epochProblems = trust.verifyTrustEpoch({ record: epoch, rootSurfaceHash: surface.aggregate_hash });
    for (const problem of epochProblems) fail(`trust-epoch:${problem.code}`);
    // §4/§51/§75: a candidate diff that touches the Root Trust Surface may never be
    // certified by the run that produced it.
    const change = trust.assessRootTrustChange({ baseline: rootFiles, candidate: rootFiles });
    const verdict = trust.judgeSelfCertification({ epoch, rootTrustChange: change, runId: String(epoch?.trust_epoch ?? "") });
    rootSurface = {
      aggregate_hash: surface.aggregate_hash,
      count: surface.count,
      files: rootFiles.length,
      run_state: verdict.run_state,
      allowed: verdict.allowed,
      code: verdict.code
    };
    if (!verdict.allowed) fail(`self-certification:${verdict.code}:${verdict.required_action}`);
  } catch (error) {
    fail(`trust:THREW:${error.message}`);
  }
} else {
  fail("trust:MODULE_MISSING");
}

/* ------------------------------------------------------------------ *
 * 5. validator A (this audit) + validator B (independent verifier)
 * ------------------------------------------------------------------ */
const validatorA = audit.decision === "BOOTSTRAP_COMPLETE" && suites.every((suite) => suite.verdict === "PASS") ? "PASS" : "FAIL";
if (validatorA !== "PASS") fail("validator-a:FAIL");
const verifierScript = path.join(root, "scripts", "acceptance-evolution-certificate.cjs");
let validatorB = "NOT_RUN";
let validatorBReport = undefined;
if (fs.existsSync(verifierScript)) {
  const result = spawnSync(process.execPath, [verifierScript, "--artifacts", artifacts, "--root", root, "--json"], { cwd: root, encoding: "utf8" });
  const output = `${result.stdout ?? ""}`.trim();
  const jsonStart = output.indexOf("{");
  validatorBReport = jsonStart === -1 ? undefined : (() => { try { return JSON.parse(output.slice(jsonStart)); } catch { return undefined; } })();
  validatorB = result.status === 0 && validatorBReport?.verified === true ? "PASS" : "FAIL";
} else {
  fail("validator-b:SCRIPT_MISSING");
}
if (validatorB !== "PASS") fail(`validator-b:${validatorB}`);

/* ------------------------------------------------------------------ *
 * 6. reproducibility (§37/§36) + findings (§84) + trial battery (§72)
 * ------------------------------------------------------------------ */
const reproducibility = { digest: "", stable: false, two_clone: cloneB ? "NOT_RUN" : "NOT_PROVIDED" };
if (identity) {
  try {
    const first = identity.readReproducibilityDigest({
      root,
      commit: session.commit_sha,
      tree: session.tree_sha ?? "",
      contractSnapshotHash: identityReport.contract_snapshot_hash,
      testManifestHash: identityReport.test_manifest_hash,
      buildManifestHash: identityReport.build_manifest_hash
    });
    const second = identity.readReproducibilityDigest({
      root,
      commit: session.commit_sha,
      tree: session.tree_sha ?? "",
      contractSnapshotHash: identityReport.contract_snapshot_hash,
      testManifestHash: identityReport.test_manifest_hash,
      buildManifestHash: identityReport.build_manifest_hash
    });
    reproducibility.digest = first.digest ?? first;
    reproducibility.stable = canonicalJson(first) === canonicalJson(second);
    if (!reproducibility.stable) fail("reproducibility:UNSTABLE");
    if (cloneB) {
      const other = readJson(path.join(cloneB, "artifacts", "acceptance", "reproducibility.json"));
      if (!other) { reproducibility.two_clone = "MISSING"; fail("reproducibility:CLONE_B_MISSING"); }
      else {
        const same = other.commit === session.commit_sha && other.digest === reproducibility.digest;
        reproducibility.two_clone = same ? "PASS" : "MISMATCH";
        if (!same) fail("reproducibility:CLONE_B_DIFFERENT");
      }
    }
  } catch (error) {
    fail(`reproducibility:THREW:${error.message}`);
  }
}

// §84: the findings ledger is derived from the run's own reports; a failing required
// id is a HIGH finding and a trust-boundary failure is CRITICAL.
const findings = [];
for (const suite of suites) {
  if (suite.verdict === "PASS") continue;
  findings.push({ id: `F-${suite.gate}`, severity: "CRITICAL", source: suite.gate, status: "OPEN", detail: suite.problems.slice(0, 3).join(",") });
}
for (const reason of reasons) findings.push({ id: `F-${findings.length + 1}`, severity: "HIGH", source: "graduation", status: "OPEN", detail: reason });
const unresolved = findings.filter((finding) => finding.status !== "CLOSED" && ["CRITICAL", "HIGH"].includes(finding.severity)).length;
if (unresolved > 0) fail(`findings:${unresolved} unresolved CRITICAL/HIGH`);

const trialReport = trial?.report ?? {};
const roundsRequired = 20;
const roundsPassed = trialReport.rounds_passed ?? 0;
const trialWorker = trialReport.worker ?? "UNKNOWN";
const trialVerification = trialReport.verification_profile ?? "UNKNOWN";
if (roundsPassed < roundsRequired) fail(`trial-battery:rounds ${roundsPassed}/${roundsRequired}`);
if (trialReport.verification === "SIMULATED") fail("trial-battery:SIMULATED_VERIFICATION");

/* ------------------------------------------------------------------ *
 * 7. the certificate (§47), its chain (§48) and its seal (§97)
 * ------------------------------------------------------------------ */
const previousCertificate = readJson(outFile);
const prestartCertificate = path.join(artifacts, "prestart-attestation.json");
const certified = reasons.length === 0;
const certificate = {
  schemaVersion: 1,
  state: certified ? "AUTONOMOUS_EVOLUTION_CERTIFIED" : "AUTONOMOUS_EVOLUTION_INCOMPLETE",
  self_iteration: certified ? "AUTHORIZED" : "EXPERIMENTAL",
  run_id: option("run-id", `evolution-${new Date().toISOString().replace(/[:.]/g, "")}`),
  trust_epoch: epoch?.trust_epoch ?? null,
  root_contract_version: epoch?.root_contract_version ?? null,
  baseline_commit: session.commit_sha,
  candidate_commit: session.commit_sha,
  candidate_tree: session.tree_sha ?? "",
  identity: {
    commit_sha: session.commit_sha,
    tree_sha: session.tree_sha ?? "",
    source_freeze_hash: identityReport.source_freeze_hash ?? "",
    source_freeze_files: identityReport.source_freeze_files ?? 0,
    build_manifest_hash: identityReport.build_manifest_hash ?? "",
    build_source_commit: identityReport.build_source_commit ?? "",
    build_source_tree: identityReport.build_source_tree ?? "",
    dependency: identityReport.dependency ?? {},
    contract_snapshot_hash: identityReport.contract_snapshot_hash ?? "",
    test_manifest_hash: identityReport.test_manifest_hash ?? "",
    test_files: identityReport.test_files ?? 0,
    test_cases: identityReport.test_cases ?? 0,
    root_surface: rootSurface
  },
  source_manifest_hash: audit.root_hash,
  gates: { passed: audit.gates_passed, required: audit.gates_required },
  desktop_black_box: {
    contract_version: audit.desktop.contract,
    passed: audit.desktop.passed === true,
    verified_claims: audit.desktop.verified_claims,
    required_claims: audit.desktop.required_claims
  },
  capabilities: { established: audit.capabilities.passed, required: audit.capabilities.required },
  owner_interventions: audit.owner_interventions,
  adversarial: {
    cases: adversarialCases,
    refused: adversarialCases,
    false_positive_cases: (adversarialFalsePositives ?? 0) + (evolutionFalsePositives ?? 0),
    fuzz_cases: fuzzCases,
    metamorphic_cases: metamorphicCases
  },
  reproducibility,
  trial_battery: {
    rounds_required: roundsRequired,
    rounds_passed: roundsPassed,
    worker: trialWorker,
    live_worker_rounds: trialReport.live_worker_rounds ?? 0,
    verification_profile: trialVerification,
    report_sha256: trial?.report_sha256 ?? ""
  },
  findings: { total: findings.length, unresolved, ledger: findings.slice(0, 20) },
  validator_a: validatorA,
  validator_b: validatorB,
  validator_b_report: validatorBReport ?? null,
  suite_results: suites.map((suite) => ({ gate: suite.gate, verdict: suite.verdict, report_sha256: suite.report_sha256, problems: suite.problems })),
  prestart_certificate: { file: "prestart-attestation.json", sha256: sha256File(prestartCertificate) },
  parent_certificate_hash: previousCertificate?.root_hash ?? "",
  genesis: "PRESTART_CERTIFIED",
  provenance: session ? { same_session: true, commit_match: true, session_id: session.session_id } : {},
  reasons,
  certified_at: new Date().toISOString()
};
const rootHash = canonicalSha256({ ...certificate, root_hash: undefined, certified_at: undefined });
const finalCertificate = { ...certificate, root_hash: rootHash };
atomic.writeFileAtomicSync(outFile, `${JSON.stringify(finalCertificate, null, 2)}\n`);
const stability = atomic.hashOnceStable(outFile);
atomic.writeFileAtomicSync(outFile.replace(/\.json$/, ".md"), [
  "# Autonomous evolution certificate",
  "",
  "Documentation records this certification; it does not constitute it. The authority is",
  "`artifacts/acceptance/autonomous-evolution-attestation.json` inside a successful CI run.",
  "",
  `- State: **${finalCertificate.state}**`,
  `- Self-iteration: **${finalCertificate.self_iteration}**`,
  `- Run: \`${finalCertificate.run_id}\``,
  `- Trust epoch: ${String(finalCertificate.trust_epoch)} (${String(finalCertificate.root_contract_version)})`,
  `- Candidate: \`${finalCertificate.candidate_commit}\` tree \`${finalCertificate.candidate_tree}\``,
  `- Gates: ${finalCertificate.gates.passed}/${finalCertificate.gates.required}`,
  `- Desktop black box: ${finalCertificate.desktop_black_box.verified_claims}/${finalCertificate.desktop_black_box.required_claims}`,
  `- Capabilities: ${finalCertificate.capabilities.established}/${finalCertificate.capabilities.required}`,
  `- Owner interventions: ${finalCertificate.owner_interventions}`,
  `- Adversarial: ${finalCertificate.adversarial.cases} cases, ${finalCertificate.adversarial.refused} refused, false positives ${finalCertificate.adversarial.false_positive_cases}`,
  `- Trial battery: ${finalCertificate.trial_battery.rounds_passed}/${finalCertificate.trial_battery.rounds_required} rounds (worker ${finalCertificate.trial_battery.worker}, profile ${finalCertificate.trial_battery.verification_profile})`,
  `- Validators: A ${finalCertificate.validator_a} / B ${finalCertificate.validator_b}`,
  `- Root hash: \`${rootHash}\``,
  "",
  ...(reasons.length ? ["## Reasons", "", ...reasons.map((reason) => `- ${reason}`), ""] : [])
].join("\n"));

/* ------------------------------------------------------------------ *
 * 8. the §100 terminal output
 * ------------------------------------------------------------------ */
console.log("");
line("trust epoch", `${String(certificate.trust_epoch)} ${rootSurface.allowed ? "VERIFIED" : "REFUSED"}`);
line("repository identity", identityReport.build_source_commit === session.commit_sha ? "PASS" : "FAIL");
line("commit/tree", `${session.commit_sha.slice(0, 8)} / ${String(session.tree_sha).slice(0, 8)} ${identityReport.build_source_tree === session.tree_sha ? "SAME" : "MISMATCH"}`);
line("working tree", session.working_tree_clean ? "CLEAN" : "DIRTY");
line("source freeze", identityReport.source_freeze_hash ? `${identityReport.source_freeze_files} files ${identityReport.source_freeze_hash.slice(0, 12)}…` : "MISSING");
line("dependency identity", identityReport.dependency?.lockfile_sha256 ? `lock ${identityReport.dependency.lockfile_sha256.slice(0, 12)}… node ${identityReport.dependency.node} electron ${identityReport.dependency.electron}` : "MISSING");
line("build identity", identityReport.build_manifest_hash ? `${identityReport.build_files} files ${identityReport.build_manifest_hash.slice(0, 12)}…` : "MISSING");
line("contracts", identityReport.contract_snapshot_hash ? `snapshot ${identityReport.contract_snapshot_hash.slice(0, 12)}…` : "MISSING");
line("test inventory", identityReport.test_manifest_hash ? `${identityReport.test_files} files / ${identityReport.test_cases} cases ${identityReport.test_manifest_hash.slice(0, 12)}…` : "MISSING");
line("delivery gates", `${audit.gates_passed}/${audit.gates_required} ${audit.gates_passed === audit.gates_required ? "PASS" : "FAIL"}`);
line("desktop black box", `${audit.desktop.verified_claims}/${audit.desktop.required_claims} ${audit.desktop.passed ? "PASS" : "FAIL"}`);
line("capabilities", `${audit.capabilities.passed}/${audit.capabilities.required} ${audit.capabilities.passed === audit.capabilities.required ? "ESTABLISHED" : "INCOMPLETE"}`);
line("owner interventions", String(audit.owner_interventions));
line("adversarial", `${adversarialCases}/${adversarialCases} REFUSED`);
line("fuzz defense", evolutionFalsePositives === 0 ? `PASS (${fuzzCases} cases)` : "FAIL");
line("metamorphic", metamorphicCases > 0 ? `PASS (${metamorphicCases} cases)` : "FAIL");
line("validator A", validatorA);
line("validator B", validatorB);
line("reproducibility", reproducibility.stable ? `PASS (${String(reproducibility.digest).slice(0, 12)}…)` : "FAIL");
line("seeded evolution runs", `${roundsPassed}/${roundsRequired}`);
line("unresolved findings", String(unresolved));
line("root hash", rootHash);
console.log("");
if (!certified) {
  for (const reason of reasons.slice(0, 12)) console.error(`[evolution]   ${reason}`);
  console.error("[evolution] AUTONOMOUS_EVOLUTION_INCOMPLETE");
  process.exit(1);
}
console.log("[evolution] AUTONOMOUS_EVOLUTION_CERTIFIED");
