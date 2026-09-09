import { providerVisionSurface } from "./computer/backends/provider-vision-surface";
import { providerDomSurface } from "./computer/backends/provider-dom-surface";
import { RecoveryScheduler } from "./commander/recovery-scheduler";
import { WebRecovery } from "./commander/web-recovery";
import { AttachmentStore } from "./input/attachment-store";
import { ProviderCapabilityRegistry } from "./input/provider-capability-registry";
import { GithubResolver } from "./input/github-resolver";
import { routeInputObjects, routeTextOnly, type ProviderRouteState } from "./input/attachment-router";
import { parseGithubUrl, extractGithubUrlFromMessage } from "../src/shared/github-url";
import type { InputObjectRef } from "../src/shared/input-object";
import { randomUUID } from "node:crypto";
import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import path from "node:path";
import fs from "node:fs";
import { migrateBrowserProfile, migrateLegacyPersistentData } from "./runtime-paths";
import type { AppSnapshot, CreateConversationInput, CreateTaskInput, CustomProviderInput, ProviderId, TaskStatus, UpdateApiSettingInput, UpdateRemoteChannelInput, ViewBounds } from "../src/shared/contracts";
import type { RuntimeAvailability } from "./runtimes/runtime";
import { DEFAULT_PROVIDER_IDS, isDispatchGroupSize, MAX_ACTIVE_PROVIDERS, normalizeCustomProviderInput } from "../src/shared/provider-policy";
import { buildPeerReviewPrompts, buildSynthesisPrompts, extractCouncilFindings } from "../src/shared/council-engine";
import { roleBriefsForWorkerOrder } from "../src/shared/work-mode";
import { ProviderAutomation } from "./provider-automation";
import { CodexCliRuntime } from "./runtimes/codex/codex-cli-runtime";
import { ProviderRuntimeAdapter } from "./runtimes/web/provider-runtime-adapter";
import { NativeRuntime, ApiRuntime } from "./runtimes/native-api-runtime";
import { RuntimeRegistry } from "./commander/runtime-registry";
import { BudgetManager } from "./commander/budget-manager";
import { RoleRouter } from "./commander/role-router";
import { Scheduler } from "./commander/scheduler";
import { ContextManager } from "./commander/context-manager";
import { ExecutionGate } from "./commander/execution-gate";
import { compileIntent } from "../src/shared/task-ir";
import { decideEscalation, detectCapabilityNeeds } from "../src/shared/capability-needs";
import type { InputObjectKind } from "../src/shared/input-object";
import { ResourceController } from "./commander/resource-controller";
import { TaskLedger } from "./commander/task-ledger";
import { CircuitBreaker } from "./commander/circuit-breaker";
import { DomainEventBus } from "./commander/event-bus";
import { attachContinuationWaker } from "./commander/continuation-waker";
import { WorkspaceRegistry } from "./workspace/workspace-registry";
import { durableFileFor } from "./workspace/durable-roots";
import { DEFAULT_WORKSPACE_ID } from "../src/shared/workspace";
import { SoftwareLeaseRegistry } from "./computer/software-lease";
import { PermissionManifestStore } from "./security/permission-manifest";
import { ProjectStateStore } from "./project/project-state";
import { ExperienceStore } from "./experience/experience-store";
import { attachExperienceRecorder } from "./experience/experience-recorder";
import { TelemetryStore } from "./telemetry/telemetry-store";
import { attachTelemetryRecorder } from "./telemetry/telemetry-recorder";
import { attachProgressRecorder } from "./commander/progress-recorder";
import { HumanGuidanceGate } from "./commander/human-guidance-gate";
import { ResearchService } from "./research/research-service";
import { ResearchRuntime } from "./research/runtime/research-runtime";
import { DefaultLevelBExecutor } from "./research/default-levelb-executor";
import { LiveResearchExecutor } from "./research/live-research-executor";
import { ResearchConductor } from "./research/research-conductor";
import { createLiveResearchProvider } from "./research/live-research-provider";
import { runHostLiteraturePass, createOpenAlexLiteratureDeps } from "./research/literature/host-retrieval";
import type { ResearchStageExecutor } from "./research/research-supervisor";
import type { ResearchIR } from "../src/shared/research-ir";
import type { HumanDefinedResearchInput } from "../src/shared/research-input";
import { researchIdFor } from "../src/shared/research-input";
import type { InterventionKind } from "../src/shared/intervention";
import { MainCommander } from "./commander/main-commander";
import { buildEvidenceBundle, buildRehydrationPrompts } from "./evidence-engine";
import { autoArchiveDecision } from "../src/shared/archive-policy";
import { buildOwnerDashboard } from "../src/shared/owner-dashboard";
import { effectiveRunMode, runTaskKindFor, workEscalationVerdict } from "../src/shared/owner-result";
import { DecisionLedgerStore } from "./commander/decision-ledger-store";
import { ExternalSessionLedger } from "./workspace/external-session-ledger";
import { automatePendingExternalArchives } from "./workspace/external-archive-automation";
import { createLiveExternalArchiveAttempt, type AccountMode as ArchiveAccountMode } from "./workspace/live-external-archive";
import { AccountSessionManager } from "./account-sessions";
import { ProviderViews } from "./provider-views";
import { StateStore } from "./store";
import { ApiSettingsStore } from "./api-settings";
import { ProviderApiClient } from "./provider-api";
import { HistoryRepository } from "./history-repository";
import { RemoteCommandRelay } from "./remote-relay";

let mainWindow: BrowserWindow | null = null;
let store: StateStore;
let providerViews: ProviderViews;
let automation: ProviderAutomation;
let codexRuntime: CodexCliRuntime;
let commander: MainCommander;
let recoveryScheduler: RecoveryScheduler;
let budgetManager: BudgetManager;
let accountSessions: AccountSessionManager;
let apiSettings: ApiSettingsStore;
let providerApi: ProviderApiClient;
let historyRepository: HistoryRepository;
let remoteRelay: RemoteCommandRelay;
let domainEventBus: DomainEventBus | undefined;
let detachContinuationWaker: (() => void) | undefined;
let progressAggregator: ReturnType<typeof attachProgressRecorder>["aggregator"] | undefined;
let humanGuidance: HumanGuidanceGate | undefined;
let decisionLedger: DecisionLedgerStore | undefined;
let research: ResearchService | undefined;
let attachmentStore: AttachmentStore | undefined;
let capabilityRegistry: ProviderCapabilityRegistry | undefined;
let githubResolver: GithubResolver | undefined;
let externalSessions: ExternalSessionLedger | undefined;

const overrideDataRoot = process.argv.find((arg) => arg.startsWith("--boss-data-dir="))?.slice("--boss-data-dir=".length);
const legacyDataRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "CodexBoss") : undefined;
const projectDataRoot = path.join(app.getAppPath(), "runtime-data");
const dataRoot = overrideDataRoot ? path.resolve(overrideDataRoot) : projectDataRoot;
app.setPath("userData", dataRoot);
app.setPath("sessionData", path.join(dataRoot, "Session Data"));

const ownsInstance = app.requestSingleInstanceLock();
const isSmokeTest = process.argv.includes("--codex-boss-smoke-test");
if (isSmokeTest) app.disableHardwareAcceleration();
// Headless live-acceptance mode: boot Boss without the GUI main window, open
// the chosen web providers, run ONE human-defined research autopilot to READY,
// write a result JSON next to the research root, then exit — so E2E-C can be
// driven from the command line without manual GUI steps.
const headlessResearch = process.argv.includes("--research-headless-run");
const headlessWorkspace = (process.argv.find((arg) => arg.startsWith("--research-workspace=")) ?? "").split("=").slice(1).join("=") || undefined;
const headlessProviders = ((process.argv.find((arg) => arg.startsWith("--research-providers=")) ?? "").split("=")[1] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
if (headlessResearch && !headlessWorkspace) { console.error("--research-headless-run requires --research-workspace=<path>"); app.exit(2); }

if (!ownsInstance) {
  app.quit();
}
if (ownsInstance) {
  fs.mkdirSync(dataRoot, { recursive: true });
  if (!overrideDataRoot && legacyDataRoot) {
    migrateLegacyPersistentData(legacyDataRoot, dataRoot, path.join(app.getAppPath(), "history"));
  }
  const cacheRoot = path.join(overrideDataRoot ? path.resolve(overrideDataRoot) : app.getAppPath(), ".cache");
  const sessionRoot = path.join(cacheRoot, "browser-profile");
  const oldSessionRoot = !overrideDataRoot && legacyDataRoot ? path.join(legacyDataRoot, "Session Data") : app.getPath("sessionData");
  // Migrate only after acquiring the instance lock, before any browser starts.
  migrateBrowserProfile(oldSessionRoot, sessionRoot);
  for (const name of ["tmp", "crash-dumps"]) fs.mkdirSync(path.join(cacheRoot, name), { recursive: true });
  app.setPath("sessionData", sessionRoot);
  app.setPath("temp", path.join(cacheRoot, "tmp"));
  app.setPath("crashDumps", path.join(cacheRoot, "crash-dumps"));
  process.env.TEMP = process.env.TMP = path.join(cacheRoot, "tmp");
}

function publish(): AppSnapshot {
  store.setApiSettings(apiSettings.snapshot(store.snapshot().providers.map((item) => item.id)));
  const snapshot = store.snapshot();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("boss:snapshot-updated", snapshot);
  }
  return snapshot;
}

