import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { StateStore, DURABLE_CONVERSATION_POLICIES } from "../../electron/store";
import { CONVERSATION_POLICIES, isConversationPolicy } from "../../src/shared/conversation-policy";

/**
 * A2 move (i), boundary test — docs/city/PHASE_A_DECISION_A2.md, ledger CC-112.
 *
 * `electron/store.ts` used to import `isConversationPolicy` from the capability that owns the conversation POLICY,
 * which is what made `persistence -> tasks` a runtime coupling. The store now declares the SET of policies it may
 * persist and keeps its own guard, exactly as A2-1 did for the run mode. This suite is the evidence that the move
 * weakened nothing:
 *
 *  1. the two vocabularies are pinned to each other, so a fifth policy cannot be added on one side only — the one
 *     real cost of the boundary, asserted rather than assumed;
 *  2. the store's guard still FIRES on a value outside the vocabulary and leaves the task untouched. Deleting the
 *     guard would make that case pass vacuously, so it asserts the throw AND the absence of the write.
 */
describe("the store's durable conversation-policy vocabulary is not a weakening of the policy owner's", () => {
  it("declares exactly the policies the owner declares", () => {
    expect([...DURABLE_CONVERSATION_POLICIES].sort()).toEqual([...CONVERSATION_POLICIES].sort());
    for (const policy of DURABLE_CONVERSATION_POLICIES) expect(isConversationPolicy(policy)).toBe(true);
  });

  it("still refuses a value outside the vocabulary and leaves the task untouched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-conv-policy-"));
    const store = new StateStore(path.join(dir, ".boss", "state.json"));
    const task = store.createTask("guard probe", "prove the guard still fires", ["chatgpt"]);

    expect(() => store.setConversationPolicy(task.id, "PERSISTENTX" as never)).toThrow(/Invalid conversation policy/);
    expect(store.snapshot().tasks.find((item) => item.id === task.id)?.conversationPolicy).toBeUndefined();

    store.setConversationPolicy(task.id, "TEMPORARY");
    expect(store.snapshot().tasks.find((item) => item.id === task.id)?.conversationPolicy).toBe("TEMPORARY");
  });
});
