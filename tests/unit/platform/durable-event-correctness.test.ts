import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  runDurableEventContract,
  runRollbackAtomicityCheck,
  temporaryDatabaseRoot
} from "../../helpers/durable-event-contract";

/**
 * CORRECTNESS EVIDENCE — NOT SCALE EVIDENCE.
 *
 * This does not prove the 100k scale claim. The 100k claim is owned by `REAL_HOST_SCALE`.
 *
 * `tests/unit/platform/durable-event-real-host-scale.test.ts` is the one that appends 100 000 events, and it
 * runs on the real host under the `test:real-host-scale` execution tier, because the cost of 100k durable
 * appends is dominated by the shared hosted runner's filesystem/WAL behaviour rather than by the product.
 * That measurement is in `docs/pf-debt-019-gate-tiering-proposal.md`: identical code took 326 718 ms on one
 * hosted runner and 548 153 ms on another, a 1.68x spread that no fixed hosted budget can absorb honestly.
 *
 * What this file proves, on every push and pull request, is the CONTRACT — the same machinery the scale case
 * drives, at a volume a shared runner can decide deterministically:
 *
 *   - 100 000 -> 10 000 events: durability across close/reopen, strict sequence monotonicity, no loss and no
 *     repeat across a paged readback, per-aggregate ordering, the UNIQUE(producer, idempotency_key) contract
 *     (a replay returns the ORIGINAL durable row, never the one this call supplied), stats/head, and
 *     rolled-back transactions leaving nothing behind.
 *
 * The volume was chosen by measurement, not by convenience. On this host: 1 000 events -> 95 ms, 5 000 ->
 * 463 ms, 10 000 -> 788 ms of appending, so 10 000 costs under a second locally and a few seconds on a
 * hosted runner, against the default tier's 60 s per-test ceiling. It is the highest measured volume that
 * exercises every relevant code path — three paged read batches instead of one, a duplicate check across
 * many aggregates, and a reopen — with roughly an order of magnitude of margin on a shared runner.
 */

const EVENTS = 10_000;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("the durable-event contract, at a volume the hosted runner can decide", () => {
  it("holds every property the 100k scale case holds, at 10k events", () => {
    const root = temporaryDatabaseRoot("boss-durable-contract-");
    dirs.push(root);

    const outcome = runDurableEventContract({ eventCount: EVENTS, root });

    expect(outcome.eventCount).toBe(EVENTS);
    expect(outcome.statsEvents).toBe(EVENTS);
    expect(outcome.statsMaxSequence).toBe(EVENTS);
    expect(outcome.quarantined).toBe(0);
    expect(outcome.head).toBe(EVENTS);
    expect(outcome.distinctIds).toBe(EVENTS);
    expect(outcome.aggregateEvents).toBe(EVENTS / 500);
    // The replay sample re-used rows rather than adding them.
    expect(outcome.recountedEvents).toBe(EVENTS);
    // …and everything is still there after a close and reopen of the same file.
    expect(outcome.reopenedEvents).toBe(EVENTS);
    expect(outcome.reopenedHead).toBe(EVENTS);
    expect(outcome.lastIdempotencyKey).toBe(`k-${EVENTS - 1}`);
    expect(outcome.replayedKey).toBe("k-0");

    // Recorded, never asserted as a budget: the book's priority at this volume is correctness.
    expect(outcome.measurement.appendMillis).toBeGreaterThan(0);
    expect(outcome.measurement.totalMillis).toBeGreaterThanOrEqual(outcome.measurement.appendMillis);
  }, 60_000);

  it("keeps a rolled-back transaction out of the journal, and commits the same work when it succeeds", () => {
    const root = temporaryDatabaseRoot("boss-durable-rollback-");
    dirs.push(root);

    const outcome = runRollbackAtomicityCheck({ root, writes: 2_000 });

    expect(outcome.rolledBackEvents).toBe(0);
    expect(outcome.rolledBackStateRows).toBe(0);
    expect(outcome.committedEvents).toBe(2_000);
    expect(outcome.committedStateRows).toBe(2_000);
  }, 60_000);
});
