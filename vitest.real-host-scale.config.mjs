import { defineConfig } from "vitest/config";
import { REAL_HOST_SCALE_TEST_FILES } from "./vitest.tiers.mjs";

/**
 * The REAL_HOST_SCALE execution tier (PF-DEBT-019).
 *
 * These suites appends 100 000 durable events, one commit at a time, into a real database file and verify
 * them across a close and reopen. The CONTRACT is deterministic; the COST is the storage stack's, which is
 * why this tier exists as a separate, explicitly-invoked execution class rather than as part of the hosted
 * merge gate. Measured on four GitHub-hosted runners with identical code: 326 718 / 442 269 / 543 823 /
 * 548 153 ms against a 600 s budget — a 1.68x spread that no fixed hosted budget absorbs honestly. The full
 * reasoning, and the rejected alternatives, are in `docs/pf-debt-019-gate-tiering-proposal.md`.
 *
 * This config is executed by the PRIVATE real-host control plane, never by a workflow in this public
 * repository; `tests/unit/test-layers.test.ts` asserts that absence across every workflow file. The tier is
 * NOT the platform-qualification tier: those suites need qualification-generated evidence (phase artifacts,
 * a full-suite pairing record, an accumulated host corpus) and this one needs none of it. A test here still
 * belongs to its normal layer taxonomy — `tests/unit/**` is the `unit` primary layer — so the book's eight
 * layer names are untouched by an execution tier that only says WHERE the cost can be paid.
 *
 * The per-test budget is NOT set here: the 100k case declares its own unchanged 600 000 ms ceiling in the
 * file, next to the reasoning for it. This config deliberately does not raise any budget to make the tier
 * pass — moving the case to a controlled host was the fix.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: REAL_HOST_SCALE_TEST_FILES,
    // One file at a time, so the measurement is the real bound rather than a guess about parallel load.
    maxWorkers: 1,
    fileParallelism: false,
    pool: "forks"
  }
});
