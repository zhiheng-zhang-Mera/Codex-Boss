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
import { migrateBrowserProfile, migrateLegacyPersistentData, runtimeRoots } from "./runtime-paths";
import type { AppSnapshot, CreateConversationInput, CreateTaskInput, CustomProviderInput, Provider, ProviderId, ViewBounds } from "../src/shared/contracts";
import type { RuntimeAvailability } from "./runtimes/runtime";
import { DEFAULT_PROVIDER_IDS, MAX_ACTIVE_PROVIDERS, normalizeCustomProviderInput } from "../src/shared/provider-policy";
import { buildPeerReviewPrompts, buildSynthesisPrompts, extractCouncilFindings } from "../src/shared/council-engine";
import { roleBriefsForWorkerOrder } from "../src/shared/work-mode";
import { ProviderAutomation } from "./provider-automation";
import { CodexCliRuntime } from "./runtimes/codex/codex-cli-runtime";
import { ProviderRuntimeAdapter } from "./runtimes/web/provider-runtime-adapter";
import { NativeRuntime } from "./runtimes/native-api-runtime";
import { RuntimeRegistry } from "./commander/runtime-registry";
import { BudgetManager } from "./commander/budget-manager";
import { RoleRouter } from "./commander/role-router";
import { Scheduler } from "./commander/scheduler";
import { captureSurfacesForThemeDesign, defaultCaptureTargets, summarizeCapture } from "./theme/visual-capture";
import { recordThemeKnowledge } from "./theme/theme-knowledge";
import { writeJson } from "./commander/durable-json";
import { ExecutionGate } from "./commander/execution-gate";
import { CircuitBreaker } from "./commander/circuit-breaker";
import { DomainEventBus } from "./commander/event-bus";
import { attachContinuationWaker } from "./commander/continuation-waker";
import { validateWorkspacePath } from "./workspace/path-utils";
import { createWorkspaceIpcModule } from "./bootstrap/workspace-ipc";
import { createAttachmentIpcModule } from "./bootstrap/attachment-ipc";
import { createConversationIpcModule } from "./bootstrap/conversation-ipc";
import { createProviderIpcModule } from "./bootstrap/provider-ipc";
import { createStatusIpcModule, windowStateView } from "./bootstrap/status-ipc";
import { createEngineeringSurfaceIpcModule } from "./bootstrap/engineering-surface-ipc";
import { createResearchIpcModule } from "./bootstrap/research-ipc";
import { createHostStatusIpcModule } from "./bootstrap/host-status-ipc";
import { createSettingsIpcModule } from "./bootstrap/settings-ipc";
import { createThemeIpcModule } from "./bootstrap/theme-ipc";
import { createTaskLifecycleIpcModule } from "./bootstrap/task-lifecycle-ipc";
import { createResearchOwnerIpcModule } from "./bootstrap/research-owner-ipc";
import { createTaskStateIpcModule } from "./bootstrap/task-state-ipc";
import { createResearchRunIpcModule } from "./bootstrap/research-run-ipc";
import { createTaskCreationIpcModule } from "./bootstrap/task-creation-ipc";
import { createDispatchIpcModule } from "./bootstrap/dispatch-ipc";
import { createPersistenceModule } from "./bootstrap/persistence";
import { createStateCoreModule } from "./bootstrap/state-core";
import { createKnowledgeModule } from "./bootstrap/knowledge";
import { createAutomationModule } from "./bootstrap/automation";
import { createRuntimeModule, type RuntimeService } from "./bootstrap/runtime";
import { createProvidersModule, type ProvidersService } from "./bootstrap/providers";
import { createProviderPoolModule, type ProviderPoolService } from "./bootstrap/provider-pool";
import { createResearchModule } from "./bootstrap/research";
import { createEngineeringModule, type EngineeringService } from "./bootstrap/engineering";
import { workbookAttachments, type InputRefSources } from "./tasks/task-inputs";
import { reportBootHealth, type BootModule } from "./bootstrap/boot-module";
import { availableWorkspace, persistedWorkspaceAvailable, workspaceForRequest } from "./workspace/task-workspace";
import { selectWorkspaceDirectory } from "./workspace/workspace-picker";
import { WorkspaceSelectionStore } from "./workspace/workspace-selection";
import { engineeringSessionId } from "./engineering/engineering-session";
import { durableFileFor } from "./workspace/durable-roots";
import { DEFAULT_WORKSPACE_ID } from "../src/shared/workspace";
import { ProjectStateStore } from "./project/project-state";
import {
  reconcileWorkbookLinks,
  resumeWorkBookTask,
  resumeWorkspaceFor,
  runWorkDispatch
} from "./commander/workbook-production";
import { WorkbookRegistry } from "./ingestion/workbook-registry";
import { attachProgressRecorder } from "./commander/progress-recorder";
import { HumanGuidanceGate } from "./commander/human-guidance-gate";
import { ResearchService } from "./research/research-service";
import { DefaultLevelBExecutor } from "./research/default-levelb-executor";
import type { HumanDefinedResearchInput } from "../src/shared/research-input";
import { MainCommander } from "./commander/main-commander";
import { buildEvidenceBundle } from "./evidence-engine";
import { autoArchiveDecision } from "../src/shared/archive-policy";
import { DecisionLedgerStore } from "./commander/decision-ledger-store";
import { SessionLifecycleLedger } from "./identity/session-lifecycle-ledger";
import { NodeCapabilityRegistry } from "./node/node-capability-registry";
import { LearningService } from "./learning/learning-service";
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
import { SHIPPED_ROOT_OWNER } from "./root-authority/root-policy-loader";
import { createGitHubMachineRuntime } from "./github/github-machine-runtime";

let mainWindow: BrowserWindow | null = null;
/** The runtime boot module, assigned in the boot block; `createMainWindow` needs it. */
let runtime: BootModule<RuntimeService<BrowserWindow>>;
/** The provider pool's policies, assigned in the boot block; the wrappers above need it. */
let providersRef: ProvidersService;
/** The pool's objects, assigned in the boot block; `attachProviderViews` drives it. */
let poolRef: ProviderPoolService;
/** Set by each attach; the automation's recovery thunk reads it lazily. */
let recoveryRef: WebRecovery | undefined;
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
let sessionLifecycleLedger: SessionLifecycleLedger | undefined;
let nodeRegistry: NodeCapabilityRegistry | undefined;
/** The engineering module's service, assigned in the boot block; `learningService` needs it. */
let engineeringRef: EngineeringService;
/** Phase F: the learning layer is the engineering module's, created on first use. */
function learningService(): LearningService {
  // A clear error rather than a silent `undefined`: this wrapper can only be reached
  // after the module is built, and if that ever stops being true the reason should be
  // legible instead of a property access on nothing.
  if (!engineeringRef) throw new Error("The engineering module is not built yet");
  return engineeringRef.learning();
}
let research: ResearchService | undefined;
let attachmentStore: AttachmentStore | undefined;
let capabilityRegistry: ProviderCapabilityRegistry | undefined;
let githubResolver: GithubResolver | undefined;
let githubMachine: ReturnType<typeof createGitHubMachineRuntime> | undefined;
let externalSessions: ExternalSessionLedger | undefined;
/**
 * Boot modules registered by the composition root, in boot order. Each owns one
 * cohesive slice, receives what it needs as an argument, reports its own health
 * and can be disposed — see electron/bootstrap/boot-module.ts.
 */
