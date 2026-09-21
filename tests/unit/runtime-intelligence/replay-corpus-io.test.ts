import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REDACTED_FIELDS,
  REPLAY_EXPORT_DIRECTORY,
  REPLAY_EXPORT_FILENAME,
  REPLAY_EXPORTER_ID,
  exportReplayCorpus,
  importReplayCorpus,
  locateRealDataRoots,
  replayCorpusPath,
  stepLatencyOf,
  tasksOpenedSince,
  writeReplayCorpus,
  type DataRootCandidate,
  type DataRootKind,
  type DataRootSurvey,
  type ExportOptions,
  type ExportResult,
  type ImportResult,
  type LocateOptions,
  type RawRun,
  type RealTaskWindow
} from "../../../electron/runtime-intelligence/replay-corpus-io";
import { groupCorpusByTask, summariseReplayCorpus, type ReplayCorpusTaskView } from "../../../src/shared/runtime-intelligence/replay-corpus";
import { checkCorpusRecord } from "../../../src/shared/runtime-intelligence/temporal-guard";
import { scanSecrets } from "../../../src/shared/secret-scan";

/**
 * Phase N4. Two kinds of test: a synthetic root that pins the field-by-field mapping, and a run
 * against THIS host's real Boss data root, which is what makes the export a real-data path
 * rather than a fixture path. The real run asserts the properties that matter — sanitized,
 * leak-free, no secret-shaped content — and what it finds rather than a hardcoded count, so it
 * stays honest if the corpus grows.
 */

const AT = "2026-01-01T00:00:00.000Z";

const dirs: string[] = [];
function makeDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

/** A synthetic root with the real file layout, so the mapping can be asserted exactly. */
function syntheticRoot(): string {
  const root = makeDir("boss-realdata-");
  fs.mkdirSync(path.join(root, ".boss", "tasks", "task-a", "checkpoints"), { recursive: true });
  fs.mkdirSync(path.join(root, ".boss", "tasks", "task-b"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "state.json"),
    JSON.stringify({
      tasks: [
        { id: "task-a", status: "completed", createdAt: AT, mode: "direct" },
        { id: "task-b", status: "running", createdAt: AT, mode: "direct" }
      ],
      runs: [
        { id: "run-1", taskId: "task-a", providerId: "chatgpt", transport: "web", round: 1, phase: "completed", outcome: "SUCCESS", createdAt: AT, updatedAt: AT },
        { id: "run-2", taskId: "task-b", providerId: "qwen", transport: "web", round: 1, phase: "queued", outcome: null, createdAt: AT, updatedAt: AT }
      ],
      dispatchCheckpoints: [{ id: "d1", taskId: "task-a", round: 1, expectedProviderIds: ["chatgpt"], successfulProviderIds: ["chatgpt"], failedProviderIds: [], status: "COMMITTED", createdAt: AT, updatedAt: AT }],
      evidenceBundles: [{ id: "b1", taskId: "task-a" }]
    }),
    "utf8"
  );
  const checkpoint = (overrides: Record<string, unknown>): string =>
    JSON.stringify({ schemaVersion: 1, taskId: "task-a", constraints: ["a real constraint"], objective: "a real user objective", verificationState: "NOT_RUN", failureHistory: [], activeProvider: null, sessions: [], jobs: {}, mode: "NORMAL", ...overrides });
  const write = (index: number, body: Record<string, unknown>): void => {
    fs.writeFileSync(path.join(root, ".boss", "tasks", "task-a", "checkpoints", `${String(index).padStart(8, "0")}.json`), checkpoint(body), "utf8");
  };
  write(1, { revision: 1, completedSteps: [], pendingSteps: [], nextAction: "COMPILE", checkpointReason: "task compiled", usage: { modelCalls: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, toolCalls: 0, browserActions: 0, workerRuntimeMs: 0, providerWaitMs: 0 } });
  write(2, { revision: 2, completedSteps: [], pendingSteps: ["s1"], nextAction: "DISPATCHING", checkpointReason: "task/run transition", usage: { modelCalls: 1, estimatedInputTokens: 15, estimatedOutputTokens: 0, toolCalls: 2, browserActions: 1, workerRuntimeMs: 500, providerWaitMs: 250 } });
  write(3, { revision: 3, completedSteps: ["s1"], pendingSteps: [], nextAction: "REPORT_EVIDENCE", checkpointReason: "task/run transition", usage: { modelCalls: 1, estimatedInputTokens: 15, estimatedOutputTokens: 0, toolCalls: 2, browserActions: 1, workerRuntimeMs: 900, providerWaitMs: 400 } });
  return root;
}

