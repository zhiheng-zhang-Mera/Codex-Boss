/**
 * Test tier definitions (convergence book, Phase N).
 *
 * Two tiers exist for a measured reason, not a stylistic one. The suites listed
 * here spawn and drive real operating-system processes — real `tsc`, real
 * `node --test`, real AppContainer-sandboxed children — and take tens of seconds
 * each. Under full-suite parallelism they do not merely run slowly: they fail. A
 * file belongs here when it starts real processes of its own, and it must earn its
 * way back out with a measurement.
 *
 * The list lives in one place so the three configurations below cannot drift:
 *
 *   vitest.config.mjs       everything (what an explicit `vitest run <file>` and
 *                           the acceptance harnesses that name their own suite use)
 *   vitest.unit.config.mjs  the default `pnpm test` tier — everything except this list
 *   vitest.slow.config.mjs  this list only, one file at a time, with a bounded ceiling
 *
 * A file left in the default tier must earn it: it has to be fast enough to be
 * part of the signal a developer waits for.
 *
 * The two files below also cannot share one vitest invocation: run together, the
 * sandbox suite fails as a whole — its own capability probe included — because the
 * real OS state the previous suite leaves behind is exactly what it needs to
 * create. `pnpm run test:slow` therefore invokes each in its own process, and a
 * file added here needs its own invocation for the same reason.
 */
export const SLOW_ACCEPTANCE_TESTS = [
  // Drives the real implementation loop with a real tsc and a real node --test in a
  // fixture: ~28s alone, over the 60s per-test ceiling under full-suite load.
  "tests/acceptance/review-loop.test.ts",
  // Spawns real AppContainer-sandboxed children for every containment attack and
  // for its own control case: ~45s alone, and the whole suite — control case
  // included — failed under the load of the default parallel run.
  "tests/unit/evolution-sandbox.test.ts"
];