const bootModules: Array<BootModule<unknown>> = [];
/** §6: the remembered workspace (canonical validated path, re-validated on read). */
let workspaceSelection: WorkspaceSelectionStore;

const overrideDataRoot = process.argv.find((arg) => arg.startsWith("--boss-data-dir="))?.slice("--boss-data-dir=".length);
const legacyDataRoot = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "CodexBoss") : undefined;
// One root model for the whole process; no subsystem joins its own directory
// onto the install path (electron/runtime-paths.ts).
const roots = runtimeRoots({ installRoot: app.getAppPath(), ...(overrideDataRoot ? { dataRootOverride: overrideDataRoot } : {}) });
const dataRoot = roots.appData;
app.setPath("userData", dataRoot);
app.setPath("sessionData", path.join(dataRoot, "Session Data"));

const ownsInstance = app.requestSingleInstanceLock();
const isSmokeTest = process.argv.includes("--codex-boss-smoke-test");
if (isSmokeTest) app.disableHardwareAcceleration();
/**
 * Bounded desktop WorkBook acceptance (Update-Plan/checkpoint-1.md §4.3).
 *
 * `--boss-workbook-smoke` boots the ordinary app for an EXTERNAL black-box
 * driver (scripts/acceptance-desktop-workbook.cjs talks CDP to this renderer)
 * and changes exactly three things, all of them about the network and the
 * window — never about the WorkBook path:
 *
 *   1. the controller window renders offscreen like `--codex-boss-smoke-test`,
 *      so the same run works on a headless CI runner;
 *   2. no provider is auto-opened and no task is auto-resumed at startup, so
 *      the only provider that exists is the one the driver creates through the
 *      real UI;
 *   3. provider panes open WITHOUT navigating (`--boss-offline-providers`), so
 *      acceptance never contacts a live AI page and never sends a message to
 *      one.
 *
 * Everything the acceptance asserts — intake, classification, the compiled
 * Task Contract, the registry revision, the dispatch boundary and the truthful
 * failure recorded there — is produced by the normal production code below.
 */
const workbookSmoke = process.argv.includes("--boss-workbook-smoke");
/** Offline panes: real WebContentsViews, deliberately never navigated. */
const boundedProviderPane = workbookSmoke || process.argv.includes("--boss-offline-providers");
/** Window rendering mode shared by the smoke entry points (offscreen, hidden). */
const headlessWindow = isSmokeTest || workbookSmoke;
if (workbookSmoke) app.disableHardwareAcceleration();
// Headless live-acceptance mode: boot Boss without the GUI main window, open
// the chosen web providers, run ONE human-defined research autopilot to READY,
// write a result JSON next to the research root, then exit — so E2E-C can be
// driven from the command line without manual GUI steps.
const headlessResearch = process.argv.includes("--research-headless-run");
const headlessWorkspace = (process.argv.find((arg) => arg.startsWith("--research-workspace=")) ?? "").split("=").slice(1).join("=") || undefined;
const headlessProviders = ((process.argv.find((arg) => arg.startsWith("--research-providers=")) ?? "").split("=")[1] ?? "").split(",").map((id) => id.trim()).filter(Boolean);
/**
 * One-shot provider credential import (see the app.whenReady block). The provider id and
 * the environment-variable NAME arrive on the command line; the credential VALUE never
 * does — it is named here and read from this process's own environment below.
 */
const importProviderKey = process.argv.find((arg) => arg.startsWith("--boss-import-provider-key="))?.slice("--boss-import-provider-key=".length);
const importProviderKeySource = process.argv.find((arg) => arg.startsWith("--boss-import-provider-key-source="))?.slice("--boss-import-provider-key-source=".length) ?? "BOSS_IMPORT_PROVIDER_KEY";
const importProviderModel = process.argv.find((arg) => arg.startsWith("--boss-import-provider-model="))?.slice("--boss-import-provider-model=".length);
const importProviderBaseUrl = process.argv.find((arg) => arg.startsWith("--boss-import-provider-base-url="))?.slice("--boss-import-provider-base-url=".length);
const importExit = process.argv.includes("--boss-import-exit");
if (headlessResearch && !headlessWorkspace) { console.error("--research-headless-run requires --research-workspace=<path>"); app.exit(2); }

if (!ownsInstance) {
  app.quit();
}
if (ownsInstance) {
  fs.mkdirSync(dataRoot, { recursive: true });
  if (!overrideDataRoot && legacyDataRoot) {
    migrateLegacyPersistentData(legacyDataRoot, dataRoot, roots.history);
  }
  const cacheRoot = roots.cache;
  const sessionRoot = path.join(cacheRoot, "browser-profile");
  const oldSessionRoot = !overrideDataRoot && legacyDataRoot ? path.join(legacyDataRoot, "Session Data") : app.getPath("sessionData");
  // Migrate only after acquiring the instance lock, before any browser starts.
  migrateBrowserProfile(oldSessionRoot, sessionRoot);
  for (const name of ["tmp", "crash-dumps"]) fs.mkdirSync(path.join(cacheRoot, name), { recursive: true });
  app.setPath("sessionData", sessionRoot);
  app.setPath("temp", roots.temp);
  app.setPath("crashDumps", path.join(cacheRoot, "crash-dumps"));
  process.env.TEMP = process.env.TMP = roots.temp;
}

function publish(): AppSnapshot {
  store.setApiSettings(apiSettings.snapshot(store.snapshot().providers.map((item) => item.id)));
  const snapshot = store.snapshot();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("boss:snapshot-updated", snapshot);
  }
  return snapshot;
}

/** Phase F: the lookup and the concurrency rule are the pool module's (see below). */
function provider(id: ProviderId): Provider {
  return providersRef.provider(id);
}

/**
 * Continuous AI-processor layout monitor: whenever MORE than three web-AI
 * pages are open/selected the workspace switches to the second-window
 * (DETACHED) mode; three or fewer stay in the single-window (MERGED)
 * workspace. Called on every open/close change and on a lightweight periodic
 * tick so selection state is always reflected (idempotent when unchanged).
 *
 * Phase F: the rule itself lives in `electron/bootstrap/providers.ts` with the
 * rest of the pool's policies; these two are the composition root's calls into it.
 */
function autoLayoutForOpenWebProviders(reason: string): void {
  providersRef?.autoLayout(reason);
}
function startAutoLayoutMonitor(): void {
  providersRef?.startLayoutMonitor();
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

/**
 * The lookups the task-input helpers (`electron/tasks/task-inputs.ts`) resolve bound
 * refs through. The attachment store is a getter rather than a captured value: it is
 * attached later in startup, and its absence is meaningful — refs stay unhydrated
 * rather than being dropped.
 */
const INPUT_REFS: InputRefSources = {
  inputObjectsFor: (conversationId) => store.inputObjectsFor(conversationId),
  get attachments() { return attachmentStore; }
};

/** Durable duplicate/resume registry for ingested WorkBooks. */
function workbookRegistry(): WorkbookRegistry {
  return new WorkbookRegistry(path.join(app.getPath("userData"), ".boss", "workbook-registry.json"));
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
  // Bounded acceptance opens the pane but never navigates it: the dispatch
  // boundary is still traversed by the real code and its outcome is recorded
  // truthfully, it just cannot reach a live AI page. The module holds both rules.
  providersRef.openWithinLimit(providerId);
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
  } catch (error) {
    // The completion record is durable task state, not advisory: if it could not
    // be written, that is reported instead of the UI claiming a completion
    // nothing recorded.
    recordAdvisoryFailure(`project-state completion for ${task.id}`, error);
  }
}

