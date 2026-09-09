/** Runtime compatibility contracts (plan §6). */

export type CompatibilityAxis = "core_api" | "capability_contract" | "adapter_api";

/**
 * Versions the current BOSS core implements. A provider/adapter that declares a
 * supported window must include the matching current version or it is treated
 * as out of contract at registration time. Components evolve independently, so
 * BOSS never assumes every adapter upgraded in lockstep.
 */
export const CURRENT_VERSIONS: Record<CompatibilityAxis, string> = {
  core_api: "1",
  capability_contract: "1",
  adapter_api: "1"
};

export interface VersionWindow {
  min: string;
  max: string;
}

/** Optional per-axis windows an adapter supports. Absence = legacy/unversioned (accepted). */
export interface CompatibilityDeclaration {
  id: string;
  kind: string;
  windows: Partial<Record<CompatibilityAxis, VersionWindow>>;
}

/** Numeric dotted comparison: "1" == "1.0"; "2.1" > "2.0.9". Returns <0, 0, >0. */
export function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.trim().split(".").filter(Boolean).map((part) => { const parsed = Number(part); return Number.isFinite(parsed) ? parsed : 0; });
  const a = parts(left); const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Whether `version` falls inside [min, max]. */
export function versionInWindow(version: string, window: VersionWindow): boolean {
  if (compareVersions(version, window.min) < 0) return false;
  if (compareVersions(version, window.max) > 0) return false;
  return true;
}

/** Null when the declaration is compatible with the current core, else a reason. */
export function compatibilityIssue(declaration: CompatibilityDeclaration): string | null {
  for (const axis of Object.keys(declaration.windows) as CompatibilityAxis[]) {
    const window = declaration.windows[axis];
    if (!window) continue;
    const current = CURRENT_VERSIONS[axis];
    if (!versionInWindow(current, window)) {
      return `${declaration.kind} adapter ${declaration.id} supports ${axis} ${window.min}..${window.max}; BOSS core is ${axis} ${current}`;
    }
  }
  return null;
}
