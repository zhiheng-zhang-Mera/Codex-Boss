import { selectWorkspaceDirectory } from "../workspace/workspace-picker";
import { validateWorkspacePath } from "../workspace/path-utils";
import type { WorkspaceSelectionStore } from "../workspace/workspace-selection";
import type { BootModule, IpcRegistrar } from "./boot-module";

/**
 * Workspace-path IPC (convergence book, Phase F/G).
 *
 * Four channels, and every one of them does exactly the three things an IPC
 * handler is allowed to do: validate the input, call the service that owns the
 * decision, and hand the result back. None of them decides what a path means —
 * `electron/workspace/path-utils.ts` does — and none of them writes state itself.
 *
 * The channels are the same four the renderer already talks to, so extracting them
 * changes no observable behaviour.
 */

interface WorkspaceIpcDeps {
  handle: IpcRegistrar["handle"];
  /** The native folder dialog, already bound to the window that owns it. */
  showOpenDialog(options: { title: string; properties: string[] }): Promise<{ canceled: boolean; filePaths: string[] }>;
  /** The durable remembered-workspace service. */
  selection: WorkspaceSelectionStore;
}

export const WORKSPACE_IPC_CHANNELS = [
  "boss:select-workspace-directory",
  "boss:validate-workspace-path",
  "boss:workspace-selection",
  "boss:remember-workspace-path"
] as const;

export function createWorkspaceIpcModule(deps: WorkspaceIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];

  // The native picker: Electron's own `openDirectory` dialog, wrapped so a
  // cancelled dialog answers `null` and can never clear the workspace the caller
  // already had.
  deps.handle("boss:select-workspace-directory", async () => {
    const pick = async (options: { title: string; properties: ["openDirectory"] }) => deps.showOpenDialog(options);
    return selectWorkspaceDirectory(pick);
  });
  registered.push("boss:select-workspace-directory");

  // The same validator the picker runs, so a typed path shows the identical reason
  // a picked one would.
  deps.handle("boss:validate-workspace-path", (_event, input: string) => validateWorkspacePath(input));
  registered.push("boss:validate-workspace-path");

  // The remembered workspace, re-validated on every read: a directory deleted
  // between two launches reads as STALE and can never become the active workspace
  // again.
  deps.handle("boss:workspace-selection", () => deps.selection.current());
  registered.push("boss:workspace-selection");
  deps.handle("boss:remember-workspace-path", (_event, input: string) => deps.selection.remember(input));
  registered.push("boss:remember-workspace-path");

  return {
    service: { channels: WORKSPACE_IPC_CHANNELS },
    health: () => ({
      module: "workspace-ipc",
      status: registered.length === WORKSPACE_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${WORKSPACE_IPC_CHANNELS.length} channel(s): ${registered.join(", ")}`
    }),
    // Nothing acquired beyond the handlers; channels live as long as the app.
    dispose: () => undefined
  };
}
