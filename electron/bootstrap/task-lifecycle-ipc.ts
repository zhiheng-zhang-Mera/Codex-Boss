import type { BootModule, IpcRegistrar } from "./boot-module";
import { buildRehydrationPrompts, type buildEvidenceBundle } from "../evidence-engine";

/**
 * Task lifecycle IPC (convergence book, Phase F/G).
 *
 * Eight channels that drive a task that already exists: the automation steps
 * (prepare, send, capture, advance, release the review gate) and the evidence trail
 * (build the bundle, rehydrate its weak claims, run the Codex review).
 *
 * `boss:launch-task` deliberately stays in the composition root: it opens provider
 * panes through the limit guard the pane manager owns, so moving it would mean moving
 * that coupling too rather than pretending it is not there.
 *
 * What moved is the part that was a closure over the root: the bundle lookups and
 * their build-if-missing recovery, the "nothing to rehydrate" refusal, and the Codex
 * review's status transitions — including the rule that a failed review is recorded
 * as failed *and* observed against the runtime, so it can never be left at RUNNING.
 */

/** The task/artifact/council shapes, taken from the functions that consume them. */
type EvidenceArgs = Parameters<typeof buildEvidenceBundle>;
export type TaskLifecycleTask = EvidenceArgs[0];
export type TaskLifecycleArtifacts = EvidenceArgs[1];
export type TaskLifecycleCouncil = EvidenceArgs[2];
export type TaskLifecycleBundle = ReturnType<typeof buildEvidenceBundle>;
/** The prompts a rehydration round is queued with — the builder's *return*, not its input. */
export type RehydrationPrompts = ReturnType<typeof buildRehydrationPrompts>;

/** The three states a Codex review can be moved into. */
export type CodexReviewPatch =
  | { status: "RUNNING" }
  | { status: "COMPLETED"; content: string; completedAt: string }
  | { status: "FAILED"; error: string; completedAt: string };

export interface TaskLifecycleSurface {
  /** The stop-and-start automation steps for one task. */
  prepareTask(taskId: string): Promise<void>;
  sendTask(taskId: string): Promise<void>;
  captureTask(taskId: string): Promise<void>;
  continueIfReady(taskId: string): Promise<void>;
  dispatchTask(taskId: string): Promise<void>;
  releaseReview(taskId: string): void;
  /** Evidence: the durable bundle and the review attached to it. */
  task(taskId: string): TaskLifecycleTask | undefined;
  artifacts(): TaskLifecycleArtifacts;
  bundle(taskId: string): TaskLifecycleBundle | undefined;
  /**
   * Builds a bundle for a task that has none. `previousReview` is carried over only
   * where the caller asks for it — `boss:build-evidence` deliberately preserves the
   * existing review while the two recovery paths build a fresh one.
   */
  buildEvidence(task: TaskLifecycleTask, taskId: string, previousReview?: unknown): TaskLifecycleBundle;
  saveEvidence(bundle: TaskLifecycleBundle): void;
  addRehydrationRound(taskId: string, prompts: RehydrationPrompts): void;
  updateCodexReview(bundleId: string, patch: CodexReviewPatch): void;
  observeRuntimeFailure(runtime: string, message: string): void;
  runCodexReview(bundle: TaskLifecycleBundle, artifacts: TaskLifecycleArtifacts): Promise<string>;
  /** The snapshot the renderer re-reads after every step. */
  publish(): unknown;
}

export interface TaskEvent {
  type: "HUMAN_APPROVED";
  taskId: string;
  message: string;
}

export interface TaskLifecycleIpcDeps {
  handle: IpcRegistrar["handle"];
  tasks: TaskLifecycleSurface;
  events: { publish(event: TaskEvent): void };
}

export const TASK_LIFECYCLE_IPC_CHANNELS = [
  "boss:prepare-task",
  "boss:send-task",
  "boss:release-review",
  "boss:capture-task",
  "boss:advance-council",
  "boss:build-evidence",
  "boss:rehydrate-evidence",
  "boss:run-codex-review"
] as const;

