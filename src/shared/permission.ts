/** Permission scope + security classification contracts (plan §17/§18). Pure and shareable. */

export type PermissionKind = "filesystem" | "repo" | "network" | "secret" | "side-effect";
export const PERMISSION_KINDS: readonly PermissionKind[] = ["filesystem", "repo", "network", "secret", "side-effect"];

export interface PermissionScope {
  allow: string[];
  deny: string[];
}

export type PermissionManifest = Record<PermissionKind, PermissionScope>;

/** Empty manifest denies everything — the safe default. */
export const EMPTY_MANIFEST: PermissionManifest = {
  filesystem: { allow: [], deny: [] },
  repo: { allow: [], deny: [] },
  network: { allow: [], deny: [] },
  secret: { allow: [], deny: [] },
  "side-effect": { allow: [], deny: [] }
};

export type SecurityClass = "PUBLIC" | "INTERNAL" | "SECRET" | "GUARDIAN";

export function manifestAllows(manifest: PermissionManifest, kind: PermissionKind, value: string): boolean {
  const scope = manifest[kind];
  if (scope.deny.some((entry) => value === entry || value.startsWith(entry.endsWith("/") ? entry : entry + "/"))) return false;
  if (!scope.allow.length) return false;
  return scope.allow.some((entry) => value === entry || value.startsWith(entry.endsWith("/") ? entry : entry + "/"));
}

/**
 * Task permissions must never exceed workspace permissions (plan rule 18).
 * Returns the violations found; empty means the task manifest is within bounds.
 */
export function manifestNarrow(workspace: PermissionManifest, task: PermissionManifest): string[] {
  const violations: string[] = [];
  for (const kind of PERMISSION_KINDS) {
    for (const entry of task[kind].allow) {
      if (!manifestAllows(workspace, kind, entry)) violations.push(`${kind}:allow:${entry}`);
    }
  }
  return violations;
}

export function manifestToString(manifest: PermissionManifest): string {
  return PERMISSION_KINDS.flatMap((kind) => manifest[kind].allow.map((entry) => `${kind}:${entry}`)).join(",");
}
