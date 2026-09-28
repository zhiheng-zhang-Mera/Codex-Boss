import { describe, expect, it } from "vitest";
import type { ProtocolRoleId } from "../../electron/protocols/protocol";
import type { RoleId } from "../../electron/commander/role-router";

/**
 * CC-113 boundary test.
 *
 * `electron/protocols/protocol.ts` (owner `research`) used to import `RoleId` from `electron/commander/role-router.ts`
 * (owner `tenx`) — the ONLY import in that file, and type-only — which is what made `research -> tenx` a real
 * coupling edge and `research|tenx` a mutual pair. The file now declares its own seven-literal union.
 *
 * The one real cost of that boundary is that a new role must be added in two places, so this suite pins the two
 * declarations to each other IN BOTH DIRECTIONS at compile time. If either side gains a member the other lacks, the
 * mutual-assignability checks below stop compiling, which is a stronger guarantee than a runtime assertion: the
 * build fails rather than a test.
 */
describe("the protocol role vocabulary is not a divergence from the router's RoleId", () => {
  it("pins the two unions to each other at compile time", () => {
    type ProtocolIsAssignableToRouter = ProtocolRoleId extends RoleId ? true : never;
    type RouterIsAssignableToProtocol = RoleId extends ProtocolRoleId ? true : never;
    const protocolToRouter: ProtocolIsAssignableToRouter = true;
    const routerToProtocol: RouterIsAssignableToProtocol = true;
    expect(protocolToRouter).toBe(true);
    expect(routerToProtocol).toBe(true);
  });

  it("names every role the router knows, so a missing member is visible here too", () => {
    const roles: readonly ProtocolRoleId[] = ["planner", "researcher", "reviewer", "synthesizer", "coder", "validator", "critic"];
    expect(roles).toHaveLength(7);
    expect(new Set(roles).size).toBe(7);
  });
});
