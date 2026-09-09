/** Software session ownership contracts (plan §16 / AP19). Pure and shareable. */

export type SoftwareSessionMode = "exclusive" | "shared-read";

export interface SoftwareSession {
  session_id: string;
  /** Owning logical workspace (plan AP01); may be absent for legacy/chat tasks. */
  owner_workspace?: string;
  owner_task: string;
  /** Software target identity, e.g. a window/application/workspace path. */
  target: string;
  mode: SoftwareSessionMode;
  /** Lease expiry (ms epoch). Past it the session is considered released. */
  lease_until: number;
  state_hash?: string;
}

export function sessionAllows(session: SoftwareSession | undefined, requestedMode: SoftwareSessionMode, now: number): boolean {
  if (!session) return true;
  if (session.lease_until <= now) return true; // expired lease = free
  if (session.mode === "shared-read" && requestedMode === "shared-read") return true;
  return false;
}

export function resourceProfile(actionName: string): { mode: SoftwareSessionMode } {
  const readOnly = ["read_page", "find_control", "verify_state", "wait_for_state"].includes(actionName);
  return { mode: readOnly ? "shared-read" : "exclusive" };
}
