import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P2-A — the capability closure validator, and the two-model disagreement it exists to make visible.
 *
 * WHY THIS PROGRAM EXISTS
 *
 *   The repository carries TWO ownership declarations. `config/capabilities/*.yaml` (27 manifests) declares 25
 *   module paths; `config/capability-modules.json` owns 597 of the 613 scanned source files. Every number
 *   downstream depends on which one a reader picked: the test-impact selector's blast radius, the catalogue's
 *   `covers`, and the enforcement baseline's `declared_owned_files` (25 against 597). Nothing failed when the two
 *   disagreed, which is how the disagreement survived long enough to be described in a report.
 *
 *   `scripts/capability-closure-validator.cjs` fails on that disagreement and on the other untruths shape
 *   validation cannot see, and these cases pin it in BOTH directions: the real repository PASSES, and each rule
 *   FAILS on a fixture that breaks exactly it. A validator tested only against the passing tree is a validator
 *   that would pass on any tree.
 *
 * WHAT THIS FILE DOES NOT CLAIM
 *
 *   It does not claim the ownership map is the RIGHT model. 597 owned files against 25 declared manifest modules
 *   is a measurement, not a vindication: choosing one model is P2-A's design act, recorded in
 *   `docs/city/PHASE2_ARCHITECTURE_MIGRATION_SPEC.md`, and the validator's job is to fail until the two agree —
 *   not to decide which one wins.
 */

const PROJECT = process.cwd();
const SCRIPT = "scripts/capability-closure-validator.cjs";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const validator = require(path.join(PROJECT, SCRIPT)) as {
  validate: (root: string) => {
    scannedSourceFiles: number;
    manifests: number;
    problems: string[];
    findings: {
      declaredModulePaths: number;
      stalePaths: Array<{ manifest: string; path: string }>;
      directoryDeclaredAsModule: Array<{ manifest: string; path: string }>;
      bootOrSurfaceNotDeclaredInModules: Array<{ manifest: string; path: string }>;
      ownedFiles: number;
      exemptEntries: number;
      doubleClaims: Array<{ file: string; owners: string[] }>;
      missingExemptionReasons: string[];
      ownedAndExempt: string[];
      unowned: string[];
      withoutDeclaredPurpose: string[];
      mapWithoutManifest: string[];
      manifestWithoutMap: string[];
      declaredButUnowned: Array<{ path: string; declaredBy: string[] }>;
      modelsAgree: boolean;
    };
  };
  ownsPath: (entries: string[], file: string) => boolean;
};

/** Run the CLI against the real repository and report its verdict. */
function runCli(): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, "--json"], { cwd: PROJECT, encoding: "utf8", timeout: 120000 });
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

const MANIFEST = (id: string, modules: string[], boot: string[] = [], provides = [`${id}.thing@1`]) => `id: ${id}
version: 1.0.0
kind: feature
provides:
${provides.map((entry) => `  - ${entry}`).join("\n")}
requires: []
optional: []
state: []
health:
  critical: false
modules:
${modules.map((entry) => `  - ${entry}`).join("\n") || "  []"}
bootModules:
${boot.map((entry) => `  - ${entry}`).join("\n") || "  []"}
surface: []
permissions: []
`;

/**
 * A fixture repository carrying only what the validator reads: two scan roots, some source files, one manifest
 * directory and one ownership map. Everything else about the real repository is irrelevant to it, which is what
 * makes these cases fast and honest.
 */
function fixture(options: {
  files?: Record<string, string>;
  manifests?: Record<string, string>;
  ownership?: { capabilities: Record<string, string[]>; exempt: Record<string, string> };
}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "p2a-closure-"));
  const write = (relative: string, content: string) => {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, "utf8");
  };
  for (const [relative, content] of Object.entries(options.files ?? { "electron/a.ts": "export const a = 1;\n" })) {
    write(relative, content);
  }
  for (const [name, content] of Object.entries(options.manifests ?? { "alpha.yaml": MANIFEST("alpha", ["electron/a.ts"], ["electron/a.ts"]) })) {
    write(path.join("config", "capabilities", name), content);
  }
  write("config/capability-modules.json", `${JSON.stringify(options.ownership ?? { capabilities: { alpha: ["electron/a.ts"] }, exempt: {} }, null, 2)}\n`);
  return root;
}

