import fs from "node:fs";
import { readJson, writeJson } from "../commander/durable-json";
import { resolveWorkspacePath } from "./path-utils";
import type { WorkspaceSelectionState } from "../../src/shared/workspace-selection";

/**
 * Remembered workspace (Update-Plan/cleaning.md §6). Durable, fail-safe.
 *
 * Rules this store enforces:
 *
 *   - only a canonical, validated path is ever written (`remember`);
 *   - the stored path is re-validated on every read (`current`), because between
 *     two launches the directory may be gone, the drive may be unmounted or the
 *     share may be offline — a stale remembered path must never silently become
 *     the active workspace again;
 *   - reading never throws: a corrupt, missing or unsupported record reads as
 *     UNSET, so damaged state cannot stop the application from starting.
 */
export interface WorkspaceSelectionFile {
  schemaVersion: 1;
  /** Canonical validated path, as accepted by the one path model. */
  workspacePath: string;
  updatedAt: string;
}

export class WorkspaceSelectionStore {
  constructor(private readonly file: string) {}

  /** The remembered path with no filesystem check (display/diagnostics only). */
  persistedPath(): string | undefined {
    const value = this.readFile();
    return value?.workspacePath;
  }

  /**
   * What the workspace field should restore to, validated right now.
   *
   * - UNSET      nothing usable was ever remembered;
   * - AVAILABLE  the remembered directory is there and is a directory;
   * - STALE      the remembered path is remembered but no longer usable — the
   *              value is still returned so the Owner can see and correct it.
   */
  async current(): Promise<WorkspaceSelectionState> {
    const value = this.readFile();
    if (!value) return { status: "UNSET" };
    const remembered = value.workspacePath;
    const resolved = await resolveWorkspacePath(remembered);
    return resolved.ok
      ? { status: "AVAILABLE", path: resolved.canonicalPath!, ...(resolved.reason ? { reason: resolved.reason } : {}) }
      : { status: "STALE", path: remembered, code: resolved.code, reason: resolved.reason ?? "workspace is no longer available" };
  }

  /**
   * Validates and remembers a workspace. An invalid path is refused with its
   * code and is never written: the durable record only ever holds a path that
   * was usable when it was stored.
   */
  async remember(input: string): Promise<WorkspaceSelectionState> {
    const resolved = await resolveWorkspacePath(input);
    if (!resolved.ok) {
      return { status: "REJECTED", ...(resolved.normalizedPath ? { path: resolved.normalizedPath } : {}), code: resolved.code, reason: resolved.reason ?? "invalid workspace path" };
    }
    const value: WorkspaceSelectionFile = { schemaVersion: 1, workspacePath: resolved.canonicalPath!, updatedAt: new Date().toISOString() };
    writeJson(this.file, value);
    return { status: "AVAILABLE", path: value.workspacePath, ...(resolved.reason ? { reason: resolved.reason } : {}) };
  }

  /** Drops the remembered workspace (explicit "forget", never an implicit clear). */
  forget(): void {
    if (fs.existsSync(this.file)) fs.rmSync(this.file, { force: true });
  }

  private readFile(): WorkspaceSelectionFile | undefined {
    try {
      const value = readJson<Partial<WorkspaceSelectionFile>>(this.file);
      if (!value) return undefined;
      if (value.schemaVersion !== 1) return undefined;
      if (typeof value.workspacePath !== "string" || !value.workspacePath.trim()) return undefined;
      return { schemaVersion: 1, workspacePath: value.workspacePath, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "" };
    } catch {
      // A corrupt or unreadable record is not a reason to refuse to start.
      return undefined;
    }
  }
}
