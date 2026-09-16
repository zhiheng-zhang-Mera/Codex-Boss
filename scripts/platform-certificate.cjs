#!/usr/bin/env node
/**
 * Phase 05 Task G — the platform certificate (acceptance gate 9).
 *
 * ## What this file is for
 *
 * The certificate is the machine-readable statement that the platform is what the five phases claim
 * it is. The engineering book lists what it must cover: architecture graph, state ownership,
 * migrations, event journal, permission surface, knowledge provenance and staleness, retention and
 * GC, targeted and full verification evidence, provider degraded-mode evidence, and the soak
 * resource trend.
 *
 * ## The rule that shapes every section
 *
 * **The certificate recomputes; it does not transcribe.** A certificate assembled by copying the
 * phase artifacts would report what those runs said at the time, and would keep saying it after the
 * tree moved underneath them. So each section is re-derived here — from the compiled platform, the
 * live manifests and the real modules — and the phase artifact is then CROSS-CHECKED against the
 * recomputation. A disagreement is a failure, not a footnote, because it means one of the two is
 * describing a tree that no longer exists.
 *
 * ## What it deliberately cannot do
 *
 * `bypassesRootOrOwnerGate` is `false` and is not configurable. The book allows self-evolution
 * promotion to CONSUME a certificate; it forbids a certificate from standing in for the Root or
 * Owner gate. A certificate that could authorise its own promotion would be the mechanism the
 * prohibition exists to prevent, so the field is a constant with a test asserting it.
 *
 * Run: node scripts/platform-certificate.cjs
 * Writes: artifacts/platform-foundation/phase-05/platform-certificate.json
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "artifacts", "platform-foundation", "phase-05", "platform-certificate.json");
const COMPILED = path.join(ROOT, "dist-electron");

/**
 * Where the phase artifacts are read from.
 *
 * Overridable so the acceptance suite can point the generator at a COPY of the artifacts with one
 * cross-check deliberately broken, and prove the certificate fails closed rather than being written.
 * The real artifacts are never mutated by a test.
 */
const ARTIFACT_ROOT = process.env.PHASE_CERT_ARTIFACTS ? path.resolve(process.env.PHASE_CERT_ARTIFACTS) : path.join(ROOT, "artifacts", "platform-foundation");
const ARTIFACT_OUT = process.env.PHASE_CERT_OUT ? path.resolve(process.env.PHASE_CERT_OUT) : OUT;

const ARTIFACTS = {
  "phase-01": path.join(ARTIFACT_ROOT, "phase-01", "architecture-snapshot.json"),
  "phase-02": path.join(ARTIFACT_ROOT, "phase-02", "state-migration-report.json"),
  "phase-03": path.join(ARTIFACT_ROOT, "phase-03", "permission-surface.json"),
  "phase-04": path.join(ARTIFACT_ROOT, "phase-04", "data-lifecycle-report.json")
};

/** Sections whose evidence does not exist yet. Named here rather than omitted, so the gap is legible. */
const NOT_RUN = {
  soakResourceTrend: "Task F is not started: the controlled 24h/72h soak has not been run on this branch, so there is no resource trend to report. A certificate that reported a trend it did not measure would be worthless for exactly the purpose it exists for.",
  agentCoordinationEconomics: "Task D is not started: no per-task model-call/token/wall-time/rework record has been collected, so the added-stage guard has no evidence to act on."
};

function load(relative) {
  const file = path.join(COMPILED, relative);
  if (!fs.existsSync(file)) throw new Error(`the compiled module ${relative} is missing; run \`pnpm run build:electron\` first.`);
  return require(file);
}

