import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILD_DEPENDENT_TESTS,
  LAYER_RULES,
  LAYER_VOCABULARY,
  PLATFORM_QUALIFICATION_TESTS,
  PLATFORM_QUALIFICATION_TEST_FILES,
  POSTBUILD_TESTS,
  PUSH_CI_FORBIDDEN_REQUIREMENTS,
  QUALIFICATION_REQUIREMENTS,
  REAL_HOST_SCALE_TESTS,
  REAL_HOST_SCALE_TEST_FILES,
  SLOW_ACCEPTANCE_TESTS,
  SLOW_ACCEPTANCE_TEST_FILES,
  TEST_TIERS
} from "../../vitest.tiers.mjs";

/**
 * Phase N — the layers are declared, and the declaration is checkable.
 *
 * `vitest.tiers.mjs` says which layer every suite belongs to. This file computes
 * that from the declarations rather than restating it, so the assertions below are
 * about the DECLARATION being true of the repository:
 *
 *  - the vocabulary is exactly the book's eight names, split into the two kinds;
 *  - every test file under `tests/` has exactly one PRIMARY layer, and the
 *    override cannot quietly swallow a directory;
 *  - every NATURE layer is non-empty, and `integration` is checked in both
 *    directions against the imports in the files themselves — the layer is defined
 *    by spawning a process, so a suite that spawns one cannot be missed and a
 *    suite that does not cannot claim it;
 *  - a declared driver exists AND is wired to a package script or a CI step;
 *  - the three tier configurations still agree with the declarations, which is the
 *    drift the single-source-of-truth comment promises but nothing checked.
 */

const PROJECT = process.cwd();
const TEST_ROOT = path.join(PROJECT, "tests");

function allTestFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.test\.tsx?$/.test(entry.name)) found.push(path.relative(PROJECT, full).split(path.sep).join("/"));
    }
  };
  walk(TEST_ROOT);
  return found.sort();
}

/**
 * `tests/unit/**` style glob to a regular expression; the only syntax the
 * declaration uses. A double star followed by a slash matches zero or more
 * directories — the standard glob meaning, and the one the repository's vitest
 * configs already rely on — so the unit pattern covers a file sitting directly in
 * the directory as well as one in a subdirectory.
 */
