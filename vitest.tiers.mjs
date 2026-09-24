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
 * The lists live in one place so the five configurations below cannot drift:
 *
 *   vitest.config.mjs                 everything (what an explicit `vitest run <file>`
 *                                     and the acceptance harnesses that name their own
 *                                     suite use)
 *   vitest.unit.config.mjs            the default `pnpm test` tier — everything except
 *                                     the three declared groups below
 *   vitest.slow.config.mjs            SLOW_ACCEPTANCE_TESTS only, one file at a time
 *   vitest.postbuild.config.mjs       POSTBUILD_TESTS only, after `pnpm run build`
 *   vitest.qualification.config.mjs   PLATFORM_QUALIFICATION_TESTS only, after the
 *                                     qualification prerequisites have been generated
 *
 * The last two are two halves of what used to be one tier, split on a measured fact rather than on
 * taste. A suite belongs in the POSTBUILD tier when a clean checkout that has run `pnpm run build`
 * can satisfy it — that is what `Desktop CI` runs on every push. It belongs in the QUALIFICATION tier
 * when it additionally needs evidence that only a qualification run produces: generated phase
 * artifacts, a real full-suite pairing record, or a host corpus accumulated over long runs. Two of the
 * qualification suites were failing on the hosted runner for exactly that reason while passing on a
 * developer machine, which is the signature of a tier that was asking a clean runner for history it
 * cannot have. `tests/unit/test-layers.test.ts` checks the split mechanically, including that no
 * push-CI tier entry declares a qualification-only prerequisite.
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
    measured: "1.33s as a file (3 tests) now that the 100k durable-event case has been extracted to the REAL_HOST_SCALE tier; it was ~94s as a file (~74s of it appending 100k events) while that case lived here, and it stays declared in this tier rather than being moved for neatness",
    because: "still writes real events and real state writes into a real database — rollback atomicity at 2 000 writes and four coexisting projects — so no process is started, but the cost is the storage engine's"
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
  },
  // The slowest suite in the default tier, by a factor: measured at 91 867 ms as a file in the green `unit` job of
  // run 35997570148, against the next slowest default-tier suite's 28 645 ms. Its file duration is 1.53x the
  // default tier's 60s PER-TEST ceiling, so individual cases inside it are running close to that ceiling, and it
  // has already turned two green commits red on `main`:
  //
  //   run 35989272641 (main at 0429d59d)  unit FAILED  AD-36  Error: Test timed out in 60000ms.
  //   run 35977080133 (main at e121d84)   unit FAILED  AD-36  the same way
  //
  // Both were re-run on the IDENTICAL commit and returned all five green, which is what makes this a timing
  // problem rather than a defect -- and why the answer is the measure the tier split already applies to
  // `review-loop.test.ts`, whose ~29s slowest scenario "exceeded the 60s default per-test ceiling under the load
  // of a full parallel run, failing green commits three times". This is the same mechanism at a larger size.
  "tests/acceptance/autonomous-evolution-adversarial.test.ts": {
    kind: "spawns",
    measured: "91 867 ms as a file in the green unit job of run 35997570148; AD-36 timed out at 60 000 ms in run 35989272641 and in run 35977080133, and both were green on a re-run of the same commit",
    because: "drives real adversarial scenarios end to end, including a build artifact produced by a real compiler and then copied from a previous commit, which is what AD-36 asserts"
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
  postbuild: { layers: ["acceptance", "integration"], describe: "pnpm run test:postbuild — suites that read the real build output and need nothing else, so a clean push runner satisfies them." },
  qualification: { layers: ["acceptance", "integration", "soak"], describe: "pnpm run test:platform-qualification — frozen Foundation gates that additionally need generated phase artifacts, a real full-suite pairing record, or a host corpus accumulated by real soak runs. Run on the real soak host by the qualification workflow in the separate private control repository (Boss-Qualification-Control), never by push CI and never by any workflow in this repository." },
  "real-host-scale": { layers: ["unit"], describe: "pnpm run test:real-host-scale — the REAL_HOST_SCALE execution tier: suites whose contract is deterministic but whose required SCALE makes their cost depend on host-local storage, so a shared hosted runner cannot decide them honestly. Run on the real soak host by the private control-plane workflow, as a SEPARATE evidence class from the platform-qualification tier; never by push CI and never by any workflow in this repository." }
};

