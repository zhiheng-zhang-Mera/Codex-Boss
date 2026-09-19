/**
 * Runtime Intelligence Plane — real data roots, and the sanitized export/import that carries
 * them to the plane.
 *
 * The last round concluded "no Boss data root exists on this host" and was wrong: the real root
 * is `%LOCALAPPDATA%\CodexBoss` (the application's `userData`, which `runtime-paths.ts` fixes by
 * design), while the plane's reader was pointed at the repository's `runtime-data/`, which this
 * application never writes to. `locateRealDataRoots` therefore SEARCHES the plausible roots and
 * reports what each contains, instead of assuming one — and it reports what it could not find
 * rather than concluding absence from a zero read.
 *
 * The export is read-only against the source and writes only into the plane's own
 * `runtime-intelligence/replay/` area, so production task history, provider state, credentials
 * and trust evidence are untouched. Sanitization is not a filter applied afterwards: the
 * exporter builds each field from a whitelist, so user content (objectives, prompts, messages,
 * artifact bodies) is never read into the record in the first place, and
 * `src/shared/secret-scan.ts` then verifies that nothing secret-shaped survived.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactSecrets, scanSecrets } from "../../src/shared/secret-scan";
import { runtimeRoots } from "../runtime-paths";
import { measured, notMeasured, unknown, type Measurement } from "../../src/shared/runtime-intelligence/measurement";
import { deriveStepCompletion, type LoopCheckpointFact } from "../../src/shared/runtime-intelligence/step-completion";
import {
  REPLAY_CORPUS_SCHEMA_VERSION,
  appendReplayRecords,
  createReplayCorpus,
  validateReplayCorpus,
  type AtDecisionTime,
  type AfterDecision,
  type ReplayCorpus,
  type ReplayCorpusRecord,
  type ReplayProvenance
} from "../../src/shared/runtime-intelligence/replay-corpus";
import { checkCorpusRecord } from "../../src/shared/runtime-intelligence/temporal-guard";
import type { FailureDomain, TaskKind } from "../../src/shared/runtime-intelligence/contracts";

export const REPLAY_EXPORT_DIRECTORY = "replay";
export const REPLAY_EXPORT_FILENAME = "replay-corpus.json";
export const REPLAY_EXPORTER_ID = "runtime-intelligence-exporter/1";

/** Fields the exporter refuses to copy, so a reader can see what was left behind. */
export const REDACTED_FIELDS: readonly string[] = [
  "objective",
  "inputPrompt",
  "message",
  "constraints",
  "artifactId",
  "artifactBody",
  "manifest.sha256",
  "conversationId",
  "sessionId",
  "apiKey",
  "cookie",
  "token"
];

export type DataRootKind = "application-userdata" | "repository-runtime-data" | "override";

export interface DataRootCandidate {
  path: string;
  kind: DataRootKind;
  present: boolean;
  /** Files found under the root, capped so a huge root is not walked twice. */
  files: number;
  hasState: boolean;
  hasTaskLedger: boolean;
  hasTelemetry: boolean;
  hasEpisodes: boolean;
  note: string;
}

export interface DataRootSurvey {
  candidates: DataRootCandidate[];
  /** The root the plane should read, when one actually holds data. */
  recommended?: DataRootCandidate;
  /** Every root that was looked for and not found, with its path. */
  missing: string[];
  explanation: string;
}

function countFiles(root: string, limit = 2000): number {
  let files = 0;
  const walk = (dir: string): void => {
    if (files >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= limit) return;
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else files += 1;
    }
  };
  walk(root);
  return files;
}