function globToRegExp(glob: string): RegExp {
  const pattern = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${pattern}$`);
}

const FILES = allTestFiles();

/** The evidence that a suite starts a real child process. */
const SPAWN_MARKERS = /node:child_process|process\/process-gateway|git\/git-gateway|command-runner/;

/** The slow tier's suite paths, in declaration order, for the config-agreement checks. */
const slowFiles = (): string[] => SLOW_ACCEPTANCE_TEST_FILES;

/** Every suite the push-CI tiers own: what `Desktop CI` is allowed to run on a clean push runner. */
const pushCiFiles = (): string[] => [...slowFiles(), ...BUILD_DEPENDENT_TESTS];

/**
 * The workflow that carries the qualification tier's public face, and the one that may never run it.
 *
 * The tier itself is executed on the real soak host, whose runner is registered to the separate private
 * control repository (`Boss-Qualification-Control`) — see the workflow-boundary test below.
 */
const QUALIFICATION_WORKFLOW = ".github/workflows/platform-qualification.yml";
const PUSH_CI_WORKFLOW = ".github/workflows/ci.yml";

/**
 * Every workflow this repository ships, enumerated rather than listed.
 *
 * The boundary is a statement about the whole set, so a hard-coded pair would let a new file slip past it.
 */
const WORKFLOW_DIR = ".github/workflows";

function workflowNames(): string[] {
  return fs.readdirSync(path.join(PROJECT, WORKFLOW_DIR)).filter((name) => /\.ya?ml$/.test(name)).sort();
}

/**
 * The package script that runs a given file, or `undefined`.
 *
 * Used to check a workflow step by the name a reader would use (`pnpm run verify:targeted`) instead of
 * by the script path it happens to expand to, so the assertion survives either being edited.
 */
function scriptFor(file: string): string | undefined {
  const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  return Object.entries(pkg.scripts ?? {}).find(([, command]) => command.includes(file))?.[0];
}

/**
 * What a workflow actually EXECUTES: every non-comment line, joined.
 *
 * A guard that searched the raw file would accept a command that appears only in an explanatory comment,
 * and would fail on a command that is correctly absent but correctly described. Comments are how this
 * repository records why a step exists, so they must not be able to satisfy — or break — an assertion
 * about what runs.
 */
function steps(workflow: string): string {
  return workflow
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

function primaryLayerOf(file: string): string[] {
  return Object.entries(LAYER_RULES)
    .filter(([, rule]) => rule.kind === "primary"
      && (rule.include ?? []).some((glob) => globToRegExp(glob).test(file))
      && !(rule.exclude ?? []).some((glob) => globToRegExp(glob).test(file)))
    .map(([layer]) => layer);
}

function natureMembers(layer: string): string[] {
  const rule = LAYER_RULES[layer];
  if (!rule || rule.kind !== "nature") return [];
  if (layer === "integration") return FILES.filter((file) => SPAWN_MARKERS.test(fs.readFileSync(path.join(PROJECT, file), "utf8")));
  const pattern = rule.match;
  if (typeof pattern !== "string") return [];
  return FILES.filter((file) => new RegExp(pattern).test(file));
}

describe("Phase N — the declared test layers", () => {
  it("uses exactly the book's eight names, in two kinds", () => {
    expect(Object.keys(LAYER_RULES).sort()).toEqual([...LAYER_VOCABULARY].sort());
    expect(LAYER_VOCABULARY.length).toBe(8);
    const primary = Object.values(LAYER_RULES).filter((rule) => rule.kind === "primary").map((rule) => rule.describe);
    const nature = Object.values(LAYER_RULES).filter((rule) => rule.kind === "nature").map((rule) => rule.describe);
    expect(primary.length).toBe(3);
    expect(nature.length).toBe(5);
    // Every layer says what it means; a name with no sentence is a label nobody can use.
    for (const [layer, rule] of Object.entries(LAYER_RULES)) {
      expect(rule.describe, `${layer} has no description`).toBeTruthy();
      expect(rule.kind === "primary" || rule.kind === "nature").toBe(true);
    }
  });

  it("gives every test file exactly one primary layer", () => {
    const unclassified = FILES.filter((file) => primaryLayerOf(file).length === 0);
    const ambiguous = FILES.filter((file) => primaryLayerOf(file).length > 1);
    expect(unclassified).toEqual([]);
    expect(ambiguous).toEqual([]);
    expect(FILES.length).toBeGreaterThan(150);
    // An exclusion has to hand the file to another primary layer: a suite that is
    // excluded and not re-claimed would drop out of the taxonomy silently.
    for (const [layer, rule] of Object.entries(LAYER_RULES)) {
      for (const glob of rule.exclude ?? []) {
        const excluded = FILES.filter((file) => globToRegExp(glob).test(file));
        expect(excluded.length, `${layer} excludes nothing: ${glob}`).toBeGreaterThan(0);
        for (const file of excluded) {
          expect(primaryLayerOf(file).length, `${file} is excluded from ${layer} but claimed by nothing else`).toBe(1);
        }
      }
    }
  });

  it("keeps the desktop claim narrow, so it names a suite rather than a directory", () => {
    const desktop = primaryLayerOf("tests/acceptance/desktop-black-box-contract.test.ts");
    expect(desktop).toEqual(["desktop"]);
    // Everything else in tests/acceptance stays an acceptance suite.
    const claimed = FILES.filter((file) => primaryLayerOf(file)[0] === "desktop");
    expect(claimed).toEqual(["tests/acceptance/desktop-black-box-contract.test.ts"]);
  });

  it("defines integration by evidence, in both directions", () => {
    const members = natureMembers("integration");
    expect(members.length).toBeGreaterThan(0);
    // A suite that imports a spawn surface IS integration…
    const spawners = FILES.filter((file) => /node:child_process/.test(fs.readFileSync(path.join(PROJECT, file), "utf8")));
    expect(spawners.length).toBeGreaterThan(0);
    expect(spawners.filter((file) => !members.includes(file))).toEqual([]);
    // …and nothing is in the layer without one of the declared markers.
    expect(members.filter((file) => !SPAWN_MARKERS.test(fs.readFileSync(path.join(PROJECT, file), "utf8")))).toEqual([]);
  });

  it("leaves no nature layer as a decorative name", () => {
    for (const layer of ["migration", "recovery", "adversarial", "soak"]) {
      const members = natureMembers(layer);
      expect(members.length, `${layer} claims nothing`).toBeGreaterThan(0);
      // The name rule is the definition, so a member must match it.
      const pattern = LAYER_RULES[layer].match;
      if (typeof pattern !== "string") throw new Error(`${layer} declares no file-name pattern`);
      expect(members.filter((file) => !new RegExp(pattern).test(file))).toEqual([]);
    }
  });

  it("names drivers that exist and that something actually runs", () => {
    const wiring = [
      fs.readFileSync(path.join(PROJECT, "package.json"), "utf8"),
      fs.readFileSync(path.join(PROJECT, PUSH_CI_WORKFLOW), "utf8"),
      // Both workflows are wiring: a driver that only the qualification lane runs is still run.
      fs.existsSync(path.join(PROJECT, QUALIFICATION_WORKFLOW)) ? fs.readFileSync(path.join(PROJECT, QUALIFICATION_WORKFLOW), "utf8") : ""
    ].join("\n");
    const drivers = Object.entries(LAYER_RULES).flatMap(([layer, rule]) => (rule.drivers ?? []).map((driver: string) => ({ layer, driver })));
    expect(drivers.length).toBeGreaterThan(0);
    for (const { layer, driver } of drivers) {
      expect(fs.existsSync(path.join(PROJECT, driver)), `${layer} names a missing driver: ${driver}`).toBe(true);
      expect(wiring.includes(path.basename(driver)), `${driver} is not run by a package script or a CI step`).toBe(true);
    }
  });

  it("classifies every suite in a declared tier, and states why the tier exists", () => {
    for (const file of [...pushCiFiles(), ...PLATFORM_QUALIFICATION_TEST_FILES]) {
      expect(fs.existsSync(path.join(PROJECT, file)), `tier names a missing file: ${file}`).toBe(true);
      expect(primaryLayerOf(file).length, `${file} is in a tier but unclassified`).toBe(1);
    }
    for (const [tier, declaration] of Object.entries(TEST_TIERS)) {
      expect(declaration.describe, `${tier} has no reason`).toBeTruthy();
      expect(declaration.layers.length, `${tier} carries no layer`).toBeGreaterThan(0);
      for (const layer of declaration.layers) expect(LAYER_VOCABULARY).toContain(layer);
    }
    // Every slow entry must carry its MEASURED cost and the kind of cost it is, because a bare list
    // lets a fast suite be parked here for convenience. Two kinds are accepted:
    //   - `spawns`: the stated reason is that it starts real processes, so the evidence is checked;
    //   - `in-process`: it starts nothing, so instead of demanding theatre the entry must name a
    //     measurement, and the suite is required to touch real storage to justify the claim that the
    //     cost belongs to the engine rather than to the test.
    for (const [file, declaration] of Object.entries(SLOW_ACCEPTANCE_TESTS)) {
      const source = fs.readFileSync(path.join(PROJECT, file), "utf8");
      const entry = declaration as { kind: string; measured: string; because: string };
      expect(entry.measured, `${file} is slow-tier without a measured cost`).toBeTruthy();
      expect(entry.because, `${file} is slow-tier without a stated reason`).toBeTruthy();
      expect(["spawns", "in-process"], `${file} declares an unknown slow-tier kind`).toContain(entry.kind);
      if (entry.kind === "spawns") {
        expect(SPAWN_MARKERS.test(source), `${file} claims it spawns but starts no process`).toBe(true);
      } else {
        expect(SPAWN_MARKERS.test(source), `${file} is marked in-process but does start a process; declare it as spawning`).toBe(false);
        // The cost claim has to be about real durable work, not a busy loop in memory.
        expect(/openDatabase|createEventJournal|createStateRepository/.test(source), `${file} claims in-process storage cost but never opens a database`).toBe(true);
      }
    }
    // A build-dependent suite must reach the build, directly or through a harness.
    for (const file of BUILD_DEPENDENT_TESTS) {
      expect(/dist|scripts[/\\]/.test(fs.readFileSync(path.join(PROJECT, file), "utf8")), `${file} is postbuild-tier but never reaches the build`).toBe(true);
    }
    // A qualification suite must reach its generator, for the same reason: the dependency has to be
    // visible in the file rather than asserted in a comment.
    for (const file of PLATFORM_QUALIFICATION_TEST_FILES) {
      expect(/dist|scripts[/\\]/.test(fs.readFileSync(path.join(PROJECT, file), "utf8")), `${file} is qualification-tier but never reaches a generator or the build`).toBe(true);
    }
  });

  /**
   * The split between push CI and qualification is only worth anything if it is machine-checkable.
   *
   * A comment saying "these need a host corpus" rots the moment someone adds a suite to the postbuild
   * list for convenience. So every entry in both tiers declares `requires`, and the two rules that make
   * the boundary real are asserted: a push-CI entry may require the BUILD and nothing else, and a
   * qualification entry must declare at least one requirement from the vocabulary — which is exactly a
   * requirement a clean runner cannot satisfy.
   */
  it("keeps qualification-only prerequisites out of every push-CI tier", () => {
    expect(PUSH_CI_FORBIDDEN_REQUIREMENTS.length).toBeGreaterThan(0);
    for (const requirement of PUSH_CI_FORBIDDEN_REQUIREMENTS) {
      expect(QUALIFICATION_REQUIREMENTS, `${requirement} is forbidden in push CI but is not a declared requirement`).toContain(requirement);
    }

    // No push-CI tier entry declares a requirement a clean runner cannot meet.
    for (const file of pushCiFiles()) {
      const declaration = (POSTBUILD_TESTS as Record<string, { requires?: string[]; because?: string }>)[file];
      // The slow tier is a record of a different shape (kind/measured) and declares no `requires`; its
      // contract is its measured cost, checked above.
      if (!declaration) continue;
      const requires = declaration.requires ?? [];
      expect(requires, `${file} is push-CI tier without a declared prerequisite`).toEqual(["build"]);
      for (const requirement of requires) {
        expect(PUSH_CI_FORBIDDEN_REQUIREMENTS, `${file} is in a push-CI tier but requires ${requirement}`).not.toContain(requirement);
      }
      expect(declaration.because, `${file} is push-CI tier without a stated reason`).toBeTruthy();
    }

    // Every qualification entry declares why it cannot be in push CI, and names its official producer.
    for (const [file, declaration] of Object.entries(PLATFORM_QUALIFICATION_TESTS)) {
      const entry = declaration as { requires?: string[]; because?: string; producer?: string };
      expect(entry.because, `${file} is qualification-tier without a stated reason`).toBeTruthy();
      expect(Array.isArray(entry.requires), `${file} is qualification-tier without declared requirements`).toBe(true);
      const requires = entry.requires ?? [];
      expect(requires.length, `${file} declares no requirement, so it has no reason to be here`).toBeGreaterThan(0);
      for (const requirement of requires) {
        expect(QUALIFICATION_REQUIREMENTS, `${file} declares an unknown requirement: ${requirement}`).toContain(requirement);
      }
      // At least one declared requirement must be one a clean push runner cannot satisfy; otherwise the
      // suite belongs in the build-dependent tier and this tier is being used as a parking space.
      expect(requires.filter((requirement) => PUSH_CI_FORBIDDEN_REQUIREMENTS.includes(requirement)).length,
        `${file} declares no qualification-only requirement`).toBeGreaterThan(0);
      // The producer is the official generator, and the suite must actually name it.
      const producer = entry.producer;
      expect(producer, `${file} names no producer for its prerequisite`).toBeTruthy();
      expect(fs.existsSync(path.join(PROJECT, producer as string)), `${file} names a missing producer: ${producer}`).toBe(true);
      expect(fs.readFileSync(path.join(PROJECT, file), "utf8").includes(path.basename(producer as string)),
        `${file} does not name its declared producer ${producer}`).toBe(true);
    }

    // The two push-CI-tier sets and the qualification set are disjoint, so no suite is claimed twice.
    const overlap = PLATFORM_QUALIFICATION_TEST_FILES.filter((file) => pushCiFiles().includes(file));
    expect(overlap, `a suite is in both push CI and the qualification tier: ${overlap.join(", ")}`).toEqual([]);
  });

  /**
   * The workflow boundary: the qualification tier runs on the dedicated real host and from NO workflow this
   * repository ships, and push CI must not run it either.
   *
   * The tier's declared prerequisite is `accumulated-host-corpus` — a property of the Owner's real machine.
   * That is why the runner serving it is registered to the separate private control repository and not here,
   * and why this guard is a universal NEGATIVE over the workflows in this repository. That is STRONGER than
   * the check it replaces, which asserted that exactly one named public workflow ran the tier; it now
   * asserts that none does. What it gives up is the mirror-image positive (that some workflow generates each
   * prerequisite before the tier runs): that workflow lives in the private control repository, where a
   * public-repository test cannot read it, so a public assertion about it would be prose rather than
   * evidence. `tests/unit/root-trust-authority-lockdown.test.ts` pins the pointer and the platform facts.
   *
   * A PRODUCER is not the tier, and the difference is the whole point: a hosted lane may run a generator to
   * REPORT the topology fact — which is exactly what the hosted diagnostic does with the Phase 04 generator,
   * because a refusal that is hidden is worse than one that is shown. But a lane that runs one must state
   * that it is not a qualification host, or a public lane could generate the prerequisites of a
   * qualification it cannot perform and read as one that performed it.
   *
   * Asserted rather than documented, because "we will not call it from CI" is exactly the kind of promise a
   * later convenience edit breaks.
   */
  it("runs the qualification tier from no workflow in this repository, and never from push CI", () => {
    expect(fs.existsSync(path.join(PROJECT, QUALIFICATION_WORKFLOW)), `${QUALIFICATION_WORKFLOW} is missing`).toBe(true);
    const qualification = fs.readFileSync(path.join(PROJECT, QUALIFICATION_WORKFLOW), "utf8");
    const push = fs.readFileSync(path.join(PROJECT, PUSH_CI_WORKFLOW), "utf8");
    // Every declared producer is still wired to a package script. The qualification run in the control plane
    // invokes these by name, so a producer that lost its script would be a prerequisite nobody can generate.
    for (const [file, declaration] of Object.entries(PLATFORM_QUALIFICATION_TESTS)) {
      const producer = (declaration as { producer: string }).producer;
      expect(scriptFor(producer), `${file} declares the prerequisite ${producer}, which is wired to no package script`).toBeTruthy();
    }
    // The public qualification lane is explicitly triggered, not run on every push.
    expect(/workflow_dispatch:/.test(qualification), "the qualification workflow is not dispatchable").toBe(true);
    expect(/^ {2}push:/m.test(qualification), "the qualification workflow triggers on every push").toBe(false);
    // No workflow in this repository runs the tier. Its prerequisite is a real host corpus, so a lane here
    // claiming to run the tier would be claiming a qualification it cannot honestly perform.
    const workflows = workflowNames();
    expect(workflows.length, "no workflows to check").toBeGreaterThan(0);
    for (const name of workflows) {
      const executed = steps(fs.readFileSync(path.join(PROJECT, WORKFLOW_DIR, name), "utf8"));
      // The assertion is against STEP lines rather than against the whole file: a command named only in a
      // comment is documentation, and treating prose as evidence is exactly the failure this guard exists to
      // prevent (the first version of this check matched its own explanatory comment).
      expect(executed.includes("test:platform-qualification"), `${name} has a step that runs the qualification tier`).toBe(false);
      for (const [file, declaration] of Object.entries(PLATFORM_QUALIFICATION_TESTS)) {
        const producer = (declaration as { producer: string }).producer;
        const script = scriptFor(producer) as string;
        if (!executed.includes(script) && !executed.includes(producer)) continue;
        expect(executed.includes("HOSTED_RUNNER_NOT_A_QUALIFICATION_HOST"),
          `${name} runs ${file}'s prerequisite ${producer} without stating that it is not a qualification host`).toBe(true);
      }
    }
    // Push CI in particular runs neither the tier nor its producers. `Desktop CI` is the only workflow
    // reachable from an untrusted push, so this is the half that must never regress.
    expect(steps(push).includes("test:platform-qualification"), "push CI has a step that runs the qualification tier").toBe(false);
    for (const declaration of Object.values(PLATFORM_QUALIFICATION_TESTS)) {
      const producer = (declaration as { producer: string }).producer;
      const script = scriptFor(producer) as string;
      expect(steps(push).includes(producer), `push CI has a step that runs a qualification prerequisite: ${producer}`).toBe(false);
      expect(steps(push).includes(script), `push CI has a step that runs a qualification prerequisite: ${script}`).toBe(false);
    }
    // And push CI still runs the tiers it is responsible for, as STEPS.
    for (const step of ["pnpm test", "pnpm run test:postbuild", "pnpm run test:slow"]) {
      expect(steps(push).includes(step), `push CI has no step running: ${step}`).toBe(true);
    }
  });

  /**
   * The trust-epoch cadence, pinned so the routing mistake this repository has already made once cannot
   * recur silently.
   *
   * An earlier revision moved `pnpm run acceptance:autonomous-evolution` out of push CI, reasoning from
   * `judgeSelfCertification` alone that a commit touching the Root Trust Surface can never pass — and
   * `.github/workflows/ci.yml` is Root Trust Surface. The reasoning was wrong about the CALLER: the
   * acceptance gate compares the surface with ITSELF (`assessRootTrustChange({ baseline: entries,
   * candidate: entries })`), so `rootTrustTouched` is false there and the binding condition is whether the
   * committed trust epoch anchors the live surface. A Root Trust change therefore needs
   * `scripts/acceptance-evolution-bless.cjs --advance` in the SAME commit, and CI is the run that certifies
   * the new epoch (`docs/phase-status.md` records epochs 11 and 13 doing exactly that).
   *
   * Three things are asserted, and each one is load-bearing:
   *   1. the refusal invariant is real — a genuinely touched surface may never self-certify;
   *   2. the committed epoch DOES anchor the live Root Trust Surface, which is the whole condition the
   *      graduation gate actually tests, and which turns a silent acceptance failure into a local one;
   *   3. the graduation gate runs in the ordinary acceptance chain, not somewhere it can be forgotten.
   */
  it("keeps the graduation gate in push CI and the committed epoch anchored to the live surface", async () => {
    const trust = await import("../../src/shared/autonomous-evolution-trust");
    expect(trust.classifySurface(".github/workflows/ci.yml"), ".github/workflows/ci.yml is no longer Root Trust Surface").toBe("ROOT_TRUST_SURFACE");

    // (1) The invariant that made the wrong conclusion plausible, asserted through two real inventories.
    const touched = trust.assessRootTrustChange({
      baseline: [{ path: ".github/workflows/ci.yml", sha256: "a".repeat(64) }],
      candidate: [{ path: ".github/workflows/ci.yml", sha256: "b".repeat(64) }]
    });
    expect(touched.rootTrustTouched).toBe(true);
    expect(touched.verdict).toBe("ROOT_TRUST_CHANGE");
    const refusal = trust.judgeSelfCertification({ epoch: null, rootTrustChange: touched, runId: "test-layers" });
    expect(refusal.allowed).toBe(false);
    expect(refusal.code).toBe("SELF_CERTIFICATION_FORBIDDEN");
    expect(refusal.required_action).toBe("TRUST_EPOCH_MIGRATION");

    // (2) The condition the graduation gate really tests. If this fails, a Root Trust file changed without
    // advancing the epoch, and `acceptance:autonomous-evolution` will refuse on any machine.
    const { collectRootSurfaceEntries } = await import("../../electron/engineering/autonomous-evolution-surface");
    const surface = trust.rootSurfaceManifest(collectRootSurfaceEntries(PROJECT));
    const epoch = JSON.parse(fs.readFileSync(path.join(PROJECT, trust.TRUST_EPOCH_FILENAME), "utf8"));
    expect(trust.verifyTrustEpochFile({ value: epoch, rootSurfaceHash: surface.aggregate_hash }),
      "the committed trust epoch does not anchor the live Root Trust Surface; run `node scripts/acceptance-evolution-bless.cjs --advance` in the same commit as the change").toEqual([]);

    // (3) The routing, measured on step lines so a comment cannot satisfy it.
    const graduation = "acceptance:autonomous-evolution";
    expect(steps(fs.readFileSync(path.join(PROJECT, PUSH_CI_WORKFLOW), "utf8")).includes(graduation),
      "push CI no longer runs the trust-epoch graduation gate").toBe(true);
  });

  it("keeps the tier configurations in agreement with the declaration", async () => {
    const unit = (await import("../../vitest.unit.config.mjs")).default;
    const slow = (await import("../../vitest.slow.config.mjs")).default;
    const postbuild = (await import("../../vitest.postbuild.config.mjs")).default;
    const qualification = (await import("../../vitest.qualification.config.mjs")).default;
    const realHostScale = (await import("../../vitest.real-host-scale.config.mjs")).default;
    expect(slow.test?.include).toEqual(slowFiles());
    expect(postbuild.test?.include).toEqual(BUILD_DEPENDENT_TESTS);
    // The qualification tier has its own configuration, and it must carry exactly the declared suites:
    // a suite that fell out of both tiers would run nowhere, which is the failure this whole split risks.
    expect(qualification.test?.include).toEqual(PLATFORM_QUALIFICATION_TEST_FILES);
    expect(PLATFORM_QUALIFICATION_TEST_FILES.length).toBeGreaterThan(0);
    // The REAL_HOST_SCALE execution tier has its own configuration for the same reason, and `maxWorkers: 1`
    // is part of it: a scale measurement taken under parallel load is not the measurement it claims to be.
    expect(realHostScale.test?.include).toEqual(REAL_HOST_SCALE_TEST_FILES);
    expect(REAL_HOST_SCALE_TEST_FILES.length).toBeGreaterThan(0);
    expect(realHostScale.test?.maxWorkers).toBe(1);
    expect(realHostScale.test?.fileParallelism).toBe(false);
    // The default tier is "everything except the declared groups", and its
    // include has to still cover every suite the layers describe.
    expect(unit.test?.include).toEqual(["tests/**/*.test.ts"]);
    for (const file of [...pushCiFiles(), ...PLATFORM_QUALIFICATION_TEST_FILES, ...REAL_HOST_SCALE_TEST_FILES]) {
      expect(unit.test?.exclude, `${file} is not excluded from the default tier`).toContain(file);
    }
    // The declared groups partition cleanly: no suite is in two of them.
    const all = [...slowFiles(), ...BUILD_DEPENDENT_TESTS, ...PLATFORM_QUALIFICATION_TEST_FILES, ...REAL_HOST_SCALE_TEST_FILES];
    expect(new Set(all).size, "a suite is declared in more than one tier").toBe(all.length);
  });

  /**
   * PF-DEBT-019: `REAL_HOST_SCALE` is an EXECUTION tier, and it is a different thing from the qualification
   * tier. Both are run by the private real-host control plane; they prove different evidence and must not be
   * merged into one list to save a declaration.
   *
   * The qualification tier's meaning is machine-enforced in the tier test above: a qualification suite must
   * genuinely depend on qualification-generated evidence (a phase artifact, a full-suite pairing record, an
   * accumulated host corpus). The real-host scale case requires NONE of that — it needs a machine whose
   * storage is controlled — so putting it in `PLATFORM_QUALIFICATION_TESTS` would have been a lie, and adding
   * a fake producer reference to force it through would have been a worse one. This test pins the distinction
   * in both directions, and pins the public repository's inability to run the tier at all.
   */
  it("keeps the real-host-scale tier distinct from qualification, and unreachable from every public workflow", () => {
    // 1. It names real files, and every entry says why it exists, how much work it does and where it runs.
    expect(REAL_HOST_SCALE_TEST_FILES.length).toBeGreaterThan(0);
    for (const file of REAL_HOST_SCALE_TEST_FILES) {
      expect(fs.existsSync(path.join(PROJECT, file)), `real-host-scale names a missing suite: ${file}`).toBe(true);
    }
    for (const [file, declaration] of Object.entries(REAL_HOST_SCALE_TESTS)) {
      const entry = declaration as { because?: string; events?: number; budgetMs?: number; runsOn?: string } & Record<string, unknown>;
      expect(entry.because, `${file} declares no reason to be in this tier`).toBeTruthy();
      expect(entry.events, `${file} declares no scale volume`).toBeGreaterThan(0);
      expect(entry.budgetMs, `${file} declares no budget`).toBeGreaterThan(0);
      expect(entry.runsOn, `${file} does not say where it is allowed to run`).toBeTruthy();
      // It must NOT wear qualification clothing: no declared qualification prerequisite, no producer.
      expect("requires" in entry, `${file} declares qualification requirements while sitting in the real-host-scale tier`).toBe(false);
      expect("producer" in entry, `${file} names a qualification producer while sitting in the real-host-scale tier`).toBe(false);
    }

    // 2. It is in no other execution group, and no other group claims it. This is the half that makes the
    //    tier boundary real rather than decorative: a file duplicated into the slow tier would still be run
    //    by hosted CI, and PF-DEBT-019 would be back.
    for (const file of REAL_HOST_SCALE_TEST_FILES) {
      expect(slowFiles(), `${file} is also declared in the slow tier`).not.toContain(file);
      expect(BUILD_DEPENDENT_TESTS, `${file} is also declared in the postbuild tier`).not.toContain(file);
      expect(PLATFORM_QUALIFICATION_TEST_FILES, `${file} is falsely classified as a qualification suite`).not.toContain(file);
    }

    // 3. The scale claim is still made, at the volume and budget PF-DEBT-019 is about — and both are declared
    //    here, so shrinking either is a visible edit rather than a quiet one.
    expect(REAL_HOST_SCALE_TEST_FILES).toContain("tests/unit/platform/durable-event-real-host-scale.test.ts");
    const scale = REAL_HOST_SCALE_TESTS["tests/unit/platform/durable-event-real-host-scale.test.ts" as keyof typeof REAL_HOST_SCALE_TESTS];
    expect(scale.events).toBe(100_000);
    expect(scale.budgetMs).toBe(600_000);
    const scaleSource = fs.readFileSync(path.join(PROJECT, "tests/unit/platform/durable-event-real-host-scale.test.ts"), "utf8");
    expect(scaleSource, "the real-host scale case no longer appends 100k events").toContain("const EVENTS = 100_000;");
    expect(scaleSource, "the real-host scale budget moved; PF-DEBT-019 was closed by moving the case, not by raising it").toContain("}, 600_000);");

    // 4. The hosted required CI keeps the CONTRACT at a bounded volume, and says plainly which claim it is not.
    const correctnessSource = fs.readFileSync(path.join(PROJECT, "tests/unit/platform/durable-event-correctness.test.ts"), "utf8");
    expect(correctnessSource, "the hosted contract case no longer names the tier that owns the 100k claim")
      .toContain("The 100k claim is owned by `REAL_HOST_SCALE`");
    expect(correctnessSource, "the bounded hosted case must not append 100k events").toContain("const EVENTS = 10_000;");
    expect(/100_000\s*;/.test(correctnessSource), "the bounded hosted case declares the scale volume").toBe(false);

    // 5. NO workflow in this PUBLIC repository may run the tier, asserted against step lines over every
    //    workflow file. Same rule as the qualification tier, for the same reason: the public repository
    //    cannot schedule evidence that belongs to the controlled host.
    const workflows = workflowNames();
    expect(workflows.length).toBeGreaterThan(0);
    for (const name of workflows) {
      const executed = steps(fs.readFileSync(path.join(PROJECT, WORKFLOW_DIR, name), "utf8"));
      expect(executed.includes("test:real-host-scale"),
        `${name} executes the real-host-scale tier, which belongs to the private control plane`).toBe(false);
      expect(executed.includes("vitest.real-host-scale.config.mjs"),
        `${name} names the real-host-scale config directly, which is the same thing by another route`).toBe(false);
    }
  });
});