export function createTaskLifecycleIpcModule(deps: TaskLifecycleIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  /** The task, or the refusal every one of these channels answers with. */
  const requireTask = (taskId: string): TaskLifecycleTask => {
    const task = deps.tasks.task(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    return task;
  };

  /**
   * The bundle for a task, building and persisting it when the task has none yet.
   * Recovery rather than refusal: a task that has produced artifacts but no bundle
   * yet is exactly the case these channels exist to serve.
   */
  const ensureBundle = (task: TaskLifecycleTask, taskId: string): TaskLifecycleBundle => {
    const existing = deps.tasks.bundle(taskId);
    if (existing) return existing;
    const built = deps.tasks.buildEvidence(task, taskId);
    deps.tasks.saveEvidence(built);
    return built;
  };

  on("boss:prepare-task", async (_event, taskId: string) => {
    await deps.tasks.prepareTask(taskId);
    return deps.tasks.publish();
  });

  on("boss:send-task", async (_event, taskId: string) => {
    await deps.tasks.sendTask(taskId);
    return deps.tasks.publish();
  });

  on("boss:release-review", async (_event, taskId: string) => {
    deps.tasks.releaseReview(taskId);
    deps.events.publish({ type: "HUMAN_APPROVED", taskId, message: "operator approved the review gate" });
    await deps.tasks.continueIfReady(taskId);
    return deps.tasks.publish();
  });

  on("boss:capture-task", async (_event, taskId: string) => {
    await deps.tasks.captureTask(taskId);
    return deps.tasks.publish();
  });

  on("boss:advance-council", async (_event, taskId: string) => {
    await deps.tasks.continueIfReady(taskId);
    return deps.tasks.publish();
  });

  on("boss:build-evidence", (_event, taskId: string) => {
    const task = requireTask(taskId);
    // Carries an existing review over, which is the one thing that separates this
    // channel from the two build-if-missing recovery paths above.
    const previousReview = deps.tasks.bundle(taskId)?.codexReview;
    deps.tasks.saveEvidence(deps.tasks.buildEvidence(task, taskId, previousReview));
    return deps.tasks.publish();
  });

  on("boss:rehydrate-evidence", async (_event, taskId: string) => {
    const task = requireTask(taskId);
    const bundle = ensureBundle(task, taskId);
    if (!bundle.claims.some((claim) => claim.status === "DISPUTED" || claim.status === "INSUFFICIENT")) {
      throw new Error("当前证据包没有需要选择性回填的 claim");
    }
    deps.tasks.addRehydrationRound(taskId, buildRehydrationPrompts(task, bundle, deps.tasks.artifacts(), task.providerIds));
    await deps.tasks.dispatchTask(taskId);
    return deps.tasks.publish();
  });

  on("boss:run-codex-review", async (_event, taskId: string) => {
    const task = requireTask(taskId);
    const bundle = ensureBundle(task, taskId);
    deps.tasks.updateCodexReview(bundle.id, { status: "RUNNING" });
    // Published before the review runs: the renderer shows RUNNING while it waits.
    deps.tasks.publish();
    try {
      const content = await deps.tasks.runCodexReview(bundle, deps.tasks.artifacts());
      deps.tasks.updateCodexReview(bundle.id, { status: "COMPLETED", content, completedAt: new Date().toISOString() });
    } catch (error) {
      // A failed review is recorded as failed AND observed against the runtime, so it
      // can never be left stuck at RUNNING.
      deps.tasks.observeRuntimeFailure("codex:cli", String(error));
      deps.tasks.updateCodexReview(bundle.id, { status: "FAILED", error: String(error), completedAt: new Date().toISOString() });
    }
    return deps.tasks.publish();
  });

  return {
    service: { channels: TASK_LIFECYCLE_IPC_CHANNELS },
    health: () => ({
      module: "task-lifecycle-ipc",
      status: registered.length === TASK_LIFECYCLE_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${TASK_LIFECYCLE_IPC_CHANNELS.length} task-lifecycle channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
