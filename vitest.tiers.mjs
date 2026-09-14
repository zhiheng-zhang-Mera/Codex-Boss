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
 * The list lives in one place so the four configurations below cannot drift:
 *
 *   vitest.config.mjs           everything (what an explicit `vitest run <file>` and
 *                               the acceptance harnesses that name their own suite use)
 *   vitest.unit.config.mjs      the default `pnpm test` tier — everything except both
 *                               lists below
 *   vitest.slow.config.mjs      SLOW_ACCEPTANCE_TESTS only, one file at a time
 *   vitest.postbuild.config.mjs BUILD_DEPENDENT_TESTS only, after `pnpm run build`
 *
 * A file left in the default tier must earn it: it has to be fast enough to be part
 * of the signal a developer waits for, and it has to run from the sources alone.
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

/**
 * The test layers (convergence book, Phase N).
 *
 * The vocabulary is the book's eight names. They answer two different questions,
 * so they are declared as two kinds rather than one flat list:
 *
 *  - a **primary** layer says what environment a suite needs, and every test file
 *    under `tests/` has exactly one. Three exist: `unit` (in-process, runs from
 *    the sources alone), `acceptance` (an attested scenario driven end to end
 *    against the real host code) and `desktop` (the black-box contract produced by
 *    launching the real application). `desktop` claims one suite away from
 *    `acceptance`, because that suite asserts what the Electron driver observed.
 *  - a **nature** layer says what a suite is about, and a suite may have several:
 *    an acceptance scenario that drives a real compiler is also `integration`.
 *
 * The nature layers are DEFINED BY EVIDENCE rather than by a hand list, so they
 * cannot rot or be padded:
 *
 *  - `integration` — the file starts a real child process (it imports
 *    `node:child_process`, the process gateway, the git gateway or the engineering
 *    command runner). The evidence is the import, not the name, so this layer
 *    cannot be claimed by a suite that does not spawn anything and cannot miss one
 *    that does;
 *  - `migration`, `recovery`, `adversarial`, `soak` — the file's own name says so,
 *    which is checked in both directions.
 *
 * A layer that names a driver declares it: `desktop` and `soak` are partly driven
 * by scripts rather than by vitest, and a driver is only real if a package script
 * or a CI step runs it.
 *
 * `tests/unit/test-layers.test.ts` computes all of this and asserts it, including
 * that the three tier configurations below still agree with these declarations.
 */
/**
 * The shape of one layer declaration, so the guard test can read it without a
 * cast and a reader can see which fields a layer of each kind carries.
 *
 * @typedef {object} LayerRule
 * @property {"primary" | "nature"} kind  What question the layer answers.
 * @property {string} describe            One sentence: what the layer means.
 * @property {string[]} [include]         Primary only: the globs it claims.
 * @property {string[]} [exclude]         Primary only: files claimed by a narrower primary layer.
 * @property {string} [match]             Nature only: the file-name pattern that defines it.
 * @property {string[]} [drivers]         Scripts that drive this layer outside vitest.
 */

/** @type {Record<string, LayerRule>} */
export const LAYER_RULES = {
  unit: {
    kind: "primary",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    describe: "In-process: constructs modules and asserts on them without starting anything."
  },
  acceptance: {
    kind: "primary",
    include: ["tests/acceptance/**/*.test.ts"],
    // One suite is claimed by `desktop` instead: it asserts the black-box contract
    // the Electron driver produced, so it belongs to the layer that runs the driver.
    // A primary layer may exclude a file ONLY into another primary layer, which
    // `tests/unit/test-layers.test.ts` checks, so nothing can fall out of the taxonomy.
    exclude: ["tests/acceptance/desktop-black-box-contract.test.ts"],
    describe: "An attested scenario driven end to end against the real host code."
  },
  desktop: {
    kind: "primary",
    include: ["tests/acceptance/desktop-black-box-contract.test.ts"],
    drivers: ["scripts/acceptance-desktop-workbook.cjs", "scripts/acceptance-restart.cjs"],
    describe: "Launches the real application (offscreen when headless) and asserts what the renderer did."
  },
  integration: {
    kind: "nature",
    describe: "Starts a real child process: a compiler, a test runner, git, or a sandboxed candidate."
  },
  migration: {
    kind: "nature",
    match: "migration",
    describe: "Reads a previous durable layout and proves it moves forward without loss."
  },
  recovery: {
    kind: "nature",
    match: "recovery|rollback",
    describe: "Proves a failed or interrupted action leaves recoverable, truthful state."
  },
  adversarial: {
    kind: "nature",
    match: "adversarial|red-team",
    describe: "Attacks a boundary and requires the boundary to hold."
  },
  soak: {
    kind: "nature",
    match: "soak",
    drivers: ["scripts/acceptance-soak.cjs"],
    describe: "Runs for a long time or over many rounds, where the failure mode is accumulation."
  }
};

/** The eight layer names, so a rename cannot quietly drop one. */
export const LAYER_VOCABULARY = [
  "unit", "integration", "acceptance", "desktop", "migration", "recovery", "adversarial", "soak"
];

/** Why each tier exists, and which layers it carries. */
export const TEST_TIERS = {
  unit: { layers: ["unit", "acceptance", "desktop", "integration", "migration", "recovery", "adversarial"], describe: "pnpm test — the signal a developer waits for." },
  slow: { layers: ["integration", "acceptance"], describe: "pnpm run test:slow — suites that compile and execute real projects." },
  postbuild: { layers: ["acceptance", "integration"], describe: "pnpm run test:postbuild — suites that read the real build output." }
};

/**
 * The build-dependent tier (Phase N): files that read the REAL `dist/` and
 * `dist-electron/` output, so they cannot run until something has built the app.
 *
 * Measured, not assumed. With `dist/` and `dist-electron/` renamed away, `pnpm test`
 * failed 2 tests and 2 suites — `A-05`, `EV-15` and two closure-harness cases — while
 * the remaining 1840 tests passed. They are listed here so `pnpm test` can mean "the
 * signal that needs nothing but the sources", which is what a clean checkout has.
 *
 * This is not a weakening: each file still runs in CI, through its own explicit
 * `pnpm run test:postbuild` step after the build, and the acceptance ones are also
 * run by the gate scripts that name them directly through the complete
 * `vitest.config.mjs`.
 */
export const BUILD_DEPENDENT_TESTS = [
  // A-05 reads the compiled application's own architecture evidence out of the build.
  "tests/acceptance/architecture-discovery.test.ts",
  // EV-15 walks the real dist/ + dist-electron/ pair to verify the build manifest
  // against the artifacts it describes.
  "tests/acceptance/autonomous-evolution-identity.test.ts",
  // Spawns the closure acceptance harnesses, which `require` compiled modules.
  "tests/unit/closure-terminal-logic.test.ts"
];
