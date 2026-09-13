/**
 * Test tier definitions (convergence book, Phase N).
 *
 * Two tiers exist for a measured reason, not a stylistic one. The suites listed
 * here compile and execute real projects inside a fixture — real `tsc`, real
 * `node --test` — and take tens of seconds each. Under full-suite parallelism one
 * of them (`tests/acceptance/review-loop.test.ts`, ~28s alone) repeatedly hit the
 * 60s per-test ceiling and turned green commits red.
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
 */
export const SLOW_ACCEPTANCE_TESTS = ["tests/acceptance/review-loop.test.ts"];
