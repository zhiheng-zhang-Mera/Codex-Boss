import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILD_DEPENDENT_TESTS,
  LAYER_RULES,
  LAYER_VOCABULARY,
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
      fs.readFileSync(path.join(PROJECT, ".github/workflows/ci.yml"), "utf8")
    ].join("\n");
    const drivers = Object.entries(LAYER_RULES).flatMap(([layer, rule]) => (rule.drivers ?? []).map((driver: string) => ({ layer, driver })));
    expect(drivers.length).toBeGreaterThan(0);
    for (const { layer, driver } of drivers) {
      expect(fs.existsSync(path.join(PROJECT, driver)), `${layer} names a missing driver: ${driver}`).toBe(true);
      expect(wiring.includes(path.basename(driver)), `${driver} is not run by a package script or a CI step`).toBe(true);
    }
  });

  it("classifies every suite in a declared tier, and states why the tier exists", () => {
    for (const file of [...slowFiles(), ...BUILD_DEPENDENT_TESTS]) {
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
  });

  it("keeps the tier configurations in agreement with the declaration", async () => {
    const unit = (await import("../../vitest.unit.config.mjs")).default;
    const slow = (await import("../../vitest.slow.config.mjs")).default;
    const postbuild = (await import("../../vitest.postbuild.config.mjs")).default;
    expect(slow.test?.include).toEqual(slowFiles());
    expect(postbuild.test?.include).toEqual(BUILD_DEPENDENT_TESTS);
    // The default tier is "everything except the two declared groups", and its
    // include has to still cover every suite the layers describe.
    expect(unit.test?.include).toEqual(["tests/**/*.test.ts"]);
    for (const file of [...slowFiles(), ...BUILD_DEPENDENT_TESTS]) {
      expect(unit.test?.exclude, `${file} is not excluded from the default tier`).toContain(file);
    }
  });
});
