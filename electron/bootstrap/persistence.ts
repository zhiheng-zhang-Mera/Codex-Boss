import path from "node:path";
import type { BootModule } from "./boot-module";
import { HistoryRepository } from "../history-repository";
import { StateStore } from "../store";
import { ApiSettingsStore } from "../api-settings";
import { TaskLedger } from "../commander/task-ledger";
import { BudgetManager } from "../commander/budget-manager";
import { ContextManager } from "../commander/context-manager";
import { ResourceController } from "../commander/resource-controller";
import { DecisionLedgerStore } from "../commander/decision-ledger-store";
import { HumanGuidanceGate } from "../commander/human-guidance-gate";
import { AttachmentStore } from "../input/attachment-store";
import { ProviderCapabilityRegistry } from "../input/provider-capability-registry";
import { GithubResolver } from "../input/github-resolver";
import { SessionLifecycleLedger } from "../identity/session-lifecycle-ledger";
import { NodeCapabilityRegistry } from "../node/node-capability-registry";
import { ExternalSessionLedger } from "../workspace/external-session-ledger";
import { WorkspaceRegistry } from "../workspace/workspace-registry";
import { WorkspaceSelectionStore } from "../workspace/workspace-selection";
import { durableFileFor } from "../workspace/durable-roots";
import { PermissionManifestStore } from "../security/permission-manifest";
import { ProjectStateStore } from "../project/project-state";
import { ExperienceStore } from "../experience/experience-store";
import { RuntimeIntelligenceCapture, createCaptureObservingLedger } from "../runtime-intelligence/live-capture";
import { DEFAULT_WORKSPACE_ID } from "../../src/shared/workspace";

// ---------------------------------------------------------------------------------------------
// S2 NEGATIVE CONTROL -- STAGE C EXPERIMENT. NOT FOR MERGE.
//
// This single line injects exactly ONE undeclared cross-capability edge: `persistence`, a KERNEL, now
// imports `theme-ipc`, owned by the `theme` FEATURE, and no manifest declares that relation (the
// declared capability pairs are knowledge -> persistence, research -> knowledge, theme -> knowledge).
// The enforcement engine is required to reject it with NEW_UNDECLARED_CROSS_CAPABILITY_EDGE in enforce
// mode, while shadow mode reports the same finding identity and passes the process. The commit that
// contains this line is preserved by the annotated tag city-evidence-s2-negative-control-v1.
// ---------------------------------------------------------------------------------------------
import "./theme-ipc";

/**
 * The durable stores (convergence book, Phase F).
 *
 * The composition root used to build every store inline in one long boot
 * sequence, which made the *shape* of durable state invisible: there was no
 * single place that answered "what does Boss keep, and where", no way to build
 * that set without booting Electron, and no health line if half of it failed to
 * open.
 *
 * This module is that place. It receives the data root, the canonical
 * application path and the platform crypto callbacks — everything else it needs
 * is a path it derives from the root — and returns the stores as one service.
 * It deliberately does not import Electron, does no filesystem work of its own,
 * and never decides what a store *means*: `electron/store.ts` and its neighbours
 * own their own durability.
 *
 * Two ordering facts are load-bearing and are preserved from the inline version:
 *
 *  - the `TaskLedger` is built once and shared with the `StateStore`, because the
 *    store and the commander must read-modify-write through the same ledger or
 *    their cycles race and fail each other with a spurious "Stale task
 *    checkpoint";
 *  - the workspace-scoped stores are rooted at the **active** workspace, so the
 *    Root Memory of `durableFileFor` is asked for that id here rather than in
 *    each caller.
 */

/** Platform secure storage, injected so this module never imports Electron. */
export interface PersistenceCrypto {
  /** Protects a secret for durable storage; throws when the platform store is unavailable. */
  encrypt(plainText: string): string;
  /** Reverses `encrypt` for a value read back from durable storage. */
  decrypt(cipherText: string): string;
}

interface PersistenceOptions {
  /** The resolved data root — `app.getPath("userData")` in production. */
  dataRoot: string;
  /** Where the durable history repository lives (`runtimeRoots(...).history`). */
  historyRoot: string;
  /**
   * The disposable cache root (`runtimeRoots(...).cache`). Passed in rather than
   * derived here so the directory names stay in `electron/runtime-paths.ts`, which
   * is the one module allowed to spell them.
   */
  cacheRoot: string;
  /** The canonical application path, used to keep the workspace shims pointing at this install. */
  appPath: string;
  crypto: PersistenceCrypto;
}

interface PersistenceService {
  /** Every completed task, append-only. */
  history: HistoryRepository;
  /** The one task ledger the store and the commander share. */
  tasks: TaskLedger;
  /** The live shadow capture observing the ledger's write path. Observe-only; see the module. */
  capture: RuntimeIntelligenceCapture;
  /** The application state document. */
  store: StateStore;
  attachments: AttachmentStore;
  capabilities: ProviderCapabilityRegistry;
  github: GithubResolver;
  apiSettings: ApiSettingsStore;
  sessionLifecycle: SessionLifecycleLedger;
  nodeRegistry: NodeCapabilityRegistry;
  externalSessions: ExternalSessionLedger;
  budget: BudgetManager;
  guidance: HumanGuidanceGate;
  decisions: DecisionLedgerStore;
  workspaces: WorkspaceRegistry;
  workspaceSelection: WorkspaceSelectionStore;
  /** Workspace-scoped stores, rooted at the active workspace. */
  permissionManifests: PermissionManifestStore;
  projectStates: ProjectStateStore;
  experiences: ExperienceStore;
  /** Runtime admission: what may run right now, and against which resources. */
  resources: ResourceController;
  contexts: ContextManager;
  /** The counter names this module opened, for the boot health line. */
  opened: readonly string[];
}

