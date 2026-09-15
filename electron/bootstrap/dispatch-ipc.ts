import type { BootModule, IpcRegistrar } from "./boot-module";
import { requireProvider } from "./settings-ipc";
import { taskTransports, titleForTask, workbookAttachments, type InputRefSources } from "../tasks/task-inputs";
import { runWorkDispatch } from "../commander/workbook-production";
import { assertPrimaryInput, shouldRunWorkBookIntake } from "../commander/workbook-dispatch";
import { assertDispatchGroupSize } from "../commander/provider-dispatch-guard";
import { decideEscalation, detectCapabilityNeeds, type ModeTransition } from "../../src/shared/capability-needs";
import { effectiveRunMode, runTaskKindFor, workEscalationVerdict } from "../../src/shared/owner-result";
import type { MainCommander } from "../commander/main-commander";
import type { DecisionLedgerStore } from "../commander/decision-ledger-store";
import type { CreateTaskInput, ProviderId } from "../../src/shared/contracts";
import type { InputObjectKind, InputObjectRef } from "../../src/shared/input-object";

/**
 * Dispatching a task (convergence book, Phase F/G).
 *
 * The last channel to leave `main.ts`, and the one that most needed to. `dispatch-task`
 * is "create work and start driving it", so it touches nearly everything: the pane
 * manager (an advisory layout decision), the GitHub materializer, the WorkBook
 * dispatch services, the decision ledger, and the commander's execution chain.
 *
 * The split keeps each half where it belongs:
 *
 *   - **The module owns the decision order and the branching.** Which checks happen
 *     before anything is created, when the WorkBook branch takes over, and when a Chat
 *     request is intercepted and proposed as Work instead of being fired blindly.
 *   - **The composition root owns the service bundles.** `runWorkDispatch`'s
 *     dependencies (the store, commander, automation, the knowledge gate, the world
 *     model and the plan context) are the root's to assemble; the module builds the
 *     *request*, which is the part that is a decision.
 *
 * Three rules the tests pin, all previously readable only in the root:
 *
 *   1. **Nothing is created until every refusal has passed** — the group-size guard,
 *      an unknown provider, and the requirement that the chosen providers are already
 *      open.
 *   2. **The auto layout is advisory.** A pane-layout failure is logged and dispatch
 *      continues; it can never block work.
 *   3. **An auto-approved Chat→Work escalation records the decision before it runs.**
 *      The ledger entry is written first, so the interception is auditable even if the
 *      execution then fails.
 */

/**
 * The decision to escalate a Chat task to Work. Derived from `decideEscalation` rather
 * than re-declared: an earlier hand-written version made `requiredCapabilities`
 * optional, which is looser than the decision actually is and broke the staged
 * transition that consumes it.
 */
export type EscalationDecision = ReturnType<typeof decideEscalation>;

type CreatedTask = ReturnType<MainCommander["createTask"]>;
type DispatchRequest = Parameters<typeof runWorkDispatch>[0];
type DecisionEntry = Parameters<DecisionLedgerStore["append"]>[0];

interface DispatchSurface {
  /** The conversation a task belongs to when the renderer did not name one. */
  activeConversationId(): string;
  /** Every known provider id, so an unknown one is refused here. */
  providerIds(): readonly string[];
  /** Ids of the providers whose panes are currently open. */
  openProviderIds(): string[];
  /** The store/attachment lookups the input helpers resolve refs through. */
  inputs: InputRefSources;

  /** The pane manager's current layout, and the advisory request to change it. */
  workspaceView(): unknown;
  setWorkspaceView(view: "MERGED" | "DETACHED"): void;

  /** Materializes a GitHub URL from the message into a bound input object. */
  materializeGithubInput(conversationId: string, prompt: string): Promise<InputObjectRef | undefined>;
  /** Resolves the workspace for a request using the install root the root knows. */
  workspacePath(requested: string | undefined, repositoryLocalPath: string | undefined): string;
  /** The conversation's bound input objects, for the escalation decision. */
  conversationInputObjects(conversationId: string): Array<{ id: string; kind?: InputObjectKind }>;

  /** The single WorkBook production entry point, with the root's service bundle. */
  runWorkbookDispatch(request: DispatchRequest): Promise<unknown>;
  /** The durable duplicate/resume registry the WorkBook intake reads. */
  workbookRegistry(): DispatchRequest["registry"];