function provider(id: ProviderId) {
  const match = store.snapshot().providers.find((item) => item.id === id);
  if (!match) throw new Error(`Unknown provider: ${id}`);
  return match;
}

let autoLayoutTimer: ReturnType<typeof setInterval> | undefined;

/**
 * Continuous AI-processor layout monitor: whenever MORE than three web-AI
 * pages are open/selected the workspace switches to the second-window
 * (DETACHED) mode; three or fewer stay in the single-window (MERGED)
 * workspace. Called on every open/close change and on a lightweight periodic
 * tick so selection state is always reflected (idempotent when unchanged).
 */
function autoLayoutForOpenWebProviders(reason: string): void {
  try {
    if (!providerViews) return;
    const openWeb = store.snapshot().providers.filter((item) => item.windowOpen).length;
    const wanted = openWeb > 3 ? "DETACHED" : "MERGED";
    if (providerViews.workspaceView() !== wanted) {
      providerViews.setWorkspaceView(wanted);
      console.log(`[auto-layout] ${reason}: ${openWeb} web AI open -> ${wanted}`);
    }
  } catch (error) {
    console.error("[auto-layout] monitor failed", error);
  }
}
function startAutoLayoutMonitor(): void {
  if (autoLayoutTimer) clearInterval(autoLayoutTimer);
  autoLayoutTimer = setInterval(() => autoLayoutForOpenWebProviders("monitor"), 5000);
  autoLayoutTimer.unref?.();
}

/**
 * Production external-archive attempt (Overcomplete §11.3/§11.4): fail-closed
 * page-state gate + optional per-provider adapter seam. Never fake-archives.
 */
function liveArchiveAttempt() {
  return createLiveExternalArchiveAttempt({
    windowOpen: (providerId) => Boolean(providerViews.get(providerId)),
    accountMode: (providerId): ArchiveAccountMode => {
      const account = store?.snapshot().accounts.find((entry) => entry.providerId === providerId);
      const mode = account?.mode;
      return mode === "READY" || mode === "GUEST_READY" ? mode : mode === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : "UNKNOWN";
    }
  });
}

function taskTransports(input: CreateTaskInput, providerIds: ProviderId[]) {
  const appMode = input.appMode ?? "chat";
  const transports = Object.fromEntries(providerIds.map((providerId) => {
    const requested = input.transportByProvider?.[providerId] ?? "web";
    if (requested !== "web" && requested !== "api") throw new Error(`无效执行通道：${providerId}`);
    return [providerId, appMode === "chat" ? "web" : requested];
  }));
  return { appMode, transports };
}

/** Phase E: deterministic Chat→Work detection for a task (message + bound inputs). */
function escalateDecisionFor(task: import("../src/shared/contracts").BossTask) {
  const conversation = store.snapshot().conversations.find((item) => item.id === task.conversationId);
  const inputKinds = (task.inputObjectIds ?? [])
    .map((id) => conversation?.inputObjects?.find((ref) => ref.id === id)?.kind)
    .filter((kind): kind is InputObjectKind => kind !== undefined);
  return decideEscalation(detectCapabilityNeeds({ message: task.prompt, inputKinds }));
}

/**
 * Phase F: when a dispatch message contains a GitHub URL, materialize it into
 * the repo cache, register a REPOSITORY input object on the conversation, and
 * return its id (or undefined when no URL / materialization is unavailable).
 */
async function materializeGithubInput(conversationId: string, prompt: string): Promise<InputObjectRef | undefined> {
  const url = extractGithubUrlFromMessage(prompt);
  if (!url) return undefined;
  const target = parseGithubUrl(url);
  if (!target) return undefined;
  const conversation = store.snapshot().conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error(`Unknown conversation: ${conversationId}`);
  const existing = (conversation.inputObjects ?? []).find((ref) => ref.sourceUrl === url || (ref.kind === "REPOSITORY" && ref.source === "GITHUB" && ref.originalName === `${target.owner}/${target.repo}`));
  if (existing) return existing;
  if (!githubResolver) throw new Error("GitHub materialization is unavailable");
  const result = await githubResolver.resolve(target);
  const ref: InputObjectRef = {
    id: randomUUID(),
    source: "GITHUB",
    kind: "REPOSITORY",
    conversationId,
    originalName: `${target.owner}/${target.repo}`,
    size: undefined,
    localPath: result.checkoutDir,
    sourceUrl: url
  };
  store.registerInputObjects(conversationId, [ref]);
  return store.inputObjectsFor(conversationId).find((item) => item.id === ref.id);
}