/**
 * The build-dependent tier: files that read the REAL `dist/` and `dist-electron/`
 * output, so they cannot run until something has built the app.
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
 *
 * Declared as a RECORD rather than a list, for the same reason the slow tier is: `requires` is the
 * part that rots. Every entry here declares `-- requires: ["build"]` and nothing else, which is the
 * whole claim this tier makes and the claim a push runner can honour. An entry that needs generated
 * phase artifacts, a full-suite pairing record or an accumulated host corpus does NOT belong here;
 * it belongs in PLATFORM_QUALIFICATION_TESTS below. The generator entries (`state-migration-report`,
 * `permission-surface-report`, `platform-soak-report`) do run here, because each performs its own
 * work in a temporary root and needs the build alone.
 */
export const POSTBUILD_TESTS = {
  // A-05 reads the compiled application's own architecture evidence out of the build.
  "tests/acceptance/architecture-discovery.test.ts": {
    requires: ["build"],
    because: "reads the compiled application's own architecture evidence out of the build"
  },
  // EV-15 walks the real dist/ + dist-electron/ pair to verify the build manifest
  // against the artifacts it describes.
  "tests/acceptance/autonomous-evolution-identity.test.ts": {
    requires: ["build"],
    because: "walks the real dist/ + dist-electron/ pair to verify the build manifest against the artifacts it describes"
  },
  // Spawns the closure acceptance harnesses, which `require` compiled modules.
  "tests/unit/closure-terminal-logic.test.ts": {
    requires: ["build"],
    because: "spawns the closure acceptance harnesses, which require compiled modules"
  },
  // Phase 02: spawns a real child process that loads the compiled state core out of
  // dist-electron and then dies mid-work. It cannot run before a build, and unlike the
  // others it MUST NOT be skipped silently — the whole point is that a hard kill does
  // not lose committed work, so it fails loudly rather than passing vacuously.
  "tests/acceptance/state-core-crash.test.ts": {
    requires: ["build"],
    because: "spawns a real child that loads the compiled state core out of dist-electron and dies mid-work"
  },
  // Phase 02 gate 7: runs the migration-report generator, which loads the compiled
  // decision-ledger pilot out of dist-electron and performs the migration for real in a
  // temporary data root before writing the artifact.
  "tests/acceptance/state-migration-report.test.ts": {
    requires: ["build"],
    because: "runs the migration-report generator against the compiled decision-ledger pilot in a temporary data root"
  },
  // Phase 03 gate 7: runs the permission-surface generator, which loads the compiled
  // capability layer, executes the escape battery against a real broker and forks a real
  // plugin under Node's permission model before writing the artifact.
  "tests/acceptance/permission-surface-report.test.ts": {
    requires: ["build"],
    because: "runs the permission-surface generator, which executes the escape battery against a real broker"
  },
  // Phase 05 gate 6: runs the soak-report generator with a short duration, which exercises the real
  // measurement path AND the real failure path — a short run is all warmup, so its trend genuinely
  // exceeds the published allowance and the generator must refuse to certify it.
  "tests/acceptance/platform-soak-report.test.ts": {
    requires: ["build"],
    because: "runs the soak-report generator short, so its trend genuinely exceeds the published allowance"
  },
  // Root Trust Authority Lockdown: attacks the authority boundary — and two of its cases run the real
  // blessing and proposal CLIs (which load the compiled trust module out of dist-electron) and assert the
  // observed exit codes, because "Boss cannot run `--advance`" is only a fact if the refusal is observed
  // rather than described.
  "tests/unit/root-trust-authority-lockdown.test.ts": {
    requires: ["build"],
    because: "spawns the blessing and proposal CLIs, which load the compiled trust module out of dist-electron"
  }
};

