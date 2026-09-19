import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authoritySurfacesOf,
  collectSelfFacts,
  readArchitectureBaseline,
  readBootWiring,
  readCapabilityManifest,
  readScripts,
  sourceFiles,
  type SelfFactOptions
} from "../../../electron/self-cognition/facts";
import { buildSelfModel } from "../../../src/shared/self-cognition/anatomy";
import { authorityOf, describeSelf } from "../../../src/shared/self-cognition/describe";
import { ProtectedSurfaceGuard } from "../../../electron/root-authority/protected-surface-guard";

/**
 * The self-cognition boundary, on THIS repository.
 *
 * Three claims are tested here and each is a structural one:
 *
 *   - the facts come from the real repository, so the model describes Boss and not a fixture;
 *   - the authority verdicts are the repository's own classifier's, checked against two paths whose
 *     tiers are not in doubt;
 *   - the module cannot diagnose, cannot mutate and cannot authorize -?enforced by reading its own
 *     source and its own answers rather than by trusting the docstring.
 */

const REPO = path.resolve(__dirname, "..", "..", "..");
const dirs: string[] = [];
function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-self-cognition-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("the facts are the repository's own", () => {
  const facts = collectSelfFacts({ repositoryRoot: REPO });
  const model = buildSelfModel(facts);

  it("reads every capability manifest and reports nothing as unreadable", () => {
    expect(facts.capabilities.length).toBeGreaterThan(20);
    expect(facts.capabilities.map((capability) => capability.id)).toContain("persistence");
    expect(facts.unreadable).toEqual([]);
    expect(facts.ownership.capabilities["persistence"]).toBeDefined();
  });

  it("finds the composition root's wiring for the boot modules the manifests declare", () => {
    const declared = facts.capabilities.flatMap((capability) => capability.bootModules);
    expect(new Set(declared).size).toBeGreaterThan(20);
    expect(facts.bootWiring).toHaveLength(new Set(declared).size);
    expect(facts.bootWiring.every((entry) => declared.includes(entry.file))).toBe(true);
    // Most declared boot modules are referenced by the composition root; the ones that are not are
    // reported as NOT_MEASURED rather than assumed wired.
    expect(facts.bootWiring.filter((entry) => entry.wired).length).toBeGreaterThan(15);
    expect(facts.scripts.map((script) => script.name)).toContain("typecheck");
    expect(facts.architectureBaseline?.metrics.capabilityCount).toBeGreaterThan(20);
  });

  it("describes itself with counts derived from those facts", () => {
    const description = describeSelf(model);
    expect(description.componentCount).toBeGreaterThan(facts.capabilities.length);
    expect(description.capabilities).toBe(facts.capabilities.length);
    expect(description.componentKinds.BOOT_MODULE).toBe(facts.bootWiring.length);
    expect(description.unreadable).toEqual([]);
    // The model's own limits are literals on the answer, not prose in the documentation.
    expect(description.canDescribeSelf).toBe(true);
    expect(description.canDiagnose).toBe(false);
    expect(description.canMutateSelf).toBe(false);
  });

  it("classifies authority with the repository's own classifier, on paths whose tier is not in doubt", () => {
    const classified = authoritySurfacesOf(["trust-policy/trust-epoch.json", "tests/acceptance/bootstrap-completion.test.ts", "scripts/acceptance-verify.cjs", "electron/main.ts", "package.json"], new ProtectedSurfaceGuard({ root: REPO }));
    const surfaceOf = (file: string): string | undefined => classified.find((entry) => entry.path === file)?.surface;
    expect(surfaceOf("trust-policy/trust-epoch.json")).toBe("ROOT_TRUST_SURFACE");
    expect(surfaceOf("tests/acceptance/bootstrap-completion.test.ts")).toBe("ROOT_TRUST_SURFACE");
    expect(surfaceOf("scripts/acceptance-verify.cjs")).toBe("VERIFICATION_SURFACE");
    expect(surfaceOf("electron/main.ts")).toBe("PRODUCT_SURFACE");
    // The two guards answer different questions and the model reports both: package.json is a
    // product-surface path that an owner must still review.
    expect(surfaceOf("package.json")).toBe("PRODUCT_SURFACE");
    expect(classified.find((entry) => entry.path === "package.json")?.ownerReview).toBe("REQUIRE_OWNER");
    expect(classified.every((entry) => entry.detail.length > 0)).toBe(true);
    // The model carries those verdicts into its components rather than re-deriving them.
    const described = describeSelf(model);
    expect(described.authority.rootTrustComponents).toContain("promotion");
    const classifiedModule = model.components.find((component) => component.kind === "MODULE" && component.authority !== "UNKNOWN");
    expect(classifiedModule?.authorityPaths.length).toBeGreaterThan(0);
    expect(model.components.find((component) => component.id === "module:src/shared/self-cognition/contracts.ts")?.authority).toBe("PRODUCT_SURFACE");
  });

  it("scans the same source tree the architecture guard owns", () => {
    const files = sourceFiles(REPO);
    expect(files).toContain("electron/main.ts");
    expect(files).toContain("src/shared/doctor.ts");
    expect(files.every((file) => !file.endsWith(".tsx") || file.startsWith("src/"))).toBe(true);
  });
});