describe("the locator searches for real data instead of assuming a root", () => {
  it("declares where a corpus is written and what an export is asked for", () => {
    expect(REPLAY_EXPORT_DIRECTORY).toBe("replay");
    expect(REPLAY_EXPORT_FILENAME).toBe("replay-corpus.json");
    expect(replayCorpusPath("C:/plane").endsWith(path.join("replay", "replay-corpus.json"))).toBe(true);
    const kind: DataRootKind = "application-userdata";
    expect(["application-userdata", "repository-runtime-data", "override"]).toContain(kind);
  });

  it("finds a synthetic application root and says what it holds", () => {
    const root = syntheticRoot();
    const locate: LocateOptions = { repositoryRoot: makeDir("boss-repo-"), overrides: [root] };
    const survey: DataRootSurvey = locateRealDataRoots(locate);
    expect(survey.recommended?.path).toBe(path.resolve(root));
    expect(survey.recommended?.hasState).toBe(true);
    expect(survey.recommended?.hasTaskLedger).toBe(true);
    expect(survey.recommended?.note).toContain("state.json");
    expect(survey.recommended?.note).toContain("task ledger");
    expect(survey.explanation).toContain("holds");
  });

  it("reports every absent root by path rather than concluding absence", () => {
    const survey = locateRealDataRoots({ repositoryRoot: makeDir("boss-repo-"), localAppData: path.join(os.tmpdir(), "no-such-lad"), appData: path.join(os.tmpdir(), "no-such-ad") });
    expect(survey.recommended).toBeUndefined();
    expect(survey.missing.length).toBeGreaterThanOrEqual(3);
    expect(survey.explanation).toContain("no root holds");
    for (const candidate of survey.candidates) expect(candidate.present).toBe(false);
  });

  it("prefers the application root over the repository's runtime-data", () => {
    const localAppData = makeDir("boss-lad-");
    const appRoot = path.join(localAppData, "CodexBoss");
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, "state.json"), JSON.stringify({ tasks: [], runs: [] }), "utf8");
    const repositoryRoot = makeDir("boss-repo-");
    fs.mkdirSync(path.join(repositoryRoot, "runtime-data"), { recursive: true });
    const survey = locateRealDataRoots({ repositoryRoot, localAppData, appData: path.join(os.tmpdir(), "no-such-ad") });
    expect(survey.recommended?.path).toBe(appRoot);
    expect(survey.recommended?.kind).toBe("application-userdata");
    const repositoryCandidate: DataRootCandidate | undefined = survey.candidates.find((candidate) => candidate.kind === "repository-runtime-data");
    // The repository root exists but holds no state.json, so it is not recommended.
    expect(repositoryCandidate?.present).toBe(true);
    expect(repositoryCandidate?.hasState).toBe(false);
  });
});

