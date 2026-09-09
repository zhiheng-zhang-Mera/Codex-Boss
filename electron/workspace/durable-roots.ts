import path from "node:path";
import { DEFAULT_WORKSPACE_ID, SCRATCH_WORKSPACE_ID } from "../../src/shared/workspace";

/**
 * Workspace-scoped durable roots (plan AP01b). Default and Scratch keep the
 * legacy app-global root so existing single-repo data stays readable (shim);
 * any other workspace gets its own sub-root so state/evidence/session families
 * can be re-homed per workspace without cross-talk.
 */
export function durableRootFor(dataRoot: string, workspaceId: string): string {
  if (workspaceId === DEFAULT_WORKSPACE_ID || workspaceId === SCRATCH_WORKSPACE_ID) return dataRoot;
  return path.join(dataRoot, "workspaces", workspaceId);
}

export function durableFileFor(dataRoot: string, workspaceId: string, relativeName: string): string {
  const root = durableRootFor(dataRoot, workspaceId);
  const file = path.resolve(root, relativeName);
  const resolved = path.resolve(root);
  if (file !== resolved && !file.startsWith(resolved + path.sep)) throw new Error("Durable root escapes workspace");
  return file;
}
