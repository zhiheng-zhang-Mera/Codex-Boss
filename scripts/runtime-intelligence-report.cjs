#!/usr/bin/env node
/**
 * Runtime Intelligence Plane — report CLI.
 *
 * Runs the real plane against this machine and prints what it observed: the node
 * capability snapshot (including every metric it could not measure), the model ledger's
 * current state, an optional scheduling recommendation and the explanation of a recorded
 * task.
 *
 * It is a script rather than a `package.json` entry on purpose: `package.json` is a Root
 * surface (CODEOWNERS owns it), and adding a script name to it is an Owner decision, not
 * an autonomous one. Run it directly:
 *
 *     node scripts/runtime-intelligence-report.cjs [--root <dataRoot>] [--task <taskId>]
 *                                                  [--advise] [--out <file>]
 *
 * It loads the COMPILED modules out of `dist-electron/`, so run `pnpm run build:electron`
 * first. It is read-only apart from the snapshot it records under the plane's own data
 * root, and it has no authority over anything: every recommendation it prints carries
 * `authority: "ADVISORY_ONLY"`.
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
  const options = { root: path.join(ROOT, "runtime-data"), task: undefined, advise: false, out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.root = path.resolve(argv[++index] ?? "");
    else if (argument === "--task") options.task = argv[++index];
    else if (argument === "--advise") options.advise = true;
    else if (argument === "--out") options.out = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/runtime-intelligence-report.cjs [--root <dataRoot>] [--task <taskId>] [--advise] [--out <file>]\n");
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

const options = parseArgs(process.argv.slice(2));
if (options) {
  const serviceModule = load("electron/runtime-intelligence/runtime-intelligence-service.js");
  const profileModule = load("src/shared/runtime-intelligence/node-profile.js");
  const contractModule = load("src/shared/runtime-intelligence/contracts.js");
  if (serviceModule && profileModule && contractModule) {
    const service = new serviceModule.RuntimeIntelligenceService({
      rootDir: serviceModule.runtimeIntelligenceRoot(options.root),
      nodeProfiler: { repoRoot: ROOT, trustClass: "TRUSTED_HOST", executionRestrictions: [] }
    });

    const snapshot = service.profileNode();
    const readiness = profileModule.nodeReadiness(snapshot);
    const coverage = profileModule.nodeCoverage(snapshot);
    const report = {
      schemaVersion: contractModule.RUNTIME_INTELLIGENCE_SCHEMA_VERSION,
      kind: "RUNTIME_INTELLIGENCE_REPORT",
      generatedAt: new Date().toISOString(),
      host: os.hostname(),
      authority: "ADVISORY_ONLY",
      node: {
        nodeId: snapshot.nodeId,
        readiness: readiness.readiness,
        readinessReasons: readiness.reasons,
        metricsObserved: `${coverage.measured}/${coverage.total}`,
        notMeasured: coverage.absentKeys
      },
      ledger: service.models().map((record) => ({
        modelKey: record.modelKey,
        samples: Object.values(record.scores).reduce((total, estimate) => Math.max(total, estimate.samples), 0),
        warmStarted: record.warmStarted,
        warmStartSources: record.warmStartSources,
        taskTypePerformance: record.taskTypePerformance,
        failureClasses: record.failureClasses,
        reviewAgreement: record.reviewAgreement
      })),
      store: service.status()
    };

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

    const text = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(text);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, text, "utf8");
    }
  }
}