function describeRoot(candidate: Omit<DataRootCandidate, "files" | "hasState" | "hasTaskLedger" | "hasTelemetry" | "hasEpisodes" | "note">): DataRootCandidate {
  if (!candidate.present) {
    return { ...candidate, files: 0, hasState: false, hasTaskLedger: false, hasTelemetry: false, hasEpisodes: false, note: "not present on this host" };
  }
  const hasState = fs.existsSync(path.join(candidate.path, "state.json"));
  const hasTaskLedger = fs.existsSync(path.join(candidate.path, ".boss", "tasks"));
  const hasTelemetry = fs.existsSync(path.join(candidate.path, ".boss", "telemetry.json"));
  const hasEpisodes = fs.existsSync(path.join(candidate.path, ".boss", "learning", "episodes.jsonl"));
  const files = countFiles(candidate.path);
  const contents = [hasState ? "state.json" : undefined, hasTaskLedger ? "task ledger" : undefined, hasTelemetry ? "telemetry" : undefined, hasEpisodes ? "learning episodes" : undefined].filter((entry): entry is string => entry !== undefined);
  return {
    ...candidate,
    files,
    hasState,
    hasTaskLedger,
    hasTelemetry,
    hasEpisodes,
    note: contents.length === 0 ? "present but holds none of the artefacts the plane reads" : `holds ${contents.join(", ")}`
  };
}

export interface LocateOptions {
  repositoryRoot: string;
  /** Extra roots to consider, highest priority first. */
  overrides?: readonly string[];
  localAppData?: string;
  appData?: string;
}

/**
 * Surveys every plausible Boss data root.
 *
 * The application root comes first because that is where the running application writes. The
 * repository's `runtime-data/` is included because it is where a portable/standalone run would
 * put it, and its ABSENCE from the list of found roots is itself a finding worth reporting.
 */
export function locateRealDataRoots(options: LocateOptions): DataRootSurvey {
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const appData = options.appData ?? process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");

  const considered: Array<{ path: string; kind: DataRootKind }> = [
    ...(options.overrides ?? []).map((entry) => ({ path: path.resolve(entry), kind: "override" as DataRootKind })),
    { path: path.join(localAppData, "CodexBoss"), kind: "application-userdata" },
    { path: path.join(appData, "CodexBoss"), kind: "application-userdata" },
    // The repository's portable/standalone root comes from the one module allowed to spell it,
    // rather than from a literal here: the directory names live in `runtime-paths.ts`.
    { path: runtimeRoots({ installRoot: options.repositoryRoot }).appData, kind: "repository-runtime-data" }
  ];

  const candidates = considered.map((entry) => describeRoot({ ...entry, present: fs.existsSync(entry.path) }));
  const withData = candidates.filter((candidate) => candidate.hasState || candidate.hasTaskLedger);
  const recommended = withData[0];
  const missing = candidates.filter((candidate) => !candidate.present).map((candidate) => candidate.path);

  const explanation =
    recommended === undefined
      ? "no root holds a state.json or a task ledger, so this host has produced no task-level data the plane can read"
      : `${recommended.path} holds ${recommended.note}; ${missing.length} other candidate root(s) are absent`;

  return { candidates, ...(recommended === undefined ? {} : { recommended }), missing, explanation };
}

export interface RealTaskWindow {
  dataRoot: string;
  /** Whether `state.json` could be read at all. False means the counts below mean nothing. */
  read: boolean;
  totalTasks: number;
  /** Tasks whose own `createdAt` is at or after the instant. This is the prospective count. */
  openedSince: number;
  taskIds: string[];
  earliestOpenedAt: string | undefined;
  latestOpenedAt: string | undefined;
  reason?: string;
}

/**
 * Every real task's own `createdAt`, as the application recorded it.
 *
 * A task with no parseable timestamp is counted in `undated` and left out of `tasks`, because a
 * task that cannot be placed in time cannot be placed relative to a policy freeze either.
 */