  createTask(input: Parameters<MainCommander["createTask"]>[0]): CreatedTask;
  startTask(taskId: string): void;
  executeDeterministic(taskId: string, workspace: string): Promise<unknown>;
  executePlan(taskId: string, workspace: string): Promise<unknown>;
  dispatchTask(taskId: string): Promise<void>;
  continueIfReady(taskId: string): Promise<void>;
  setRecoveryState(taskId: string, retryAt: number | undefined, reason: string): void;

  approveModeTransition(taskId: string): boolean;
  stageModeTransition(taskId: string, transition: ModeTransition): void;
  /** Appends to the decision ledger; absent when no ledger is composed. */
  appendDecision?(entry: DecisionEntry): void;

  publish(): unknown;
}

interface DispatchIpcDeps {
  handle: IpcRegistrar["handle"];
  dispatch: DispatchSurface;
}

export const DISPATCH_IPC_CHANNELS = [
  "boss:dispatch-task"
] as const;

/** Phase E: deterministic Chat→Work detection for a task (message + bound inputs). */
export function escalateDecisionFor(
  task: { conversationId: string; prompt: string; inputObjectIds?: string[] },
  conversationInputObjects: Array<{ id: string; kind?: InputObjectKind }>
): EscalationDecision {
  const inputKinds = (task.inputObjectIds ?? [])
    .map((id) => conversationInputObjects.find((ref) => ref.id === id)?.kind)
    .filter((kind): kind is InputObjectKind => kind !== undefined);
  return decideEscalation(detectCapabilityNeeds({ message: task.prompt, inputKinds }));
}

