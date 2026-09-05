import { readJson, writeJson } from "../commander/durable-json";
import type { PermissionManifest, PermissionKind } from "../../src/shared/permission";
import { EMPTY_MANIFEST } from "../../src/shared/permission";

/**
 * Workspace Permission Manifest (plan §18). A workspace owns one persisted
 * manifest; tasks may only carry a subset (manifestNarrow). Until the real
 * Workspace object lands (AP01) this store holds the single default manifest
 * scoped to the current app data root.
 */
export interface PermissionManifestFile {
  schemaVersion: 1;
  workspaceId: string;
  manifest: PermissionManifest;
}

export class PermissionManifestStore {
  constructor(private readonly file: string) {}

  load(workspaceId: string): PermissionManifest {
    const value = readJson<Partial<PermissionManifestFile>>(this.file);
    if (!value || value.workspaceId !== workspaceId) return structuredClone(EMPTY_MANIFEST);
    if (value.schemaVersion !== 1 || !value.manifest) throw new Error("Invalid permission manifest");
    return value.manifest;
  }

  save(workspaceId: string, manifest: PermissionManifest): void {
    writeJson(this.file, { schemaVersion: 1, workspaceId, manifest });
  }

  grant(workspaceId: string, kind: PermissionKind, entry: string): void {
    const manifest = this.load(workspaceId);
    if (!manifest[kind].allow.includes(entry)) manifest[kind].allow = [...manifest[kind].allow, entry];
    this.save(workspaceId, manifest);
  }
}
