#!/usr/bin/env node
/**
 * Runtime Intelligence Plane — report CLI.
 *
 * Runs the real plane against this machine and prints what it found:
 *
 *   --snapshot            the node capability snapshot, including every metric it could not measure
 *   --advise              a scheduling recommendation for a synthetic reviewer task
 *   --task <taskId>       the explanation of the most recent recorded run of a task
 *   --sample <n>          take n real node samples through the telemetry log (dogfooding)
 *   --evaluate            the full evaluation report: ingestion, replays, calibration, growth,
 *                         boundary facts and the assisted-execution gates
 *
 * It is a script rather than a `package.json` entry on purpose: `package.json` is a Root
 * surface, and adding a script name to it is an Owner decision, not an autonomous one.
 *
 * It loads the COMPILED modules out of `dist-electron/`, so run `pnpm run build:electron`
 * first. It has no authority over anything: every recommendation carries
 * `authority: "ADVISORY_ONLY"` and the evaluation report carries
 * `grantsExecutionAuthority: false`.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const options = { root: path.join(ROOT, "runtime-data"), dataRoot: undefined, task: undefined, advise: false, evaluate: false, snapshot: false, samples: 0, out: undefined, skillCards: undefined, continuationCorpus: undefined, base: "origin/main" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.root = path.resolve(argv[++index] ?? "");
    else if (argument === "--data-root") options.dataRoot = path.resolve(argv[++index] ?? "");
    else if (argument === "--task") options.task = argv[++index];
    else if (argument === "--sample") options.samples = Number(argv[++index] ?? "1");
    else if (argument === "--skill-cards") options.skillCards = path.resolve(argv[++index] ?? "");
    else if (argument === "--continuation-corpus") options.continuationCorpus = path.resolve(argv[++index] ?? "");
    else if (argument === "--base") options.base = argv[++index] ?? "origin/main";
    else if (argument === "--advise") options.advise = true;
    else if (argument === "--evaluate") options.evaluate = true;
    else if (argument === "--snapshot") options.snapshot = true;
    else if (argument === "--out") options.out = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/runtime-intelligence-report.cjs [--snapshot] [--advise] [--task <taskId>] [--sample <n>] [--evaluate] [--root <dataRoot>] [--data-root <dir>] [--skill-cards <file>] [--continuation-corpus <file>] [--base <ref>] [--out <file>]\n");
      process.exit(0);
    } else {
      fail(`unknown argument ${argument}`);
      return undefined;
    }
  }
  return options;
}

function load(relative) {
  const file = path.join(ROOT, "dist-electron", ...relative.split("/"));
  if (!fs.existsSync(file)) {
    fail(`the compiled plane is missing at ${path.relative(ROOT, file)}; run \`pnpm run build:electron\` first`);
    return undefined;
  }
  return require(file);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return undefined;
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

const options = parseArgs(process.argv.slice(2));
if (options) {
  const serviceModule = load("electron/runtime-intelligence/runtime-intelligence-service.js");
  const profileModule = load("src/shared/runtime-intelligence/node-profile.js");
  const contractModule = load("src/shared/runtime-intelligence/contracts.js");
  const logModule = load("electron/runtime-intelligence/node-telemetry-log.js");
  if (serviceModule && profileModule && contractModule && logModule) {
    const service = new serviceModule.RuntimeIntelligenceService({
      rootDir: serviceModule.runtimeIntelligenceRoot(options.root),
      nodeProfiler: { repoRoot: ROOT, trustClass: "TRUSTED_HOST", executionRestrictions: [] }
    });
    const nodeLog = new logModule.NodeTelemetryLog({ rootDir: serviceModule.runtimeIntelligenceRoot(options.root) });

    const report = {
      schemaVersion: contractModule.RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
      kind: "RUNTIME_INTELLIGENCE_REPORT",
      generatedAt: new Date().toISOString(),
      host: os.hostname(),
      authority: "ADVISORY_ONLY"
    };

    if (options.snapshot || (!options.evaluate && !options.advise && !options.task && options.samples === 0)) {
      const snapshot = service.profileNode();
      const readiness = profileModule.nodeReadiness(snapshot);
      const coverage = profileModule.nodeCoverage(snapshot);
      report.node = {
        nodeId: snapshot.nodeId,
        readiness: readiness.readiness,
        readinessReasons: readiness.reasons,
        metricsObserved: `${coverage.measured}/${coverage.total}`,
        notMeasured: coverage.absentKeys
      };
      report.ledger = service.models().map((record) => ({
        modelKey: record.modelKey,
        samples: Object.values(record.scores).reduce((total, estimate) => Math.max(total, estimate.samples), 0),
        warmStarted: record.warmStarted,
        warmStartSources: record.warmStartSources,
        taskTypePerformance: record.taskTypePerformance,
        failureClasses: record.failureClasses,
        reviewAgreement: record.reviewAgreement
      }));
      report.store = service.status();
    }

    if (options.samples > 0) {
      // Real dogfooding: each sample reads this host through the real profiler.
      const samples = [];
      for (let index = 0; index < options.samples; index += 1) samples.push(nodeLog.sample({ repoRoot: ROOT }));
      nodeLog.compact();
      report.sampling = { requested: options.samples, stored: samples.filter((entry) => entry.stored).length, results: samples, status: nodeLog.status() };
    }

    if (options.advise) {
      const recommendation = service.adviseFor({
        taskId: "runtime-intelligence-report",
        role: "reviewer",
        taskKind: "review",
        requiredCapabilities: [],
        contextScale: "small",
        externalEffect: false,
        risk: "low",
        createdAt: new Date().toISOString()
      });
      report.recommendation = {
        recommendationId: recommendation.recommendationId,
        authority: recommendation.authority,
        productionRoutingAuthority: recommendation.productionRoutingAuthority,
        qualificationHostSelection: recommendation.qualificationHostSelection,
        preferredModel: recommendation.preferredModel ?? null,
        preferredNode: recommendation.preferredNode ?? null,
        confidence: recommendation.confidence,
        estimatedRisk: recommendation.estimatedRisk,
        blocked: recommendation.blocked,
        factors: recommendation.reasoningFactors.map((factor) => `${factor.factor}: ${factor.detail}`)
      };
    }

    if (options.task) {
      const observation = service.latestObservationFor(options.task);
      report.task = observation
        ? { observationId: observation.observationId, explanation: service.explain(observation.observationId) }
        : { note: `no observation is recorded for task ${options.task}` };
    }

    if (options.evaluate) {
      const cards = options.skillCards ? readJsonl(options.skillCards) ?? [] : [];
      const continuationCorpus = options.continuationCorpus ? readJsonl(options.continuationCorpus) ?? [] : [];
      const snapshots = nodeLog.snapshots();
      const coverageByNode = [...new Set(snapshots.map((snapshot) => snapshot.nodeId))].map((nodeId) => {
        const latest = nodeLog.snapshots(nodeId).at(-1);
        const coverage = profileModule.nodeCoverage(latest);
        return { nodeId, coverage: coverage.coverage, absentKeys: coverage.absentKeys };
      });
      const logStatus = nodeLog.status();
      const boundaryAssessment = require("./runtime-intelligence-diff-guard.cjs").assessBranchBoundary(options.base);
      const bundle = service.evaluate({
        ...(options.dataRoot === undefined ? {} : { dataRoot: options.dataRoot }),
        skillCards: cards,
        continuationCorpus,
        nodeTelemetry: {
          rawSamples: logStatus.storedSamples,
          afterCompaction: logStatus.afterCompaction,
          suppressedSamples: logStatus.suppressedSamples,
          archivedEntries: logStatus.archivedEntries,
          bytes: logStatus.bytes,
          nodes: logStatus.nodes,
          coverageByNode
        },
        boundary: {
          rootTrustTouched: boundaryAssessment.rootTrustSurfacePathsChanged.length > 0,
          qualificationTouched: boundaryAssessment.qualificationPathsTouched.length > 0,
          ownerReviewPaths: boundaryAssessment.ownerReviewPaths,
          authorityDecision: boundaryAssessment.authority.decision,
          changeClass: boundaryAssessment.authority.changeClass
        }
      });
      report.evaluation = bundle.report;
      report.boundaryAssessment = boundaryAssessment;
    }

    const text = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(text);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, text, "utf8");
    }
  }
}