function openProviderWithinLimit(providerId: ProviderId): void {
  const target = provider(providerId);
  const openCount = store.snapshot().providers.filter((item) => item.windowOpen).length;
  if (!target.windowOpen && openCount >= MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时打开 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
  providerViews.open(target);
}

function openProjectState(workspaceId: string): ProjectStateStore {
  return new ProjectStateStore(durableFileFor(app.getPath("userData"), workspaceId, path.join(".boss", "project-state.json")));
}

/** Records a durable task completion into its workspace's project state (AP15 seam). */
function recordTaskOutcome(taskId: string): void {
  const snapshot = store.snapshot();
  const task = snapshot.tasks.find((item) => item.id === taskId);
  const final = store.finalResponseForTask(taskId);
  if (!task || !final) return;
  const workspaceId = task.workspaceId ?? DEFAULT_WORKSPACE_ID;
  try {
    openProjectState(workspaceId).recordTaskCompletion(workspaceId, {
      taskId: task.id,
      title: task.title,
      findings: final.content.slice(0, 2000),
      nextActions: task.plan && task.plan.steps.some((step) => step.kind === "edit") ? ["verify merged changes with the full test suite"] : undefined
    });
  } catch { /* project state recording is advisory; never blocks completion */ }
}

async function advanceCouncilRound(taskId: string): Promise<void> {
    const snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    const council = snapshot.councils.find((item) => item.taskId === taskId);
    if (!task || !council) throw new Error("Council task not found");
    const checkpoint = snapshot.dispatchCheckpoints.find((item) => item.taskId === taskId && item.round === council.round);
    if (!checkpoint || checkpoint.status !== "COMMITTED" || checkpoint.requiresReconciliation) throw new Error("当前轮次未达到 所选 AI 全员成功检查点");
    const roundRuns = snapshot.runs.filter((run) => run.taskId === taskId && run.round === council.round);
    if (roundRuns.length !== council.providerIds.length || !roundRuns.every((run) => run.phase === "completed" && run.artifactId)) throw new Error("当前 Council 阶段尚未收齐全部可验证回答");
    const artifacts = roundRuns.map((run) => snapshot.artifacts.find((artifact) => artifact.id === run.artifactId)).filter((artifact) => artifact !== undefined);
    // U3: role-briefed reviewers — each AI in the pool gets a distinct review
    // duty (Architecture/Correctness/QA/Security/Performance) instead of N
    // identical reviewers (plan §6.2/§34).
    const roleBriefs = roleBriefsForWorkerOrder(council.providerIds);
    if (council.stage === "proposals") {
      store.addCouncilRound(taskId, buildPeerReviewPrompts(task.prompt, artifacts, council.providerIds, roleBriefs), "peer_review");
      await automation.dispatchTask(taskId);
    } else if (council.stage === "peer_review") {
      const allProposals = snapshot.artifacts.filter((artifact) => artifact.taskId === taskId && artifact.kind === "proposal");
      const analysis = extractCouncilFindings(artifacts);
      store.updateCouncil(taskId, analysis);
      store.addCouncilRound(taskId, buildSynthesisPrompts(task.prompt, allProposals, artifacts, council.providerIds, analysis, roleBriefs), "synthesis");
      await automation.dispatchTask(taskId);
    } else if (council.stage === "synthesis") {
      store.updateCouncil(taskId, { stage: "completed" });
      store.setTaskStatus(taskId, "completed");
      recordTaskOutcome(taskId);
    } else {
      throw new Error(`Council cannot advance from ${council.stage}`);
    }
    publish();
}

function attachProviderViews(): void {
  if (!mainWindow) throw new Error("Main window was not created");
  providerViews = new ProviderViews(mainWindow, (id, open) => {
    store.setWindow(id, open);
    publish();
    // Continuous monitoring: opening a 4th (or 5th) AI page immediately pops
    // the processors into the second window; closing back to ≤3 returns MERGED.
    autoLayoutForOpenWebProviders("window-toggle");
  }, accountSessions, (providerId, suggestedName) => historyRepository.generatedFilePath(store.snapshot(), store.snapshot().activeConversationId, providerId, suggestedName));
  automation?.dispose();
  const finalizer = { finalize: (id: string) => commander.finalizeTask(id, publish) };
  const recovery = new WebRecovery(store, providerViews, () => automation, provider, recoveryScheduler, budgetManager);
  const onTaskComplete = async (id: string) => {
    if (!store.finalResponseForTask(id)) await finalizer.finalize(id);
    recordTaskOutcome(id);
    for (const run of store.runsForTask(id).filter((item) => item.review?.status === "PASS")) budgetManager.observeSuccess(run.transport + ":" + run.providerId);
    // U6 §14: record the external web conversations this task drove and mark
    // their archive as ARCHIVE_PENDING (retryable). ARCHIVED is only ever
    // written by a verified page-state archive path — never assumed here.
    try {
      const runs = store.runsForTask(id);
      for (const run of runs.filter((item) => item.transport === "web" && item.sessionUrl && item.review?.status === "PASS")) {
        externalSessions?.upsert({ taskId: id, providerId: run.providerId, remoteConversationUrl: run.sessionUrl });
        externalSessions?.deferArchive(id, run.providerId, "task finished; external archive pending page-state verification");
      }
    } catch { /* external-session tracking is advisory and must never block completion */ }
    // Overcomplete §11.3: task finalized ⇒ ARCHIVE_PENDING ⇒ schedule a
    // bounded background archive pass (navigate/archive/verify later). The
    // pass only ever marks ARCHIVED from verified page state; failures keep
    // the ledger row pending and visible.
    try {
      const hasPending = externalSessions?.forTask(id).some((record) => record.status === "ARCHIVE_PENDING");
      if (hasPending && recoveryScheduler) recoveryScheduler.schedule({ id: `external-archive:${id}`, taskId: id, kind: "external-archive", retryAt: Date.now() + 15000, payload: {} });
    } catch { /* scheduling is advisory */ }
    // U6 §13/§51: a conversation with no remaining active task auto-archives
    // (flag only, never delete) once its last task has a final response. The
    // currently-selected conversation is left in place so the user can read
    // the result they just produced; finished background conversations tidy
    // themselves automatically.
    try {
      const decision = autoArchiveDecision(store.snapshot(), id);
      if (decision.archive) {
        const task = store.snapshot().tasks.find((item) => item.id === id)!;
        if (store.snapshot().activeConversationId !== task.conversationId) store.setConversationArchived(task.conversationId, true);
      }
    } catch { /* auto-archive is best-effort; conversation stays visible otherwise */ }
  };
  automation = new ProviderAutomation(store, providerViews, provider, publish, accountSessions, providerApi, advanceCouncilRound, onTaskComplete, (run, strategy, retryAt) => recovery.defer(run, strategy, retryAt), domainEventBus, attachmentStore);
  // Overcomplete §11.3/§11.4: production archive recovery handler — each wake
  // retries pending external archives with the live fail-closed attempt; if
  // anything stays pending (provider offline / rate-limited / page changed),
  // the wake is re-armed with a long backoff. Attempts are bounded by the
  // recovery scheduler; exhausted rows stay ARCHIVE_PENDING (visible, never
  // auto-deleted) until a later pass or a manual archive.
  if (recoveryScheduler) {
    recoveryScheduler.register("external-archive", async () => {
      const result = await automatePendingExternalArchives(externalSessions!, liveArchiveAttempt(), { limit: 10 });
      if (result.remainingPending > 0) {
        return { done: false, retryAt: Date.now() + 20 * 60 * 1000, error: `${result.remainingPending} external archive(s) still pending; will retry` };
      }
      return { done: true };
    });
  }
  detachContinuationWaker?.();
  detachContinuationWaker = domainEventBus ? attachContinuationWaker(domainEventBus, (taskId) => automation.continueIfReady(taskId)) : undefined;
  recoveryScheduler.start();
  startAutoLayoutMonitor();
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    show: !isSmokeTest && !headlessResearch,
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: "Codex Boss — Controller",
    backgroundColor: "#0b0d10",
    titleBarStyle: "hiddenInset",
    autoHideMenuBar: true,
    webPreferences: {
      offscreen: isSmokeTest,
      backgroundThrottling: !isSmokeTest,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js")
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load: ${code} ${description} ${url}`);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
    automation?.dispose();
    providerViews?.destroyAll();
  });
}

/**
 * Live research stage executor (milestone §7/§15): the research conductor
 * driven by a semantic provider backed by the Boss web-AI provider pool (the
 * logged-in providers, 1 primary + backup per stage). Every semantic stage is
 * real — no placeholder can advance a live run. When no provider window is
 * open the run fails closed with an explicit reason.
 */
function liveResearchExecutor(): ResearchStageExecutor {
  const provider = createLiveResearchProvider({
    openProviderIds: () => store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id),
    // Transient web-automation failures (page busy/not-ready / send rollback)
    // are common: bounded retries with backoff, each attempt in a fresh
    // conversation; chronically failing providers get deprioritized.
    maxAttempts: 8,
    retryBackoffMs: 20000,
    execute: async (providerId, input) => {
      try {
        if (!automation) return { status: "FAIL", message: "provider automation not ready" };
        const result = await automation.executeWorker(providerId, {
          taskId: input.jobId,
          jobId: input.jobId,
          role: "research",
          prompt: input.prompt,
          context: "Autonomous research semantic stage. Return ONLY the requested JSON. Never change the research question; never invent experiment results, statistics, sources or citation support.",
          replaySafe: true,
          timeoutMs: 180000
        });
        return result.status === "SUCCESS" ? { status: "SUCCESS", content: result.content } : { status: "FAIL", message: result.failure?.message ?? `web provider ${providerId} did not answer` };
      } catch (error) {
        // executeWorker may reject (e.g. the "AI is busy on another task"
        // guard); surface it as a FAIL so the provider retry/backoff layer can
        // ride through transient busy pages instead of failing the run.
        return { status: "FAIL", message: String(error instanceof Error ? error.message : error).slice(0, 300) };
      }
    }
  });
  return new LiveResearchExecutor({
    inner: new ResearchConductor({
      service: () => {
        if (!research) throw new Error("research service not ready");
        return research;
      },
      provider,
      // Overcomplete §9.3: REAL host literature retrieval (OpenAlex) before any
      // AI advisory intake. Offline/empty results degrade honestly to the
      // provider fallback inside the conductor.
      hostLiterature: async (ir) => runHostLiteraturePass({ rq: ir.researchQuestions[0] ?? ir.goal }, createOpenAlexLiteratureDeps())
    })
  });
}

const HEADLESS_RQ = "Does evidence-weighted adjudication reduce review errors relative to majority-vote adjudication on a fixed software-engineering benchmark?";

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Headless live acceptance (E2E-C from the command line): waits for the chosen
 * provider windows to open, runs ONE human-defined research autopilot to
 * READY/block, writes a result JSON beside the research root and exits 0 when
 * READY + readiness passed. Used by `--research-headless-run` so no manual GUI
 * step is required.
 */
async function runHeadlessResearch(workspace: string, providerIds: string[]): Promise<void> {
  const waitForOpen = async (): Promise<string[]> => {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const open = store.snapshot().providers.filter((item) => providerIds.includes(item.id) && item.windowOpen).map((item) => item.id);
      if (open.length >= 1) return open;
      await sleepMs(700);
    }
    throw new Error(`Headless: no chosen provider window opened within 180s (wanted ${providerIds.join(",")})`);
  };
  const opened = await waitForOpen();
  await sleepMs(12000); // let the provider pages settle into an idle state
  if (!research) throw new Error("research service not ready");
  const input: HumanDefinedResearchInput = {
    researchQuestion: HEADLESS_RQ,
    workspace,
    providerPolicy: "AUTO",
    reviewers: opened,
    budget: { maxSteps: 600, maxExperiments: 3, maxProviderCalls: 400 }
  };
  const record = research.startHumanResearch(input);
  console.log(`HEADLESS research ${record.ir.id} started; providers open: ${opened.join(",")}`);
  const result = await research.supervisor.runUntilBlocked(record.ir.id, { maxSteps: 600 });
  const readiness = research.readiness(record.ir.id);
  const ledger = research.ledger.load(record.ir.id);
  const report = {
    schema: "codex-boss/headless-live-run/v1",
    id: record.ir.id,
    state: result.state,
    steps: result.steps,
    lastDecision: ledger?.decisions.at(-1) ? { step: ledger.decisions.at(-1)!.stepId, decision: ledger.decisions.at(-1)!.decision, reason: ledger.decisions.at(-1)!.reason.slice(0, 500) } : null,
    readiness,
    researchRoot: path.join(app.getPath("userData"), ".boss", "research", record.ir.id)
  };
  const outFile = path.join(app.getPath("userData"), ".boss", `live-headless-${record.ir.id}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log("HEADLESS_RESULT " + JSON.stringify(report));
  const passed = result.state === "READY" && readiness.ok;
  app.exit(passed ? 0 : 1);
}

/**
 * Headless preflight: cancel every stale web run (waiting/queued/prepared/
 * sending) left behind by earlier sessions. Those stuck runs keep their
 * provider pages "busy" and would make ProviderAutomation refuse new research
 * asks with "所选 AI 正在处理另一任务". Only runs are touched — history stays.
 */
function headlessPreflightStaleRuns(): void {
  const stuck = new Set(["waiting", "queued", "prepared", "sending"]);
  for (const run of store.snapshot().runs) {
    if (stuck.has(run.phase)) {
      try { store.updateRun(run.id, "failed", null, "headless live preflight: stale run failed to release the provider page"); } catch { /* best effort */ }
    }
  }
  for (const task of store.snapshot().tasks.filter((item) => item.status === "running" || item.status === "waiting" || item.status === "queued")) {
    try { store.setTaskStatus(task.id, "cancelled"); } catch { /* best effort */ }
  }
}

if (ownsInstance) app.whenReady().then(() => {
  historyRepository = new HistoryRepository(path.join(overrideDataRoot ? dataRoot : app.getAppPath(), "history"));
  store = new StateStore(path.join(app.getPath("userData"), "state.json"), historyRepository);
  // Attachment blobs live beside the durable ledger under <dataRoot>/.boss.
  attachmentStore = new AttachmentStore(path.join(app.getPath("userData"), ".boss", "attachments"));
  capabilityRegistry = new ProviderCapabilityRegistry(path.join(app.getPath("userData"), ".boss", "provider-capabilities.json"));
  githubResolver = new GithubResolver(path.join(app.getPath("userData"), ".cache", "repos"));
  apiSettings = new ApiSettingsStore(
    path.join(app.getPath("userData"), "api-settings.json"),
    (plainText) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用，无法保存 API Key");
      return safeStorage.encryptString(plainText).toString("base64");
    },
    (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, "base64"))
  );
  providerApi = new ProviderApiClient(apiSettings);
  store.setApiSettings(apiSettings.snapshot(store.snapshot().providers.map((item) => item.id)));
  accountSessions = new AccountSessionManager(store, publish);
  externalSessions = new ExternalSessionLedger(path.join(app.getPath("userData"), ".boss", "external-sessions.json"));
  remoteRelay = new RemoteCommandRelay(
    path.join(app.getAppPath(), "scripts", "pc-chat-relay.ps1"),
    (channel, status, message) => { store.setRemoteChannelRuntime(channel, status, message); publish(); },
    (channel, body, sourceWindow) => { if (store.receiveRemoteCommand(channel, body, sourceWindow)) publish(); }
  );
  remoteRelay.sync(store.snapshot().remoteChannels);
  const runtimeRegistry = new RuntimeRegistry();
  budgetManager = new BudgetManager(path.join(app.getPath("userData"), ".boss", "runtime-budget.json"));
  const domainEvents = new DomainEventBus();
  domainEventBus = domainEvents;
  progressAggregator = attachProgressRecorder(domainEvents).aggregator;
  humanGuidance = new HumanGuidanceGate(path.join(app.getPath("userData"), ".boss", "interventions.json"));
  decisionLedger = new DecisionLedgerStore(path.join(app.getPath("userData"), ".boss", "decision-ledger.json"));
  // Milestone §3/§6: ONE research composition root. ResearchService owns the
  // durable ledger, protocol manager, evidence graph, citation store, autopilot
  // supervisor and structured runtime; every boss:research-* IPC handler below
  // forwards to it. Per-store roots keep the pre-migration durable locations
  // (research/<id>.json ledger files, research-protocols/) so existing runs
  // stay recoverable after the composition-root migration.
  const researchRoot = path.join(app.getPath("userData"), ".boss", "research");
  research = new ResearchService({
    root: researchRoot,
    ledgerRoot: researchRoot,
    protocolsRoot: path.join(app.getPath("userData"), ".boss", "research-protocols"),
    executor: liveResearchExecutor(),
    runtime: new ResearchRuntime()
  });
  attachTelemetryRecorder(domainEvents, new TelemetryStore(path.join(app.getPath("userData"), ".boss", "telemetry.json")));  const workspaces = new WorkspaceRegistry(path.join(app.getPath("userData"), ".boss", "workspaces.json"));
  workspaces.ensureShims(fs.realpathSync(app.getAppPath()));
  const permissionManifests = new PermissionManifestStore(durableFileFor(app.getPath("userData"), workspaces.activeWorkspaceId(), path.join(".boss", "permission-manifest.json")));
  const projectStates = new ProjectStateStore(durableFileFor(app.getPath("userData"), workspaces.activeWorkspaceId(), path.join(".boss", "project-state.json")));
  const experiences = new ExperienceStore(durableFileFor(app.getPath("userData"), workspaces.activeWorkspaceId(), path.join(".boss", "experience.json")));
  attachExperienceRecorder(domainEvents, experiences, { sourceFor: (taskId) => store.snapshot().tasks.find((task) => task.id === taskId)?.workspaceId ?? taskId });
  const softwareLeases = new SoftwareLeaseRegistry();
  recoveryScheduler = new RecoveryScheduler(path.join(app.getPath("userData"), ".boss", "recovery.json"), () => {
    for (const item of recoveryScheduler.list().filter((record) => record.state === "PAUSED")) {
      const task = store.snapshot().tasks.find((task) => task.id === item.taskId);
      if (task && (task.recoveryAt || task.recoveryMessage !== item.error)) store.setRecoveryState(item.taskId, undefined, item.error ?? "Recovery paused");
    }
    publish();
  }, domainEvents);
  const resourceController = new ResourceController(path.join(app.getPath("userData"), ".boss", "runtime-resources.json"));
  codexRuntime = new CodexCliRuntime(path.join(app.getPath("userData"), ".codex-boss"));
  runtimeRegistry.register(codexRuntime);
  runtimeRegistry.register(new NativeRuntime(app.getAppPath()));
  for (const item of store.snapshot().providers) runtimeRegistry.register(new ApiRuntime(item.id, providerApi));
  const contextManager = new ContextManager(path.join(app.getPath("userData"), "task-contexts.json"));
  contextManager.retainTaskIds(store.snapshot().tasks.map((task) => task.id));
  const circuitBreaker = new CircuitBreaker(path.join(app.getPath("userData"), ".boss", "circuit-breaker.json"));
  commander = new MainCommander(store, runtimeRegistry, new Scheduler(), new RoleRouter(runtimeRegistry, budgetManager, resourceController), budgetManager, contextManager, new ExecutionGate(), new TaskLedger(path.join(app.getPath("userData"), ".boss", "tasks")), resourceController, recoveryScheduler, { visionSurface: providerVisionSurface(() => providerViews, path.join(dataRoot, ".boss", "vision")), domPageSurface: providerDomSurface(() => providerViews), readBrowser: async (id) => {
    const view = providerViews.get(provider(id).id);
    if (!view) throw new Error("Provider page is not open");
    return view.webContents.executeJavaScript("JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText??'').slice(0,30000)})");
  }, permissionForWorkspace: () => permissionManifests.load(workspaces.activeWorkspaceId()) }, circuitBreaker, domainEvents, workspaces, softwareLeases);
  void codexRuntime.detect().then((controller) => { store.setController(controller); publish(); });
  // Headless mode still creates the (hidden) main window: provider views are
  // attached to it and ProviderAutomation dispatches through those views.
  createMainWindow();
  attachProviderViews();
  for (const item of store.snapshot().providers) runtimeRegistry.register(new ProviderRuntimeAdapter("web:" + item.id, {
    // U1 P1: window-open is visibility, not health. Availability follows the
    // last account probe (READY/GUEST_READY usable; AUTH_REQUIRED blocks; no
    // window or no probe yet → DOWN), so the role router never picks an
    // auth-blocked page as "available".
    async healthCheck() {
      const open = Boolean(providerViews.get(item.id));
      if (!open) return { runtimeId: "web:" + item.id, availability: "DOWN", message: "Visible provider session closed", checkedAt: new Date().toISOString() };
      const account = store.snapshot().accounts.find((entry) => entry.providerId === item.id);
      const mode = account?.mode ?? "UNKNOWN";
      const availability: RuntimeAvailability = mode === "AUTH_REQUIRED" ? "AUTH_REQUIRED" : mode === "UNKNOWN" ? "UNKNOWN" : "AVAILABLE";
      return { runtimeId: "web:" + item.id, availability, message: account?.message ?? "Visible provider session", checkedAt: new Date().toISOString() };
    },
    execute: (request, signal) => automation.executeWorker(item.id, request, signal)
  }));
  const resumeLocalTasks = async () => {
    for (const task of store.snapshot().tasks.filter((item) => item.workspacePath && ["running", "waiting", "queued"].includes(item.status) && commander.canResumeTask(item.id))) {
      try {
        if (await commander.executeDeterministic(task.id, task.workspacePath!)) await automation.continueIfReady(task.id);
        else await commander.executePlan(task.id, task.workspacePath!);
        publish();
      } catch (error) { store.setRecoveryState(task.id, undefined, String(error)); publish(); }
    }
  };
  if (!isSmokeTest && !headlessResearch) {
    DEFAULT_PROVIDER_IDS.forEach(openProviderWithinLimit);
    void automation.resumePending().catch((error) => console.error("Resume paused", error));
    void resumeLocalTasks();
  }
  if (headlessResearch) {
    // Headless live acceptance: cancel stale web runs first (they keep provider
    // pages busy), do NOT resume stale tasks, open only the chosen providers,
    // then run the research autopilot to completion.
    headlessPreflightStaleRuns();
    const openIds = headlessProviders.length ? headlessProviders : DEFAULT_PROVIDER_IDS;
    for (const id of openIds) {
      try { if (!provider(id).windowOpen) openProviderWithinLimit(id); } catch (error) { console.error(`Headless: cannot open provider ${id}:`, error); }
    }
    void runHeadlessResearch(headlessWorkspace!, openIds).catch((error) => { console.error("Headless research failed:", error); app.exit(1); });
  }

  ipcMain.handle("boss:snapshot", () => store.snapshot());
  ipcMain.handle("boss:owner-dashboard", () => {
    const interventions = humanGuidance?.list() ?? [];
    const snapshot = store.snapshot();
    return buildOwnerDashboard({
      snapshot,
      interventions: interventions.map(({ taskId, kind, question, resolvedAt }) => ({ taskId, kind, question, resolvedAt })),
      ledgerEntries: decisionLedger?.list() ?? [],
      activeInterventionTaskIds: interventions.filter((item) => !item.resolvedAt).map((item) => item.taskId),
      now: () => new Date().toISOString()
    });
  });
  ipcMain.handle("boss:progress", () => progressAggregator?.summaries() ?? []);
  ipcMain.handle("boss:active-intervention", (_event, taskId: string) => humanGuidance?.activeFor(taskId) ?? undefined);
  ipcMain.handle("boss:list-interventions", (_event, taskId?: string) => humanGuidance?.list(taskId) ?? []);
  ipcMain.handle("boss:resolve-intervention", (_event, taskId: string, kind: InterventionKind, answer: string) => {
    const resolved = humanGuidance?.resolve(taskId, kind, answer);
    // If the paused task is a research run, resume it from its control state.
    if (resolved && research?.supervisor.resume(taskId)) domainEvents.publish({ type: "HUMAN_APPROVED", taskId, message: "intervention answered; research resumed" });
    return resolved;
  });

  // Research mode: every IPC call forwards to the single ResearchService
  // composition root (milestone §6). The service owns the ledger, protocol
  // manager, evidence graph, citation store, autopilot supervisor and runtime —
  // no GUI-side duplicate composition.
  ipcMain.handle("boss:research-start", (_event, input: {
    id?: string;
    // Milestone §1 human input: a falsifiable research question + workspace +
    // budget; `researchQuestion` is the immutable anchor.
    researchQuestion?: string;
    goal: string;
    workspace: string;
    reviewers: string[];
    autonomy?: "AUTOPILOT" | "GUIDED";
    hypothesis?: string;
    providerPolicy?: "AUTO" | "FIXED";
    maxExperiments?: number;
    maxSteps?: number;
    maxProviderCalls?: number;
  }) => {
    if (!input.workspace.trim()) throw new Error("An authorized workspace is required");
    if (input.researchQuestion?.trim()) {
      const record = research!.startHumanResearch({
        id: input.id,
        researchQuestion: input.researchQuestion.trim(),
        workspace: input.workspace,
        hypothesis: input.hypothesis?.trim() || undefined,
        providerPolicy: input.providerPolicy ?? (input.autonomy === "GUIDED" ? "FIXED" : "AUTO"),
        reviewers: input.reviewers,
        budget: { maxSteps: input.maxSteps ?? 200, maxExperiments: input.maxExperiments ?? 3, maxProviderCalls: input.maxProviderCalls ?? 200 }
      });
      domainEvents.publish({ type: "TOOL_RESULT_READY", taskId: record.ir.id, message: `research ${record.ir.id} started from human-defined RQ` });
      return record;
    }
    if (!input.goal.trim()) throw new Error("Research goal is required when no researchQuestion is supplied");
    if (!input.reviewers.length) throw new Error("Research requires at least one reviewer");
    const ir: ResearchIR = {
      schemaVersion: 1,
      id: input.id ?? researchIdFor(input.goal.trim()),
      goal: input.goal.trim(),
      scope: { workspace: input.workspace.trim(), allowedDomains: [], reviewers: input.reviewers, autonomy: input.autonomy ?? "AUTOPILOT", budget: { maxExperiments: input.maxExperiments ?? 5, maxSteps: input.maxSteps ?? 100 } },
      state: "SCOPING",
      researchQuestions: [],
      hypotheses: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const record = research!.start(ir);
    domainEvents.publish({ type: "TOOL_RESULT_READY", taskId: ir.id, message: `research ${ir.id} started` });
    return record;
  });
  ipcMain.handle("boss:research-status", (_event, id: string) => research?.status(id) ?? null);
  ipcMain.handle("boss:research-list", () => research?.ledger.list() ?? []);
  ipcMain.handle("boss:research-step", async (_event, id: string) => research ? await research.step(id) : null);
  // Autopilot advances the run until a genuine block (reviewer gate / user
  // decision / provider wait) or a terminal READY/FAILED state.
  ipcMain.handle("boss:research-autopilot", async (_event, id: string, maxSteps?: number) => research ? await research.supervisor.runUntilBlocked(id, { maxSteps }) : null);
  ipcMain.handle("boss:research-resume", (_event, id: string) => {
    const resumed = research?.supervisor.resume(id) ?? false;
    // A run parked at WAITING_FOR_PROVIDER by a reviewer gate (round 8) or at
    // WAITING_FOR_USER by research-wait is now back at its pending stage.
    if (resumed) domainEvents.publish({ type: "HUMAN_APPROVED", taskId: id, message: "research run resumed to its pending stage" });
    return resumed;
  });
  ipcMain.handle("boss:research-wait", (_event, input: { id: string; kind: InterventionKind; question: string; options?: string[]; blockingStepId: string; contextSummary?: string }) => {
    const { id, ...rest } = input;
    // §18 raise-point interception (Owner-Result Rev.2): the question is
    // classified before it is raised. An AUTOPILOT run's DECIDABLE guidance is
    // auto-decided durably (requestGuidance records it and never parks) — no
    // human pause and no fabricated answer. Only a genuine HARD_BLOCKER (or a
    // GUIDED/ASSISTED run) parks and surfaces a durable human intervention.
    const outcome = research?.supervisor.requestGuidance({ id, kind: rest.kind, question: rest.question, options: rest.options }) ?? { intercepted: false, parked: false };
    if (outcome.intercepted) return { intercepted: true, decision: outcome.decision };
    const raised = humanGuidance?.raise({ taskId: id, ...rest, contextSummary: rest.contextSummary ?? rest.question.slice(0, 300) });
    return raised ?? null;
  });
  ipcMain.handle("boss:research-protocol-freeze", (_event, id: string, protocol: import("../src/shared/research-protocol").ResearchProtocol) => {
    // Service freeze() freezes the protocol AND records the canonical hash on
    // the run IR (state → PROTOCOL_FROZEN) in one call.
    return research!.freeze(id, protocol);
  });
  // Phase L: compile a run's manuscript/paper.tex into paper.pdf (audit written
  // to research/<id>/audit/compile.json). Fail-closed: no engine or compile
  // error → status FAIL, .tex preserved, paths still returned for repair.
  ipcMain.handle("boss:research-compile-pdf", async (_event, id: string) => {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    const manuscriptDir = path.join(app.getPath("userData"), ".boss", "research", safeId, "manuscript");
    const { LatexCompiler } = await import("./research/manuscript/latex-compiler.js");
    const audit = await new LatexCompiler().compile(manuscriptDir);
    return { ...audit, researchCache: path.join(app.getPath("userData"), ".boss", "research", safeId) };
  });
  ipcMain.handle("boss:project-state", (_event, workspaceId?: string) => {
    const target = workspaceId ?? workspaces.activeWorkspaceId();
    return openProjectState(target).summary(target);
  });
  ipcMain.handle("boss:create-task", (_event, input: CreateTaskInput) => {
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    const providerIds = [...new Set(input.providerIds)];
    if (providerIds.length === 0) throw new Error("At least one provider is required");
    if (providerIds.length > MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时选择 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
    providerIds.forEach(provider);
    const { appMode, transports } = taskTransports(input, providerIds);
    commander.createTask({ title: input.title.trim(), objective: input.prompt.trim(), providerIds, mode: input.mode ?? "direct", appMode, transports, conversationId: input.conversationId, reviewPolicy: input.reviewPolicy, finalizationPolicy: input.finalizationPolicy, inputObjectIds: input.inputObjectIds, workAgentCount: input.workAgentCount, runMode: input.runMode });
    return publish();
  });
  ipcMain.handle("boss:dispatch-task", async (_event, input: CreateTaskInput) => {
    const providerIds = [...new Set(input.providerIds)];
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Title and prompt are required");
    if (compileIntent(input.prompt).estimatedComplexity !== "L0" && !isDispatchGroupSize(providerIds.length)) throw new Error("请选择 1–5 个 AI；默认使用单 AI");
    providerIds.forEach(provider);
    const openIds = new Set(store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id));
    if (providerIds.some((id) => !openIds.has(id))) throw new Error("所选 AI 必须全部处于已打开状态");
    const { appMode, transports } = taskTransports(input, providerIds);
    // Auto workspace layout (Overcomplete live): a dispatch to MORE than three
    // web AI pages pops the processors into the second (DETACHED) window so
    // five pages don't crowd the controller; three or fewer stay merged in the
    // single-window workspace.
    try {
      const webCount = providerIds.filter((id) => (transports[id] ?? "web") === "web").length;
      const wanted = webCount > 3 ? "DETACHED" : "MERGED";
      if (providerViews.workspaceView() !== wanted) providerViews.setWorkspaceView(wanted);
    } catch (error) { /* layout is advisory; never block dispatch */ console.error("Auto workspace layout failed", error); }
    const conversationId = input.conversationId ?? store.snapshot().activeConversationId;
    // Phase F: a GitHub URL in the message is an input object, not prose —
    // materialize once and bind it so WORK can scan real code.
    const githubInput = await materializeGithubInput(conversationId, input.prompt);
    const inputObjectIds = [...new Set([...(input.inputObjectIds ?? []), ...(githubInput ? [githubInput.id] : [])])];
    const task = commander.createTask({ title: input.title.trim(), objective: input.prompt.trim(), providerIds, mode: input.mode ?? "direct", appMode, transports, conversationId, reviewPolicy: input.reviewPolicy, finalizationPolicy: input.finalizationPolicy, inputObjectIds: inputObjectIds.length ? inputObjectIds : undefined, workAgentCount: input.workAgentCount, runMode: input.runMode });
    // Phase E: Chat is the default entry. When a chat request actually needs
    // WORK capability, propose once instead of firing web providers blindly.
    if (appMode === "chat" && escalateDecisionFor(task).escalate) {
      const decision = escalateDecisionFor(task);
      // §18 task-level interception (Owner-Result Rev.2): a Chat→WORK capability
      // proposal is a DECIDABLE capability-routing question. Under OWNER_RESULT
      // it is auto-approved — recorded durably in the decision ledger first —
      // and the task runs immediately (checkpointBudget=0: no routine pause).
      // ASSISTED/AUTONOMOUS (and any HARD_BLOCKER text) keep the human gate.
      const mode = effectiveRunMode({ runMode: task.runMode, kind: runTaskKindFor(task.appMode, task.mode) });
      const verdict = workEscalationVerdict(mode, decision.reason ?? "任务需要进入 Work", decision.requiredCapabilities?.join("、"));
      if (verdict.action === "AUTO_APPROVE" && verdict.decision && decisionLedger) {
        decisionLedger.append({
          id: `dec-${task.id}-escalate-work`, taskId: task.id, createdAt: new Date().toISOString(),
          question: `Chat 任务需要 WORK 能力，是否升级？（${decision.reason ?? ""}）`,
          candidates: ["保持 Chat（能力不足）", "升级到 WORK（自动批准）"],
          chosen: verdict.decision.chosen,
          evidence: [`requiredCapabilities: ${(decision.requiredCapabilities ?? []).join(", ")}`],
          outcome: "APPLIED", policy: verdict.decision.policy, source: "question-interceptor"
        });
        if (store.approveModeTransition(task.id)) {
          commander.startTask(task.id);
          publish();
          const workspace = githubInput?.localPath ?? (input.workspacePath ? fs.realpathSync(input.workspacePath) : app.getAppPath());
          try { if (!await commander.executeDeterministic(task.id, workspace) && !await commander.executePlan(task.id, workspace)) await automation.dispatchTask(task.id); }
          catch (error) { store.setRecoveryState(task.id, undefined, String(error)); publish(); throw error; }
          await automation.continueIfReady(task.id);
          return publish();
        }
        return publish(); // raced: another path already drives this task
      }
      store.stageModeTransition(task.id, { from: "CHAT", to: "WORK", reason: decision.reason ?? "任务需要进入 Work", requiredCapabilities: decision.requiredCapabilities });
      return publish();
    }
    commander.startTask(task.id);
    publish();
    const workspace = githubInput?.localPath ?? (input.workspacePath ? fs.realpathSync(input.workspacePath) : app.getAppPath());
    try { if (!await commander.executeDeterministic(task.id, workspace) && !await commander.executePlan(task.id, workspace)) await automation.dispatchTask(task.id); }
    catch (error) { store.setRecoveryState(task.id, undefined, String(error)); publish(); throw error; }
    await automation.continueIfReady(task.id);
    return publish();
  });
  ipcMain.handle("boss:resolve-mode-proposal", async (_event, taskId: string, approveWork: boolean) => {
    const task = store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task?.modeTransition || task.interactionMode !== "WORK_PROPOSED") throw new Error("该任务没有待确认的 Work 升级");
    // Inherit message, attachments and conversation; only the single decision
    // differs between Chat and Work. GitHub tasks run against the materialized repo.
    const conversation = store.snapshot().conversations.find((item) => item.id === task.conversationId);
    const repoInput = (conversation?.inputObjects ?? []).find((ref) => task.inputObjectIds?.includes(ref.id) && ref.kind === "REPOSITORY" && ref.localPath);
    const workspace = repoInput?.localPath ?? (task.workspacePath ? fs.realpathSync(task.workspacePath) : app.getAppPath());
    if (approveWork) {
      if (!store.approveModeTransition(taskId)) throw new Error("该任务已处理过升级");
      commander.startTask(taskId);
      publish();
      try {
        if (!await commander.executeDeterministic(taskId, workspace) && !await commander.executePlan(taskId, workspace)) await automation.dispatchTask(taskId);
      } catch (error) { store.setRecoveryState(taskId, undefined, String(error)); publish(); throw error; }
      await automation.continueIfReady(taskId);
      return publish();
    }
    if (!store.declineModeTransition(taskId)) throw new Error("该任务已处理过升级");
    commander.startTask(taskId);
    publish();
    try { await automation.dispatchTask(taskId); }
    catch (error) { store.setRecoveryState(taskId, undefined, String(error)); publish(); throw error; }
    await automation.continueIfReady(taskId);
    return publish();
  });
  ipcMain.handle("boss:update-api-setting", (_event, input: UpdateApiSettingInput) => {
    provider(input.providerId);
    apiSettings.update(input);
    return publish();
  });
  ipcMain.handle("boss:update-remote-channel", (_event, input: UpdateRemoteChannelInput) => {
    store.updateRemoteChannel(input.channel, input.enabled, input.commandPrefix);
    remoteRelay.sync(store.snapshot().remoteChannels);
    return publish();
  });
  ipcMain.handle("boss:update-runtime-control", (_event, runtimeId: string, enabled: boolean, priority: number) => { store.setRuntimeControl(runtimeId, Boolean(enabled), Number(priority)); return publish(); });
  ipcMain.handle("boss:update-role-route", (_event, role, runtimeIds: string[], fallback: boolean) => { store.setRoleRoute(role, runtimeIds, Boolean(fallback)); return publish(); });
  ipcMain.handle("boss:load-remote-command", (_event, commandId: string) => { store.setRemoteCommandStatus(commandId, "loaded"); return publish(); });
  ipcMain.handle("boss:dismiss-remote-command", (_event, commandId: string) => { store.setRemoteCommandStatus(commandId, "dismissed"); return publish(); });
  ipcMain.handle("boss:create-folder", (_event, name: string) => { store.createFolder(name); return publish(); });
  ipcMain.handle("boss:rename-folder", (_event, folderId: string, name: string) => { store.renameFolder(folderId, name); return publish(); });
  ipcMain.handle("boss:create-conversation", (_event, input: CreateConversationInput) => { store.createConversation(input.folderId, input.title); return publish(); });
  ipcMain.handle("boss:rename-conversation", (_event, conversationId: string, title: string) => { store.renameConversation(conversationId, title); return publish(); });
  ipcMain.handle("boss:move-conversation", (_event, conversationId: string, folderId: string) => { store.moveConversation(conversationId, folderId); return publish(); });
  ipcMain.handle("boss:select-conversation", (_event, conversationId: string) => { store.selectConversation(conversationId); return publish(); });
  ipcMain.handle("boss:archive-conversation", (_event, conversationId: string, archived: boolean) => { store.setConversationArchived(conversationId, Boolean(archived)); return publish(); });
  ipcMain.handle("boss:delete-conversation", (_event, conversationId: string, userConfirmed: boolean) => {
    // U1 P1 (§13.1): delete requires an explicit user confirmation on the main
    // process too — never trust a renderer-triggered cascade delete alone.
    if (userConfirmed !== true) throw new Error("删除需要明确确认（该操作不可恢复）");
    store.deleteConversation(conversationId);
    attachmentStore?.removeConversation(conversationId);
    return publish();
  });
  ipcMain.handle("boss:delete-conversations", (_event, conversationIds: string[], userConfirmed: boolean) => {
    // U1 P1 (§13.1): bulk delete also requires an explicit confirmed flag.
    if (userConfirmed !== true) throw new Error("批量删除需要明确确认（该操作不可恢复）");
    for (const conversationId of [...new Set((conversationIds ?? []).filter(Boolean))]) {
      try { store.deleteConversation(conversationId); attachmentStore?.removeConversation(conversationId); } catch { /* keep deleting the rest */ }
    }
    return publish();
  });
  ipcMain.handle("boss:duplicate-conversation", (_event, conversationId: string) => { store.duplicateConversation(conversationId); return publish(); });
  ipcMain.handle("boss:pick-attachments", async (_event, conversationId: string) => {
    const storeInstance = attachmentStore!;
    const conversationRef = store.snapshot().conversations.find((item) => item.id === conversationId);
    if (!conversationRef) throw new Error(`Unknown conversation: ${conversationId}`);
    const options: Electron.OpenDialogOptions = { title: "选择要上传的文件", properties: ["openFile", "multiSelections"] };
    const selection = mainWindow && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length === 0) return publish();
    const imported = selection.filePaths.map((filePath) => storeInstance.importAttachment({ conversationId, originalName: path.basename(filePath), sourcePath: filePath }));
    store.registerInputObjects(conversationId, imported.map((object) => object));
    return publish();
  });
  ipcMain.handle("boss:add-attachment-bytes", (_event, input: { conversationId: string; originalName: string; mime?: string; bytes: Uint8Array }) => {
    const object = attachmentStore!.importAttachment({ conversationId: input.conversationId, originalName: input.originalName, mime: input.mime, bytes: input.bytes });
    store.registerInputObjects(input.conversationId, [object]);
    return publish();
  });
  ipcMain.handle("boss:remove-attachment", (_event, conversationId: string, inputObjectId: string) => {
    attachmentStore?.removeAttachment(conversationId, inputObjectId);
    store.removeInputObject(conversationId, inputObjectId);
    return publish();
  });
  ipcMain.handle("boss:attachment-path", (_event, conversationId: string, inputObjectId: string) => attachmentStore?.localPathFor(conversationId, inputObjectId));
  ipcMain.handle("boss:export-conversation", async (_event, conversationId: string) => {
    const exportRoot = path.join(app.getPath("userData"), "exports");
    const destination = historyRepository.exportConversation(store.snapshot(), conversationId, exportRoot);
    const { shell } = await import("electron");
    shell.showItemInFolder(destination);
    return destination;
  });
  ipcMain.handle("boss:add-custom-provider", (_event, input: CustomProviderInput) => {
    const normalized = normalizeCustomProviderInput(input);
    store.addCustomProvider(normalized.name, normalized.url);
    return publish();
  });
  ipcMain.handle("boss:remove-custom-provider", (_event, providerId: ProviderId) => {
    providerViews.close(providerId);
    store.removeCustomProvider(providerId);
    return publish();
  });
  ipcMain.handle("boss:open-provider", (_event, providerId: ProviderId) => {
    openProviderWithinLimit(providerId);
    return publish();
  });
  ipcMain.handle("boss:close-provider", (_event, providerId: ProviderId) => {
    provider(providerId);
    providerViews.close(providerId);
    return publish();
  });
  ipcMain.handle("boss:layout-views", (_event, layout: Partial<Record<ProviderId, ViewBounds>>) => {
    const safeLayout: Partial<Record<ProviderId, ViewBounds>> = {};
    for (const item of store.snapshot().providers) {
      const bounds = layout[item.id];
      if (!bounds) continue;
      if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) continue;
      safeLayout[item.id] = bounds;
    }
    providerViews.layout(safeLayout);
  });
  // U4 §7/§9: workspace view (MERGED ↔ DETACHED two-window mode). In DETACHED
  // the open web-AI panes move into window B beside the Boss window; provider
  // sessions survive the transition.
  ipcMain.handle("boss:set-workspace-view", (_event, view: string) => {
    if (view !== "MERGED" && view !== "DETACHED") throw new Error("Invalid workspace view");
    providerViews.setWorkspaceView(view);
    return { view: providerViews.workspaceView(), webWindow: providerViews.webWindowBounds() };
  });
  ipcMain.handle("boss:get-workspace-view", () => ({ view: providerViews.workspaceView(), webWindow: providerViews.webWindowBounds() }));
  // U4 §7/§9 live check: the main interaction window must stay OPEN while the
  // web-AI panes are popped into window B — report host visibility/minimized
  // state alongside the view for objective verification.
  ipcMain.handle("boss:get-window-state", () => {
    const state = (window: BrowserWindow | undefined) => {
      if (!window || window.isDestroyed()) return undefined;
      return { visible: window.isVisible(), minimized: window.isMinimized(), maximized: window.isMaximized(), focused: window.isFocused(), bounds: window.getBounds() };
    };
    return { view: providerViews.workspaceView(), host: state(mainWindow ?? undefined), webWindow: state(providerViews.webWindowInstance()) };
  });
  ipcMain.handle("boss:set-provider-views-visible", (_event, visible: boolean) => providerViews.setVisible(Boolean(visible)));
  // U4 §9.2: per-pane manual zoom override (zoom buttons in the pane title).
  // The override wins over auto-fit until the view is closed or the override
  // is cleared.
  ipcMain.handle("boss:set-provider-zoom", (_event, providerId: string, factor: number) => {
    provider(providerId);
    providerViews.setManualZoom(providerId, Number(factor));
  });
  ipcMain.handle("boss:reload-provider", (_event, providerId: string) => {
    const view = providerViews.get(providerId);
    if (!view) throw new Error(`Unknown provider view: ${providerId}`);
    view.webContents.reload();
  });
  ipcMain.handle("boss:launch-task", (_event, taskId: string) => {
    const task = store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const current = new Set(store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id));
    task.providerIds.forEach((providerId) => current.add(providerId));
    if (current.size > MAX_ACTIVE_PROVIDERS) throw new Error(`当前任务会使已打开页面超过 ${MAX_ACTIVE_PROVIDERS} 个，请先关闭部分页面`);
    task.providerIds.forEach(openProviderWithinLimit);
    store.setTaskStatus(taskId, "running");
    return publish();
  });
  ipcMain.handle("boss:prepare-task", async (_event, taskId: string) => {
    await automation.prepareTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:send-task", async (_event, taskId: string) => {
    await automation.sendTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:release-review", async (_event, taskId: string) => { store.releaseReview(taskId); domainEvents.publish({ type: "HUMAN_APPROVED", taskId, message: "operator approved the review gate" }); await automation.continueIfReady(taskId); return publish(); });
  ipcMain.handle("boss:capture-task", async (_event, taskId: string) => {
    await automation.captureTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:advance-council", async (_event, taskId: string) => { await automation.continueIfReady(taskId); return publish(); });

  ipcMain.handle("boss:build-evidence", (_event, taskId: string) => {
    const snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const council = snapshot.councils.find((item) => item.taskId === taskId);
    const previous = snapshot.evidenceBundles.find((item) => item.taskId === taskId);
    store.saveEvidence(buildEvidenceBundle(task, snapshot.artifacts, council, previous?.codexReview));
    return publish();
  });
  ipcMain.handle("boss:rehydrate-evidence", async (_event, taskId: string) => {
    let snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    let bundle = snapshot.evidenceBundles.find((item) => item.taskId === taskId);
    if (!bundle) {
      bundle = buildEvidenceBundle(task, snapshot.artifacts, snapshot.councils.find((item) => item.taskId === taskId));
      store.saveEvidence(bundle);
      snapshot = store.snapshot();
    }
    if (!bundle.claims.some((claim) => claim.status === "DISPUTED" || claim.status === "INSUFFICIENT")) throw new Error("当前证据包没有需要选择性回填的 claim");
    store.addRehydrationRound(taskId, buildRehydrationPrompts(task, bundle, snapshot.artifacts, task.providerIds));
    await automation.dispatchTask(taskId);
    return publish();
  });
  ipcMain.handle("boss:run-codex-review", async (_event, taskId: string) => {
    let snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    let bundle = snapshot.evidenceBundles.find((item) => item.taskId === taskId);
    if (!bundle) {
      bundle = buildEvidenceBundle(task, snapshot.artifacts, snapshot.councils.find((item) => item.taskId === taskId));
      store.saveEvidence(bundle);
      snapshot = store.snapshot();
    }
    store.updateCodexReview(bundle.id, { status: "RUNNING" });
    publish();
    try {
      const content = await codexRuntime.review(bundle, snapshot.artifacts);
      store.updateCodexReview(bundle.id, { status: "COMPLETED", content, completedAt: new Date().toISOString() });
    } catch (error) {
      store.observeRuntimeFailure("codex:cli", String(error));
      store.updateCodexReview(bundle.id, { status: "FAILED", error: String(error), completedAt: new Date().toISOString() });
    }
    return publish();
  });
  ipcMain.handle("boss:update-task", async (_event, taskId: string, status: TaskStatus) => {
    store.setTaskStatus(taskId, status);
    if (status === "cancelled") automation?.cancelRuns(taskId);
    if (status === "running" && recoveryScheduler.resumeTask(taskId)) {
      const deadline = Math.min(...recoveryScheduler.list().filter((item) => item.taskId === taskId && item.state === "WAITING").map((item) => item.retryAt));
      store.setRecoveryState(taskId, deadline, "用户已继续任务；按记录的时间恢复原会话");
    }
    if (status === "running" && store.snapshot().tasks.find((item) => item.id === taskId)?.finalizationBlocker) await commander.finalizeTask(taskId, publish);
    return publish();
  });
  // U3 Evidence>Vote (§2.3/§4): when auto-finalization parked a task because
  // its evidence bundle holds DISPUTED/INSUFFICIENT claims or disputes, the
  // operator may explicitly accept the held evidence (records PASS) and then
  // Boss finalizes — never auto-published, never silently dropped.
  ipcMain.handle("boss:accept-evidence", async (_event, taskId: string) => {
    const snapshot = store.snapshot();
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const bundle = snapshot.evidenceBundles.find((item) => item.taskId === taskId && ["HOLD_FOR_REVIEW", "READY_FOR_USER_REVIEW"].includes(item.decision));
    if (!bundle) throw new Error("当前任务没有待接收的未决证据包");
    store.setEvidenceDecision(bundle.id, "PASS");
    await commander.finalizeTask(taskId, publish);
    return publish();
  });
  // U6 §14: surface the external web-session archive ledger (read-only; never
  // deletes, only shows archive lifecycle so a failed external archive stays
  // visible and retryable).
  ipcMain.handle("boss:external-session-list", () => externalSessions?.list() ?? []);
  // Overcomplete §11.3: run one bounded external-archive pass on demand
  // (manual retry surface; fail-closed — never fake-archives).
  ipcMain.handle("boss:external-archive-run", async () => automatePendingExternalArchives(externalSessions!, liveArchiveAttempt(), { limit: 10 }));
  // U10 §26–§41 (+ Overcomplete §6.1/§6.4): autonomous engineering goal surface.
  // Status is the durable read-model; run starts one goal loop over the real
  // allowed commands with the PRODUCTION coder/reviewer wired in-process (the
  // role router dispatches to configured web/API/Codex runtimes; deterministic
  // closures can be forced off via disableCoder/disableReviewer).
  ipcMain.handle("boss:engineering-goal-status", () => commander.engineeringGoalStatus());
  ipcMain.handle("boss:engineering-goal-run", async (_event, input: { goal: Parameters<MainCommander["runEngineeringGoal"]>[0]["goal"]; workspace: string; maxIterations?: number; replace?: boolean; workerRuntimes?: { implement?: string[]; review?: string[] }; disableCoder?: boolean; disableReviewer?: boolean }) => {
    return commander.runEngineeringGoal({ goal: input.goal, workspace: input.workspace, maxIterations: input.maxIterations, replace: input.replace, workerRuntimes: input.workerRuntimes, disableCoder: input.disableCoder, disableReviewer: input.disableReviewer });
  });

  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      attachProviderViews();
    }
  });

  if (isSmokeTest) {
    const smoke = async () => {
      if (!mainWindow) throw new Error("Smoke renderer missing");
      const ready = await mainWindow.webContents.executeJavaScript('Boolean(window.boss && document.querySelector(".composer-zone"))');
      if (!ready) throw new Error("Renderer bridge or UI not ready");
      if (process.argv.includes("--boss-restart-seed")) {
        fs.writeFileSync(path.join(dataRoot, "restart-evidence.txt"), "BOSS_RESTART_EVIDENCE");
        store.captureArtifact = () => { fs.writeFileSync(path.join(dataRoot, "restart-seeded.json"), JSON.stringify({ phase: "before_artifact", pid: process.pid })); process.exit(0); };
        await mainWindow.webContents.executeJavaScript("window.boss.dispatchTask(" + JSON.stringify({ title: "Restart acceptance", prompt: "读取终端日志 restart-evidence.txt", providerIds: [], appMode: "work", workspacePath: dataRoot }) + ")");
        throw new Error("Restart seed did not exit");
      }
      if (process.argv.includes("--boss-restart-verify")) {
        await resumeLocalTasks();
        const snapshot = store.snapshot();
        const task = snapshot.tasks.find((item) => item.title === "Restart acceptance");
        if (!task || task.status !== "completed") throw new Error("Restart task not completed");
        const final = store.finalResponseForTask(task.id);
        if (!final?.content.includes("BOSS_RESTART_EVIDENCE")) throw new Error("Restart final evidence absent");
        const ledger = commander.ledger!.load(task.id)!;
        if (ledger.jobs.graph_execute.attempts !== 1) throw new Error("Restart repeated native execution");
        if (snapshot.artifacts.filter((item) => item.taskId === task.id).length !== 1) throw new Error("Restart duplicated artifact");
        // A resumed task can finish before the renderer subscribes to snapshot
        // updates. Re-publish after the durable assertions so the restored
        // final response is observable in the newly-created window as well.
        publish();
        let visible = false;
        for (let i = 0; i < 30; i++) {
          visible = await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".final-response")?.textContent.includes("BOSS_RESTART_EVIDENCE"))');
          if (visible) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!visible) throw new Error("Restart final not rendered");
        fs.writeFileSync(path.join(dataRoot, "restart-result.json"), JSON.stringify({ kind: "CONTROLLED_ELECTRON_RESTART", status: "PASS", pid: process.pid, taskId: task.id, attempts: ledger.jobs.graph_execute.attempts, finalVisible: visible }, null, 2));
        app.exit(0); return;
      }
      const result = await mainWindow.webContents.executeJavaScript('window.boss.dispatchTask({title:"Native smoke verification",prompt:"list files",providerIds:[],appMode:"work"})') as AppSnapshot;
      if (!result.tasks.some((task) => task.title === "Native smoke verification" && task.status === "completed")) throw new Error("Native IPC execution did not complete");
      let rendered = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        rendered = await mainWindow.webContents.executeJavaScript('Boolean(document.querySelector(".conversation-turn .user-message")?.textContent.includes("list files") && document.querySelector(".final-response pre"))');
        if (rendered) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!rendered) throw new Error("Completed task was not rendered");
      mainWindow.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const root = app.getPath("userData");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "smoke.png"), (await mainWindow.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(root, "smoke-result.json"), JSON.stringify({ rendererLoaded: true, nativeCompleted: true, completionVisible: true, generatedAt: new Date().toISOString() }, null, 2));
      app.exit(0);
    };
    setTimeout(() => { void smoke().catch((error) => { console.error(error); app.exit(1); }); }, 1500);
  }
});

app.on("window-all-closed", () => {
  recoveryScheduler?.dispose();
  remoteRelay?.dispose();
  if (process.platform !== "darwin") app.quit();
});