describe("a fact source that cannot be read is reported, not dropped", () => {
  it("records a missing capability directory", () => {
    const empty = makeDir();
    const facts = collectSelfFacts({ repositoryRoot: empty });
    expect(facts.capabilities).toEqual([]);
    expect(facts.unreadable.some((entry) => entry.path === "config/capabilities")).toBe(true);
    expect(facts.unreadable.some((entry) => entry.path === "config/capability-modules.json")).toBe(true);
    // With no facts, the model says it has none rather than claiming health -?and every unreadable
    // source survives as a component, so the count is the number of things it could not read.
    const model = buildSelfModel(facts);
    expect(model.capabilities).toEqual([]);
    expect(model.unreadable.length).toBeGreaterThan(0);
    expect(describeSelf(model).componentCount).toBe(model.unreadable.length);
    expect(describeSelf(model).capabilities).toBe(0);
    expect(readArchitectureBaseline(empty)).toBeUndefined();
    expect(readBootWiring(empty, [])).toEqual([]);
    expect(readScripts(empty)).toEqual([]);
  });

  it("reports a manifest that is not valid YAML, and one with no id", () => {
    const root = makeDir();
    fs.mkdirSync(path.join(root, "config", "capabilities"), { recursive: true });
    fs.writeFileSync(path.join(root, "config", "capabilities", "broken.yaml"), "id: [unclosed\n", "utf8");
    fs.writeFileSync(path.join(root, "config", "capabilities", "nameless.yaml"), "kind: feature\n", "utf8");
    fs.writeFileSync(path.join(root, "config", "capability-modules.json"), JSON.stringify({ capabilities: {}, exempt: {} }), "utf8");
    const facts = collectSelfFacts({ repositoryRoot: root });
    expect(facts.capabilities).toEqual([]);
    expect(facts.unreadable.map((entry) => entry.path).sort()).toEqual(["config/capabilities/broken.yaml", "config/capabilities/nameless.yaml"]);
    expect(facts.unreadable.find((entry) => entry.path.endsWith("nameless.yaml"))?.reason).toContain("names no capability id");
    expect(readCapabilityManifest(path.join(root, "config", "capabilities", "missing.yaml")).problem?.reason).toContain("ENOENT");
  });
});

describe("CAN_DESCRIBE_SELF and the two things it cannot do", () => {
  const modules = ["contracts.ts", "anatomy.ts", "describe.ts"];
  /** The code with its comments removed: a docstring that says "this does not diagnose" is not a diagnosis. */
  const code = modules
    .map((name) => fs.readFileSync(path.join(REPO, "src", "shared", "self-cognition", name), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  it("has no diagnosing or repairing behaviour anywhere in its implementation", () => {
    for (const word of ["symptom", "hypothesis", "treatment", "repair", "remediate"]) {
      expect(code.toLowerCase().includes(word), `${word} must not appear in a module that only describes`).toBe(false);
    }
    // Word-boundary, because "health signal" is a thing this module legitimately names and "heal"
    // is not.
    expect(/\bheal\b/i.test(code)).toBe(false);
    // No diagnosis, by call or by export. `canDiagnose: false` is the denial and is expected.
    expect(/\bdiagnose\s*\(/.test(code)).toBe(false);
    expect(/export (function|const|class) .*diagnos/i.test(code)).toBe(false);
    expect(code).toContain("canDiagnose: false");
    expect(code).toContain("canMutateSelf: false");
  });

  it("writes nothing: the pure module holds no filesystem call at all", () => {
    expect(/from "node:fs"/.test(code)).toBe(false);
    for (const call of ["writeFileSync", "appendFileSync", "rmSync", "unlinkSync", "mkdirSync", "renameSync"]) {
      expect(code.includes(call), `${call} must not appear in the pure self-cognition modules`).toBe(false);
    }
  });

  it("declares no export that could change or authorize anything", () => {
    for (const verb of ["grant", "apply", "mutate", "override", "authorize"]) {
      expect(new RegExp(`export (function|const) ${verb}`, "i").test(code), `no ${verb} export`).toBe(false);
    }
    // The authority answer is a report: it has no field a caller could mistake for permission.
    const model = buildSelfModel(collectSelfFacts({ repositoryRoot: REPO }));
    const owned = model.components.find((component) => component.kind === "MODULE" && component.authorityPaths.length > 0);
    expect(owned, "the real model must hold at least one classified module").toBeDefined();
    const verdict = authorityOf(model, owned?.id ?? "");
    expect(Object.keys(verdict.value ?? {}).sort()).toEqual(["authority", "ownerReview", "paths"]);
    expect(model.authority.canMutateSelf).toBe(false);
    expect(model.authority.canDiagnose).toBe(false);
  });

  it("does not diagnose: describing what depends on a component says nothing about its health", () => {
    const model = buildSelfModel(collectSelfFacts({ repositoryRoot: REPO }));
    const description = describeSelf(model);
    const text = JSON.stringify(description).toLowerCase();
    for (const word of ["unhealthy", "degraded", "root cause", "failure mode detected"]) {
      expect(text.includes(word), `the self description must not diagnose (${word})`).toBe(false);
    }
    const options: SelfFactOptions = { repositoryRoot: REPO };
    expect(options.repositoryRoot).toBe(REPO);
  });
});
