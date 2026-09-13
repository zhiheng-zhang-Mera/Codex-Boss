/**
 * Workspace path contract (Update-Plan/cleaning.md §2/§3). Pure and
 * renderer-shareable — no filesystem, no Electron.
 *
 * The renderer renders these values; it never computes them. The single
 * implementation lives in `electron/workspace/path-utils.ts`, which is the only
 * module allowed to decide what a workspace path means.
 */

/** Machine-readable outcome of a path decision. Branch on this, never on `reason`. */
export type WorkspacePathCode =
  | "OK"
  | "EMPTY_PATH"
  | "INVALID_PATH"
  | "NOT_ABSOLUTE"
  | "PATH_NOT_FOUND"
  | "NOT_A_DIRECTORY"
  | "PATH_NOT_ACCESSIBLE"
  | "UNRESOLVABLE";

export interface WorkspacePathValidation {
  ok: boolean;
  /** Machine code; `OK` exactly when `ok` is true. */
  code: WorkspacePathCode;
  /** Canonical Windows form (present whenever the input had any content). */
  normalizedPath?: string;
  /** Human-readable explanation. Display only. */
  reason?: string;
}

export interface ResolvedWorkspace {
  ok: boolean;
  code: WorkspacePathCode;
  /** Canonical Windows form of the input (separators, drive case, no trailing separator). */
  normalizedPath?: string;
  /** Canonical identity: real path with symlinks/junctions resolved and case corrected. */
  canonicalPath?: string;
  reason?: string;
}

/** Human-facing label for a refusal code (the code stays the machine contract). */
export const WORKSPACE_PATH_CODE_LABELS: Readonly<Record<WorkspacePathCode, string>> = {
  OK: "可用",
  EMPTY_PATH: "路径为空",
  INVALID_PATH: "路径包含非法字符",
  NOT_ABSOLUTE: "必须是绝对路径",
  PATH_NOT_FOUND: "目录不存在",
  NOT_A_DIRECTORY: "不是目录",
  PATH_NOT_ACCESSIBLE: "目录不可访问",
  UNRESOLVABLE: "路径无法解析"
};
