import type { WorkspacePathCode } from "./workspace-path";
import { WORKSPACE_PATH_CODE_LABELS } from "./workspace-path";

/**
 * Remembered workspace contract (Update-Plan/cleaning.md §6). Pure and
 * renderer-shareable.
 *
 * Boss remembers the last workspace. What is remembered is a *canonical,
 * validated* path, and what is restored is a *decision*, never an assumption:
 * the stored path is validated again on every read, because between two launches
 * a directory can be deleted, a drive can be unmounted and a network share can
 * go away.
 */

export type WorkspaceSelectionStatus = "UNSET" | "AVAILABLE" | "STALE" | "REJECTED";

export interface WorkspaceSelectionState {
  status: WorkspaceSelectionStatus;
  /** Canonical path when AVAILABLE; the remembered (stale) path when STALE. */
  path?: string;
  code?: WorkspacePathCode;
  /** Display only. */
  reason?: string;
}

export interface WorkspaceFieldRestore {
  /** Text for the editable field. "" means "nothing to restore". */
  value: string;
  /** True only when the restored path may be used to start work. */
  usable: boolean;
  /** Shown beside the field when a remembered path is no longer usable. */
  notice?: string;
}

/**
 * Maps a remembered-workspace state onto the editable field.
 *
 * A stale path is *displayed* (the Owner can see what Boss remembers and fix it)
 * but is marked unusable, and nothing is started from it: restoring the field is
 * a display decision, never a mutation.
 */
export function restoreWorkspaceField(state: WorkspaceSelectionState | undefined | null): WorkspaceFieldRestore {
  if (!state || state.status === "UNSET" || state.status === "REJECTED") return { value: "", usable: false };
  if (state.status === "AVAILABLE") return { value: state.path ?? "", usable: Boolean(state.path) };
  const label = state.code ? WORKSPACE_PATH_CODE_LABELS[state.code] ?? state.code : "路径不可用";
  return {
    value: state.path ?? "",
    usable: false,
    notice: `上次使用的工作区已不可用（${label}）：${state.reason ?? state.path ?? ""}`
  };
}
