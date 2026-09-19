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
  const options = { root: path.join(ROOT, "runtime-data"), dataRoot: undefined, task: undefined, advise: false, evaluate: false, realData: false, prospective: false, snapshot: false, samples: 0, out: undefined, skillCards: undefined, continuationCorpus: undefined, base: "origin/main" };
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
    else if (argument === "--real-data") options.realData = true;
    else if (argument === "--prospective") options.prospective = true;
    else if (argument === "--snapshot") options.snapshot = true;
    else if (argument === "--out") options.out = path.resolve(argv[++index] ?? "");
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write("usage: node scripts/runtime-intelligence-report.cjs [--snapshot] [--advise] [--task <taskId>] [--sample <n>] [--evaluate] [--real-data] [--prospective] [--root <dataRoot>] [--data-root <dir>] [--skill-cards <file>] [--continuation-corpus <file>] [--base <ref>] [--out <file>]\n");
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

    if (options.realData) {
      // Locate, export, sanitize, import, then replay — in that order, and read-only until the
      // plane's own replay area is written.
      const io = load("electron/runtime-intelligence/replay-corpus-io.js");
      const casesModule = load("electron/runtime-intelligence/replay-cases.js");
      const corpusModule = load("src/shared/runtime-intelligence/replay-corpus.js");
      const schedulerModule = load("src/shared/runtime-intelligence/scheduler-benchmark.js");
      const continuationModule = load("src/shared/runtime-intelligence/continuation-benchmark.js");
      const stepModule = load("src/shared/runtime-intelligence/step-completion.js");
      const reportModule = load("src/shared/runtime-intelligence/evaluation-report.js");
      const boundaryAssessment = require("./runtime-intelligence-diff-guard.cjs").assessBranchBoundary(options.base);
      const planeRoot = serviceModule.runtimeIntelligenceRoot(options.root);

      const survey = io.locateRealDataRoots({ repositoryRoot: ROOT });
      const dataRoot = options.dataRoot ?? survey.recommended?.path;
      if (dataRoot === undefined) {
        report.realData = { survey, exported: false, note: "no real Boss data root was found on this host, so no corpus could be exported" };
      } else {
        const exported = io.exportReplayCorpus({ dataRoot, exportedAt: new Date().toISOString() });
        const written = io.writeReplayCorpus(planeRoot, exported.corpus);
        const imported = io.importReplayCorpus(written.file);
        const corpus = imported.corpus;
        const continuation = corpus === undefined ? undefined : casesModule.continuationStepsFromCorpus(corpus);
        const scheduler = corpus === undefined ? undefined : casesModule.schedulerCasesFromCorpus(corpus);
        const continuationMetrics = continuation === undefined ? undefined : continuationModule.benchmarkContinuation(continuation.steps);
        const schedulerMetrics = scheduler === undefined ? undefined : schedulerModule.benchmarkScheduler(scheduler.cases);

        // Baseline and candidate over the SAME corpus, then the same comparison on a task-level
        // holdout the candidate policy was not chosen against.
        let policyComparison;
        if (corpus !== undefined) {
          const measure = (records, policy) => {
            const view = { ...corpus, records };
            const steps = casesModule.continuationStepsFromCorpus(view, { policy });
            const metrics = continuationModule.benchmarkContinuation(steps.steps);
            return {
              policyId: view.provenance ? steps.policyId : steps.policyId,
              policyHash: steps.policyHash,
              steps: metrics.judgedSteps,
              falseStopCount: metrics.falseStopCount,
              falseStopRate: metrics.falseStopRate,
              unnecessaryContinueRate: metrics.unnecessaryContinueRate,
              weightedPenalty: metrics.weightedPenalty,
              estimatedCallsSaved: metrics.estimatedCallsSaved,
              reason: metrics.reason
            };
          };
          const split = corpusModule.splitCorpusRecords(corpus.records);
          policyComparison = {
            split: { strategy: split.strategy, devTasks: split.devTaskIds.length, holdoutTasks: split.holdoutTaskIds.length, note: split.note, devRecords: split.dev.length, holdoutRecords: split.holdout.length },
            full: { baseline: measure(corpus.records, "continuation-policy-v0"), candidate: measure(corpus.records, "continuation-policy-v1") },
            dev: { baseline: measure(split.dev, "continuation-policy-v0"), candidate: measure(split.dev, "continuation-policy-v1") },
            holdout: split.holdout.length === 0 ? undefined : { baseline: measure(split.holdout, "continuation-policy-v0"), candidate: measure(split.holdout, "continuation-policy-v1") }
          };
        }
        const snapshotSeries = nodeLog.snapshots();
        const coverageByNode = [...new Set(snapshotSeries.map((snapshot) => snapshot.nodeId))].map((nodeId) => {
          const latest = nodeLog.snapshots(nodeId).at(-1);
          const coverage = profileModule.nodeCoverage(latest);
          return { nodeId, coverage: coverage.coverage, absentKeys: coverage.absentKeys };
        });
        const taskViews = corpus === undefined ? [] : corpusModule.groupCorpusByTask(corpus);
        const completion = taskViews.flatMap((view) => {
          const facts = view.steps.map((step) => ({
            revision: step.stepIndex,
            capturedAt: step.completionEvidence.status === "MEASURED" ? step.completionEvidence.value : view.sourceTimestamp,
            completedCount: step.atDecisionTime.completedCount,
            pendingCount: step.atDecisionTime.unresolvedCount,
            nextAction: step.afterDecision.continuedAfterStep ? "CONTINUED" : "STOPPED",
            checkpointReason: "task/run transition"
          }));
          return stepModule.deriveStepCompletion({ facts, taskStatus: view.finalOutcome.status === "MEASURED" && view.finalOutcome.value === "SUCCESS" ? "completed" : "running" });
        });

        report.realData = {
          survey,
          dataRoot,
          exported: {
            source: exported.source,
            records: exported.records.length,
            skipped: exported.skipped,
            problems: exported.problems,
            redactedFields: exported.redactedFields
          },
          corpusFile: written.file,
          corpusBytes: written.bytes,
          imported: { imported: imported.imported, problems: imported.problems, invalidRecords: imported.invalidRecords },
          summary: corpus === undefined ? undefined : corpusModule.summariseReplayCorpus(corpus),
          tasks: taskViews.length,
          completionObservations: completion.length,
          continuation: continuation === undefined ? undefined : { steps: continuation.steps.length, skipped: continuation.skipped, unavailableSignals: continuation.unavailableSignals, policyId: continuation.policyId, policyHash: continuation.policyHash },
          scheduler: scheduler === undefined ? undefined : { cases: scheduler.cases.length, ledger: scheduler.ledger.length, notes: scheduler.notes },
          attribution: scheduler === undefined ? undefined : scheduler.census,
          schedulerDirect: scheduler === undefined || scheduler.directCases.length === 0 ? undefined : schedulerModule.benchmarkScheduler(scheduler.directCases),
          policyComparison,
          // What real latency and cost data the corpus actually carries.
          measurementCoverage: corpus === undefined ? undefined : {
            latencyCases: corpus.records.filter((entry) => entry.afterDecision.measuredLatencyMs.status === "MEASURED").length,
            costCases: corpus.records.filter((entry) => entry.afterDecision.measuredCostUsd.status === "MEASURED").length,
            tokenCases: corpus.records.filter((entry) => entry.atDecisionTime.tokensConsumed > 0).length,
            workerRuntimeCases: corpus.records.filter((entry) => entry.atDecisionTime.elapsedMs > 0).length,
            toolsCases: corpus.records.filter((entry) => entry.atDecisionTime.toolCalls > 0 || entry.atDecisionTime.browserActions > 0).length,
            sessionAttributedSteps: corpus.records.filter((entry) => entry.atDecisionTime.workerSessions.length > 0).length,
            note: "latency is the checkpoint's own providerWaitMs when it is positive, and otherwise the createdAt->updatedAt interval of the single run that spans the step; a step spanned by several runs is refused rather than guessed, which is why LATENCY_CASES is smaller than the step count. cost is recorded by nothing, so COST_CASES is 0 rather than estimated"
          },
          benchmarks: {
            continuation: continuationMetrics,
            scheduler: schedulerMetrics
          }
        };

        // The report is rebuilt with the real benchmarks substituted in, so its readiness gates
        // and metrics rest on the real corpus rather than on the plane's own empty store.
        const measureSummary = (entry) => ({ policyId: entry.policyId, policyHash: entry.policyHash, steps: entry.steps, falseStopCount: entry.falseStopCount, falseStopRate: entry.falseStopRate, unnecessaryContinueRate: entry.unnecessaryContinueRate, weightedPenalty: entry.weightedPenalty, estimatedCallsSaved: entry.estimatedCallsSaved });
        const improvement = policyComparison === undefined ? undefined : {
          baseline: measureSummary(policyComparison.full.baseline),
          candidate: measureSummary(policyComparison.full.candidate),
          ...(policyComparison.holdout === undefined ? {} : { holdout: { baseline: measureSummary(policyComparison.holdout.baseline), candidate: measureSummary(policyComparison.holdout.candidate), tasks: policyComparison.split.holdoutTasks, note: policyComparison.split.note } }),
          retrospectiveImprovement: (() => {
            const before = policyComparison.full.baseline.falseStopRate;
            const after = policyComparison.full.candidate.falseStopRate;
            if (before === undefined || after === undefined) return "INCONCLUSIVE";
            if (after < before) return "YES";
            return after === before ? "NO" : "NO";
          })(),
          prospectiveValidation: "INSUFFICIENT_EVIDENCE",
          notes: [
            "the candidate was chosen from the defect the corpus measured and re-run on the SAME corpus, so the improvement is retrospective",
            "prospective validation needs new tasks the candidate was not chosen against, and none exist yet"
          ]
        };
        const rebuilt = reportModule.buildEvaluationReport({
          generatedAt: new Date().toISOString(),
          scheduler: schedulerMetrics,
          ...(continuationMetrics === undefined ? {} : { continuation: continuationMetrics }),
          ...(improvement === undefined ? {} : { policyImprovement: improvement }),
          nodeTelemetry: {
            rawSamples: nodeLog.status().storedSamples,
            afterCompaction: nodeLog.status().afterCompaction,
            suppressedSamples: nodeLog.status().suppressedSamples,
            archivedEntries: nodeLog.status().archivedEntries,
            bytes: nodeLog.status().bytes,
            nodes: nodeLog.status().nodes,
            coverageByNode
          },
          continuationReplayPossible: continuationMetrics !== undefined,
          boundary: {
            rootTrustTouched: boundaryAssessment.rootTrustSurfacePathsChanged.length > 0,
            qualificationTouched: boundaryAssessment.qualificationPathsTouched.length > 0,
            ownerReviewPaths: boundaryAssessment.ownerReviewPaths,
            authorityDecision: boundaryAssessment.authority.decision,
            changeClass: boundaryAssessment.authority.changeClass
          }
        });
        report.evaluationFromRealData = rebuilt;
      }
    }

    if (options.prospective) {
      // The prospective question, answered from data rather than from intent: which real tasks
      // opened after the freeze, what the frozen policy would have advised on them, and whether
      // that is enough to say anything. The window is materialised in memory — the report must not
      // write window records, because a record the reporter wrote is not a record a task produced.
      const registryModule = load("src/shared/runtime-intelligence/policy-registry.js");
      const windowModule = load("src/shared/runtime-intelligence/prospective-window.js");
      const io = load("electron/runtime-intelligence/replay-corpus-io.js");
      const casesModule = load("electron/runtime-intelligence/replay-cases.js");
      const storeModule = load("electron/runtime-intelligence/prospective-store.js");
      const frozen = registryModule.frozenContinuationPolicy();
      const planeRoot = serviceModule.runtimeIntelligenceRoot(options.root);
      const store = new storeModule.ProspectiveWindowStore({ rootDir: path.join(planeRoot, "prospective") });

      const survey = io.locateRealDataRoots({ repositoryRoot: ROOT });
      const dataRoot = options.dataRoot ?? survey.recommended?.path;
      const realTasks = dataRoot === undefined ? undefined : io.tasksOpenedSince(dataRoot, frozen.frozenAt ?? registryModule.CONTINUATION_V1_FROZEN_AT);

      // Every real task's window, whether or not it qualifies, so the exclusion is counted rather
      // than left implicit.
      const records = [];
      const rejected = [];
      if (dataRoot !== undefined) {
        const timestamps = io.realTaskTimestamps(dataRoot);
        const exported = io.exportReplayCorpus({ dataRoot, exportedAt: new Date().toISOString() });
        const replay = casesModule.continuationStepsFromCorpus(exported.corpus, { policy: frozen.policyId });
        for (const task of timestamps.tasks) {
          const steps = replay.steps.filter((step) => step.taskId === task.taskId);
          if (steps.length === 0) {
            rejected.push({ taskId: task.taskId, reason: "the task contributed no replayed step, so it has no advice to observe" });
            continue;
          }
          const openResult = windowModule.openProspectiveRecord({ taskId: task.taskId, openedAt: task.createdAt });
          if (!openResult.ok || openResult.record === undefined) {
            rejected.push({ taskId: task.taskId, reason: openResult.problems.join("; ") });
            continue;
          }
          let record = openResult.record;
          let refused = false;
          for (const step of steps) {
            const appended = windowModule.appendProspectiveAdvisory(record, {
              stepIndex: step.step,
              decision: step.assessment.decision,
              confidence: step.assessment.confidence,
              capturedAt: task.createdAt
            });
            if (!appended.ok || appended.record === undefined) {
              rejected.push({ taskId: task.taskId, reason: appended.problems.join("; ") });
              refused = true;
              break;
            }
            record = appended.record;
          }
          if (refused) continue;
          const closed = windowModule.closeProspectiveRecord(record, {
            closedAt: exported.corpus.provenance.exportedAt,
            finalOutcome: steps[0].taskSucceeded === true ? "SUCCESS" : steps[0].taskSucceeded === false ? "FAILURE" : "UNKNOWN",
            steps: steps.map((step) => ({ stepIndex: step.step, taskComplete: step.taskComplete, continuedAfterStep: step.observed === "CONTINUED" }))
          });
          if (!closed.ok || closed.record === undefined) {
            rejected.push({ taskId: task.taskId, reason: closed.problems.join("; ") });
            continue;
          }
          records.push(closed.record);
        }
      }

      const metrics = windowModule.prospectiveMetrics(records);
      const byClass = {};
      for (const record of records) byClass[record.evidenceClass] = (byClass[record.evidenceClass] ?? 0) + 1;

      report.prospective = {
        policyRegistry: registryModule.policyRegistry().map((entry) => ({
          policyId: entry.policyId,
          policyHash: entry.policyHash,
          policyArea: entry.policyArea,
          status: entry.status,
          frozenAtCommit: entry.frozenAtCommit ?? null,
          frozenAtCorpusVersion: entry.frozenAtCorpusVersion ?? null
        })),
        frozenPolicy: { policyId: frozen.policyId, policyHash: frozen.policyHash, frozenAt: frozen.frozenAt ?? registryModule.CONTINUATION_V1_FROZEN_AT, frozenAtCommit: frozen.frozenAtCommit },
        retrospectiveCorpusVersion: registryModule.RETROSPECTIVE_CORPUS_VERSION,
        dataRoot: dataRoot ?? null,
        realTasks,
        // The window's own verdict, including the records it refused to count.
        window: {
          records: records.length,
          byEvidenceClass: byClass,
          rejected,
          tasks: records.map((record) => ({ taskId: record.taskId, openedAt: record.openedAt, evidenceClass: record.evidenceClass, advisories: record.advisories.length })),
          metrics
        },
        // The durable window the live path writes, which no task has written to yet.
        liveWindowStore: store.status(),
        capturePathAttached: false,
        capturePathNote: "no runtime component constructs a ProspectiveWindowStore: the live task loop does not call the plane, so the durable window is instrumented and unit-tested but has no producer. Every prospective number in this report is therefore zero by absence of capture, not by absence of need.",
        targets: windowModule.PROSPECTIVE_TARGETS,
        stopSupportMinimum: windowModule.STOP_SUPPORT_MINIMUM,
        blockers: [
          "SKILL_USAGE: the real checkpoints carry no skill-shaped field at all, so no skill selection, mount or invocation is recorded anywhere the plane can read; SKILL_USAGE_CASES is 0 because the application does not capture it",
          "COST: a web transport reports no cost and no field records one, so COST_CASES is 0 rather than estimated",
          "PROSPECTIVE_CAPTURE: the frozen policy is observed only through replay of tasks that opened BEFORE the freeze, which classifies every one of them as RETROSPECTIVE_EVIDENCE"
        ]
      };
    }

    const text = `${JSON.stringify(report, null, 2)}\n`;
    process.stdout.write(text);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, text, "utf8");
    }
  }
}