/** The suite paths in the build-dependent tier, for the configs that need a list. */
export const BUILD_DEPENDENT_TESTS = Object.keys(POSTBUILD_TESTS);

/**
 * The prerequisite vocabulary. Each name is a thing a suite needs BEYOND the build, and each one is a
 * property of the RUN rather than of the code, so it cannot be conjured by a clean checkout:
 *
 *   - `phase-artifact`             a generated Phase 01-04 artifact under `artifacts/platform-foundation`
 *   - `full-suite-record`          a per-file record of a REAL full unit-tier run, plus the selector pairing
 *   - `accumulated-host-corpus`    a state corpus that only real, long-running host activity produces
 *
 * `PUSH_CI_FORBIDDEN_REQUIREMENTS` is the point of the exercise: none of these may appear in a tier that
 * push CI runs, because a hosted runner has no honest way to satisfy them. Keeping the list here rather
 * than in a comment is what lets `tests/unit/test-layers.test.ts` check it.
 */
export const QUALIFICATION_REQUIREMENTS = ["phase-artifact", "full-suite-record", "accumulated-host-corpus"];

/** Requirements that disqualify a suite from any tier `Desktop CI` runs on a clean push runner. */
export const PUSH_CI_FORBIDDEN_REQUIREMENTS = QUALIFICATION_REQUIREMENTS;

/**
 * The platform-qualification tier (Phase 01-05 frozen gates).
 *
 * These are the suites that were failing on the hosted runner while passing on the machine they were
 * written on. The causes were all the same shape — the suite needed history or evidence that a clean
 * checkout does not have — and the honest response is to say so in one place instead of asking a push
 * runner for it:
 *
 *   - Phase 04 gate 7 walks the real state roots and requires the discovered corpus to exceed 1000
 *     files, because the retention policy it verifies is a policy about accumulation. Measured: a
 *     hosted runner sees 56 files, a developer host sees ~71367, of which ~65125 are `artifacts/host-soak`
 *     soak residue. The invariant is NOT lowered, NOT made conditional on `CI`, and no filler corpus is
 *     manufactured; the gate simply runs where a real corpus exists.
 *   - Phase 05 gate 9 (the certificate) cross-checks the Phase 01-04 artifacts. It used to consume them
 *     from sibling tests in the same parallel tier, which is a dependency on another suite's side effect
 *     and is a race, not a prerequisite. Each artifact now has its own official generator, invoked as an
 *     explicit step in the qualification workflow before this tier starts, in real dependency order.
 *   - Phase 05 gate 2 compares the selector against a REAL full-suite run, which `pnpm run verify:targeted`
 *     produces by executing the whole unit tier. That is minutes of work and a record that must exist
 *     before the suite runs, so it is a prerequisite of the qualification chain rather than something
 *     every push silently re-derives.
 *
 * `producer` names the official generator, and it is checked twice: the script must exist, and it must be
 * invoked by the qualification workflow. `tests/unit/test-layers.test.ts` asserts both, and asserts that
 * push CI runs none of these files.
 */
