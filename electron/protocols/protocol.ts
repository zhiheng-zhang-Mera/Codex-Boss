/**
 * The protocol step's role vocabulary, declared HERE rather than imported from `electron/commander/role-router.ts`
 * (owner `tenx`).
 *
 * CC-113 finding: this import was the ONLY import in this file and it was type-only, so `research -> tenx` existed
 * for a seven-literal union. A protocol names the roles its steps run; which runtime a role is routed to, and what
 * capability it needs, is the commander's business and is never read here.
 *
 * `tests/unit/protocol-role-vocabulary.test.ts` pins this union to the router's `RoleId` in both directions, so a
 * new role cannot be added on one side only — the same boundary discipline A2-1 and A2-5 used for the run mode and
 * the conversation policy.
 */
export type ProtocolRoleId = "planner" | "researcher" | "reviewer" | "synthesizer" | "coder" | "validator" | "critic";

interface ProtocolStep { id: string; role: ProtocolRoleId; requireAll: boolean; }
export interface ProtocolDefinition { id: string; steps: readonly ProtocolStep[]; }
