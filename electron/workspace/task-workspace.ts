import { requireWorkspacePathSync, resolveWorkspacePathSync } from "./path-utils";

/**
 * Workspace ownership for one dispatch (Update-Plan/cleaning.md §5).
 *
 * Three different ideas used to be spelled inline, twice each, at the IPC
 * boundary:
 *
 *   workspacePath  — the directory the user selected or typed for THIS task
 *   repository     — a repository materialized from an input object (a GitHub URL)
 *   fallback       — the app's own directory, used when the caller asked for nothing
 *
 * They are still three ideas (the §5 inventory keeps them separate on purpose),
 * but they resolve to one value in one place now, and that value is the
 * canonical, validated path the runtime receives. Rendering, dispatch and
 * resume all read the same decision instead of re-deriving it.
 */

interface WorkspaceRequest {
  /** The workspace the request carried (typed, picked, or injected by a script/test). */
  requested?: string;
  /**
   * A repository materialized from an input object for this request. It wins
   * over `requested`: a GitHub URL in the message names the code to work on.
   */
  repositoryLocalPath?: string;
  /** Used only when the request named no workspace at all. */
  fallback: string;
}

/**
 * Resolves the workspace a request runs against.
 *
 * An explicitly requested path is validated and canonicalized — a missing or
 * non-directory path refuses with an explicit code (`PATH_NOT_FOUND`,
 * `NOT_A_DIRECTORY`, …) instead of the raw filesystem error the old inline
 * `fs.realpathSync` produced, and it never silently degrades into the fallback:
 * the caller asked for a specific directory and must be told it is unusable.
 */
export function workspaceForRequest(input: WorkspaceRequest): string {
  if (input.repositoryLocalPath) return input.repositoryLocalPath;
  const requested = typeof input.requested === "string" ? input.requested.trim() : "";
  if (!requested) return input.fallback;
  return requireWorkspacePathSync(requested).canonicalPath!;
}

/**
 * Resolves a *persisted* task workspace for a resume path.
 *
 * A remembered path is not a request: the directory may have been deleted,
 * unmounted or renamed since it was written. This never throws — an unavailable
 * workspace falls back to `fallback` so startup and resume cannot crash on stale
 * state, while `workspaceForRequest` above stays strict for fresh requests.
 */
export function availableWorkspace(task: { workspacePath?: string }, fallback: string): string {
  const persisted = typeof task.workspacePath === "string" ? task.workspacePath.trim() : "";
  if (!persisted) return fallback;
  const resolved = resolveWorkspacePathSync(persisted);
  return resolved.ok ? resolved.canonicalPath! : fallback;
}

/** True when a persisted workspace path still names a usable directory. */
export function persistedWorkspaceAvailable(task: { workspacePath?: string }): boolean {
  const persisted = typeof task.workspacePath === "string" ? task.workspacePath.trim() : "";
  return persisted !== "" && resolveWorkspacePathSync(persisted).ok;
}
