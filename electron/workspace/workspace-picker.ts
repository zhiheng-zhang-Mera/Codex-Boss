import { requireWorkspacePath } from "./path-utils";

/**
 * Native workspace directory selection (Update-Plan/cleaning.md §4).
 *
 * The dialog itself is Electron's, and Electron cannot run in a unit test, so
 * `selectWorkspaceDirectory` takes the dialog as an injected function. Everything
 * that decides *what the selection means* stays here, in the production path:
 *
 *   - cancelling returns `null` and never an empty string — the caller keeps the
 *     workspace it already had (plan §4 step 2);
 *   - a selection is canonicalized through the one path model, so the native
 *     picker and a typed path can never disagree about what the workspace is;
 *   - a selection that cannot be canonicalized throws (fail closed) instead of
 *     silently degrading into "the user cancelled".
 */

interface DirectoryPickerOptions {
  title: string;
  properties: ["openDirectory"];
}

interface DirectoryPickerResult {
  canceled: boolean;
  filePaths: string[];
}

export type DirectoryPicker = (options: DirectoryPickerOptions) => Promise<DirectoryPickerResult>;

export const WORKSPACE_PICKER_TITLE = "选择工作区目录";

/** The one dialog shape a workspace picker may use: a native folder chooser, single selection. */
export function workspacePickerOptions(): DirectoryPickerOptions {
  return { title: WORKSPACE_PICKER_TITLE, properties: ["openDirectory"] };
}

/**
 * Opens the native folder chooser and returns the canonical workspace path, or
 * `null` when the user cancelled.
 */
export async function selectWorkspaceDirectory(pick: DirectoryPicker): Promise<string | null> {
  const selection = await pick(workspacePickerOptions());
  if (selection.canceled) return null;
  const chosen = (selection.filePaths ?? [])[0];
  // An uncancelled dialog with no path is a cancel in everything but the flag.
  if (!chosen) return null;
  const resolved = await requireWorkspacePath(chosen);
  return resolved.canonicalPath!;
}
