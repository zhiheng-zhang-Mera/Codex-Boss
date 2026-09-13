/**
 * Test tier definitions (convergence book, Phase N).
 *
 * Two tiers exist for a measured reason, not a stylistic one. The suites listed
 * here spawn and drive real operating-system processes — real `tsc`, real
 * `node --test`, real AppContainer-sandboxed children — and take tens of seconds
 * each, so they are not part of the signal a developer waits for. One of them also
 * genuinely fails under full-suite parallelism: `review-loop`'s slowest scenario
 * crosses the default per-test ceiling. A file belongs here when it starts real
 * processes of its own, and it must earn its way back out with a measurement.
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
 * The split is a timing decision, and it is measured as one. The two files below
 * do NOT conflict: run together in a single default-config invocation on a clean
 * machine they pass, 25/25 in 116.6s. An earlier reading that they conflicted was
 * a misattribution — 83 stale `codexbossevolution-rt-sandbox*` AppContainer
 * profiles, left behind by interrupted evolution-battery runs, made the sandbox
 * suite fail wholesale including its own CONTROL case, and clearing the profiles
 * restored it. `pnpm run test:slow` is therefore one invocation; this config
 * already runs the list one file at a time, and separate processes were solving a
 * problem that was never theirs.
 */
export const SLOW_ACCEPTANCE_TESTS = [
  // Drives the real implementation loop with a real tsc and a real node --test in a
  // fixture. Measured as a file: ~113s. Its slowest single scenario (C-03) is
  // ~29s alone but exceeded the 60s per-test ceiling under full-suite parallelism,
  // which turned three otherwise-green commits red — that is why the ceiling here
  // is raised, and why the tier runs one file at a time so the bound is real.
  "tests/acceptance/review-loop.test.ts",
  // Spawns real AppContainer-sandboxed children for every containment attack and
  // for its own control case: ~45s measured. Its cleanup is incomplete — a passing
  // run left one `codexbossevolution-rt-sandbox*` profile behind (2 → 3) — so the
  // profile count grows over repeated runs and needs clearing after interrupted
  // battery runs.
  "tests/unit/evolution-sandbox.test.ts"
];
