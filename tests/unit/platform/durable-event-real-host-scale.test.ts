import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { runDurableEventContract, temporaryDatabaseRoot } from "../../helpers/durable-event-contract";

/**
 * 100k REAL-HOST SCALE EVIDENCE.
 *
 * This file owns the scale claim: **100 000 durable events**, appended one durable call at a time into a
 * real database file, read back through the paged cursor, replayed for idempotency, and verified again after
 * a close and reopen. It is NOT a hosted merge gate. It runs under the `test:real-host-scale` execution tier
 * (`REAL_HOST_SCALE_TEST_FILES` in `vitest.tiers.mjs`), which `vitest.real-host-scale.config.mjs` runs, and
 * which the PRIVATE real-host control plane executes — never a public workflow. `tests/unit/test-layers.test.ts`
 * enforces that absence rather than trusting it.
 *
 * Why the scale case is not a hosted gate: the contract itself is deterministic, but the COST of this volume
 * is a property of the machine's storage stack. Measured on GitHub-hosted runners with identical code, this
 * case took 326 718 ms, 442 269 ms, 543 823 ms and 548 153 ms — a 1.68x spread — while the budget is 600 s.
 * A budget inside the machine's own variance cannot be defended by making the code faster, so the scale
 * evidence moved to a host whose storage is controlled. The full reasoning and the rejected alternatives are
 * in `docs/pf-debt-019-gate-tiering-proposal.md`.
 *
 * The hosted required CI keeps the same contract machinery at 10 000 events in
 * `tests/unit/platform/durable-event-correctness.test.ts`. Both call `runDurableEventContract`, so the two
 * evidence classes cannot drift into two different definitions of "the journal is correct".
 */

const EVENTS = 100_000;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe("REAL_HOST_SCALE — 100k durable events stay consistent", () => {
  it("appends 100k events with monotone sequences, no duplicates and no loss", () => {
    const root = temporaryDatabaseRoot("boss-real-host-scale-");
    dirs.push(root);

    const outcome = runDurableEventContract({ eventCount: EVENTS, root });

    expect(outcome.eventCount).toBe(EVENTS);
    expect(outcome.statsEvents).toBe(EVENTS);
    expect(outcome.statsMaxSequence).toBe(EVENTS);
    expect(outcome.quarantined, "an event was quarantined during a clean write sequence").toBe(0);
    expect(outcome.head).toBe(EVENTS);
    expect(outcome.distinctIds).toBe(EVENTS);
    expect(outcome.aggregateEvents).toBe(EVENTS / 500);
    // Idempotency at scale: the replay re-used rows instead of adding them.
    expect(outcome.recountedEvents).toBe(EVENTS);
    // Durability: 100k events accepted into WAL but never committed would look identical to 100k events
    // durably stored until the process that could tell them apart exits.
    expect(outcome.reopenedEvents).toBe(EVENTS);
    expect(outcome.reopenedHead).toBe(EVENTS);
    expect(outcome.lastIdempotencyKey).toBe(`k-${EVENTS - 1}`);

    // A machine-readable line so the private control plane can record the measurement without parsing
    // vitest's rendering. It carries counts and durations only — no paths, no payloads.
    console.log(`[real-host-scale] events=${EVENTS} appendMs=${outcome.measurement.appendMillis} readbackMs=${outcome.measurement.readbackMillis} reopenMs=${outcome.measurement.reopenMillis} totalMs=${outcome.measurement.totalMillis} result=PASS`);

    expect(outcome.measurement.appendMillis).toBeGreaterThan(0);
    // The budget below is a TIME BUDGET, not part of the gate: the report above says the book's priority at
    // scale is correctness. It exists only so a slow durable write path is allowed to finish instead of being
    // killed mid-work. It is UNCHANGED at 600 000 ms, and it was not raised to close PF-DEBT-019 — the case
    // moved to a machine whose storage is controlled instead. Measured on the real host, this case runs in
    // minutes, not tens of minutes; the budget stays as the fail-loud backstop it always was.
  }, 600_000);
});
