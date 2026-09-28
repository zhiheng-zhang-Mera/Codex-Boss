import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { StateStore, DURABLE_RUN_MODES } from "../../electron/store";
import { RUN_MODES, isRunMode } from "../../src/shared/owner-result";

/**
 * A2 move (i), boundary test — docs/city/PHASE_A_DECISION_A2.md.
 *
 * `electron/store.ts` used to import `isRunMode` from the capability that owns the run-mode POLICY, which is what
 * made `persistence -> status` a runtime coupling. The store now declares the SHAPE it persists and keeps its own
 * guard; this suite is the evidence that the move did not weaken anything:
 *
 *  1. the two vocabularies are pinned to each other, so a fourth mode cannot be added on one side only — which is
 *     the one real cost of the boundary and the reason it is asserted rather than assumed;
 *  2. the store's guard still FIRES on a value outside the vocabulary. Deleting the guard would make this test
 *     pass vacuously, so it asserts the throw AND that the task was left untouched.
 */
describe("the store's durable run-mode vocabulary is not a weakening of the policy owner's", () => {
  it("declares exactly the modes the policy owner declares", () => {
    expect([...DURABLE_RUN_MODES].sort()).toEqual([...RUN_MODES].sort());
    for (const mode of DURABLE_RUN_MODES) expect(isRunMode(mode)).toBe(true);
  });

  it("still refuses a value outside the vocabulary and leaves the task untouched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-run-mode-"));
    const store = new StateStore(path.join(dir, ".boss", "state.json"));
    const task = store.createTask("guard probe", "prove the guard still fires", ["chatgpt"]);

    expect(() => store.setRunMode(task.id, "OWNER_RESULTX" as never)).toThrow(/Invalid run mode/);
    expect(store.snapshot().tasks.find((item) => item.id === task.id)?.runMode).toBeUndefined();

    store.setRunMode(task.id, "OWNER_RESULT");
    expect(store.snapshot().tasks.find((item) => item.id === task.id)?.runMode).toBe("OWNER_RESULT");
  });
});
