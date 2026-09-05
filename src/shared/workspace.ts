/** Workspace model (plan §4.1). Pure contract, renderer-shareable. */

export const WORKSPACE_SCHEMA_VERSION = 1;
export const DEFAULT_WORKSPACE_ID = "default";   // single-repo compatibility shim workspace
export const SCRATCH_WORKSPACE_ID = "scratch";   // tasks without a repo belong here

export interface Workspace {
  id: string;
  name: string;
  repositories: string[];
  schema_version: typeof WORKSPACE_SCHEMA_VERSION;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceRegistryFile {
  schema_version: 1;
  workspaces: Workspace[];
  active_workspace_id: string;
}

export function validWorkspaceId(id: string): boolean {
  return /^[a-z][a-z0-9_-]{0,63}$/.test(id);
}

export function validateWorkspace(value: Workspace): Workspace {
  if (!value || !validWorkspaceId(value.id) || typeof value.name !== "string" || value.name.length > 80) throw new Error("Invalid workspace");
  if (!Array.isArray(value.repositories) || value.repositories.length > 50 || value.repositories.some((repo) => typeof repo !== "string" || repo.length > 1000)) throw new Error("Invalid workspace repositories");
  if (value.schema_version !== WORKSPACE_SCHEMA_VERSION) throw new Error(`Unsupported workspace schema: ${value.schema_version}`);
  return value;
}