function validateFixture(root: string) {
  // In-process against the fixture root. The validator takes an explicit root precisely so a rule can be exercised
  // against a tree that breaks only that rule: a validator tested only against the passing tree would pass on any
  // tree, which is the failure mode this whole file exists to avoid.
  const report = validator.validate(root);
  return { status: report.problems.length === 0 ? 0 : 1, report };
}

describe("P2-A — the real repository passes the closure validator", () => {
  it("VERDICT=PASS on the committed tree, and the CLI agrees", () => {
    const run = runCli();
    expect(run.status, `the closure validator fails on the committed tree: ${run.stdout}${run.stderr}`).toBe(0);
    const report = JSON.parse(run.stdout.slice(run.stdout.indexOf("{"))) as ReturnType<typeof validator.validate>;
    expect(report.problems).toEqual([]);
    expect(report.findings.modelsAgree, "the two ownership models disagree on the committed tree").toBe(true);
    expect(report.findings.unowned, "a source file is owned by no capability and exempt from none").toEqual([]);
    expect(report.findings.ownedAndExempt, "a file is both owned and exempt").toEqual([]);
    expect(report.findings.doubleClaims, "a file is claimed by two capabilities").toEqual([]);
  });

  it("measures the disagreement between the two models, and reports it rather than judging it", () => {
    const report = validator.validate(PROJECT);
    // These are the P2-A starting measurements. Asserted as PROPERTIES rather than as constants so the case does
    // not have to be edited every time a file is added -- but the two models being far apart IS the point, so a
    // change that silently made them agree would be visible here.
    expect(report.scannedSourceFiles).toBeGreaterThan(500);
    expect(report.findings.declaredModulePaths, "the manifests declare fewer than 20 module paths").toBeGreaterThan(20);
    expect(report.findings.ownedFiles, "the ownership map owns fewer files than the manifests declare modules").toBeGreaterThan(report.findings.declaredModulePaths);
    // The map's exemption table, after the owned-and-exempt repair: the renderer, and nothing else.
    expect(report.findings.exemptEntries, `the exemption table has grown: ${JSON.stringify(report.findings.exemptEntries)}`).toBe(1);
    for (const [entry, reason] of Object.entries(validator.readOwnershipMap().exempt)) {
      expect(reason.length, `the exemption ${entry} carries no substantive reason`).toBeGreaterThan(20);
    }
  });

  it("the validator's own matching rule mirrors the selector's, including directory ownership", () => {
    // If this rule drifted from `test-impact.ts:217-222`, the validator would be judging a different question than
    // the selector answers -- and the two would disagree about coverage without either being wrong.
    expect(validator.ownsPath(["electron/platform"], "electron/platform/test-impact.ts")).toBe(true);
    expect(validator.ownsPath(["electron/platform"], "electron/platform")).toBe(true);
    expect(validator.ownsPath(["electron/platform"], "electron/platform-extra.ts")).toBe(false);
    expect(validator.ownsPath(["electron/platform/"], "electron/platform/a.ts")).toBe(true);
    expect(validator.ownsPath(["electron/state-core.ts"], "electron/state-core/a.ts")).toBe(false);
  });
});