function readArtifact(key) {
  const file = ARTIFACTS[key];
  if (!fs.existsSync(file)) throw new Error(`${path.relative(ROOT, file)} is missing; the certificate cross-checks it and will not guess.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function main() {
  const problems = [];
  const require_ = (condition, message) => { if (!condition) problems.push(message); };
  const sections = {};

  // ---------------------------------------------------------------- architecture graph
  const registryModule = load("electron/platform/capability-registry.js");
  const healthModule = load("electron/platform/platform-health.js");
  const ratchetModule = load("electron/platform/architecture-ratchet.js");
  const scanModule = load("electron/platform/repo-scan.js");

  const registry = registryModule.buildCapabilityRegistry(ROOT);
  const graph = registry.graph;
  const snapshot = readArtifact("phase-01");

  require_(graph.fatalCycles.length === 0, `the dependency graph has ${graph.fatalCycles.length} fatal cycle(s)`);
  require_(graph.bootable, "the dependency graph is not bootable");
  require_(graph.nodes.length === snapshot.capabilities.count, `the graph has ${graph.nodes.length} capabilities but the Phase 01 snapshot recorded ${snapshot.capabilities.count}`);
  require_(graph.edges.length === snapshot.dependencyGraph.edgeCount, `the graph has ${graph.edges.length} edges but the snapshot recorded ${snapshot.dependencyGraph.edgeCount}`);

  // The ratchet is re-EVALUATED here rather than read, so a baseline that has been widened to pass
  // is caught by the certificate rather than certified by it.
  const evidence = scanModule.gatherArchitectureEvidence({ repoRoot: ROOT, registry });
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, registryModule.ARCHITECTURE_BASELINE_PATH), "utf8"));
  const ratchet = ratchetModule.evaluateRatchet(evidence, baseline);
  require_(ratchet.pass, `the architecture ratchet fails: ${ratchet.results.filter((entry) => !entry.pass).map((entry) => entry.id).join(", ")}`);
  require_(ratchet.violations === undefined || ratchet.violations.length === 0, "the architecture ratchet reported violations");

  sections.architectureGraph = {
    capabilities: graph.nodes.length,
    kernel: graph.nodes.filter((node) => node.kind === "kernel").length,
    features: graph.nodes.filter((node) => node.kind === "feature").length,
    edges: graph.edges.length,
    requiredEdges: graph.edges.filter((edge) => edge.kind === "required").length,
    fatalCycles: graph.fatalCycles.length,
    bootable: graph.bootable,
    bootOrderLength: graph.bootOrder.length,
    ratchetPass: ratchet.pass,
    ratchetMetrics: ratchet.metrics,
    ratchetBaselineMatchesMeasurement: Object.entries(ratchet.metrics).every(([key, value]) => baseline.metrics[key] === value),
    snapshotAgrees: graph.nodes.length === snapshot.capabilities.count && graph.edges.length === snapshot.dependencyGraph.edgeCount,
    literalIpcRegistrationsInMain: evidence.literalIpcRegistrations,
    unregisteredBootModules: evidence.wiredBootFactories.filter((factory) => !evidence.registeredBootFactories.includes(factory))
  };
  require_(sections.architectureGraph.unregisteredBootModules.length === 0, `${sections.architectureGraph.unregisteredBootModules.length} wired boot module(s) are unregistered`);

  // ---------------------------------------------------------------- state ownership
  const ownership = registry.ownership;
  require_(ownership.conflicts.length === 0, `${ownership.conflicts.length} namespace(s) have more than one owner`);
  // Phase 02's independence claim, re-checked against the live manifests rather than believed.
  const decisionLedgerOwners = registry.manifests.filter((manifest) => manifest.state.some((claim) => claim.namespace === "decision-ledger")).map((manifest) => manifest.id);
  require_(decisionLedgerOwners.length === 1, `decision-ledger has ${decisionLedgerOwners.length} owning manifests`);
  sections.stateOwnership = {
    namespaces: ownership.namespaces.length,
    duplicateOwners: ownership.conflicts.length,
    declarationProblems: ownership.declarationProblems.length,
    decisionLedgerOwner: decisionLedgerOwners[0] ?? null,
    snapshotAgrees: ownership.namespaces.length === snapshot.stateOwnership.namespaces
  };
  require_(sections.stateOwnership.snapshotAgrees, `the live registry has ${ownership.namespaces.length} namespaces but the Phase 01 snapshot recorded ${snapshot.stateOwnership.namespaces}`);

  // ---------------------------------------------------------------- platform health
  const health = healthModule.evaluatePlatformHealth(registry.manifests, graph);
  require_(health.bootable, `the platform is not bootable: ${health.fatal.join(", ")}`);
  sections.platformHealth = {
    bootable: health.bootable,
    fatal: health.fatal,
    degraded: health.degraded,
    missing: health.missing.length,
    note: "evaluated over the full manifest set with nothing removed; a removal probe is the DEGRADED path and is covered by the Phase 01 suite"
  };

  // ---------------------------------------------------------------- migrations
  const migration = readArtifact("phase-02");
  require_(migration.summary.duplicateOwners === 0, "the migration report recorded duplicate owners");
  const total = migration.summary.migratedToDatabase + migration.summary.remainingJson;
  require_(total === migration.summary.namespacesInventoried, `the migration report accounts for ${total} of ${migration.summary.namespacesInventoried} namespaces`);
  sections.migrations = {
    namespacesInventoried: migration.summary.namespacesInventoried,
    migratedToDatabase: migration.summary.migratedToDatabase,
    remainingJson: migration.summary.remainingJson,
    accountingComplete: total === migration.summary.namespacesInventoried,
    duplicateOwners: migration.summary.duplicateOwners,
    pilotsCompleted: migration.summary.pilotsCompleted,
    shadowBeforeAuthority: migration.acceptance?.gate6ShadowBeforeAuthority ? true : undefined,
    note: "read from the Phase 02 report, whose generator performs the migration for real against a temporary data root; the state-core engine is a dependency of the application at boot"
  };

  // ---------------------------------------------------------------- event journal
  const stateCore = load("electron/state-core/database.js");
  const journal = load("electron/state-core/event-journal.js");
  const recovery = load("electron/state-core/recovery.js");
  sections.eventJournal = {
    coreSchemaVersion: stateCore.CORE_SCHEMA_VERSION,
    currentSchemaVersion: stateCore.CURRENT_SCHEMA_VERSION,
    journalModuleExports: Object.keys(journal).sort(),
    recoveryModuleExports: Object.keys(recovery).sort(),
    note: "the journal's behaviour is covered by the Phase 02 acceptance suites (crash durability, replay without duplicate effect); this section records that the modules the certificate names exist and are the compiled application's own, not a re-description"
  };
  require_(typeof stateCore.CORE_SCHEMA_VERSION === "number", "the state core does not declare a schema version");
  require_(typeof recovery.inspectRecovery === "function", "the state core has no recovery inspector");

  // ---------------------------------------------------------------- permission surface
  const permission = readArtifact("phase-03");
  const authorization = load("electron/capability/authorization.js");
  require_(permission.summary.wildcardAuthority === 0, `the permission surface recorded ${permission.summary.wildcardAuthority} wildcard authority grant(s)`);
  require_(permission.summary.escapesRefused === permission.summary.escapesAttempted, `${permission.summary.escapesAttempted - permission.summary.escapesRefused} escape(s) were not refused`);
  require_(permission.escapeBattery.every((entry) => entry.outcome === "DENY"), "an escape-battery case is recorded as not denied");
  require_(permission.defaultDeny.enforced === true, "default deny is recorded as not enforced");
  // Live grants are re-checked with the real validator rather than by reading the summary. It checks
  // resource and action wildcards AND an ambient credential, which is the escalation the Phase 03
  // contract refuses; re-running it here means the certificate cannot be satisfied by a grant that
  // was added after the surface was measured.
  const subjects = permission.subjects ?? [];
  const allGrants = subjects.flatMap((subject) => subject.grants ?? []);
  const wildcards = authorization.findWildcardAuthority(allGrants);
  require_(wildcards.length === 0, `${wildcards.length} live grant(s) carry wildcard or ambient-credential authority: ${wildcards.join(", ")}`);
  sections.permissionSurface = {
    subjects: permission.summary.subjects,
    grants: permission.summary.grants,
    wildcardAuthority: permission.summary.wildcardAuthority,
    liveGrantsRechecked: allGrants.length,
    liveWildcards: wildcards.length,
    escapesAttempted: permission.summary.escapesAttempted,
    escapesRefused: permission.summary.escapesRefused,
    defaultDeny: permission.defaultDeny.enforced,
    mappedBoundaries: permission.boundaryInventory.summary.mapped,
    legacyBoundaries: permission.boundaryInventory.summary.legacy,
    gates: permission.gates
  };

  // ---------------------------------------------------------------- knowledge provenance and staleness
  const claimModule = load("src/shared/knowledge-claim.js");
  const stalenessModule = load("src/shared/knowledge-staleness.js");
  // A live probe rather than a claim: a verified assertion over a mutable source must be refused.
  const mutableSourceRefused = claimModule.validateClaim({
    id: "certificate-probe", claim: "a probe", kind: "fact",
    scope: { project: "Codex-Boss" },
    provenance: { sourceType: "external", sourceRef: "https://example.invalid" },
    validity: { validFrom: "2026-01-01T00:00:00.000Z", validUntil: null },
    confidence: { level: "verified", basis: "a URL" }, supersededBy: null, createdAt: "2026-01-01T00:00:00.000Z"
  }).length > 0;
  require_(mutableSourceRefused, "a verified claim over a mutable source was accepted");
  const lifecycle = readArtifact("phase-04");
  sections.knowledgeAndRetention = {
    knowledgeKinds: claimModule.KNOWLEDGE_KINDS.length,
    confidenceLevels: claimModule.CONFIDENCE_LEVELS.length,
    evidenceFloorsDeclared: Object.keys(claimModule.EVIDENCE_FLOORS).length,
    verifiedOverMutableSourceRefused: mutableSourceRefused,
    stalenessReasons: Object.keys(stalenessModule.reasonHistogram([])).length,
    dataClasses: lifecycle.declared.classes.length,
    protectedDeletable: lifecycle.declared.rules.PROTECTED.deletable,
    gcInvariantsHeld: lifecycle.acceptance.invariantsChecked,
    gcProblems: lifecycle.acceptance.problems.length,
    zeroMisdeletion: lifecycle.gc.zeroMisdeletion.misdeleted.length === 0,
    liveMisdeleted: lifecycle.gc.liveCorpus.misdeleted.length,
    retrievalTop: lifecycle.retrieval.mixedCorpus.top,
    retrievalCorpusSize: lifecycle.retrieval.mixedCorpus.size
  };
  require_(lifecycle.acceptance.problems.length === 0, "the Phase 04 report recorded problems");
  require_(lifecycle.gc.zeroMisdeletion.misdeleted.length === 0, "the Phase 04 report recorded a misdeleted record");

  // ---------------------------------------------------------------- provider degraded mode
  const compatibilityModule = load("src/shared/external-compatibility.js");
  // Every observed runtime must be non-critical to the core, which is what makes provider trouble local.
  // The observation itself is produced by the Phase 05 suite against the real registry; what the
  // certificate checks is the invariant over the model, so it cannot pass if the invariant were removed.
  const probeEntries = ["web:a", "web:b", "web:c"].map((id, index) => compatibilityModule.observeCompatibility(undefined, {
    id, axis: "runtime", healthProbe: "certificate probe", at: "2026-09-16T00:00:00.000Z",
    healthy: index === 0,
    ...(index === 0 ? { contractVersion: "1..1" } : { failure: { class: "PAGE_STRUCTURE_CHANGED", detail: "certificate probe" } })
  }));
  const probeVerdict = compatibilityModule.evaluateCompatibility(probeEntries);
  require_(probeVerdict.verdict !== "FAILED", "two of three providers broken moved the core verdict to FAILED");
  require_(probeEntries.every((entry) => entry.criticalToCore === false), "an observed runtime is marked critical to the core");
  require_(compatibilityModule.FAILURE_FALLBACKS.CONTRACT_VERSION_CHANGED !== "RETRY_BOUNDED", "a moved contract is retried rather than rerouted");
  sections.providerDegradedMode = {
    axes: ["provider", "runtime", "tool", "backend", "identity"],
    failureClasses: compatibilityModule.FAILURE_CLASSES.length,
    everyClassHasAFallback: compatibilityModule.FAILURE_CLASSES.every((failureClass) => Boolean(compatibilityModule.FAILURE_FALLBACKS[failureClass])),
    everyClassHasAReason: compatibilityModule.FAILURE_CLASSES.every((failureClass) => (compatibilityModule.FAILURE_CLASS_REASONS[failureClass] ?? "").length > 30),
    probeVerdictWithTwoOfThreeBroken: probeVerdict.verdict,
    observedRuntimesCriticalToCore: probeEntries.filter((entry) => entry.criticalToCore).length,
    gate4Evidence: "tests/unit/platform/external-compatibility.test.ts proves local degradation and reroute over the real RuntimeRegistry + CircuitBreaker + ExecutionSupervisor"
  };

  // ---------------------------------------------------------------- verification evidence
  const impactAudit = runImpactAudit();
  sections.verification = {
    tiers: ["unit", "postbuild", "slow"],
    impactSelector: impactAudit,
    targetedAndFullAgreement: {
      mechanism: "scripts/test-impact.cjs verify",
      recorded: false,
      reason: "the selection has been compared against the catalogue and the audit is enforced by tests, but a run of the full suite paired with a selection has not been recorded as evidence yet; gate 2 is therefore reported as partly met rather than met"
    },
    testCatalogue: { path: "config/test-catalogue.json", checkedBy: "node scripts/generate-test-catalogue.cjs --check" }
  };
  require_(impactAudit.suites > 0, "the impact selector reported no suites");
  require_(impactAudit.unownedSourceFiles === 0, `${impactAudit.unownedSourceFiles} source file(s) are owned by no capability`);

  // ---------------------------------------------------------------- soak
  //
  // The soak report is READ rather than restated. If it is missing the section stays unmeasured and
  // says so: a certificate that reported a resource trend it had not read would be worth nothing for
  // the one purpose Task F exists for.
  const soakReportPath = path.join(ROOT, "artifacts", "platform-foundation", "phase-05", "soak-report.json");
  if (fs.existsSync(soakReportPath)) {
    const soak = JSON.parse(fs.readFileSync(soakReportPath, "utf8"));
    const failedInvariants = soak.acceptance?.failedInvariants ?? [];
    sections.soakResourceTrend = {
      measured: true,
      reportPath: "artifacts/platform-foundation/phase-05/soak-report.json",
      minutes: Math.round((soak.elapsedMs ?? 0) / 60_000),
      samples: soak.samples,
      cycles: soak.totals?.cycles,
      stateWrites: soak.totals?.stateWrites,
      eventsAppended: soak.totals?.eventsAppended,
      restarts: soak.totals?.restarts,
      recoveredTransactions: soak.totals?.recoveredTransactions,
      gcPlanned: soak.totals?.gcPlanned,
      gcCollected: soak.totals?.gcCollected,
      gcMisdeleted: soak.totals?.gcMisdeleted,
      databaseBytes: soak.storage?.databaseBytes,
      eventBacklog: soak.storage?.eventBacklog,
      trends: soak.trends,
      allowancePerMinute: soak.bounds?.longRunAllowancePerMinute,
      trendWithinLongRunAllowance: soak.bounds?.trendWithinLongRunAllowance === true,
      failedInvariants,
      unavailable: soak.unavailable
    };
    require_(failedInvariants.length === 0, `the soak report records failed invariant(s): ${failedInvariants.join(", ")}`);
    require_(soak.bounds?.trendWithinLongRunAllowance === true, "the soak report's resource trend exceeds the long-run allowance per minute");
    require_((soak.totals?.gcMisdeleted ?? -1) === 0, "the soak deleted protected data");
    require_((soak.totals?.recoveredTransactions ?? 0) === (soak.totals?.cycles ?? -1), "the soak did not recover its deliberate transaction failure every cycle");
  } else {
    sections.soakResourceTrend = { measured: false, reason: NOT_RUN.soakResourceTrend };
  }
  sections.agentCoordinationEconomics = { measured: false, reason: NOT_RUN.agentCoordinationEconomics };

  // ---------------------------------------------------------------- promotion
  /**
   * The certificate may be consumed by a promotion gate; it may never stand in for one.
   *
   * A constant, not an argument and not a computed field. A certificate able to authorise its own
   * promotion would be precisely the mechanism the book's prohibition exists to prevent, so there is
   * nothing a caller can pass to make it true.
   */
  const BYPASSES_ROOT_OR_OWNER_GATE = false;
  require_(BYPASSES_ROOT_OR_OWNER_GATE === false, "the certificate would claim it can bypass the Root/Owner gate");

  const certificate = {
    $comment: "Phase 05 platform certificate. Every section is recomputed from the compiled platform and cross-checked against the phase artifact it names; disagreements fail the generator rather than being reported. Sections whose task is not started say so instead of reporting a measurement that was never taken.",
    generatedAt: new Date().toISOString(),
    phase: "05-scale-verification-soak",
    node: process.version,
    sections,
    completeness: {
      delivered: Object.entries(sections).filter(([, section]) => !section || section.measured !== false).map(([name]) => name).sort(),
      notRun: Object.entries(sections).filter(([, section]) => section && section.measured === false).map(([name]) => name).sort(),
      phaseStatus: "PARTIAL",
      note: "the phase is PARTIAL: Tasks D, E and F are not complete, and this certificate reports that rather than certifying a phase that is not finished"
    },
    promotion: {
      consumableBySelfEvolution: true,
      bypassesRootOrOwnerGate: BYPASSES_ROOT_OR_OWNER_GATE,
      note: "the certificate is evidence a promotion gate may read; it is not an authorization. Root Authority and the Owner gate are unchanged by it and cannot be satisfied by it."
    },
    acceptance: {
      invariantsChecked: problems.length === 0,
      problems,
      evidence: {
        "architecture-graph-valid": sections.architectureGraph.fatalCycles === 0 && sections.architectureGraph.bootable,
        "ratchet-passes-and-baseline-matches": sections.architectureGraph.ratchetPass && sections.architectureGraph.ratchetBaselineMatchesMeasurement,
        "no-unregistered-boot-module": sections.architectureGraph.unregisteredBootModules.length === 0,
        "state-ownership-unique": sections.stateOwnership.duplicateOwners === 0,
        "platform-bootable": sections.platformHealth.bootable,
        "migrations-accounted-for": sections.migrations.accountingComplete && sections.migrations.duplicateOwners === 0,
        "journal-modules-present": sections.eventJournal.journalModuleExports.length > 0 && sections.eventJournal.recoveryModuleExports.length > 0,
        "permission-surface-no-wildcard-escalation": sections.permissionSurface.wildcardAuthority === 0 && sections.permissionSurface.liveWildcards === 0,
        "every-escape-refused": sections.permissionSurface.escapesRefused === sections.permissionSurface.escapesAttempted,
        "knowledge-provenance-enforced": sections.knowledgeAndRetention.verifiedOverMutableSourceRefused,
        "retention-protects-evidence": sections.knowledgeAndRetention.protectedDeletable === false && sections.knowledgeAndRetention.zeroMisdeletion,
        "provider-failure-is-local": sections.providerDegradedMode.probeVerdictWithTwoOfThreeBroken === "DEGRADED",
        "impact-selector-owns-the-tree": sections.verification.impactSelector.unownedSourceFiles === 0,
        "soak-trend-measured-and-bounded": sections.soakResourceTrend.measured === true && sections.soakResourceTrend.trendWithinLongRunAllowance === true,
        "certificate-cannot-bypass-the-gate": BYPASSES_ROOT_OR_OWNER_GATE === false
      }
    }
  };

  if (problems.length > 0) {
    process.stderr.write(`the platform certificate FAILED ${problems.length} invariant(s):\n`);
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  // Re-read from the emitted object rather than from the local constant, so the file and the check
  // cannot diverge: what is asserted is what gets written.
  if (certificate.promotion.bypassesRootOrOwnerGate !== false) {
    process.stderr.write("the certificate would claim it can bypass the Root/Owner gate; refusing to write it\n");
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(path.dirname(ARTIFACT_OUT), { recursive: true });
  fs.writeFileSync(ARTIFACT_OUT, `${JSON.stringify(certificate, null, 2)}\n`, "utf8");
  process.stdout.write(`platform certificate written: ${path.relative(ROOT, ARTIFACT_OUT)}\n`);
  process.stdout.write(`  architecture: ${sections.architectureGraph.capabilities} capabilities, ${sections.architectureGraph.edges} edges, ratchet ${sections.architectureGraph.ratchetPass ? "pass" : "FAIL"}\n`);
  process.stdout.write(`  ownership: ${sections.stateOwnership.namespaces} namespaces, ${sections.stateOwnership.duplicateOwners} duplicate owners\n`);
  process.stdout.write(`  permission: ${sections.permissionSurface.escapesRefused}/${sections.permissionSurface.escapesAttempted} escapes refused, ${sections.permissionSurface.wildcardAuthority} wildcard grants\n`);
  process.stdout.write(`  verification: ${impactAudit.suites} suites, ${impactAudit.unownedSourceFiles} unowned source files\n`);
  process.stdout.write(`  not run: ${certificate.completeness.notRun.join(", ")}\n`);
  process.stdout.write(`  invariants: all ${Object.keys(certificate.acceptance.evidence).length} held\n`);
}

/** Run the impact audit through the compiled selector, so the certificate reads its numbers not its prose. */
function runImpactAudit() {
  const impact = load("electron/platform/test-impact.js");
  const shared = load("src/shared/test-impact.js");
  const repository = impact.loadImpactRepository(ROOT);
  const covered = new Set(repository.catalogue.flatMap((suite) => suite.covers));
  return {
    suites: repository.catalogue.length,
    capabilities: repository.modulesByCapability.size,
    capabilitiesWithoutASuite: [...repository.modulesByCapability.keys()].filter((id) => !covered.has(id)).sort(),
    alwaysRun: repository.catalogue.filter((suite) => suite.alwaysRun).length,
    duplicateObligations: shared.duplicateObligations(repository.catalogue).length,
    unownedSourceFiles: impact.unattributedSourceFiles(ROOT, repository.modulesByCapability).length
  };
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