export function createDispatchIpcModule(deps: DispatchIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:dispatch-task", async (_event, input: CreateTaskInput) => {
    const dispatch = deps.dispatch;
    const providerIds = [...new Set(input.providerIds)] as ProviderId[];
    const requestedConversationId = input.conversationId ?? dispatch.activeConversationId();
    const preAttachments = workbookAttachments(dispatch.inputs, input, requestedConversationId);
    assertPrimaryInput(input.prompt ?? "", preAttachments);
    assertDispatchGroupSize(input.prompt ?? "", "", providerIds.length);
    for (const providerId of providerIds) requireProvider(dispatch.providerIds(), providerId);
    // Every chosen pane must already be open: dispatch drives real pages, and opening
    // them as a side effect of dispatching would spend the concurrency budget silently.
    const openIds = new Set(dispatch.openProviderIds());
    if (providerIds.some((id) => !openIds.has(id))) throw new Error("所选 AI 必须全部处于已打开状态");

    const { appMode, transports } = taskTransports(input, providerIds);
    if (appMode === "chat" && !(input.prompt ?? "").trim()) {
      throw new Error("Chat 模式需要任务文字；仅附件任务请使用 Work 模式");
    }

    // Auto workspace layout (Overcomplete live): a dispatch to MORE than three web AI
    // pages pops the processors into the second (DETACHED) window so five pages don't
    // crowd the controller; three or fewer stay merged in the single-window workspace.
    try {
      const webCount = providerIds.filter((id) => (transports[id] ?? "web") === "web").length;
      const wanted = webCount > 3 ? "DETACHED" : "MERGED";
      if (dispatch.workspaceView() !== wanted) dispatch.setWorkspaceView(wanted);
    } catch (error) {
      // Layout is advisory; never block dispatch.
      console.error("Auto workspace layout failed", error);
    }

    const conversationId = input.conversationId ?? dispatch.activeConversationId();
    // Phase F: a GitHub URL in the message is an input object, not prose — materialize
    // once and bind it so WORK can scan real code.
    const githubInput = await dispatch.materializeGithubInput(conversationId, input.prompt ?? "");
    const inputObjectIds = [...new Set([...(input.inputObjectIds ?? []), ...(githubInput ? [githubInput.id] : [])])];
    const attachments = workbookAttachments(dispatch.inputs, input, conversationId, githubInput ? [githubInput.id] : []);
    const workspace = dispatch.workspacePath(input.workspacePath, githubInput?.localPath);

    // WORK_UNIT_3 / REPAIR_BATCH_4: the WorkBook branch DELEGATES to the single
    // production entry point. The old inline chain (intake -> createTask -> link
    // revisions -> start/dispatch) lived here and is deleted; tests exercise the same
    // runWorkDispatch the IPC handler calls.
    if (shouldRunWorkBookIntake(appMode, attachments)) {
      const outcome = await dispatch.runWorkbookDispatch({
        prompt: input.prompt ?? "",
        title: input.title ?? "",
        conversationId,
        providerIds,
        attachments,
        inputObjectIds: inputObjectIds.length ? inputObjectIds : undefined,
        workspacePath: workspace,
        mode: input.mode ?? "direct",
        appMode,
        transports,
        registry: dispatch.workbookRegistry(),
        reviewPolicy: input.reviewPolicy,
        finalizationPolicy: input.finalizationPolicy,
        workAgentCount: input.workAgentCount,
        runMode: input.runMode,
        conversationPolicy: input.conversationPolicy
      });
      // Every outcome maps to the snapshot the caller receives; the durable state was
      // already written by the orchestration.
      void outcome;
      return dispatch.publish();
    }

    const task = dispatch.createTask({
      title: titleForTask(input, attachments),
      objective: (input.prompt ?? "").trim(),
      providerIds,
      mode: input.mode ?? "direct",
      appMode,
      transports,
      conversationId,
      reviewPolicy: input.reviewPolicy,
      finalizationPolicy: input.finalizationPolicy,
      inputObjectIds: inputObjectIds.length ? inputObjectIds : undefined,
      workAgentCount: input.workAgentCount,
      runMode: input.runMode,
      conversationPolicy: input.conversationPolicy
    });

    // Phase E: Chat is the default entry. When a chat request actually needs WORK
    // capability, propose once instead of firing web providers blindly.
    const decision = escalateDecisionFor(task, dispatch.conversationInputObjects(task.conversationId));
    if (appMode === "chat" && decision.escalate) {
      // §18 task-level interception (Owner-Result Rev.2): a Chat→WORK capability
      // proposal is a DECIDABLE capability-routing question. Under OWNER_RESULT it is
      // auto-approved — recorded durably in the decision ledger FIRST — and the task
      // runs immediately (checkpointBudget=0: no routine pause). ASSISTED/AUTONOMOUS
      // (and any HARD_BLOCKER text) keep the human gate.
      const mode = effectiveRunMode({ runMode: task.runMode, kind: runTaskKindFor(task.appMode, task.mode) });
      const verdict = workEscalationVerdict(mode, decision.reason ?? "任务需要进入 Work", decision.requiredCapabilities?.join("、"));
      if (verdict.action === "AUTO_APPROVE" && verdict.decision && dispatch.appendDecision) {
        dispatch.appendDecision({
          id: `dec-${task.id}-escalate-work`, taskId: task.id, createdAt: new Date().toISOString(),
          question: `Chat 任务需要 WORK 能力，是否升级？（${decision.reason ?? ""}）`,
          candidates: ["保持 Chat（能力不足）", "升级到 WORK（自动批准）"],
          chosen: verdict.decision.chosen,
          evidence: [`requiredCapabilities: ${(decision.requiredCapabilities ?? []).join(", ")}`],
          outcome: "APPLIED", policy: verdict.decision.policy, source: "question-interceptor"
        });
        if (dispatch.approveModeTransition(task.id)) {
          dispatch.startTask(task.id);
          dispatch.publish();
          await runExecution(dispatch, task.id, workspace);
          return dispatch.publish();
        }
        // Raced: another path already drives this task.
        return dispatch.publish();
      }
      dispatch.stageModeTransition(task.id, { from: "CHAT", to: "WORK", reason: decision.reason ?? "任务需要进入 Work", requiredCapabilities: decision.requiredCapabilities });
      return dispatch.publish();
    }

    dispatch.startTask(task.id);
    dispatch.publish();
    await runExecution(dispatch, task.id, workspace);
    return dispatch.publish();
  });

  return {
    service: { channels: DISPATCH_IPC_CHANNELS },
    health: () => ({
      module: "dispatch-ipc",
      status: registered.length === DISPATCH_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${DISPATCH_IPC_CHANNELS.length} dispatch channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}

/**
 * The execution chain for a task that has just been created or approved:
 * deterministic orchestration, then the plan, then the provider-driving automation.
 * A failure is recorded against the task before it is re-thrown.
 */
async function runExecution(dispatch: DispatchSurface, taskId: string, workspace: string): Promise<void> {
  try {
    if (!await dispatch.executeDeterministic(taskId, workspace) && !await dispatch.executePlan(taskId, workspace)) {
      await dispatch.dispatchTask(taskId);
    }
    await dispatch.continueIfReady(taskId);
  } catch (error) {
    dispatch.setRecoveryState(taskId, undefined, String(error));
    dispatch.publish();
    throw error;
  }
}
