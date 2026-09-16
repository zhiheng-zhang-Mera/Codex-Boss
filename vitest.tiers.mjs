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
/**
 * The slow tier: suites that cannot be part of the signal a developer waits for.
 *
 * Declared as a RECORD rather than a list, because "why is this here" is the part that rots. A bare
 * list lets a fast suite be parked here for convenience and lets a genuinely slow one be justified by
 * a comment nobody re-reads. Each entry states its MEASURED cost and which kind it is:
 *
 *   - `spawns` — the suite starts real child processes (a compiler, a test runner, a sandboxed
 *     candidate). This was the original and only accepted reason.
 *   - `in-process` — the suite starts nothing but performs real durable work whose cost is dominated
 *     by the storage engine. Added for the Phase 05 scale suite: it writes 100k real events and 100k
 *     real state writes, measured at ~94s, and the cost is a property of the durable write path
 *     rather than of the test. Requiring it to spawn a process to earn its place would have been
 *     paying theatre to satisfy a rule.
 *
 * `tests/unit/test-layers.test.ts` checks both the reason's presence and, for `spawns`, the evidence
 * in the file.
 */
export const SLOW_ACCEPTANCE_TESTS = {
  // Drives the real implementation loop with a real tsc and a real node --test in a fixture.
  // Measured as a file: ~113s. Its slowest single scenario (C-03) is ~29s alone but exceeded the 60s
  // per-suite ceiling under full-suite parallelism, which turned three otherwise-green commits red —
  // that is why the ceiling in this tier is raised, and why the tier runs one file at a time so the
  // bound is the real one.
  "tests/acceptance/review-loop.test.ts": {
    kind: "spawns",
    measured: "~113s as a file; slowest single scenario ~29s",
    because: "drives the real implementation loop with a real tsc and a real node --test inside a fixture"
  },
  // Spawns real AppContainer-sandboxed children for every containment attack and for its own control
  // case. Its cleanup is incomplete — a passing run left one `codexbossevolution-rt-sandbox*` profile
  // behind (2 → 3) — so the profile count grows over repeated runs and needs clearing after
  // interrupted battery runs.
  "tests/unit/evolution-sandbox.test.ts": {
    kind: "spawns",
    measured: "~45s as a file",
    because: "spawns a real AppContainer-sandboxed child per attack, plus its own control case"
  },
  // Phase 05 Task E / gate 5. Measured as a file: ~94s, of which ~74s is the append loop.
  //
  // The cost is a MEASURED property of the durable write path, not slack in the test: per-event cost
  // rises from 0.22ms to 0.88ms as the journal grows, in ten 10k bands, then plateaus. The queries
  // are not the cause — `EXPLAIN QUERY PLAN` confirms both the idempotency lookup and the id read use
  // their indexes — and the cause is durability: `synchronous=1` with `wal_autocheckpoint=1000` means
  // each checkpoint fsyncs a database file that grows with the journal. That curve is what Task F's
  // soak exists to trend, so it is recorded rather than optimised away, and the test is explicitly
  // NOT made faster by relaxing durability.
  //
  // The book requires the 100k scale, so the requirement is kept and the file is separated for timing
  // instead. Relaxing `synchronous` would have flattered this number and broken Task F's target.
  "tests/unit/platform/scale-synthetic.test.ts": {
    kind: "in-process",
    measured: "~94s as a file (~74s appending 100k events; 10k-band curve 0.22 → 0.88 ms/event)",
    because: "writes 100k real events and 100k real state writes into a real database; no process is started, but the cost is the storage engine's"
  },
  // Phase 05 Task F / gate 6. Runs the whole platform lifecycle repeatedly — state transactions
  // including a deliberate failure and its unattended recovery, event append and cursor replay,
  // knowledge staleness, GC plan and execute, provider degrade and recover, and controlled restarts —
  // sampling memory, CPU, handles, queue lag and database size throughout. ~75s as a file, of which
  // the bulk is the run itself rather than test overhead.
  //
  // This is the shortened CI form of a 24h/72h soak, which the book explicitly allows. What makes the
  // shortening evidence rather than theatre is that the growth bound is SCALED to the time actually
  // run: `SOAK_BOUNDS` allows 512MiB of RSS growth over the 30-minute reference tier, and applied
  // unchanged to a 45-second run it would never bite.
  "tests/unit/platform/platform-soak.test.ts": {
    kind: "in-process",
    measured: "~75s as a file (~45s of soak at the smoke tier's audit floor, plus five further runs)",
    because: "drives the real platform loop against a real database for the tier's full audit duration; no process is started, but the cost is the workload's"
  }
};

/** The suite paths in the slow tier, for the configs that need a list. */
export const SLOW_ACCEPTANCE_TEST_FILES = Object.keys(SLOW_ACCEPTANCE_TESTS);

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
  "tests/unit/closure-terminal-logic.test.ts",
  // Phase 02: spawns a real child process that loads the compiled state core out of
  // dist-electron and then dies mid-work. It cannot run before a build, and unlike the
  // others it MUST NOT be skipped silently — the whole point is that a hard kill does
  // not lose committed work, so it fails loudly rather than passing vacuously.
  "tests/acceptance/state-core-crash.test.ts",
  // Phase 02 gate 7: runs the migration-report generator, which loads the compiled
  // decision-ledger pilot out of dist-electron and performs the migration for real in a
  // temporary data root before writing the artifact.
  "tests/acceptance/state-migration-report.test.ts",
  // Phase 03 gate 7: runs the permission-surface generator, which loads the compiled
  // capability layer, executes the escape battery against a real broker and forks a real
  // plugin under Node's permission model before writing the artifact.
  "tests/acceptance/permission-surface-report.test.ts",
  // Phase 04 gate 7: runs the data-lifecycle generator, which loads the compiled retention and
  // retrieval modules, walks the real state roots and executes a plan through a recording
  // deleter. It also removes a protection marker from the compiled module to prove the
  // generator fails rather than reporting an invariant it did not observe.
  "tests/acceptance/data-lifecycle-report.test.ts",
  // Phase 05 gate 9: runs the platform-certificate generator, which loads the compiled platform
  // (registry, ratchet, permission validator, retention and compatibility models) and re-derives
  // every section rather than transcribing the phase artifacts. It also points the generator at
  // COPIES of the artifacts with a cross-check deliberately broken, to prove it fails closed.
  "tests/acceptance/platform-certificate.test.ts",
  // Phase 05 gate 6: runs the soak-report generator with a short duration, which exercises the real
  // measurement path AND the real failure path — a short run is all warmup, so its trend genuinely
  // exceeds the published allowance and the generator must refuse to certify it.
  "tests/acceptance/platform-soak-report.test.ts",
  // Phase 05 gate 2: runs the pairing generator, which loads the compiled selector and compares a
  // selection against a REAL full-suite run recorded per file. It also exercises the refusal paths
  // with synthetic run records, so a generator that agreed on top of a failing or phantom-pointing
  // run would fail this suite.
  "tests/acceptance/targeted-vs-full.test.ts"
];