export function createPersistenceModule(options: PersistenceOptions): BootModule<PersistenceService> {
  const { dataRoot, historyRoot, cacheRoot, appPath, crypto } = options;
  const boss = (...parts: string[]) => path.join(dataRoot, ".boss", ...parts);
  const opened: string[] = [];
  const open = <T>(name: string, build: () => T): T => {
    const value = build();
    opened.push(name);
    return value;
  };

  const history = open("history", () => new HistoryRepository(historyRoot));
  // The runtime-intelligence capture observes the task ledger's write path. It is a pure bypass:
  // it is handed the record that was already written and returns nothing the ledger reads, and
  // every one of its own methods catches everything, so a capture failure cannot fail a task.
  // The two resolvers read the store's own task record, which is what decides whether a task is
  // prospective evidence and when a window may close — neither answer is guessed here.
  const capture = new RuntimeIntelligenceCapture({
    dataRoot,
    openedAt: (taskId) => store.snapshot().tasks.find((task) => task.id === taskId)?.createdAt,
    taskStatus: (taskId) => store.snapshot().tasks.find((task) => task.id === taskId)?.status
  });
  const tasks = open("tasks", () => createCaptureObservingLedger({ root: boss("tasks"), capture }));
  const store = open("state", () => new StateStore(path.join(dataRoot, "state.json"), history, tasks));
  const attachments = open("attachments", () => new AttachmentStore(boss("attachments")));
  const capabilities = open("provider-capabilities", () => new ProviderCapabilityRegistry(boss("provider-capabilities.json")));
  // The repository cache is a cache, not durable state, so it sits under the cache
  // root rather than under the data root.
  const github = open("github-cache", () => new GithubResolver(path.join(cacheRoot, "repos")));
  const apiSettings = open("api-settings", () => new ApiSettingsStore(path.join(dataRoot, "api-settings.json"), crypto.encrypt, crypto.decrypt));
  // `publish()` re-derives this on every snapshot; deriving it once here as well
  // means the very first read already carries the settings the store holds.
  store.setApiSettings(apiSettings.snapshot(store.snapshot().providers.map((item) => item.id)));
  const sessionLifecycle = open("session-lifecycle", () => new SessionLifecycleLedger(boss("session-lifecycle.json")));
  const nodeRegistry = open("node-registry", () => new NodeCapabilityRegistry(boss("node-registry.json")));
  const externalSessions = open("external-sessions", () => new ExternalSessionLedger(boss("external-sessions.json")));
  const budget = open("runtime-budget", () => new BudgetManager(boss("runtime-budget.json")));
  const guidance = open("interventions", () => new HumanGuidanceGate(boss("interventions.json")));
  const decisions = open("decision-ledger", () => new DecisionLedgerStore(boss("decision-ledger.json")));
  const workspaces = open("workspaces", () => new WorkspaceRegistry(boss("workspaces.json")));
  // The shims live in the workspace, not in the data root: they are generated
  // entry points that point back at THIS install, so a moved install must
  // regenerate them.
  workspaces.ensureShims(appPath);
  const workspaceSelection = open("workspace-selection", () => new WorkspaceSelectionStore(boss("workspace-selection.json")));
  // Read once, at boot: the workspace-scoped stores below are rooted here, and the
  // registry always answers with SOMETHING (a missing file reads as the default
  // shim), so this value — not a later `setActive` — is what they are rooted at.
  const workspaceRoot = workspaces.activeWorkspaceId();
  const atDefaultWorkspace = workspaceRoot === DEFAULT_WORKSPACE_ID;
  const permissionManifests = open("permission-manifest", () => new PermissionManifestStore(durableFileFor(dataRoot, workspaceRoot, path.join(".boss", "permission-manifest.json"))));
  const projectStates = open("project-state", () => new ProjectStateStore(durableFileFor(dataRoot, workspaceRoot, path.join(".boss", "project-state.json"))));
  const experiences = open("experience", () => new ExperienceStore(durableFileFor(dataRoot, workspaceRoot, path.join(".boss", "experience.json"))));
  const resources = open("runtime-resources", () => new ResourceController(boss("runtime-resources.json")));
  const contexts = open("task-contexts", () => new ContextManager(path.join(dataRoot, "task-contexts.json")));
  // Contexts are retained, never created here: a task that no longer exists must
  // not keep its context alive across a restart.
  contexts.retainTaskIds(store.snapshot().tasks.map((task) => task.id));

  let disposed = false;
  return {
    service: {
      history, tasks, store, capture, attachments, capabilities, github, apiSettings,
      sessionLifecycle, nodeRegistry, externalSessions, budget, guidance, decisions,
      workspaces, workspaceSelection, permissionManifests, projectStates, experiences,
      resources, contexts,
      opened
    },
    health: () => ({
      module: "persistence",
      // Not a completeness check — every store either opened or the boot failed —
      // but the one state an operator has to be told about: without a selected
      // workspace the workspace-scoped stores live in the default shim, so work
      // recorded there is not attached to any real workspace.
      status: atDefaultWorkspace ? "DEGRADED" : "READY",
      detail: `${opened.length} durable store(s) under ${dataRoot}; workspace-scoped state rooted at ${atDefaultWorkspace ? "the default shim (no workspace selected at boot)" : workspaceRoot}${disposed ? "; disposed" : ""}`
    }),
    // Every store here is file-backed and holds no OS handle: a read re-reads and
    // a write is atomic, so there is nothing to flush. Disposal is therefore a
    // state change the composition root can rely on rather than a resource
    // release, and it is idempotent.
    dispose: () => { disposed = true; }
  };
}
