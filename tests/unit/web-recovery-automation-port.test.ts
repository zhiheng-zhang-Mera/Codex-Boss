import { describe, expect, it } from "vitest";
import type { RecoveryAutomationPort } from "../../electron/commander/web-recovery";
import type { ProviderAutomation } from "../../electron/provider-automation";

/**
 * CC-118 boundary test.
 *
 * `electron/commander/web-recovery.ts` (owner `tenx`) used to import the `ProviderAutomation` TYPE from
 * `electron/provider-automation.ts` (owner `automation`), which was the ONLY reason `tenx` reached `automation` and
 * therefore the only reason `automation|tenx` was one of the mutual capability pairs. It now declares the two
 * behaviours it drives, and this suite pins the port in BOTH directions at compile time:
 *
 *   1. a two-method stub satisfies the port — so the port really is narrow, not the class restated;
 *   2. the REAL `ProviderAutomation` instance type is assignable to it — so no caller has to change and the port
 *      cannot drift away from the implementation it stands for.
 *
 * If the loop's signatures change, check 2 stops compiling: the build fails rather than a call going silently
 * somewhere else. `expectTypeOf` is not available in this repo's vitest config, so the checks are expressed as
 * assignments to typed constants, which the compiler evaluates the same way.
 */
describe("the web-recovery automation port is narrow AND satisfied by the real loop", () => {
  it("is satisfied by a two-method stub, so it is not the class restated", () => {
    const stub: RecoveryAutomationPort = {
      resumePending: async () => undefined,
      dispatchTask: async () => undefined,
    };
    expect(typeof stub.resumePending).toBe("function");
    expect(typeof stub.dispatchTask).toBe("function");
  });

  it("is satisfied by the real ProviderAutomation instance type, at compile time", () => {
    // A value of the real instance type must be assignable to the port. The function is never called; only the
    // assignment is compiled, and a signature change on either side turns it into a type error.
    type RealIsAssignableToPort = ProviderAutomation extends RecoveryAutomationPort ? true : never;
    const realIsAssignableToPort: RealIsAssignableToPort = true;
    expect(realIsAssignableToPort).toBe(true);
  });
});
