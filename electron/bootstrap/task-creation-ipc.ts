import type { BootModule, IpcRegistrar } from "./boot-module";
import { requireProvider } from "./settings-ipc";
import { taskTransports, titleForTask, workbookAttachments, type InputRefSources } from "../tasks/task-inputs";
import { assertPrimaryInput } from "../commander/workbook-dispatch";
import { MAX_ACTIVE_PROVIDERS } from "../../src/shared/provider-policy";
import type { MainCommander } from "../commander/main-commander";
import type { CreateTaskInput, ProviderId } from "../../src/shared/contracts";

/**
 * Creating a task.
 *
 * One channel — `boss:create-task` — and it is the whole of "make a task that has not
 * started yet". Its sibling `boss:dispatch-task` creates *and immediately drives* a
 * task, and lives in `electron/bootstrap/dispatch-ipc.ts`: it needs the pane manager,
 * the GitHub materializer and the WorkBook dispatch services at once, which is why it
 * moved after this slice rather than with it. The helpers both of them use live in
 * `electron/tasks/task-inputs.ts`, so neither slice carries them.
 *
 * What this slice owns is the **refusal order**, which is the part that was only
 * visible by reading the composition root:
 *
 *   1. an empty task with no attachment and no repository is refused;
 *   2. a task with no provider is refused, and so is one over the concurrency ceiling;
 *   3. an unknown provider is refused by name;
 *   4. an invalid transport is refused (in `taskTransports`);
 *   5. and only then is a Chat task with no text refused, because the message it would
 *      tell the user is the least useful of the five.
 */

/** What creating a task needs from the composition root. */
interface TaskCreationSurface {
  /** The conversation a task belongs to when the renderer did not name one. */
  activeConversationId(): string;
  /** Every known provider id, so an unknown one is refused here. */
  providerIds(): readonly string[];
  /** The store/attachment lookups the input helpers resolve refs through. */
  inputs: InputRefSources;
  /** Creates the task; the commander owns what a task is. */
  createTask(input: Parameters<MainCommander["createTask"]>[0]): unknown;
  /** The snapshot the renderer re-reads. */
  publish(): unknown;
}

interface TaskCreationIpcDeps {
  handle: IpcRegistrar["handle"];
  creation: TaskCreationSurface;
}

export const TASK_CREATION_IPC_CHANNELS = [
  "boss:create-task"
] as const;

export function createTaskCreationIpcModule(deps: TaskCreationIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:create-task", (_event, input: CreateTaskInput) => {
    // WORK_UNIT_2: text OR a bound attachment OR a repository is enough; an empty text
    // with no inputs is still a clear error.
    const conversationId = input.conversationId ?? deps.creation.activeConversationId();
    const attachments = workbookAttachments(deps.creation.inputs, input, conversationId);
    assertPrimaryInput(input.prompt ?? "", attachments);

    const providerIds = [...new Set(input.providerIds)] as ProviderId[];
    if (providerIds.length === 0) throw new Error("At least one provider is required");
    if (providerIds.length > MAX_ACTIVE_PROVIDERS) throw new Error(`最多同时选择 ${MAX_ACTIVE_PROVIDERS} 个网页 AI`);
    for (const providerId of providerIds) requireProvider(deps.creation.providerIds(), providerId);

    const { appMode, transports } = taskTransports(input, providerIds);
    if (appMode === "chat" && !(input.prompt ?? "").trim()) {
      throw new Error("Chat 模式需要任务文字；仅附件任务请使用 Work 模式");
    }

    const title = titleForTask(input, attachments);
    const objective = (input.prompt ?? "").trim() || `Prepare task from attached input: ${attachments.map((ref) => ref.originalName ?? ref.id).join(", ")}`;
    deps.creation.createTask({
      title,
      objective,
      providerIds,
      mode: input.mode ?? "direct",
      appMode,
      transports,
      conversationId,
      reviewPolicy: input.reviewPolicy,
      finalizationPolicy: input.finalizationPolicy,
      inputObjectIds: input.inputObjectIds,
      workAgentCount: input.workAgentCount,
      runMode: input.runMode,
      conversationPolicy: input.conversationPolicy
    });
    return deps.creation.publish();
  });

  return {
    service: { channels: TASK_CREATION_IPC_CHANNELS },
    health: () => ({
      module: "task-creation-ipc",
      status: registered.length === TASK_CREATION_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${TASK_CREATION_IPC_CHANNELS.length} task-creation channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
