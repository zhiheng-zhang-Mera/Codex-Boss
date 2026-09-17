/**
 * The autonomous engineering journal's on-disk layout — declared once, here.
 *
 * ## Why this module exists
 *
 * `EngineeringLoopStore` and `EngineeringRecoveryLedger` persist two different documents for one
 * engineering run, and before this module nothing owned the fact that they are two. Every caller
 * derived the paths itself:
 *
 *   - `electron/commander/main-commander.ts` built the loop store and the recovery ledger separately,
 *     each with its own `path.join(ledger.root, "..", …)`;
 *   - `electron/self-evolution/self-evolution-coordinator.ts` built its own over a different root.
 *
 * The hazard was not tidiness. The recovery ledger's own comment claimed it is *"deliberately separate
 * from the iteration rows: a recovery event must not overwrite the iteration's findings"* — but nothing
 * enforced the separation, and the two documents are mutually destructive: the loop store's reader
 * **requires** an `iterations` array and throws `Invalid engineering loop file` without one, while the
 * recovery ledger writes `{ schemaVersion, events }`. One file, two writers, and the loop store reports
 * its own journal as corrupt.
 *
 * A second hazard hid in the derivation itself: `recoveryLedgerFor(file)` built a sibling of whatever
 * path it was handed, so passing a DIRECTORY silently produced a path that looked plausible and was not
 * the intended location. A helper that accepts the wrong kind of path and invents an answer is worse
 * than one that refuses.
 *
 * ## The rule this module establishes
 *
 * The journal DIRECTORY is the input, and this module says what lives in it. Returned together, in one
 * object that reports its own directory, so a caller cannot pair a loop store from one run with a
 * recovery ledger from another — and a test can compare the roots rather than trust them.
 */

import fs from "node:fs";
import path from "node:path";
import { EngineeringLoopStore } from "./engineering-loop-store";
import { EngineeringRecoveryLedger } from "./engineering-recovery";

/** The files that make up one engineering journal. Two concerns, two documents. */
export const ENGINEERING_JOURNAL_FILES = {
  /** The frozen goal and its iteration rows. */
  loop: "engineering-loop.json",
  /** Terminal recovery decisions, kept apart so an event cannot erase the findings a run ended on. */
  recovery: "engineering-recovery.json"
} as const;

export interface EngineeringJournal {
  /** The directory both documents live in. Reported so a caller can see which root it resolved. */
  readonly directory: string;
  readonly loopFile: string;
  readonly recoveryFile: string;
  /** The iteration/goal store. A new instance per call, over the shared resolved path. */
  loopStore(): EngineeringLoopStore;
  /** The recovery ledger. A new instance per call, over the shared resolved path. */
  recoveryLedger(): EngineeringRecoveryLedger;
}

/**
 * Resolve the journal that belongs to one engineering root.
 *
 * `directory` is a directory, and the missing-parent case is handled here: a first write into a journal
 * that does not exist yet creates it, rather than failing on a path someone forgot to `mkdir`.
 */
export function engineeringJournalAt(directory: string): EngineeringJournal {
  const resolved = path.resolve(directory);
  const loopFile = path.join(resolved, ENGINEERING_JOURNAL_FILES.loop);
  const recoveryFile = path.join(resolved, ENGINEERING_JOURNAL_FILES.recovery);
  return {
    directory: resolved,
    loopFile,
    recoveryFile,
    loopStore: () => {
      fs.mkdirSync(resolved, { recursive: true });
      return new EngineeringLoopStore(loopFile);
    },
    recoveryLedger: () => {
      fs.mkdirSync(resolved, { recursive: true });
      return new EngineeringRecoveryLedger(recoveryFile);
    }
  };
}
