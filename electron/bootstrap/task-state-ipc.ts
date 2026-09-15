import type { BootModule, IpcRegistrar } from "./boot-module";
import { MAX_ACTIVE_PROVIDERS } from "../../src/shared/provider-policy";
import type { BossTask, TaskStatus } from "../../src/shared/contracts";

/**
 * Task state transitions (convergence book, Phase F/G).
 *
 * Four channels that change what a task is *doing*: launch it, confirm or decline a
 * Chat→Work upgrade, move it between running/paused/cancelled, and accept held
 * evidence so a parked task can finalize.
 *
 * This is the first slice whose dependency surface is genuinely wide, and that is
 * worth stating plainly rather than hiding behind a facade: driving a task really
 * does touch the store, the commander, the automation loop and the recovery
 * scheduler. What moved is the *state machine* — which branch each transition takes,
 * what is refused, and the order the services are called in — because that is the
 * part that was only testable by booting the application.
 *
 * Two rules the tests pin, both of which were previously only visible by reading:
 *
 *   - **A status is never only a label.** Starting a queued or paused task, or
 *     resuming a waiting WorkBook, re-enters the real execution path; if that throws,
 *     the failure is recorded against the task and re-thrown rather than swallowed.
 *   - **The execution chain has one shape.** `executeDeterministic`, then
 *     `executePlan`, then `dispatchTask`, then `continueIfReady` — written once here
 *     instead of twice, which is what the inline handlers had.
 */

interface TaskStateEventlessSurface {
  /** One task by id, or undefined. */
  task(taskId: string): BossTask | undefined;
  /** Ids of the providers whose panes are currently open. */
  openProviderIds(): string[];
  setTaskStatus(taskId: string, status: TaskStatus): void;
  /** Opens one provider pane; the pane manager enforces its own limit too. */
  openProvider(providerId: string): void;

  /** The bound input objects of a conversation, for the repository lookup. */
  conversationInputObjects(conversationId: string): Array<{ id: string; kind: string; localPath?: string }>;
  /** Resolves a workspace path using the install root the composition root knows. */
  workspaceFor(input: { requested?: string; repositoryLocalPath?: string }): string;
  availableWorkspace(task: BossTask): string;
  resumeWorkspace(task: BossTask): string;

  approveModeTransition(taskId: string): boolean;
  declineModeTransition(taskId: string): boolean;
  ensureUnstartedRuns(taskId: string): void;
  /** Resolves with the workbook dispatch's own result; only its truthiness is read. */
  resumeWorkbook(task: BossTask, input: { workspacePath: string }): Promise<unknown>;

  startTask(taskId: string): void;
  pauseTask(taskId: string): void;
  cancelTask(taskId: string): void;
  /**
   * Both return the execution's own result, which this module only ever asks about
   * by truthiness — typing them as booleans would have been a narrower contract than
   * the commander actually offers.
   */
  executeDeterministic(taskId: string, workspace: string): Promise<unknown>;
  executePlan(taskId: string, workspace: string): Promise<unknown>;
  /** Resolves with the finalization's own answer; this module awaits completion. */
  finalizeTask(taskId: string): Promise<unknown>;

  dispatchTask(taskId: string): Promise<void>;
  continueIfReady(taskId: string): Promise<void>;
  cancelRuns(taskId: string): void;

  setRecoveryState(taskId: string, retryAt: number | undefined, reason: string): void;
  /** How many recovery deadlines were resumed. */
  resumeRecovery(taskId: string): number;
  waitingRetryTimes(taskId: string): number[];

  /** The bundle parked awaiting the Owner's decision, if there is one. */
  evidenceBundleAwaitingReview(taskId: string): { id: string } | undefined;
  setEvidenceDecision(bundleId: string, decision: "PASS"): void;
  hasFinalizationBlocker(taskId: string): boolean;

  /** The snapshot the renderer re-reads after every transition. */
  publish(): unknown;
}

interface TaskStateIpcDeps {
  handle: IpcRegistrar["handle"];
  state: TaskStateEventlessSurface;
}

export const TASK_STATE_IPC_CHANNELS = [
  "boss:launch-task",
  "boss:resolve-mode-proposal",
  "boss:update-task",
  "boss:accept-evidence"
] as const;

/** The statuses a task may be moved to through `boss:update-task`. */
const RESUMABLE_FROM = ["queued", "paused"];

