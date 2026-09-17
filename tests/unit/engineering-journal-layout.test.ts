import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EngineeringLoopStore } from "../../electron/engineering/engineering-loop-store";
import { EngineeringRecoveryLedger } from "../../electron/engineering/engineering-recovery";
import { ENGINEERING_JOURNAL_FILES, engineeringJournalAt } from "../../electron/engineering/engineering-journal";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";

/**
 * PF-DEBT-007 — the autonomous engineering journal had no owner of its layout.
 *
 * `EngineeringLoopStore` and `EngineeringRecoveryLedger` persist DIFFERENT document shapes and, before
 * this phase, every caller derived both paths itself. The hazard is concrete, not theoretical: the loop
 * store's reader requires an `iterations` array (`engineering-loop-store.ts:128`) and throws "Invalid
 * engineering loop file" without one, while the recovery ledger writes `{ schemaVersion, events }`
 * (`engineering-recovery.ts:137`). The recovery ledger's own comment says it is *"deliberately separate
 * from the iteration rows: a recovery event must not overwrite the iteration's findings"* — but nothing
 * made it separate, so pointed at one file each writer destroys what the other needs.
 *
 * `engineeringJournalAt()` is now the single owner of that layout. These tests hold the property that
 * matters — the two documents cannot collide — and the property that makes the fix checkable: the
 * pairing reports the root it resolved instead of being trusted.
 */

const AT = "2026-09-16T00:00:00.000Z";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-eng-journal-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function goal(): EngineeringGoalContract {
  return {
    schemaVersion: 1,
    id: "goal-1",
    objective: "harden the gateway",
    workspace: dir,
    protectedProductBehavior: [],
    allowedChangeScope: ["src/"],
    forbiddenChangeScope: [],
    verificationPolicy: "standard",
    agentCount: 1,
    convergencePolicy: { cleanRoundsRequired: 3 },
    createdAt: AT
  };
}

/** A minimal recovery event, in the shape the real ledger appends. */
function recoveryEvent(code: string) {
  return { at: AT, goalId: "goal-1", code, reason: `${code} reason`, recovery: { attempted: false as const, code: "CHECKPOINT_UNAVAILABLE" as const, reason: "x" } };
}

describe("Phase 06 — the engineering journal layout has one owner", () => {
  it("declares one file per concern, and they are different files", () => {
    expect(ENGINEERING_JOURNAL_FILES.loop).toBe("engineering-loop.json");
    expect(ENGINEERING_JOURNAL_FILES.recovery).toBe("engineering-recovery.json");
    expect(ENGINEERING_JOURNAL_FILES.loop).not.toBe(ENGINEERING_JOURNAL_FILES.recovery);
  });

  it("resolves both stores under the journal directory it was given", () => {
    const journal = engineeringJournalAt(dir);
    expect(journal.directory).toBe(dir);
    expect(journal.loopFile).toBe(path.join(dir, "engineering-loop.json"));
    expect(journal.recoveryFile).toBe(path.join(dir, "engineering-recovery.json"));
  });

  it("PROVES the collision the layout prevents: one file cannot hold both documents", () => {
    // The defect, reproduced directly. Both documents written to one path: the second erases the
    // first, and the loop store can no longer even CONSTRUCT over the file it owns — it throws
    // "Invalid engineering loop file" from its own reader rather than reporting an empty journal. This
    // is what every caller deriving its own path risked, and what the recovery ledger's comment
    // claimed could not happen.
    const shared = path.join(dir, "engineering-loop.json");
    new EngineeringLoopStore(shared).freezeGoal(goal());

    // The loop store can read its own document.
    expect(new EngineeringLoopStore(shared).goal?.id).toBe("goal-1");

    // One recovery event, to the same path.
    new EngineeringRecoveryLedger(shared).append(recoveryEvent("ROLLBACK_STARTED") as never);

    // The goal is gone AND the store now refuses to open. A run whose journal hits this cannot be
    // inspected or resumed through the loop store at all.
    expect(() => new EngineeringLoopStore(shared)).toThrow(/Invalid engineering loop file/);
    // And the file is now a MIXTURE of the two shapes — the recovery event survived only because the
    // loop store spreads what it parsed. Two documents, one file, neither owner aware of the other:
    // the corruption is silent rather than loud, which is why nothing caught it.
    const mixture = JSON.parse(fs.readFileSync(shared, "utf8")) as Record<string, unknown>;
    expect(Object.keys(mixture).sort()).toEqual(expect.arrayContaining(["events", "schemaVersion"]));
    expect(mixture.iterations).toBeUndefined();
  });

  it("keeps goal, iterations and recovery events all readable when they use the resolved paths", () => {
    // The same sequence of writes through the resolver. Nothing is lost in either direction.
    const journal = engineeringJournalAt(dir);
    const store = journal.loopStore();
    store.freezeGoal(goal());
    store.beginIteration();
    journal.recoveryLedger().append(recoveryEvent("ROLLBACK_STARTED") as never);
    store.setCleanRounds(3);

    expect(new EngineeringLoopStore(journal.loopFile).goal?.id).toBe("goal-1");
    expect(new EngineeringLoopStore(journal.loopFile).iterations()).toHaveLength(1);
    expect(new EngineeringLoopStore(journal.loopFile).cleanRounds).toBe(3);
    expect(new EngineeringRecoveryLedger(journal.recoveryFile).list()).toHaveLength(1);
  });

  it("keeps the recovery ledger readable after the loop store rewrites its document", () => {
    const journal = engineeringJournalAt(dir);
    journal.recoveryLedger().append(recoveryEvent("ROLLBACK_ABORTED") as never);
    journal.loopStore().freezeGoal(goal());
    journal.loopStore().beginIteration();

    expect(new EngineeringRecoveryLedger(journal.recoveryFile).list()).toHaveLength(1);
    expect(new EngineeringLoopStore(journal.loopFile).goal?.id).toBe("goal-1");
  });

  it("reports the root it resolved, so two journals cannot be confused for one", () => {
    // The previous failure mode was a path that LOOKED right and was not. The pairing carries its
    // directory so a caller — and a test — can compare rather than assume.
    const a = engineeringJournalAt(path.join(dir, "one"));
    const b = engineeringJournalAt(path.join(dir, "two"));
    expect(a.directory).toBe(path.join(dir, "one"));
    expect(b.directory).toBe(path.join(dir, "two"));
    expect(a.loopFile).not.toBe(b.loopFile);
    expect(a.recoveryFile).not.toBe(b.recoveryFile);

    a.loopStore().freezeGoal(goal());
    expect(new EngineeringLoopStore(b.loopFile).goal).toBeUndefined();
  });

  it("creates the journal directory, so a first write cannot fail on a missing parent", () => {
    const nested = path.join(dir, "deep", "journal");
    expect(fs.existsSync(nested)).toBe(false);
    const journal = engineeringJournalAt(nested);
    journal.loopStore().freezeGoal(goal());
    expect(fs.existsSync(journal.loopFile)).toBe(true);
  });
});