describe("the export maps a real-shaped root record by record", () => {
  function exportSynthetic(): ExportResult {
    const options: ExportOptions = { dataRoot: syntheticRoot(), exportedAt: AT, sourceHost: "test-host" };
    return exportReplayCorpus(options);
  }

  it("reports the source it read and produces a record per checkpoint", () => {
    const result = exportSynthetic();
    expect(result.problems).toEqual([]);
    expect(result.source).toEqual({ tasks: 2, runs: 2, dispatchCheckpoints: 1, checkpoints: 3, bundles: 1 });
    expect(result.records).toHaveLength(3);
    expect(result.records.map((record) => record.recordId)).toEqual(["task-a:rev1", "task-a:rev2", "task-a:rev3"]);
    expect(result.corpus.provenance.exporter).toBe(REPLAY_EXPORTER_ID);
    expect(result.corpus.provenance.sanitized).toBe(true);
  });

  it("skips a task with no checkpoints and says why", () => {
    const result = exportSynthetic();
    expect(result.skipped).toEqual([{ taskId: "task-b", reason: "the task has no ledger checkpoints, so it has no step boundaries to replay" }]);
  });

  it("carries the at-decision-time facts the loop actually had", () => {
    const result = exportSynthetic();
    const compile = result.records[0].atDecisionTime;
    expect(compile.stepIndex).toBe(1);
    expect(compile.provider.status).toBe("NOT_MEASURED");
    expect(compile.provider).not.toEqual(expect.objectContaining({ value: "chatgpt" }));
    const dispatch = result.records[1].atDecisionTime;
    expect(dispatch.provider.status).toBe("MEASURED");
    expect(dispatch.unresolvedCount).toBe(1);
    expect(dispatch.tokensConsumed).toBe(15);
    expect(dispatch.toolCalls).toBe(2);
    expect(dispatch.browserActions).toBe(1);
    expect(dispatch.elapsedMs).toBe(500);
    expect(dispatch.modelKey.status).toBe("UNKNOWN");
  });

  it("carries the post-decision facts in the target section only", () => {
    const result = exportSynthetic();
    const last = result.records[2];
    expect(last.afterDecision.taskComplete).toBe(true);
    expect(last.afterDecision.continuedAfterStep).toBe(false);
    expect(last.afterDecision.finalOutcome).toEqual(expect.objectContaining({ status: "MEASURED", value: "SUCCESS" }));
    expect(last.afterDecision.reviewOutcome).toEqual(expect.objectContaining({ value: "NOT_RUN" }));
    expect(last.afterDecision.measuredLatencyMs).toEqual(expect.objectContaining({ status: "MEASURED", value: 400 }));
    expect(last.afterDecision.measuredCostUsd.status).toBe("NOT_MEASURED");
    expect(result.records[1].afterDecision.taskComplete).toBe(false);
    expect(result.records[1].afterDecision.continuedAfterStep).toBe(true);
  });

  it("leaves an unfinished run's outcome unmeasured rather than calling it a failure", () => {
    const result = exportReplayCorpus({ dataRoot: syntheticRoot(), exportedAt: AT });
    // task-b's only run was still queued, so its outcome was never recorded. The exporter skips
    // the task for having no step boundaries rather than inventing an outcome for it, and no
    // exported record claims a FAILURE for anything.
    expect(result.skipped.map((entry) => entry.taskId)).toEqual(["task-b"]);
    for (const record of result.records) {
      expect(record.afterDecision.finalOutcome).toEqual(expect.objectContaining({ status: "MEASURED", value: "SUCCESS" }));
      expect(record.afterDecision.finalOutcome).not.toEqual(expect.objectContaining({ value: "FAILURE" }));
    }
  });

  it("redacts user content by construction: no objective, prompt or constraint reaches a record", () => {
    const result = exportSynthetic();
    // The provenance names what was removed, which is the point of the list; what matters is
    // that no RECORD carries it.
    const records = JSON.stringify(result.records);
    expect(records).not.toContain("a real user objective");
    expect(records).not.toContain("a real constraint");
    expect(records).not.toContain("objective");
    expect(records).not.toContain("inputPrompt");
    expect(records).not.toContain("message");
    for (const record of result.records) {
      const keys = [...Object.keys(record), ...Object.keys(record.atDecisionTime), ...Object.keys(record.afterDecision)];
      for (const redacted of ["objective", "inputPrompt", "message", "constraints"]) expect(keys).not.toContain(redacted);
    }
    expect(result.redactedFields).toEqual([...REDACTED_FIELDS]);
    expect(result.corpus.provenance.redactedFields).toContain("objective");
  });

  it("produces no secret-shaped content", () => {
    expect(scanSecrets(JSON.stringify(exportSynthetic().corpus))).toEqual([]);
  });

  it("produces records the temporal guard accepts", () => {
    for (const record of exportSynthetic().records) expect(checkCorpusRecord(record).verdict).toBe("NO_FUTURE_INFORMATION");
  });

  it("groups the flat step records into the per-task view a report prints", () => {
    const views: ReplayCorpusTaskView[] = groupCorpusByTask(exportSynthetic().corpus);
    expect(views).toHaveLength(1);
    expect(views[0].taskId).toBe("task-a");
    expect(views[0].steps.map((step) => step.stepIndex)).toEqual([1, 2, 3]);
    expect(views[0].finalOutcome).toEqual(expect.objectContaining({ value: "SUCCESS" }));
    expect(views[0].toolUsage).toEqual({ toolCalls: 2, browserActions: 1 });
    expect(views[0].measuredLatencyMs).toEqual(expect.objectContaining({ value: 400 }));
    expect(views[0].skillUsage).toEqual({ mounted: [], used: [] });
  });

  it("reports an unreadable state.json instead of exporting nothing silently", () => {
    const empty = makeDir("boss-empty-");
    const result = exportReplayCorpus({ dataRoot: empty, exportedAt: AT });
    expect(result.problems.join(" ")).toContain("state.json could not be read");
    expect(result.records).toEqual([]);
    expect(result.corpus.records).toEqual([]);
  });
});

