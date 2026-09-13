import type { BootModule, IpcRegistrar } from "./boot-module";

/**
 * Autonomous engineering surface IPC (convergence book, Phase F/G).
 *
 * Four channels: the durable goal read-model, the goal run itself, the external
 * web-session archive ledger and its bounded manual retry pass.
 *
 * The one thing this module exists to keep true is that the RUN channel is the
 * only autonomous mutating entry the surface exposes, and that it delegates to
 * `MainCommander.runEngineeringGoal` — which takes the recovery point before it
 * can touch anything (see docs/engineering-recovery-audit.md). Nothing here may
 * grow a second mutation path: a handler that edited files itself would bypass
 * the recovery rule entirely, and `tests/unit/repository-boundary-guards.test.ts`
 * fails if this channel stops being the only one that reaches the goal runner.
 */

export interface ExternalArchiveLedger {
  list(): unknown[];
}

export interface EngineeringSurfaceDeps {
  handle: IpcRegistrar["handle"];
  /** The durable engineering goal read-model. */
  goalStatus(): unknown;
  /** Starts one goal run; the commander owns the recovery point and the rollback. */
  runGoal(input: EngineeringGoalRunInput): Promise<unknown>;
  /** The external web-session archive ledger, when the subsystem is installed. */
  externalSessions?: ExternalArchiveLedger;
  /** One bounded external-archive pass; throws if the ledger is not installed. */
  runExternalArchive(): Promise<unknown>;
}

/** The renderer-facing input shape of one goal run (mirrors the bridge contract). */
export interface EngineeringGoalRunInput {
  goal: { objective: string; workspace: string; [key: string]: unknown };
  workspace: string;
  maxIterations?: number;
  replace?: boolean;
  workerRuntimes?: { implement?: string[]; review?: string[] };
  disableCoder?: boolean;
  disableReviewer?: boolean;
}

export const ENGINEERING_SURFACE_IPC_CHANNELS = [
  "boss:engineering-goal-status",
  "boss:engineering-goal-run",
  "boss:external-session-list",
  "boss:external-archive-run"
] as const;

export function createEngineeringSurfaceIpcModule(deps: EngineeringSurfaceDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:engineering-goal-status", () => deps.goalStatus());

  on("boss:engineering-goal-run", async (_event, input: EngineeringGoalRunInput) => deps.runGoal({
    goal: input.goal,
    workspace: input.workspace,
    ...(input.maxIterations === undefined ? {} : { maxIterations: input.maxIterations }),
    ...(input.replace === undefined ? {} : { replace: input.replace }),
    ...(input.workerRuntimes === undefined ? {} : { workerRuntimes: input.workerRuntimes }),
    ...(input.disableCoder === undefined ? {} : { disableCoder: input.disableCoder }),
    ...(input.disableReviewer === undefined ? {} : { disableReviewer: input.disableReviewer })
  }));

  // Read-only: the ledger shows archive lifecycle so a failed external archive
  // stays visible and retryable, and never deletes anything.
  on("boss:external-session-list", () => deps.externalSessions?.list() ?? []);

  // The manual retry surface. It fails loudly when the ledger is not installed
  // instead of pretending the pass ran and archived nothing.
  on("boss:external-archive-run", async () => {
    if (!deps.externalSessions) throw new Error("External session archive is not available in this session");
    return deps.runExternalArchive();
  });

  return {
    service: { channels: ENGINEERING_SURFACE_IPC_CHANNELS },
    health: () => ({
      module: "engineering-surface-ipc",
      status: registered.length === ENGINEERING_SURFACE_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${ENGINEERING_SURFACE_IPC_CHANNELS.length} channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
