/**
 * Shared IPC guard surface (platform foundation, Phase 01 Task D).
 *
 * `requireProvider` used to live in `electron/bootstrap/settings-ipc.ts`, and both
 * `dispatch-ipc.ts` and `task-creation-ipc.ts` imported it from there. That made two
 * boot capabilities depend on a *third capability's implementation module* for a
 * guard that has nothing to do with settings — the exact "capability implementation
 * imports another capability implementation" coupling the engineering book forbids.
 *
 * It lives under `bootstrap/shared/` because it is genuinely shared rather than
 * merely convenient: a pure input guard over a provider-id list, belonging to no
 * capability. This module is claimed by no manifest, so importing it is never a
 * capability edge, and the architecture ratchet reads it that way.
 *
 * The behaviour is unchanged and deliberately so — one message, one place, so a
 * caller is never told "unknown provider" by one path and something vaguer by another.
 */

/**
 * Refuses an unknown provider by name.
 *
 * @param known every provider id the caller considers valid.
 * @param providerId the id to validate; returned unchanged when it is known.
 * @throws when `providerId` is not in `known`.
 */
export function requireProvider(known: readonly string[], providerId: string): string {
  if (!known.includes(providerId)) throw new Error(`Unknown provider: ${providerId}`);
  return providerId;
}