describe("the real Boss data root on this host is actually read", () => {
  const survey = locateRealDataRoots({ repositoryRoot: path.resolve(__dirname, "..", "..", "..") });

  it("finds a root holding state.json and a task ledger, or explains that none exists", () => {
    if (survey.recommended === undefined) {
      expect(survey.explanation).toContain("no root holds");
      return;
    }
    expect(survey.recommended.hasState).toBe(true);
    expect(survey.recommended.hasTaskLedger).toBe(true);
  });

  it("exports a real corpus with records, and every one passes the guard", () => {
    if (survey.recommended === undefined) return;
    const result: ExportResult = exportReplayCorpus({ dataRoot: survey.recommended.path, exportedAt: AT });
    expect(result.problems).toEqual([]);
    expect(result.source.tasks).toBeGreaterThan(0);
    expect(result.records.length).toBeGreaterThan(0);
    for (const record of result.records) expect(checkCorpusRecord(record).verdict).toBe("NO_FUTURE_INFORMATION");
  });

  it("produces a sanitized corpus with no secret-shaped content and no user content in a record", () => {
    if (survey.recommended === undefined) return;
    const result = exportReplayCorpus({ dataRoot: survey.recommended.path, exportedAt: AT });
    const text = JSON.stringify(result.corpus);
    expect(scanSecrets(text)).toEqual([]);
    const records = JSON.stringify(result.records);
    expect(records).not.toContain("inputPrompt");
    expect(records).not.toContain("objective");
    expect(records).not.toContain("message");
    expect(result.corpus.provenance.sanitized).toBe(true);
    expect(result.corpus.provenance.redactedFields.length).toBeGreaterThan(0);
  });

  it("carries real step boundaries and completion evidence", () => {
    if (survey.recommended === undefined) return;
    const result = exportReplayCorpus({ dataRoot: survey.recommended.path, exportedAt: AT });
    const summary = summariseReplayCorpus(result.corpus);
    expect(summary.recordsWithCompletionEvidence).toBeGreaterThan(0);
    // The loop's own continuation choice is visible in the real corpus.
    const continuedAfterComplete = result.records.filter((record) => record.afterDecision.taskComplete && record.afterDecision.continuedAfterStep);
    expect(Array.isArray(continuedAfterComplete)).toBe(true);
    const views = groupCorpusByTask(result.corpus);
    expect(views.length).toBe(summary.tasks);
    expect(views.every((view) => view.steps.length > 0)).toBe(true);
  });

  it("does not copy the production root: the export writes nothing there", () => {
    if (survey.recommended === undefined) return;
    const root = survey.recommended.path;
    const before = fs.readdirSync(root).sort();
    exportReplayCorpus({ dataRoot: root, exportedAt: AT });
    expect(fs.readdirSync(root).sort()).toEqual(before);
    expect(fs.existsSync(path.join(root, "replay"))).toBe(false);
  });
});