/**
 * Records a failure that must not stop the caller but must not disappear either.
 *
 * Kept deliberately small: one line on stderr plus the last few kept in memory,
 * so a damaged state file or a full disk leaves a trace instead of only a
 * missing record.
 */
const advisoryFailures: Array<{ what: string; message: string; at: number }> = [];
function recordAdvisoryFailure(what: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[boss] ${what} failed: ${message}`);
  advisoryFailures.push({ what, message, at: Date.now() });
  if (advisoryFailures.length > 50) advisoryFailures.splice(0, advisoryFailures.length - 50);
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

/** What a finished task owes its own record and the archive policy. Kept here, not in
 * the pool module: it is the task lifecycle, not a provider concern. */
async function onTaskComplete(id: string): Promise<void> {
  if (!store.finalResponseForTask(id)) await commander.finalizeTask(id, publish);
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
  } catch (error) {
    // The external-session ledger row is what makes a later archive pass
    // possible; losing it silently means the conversation is never archived and
    // nothing says so.
    recordAdvisoryFailure(`external-session ledger for ${id}`, error);
  }
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
}

/**
 * Phase F: the pool's objects are `electron/bootstrap/provider-pool.ts`; what stays
 * here is what hangs off them — recovery, the archive pass, the continuation waker
 * and the layout monitor. Attaching is also re-attaching, because the runtime module
 * creates a new window when the platform asks for one.
 */
function attachProviderViews(): void {
  poolRef.attach();
  const attached = poolRef.views();
  if (!attached) throw new Error("Provider pool attached without views");
  // WebRecovery needs the views this attach just built, and — through a thunk — the
  // automation built over them, which is the same cycle the inline version broke the
  // same way: the thunk is only called after both exist.
  recoveryRef = new WebRecovery(store, attached, () => poolRef.automation()!, provider, recoveryScheduler, budgetManager);
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

/**
 * Phase F: the window's lifecycle is `electron/bootstrap/runtime.ts`. What stays
 * here is what the root owns — the Electron constructor it injects, the objects
 * that hang off the window (automation, provider views), and the mirror below.
 *
 * `mainWindow` is that mirror: the module is the only thing that creates a window,
 * and it reports every creation and close back through `onCreated`/`onClosed`, so
 * this binding is a cache of the module's state rather than a second source of
 * truth. `tests/unit/bootstrap-runtime.test.ts` asserts the constructor appears
 * exactly once in this file, which is what keeps that true.
 */
function createMainWindow(): void {
  runtime.service.create();
}

/**
 * Live research stage executor (milestone §7/§15) and the ONE research composition
 * root are `electron/bootstrap/research.ts` (Phase F): the conductor, the live
 * provider with its bounded retries and fail-closed stages, the durable roots and the
 * service cycle that used to be a module-scope binding here. What stays in this file
 * is the headless acceptance entry point below.
 */
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
  const failed: string[] = [];
  for (const run of store.snapshot().runs) {
    if (stuck.has(run.phase)) {
      // A stale run that cannot be released keeps its provider page looking busy,
      // so the failure is collected and surfaced instead of being swallowed by a
      // preflight that then reports success.
      try { store.updateRun(run.id, "failed", null, "headless live preflight: stale run failed to release the provider page"); }
      catch (error) { failed.push(`run ${run.id}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  for (const task of store.snapshot().tasks.filter((item) => item.status === "running" || item.status === "waiting" || item.status === "queued")) {
    try { store.setTaskStatus(task.id, "cancelled"); }
    catch (error) { failed.push(`task ${task.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  // A task left "running" after the preflight is false durable state, so the
  // preflight refuses to look clean when it could not establish the state it
  // exists to establish.
  if (failed.length) throw new Error(`headless preflight could not release ${failed.length} stale record(s): ${failed.slice(0, 5).join("; ")}`);
}

if (ownsInstance) app.whenReady().then(() => {
  // Phase F: every durable store is one boot module built from the data root, so
  // "what does Boss keep, and where" has one answer that can be built and
  // inspected without booting Electron. The Electron-only piece it needs — the
  // platform secure storage — is injected rather than imported.
  const persistence = createPersistenceModule({
    dataRoot: app.getPath("userData"),
    historyRoot: roots.history,
    cacheRoot: roots.cache,
    appPath: fs.realpathSync(app.getAppPath()),
    crypto: {
      encrypt: (plainText) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统安全存储不可用，无法保存 API Key");
        return safeStorage.encryptString(plainText).toString("base64");
      },
      decrypt: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, "base64"))
    }
  });
  bootModules.push(persistence);
  historyRepository = persistence.service.history;
  store = persistence.service.store;
  // The same ledger instance the store was built with: the commander must not
  // build a second one, or their read-modify-write cycles race and fail each
  // other with a spurious "Stale task checkpoint".
  const taskLedger = persistence.service.tasks;
  // WORK_UNIT_3 crash recovery: a revision recorded just before a crash has no
  // task association yet. Re-link every orphan against the durable task records
  // at startup so the revision→task relation is eventually consistent.
  try {
    const recovery = reconcileWorkbookLinks(store, workbookRegistry());
    if (recovery.recovered > 0) console.info(`Recovered ${recovery.recovered} WorkBook revision→task link(s) at startup`);
  } catch (error) { console.error("WorkBook revision recovery failed", error); }
  attachmentStore = persistence.service.attachments;
  capabilityRegistry = persistence.service.capabilities;
  githubResolver = persistence.service.github;
  apiSettings = persistence.service.apiSettings;
  // One-shot credential import, for a machine whose provider key already lives in an
  // environment variable. It exists so the key never has to be transcribed by hand and
  // never has to be written anywhere in the clear: the variable is read IN THIS PROCESS,
  // handed straight to the same ApiSettingsStore the settings UI writes through, and
  // sealed by the same safeStorage backend. What lands on disk is the same ciphertext
  // the UI would have produced — there is no second secret store.
  //
  //   --boss-import-provider-key=<providerId>
  //     reads BOSS_IMPORT_PROVIDER_KEY from the environment; reports only that a
  //     credential was found, never any part of it.
  //
  //   --boss-import-provider-key-source=<ENV_NAME>
  //     names a different environment variable, so a provider whose key is already
  //     exported under its own vendor name needs no copy step. The VALUE is never
  //     passed on a command line, where another process could read it out of the
  //     process table.
  //
  //   --boss-import-provider-model=<modelId> / --boss-import-provider-base-url=<url>
  //     override the provider's stored model / endpoint for this one write.
  //
  //   --boss-import-exit
  //     exit once the import settles, so a machine without a display can run it.
  //
  //   BOSS_IMPORT_PROVIDER_VERIFY=1 (environment)
  //     before exiting, make ONE real request through ProviderApiClient — the same
  //     production client every API runtime dispatches through — and require the
  //     reply to carry the vendor's own token accounting. This is what turns "a
  //     credential was stored" into "the credential authenticates, the endpoint
  //     answers, the model id is accepted, and usage is reported". The reply text
  //     and the credential are both discarded; only counts are printed.
  let importVerification: "not-requested" | "pending" | "verified" | "skipped" = "not-requested";
  if (importProviderKey) {
    try {
      const providerId: ProviderId = importProviderKey;
      const source = process.env[importProviderKeySource];
      if (!source || !source.trim()) {
        console.error(`provider credential import: credential not found in ${importProviderKeySource}`);
        app.exit(1);
      } else {
        const current = apiSettings.snapshot([providerId])[0];
        if (!current) throw new Error(`${providerId} is not a known provider`);
        apiSettings.update({
          providerId,
          enabled: true,
          protocol: current.protocol,
          baseUrl: importProviderBaseUrl ?? current.baseUrl,
          model: importProviderModel ?? current.model,
          apiKey: source.trim()
        });
        // assertReady is the production readiness check — the same one ProviderApiClient
        // calls before its first request. Running it here means a successful import is
        // already known to satisfy it, rather than being asserted to.
        apiSettings.assertReady(providerId);
        console.info(`provider credential import: credential found for ${providerId}, model ${importProviderModel ?? current.model}`);
        importVerification = process.env.BOSS_IMPORT_PROVIDER_VERIFY === "1" ? "pending" : "skipped";
      }
    } catch (error) {
      // Provider ids, field names and library messages only. Never the value.
      console.error(`provider credential import failed: ${error instanceof Error ? error.message : String(error)}`);
      // A hard exit as well as `app.exit`: this entry point is meant to run unattended, and a process
      // that has printed a credential-import failure must not sit alive waiting on a window that a
      // headless machine will never open.
      app.exit(1);
      process.exit(1);
    }
    if (importExit && importVerification !== "pending") app.exit(0);
  }
  sessionLifecycleLedger = persistence.service.sessionLifecycle;
  nodeRegistry = persistence.service.nodeRegistry;
  externalSessions = persistence.service.externalSessions;
  budgetManager = persistence.service.budget;
  humanGuidance = persistence.service.guidance;
  decisionLedger = persistence.service.decisions;
  workspaceSelection = persistence.service.workspaceSelection;
  // Platform foundation Phase 02: the durable state core, and with it the decision-ledger
  // migration. Built here because it needs the ledger the persistence module just made:
  // the state database mirrors that ledger, so it cannot exist before it.
  //
  // It imports the legacy entries, begins shadow comparison and reports DEGRADED with a
  // reason if the database cannot be used — in which case `stateCore.service.ledger` is
  // the legacy store unchanged and nothing about the application's behaviour moves. It
  // does NOT promote itself; authority stays on JSON until the comparison battery has
  // passed and something explicitly promotes, which is the book's gate 6.
  const stateCore = createStateCoreModule({ dataRoot: app.getPath("userData"), legacy: decisionLedger });
  bootModules.push(stateCore);
  // Everything below reads the ledger through the migration routing rather than the store
  // directly, so a production append is what feeds the comparison window.
  const ledger = stateCore.service.ledger;

  // Workspace-rooted and resource state, handed on to the services below exactly
  // as the inline versions were.
  const { workspaces, permissionManifests, experiences, resources: resourceController, contexts: contextManager } = persistence.service;
  // Phase F: the provider-side integration is its own boot module — the API client
  // every API runtime dispatches through, the GitHub machine identity with its
  // degrade-only-GitHub fallback, and the registration of one API runtime per
  // configured provider. The pool, the views and the automation are still the
  // root's and move in their own slice.
  const providers = createProvidersModule({
    userData: app.getPath("userData"),
    store,
    apiSettings,
    crypto: {
      protect: (plainText) => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("platform secure storage unavailable");
        return safeStorage.encryptString(plainText).toString("base64");
      },
      unprotect: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, "base64"))
    },
    // A getter: the views are built around the controller window, which exists
    // later than this module does.
    views: () => providerViews,
    maxActive: MAX_ACTIVE_PROVIDERS,
    navigateOnOpen: !boundedProviderPane
  });
  bootModules.push(providers);
  providersRef = providers.service;
  githubMachine = providers.service.githubMachine;
  providerApi = providers.service.apiClient;
  // The credential-import verification (see the import block above). It runs HERE
  // because this is where the production API client comes into existence, and it runs
  // through that client rather than through a private request of its own — so what it
  // proves is that the ordinary dispatch path can authenticate with the imported
  // credential, not merely that some key was written down.
  if (importVerification === "pending" && importProviderKey) {
    const providerId: ProviderId = importProviderKey;
    // The import block above runs in this same synchronous pass, but the whenReady
    // callback itself is not async — the smoke entry points keep their awaits inside a
    // nested closure — so the one real request is awaited in a closure of its own.
    const verify = async (): Promise<void> => {
      try {
        // Bounded: a provider that accepts the connection and then never answers must not
        // leave an unattended import hanging forever.
        const answer = await Promise.race([
          providerApi.complete(providerId, "Reply with the single word: ok"),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("provider did not answer within 60s")), 60_000))
        ]);
        console.info(`provider credential import: verification reply received (${answer.content.trim().length} chars, usage ${answer.usage ? "present" : "absent"})`);
        if (!answer.content.trim()) throw new Error("provider returned no content");
        const usage = answer.usage;
        if (!usage || typeof usage.inputTokens !== "number" || usage.inputTokens <= 0) {
          throw new Error("provider returned no input token accounting");
        }
        // Counts and booleans only: never the reply, never the credential.
        console.info(
          "provider credential import verified: authenticated true," +
          ` adapter ${answer.adapterVersion}, inputTokens ${usage.inputTokens},` +
          ` outputTokens ${usage.outputTokens ?? "unreported"}, totalTokens ${usage.totalTokens ?? "unreported"}`
        );
        importVerification = "verified";
      } catch (error) {
        // Provider ids, field names and library messages only. Never the value.
        console.error(`provider credential import verification failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      if (importExit) process.exit(importVerification === "verified" ? 0 : 1);
    };
    void verify();
  }
  accountSessions = new AccountSessionManager(store, publish, sessionLifecycleLedger);
  remoteRelay = new RemoteCommandRelay(
    path.join(app.getAppPath(), "scripts", "pc-chat-relay.ps1"),
    (channel, status, message) => { store.setRemoteChannelRuntime(channel, status, message); publish(); },
    (channel, body, sourceWindow) => { if (store.receiveRemoteCommand(channel, body, sourceWindow)) publish(); }
  );
  remoteRelay.sync(store.snapshot().remoteChannels);
  const runtimeRegistry = new RuntimeRegistry();
  // Phase F: the event bus, its recorders and the runtime-resilience services are
  // one boot module — everything that reacts to something which already happened.
  // The composition root keeps the fan-out (`publish`) and the state document it
  // owns and hands them in. The local is `automationModule` because `automation`
  // is the provider-side ProviderAutomation this root also holds.
  const automationModule = createAutomationModule({
    dataRoot: app.getPath("userData"),
    store,
    experiences,
    // The capture the persistence module installed on the task ledger. Handing the SAME instance
    // in means checkpoint evidence and bus evidence land in one window with one set of counters.
    capture: persistence.service.capture,
    publish
  });
  bootModules.push(automationModule);
  // Assigned into the composition root's own bindings rather than destructured:
  // `progressAggregator` and `recoveryScheduler` are module-scope, and a
  // destructuring declaration here would SHADOW them inside this function, so the
  // ones the rest of the file uses would never be assigned.
  const domainEvents = automationModule.service.events;
  domainEventBus = domainEvents;
  progressAggregator = automationModule.service.progress;
  recoveryScheduler = automationModule.service.recovery;
  const circuitBreaker = automationModule.service.circuitBreaker;
  const softwareLeases = automationModule.service.softwareLeases;
  // Milestone §3/§6: ONE research composition root. ResearchService owns the
  // durable ledger, protocol manager, evidence graph, citation store, autopilot
  // supervisor and structured runtime; every boss:research-* IPC handler below
  // forwards to it. Per-store roots keep the pre-migration durable locations
  // (research/<id>.json ledger files, research-protocols/) so existing runs
  // stay recoverable after the composition-root migration.
  const researchModule = createResearchModule({
    dataRoot: app.getPath("userData"),
    store,
    // Lazy: the provider pool is attached later in this block, and a semantic stage
    // that runs without it fails closed with its reason.
    automation: () => poolRef?.automation()
  });
  bootModules.push(researchModule);
  research = researchModule.service.research;
  codexRuntime = new CodexCliRuntime(path.join(app.getPath("userData"), ".codex-boss"));
  runtimeRegistry.register(codexRuntime);
  runtimeRegistry.register(new NativeRuntime(app.getAppPath()));
  providers.service.registerRuntimes(runtimeRegistry);
  // checkpoint-1 §6/§9: the Repository World Model and the UI surface registry
  // are established before any engineering execution — see the knowledge module
  // below, which owns both.
  // Phase F: the knowledge base, the world model, the UI surface registry and the
  // theme engine answer one question between them — what Boss knows about itself
  // and about the repository it is about to work on — so they are one boot
  // module. It receives the state document because the planner's resource
  // observation reads it, and a canonicaliser because it does no filesystem work
  // of its own.
  const knowledge = createKnowledgeModule({
    dataRoot: app.getPath("userData"),
    appPath: app.getAppPath(),
    canonicalize: (root) => fs.realpathSync(root),
    store
  });
  bootModules.push(knowledge);
  const { foundation, themes, uiContracts, establishWorldModel, planContext } = knowledge.service;
  contextManager.setKnowledgeSectionProvider((taskId, role, maxChars) => {
    const task = store.snapshot().tasks.find((item) => item.id === taskId);
    if (!task) return undefined;
    const result = foundation.sectionForTask({
      taskId,
      goal: task.prompt || task.title,
      role,
      scope: foundation.projectScopeFor({ workspacePath: task.workspacePath ?? app.getAppPath() }),
      characterBudget: maxChars,
      maxObjects: 12
    });
    return result.text || undefined;
  });
  // §7.2 — the mandatory Self-Evolution route. It is installed here, in the
  // composition root, so a self-target edit task can never reach the ordinary
  // engineering path: `MainCommander` hands such a task to the coordinator, and
  // the mutation guard refuses any seam that bypasses it.
  // Phase F: the Self-Evolution host and the learning layer are the engineering
  // module's; what stays here is the turn itself, because it dispatches through the
  // commander — built below — and obeys a policy about what a Candidate may be given.
  const engineering = createEngineeringModule({
    appPath: app.getAppPath(),
    userData: app.getPath("userData"),
    rootOwner: SHIPPED_ROOT_OWNER,
    ask: async (role, prompt, session) => {
      // §19 — Self-Evolution is a strict subset of Work capability: it must
      // not inherit arbitrary browser/desktop automation. The turn is pinned
      // to the codex runtime, so a logged-in provider web view can never serve
      // a Candidate's coder or reviewer turn; if codex is unavailable the
      // worker throws and the Candidate fails closed.
      // Update-Plan/cleaning.md §10: the session id is per goal + finding +
      // role, exactly like the interactive engineering loop, so one Candidate's
      // findings never share a codex conversation (and a retry of one finding
      // still reuses its own).
      const result = await commander.dispatchRole(
        engineeringSessionId(session.goalId, session.findingId, role),
        role === "coder" ? "coder" : "reviewer",
        prompt,
        { preferredRuntimes: ["codex"] },
        {},
        ""
      );
      if (result.status !== "SUCCESS" || !result.content) throw new Error(result.failure?.message ?? `Self-evolution ${role} unavailable`);
      return result.content;
    }
  });
  bootModules.push(engineering);
  engineeringRef = engineering.service;
  commander = new MainCommander(store, runtimeRegistry, new Scheduler(), new RoleRouter(runtimeRegistry, budgetManager, resourceController), budgetManager, contextManager, new ExecutionGate(), taskLedger, resourceController, recoveryScheduler, { visionSurface: providerVisionSurface(() => providerViews, path.join(dataRoot, ".boss", "vision")), domPageSurface: providerDomSurface(() => providerViews), readBrowser: async (id) => {
    const view = providerViews.get(provider(id).id);
    if (!view) throw new Error("Provider page is not open");
    return view.webContents.executeJavaScript("JSON.stringify({url:location.href,title:document.title,text:(document.body?.innerText??'').slice(0,30000)})");
  }, permissionForWorkspace: () => permissionManifests.load(workspaces.activeWorkspaceId()) }, circuitBreaker, domainEvents, workspaces, softwareLeases, {
    isSelfTarget: (workspace) => engineering.service.selfEvolution.isSelfTarget(workspace),
    runTask: async (input) => engineering.service.selfEvolution.runTask(input)
  });
  void codexRuntime.detect().then((controller) => { store.setController(controller); publish(); });
  // Phase F: one window, one owner. The module decides the options (offscreen,
  // geometry, preload, load target), when a window may be created, and what the
  // platform's `activate`/`second-instance` mean; the root injects the Electron
  // constructor and tears down what hangs off the window when it closes.
  runtime = createRuntimeModule<BrowserWindow>({
    createWindow: (options) => new BrowserWindow(options),
    preloadPath: path.join(__dirname, "preload.js"),
    rendererFile: path.join(__dirname, "../../dist/index.html"),
    ...(process.env.VITE_DEV_SERVER_URL ? { devServerUrl: process.env.VITE_DEV_SERVER_URL } : {}),
    offscreen: headlessWindow,
    show: !headlessWindow && !headlessResearch,
    // Electron's `app.on` is a set of per-event overloads, so the union this
    // module declares is narrowed here rather than passed through: a union argument
    // resolves to the last overload and does not compile.
    onAppEvent: (event, listener) => {
      if (event === "activate") app.on("activate", listener);
      else app.on("second-instance", listener);
    },
    openWindowCount: () => BrowserWindow.getAllWindows().length,
    onCreated: (window) => { mainWindow = window; },
    onClosed: () => { mainWindow = null; automation?.dispose(); providerViews?.destroyAll(); },
    onActivated: () => attachProviderViews()
  });
  bootModules.push(runtime);
  // Headless mode still creates the (hidden) main window: provider views are
  // attached to it and ProviderAutomation dispatches through those views.
  // Phase F: the pool's objects are their own module, built HERE rather than with the
  // other modules because it captures collaborators that are assigned later in this
  // block (the account sessions, the event bus, the attachment store) — reading them
  // earlier would pass `undefined` and TypeScript cannot flag it, since those bindings
  // are typed without `undefined`. It takes the callbacks that reach outward — the
  // window toggle, the task lifecycle, recovery — and reports each attach back so the
  // root's own bindings stay current.
  const pool = createProviderPoolModule({
    window: () => mainWindow ?? undefined,
    store,
    provider,
    publish,
    accounts: accountSessions,
    api: providerApi,
    onWindowToggle: (id, open) => {
      store.setWindow(id, open);
      publish();
      // Continuous monitoring: opening a 4th (or 5th) AI page immediately pops
      // the processors into the second window; closing back to ≤3 returns MERGED.
      autoLayoutForOpenWebProviders("window-toggle");
    },
    downloadPathFor: (providerId, suggestedName) => historyRepository.generatedFilePath(store.snapshot(), store.snapshot().activeConversationId, providerId, suggestedName),
    onRoundComplete: advanceCouncilRound,
    onTaskComplete,
    onRecovery: (run, strategy, retryAt) => recoveryRef?.defer(run, strategy, retryAt),
    events: domainEventBus,
    attachments: attachmentStore,
    automationOptions: { liveAutomationLog: path.join(app.getPath("userData"), ".boss", "live-automation.log") },
    onAttached: (views, created) => { providerViews = views; automation = created; }
  });
  bootModules.push(pool);
  poolRef = pool.service;
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
      // §6 startup behaviour: a remembered workspace that no longer exists must
      // not be resumed into — Boss parks the task for the Owner instead of
      // mutating a directory that is not there (or silently using another one).
      if (!persistedWorkspaceAvailable(task)) {
        store.setRecoveryState(task.id, undefined, `工作区不可用，已暂停自动恢复：${task.workspacePath}`);
        publish();
        continue;
      }
      try {
        const workspace = availableWorkspace(task, app.getAppPath());
        if (await commander.executeDeterministic(task.id, workspace)) await automation.continueIfReady(task.id);
        else await commander.executePlan(task.id, workspace);
        publish();
      } catch (error) { store.setRecoveryState(task.id, undefined, String(error)); publish(); }
    }
  };
  if (!isSmokeTest && !headlessResearch && !workbookSmoke) {
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

  // Phase F/G: the host/device/learning status channels live in
  // electron/bootstrap/host-status-ipc.ts, with the probe orchestration and the
  // degraded shapes they report. The composition root supplies accessors rather than
  // values, because the node registry and the GitHub machine identity are created
  // later in startup — after this point.
  bootModules.push(createHostStatusIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    host: {
      accounts: () => store.snapshot().accounts.map((account) => ({ providerId: account.providerId, mode: account.mode as import("../src/shared/contracts").ProviderAccountMode | undefined })),
      sessionLifecycles: () => sessionLifecycleLedger?.list() ?? [],
      nodeRegistry: () => nodeRegistry,
      githubMachine: () => githubMachine,
      learning: () => learningService(),
      proxyConfigured: () => Boolean(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY || process.env.http_proxy || process.env.https_proxy)
    }
  }));
  // Phase F/G: the research records and the Owner read-model live in
  // electron/bootstrap/research-owner-ipc.ts. The data root, the optional subsystems
  // and the workspace lookup are all injected, because the module must never import
  // Electron and because the subsystems are composed later in startup.
  bootModules.push(createResearchOwnerIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    owner: {
      dataFile: (...segments) => path.join(app.getPath("userData"), ...segments),
      researchDecisions: (runId) => {
        const record = research?.ledger.load(runId);
        return (record?.decisions ?? []).map((entry) => ({ stepId: entry.stepId, evidenceRefs: entry.evidenceRefs ?? [], decision: entry.decision }));
      },
      resumeResearch: (taskId) => research?.supervisor.resume(taskId),
      interventions: () => humanGuidance?.list() ?? [],
      resolveIntervention: (taskId, kind, answer) => humanGuidance?.resolve(taskId, kind, answer),
      snapshot: () => store.snapshot(),
      decisionLedgerEntries: () => ledger.list(),
      activeWorkspaceId: () => workspaces.activeWorkspaceId(),
      projectState: (target) => openProjectState(target),
      now: () => new Date().toISOString()
    },
    events: { publish: (event) => domainEvents.publish(event) }
  }));

  // Phase F/G: starting a research run and compiling its manuscript live in
  // electron/bootstrap/research-run-ipc.ts. The data root and the research service
  // are injected, because the module must never import Electron.
  bootModules.push(createResearchRunIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    run: {
      startHumanResearch: (input) => research!.startHumanResearch(input),
      start: (ir) => research!.start(ir),
      researchCache: (id) => path.join(app.getPath("userData"), ".boss", "research", id),
      publish: (event) => domainEvents.publish(event)
    }
  }));
  // Creating a task and dispatching one both live under electron/bootstrap/:
  // `boss:create-task` in task-creation-ipc.ts, `boss:dispatch-task` in dispatch-ipc.ts.
  // What stays here is the wiring they share — the pane manager, the GitHub materializer
  // and the WorkBook dispatch services — plus the input helpers in electron/tasks/.
  bootModules.push(createTaskCreationIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    creation: {
      activeConversationId: () => store.snapshot().activeConversationId,
      providerIds: () => store.snapshot().providers.map((item) => item.id),
      inputs: INPUT_REFS,
      createTask: (taskInput) => commander.createTask(taskInput),
      publish: () => publish()
    }
  }));
  // Phase F/G: dispatching a task lives in electron/bootstrap/dispatch-ipc.ts. The
  // module owns the decision order and the branching; this root owns the service
  // bundles it drives, including the WorkBook dispatch's own dependencies.
  // Routed through the migration rather than the store: an automatic Chat→Work approval
  // records its decision durably FIRST, so this is the write that must feed the
  // comparison window and, once promoted, the durable journal.
  bootModules.push(createDispatchIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    dispatch: {
      activeConversationId: () => store.snapshot().activeConversationId,
      providerIds: () => store.snapshot().providers.map((item) => item.id),
      openProviderIds: () => store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id),
      inputs: INPUT_REFS,
      workspaceView: () => providerViews.workspaceView(),
      setWorkspaceView: (view) => providerViews.setWorkspaceView(view),
      materializeGithubInput: (conversationId, prompt) => materializeGithubInput(conversationId, prompt),
      workspacePath: (requested, repositoryLocalPath) => workspaceForRequest({ requested, repositoryLocalPath, fallback: app.getAppPath() }),
      conversationInputObjects: (conversationId) => store.snapshot().conversations.find((item) => item.id === conversationId)?.inputObjects ?? [],
      runWorkbookDispatch: (request) => runWorkDispatch(request, {
        store,
        commander,
        automation,
        publish,
        // checkpoint-1 §5: the finished dispatch records its reusable facts through
        // the knowledge write gate. A knowledge failure is reported, never allowed to
        // fail the task (§2.5).
        knowledge: foundation,
        onKnowledgeDiagnostic: (detail) => console.warn("[knowledge] WorkBook knowledge write degraded", detail),
        worldModel: establishWorldModel,
        planContext
      }),
      workbookRegistry: () => workbookRegistry(),
      createTask: (taskInput) => commander.createTask(taskInput),
      startTask: (taskId) => commander.startTask(taskId),
      executeDeterministic: (taskId, workspace) => commander.executeDeterministic(taskId, workspace),
      executePlan: (taskId, workspace) => commander.executePlan(taskId, workspace),
      dispatchTask: (taskId) => automation.dispatchTask(taskId),
      continueIfReady: (taskId) => automation.continueIfReady(taskId),
      setRecoveryState: (taskId, retryAt, reason) => store.setRecoveryState(taskId, retryAt, reason),
      approveModeTransition: (taskId) => store.approveModeTransition(taskId),
      stageModeTransition: (taskId, transition) => store.stageModeTransition(taskId, transition),
      // Always supplied: the routed ledger falls back to the JSON store when the state
      // core is degraded, so the automatic Chat→Work approval path can rely on it. That
      // path must record the decision before it acts.
      appendDecision: (entry: Parameters<typeof ledger.append>[0]) => { ledger.append(entry); },
      publish: () => publish()
    }
  }));
  // Phase F/G: the task state transitions live in electron/bootstrap/task-state-ipc.ts
  // with the state machine and the shared execution chain. The install root and the
  // pane manager stay here, because both are Electron-facing.
  bootModules.push(createTaskStateIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    state: {
      task: (taskId) => store.snapshot().tasks.find((item) => item.id === taskId),
      openProviderIds: () => store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id),
      setTaskStatus: (taskId, status) => store.setTaskStatus(taskId, status),
      openProvider: (providerId) => openProviderWithinLimit(providerId),
      conversationInputObjects: (conversationId) => store.snapshot().conversations.find((item) => item.id === conversationId)?.inputObjects ?? [],
      workspaceFor: ({ requested, repositoryLocalPath }) => workspaceForRequest({ requested, repositoryLocalPath, fallback: app.getAppPath() }),
      availableWorkspace: (task) => availableWorkspace(task, app.getAppPath()),
      resumeWorkspace: (task) => resumeWorkspaceFor(task, app.getAppPath()),
      approveModeTransition: (taskId) => store.approveModeTransition(taskId),
      declineModeTransition: (taskId) => store.declineModeTransition(taskId),
      ensureUnstartedRuns: (taskId) => store.ensureUnstartedRuns(taskId),
      resumeWorkbook: (task, input) => resumeWorkBookTask(task, input, { store, commander, automation }),
      startTask: (taskId) => commander.startTask(taskId),
      pauseTask: (taskId) => commander.pauseTask(taskId),
      cancelTask: (taskId) => commander.cancelTask(taskId),
      executeDeterministic: (taskId, workspace) => commander.executeDeterministic(taskId, workspace),
      executePlan: (taskId, workspace) => commander.executePlan(taskId, workspace),
      finalizeTask: (taskId) => commander.finalizeTask(taskId, publish),
      dispatchTask: (taskId) => automation.dispatchTask(taskId),
      continueIfReady: (taskId) => automation.continueIfReady(taskId),
      cancelRuns: (taskId) => automation?.cancelRuns(taskId),
      setRecoveryState: (taskId, retryAt, reason) => store.setRecoveryState(taskId, retryAt, reason),
      resumeRecovery: (taskId) => recoveryScheduler.resumeTask(taskId),
      waitingRetryTimes: (taskId) => recoveryScheduler.list().filter((item) => item.taskId === taskId && item.state === "WAITING").map((item) => item.retryAt),
      evidenceBundleAwaitingReview: (taskId) => store.snapshot().evidenceBundles.find((item) => item.taskId === taskId && ["HOLD_FOR_REVIEW", "READY_FOR_USER_REVIEW"].includes(item.decision)),
      setEvidenceDecision: (bundleId, decision) => store.setEvidenceDecision(bundleId, decision),
      hasFinalizationBlocker: (taskId) => Boolean(store.snapshot().tasks.find((item) => item.id === taskId)?.finalizationBlocker),
      publish: () => publish()
    }
  }));
  // Phase F/G: the settings and pane-control channels live in
  // electron/bootstrap/settings-ipc.ts, which owns their validation (unknown
  // provider, unknown workspace view, reloading a pane that is not open) and
  // re-publishes the snapshot after every mutation.
  bootModules.push(createSettingsIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    settings: {
      providerIds: () => store.snapshot().providers.map((item) => item.id),
      updateApiSetting: (input) => apiSettings.update(input),
      updateRemoteChannel: (input) => {
        store.updateRemoteChannel(input.channel, input.enabled, input.commandPrefix);
        remoteRelay.sync(store.snapshot().remoteChannels);
      },
      setRuntimeControl: (runtimeId, enabled, priority) => store.setRuntimeControl(runtimeId, enabled, priority),
      setRoleRoute: (role, runtimeIds, fallback) => store.setRoleRoute(role, runtimeIds, fallback),
      setRemoteCommandStatus: (commandId, status) => store.setRemoteCommandStatus(commandId, status),
      publish: () => publish()
    },
    panes: {
      setWorkspaceView: (view) => providerViews.setWorkspaceView(view),
      workspaceView: () => providerViews.workspaceView(),
      webWindowBounds: () => providerViews.webWindowBounds(),
      setVisible: (visible) => providerViews.setVisible(visible),
      setManualZoom: (providerId, factor) => providerViews.setManualZoom(providerId, factor),
      // The module must not import Electron, so it is handed something it can ask to
      // reload rather than a WebContents.
      pane: (providerId) => {
        const view = providerViews.get(providerId);
        return view ? { reload: () => view.webContents.reload() } : undefined;
      }
    }
  }));
  // Boot modules (convergence book, Phase F/G): the workspace-path, attachment and
  // conversation channels live in electron/bootstrap/*, receive a narrow service
  // surface, and report their own health. Handler bodies here are registration only.
  bootModules.push(createConversationIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    conversations: {
      createFolder: (name) => store.createFolder(name),
      renameFolder: (folderId, name) => store.renameFolder(folderId, name),
      createConversation: (input) => { store.createConversation(input.folderId, input.title); },
      renameConversation: (conversationId, title) => store.renameConversation(conversationId, title),
      moveConversation: (conversationId, folderId) => store.moveConversation(conversationId, folderId),
      selectConversation: (conversationId) => store.selectConversation(conversationId),
      setConversationArchived: (conversationId, archived) => store.setConversationArchived(conversationId, archived),
      duplicateConversation: (conversationId) => store.duplicateConversation(conversationId),
      deleteConversation: (conversationId) => { store.deleteConversation(conversationId); attachmentStore?.removeConversation(conversationId); },
      exportRoot: () => path.join(app.getPath("userData"), "exports"),
      exportConversation: (conversationId, root) => historyRepository.exportConversation(store.snapshot(), conversationId, root),
      revealInFileManager: async (target) => { const { shell } = await import("electron"); shell.showItemInFolder(target); }
    },
    publish
  }));
  bootModules.push(createWorkspaceIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    showOpenDialog: (options) => (mainWindow && !mainWindow.isDestroyed()
      ? dialog.showOpenDialog(mainWindow, options as Electron.OpenDialogOptions)
      : dialog.showOpenDialog(options as Electron.OpenDialogOptions)),
    selection: workspaceSelection
  }));
  bootModules.push(createAttachmentIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    attachments: {
      conversationExists: (conversationId) => store.snapshot().conversations.some((item) => item.id === conversationId),
      importFromPath: (input) => attachmentStore!.importAttachment(input),
      importFromBytes: (input) => attachmentStore!.importAttachment(input),
      registerInputObjects: (conversationId, objects) => store.registerInputObjects(conversationId, objects),
      removeAttachment: (conversationId, inputObjectId) => attachmentStore?.removeAttachment(conversationId, inputObjectId),
      removeInputObject: (conversationId, inputObjectId) => store.removeInputObject(conversationId, inputObjectId),
      localPathFor: (conversationId, inputObjectId) => attachmentStore?.localPathFor(conversationId, inputObjectId)
    },
    publish,
    showOpenDialog: (options) => (mainWindow && !mainWindow.isDestroyed()
      ? dialog.showOpenDialog(mainWindow, options as Electron.OpenDialogOptions)
      : dialog.showOpenDialog(options as Electron.OpenDialogOptions))
  }));
  bootModules.push(createProviderIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    providers: {
      known: () => store.snapshot().providers.map((item) => item.id),
      addCustom: (name, url) => store.addCustomProvider(name, url),
      removeCustom: (providerId) => store.removeCustomProvider(providerId)
    },
    panes: {
      close: (providerId) => providerViews.close(providerId),
      layout: (views) => providerViews.layout(views as Partial<Record<ProviderId, ViewBounds>>)
    },
    openWithinLimit: (providerId) => openProviderWithinLimit(providerId),
    requireProvider: (providerId) => provider(providerId),
    publish
  }));
  bootModules.push(createStatusIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    status: {
      snapshot: () => store.snapshot(),
      progress: () => progressAggregator?.summaries() ?? [],
      activeIntervention: (taskId) => humanGuidance?.activeFor(taskId) ?? undefined,
      listInterventions: (taskId) => humanGuidance?.list(taskId) ?? [],
      workspaceView: () => ({ view: providerViews.workspaceView(), webWindow: providerViews.webWindowBounds() }),
      windowState: () => ({
        view: providerViews.workspaceView(),
        host: windowStateView(() => (mainWindow && !mainWindow.isDestroyed() ? { visible: mainWindow.isVisible(), minimized: mainWindow.isMinimized(), maximized: mainWindow.isMaximized(), focused: mainWindow.isFocused(), bounds: mainWindow.getBounds() } : undefined)),
        webWindow: windowStateView(() => { const window = providerViews.webWindowInstance(); return window && !window.isDestroyed() ? { visible: window.isVisible(), minimized: window.isMinimized(), maximized: window.isMaximized(), focused: window.isFocused(), bounds: window.getBounds() } : undefined; })
      })
    }
  }));
  // U10 §26–§41 (+ Overcomplete §6.1/§6.4): the autonomous engineering surface,
  // including the external web-session archive ledger and its manual retry pass.
  bootModules.push(createEngineeringSurfaceIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    goalStatus: () => commander.engineeringGoalStatus(),
    runGoal: (input) => commander.runEngineeringGoal(input as Parameters<MainCommander["runEngineeringGoal"]>[0]),
    ...(externalSessions ? { externalSessions } : {}),
    runExternalArchive: () => automatePendingExternalArchives(externalSessions!, liveArchiveAttempt(), { limit: 10 })
  }));
  bootModules.push(createResearchIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    ...(research ? { research } : {}),
    ...(humanGuidance ? { guidance: humanGuidance } : {}),
    events: domainEvents
  }));
  reportBootHealth(bootModules);
  // U4 §7/§9: workspace view (MERGED ↔ DETACHED two-window mode). In DETACHED
  // the open web-AI panes move into window B beside the Boss window; provider
  // sessions survive the transition.
  // Phase F/G: the task-lifecycle channels live in
  // electron/bootstrap/task-lifecycle-ipc.ts with the evidence-bundle recovery and
  // the Codex review transitions.
  bootModules.push(createTaskLifecycleIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    tasks: {
      prepareTask: (taskId) => automation.prepareTask(taskId),
      sendTask: (taskId) => automation.sendTask(taskId),
      captureTask: (taskId) => automation.captureTask(taskId),
      continueIfReady: (taskId) => automation.continueIfReady(taskId),
      dispatchTask: (taskId) => automation.dispatchTask(taskId),
      releaseReview: (taskId) => store.releaseReview(taskId),
      task: (taskId) => store.snapshot().tasks.find((item) => item.id === taskId),
      artifacts: () => store.snapshot().artifacts,
      bundle: (taskId) => store.snapshot().evidenceBundles.find((item) => item.taskId === taskId),
      buildEvidence: (task, taskId, previousReview) => {
        const snapshot = store.snapshot();
        const council = snapshot.councils.find((item) => item.taskId === taskId);
        // The builder takes the previous review optionally; only `boss:build-evidence`
        // passes one, which is why the parameter is threaded rather than assumed.
        return previousReview === undefined
          ? buildEvidenceBundle(task, snapshot.artifacts, council)
          : buildEvidenceBundle(task, snapshot.artifacts, council, previousReview as Parameters<typeof buildEvidenceBundle>[3]);
      },
      saveEvidence: (bundle) => store.saveEvidence(bundle),
      addRehydrationRound: (taskId, prompts) => store.addRehydrationRound(taskId, prompts),
      updateCodexReview: (bundleId, patch) => store.updateCodexReview(bundleId, patch),
      observeRuntimeFailure: (runtime, message) => store.observeRuntimeFailure(runtime, message),
      runCodexReview: (bundle, artifacts) => codexRuntime.review(bundle, artifacts),
      publish: () => publish()
    },
    events: { publish: (event) => domainEvents.publish(event) }
  }));
  // Phase F/G: the theme channels live in electron/bootstrap/theme-ipc.ts with the
  // draft/preview orchestration. What stays here is what needs an Electron object or
  // app path: the capture machinery (a BrowserWindow and WebContents), the
  // UI-surface contract table the theme service is also built with, and the capture
  // directory. The module must never import Electron.
  bootModules.push(createThemeIpcModule({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    themes,
    events: { publish: (event) => domainEvents.publish(event) },
    uiContracts,
    capture: async () => {
      const openProviders = store.snapshot().providers.filter((item) => item.windowOpen)
        .map((item) => ({ surface: `AI_PANE_${item.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`, webContents: providerViews.get(item.id)?.webContents }))
        .filter((entry): entry is { surface: string; webContents: import("electron").WebContents } => entry.webContents !== undefined);
      const captures = await captureSurfacesForThemeDesign(
        defaultCaptureTargets({ window: mainWindow ?? undefined, providerViews: openProviders }),
        { directory: path.join(app.getPath("userData"), ".boss", "theme-captures", new Date().toISOString().replace(/[:.]/g, "-")) }
      );
      return {
        frames: captures.frames.map((frame) => ({ surface: frame.surface, file: frame.file, bytes: frame.bytes })),
        skipped: captures.skipped,
        directory: captures.directory,
        summary: summarizeCapture(captures)
      };
    },
    // The module hands over plain fields; narrowing them back to the knowledge
    // service's own payload type is the composition root's job, because it is the
    // root that holds that service.
    recordKnowledge: (input) => {
      recordThemeKnowledge({
        scope: foundation.projectScopeFor({ projectId: "codex-boss-ui" }),
        taskRef: `theme:${input.packageId}`,
        intent: input.intent,
        pkg: input.pkg,
        packageHash: input.packageHash,
        validation: input.validation,
        observedAt: input.observedAt,
        ...(input.feedback ? { feedback: input.feedback } : {}),
        ...(input.captureSummary ? { captureSummary: input.captureSummary } : {}),
        incompatibleSurfaces: []
      } as Parameters<typeof recordThemeKnowledge>[0], foundation);
    },
    persistVisualReport: (report) => {
      // §26 evidence is durable: the numbers that decided are kept next to the theme.
      // If they cannot be written, the report still answers — but the missing evidence
      // is recorded rather than dropped, because the report is what a validation
      // decision is later read back from.
      try {
        writeJson(path.join(app.getPath("userData"), ".boss", "theme-visual-check.json"), report as Parameters<typeof writeJson>[1]);
      } catch (error) {
        recordAdvisoryFailure("theme visual-check evidence", error);
      }
    }
  }));
  // U3 Evidence>Vote (§2.3/§4): when auto-finalization parked a task because
  // its evidence bundle holds DISPUTED/INSUFFICIENT claims or disputes, the
  // operator may explicitly accept the held evidence (records PASS) and then
  // Boss finalizes — never auto-published, never silently dropped.
  // Phase F: `second-instance` and `activate` are registered by the runtime module
  // as it is constructed, because they are the window's lifecycle rather than the
  // application's. `window-all-closed` stays here: it disposes services and decides
  // whether to quit.

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
