import type { BootModule, IpcRegistrar } from "./boot-module";

/**
 * Status / read-model IPC (convergence book, Phase F/G).
 *
 * The purely read-only channels: they answer a question and change nothing. They
 * used to be closures over the composition root's bindings, which made the
 * renderer's whole read surface impossible to exercise without booting an
 * Electron window.
 *
 * A status module is where the "advisory read" contract is enforced: every one of
 * these answers `undefined`/`[]` when its subsystem is not installed rather than
 * throwing, because the renderer polls them on a timer and a missing optional
 * subsystem is not an error — it is an empty answer.
 */

export interface WindowStateView {
  visible: boolean;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface StatusService {
  /** The durable application snapshot. */
  snapshot(): unknown;
  /** Progress summaries; empty when the recorder is not attached. */
  progress(): unknown[];
  /** The pending human-guidance request for a task, if any. */
  activeIntervention(taskId: string): unknown;
  /** Every human-guidance request, optionally for one task. */
  listInterventions(taskId?: string): unknown[];
  /** The merged/detached workspace view and the second window's bounds. */
  workspaceView(): unknown;
  /** Host + web window state, for objective verification of the two-window mode. */
  windowState(): unknown;
}

export interface StatusIpcDeps {
  handle: IpcRegistrar["handle"];
  status: StatusService;
}

export const STATUS_IPC_CHANNELS = [
  "boss:snapshot",
  "boss:progress",
  "boss:active-intervention",
  "boss:list-interventions",
  "boss:get-workspace-view",
  "boss:get-window-state"
] as const;

/** Reads one Electron window's host state; `undefined` once it is gone. */
export function windowStateView(read: () => WindowStateView | undefined): WindowStateView | undefined {
  try {
    return read();
  } catch {
    // A destroyed window is not an error the renderer should see: it asks again
    // on the next poll, and the pane it is asking about is gone either way.
    return undefined;
  }
}

export function createStatusIpcModule(deps: StatusIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:snapshot", () => deps.status.snapshot());
  on("boss:progress", () => deps.status.progress());
  on("boss:active-intervention", (_event, taskId: string) => deps.status.activeIntervention(taskId));
  on("boss:list-interventions", (_event, taskId?: string) => deps.status.listInterventions(taskId));
  on("boss:get-workspace-view", () => deps.status.workspaceView());
  on("boss:get-window-state", () => deps.status.windowState());

  return {
    service: { channels: STATUS_IPC_CHANNELS },
    health: () => ({
      module: "status-ipc",
      status: registered.length === STATUS_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${STATUS_IPC_CHANNELS.length} read-only channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