describe("P2-A — each rule fails on a fixture that breaks exactly it", () => {
  it("a stale declared module path is a failure, and is named", () => {
    const root = fixture({ manifests: { "alpha.yaml": MANIFEST("alpha", ["electron/a.ts", "electron/absent.ts"]) }, ownership: { capabilities: { alpha: ["electron/a.ts"] }, exempt: {} } });
    const { status, report } = validateFixture(root);
    expect(status, "a manifest declaring a path that does not exist passed").toBe(1);
    expect(report.findings.stalePaths.map((entry) => entry.path)).toContain("electron/absent.ts");
  });

  it("a DIRECTORY declared as a module is a failure: the loader reads modules as files", () => {
    const root = fixture({
      files: { "electron/a.ts": "export const a = 1;\n", "electron/dir/b.ts": "export const b = 1;\n" },
      manifests: { "alpha.yaml": MANIFEST("alpha", ["electron/dir"]) },
      ownership: { capabilities: { alpha: ["electron/dir"] }, exempt: {} },
    });
    const { status, report } = validateFixture(root);
    expect(status, "a directory declared as a module passed").toBe(1);
    expect(report.findings.directoryDeclaredAsModule.map((entry) => entry.path)).toContain("electron/dir");
  });

  it("a boot module outside `modules` is a failure", () => {
    const root = fixture({ manifests: { "alpha.yaml": MANIFEST("alpha", ["electron/a.ts"], ["electron/not-listed.ts"]) } });
    const { status, report } = validateFixture(root);
    expect(status).toBe(1);
    expect(report.findings.bootOrSurfaceNotDeclaredInModules.map((entry) => entry.path)).toContain("electron/not-listed.ts");
  });

  it("an unowned, unexempted source file is a failure — the selector's blind spot", () => {
    const root = fixture({ files: { "electron/a.ts": "export const a = 1;\n", "electron/orphan.ts": "export const o = 1;\n" } });
    const { status, report } = validateFixture(root);
    expect(status, "a source file owned by nobody passed").toBe(1);
    expect(report.findings.unowned).toContain("electron/orphan.ts");
  });

  it("two capabilities claiming one file is a failure, and both owners are named", () => {
    const root = fixture({ ownership: { capabilities: { alpha: ["electron/a.ts"], beta: ["electron/a.ts"] }, exempt: {} }, manifests: { "alpha.yaml": MANIFEST("alpha", ["electron/a.ts"]), "beta.yaml": MANIFEST("beta", ["electron/a.ts"]) } });
    const { status, report } = validateFixture(root);
    expect(status).toBe(1);
    expect(report.findings.doubleClaims.map((entry) => entry.file)).toContain("electron/a.ts");
    expect(report.findings.doubleClaims[0].owners.sort()).toEqual(["alpha", "beta"]);
  });

  it("a file that is BOTH owned and exempt is a failure — the contradiction this repair removed", () => {
    const root = fixture({ ownership: { capabilities: { alpha: ["electron/a.ts"] }, exempt: { "electron/a.ts": "a reason long enough to be substantive" } } });
    const { status, report } = validateFixture(root);
    expect(status, "an owned-and-exempt file passed").toBe(1);
    expect(report.findings.ownedAndExempt).toContain("electron/a.ts");
  });

  it("an exemption with no substantive reason is a failure", () => {
    const root = fixture({ files: { "electron/a.ts": "export const a = 1;\n", "electron/b.ts": "export const b = 1;\n" }, ownership: { capabilities: { alpha: ["electron/a.ts"] }, exempt: { "electron/b.ts": "because" } } });
    const { status, report } = validateFixture(root);
    expect(status, "an exemption with no reason passed").toBe(1);
    expect(report.findings.missingExemptionReasons).toContain("electron/b.ts");
  });

  it("a capability with no declared external purpose is a failure", () => {
    const root = fixture({ manifests: { "alpha.yaml": MANIFEST("alpha", ["electron/a.ts"], ["electron/a.ts"], []) } });
    const { status, report } = validateFixture(root);
    expect(status, "a capability declaring no provided id passed").toBe(1);
    expect(report.findings.withoutDeclaredPurpose).toEqual(["config/capabilities/alpha.yaml"]);
  });

  it("the two models disagreeing is a failure, and the direction of the disagreement is reported", () => {
    // The map owns a capability no manifest declares.
    const extraCapability = fixture({ ownership: { capabilities: { alpha: ["electron/a.ts"], ghost: ["electron/ghost.ts"] }, exempt: {} } });
    const first = validateFixture(extraCapability);
    expect(first.status, "a map naming a capability with no manifest passed").toBe(1);
    expect(first.report.findings.mapWithoutManifest).toEqual(["ghost"]);

    // A declared module the declaring capability's own map entry does not own.
    const unownedDeclaration = fixture({ ownership: { capabilities: { alpha: ["electron/other.ts"] }, exempt: {} }, files: { "electron/a.ts": "export const a = 1;\n", "electron/other.ts": "export const o = 1;\n" } });
    const second = validateFixture(unownedDeclaration);
    expect(second.status, "a declared module the declaring capability does not own passed").toBe(1);
    expect(second.report.findings.declaredButUnowned.map((entry) => entry.path)).toContain("electron/a.ts");
  });

  it("a manifest that is absent from the ownership map is a failure", () => {
    const root = fixture({ manifests: { "alpha.yaml": MANIFEST("alpha", ["electron/a.ts"]), "beta.yaml": MANIFEST("beta", []) }, ownership: { capabilities: { alpha: ["electron/a.ts"] }, exempt: {} } });
    const { status, report } = validateFixture(root);
    expect(status, "a manifest absent from the ownership map passed").toBe(1);
    expect(report.findings.manifestWithoutMap).toEqual(["beta"]);
  });

  it("every problem in a broken tree is reported, not just the first", () => {
    const root = fixture({
      files: { "electron/a.ts": "export const a = 1;\n", "electron/orphan.ts": "export const o = 1;\n" },
      manifests: { "alpha.yaml": MANIFEST("alpha", ["electron/a.ts", "electron/absent.ts"], ["electron/not-listed.ts"], []), "beta.yaml": MANIFEST("beta", []) },
      ownership: { capabilities: { alpha: ["electron/a.ts"], ghost: ["electron/x.ts"] }, exempt: { "electron/a.ts": "a substantive reason for an owned file" } },
    });
    const { status, report } = validateFixture(root);
    expect(status).toBe(1);
    // Four independent classes at once: stale path, boot-not-in-modules, owned-and-exempt, unowned, no purpose,
    // map-without-manifest, manifest-without-map. A validator that reported only the first would hide six.
    expect(report.problems.length, `only ${report.problems.length} problem class(es) reported: ${report.problems.join("; ")}`).toBeGreaterThanOrEqual(5);
  });
});

