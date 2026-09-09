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

/* ------------------------------------------- desktop side-effect gate */

/**
 * Desktop computer actions that only observe (always allowed, mirroring the
 * lease's shared-read set). Everything else is a mutation and must be
 * allow-listed as a `computer:<action>` side-effect by the workspace manifest.
 */
export const DESKTOP_READ_ACTIONS: readonly string[] = ["read_page", "find_control", "verify_state", "wait_for_state"];

export interface SideEffectVerdict {
  allowed: boolean;
  reason?: string;
}

/**
 * Fails closed: a desktop mutation with no allow-listed `computer:<name>`
 * side-effect (or no manifest at all) is denied. Reads always pass — like the
 * software runtime's authorize() (§17/§18), mutations alone need the manifest.
 */
export function desktopMutationGate(manifest: PermissionManifest | undefined, actionName: string): SideEffectVerdict {
  if (DESKTOP_READ_ACTIONS.includes(actionName)) return { allowed: true };
  const key = `computer:${actionName}`;
  if (manifest && manifestAllows(manifest, "side-effect", key)) return { allowed: true };
  return { allowed: false, reason: `Permission gate denied computer ${actionName} (side-effect ${key} not allowed)` };
}