export const PLATFORM_QUALIFICATION_TESTS = {
  // Phase 04 gate 7: runs the data-lifecycle generator, which loads the compiled retention and
  // retrieval modules, walks the real state roots and executes a plan through a recording
  // deleter. It also removes a protection marker from the compiled module to prove the
  // generator fails rather than reporting an invariant it did not observe.
  "tests/acceptance/data-lifecycle-report.test.ts": {
    requires: ["accumulated-host-corpus"],
    producer: "scripts/data-lifecycle-report.cjs",
    because: "walks the real state roots and requires a discovered corpus over 1000 files, which only accumulated host activity produces"
  },
  // Phase 05 gate 9: runs the platform-certificate generator, which loads the compiled platform
  // (registry, ratchet, permission validator, retention and compatibility models) and re-derives
  // every section rather than transcribing the phase artifacts. It also points the generator at
  // COPIES of the artifacts with a cross-check deliberately broken, to prove it fails closed.
  "tests/acceptance/platform-certificate.test.ts": {
    requires: ["phase-artifact"],
    producer: "scripts/platform-certificate.cjs",
    because: "cross-checks the generated Phase 01-04 artifacts, each of which must be produced by its own generator first"
  },
  // Phase 05 gate 2: runs the pairing generator, which loads the compiled selector and compares a
  // selection against a REAL full-suite run recorded per file. It also exercises the refusal paths
  // with synthetic run records, so a generator that agreed on top of a failing or phantom-pointing
  // run would fail this suite.
  "tests/acceptance/targeted-vs-full.test.ts": {
    requires: ["full-suite-record"],
    producer: "scripts/verify-targeted-vs-full.cjs",
    because: "needs the per-file record of a real full unit-tier run, which the pairing generator produces by running that tier"
  }
};

/** The suite paths in the platform-qualification tier, for the config that needs a list. */
export const PLATFORM_QUALIFICATION_TEST_FILES = Object.keys(PLATFORM_QUALIFICATION_TESTS);

/**
 * The REAL_HOST_SCALE execution tier (PF-DEBT-019).
 *
 * An EXECUTION tier, not a layer: a suite here still belongs to its normal primary/nature taxonomy
 * (`tests/unit/**` is the `unit` primary layer), and `LAYER_VOCABULARY` stays the book's eight names. What
 * this tier declares is a different question — WHERE the suite's cost can honestly be paid:
 *
 *   tests whose correctness contract is deterministic,
 *   but whose required SCALE makes their execution cost
 *   materially dependent on host-local storage / hardware
 *   and therefore unsuitable as a shared hosted-runner merge gate.
 *
 * This is NOT the platform-qualification tier, and the distinction is machine-enforced by
 * `tests/unit/test-layers.test.ts` in both directions: a qualification suite must genuinely depend on
 * qualification-generated evidence (phase artifacts, a full-suite pairing record, an accumulated real-host
 * corpus), and the suite below requires NONE of those. It also must not be smuggled into that tier by adding
 * a fake producer reference, which is why it is declared here instead.
 *
 * Measured, not assumed: the 100k durable-event case took 326 718 / 442 269 / 543 823 / 548 153 ms on four
 * GitHub-hosted runners with IDENTICAL code — a 1.68x spread against a 600 s budget. The contract is
 * deterministic; the cost is the machine's storage stack. The public repository therefore does NOT execute
 * this tier at all: no workflow in `.github/workflows/` may run `test:real-host-scale`, which
 * `tests/unit/test-layers.test.ts` asserts across every workflow file. The private real-host control plane
 * runs it, together with the qualification tier, as a SEPARATE evidence class.
 *
 * The same contract machinery is exercised on every push by
 * `tests/unit/platform/durable-event-correctness.test.ts` at a bounded volume, so the merge gate keeps the
 * correctness evidence while the scale claim moves to a machine whose storage is controlled.
 */
export const REAL_HOST_SCALE_TESTS = {
  "tests/unit/platform/durable-event-real-host-scale.test.ts": {
    events: 100_000,
    budgetMs: 600_000,
    because:
      "appends 100 000 durable events one commit at a time into a real database file and verifies them across a close and reopen; the contract is deterministic but the cost is the storage stack's, measured at a 1.68x spread across four hosted runners against a 600 s budget",
    runsOn: "the private real-host control plane (test:real-host-scale), never a hosted runner and never a workflow in this public repository"
  }
};

/** The suite paths in the real-host-scale execution tier, for the config that needs a list. */
export const REAL_HOST_SCALE_TEST_FILES = Object.keys(REAL_HOST_SCALE_TESTS);