export function realTaskTimestamps(dataRoot: string): { read: boolean; tasks: Array<{ taskId: string; createdAt: string }>; totalTasks: number; undated: number; reason?: string } {
  const state = readJson<{ tasks?: Array<{ id?: string; createdAt?: string }> }>(path.join(dataRoot, "state.json"));
  if (state === undefined) {
    return { read: false, tasks: [], totalTasks: 0, undated: 0, reason: `state.json could not be read under ${dataRoot}, so the task timestamps are UNREADABLE rather than zero` };
  }
  const tasks = state.tasks ?? [];
  const dated: Array<{ taskId: string; createdAt: string }> = [];
  let undated = 0;
  for (const task of tasks) {
    const taskId = typeof task.id === "string" ? task.id : "";
    const createdAt = typeof task.createdAt === "string" ? task.createdAt : "";
    if (taskId === "" || !Number.isFinite(Date.parse(createdAt))) {
      undated += 1;
      continue;
    }
    dated.push({ taskId, createdAt });
  }
  return { read: true, tasks: dated, totalTasks: tasks.length, undated, ...(undated === 0 ? {} : { reason: `${undated} task(s) carry no parseable createdAt, so they cannot be placed in time` }) };
}

/**
 * Counts the real tasks on this host that opened at or after an instant.
 *
 * The prospective question — "has any new real task run under the frozen policy?" — is answered
 * from the application's own task timestamps rather than from the calendar or from an assumption
 * that nothing new happened. A task whose timestamp is missing or unparseable is not counted as
 * prospective: it cannot be shown to have opened after the freeze, and a task that cannot be
 * placed in time cannot be evidence about a policy frozen at a known time.
 */
export function tasksOpenedSince(dataRoot: string, instant: string): RealTaskWindow {
  const at = Date.parse(instant);
  const empty = { dataRoot, read: false, totalTasks: 0, openedSince: 0, taskIds: [] as string[], earliestOpenedAt: undefined, latestOpenedAt: undefined };
  if (!Number.isFinite(at)) return { ...empty, reason: `the instant ${JSON.stringify(instant)} does not parse, so no task can be placed relative to it` };
  const survey = realTaskTimestamps(dataRoot);
  if (!survey.read) return { ...empty, reason: survey.reason };
  const times = survey.tasks.map((task) => task.createdAt).sort();
  const qualifying = survey.tasks.filter((task) => Date.parse(task.createdAt) >= at);
  return {
    dataRoot,
    read: true,
    totalTasks: survey.totalTasks,
    openedSince: qualifying.length,
    taskIds: qualifying.map((task) => task.taskId).sort(),
    earliestOpenedAt: times[0],
    latestOpenedAt: times.at(-1),
    ...(survey.reason === undefined ? {} : { reason: survey.reason })
  };
}

/* ------------------------------------------------------------------ export */

interface RawTask {
  id: string;
  status: string;
  createdAt: string;
  mode?: string;
}