export function createTaskStateIpcModule(deps: TaskStateIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  const requireTask = (taskId: string): BossTask => {
    const task = deps.state.task(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    return task;
  };

  /**
   * The real execution path for a task that is starting or resuming: deterministic
   * orchestration first, then the plan, then the provider-driving automation. A
   * failure is recorded against the task before it is re-thrown, so the recovery
   * surface knows why the task stopped.
   */
  const execute = async (taskId: string, workspace: string): Promise<void> => {
    try {
      if (!await deps.state.executeDeterministic(taskId, workspace) && !await deps.state.executePlan(taskId, workspace)) {
        await deps.state.dispatchTask(taskId);
      }
      await deps.state.continueIfReady(taskId);
    } catch (error) {
      deps.state.setRecoveryState(taskId, undefined, String(error));
      deps.state.publish();
      throw error;
    }
  };

  on("boss:launch-task", (_event, taskId: string) => {
    const task = requireTask(taskId);
    // The limit is checked against what *would* be open, not what is: a task may
    // name providers that are not open yet.
    const current = new Set(deps.state.openProviderIds());
    task.providerIds.forEach((providerId) => current.add(providerId));
    if (current.size > MAX_ACTIVE_PROVIDERS) {
      throw new Error(`当前任务会使已打开页面超过 ${MAX_ACTIVE_PROVIDERS} 个，请先关闭部分页面`);
    }
    task.providerIds.forEach((providerId) => deps.state.openProvider(providerId));
    deps.state.setTaskStatus(taskId, "running");
    return deps.state.publish();
  });

  on("boss:resolve-mode-proposal", async (_event, taskId: string, approveWork: boolean) => {
    const task = requireTask(taskId);
    if (!task.modeTransition || task.interactionMode !== "WORK_PROPOSED") {
      throw new Error("该任务没有待确认的 Work 升级");
    }
    // Inherit message, attachments and conversation; only the single decision differs
    // between Chat and Work. GitHub tasks run against the materialized repo.
    const repoInput = deps.state
      .conversationInputObjects(task.conversationId)
      .find((ref) => task.inputObjectIds?.includes(ref.id) && ref.kind === "REPOSITORY" && ref.localPath);
    const workspace = deps.state.workspaceFor({ requested: task.workspacePath, repositoryLocalPath: repoInput?.localPath });

    if (approveWork) {
      if (!deps.state.approveModeTransition(taskId)) throw new Error("该任务已处理过升级");
      deps.state.startTask(taskId);
      deps.state.publish();
      await execute(taskId, workspace);
      return deps.state.publish();
    }
    if (!deps.state.declineModeTransition(taskId)) throw new Error("该任务已处理过升级");
    deps.state.startTask(taskId);
    deps.state.publish();
    // Declining still runs the task — as Chat, against the provider it already had.
    try {
      await deps.state.dispatchTask(taskId);
    } catch (error) {
      deps.state.setRecoveryState(taskId, undefined, String(error));
      deps.state.publish();
      throw error;
    }
    await deps.state.continueIfReady(taskId);
    return deps.state.publish();
  });

  on("boss:update-task", async (_event, taskId: string, status: TaskStatus) => {
    const before = requireTask(taskId);

    // REPAIR_BATCH_5: resuming a WAITING WorkBook task must re-enter the real
    // provider-driving chain, not merely relabel the task. It reuses the same task id,
    // appends RUNNING after WAITING once, and never re-ingests or re-registers the
    // WorkBook (no second task is created).
    if (status === "running" && before.status === "waiting" && before.workbookDispatch?.auto_run === true) {
      const resumed = await deps.state.resumeWorkbook(before, { workspacePath: deps.state.resumeWorkspace(before) });
      if (resumed) return deps.state.publish();
    }

    if (status === "running") {
      if (RESUMABLE_FROM.includes(before.status)) deps.state.ensureUnstartedRuns(taskId);
      deps.state.startTask(taskId);
    } else if (status === "paused") deps.state.pauseTask(taskId);
    else if (status === "cancelled") deps.state.cancelTask(taskId);
    else deps.state.setTaskStatus(taskId, status);

    if (status === "cancelled") deps.state.cancelRuns(taskId);

    const resumedRecovery = status === "running" ? deps.state.resumeRecovery(taskId) : 0;
    if (resumedRecovery) {
      const deadlines = deps.state.waitingRetryTimes(taskId);
      deps.state.setRecoveryState(taskId, deadlines.length ? Math.min(...deadlines) : undefined, "任务已恢复；按记录的时间恢复原会话");
    } else if (status === "running" && RESUMABLE_FROM.includes(before.status)) {
      // Starting a READY/reference WorkBook or resuming a paused task must enter the
      // real execution path; changing only the visible label would be a false state
      // transition.
      await execute(taskId, deps.state.availableWorkspace(before));
    }

    if (status === "running" && deps.state.hasFinalizationBlocker(taskId)) await deps.state.finalizeTask(taskId);
    return deps.state.publish();
  });

  // Evidence outranks a vote: when auto-finalization parked a task because its
  // evidence bundle holds DISPUTED/INSUFFICIENT claims or disputes, the operator may
  // explicitly accept the held evidence (records PASS) and then Boss finalizes —
  // never auto-published, never silently dropped.
  on("boss:accept-evidence", async (_event, taskId: string) => {
    requireTask(taskId);
    const bundle = deps.state.evidenceBundleAwaitingReview(taskId);
    if (!bundle) throw new Error("当前任务没有待接收的未决证据包");
    deps.state.setEvidenceDecision(bundle.id, "PASS");
    await deps.state.finalizeTask(taskId);
    return deps.state.publish();
  });

  return {
    service: { channels: TASK_STATE_IPC_CHANNELS },
    health: () => ({
      module: "task-state-ipc",
      status: registered.length === TASK_STATE_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${TASK_STATE_IPC_CHANNELS.length} task-state channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