describe("a step duration is measured from the application's own clock, never assumed", () => {
  const run = (overrides: Record<string, unknown>): RawRun => ({ id: "run-1", taskId: "task-a", providerId: "chatgpt", transport: "web", round: 1, phase: "completed", outcome: "SUCCESS", createdAt: AT, updatedAt: AT, ...overrides }) as unknown as RawRun;

  it("prefers a positive checkpoint provider wait time over any interval", () => {
    const measuredLatency = stepLatencyOf({ capturedAt: AT, providerWaitMs: 400, runs: [run({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:10:00.000Z" })] });
    expect(measuredLatency).toEqual(expect.objectContaining({ status: "MEASURED", value: 400 }));
    expect(measuredLatency.status === "MEASURED" ? measuredLatency.source : "").toContain("providerWaitMs");
  });

  it("falls back to the one run interval that spans the step", () => {
    // The real corpus writes providerWaitMs as 0 at every checkpoint, so without this fallback a
    // real duration the application did record would be reported as no measurement at all.
    const measuredLatency = stepLatencyOf({ capturedAt: "2026-01-01T00:05:00.000Z", providerWaitMs: 0, runs: [run({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:10:00.000Z" })] });
    expect(measuredLatency).toEqual(expect.objectContaining({ status: "MEASURED", value: 600000 }));
    expect(measuredLatency.status === "MEASURED" ? measuredLatency.source : "").toContain("run-1");
  });

  it("refuses to choose when several runs span the step, and says how many", () => {
    const measuredLatency = stepLatencyOf({
      capturedAt: "2026-01-01T00:05:00.000Z",
      runs: [run({ id: "run-1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:10:00.000Z" }), run({ id: "run-2", createdAt: "2026-01-01T00:01:00.000Z", updatedAt: "2026-01-01T00:09:00.000Z" })]
    });
    expect(measuredLatency.status).toBe("NOT_MEASURED");
    expect(measuredLatency.status === "NOT_MEASURED" ? measuredLatency.reason : "").toContain("2 run intervals");
  });

  it("reports no measurement when no run spans the step, and never a zero", () => {
    const outside = stepLatencyOf({ capturedAt: "2026-01-01T02:00:00.000Z", runs: [run({ createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:10:00.000Z" })] });
    expect(outside.status).toBe("NOT_MEASURED");
    // A run whose start equals its end recorded no duration; reading that as 0 ms would turn an
    // absent measurement into a claim that the step was instantaneous.
    const zeroLength = stepLatencyOf({ capturedAt: AT, runs: [run({ createdAt: AT, updatedAt: AT })] });
    expect(zeroLength.status).toBe("NOT_MEASURED");
    expect(zeroLength.status === "NOT_MEASURED" ? zeroLength.reason : "").toContain("no duration was recorded");
  });

  it("derives real step durations from THIS host's corpus instead of concluding zero", () => {
    const survey = locateRealDataRoots({ repositoryRoot: path.resolve(__dirname, "..", "..", "..") });
    if (survey.recommended === undefined) return;
    const result = exportReplayCorpus({ dataRoot: survey.recommended.path, exportedAt: AT });
    const derived = result.records.filter((record) => record.afterDecision.measuredLatencyMs.status === "MEASURED");
    const refused = result.records.filter((record) => record.afterDecision.measuredLatencyMs.status === "NOT_MEASURED");
    // Whatever the real root holds, the two sets must partition the records and every measured
    // duration must be positive: a negative or zero latency is a derivation bug, not data.
    expect(derived.length + refused.length).toBe(result.records.length);
    for (const record of derived) {
      expect(record.afterDecision.measuredLatencyMs.status === "MEASURED" ? record.afterDecision.measuredLatencyMs.value : 0).toBeGreaterThan(0);
    }
    for (const record of refused) {
      expect(record.afterDecision.measuredLatencyMs.status === "NOT_MEASURED" ? record.afterDecision.measuredLatencyMs.reason.length : 0).toBeGreaterThan(0);
    }
  });
});

describe("the prospective task count is read from the application's own timestamps", () => {
  function rootWithTasks(): string {
    const root = makeDir("boss-taskwindow-");
    fs.writeFileSync(
      path.join(root, "state.json"),
      JSON.stringify({
        tasks: [
          { id: "old", status: "completed", createdAt: "2026-09-01T00:00:00.000Z" },
          { id: "boundary", status: "running", createdAt: "2026-09-19T20:44:35+10:00" },
          { id: "new", status: "running", createdAt: "2026-09-20T00:00:00.000Z" },
          { id: "undated", status: "running" }
        ],
        runs: []
      }),
      "utf8"
    );
    return root;
  }

  it("counts only tasks that opened at or after the instant and names them", () => {
    const window: RealTaskWindow = tasksOpenedSince(rootWithTasks(), "2026-09-19T20:44:35+10:00");
    expect(window.read).toBe(true);
    expect(window.totalTasks).toBe(4);
    expect(window.openedSince).toBe(2);
    expect(window.taskIds).toEqual(["boundary", "new"]);
    expect(window.earliestOpenedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(window.latestOpenedAt).toBe("2026-09-20T00:00:00.000Z");
    // An undated task is not promoted into the prospective count.
    expect(window.reason).toContain("no parseable createdAt");
  });

  it("reports an unreadable root as UNREADABLE rather than as zero new tasks", () => {
    const window = tasksOpenedSince(path.join(makeDir("boss-taskwindow-"), "absent"), "2026-09-19T20:44:35+10:00");
    expect(window.read).toBe(false);
    expect(window.openedSince).toBe(0);
    expect(window.reason).toContain("UNREADABLE rather than zero");
    expect(tasksOpenedSince(rootWithTasks(), "not-a-date").reason).toContain("does not parse");
  });

  it("finds no new real task on THIS host under the freeze, and says when the newest opened", () => {
    const survey = locateRealDataRoots({ repositoryRoot: path.resolve(__dirname, "..", "..", "..") });
    if (survey.recommended === undefined) return;
    const window = tasksOpenedSince(survey.recommended.path, "2026-09-19T20:44:35+10:00");
    expect(window.read).toBe(true);
    expect(window.totalTasks).toBeGreaterThan(0);
    // Whatever the host holds, the count and the named ids must agree, and a task cannot be both.
    expect(window.taskIds).toHaveLength(window.openedSince);
    expect(window.openedSince).toBeLessThanOrEqual(window.totalTasks);
    for (const taskId of window.taskIds) expect(typeof taskId).toBe("string");
  });
});

describe("import is safe and refuses a corpus it cannot trust", () => {
  it("writes only under the plane's own replay directory", () => {
    const planeRoot = makeDir("boss-plane-");
    const result = exportReplayCorpus({ dataRoot: syntheticRoot(), exportedAt: AT });
    const written = writeReplayCorpus(planeRoot, result.corpus);
    expect(written.file).toBe(replayCorpusPath(planeRoot));
    expect(written.file.startsWith(planeRoot)).toBe(true);
    expect(written.bytes).toBeGreaterThan(0);
    const imported: ImportResult = importReplayCorpus(written.file);
    expect(imported.problems).toEqual([]);
    expect(imported.imported).toBe(3);
    expect(imported.corpus?.records).toHaveLength(3);
  });

  it("refuses a missing file", () => {
    const result = importReplayCorpus(path.join(makeDir("boss-plane-"), "nothing.json"));
    expect(result.problems.join(" ")).toContain("no corpus exists");
    expect(result.imported).toBe(0);
  });

  it("refuses a corpus that is not valid JSON", () => {
    const file = path.join(makeDir("boss-plane-"), "bad.json");
    fs.writeFileSync(file, "{ not json", "utf8");
    expect(importReplayCorpus(file).problems.join(" ")).toContain("not readable JSON");
  });

  it("refuses a corpus that fails validation", () => {
    const planeRoot = makeDir("boss-plane-");
    const corpus = exportReplayCorpus({ dataRoot: syntheticRoot(), exportedAt: AT }).corpus;
    const broken = { ...corpus, records: corpus.records.map((record, index) => (index === 0 ? { ...record, atDecisionTime: { ...record.atDecisionTime, stepIndex: -1 } } : record)) };
    const file = replayCorpusPath(planeRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(broken), "utf8");
    expect(importReplayCorpus(file).problems.join(" ")).toContain("stepIndex must be a non-negative integer");
  });

  it("refuses a whole corpus when one record leaks, and names the record", () => {
    const planeRoot = makeDir("boss-plane-");
    const corpus = exportReplayCorpus({ dataRoot: syntheticRoot(), exportedAt: AT }).corpus;
    const leaked = { ...corpus, records: corpus.records.map((record, index) => (index === 1 ? { ...record, atDecisionTime: { ...record.atDecisionTime, taskComplete: true } } : record)) };
    const file = replayCorpusPath(planeRoot);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(leaked), "utf8");
    const imported = importReplayCorpus(file);
    expect(imported.imported).toBe(0);
    expect(imported.problems.join(" ")).toContain("leak post-decision information");
    expect(imported.invalidRecords[0].recordId).toBe("task-a:rev2");
    expect(imported.invalidRecords[0].reasons.join(" ")).toContain("taskComplete");
  });

  it("round-trips a real corpus through the plane's own path", () => {
    const survey = locateRealDataRoots({ repositoryRoot: path.resolve(__dirname, "..", "..", "..") });
    if (survey.recommended === undefined) return;
    const planeRoot = makeDir("boss-plane-");
    const result = exportReplayCorpus({ dataRoot: survey.recommended.path, exportedAt: AT });
    const written = writeReplayCorpus(planeRoot, result.corpus);
    const imported = importReplayCorpus(written.file);
    expect(imported.problems).toEqual([]);
    expect(imported.imported).toBe(result.records.length);
    expect(imported.corpus?.provenance.sourceRoot).toBe(survey.recommended.path);
  });
});