/** A run as the application's `state.json` records it. Exported so a test can pin the mapping. */
export interface RawRun {
  id: string;
  taskId: string;
  providerId: string;
  transport: string;
  round: number;
  phase: string;
  outcome: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawDispatchCheckpoint {
  id: string;
  taskId: string;
  round: number;
  expectedProviderIds: string[];
  successfulProviderIds: string[];
  failedProviderIds: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface RawCheckpoint {
  taskId: string;
  revision: number;
  completedSteps?: unknown[];
  pendingSteps?: unknown[];
  nextAction?: string;
  checkpointReason?: string;
  verificationState?: string;
  activeProvider?: string | null;
  /** Worker sessions recorded at this step. Each names the provider runtime it belongs to. */
  sessions?: Array<{ id?: string; provider?: string; checkpoint?: number; health?: string }>;
  failureHistory?: Array<{ reason?: string; code?: string; message?: string }>;
  usage?: {
    modelCalls?: number;
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
    toolCalls?: number;
    browserActions?: number;
    retries?: number;
    workerRuntimeMs?: number;
    providerWaitMs?: number;
  };
  /** The checkpoint file carries no timestamp of its own; the export uses the file's mtime. */
}

export interface ExportOptions {
  dataRoot: string;
  exportedAt: string;
  sourceHost?: string;
  /** The repository root, for the probe registry that names a provider's family. */
  repositoryRoot?: string;
}

export interface ExportResult {
  corpus: ReplayCorpus;
  records: ReplayCorpusRecord[];
  skipped: Array<{ taskId: string; reason: string }>;
  /** What the source actually held, so a report can state the corpus's provenance. */
  source: { tasks: number; runs: number; dispatchCheckpoints: number; checkpoints: number; bundles: number };
  redactedFields: string[];
  problems: string[];
}

/**
 * The step's duration, from the two sources that actually recorded one.
 *
 * `usage.providerWaitMs` is the checkpoint's own figure and is preferred when it is a positive
 * number. On this host's real corpus it is written as `0` at every checkpoint — the field exists
 * but carries no measurement — so a positive requirement is what stops a `0` from being promoted
 * into a measured duration of zero milliseconds.
 *
 * The fallback is the run interval: the application writes `createdAt` and `updatedAt` on every
 * run, so a step whose captured time falls inside exactly one run's interval has a real duration
 * derivable from the application's own clock. Both timestamps are read, both must parse, and the
 * interval must be positive; a step covered by no interval, or by several, is `NOT_MEASURED` with
 * the reason, because guessing which run produced it would be a fabricated attribution.
 */
export function stepLatencyOf(input: { capturedAt: string; providerWaitMs?: number; runs: readonly RawRun[] }): Measurement<number> {
  if (input.providerWaitMs !== undefined && Number.isFinite(input.providerWaitMs) && input.providerWaitMs > 0) {
    return measured(input.providerWaitMs, "checkpoint usage.providerWaitMs", input.capturedAt);
  }
  const at = Date.parse(input.capturedAt);
  if (!Number.isFinite(at)) return notMeasured("the step's captured time does not parse, so no run interval can be matched to it");
  const covering: Array<{ run: RawRun; durationMs: number }> = [];
  for (const run of input.runs) {
    const from = Date.parse(run.createdAt);
    const to = Date.parse(run.updatedAt);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    if (at >= from && at <= to) covering.push({ run, durationMs: to - from });
  }
  if (covering.length === 1) {
    return measured(covering[0].durationMs, `state.json runs[].createdAt->updatedAt (run ${covering[0].run.id} spans this step)`, input.capturedAt);
  }
  if (covering.length === 0) {
    return notMeasured("the checkpoint recorded no positive provider wait time and no run interval on this task spans the step's captured time, so no duration was recorded");
  }
  return notMeasured(`${covering.length} run intervals span this step, so which run produced its duration cannot be decided`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Maps the application's run outcome word onto the corpus's final outcome. */
function outcomeOf(runs: readonly RawRun[]): Measurement<"SUCCESS" | "FAILURE" | "PARTIAL_SUCCESS" | "CANCELLED"> {
  if (runs.length === 0) return notMeasured("the task has no recorded runs");
  if (runs.some((run) => run.outcome === "SUCCESS")) return measured("SUCCESS", "state.json runs[].outcome", runs[0].updatedAt);
  if (runs.some((run) => run.outcome === "FAILED" || run.outcome === "FAILURE")) return measured("FAILURE", "state.json runs[].outcome", runs[0].updatedAt);
  if (runs.every((run) => run.outcome === null)) return notMeasured(`all ${runs.length} run(s) were still ${runs[0].phase} when the export was taken`);
  return unknown(`the recorded outcome word ${JSON.stringify(runs.map((run) => run.outcome))} is not one this exporter maps`);
}

function reviewOutcomeOf(checkpoints: readonly RawCheckpoint[]): Measurement<"AGREED" | "DISAGREED" | "NOT_REVIEWED" | "NOT_RUN" | "VERIFIED"> {
  const states = [...new Set(checkpoints.map((checkpoint) => checkpoint.verificationState ?? "NOT_RUN"))];
  if (states.length === 0) return notMeasured("the task has no checkpoints, so no review state was recorded");
  if (states.includes("PASSED") || states.includes("VERIFIED")) return measured("VERIFIED", "checkpoint verificationState", "checkpoint");
  return measured("NOT_RUN", "checkpoint verificationState", "checkpoint");
}

function failureDomainOf(checkpoints: readonly RawCheckpoint[], runs: readonly RawRun[]): Measurement<FailureDomain> {
  const failures = checkpoints.flatMap((checkpoint) => checkpoint.failureHistory ?? []);
  if (failures.length === 0) {
    const failed = runs.find((run) => run.outcome === "FAILED" || run.outcome === "FAILURE");
    if (failed === undefined) return notMeasured("no failure was recorded for this task");
    return unknown("a run is recorded as failed but no failure code or reason was captured, so the domain cannot be attributed");
  }
  const text = failures.map((failure) => `${failure.code ?? ""} ${failure.reason ?? ""} ${failure.message ?? ""}`).join(" ").toLowerCase();
  const domain: FailureDomain = text.includes("network") ? "NETWORK" : text.includes("timeout") ? "TRANSIENT" : text.includes("tool") ? "TOOL" : "UNKNOWN";
  return measured(domain, "checkpoint failureHistory", "checkpoint");
}

/**
 * Exports a sanitized corpus from a real Boss data root.
 *
 * Each step becomes one record. The input section is built from the checkpoint's own
 * `completedSteps` / `pendingSteps` / `usage`, which are the facts the loop had at that step;
 * the target section is built from the task's final status and the run outcomes, which it did
 * not. Nothing else is copied, and the two sections are constructed as separate objects so they
 * cannot share a reference.
 */
export function exportReplayCorpus(options: ExportOptions): ExportResult {
  const dataRoot = options.dataRoot;
  const problems: string[] = [];
  const skipped: Array<{ taskId: string; reason: string }> = [];
  const records: ReplayCorpusRecord[] = [];

  const state = readJson<{ tasks?: RawTask[]; runs?: RawRun[]; dispatchCheckpoints?: RawDispatchCheckpoint[]; evidenceBundles?: unknown[] }>(path.join(dataRoot, "state.json"));
  if (state === undefined) problems.push(`state.json could not be read under ${dataRoot}`);
  const tasks = state?.tasks ?? [];
  const runs = state?.runs ?? [];
  const dispatch = state?.dispatchCheckpoints ?? [];
  const bundles = state?.evidenceBundles ?? [];

  const ledgerRoot = path.join(dataRoot, ".boss", "tasks");
  let checkpointCount = 0;

  for (const task of tasks) {
    const checkpointDir = path.join(ledgerRoot, task.id, "checkpoints");
    let files: string[] = [];
    try {
      files = fs.readdirSync(checkpointDir).filter((name) => name.endsWith(".json")).sort();
    } catch {
      files = [];
    }
    if (files.length === 0) {
      skipped.push({ taskId: task.id, reason: "the task has no ledger checkpoints, so it has no step boundaries to replay" });
      continue;
    }
    const checkpoints: RawCheckpoint[] = [];
    for (const file of files) {
      const parsed = readJson<RawCheckpoint>(path.join(checkpointDir, file));
      if (parsed === undefined || !isObject(parsed)) {
        problems.push(`checkpoint ${file} of task ${task.id} could not be read`);
        continue;
      }
      // The checkpoint file has no timestamp field; its mtime is the only real evidence of when
      // it was taken, so it is used and named as such rather than invented.
      let capturedAt = options.exportedAt;
      try {
        capturedAt = fs.statSync(path.join(checkpointDir, file)).mtime.toISOString();
      } catch {
        /* the export timestamp is the honest fallback for an unreadable mtime */
      }
      checkpoints.push({ ...parsed, taskId: task.id, revision: typeof parsed.revision === "number" ? parsed.revision : checkpoints.length + 1, ...{ __capturedAt: capturedAt } } as RawCheckpoint & { __capturedAt: string });
    }
    if (checkpoints.length === 0) {
      skipped.push({ taskId: task.id, reason: "no checkpoint of this task could be read" });
      continue;
    }
    checkpointCount += checkpoints.length;

    const taskRuns = runs.filter((run) => run.taskId === task.id);
    const finalOutcome = outcomeOf(taskRuns);
    const reviewOutcome = reviewOutcomeOf(checkpoints);
    const failureDomain = failureDomainOf(checkpoints, taskRuns);
    const facts: LoopCheckpointFact[] = checkpoints.map((checkpoint) => ({
      revision: checkpoint.revision,
      capturedAt: (checkpoint as RawCheckpoint & { __capturedAt: string }).__capturedAt,
      completedCount: Array.isArray(checkpoint.completedSteps) ? checkpoint.completedSteps.length : undefined,
      pendingCount: Array.isArray(checkpoint.pendingSteps) ? checkpoint.pendingSteps.length : undefined,
      nextAction: checkpoint.nextAction,
      checkpointReason: checkpoint.checkpointReason
    }));
    const derived = deriveStepCompletion({ facts, taskStatus: task.status });
    const taskKind: TaskKind | "unknown" = "unknown";

    derived.forEach((entry, index) => {
      const usage = checkpoints[index].usage ?? {};
      const modelCalls = usage.modelCalls ?? 0;
      // The step's own worker sessions are the direct per-step provider evidence. They are read
      // from the checkpoint that produced this record, not from the task.
      const sessionProviders = [...new Set((checkpoints[index].sessions ?? []).map((session) => (typeof session.provider === "string" ? session.provider : "")).filter((provider) => provider !== ""))].sort();
      const providerFact: Measurement<string> = modelCalls > 0
        ? measured(taskRuns[0]?.providerId ?? "unknown-provider", "state.json runs[].providerId", entry.fact.capturedAt)
        : notMeasured("no provider had been dispatched to at this step, which the checkpoint records as modelCalls 0");
      const atDecisionTime: AtDecisionTime = {
        stepIndex: entry.observation.stepIndex,
        unresolvedCount: entry.observation.unresolvedCount,
        completedCount: entry.fact.completedCount,
        provider: providerFact,
        runtimeId: modelCalls > 0 && taskRuns[0] !== undefined ? measured(`${taskRuns[0].transport}:${taskRuns[0].providerId}`, "state.json runs[]", entry.fact.capturedAt) : notMeasured("no runtime had been dispatched to at this step"),
        modelKey: unknown("a web transport does not expose a model id, and the export will not invent one"),
        nodeId: unknown("the application did not record which node the run used"),
        mountedSkills: [],
        usedSkills: [],
        contextInjected: [],
        workerSessions: sessionProviders,
        tokensConsumed: (usage.estimatedInputTokens ?? 0) + (usage.estimatedOutputTokens ?? 0),
        toolCalls: usage.toolCalls ?? 0,
        browserActions: usage.browserActions ?? 0,
        elapsedMs: usage.workerRuntimeMs ?? 0
      };
      const afterDecision: AfterDecision = {
        finalOutcome,
        reviewOutcome,
        taskComplete: entry.observation.taskComplete,
        continuedAfterStep: entry.observation.continuedAfterStep,
        taskSucceeded: finalOutcome.status === "MEASURED" ? finalOutcome.value === "SUCCESS" : undefined,
        measuredLatencyMs: stepLatencyOf({ capturedAt: entry.fact.capturedAt, ...(usage.providerWaitMs === undefined ? {} : { providerWaitMs: usage.providerWaitMs }), runs: taskRuns }),
        measuredCostUsd: notMeasured("a web transport exposes no cost, and the application does not record one"),
        failureDomain
      };
      const record: ReplayCorpusRecord = {
        schemaVersion: REPLAY_CORPUS_SCHEMA_VERSION,
        recordId: `${task.id}:rev${entry.observation.stepIndex}`,
        taskId: task.id,
        taskKind,
        role: unknown("the application does not record a role on the task ledger"),
        sourceTimestamp: entry.fact.capturedAt,
        atDecisionTime,
        afterDecision,
        completionEvidence: measured(entry.completionEvidence, "task-ledger checkpoint", entry.fact.capturedAt)
      };
      const check = checkCorpusRecord(record);
      if (check.verdict !== "NO_FUTURE_INFORMATION") {
        problems.push(`record ${record.recordId} was dropped as ${check.verdict}: ${check.reasons.join("; ")}`);
        return;
      }
      records.push(record);
    });
  }

  const provisional: ReplayProvenance = {
    kind: "SANITIZED_EXPORT",
    sourceHost: options.sourceHost ?? os.hostname(),
    sourceRoot: dataRoot,
    exportedAt: options.exportedAt,
    exporter: REPLAY_EXPORTER_ID,
    sanitized: true,
    redactedFields: [...REDACTED_FIELDS]
  };
  const corpusId = `corpus-${dataRoot.replace(/[^A-Za-z0-9]+/g, "-").slice(-40)}`;
  let corpus = appendReplayRecords(createReplayCorpus({ corpusId, createdAt: options.exportedAt, provenance: provisional }), records).corpus;

  // The last line of defence: no record may carry something secret-shaped, however it was built.
  const tainted = scanSecrets(JSON.stringify(corpus));
  if (tainted.length > 0) {
    problems.push(`the exported corpus contained ${tainted.length} secret-shaped match(es) and was discarded`);
    corpus = { ...corpus, records: [] };
  }

  const validation = validateReplayCorpus(JSON.parse(redactSecrets(JSON.stringify(corpus))) as unknown);
  if (validation.problems.length > 0) problems.push(...validation.problems);

  return {
    corpus,
    records: corpus.records,
    skipped,
    source: { tasks: tasks.length, runs: runs.length, dispatchCheckpoints: dispatch.length, checkpoints: checkpointCount, bundles: bundles.length },
    redactedFields: [...REDACTED_FIELDS],
    problems
  };
}

/* ------------------------------------------------------------------ import */

export interface ImportResult {
  corpus?: ReplayCorpus;
  file: string;
  problems: string[];
  /** Records the temporal guard refused, with the reason. */
  invalidRecords: Array<{ recordId: string; reasons: string[] }>;
  imported: number;
}

/** Where a corpus is written and read. Never the production data root. */
export function replayCorpusPath(planeRoot: string): string {
  return path.join(planeRoot, REPLAY_EXPORT_DIRECTORY, REPLAY_EXPORT_FILENAME);
}

/**
 * Reads a corpus from disk, validating and leak-checking it before the plane may use it.
 *
 * A corpus that fails validation or carries a leaked record is refused rather than partially
 * accepted: a benchmark fed half a corpus would report a rate for a population nobody defined.
 */
export function importReplayCorpus(file: string): ImportResult {
  if (!fs.existsSync(file)) return { file, problems: [`no corpus exists at ${file}`], invalidRecords: [], imported: 0 };
  const parsed = readJson<unknown>(file);
  if (parsed === undefined) return { file, problems: [`${file} is not readable JSON`], invalidRecords: [], imported: 0 };
  const validation = validateReplayCorpus(parsed);
  if (validation.corpus === undefined) return { file, problems: validation.problems, invalidRecords: [], imported: 0 };

  const invalidRecords: Array<{ recordId: string; reasons: string[] }> = [];
  const valid: ReplayCorpusRecord[] = [];
  for (const record of validation.corpus.records) {
    const check = checkCorpusRecord(record);
    if (check.verdict === "NO_FUTURE_INFORMATION") valid.push(record);
    else invalidRecords.push({ recordId: record.recordId, reasons: check.reasons });
  }
  if (invalidRecords.length > 0) {
    return { file, problems: [`${invalidRecords.length} record(s) leak post-decision information and the corpus was refused`], invalidRecords, imported: 0 };
  }
  return { corpus: { ...validation.corpus, records: valid }, file, problems: [], invalidRecords: [], imported: valid.length };
}

/** Writes a corpus into the plane's own replay area, which is the only path it ever writes. */
export function writeReplayCorpus(planeRoot: string, corpus: ReplayCorpus): { file: string; bytes: number } {
  const file = replayCorpusPath(planeRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(corpus, null, 2)}\n`;
  fs.writeFileSync(file, text, "utf8");
  return { file, bytes: Buffer.byteLength(text, "utf8") };
}