describe("P2-A — the validator is not satisfiable by emptying the declarations", () => {
  it("a manifest with no modules over real files cannot make coverage pass by declaring nothing", () => {
    // This is the specific evasion the workbook forbids: `modules: []` is not an exemption, it is an untruth when
    // the capability owns code. The fixture's only file is owned by the map, so coverage passes -- but the moment
    // the file is owned by nobody, the unowned check fires, whatever any manifest says.
    const root = fixture({ files: { "electron/a.ts": "export const a = 1;\n" }, manifests: { "alpha.yaml": MANIFEST("alpha", []) }, ownership: { capabilities: { alpha: [] }, exempt: {} } });
    const { status, report } = validateFixture(root);
    expect(status, "declaring nothing made an unowned file disappear").toBe(1);
    expect(report.findings.unowned).toContain("electron/a.ts");
  });

  it("the script is loadable by a plain Node process, like every other scripts/*.cjs", () => {
    const probe = spawnSync(process.execPath, ["-e", `const m=require(${JSON.stringify(path.join(PROJECT, SCRIPT))}); if(!m.validate) process.exit(1);`], { encoding: "utf8", timeout: 60000 });
    expect(probe.status, `the validator could not be loaded by plain node: ${probe.stderr}`).toBe(0);
  });
});
