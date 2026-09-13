import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import type { Workspace, WorkspaceRegistryFile } from "../../src/shared/workspace";
import { DEFAULT_WORKSPACE_ID, SCRATCH_WORKSPACE_ID, validateWorkspace } from "../../src/shared/workspace";
import { canonicalRealPathSync, isInsideWorkspace, isSameDirectory } from "./path-utils";

/**
 * Workspace Registry + Resolver (plan AP01). Workspaces are logical run
 * domains: each has a name, a repository list and (optionally) its own durable
 * roots later (AP01b). Every task is bound to one workspace (default/scratch
 * shim keeps current single-repo behavior).
 */
export class WorkspaceRegistry {
  private fileValue: WorkspaceRegistryFile;
  constructor(private readonly file: string) { this.fileValue = this.read(); }

  list(): Workspace[] { return structuredClone(this.fileValue.workspaces); }
  activeWorkspaceId(): string { return this.fileValue.active_workspace_id; }
  setActive(id: string): void { this.require(id); this.fileValue.active_workspace_id = id; this.persist(); }

  get(id: string): Workspace | undefined { const found = this.fileValue.workspaces.find((workspace) => workspace.id === id); return found ? structuredClone(found) : undefined; }

  create(input: { id?: string; name: string; repositories?: string[]; artifact_roots?: string[] }): Workspace {
    const id = input.id ?? idFromName(input.name);
    if (this.get(id)) throw new Error(`Workspace already exists: ${id}`);
    const now = new Date().toISOString();
    const workspace = validateWorkspace({ id, name: input.name.trim().slice(0, 80), repositories: [...new Set(input.repositories ?? [])], ...(input.artifact_roots ? { artifact_roots: [...new Set(input.artifact_roots)] } : {}), schema_version: 1, created_at: now, updated_at: now });
    this.fileValue.workspaces.push(workspace);
    this.persist();
    return structuredClone(workspace);
  }

  /** Resolver: best workspace for a directory path, else the default shim workspace. */
  resolveForPath(directory: string): Workspace {
    // Both sides go through the one identity rule, so a repository registered
    // under one spelling of its path is still found when the task reaches it
    // through another (Windows 8.3 short name, junction, drive-letter case).
    const normalized = canonicalRealPathSync(directory);
    let best: Workspace | undefined;
    let bestLength = -1;
    for (const workspace of this.fileValue.workspaces) {
      for (const repo of workspace.repositories) {
        let resolved: string;
        try {
          resolved = canonicalRealPathSync(repo);
        } catch {
          // A registered repository that no longer exists cannot match a live
          // directory; it must not abort the lookup either.
          continue;
        }
        if ((isSameDirectory(normalized, resolved) || isInsideWorkspace(resolved, normalized)) && resolved.length > bestLength) { best = workspace; bestLength = resolved.length; }
      }
    }
    return structuredClone(best ?? this.get(DEFAULT_WORKSPACE_ID) ?? this.get(SCRATCH_WORKSPACE_ID)!);
  }

  /** Ensures the default and scratch shim workspaces exist (single-repo compatibility). */
  ensureShims(defaultRepository?: string): void {
    const now = new Date().toISOString();
    if (!this.get(DEFAULT_WORKSPACE_ID)) this.fileValue.workspaces.push(validateWorkspace({ id: DEFAULT_WORKSPACE_ID, name: "Default", repositories: defaultRepository ? [defaultRepository] : [], schema_version: 1, created_at: now, updated_at: now }));
    if (!this.get(SCRATCH_WORKSPACE_ID)) this.fileValue.workspaces.push(validateWorkspace({ id: SCRATCH_WORKSPACE_ID, name: "Scratch", repositories: [], schema_version: 1, created_at: now, updated_at: now }));
    if (!this.fileValue.workspaces.some((workspace) => workspace.id === this.fileValue.active_workspace_id)) this.fileValue.active_workspace_id = DEFAULT_WORKSPACE_ID;
    this.persist();
  }

  private require(id: string): Workspace { const found = this.get(id); if (!found) throw new Error(`Unknown workspace: ${id}`); return found; }
  private persist(): void { writeJson(this.file, this.fileValue); }
  private read(): WorkspaceRegistryFile {
    const value = readJson<Partial<WorkspaceRegistryFile>>(this.file);
    if (!value) return { schema_version: 1, workspaces: [], active_workspace_id: DEFAULT_WORKSPACE_ID };
    if (value.schema_version !== 1 || !Array.isArray(value.workspaces)) throw new Error("Invalid workspace registry");
    return { schema_version: 1, workspaces: value.workspaces.map(validateWorkspace), active_workspace_id: value.active_workspace_id ?? DEFAULT_WORKSPACE_ID };
  }
}

function idFromName(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  return /^[a-z][a-z0-9_-]{0,63}$/.test(base) ? base : SCRATCH_WORKSPACE_ID;
}
