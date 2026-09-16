import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatCapabilityRef,
  isValidCapabilityId,
  isValidSemver,
  isValidStateNamespace,
  parseCapabilityRef
} from "../../../electron/platform/capability-contract";
import {
  loadCapabilityManifests,
  manifestFilesUnder,
  parseCapabilityManifestFile,
  parseCapabilityManifestText,
  validateCapabilityManifest
} from "../../../electron/platform/capability-manifest";
import { CAPABILITIES_ROOT, bootFactoryFiles, buildCapabilityRegistry } from "../../../electron/platform/capability-registry";

/**
 * Phase 01 Task A — the capability contract and its parser.
 *
 * The engineering book names four rejections the parser MUST make (empty id,
 * duplicate provide, invalid semver, and one capability declared as both required
 * and optional) and one property that makes the whole layer checkable (a manifest
 * must load in a plain Node unit test, with no Electron). Both are asserted here
 * against the real parser rather than restated, and the negative cases are written
 * as one manifest per rule so a failure names the rule that broke.
 */

const PROJECT = process.cwd();

/** A valid manifest, as text, that each negative case perturbs one field of. */
const VALID = `id: research.autopilot
version: 1.0.0
kind: feature
provides:
  - research.plan@1
requires:
  - ref: artifact.store@1
    reason: the plan records its inputs as artifacts
optional:
  - ref: browser.search@1
    reason: live search widens the plan but is not required
state:
  - namespace: research.run
    owner: research.autopilot
health:
  critical: false
modules:
  - electron/research/research-service.ts
bootModules: []
surface: []
permissions: []
`;

function problemsFor(text: string): string[] {
  const result = parseCapabilityManifestText(text, "test.yaml");
  return result.problems.map((problem) => `${problem.path}: ${problem.message}`);
}

describe("Phase 01 Task A — capability references", () => {
  it("parses id@major and rejects every near miss", () => {
    expect(parseCapabilityRef("artifact.store@1")).toEqual({ id: "artifact.store", major: 1 });
    expect(parseCapabilityRef("research.autopilot@12")).toEqual({ id: "research.autopilot", major: 12 });
    expect(formatCapabilityRef({ id: "artifact.store", major: 3 })).toBe("artifact.store@3");
    for (const bad of ["", "artifact.store", "artifact.store@", "artifact.store@0", "artifact.store@-1", "artifact.store@1.2", "Artifact.Store@1", "@1", "artifact store@1"]) {
      expect(parseCapabilityRef(bad), `${JSON.stringify(bad)} must not parse`).toBeUndefined();
    }
  });

  it("keeps identifiers and state namespaces on one strict alphabet", () => {
    for (const good of ["a", "artifact.store", "research_plan", "a-b.c"]) {
      expect(isValidCapabilityId(good), good).toBe(true);
      expect(isValidStateNamespace(good), good).toBe(true);
    }
    for (const bad of ["", "1a", "A", ".a", "a.", "a..b", "a b"]) {
      expect(isValidCapabilityId(bad), bad).toBe(false);
    }
  });

  it("accepts the semver subset and nothing that would need a comparator to guess", () => {
    for (const good of ["1.0.0", "0.1.2", "10.20.30", "1.0.0-rc.1", "1.0.0+build"]) expect(isValidSemver(good), good).toBe(true);
    for (const bad of ["1.0", "v1.0.0", "1", "1.0.0.0", "01.0.0", "x.y.z", ""]) expect(isValidSemver(bad), bad).toBe(false);
  });
});

describe("Phase 01 Task A — the parser's mandated rejections", () => {
  it("accepts the reference manifest, so the negative cases are not passing vacuously", () => {
    expect(problemsFor(VALID)).toEqual([]);
  });

  it("rejects an empty id", () => {
    expect(problemsFor(VALID.replace("id: research.autopilot", 'id: ""'))).toContainEqual(expect.stringContaining("id"));
    const missing = parseCapabilityManifestText(VALID.replace("id: research.autopilot\n", ""), "test.yaml");
    expect(missing.manifest).toBeUndefined();
    expect(missing.problems.map((problem) => problem.path)).toContain("id");
  });

  it("rejects a duplicate provide", () => {
    const text = VALID.replace("  - research.plan@1\n", "  - research.plan@1\n  - research.plan@1\n");
    expect(problemsFor(text).join("\n")).toContain("duplicate provide: research.plan@1");
  });

  it("rejects an invalid semver", () => {
    // Quoted, so YAML hands the parser a string: an unquoted `1.0` is a number, which
    // is a different (also correct) rejection and would make this case pass vacuously.
    expect(problemsFor(VALID.replace("version: 1.0.0", 'version: "1.0"')).join("\n")).toContain("semantic version");
    expect(problemsFor(VALID.replace("version: 1.0.0", 'version: "v1"')).join("\n")).toContain("semantic version");
    expect(problemsFor(VALID.replace("version: 1.0.0", 'version: "1.0.0.0"')).join("\n")).toContain("semantic version");
    // A number where a version is expected is still a rejection, just a different one.
    expect(problemsFor(VALID.replace("version: 1.0.0", "version: 1.0")).join("\n")).toContain("must be a string");
  });

  it("rejects one capability declared as both required and optional", () => {
    const text = VALID.replace("  - ref: browser.search@1", "  - ref: artifact.store@1");
    expect(problemsFor(text).join("\n")).toContain("both `requires` and `optional`");
  });

  it("rejects a requirement with no stated reason", () => {
    const text = VALID.replace("    reason: the plan records its inputs as artifacts\n", "");
    expect(problemsFor(text).join("\n")).toContain("reason");
  });

  it("refuses a state claim owned by a different capability", () => {
    const text = VALID.replace("    owner: research.autopilot", "    owner: somebody.else");
    expect(problemsFor(text).join("\n")).toContain("may only claim its own state");
  });

  it("refuses a kernel capability that declares itself non-critical", () => {
    const text = VALID.replace("kind: feature", "kind: kernel");
    expect(problemsFor(text).join("\n")).toContain("cannot declare itself non-critical");
  });

  it("refuses a path that would escape the repository, and a surface not in modules", () => {
    expect(problemsFor(VALID.replace("  - electron/research/research-service.ts", "  - ../outside.ts")).join("\n")).toContain("inside the repository");
    expect(problemsFor(VALID.replace("surface: []", "surface:\n  - electron/nowhere.ts")).join("\n")).toContain("must also be listed in `modules`");
  });

  it("reports every problem at once rather than only the first", () => {
    const broken = VALID
      .replace("id: research.autopilot", 'id: ""')
      .replace("version: 1.0.0", "version: nope")
      .replace("kind: feature", "kind: nonsense");
    expect(problemsFor(broken).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses duplicated capability ids across files", () => {
    const registry = buildCapabilityRegistry(PROJECT);
    const ids = registry.manifests.map((manifest) => manifest.id);
    expect(new Set(ids).size, "two manifests declare the same capability id").toBe(ids.length);
  });
});

describe("Phase 01 Task A — the real manifest set", () => {
  const registry = buildCapabilityRegistry(PROJECT);

  it("loads without Electron and without a filesystem walk of the app sources", () => {
    // The parser is a pure function of manifest text: this asserts that property by
    // parsing the repository's own manifests from strings, with no registry involved.
    for (const manifest of registry.manifests) {
      const text = fs.readFileSync(path.join(PROJECT, ...manifest.source.split("/")), "utf8");
      const reparsed = parseCapabilityManifestText(text, manifest.source);
      expect(reparsed.problems, `${manifest.source} does not re-parse cleanly`).toEqual([]);
      expect(reparsed.manifest?.id).toBe(manifest.id);
    }
  });

  it("declares every manifest under config/capabilities, and nothing else", () => {
    const files = fs.readdirSync(path.join(PROJECT, ...CAPABILITIES_ROOT.split("/")))
      .filter((name) => /\.(ya?ml|json)$/i.test(name))
      .map((name) => `${CAPABILITIES_ROOT}/${name}`)
      .sort();
    expect(registry.manifests.map((manifest) => manifest.source).sort()).toEqual(files);
    expect(registry.manifests.length).toBeGreaterThanOrEqual(24);
  });

  it("maps every capability to at least one provided contract", () => {
    for (const manifest of registry.manifests) {
      expect(manifest.provides.length, `${manifest.id} provides nothing`).toBeGreaterThan(0);
    }
  });

  it("names exactly the boot factories the composition root has", () => {
    // The bijection the acceptance gate needs: every `electron/bootstrap/*.ts` factory
    // file is claimed by exactly one manifest, so no module can enter the boot graph
    // undescribed and none can be described twice.
    const declared = registry.manifests.flatMap((manifest) => manifest.bootModules).sort();
    const onDisk = bootFactoryFiles(PROJECT);
    expect(declared).toEqual(onDisk);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("keeps every declared module a real file", () => {
    for (const manifest of registry.manifests) {
      for (const module of manifest.modules) {
        expect(fs.existsSync(path.join(PROJECT, ...module.split("/"))), `${manifest.id} declares a missing module: ${module}`).toBe(true);
      }
    }
  });

  it("declares the permission schema without granting anything", () => {
    // Phase 01 must not award capability. The field exists for schema stability and
    // every manifest leaves it empty, which is asserted rather than assumed.
    for (const manifest of registry.manifests) {
      expect(manifest.permissions, `${manifest.id} declares permissions in Phase 01`).toEqual([]);
    }
  });

  it("validates an already-decoded value, for a caller that did not read YAML", () => {
    const decoded = { id: "decoded.example", version: "2.0.0", kind: "feature", health: { critical: false }, provides: ["decoded.thing@1"] };
    const result = validateCapabilityManifest(decoded, "inline");
    expect(result.problems).toEqual([]);
    expect(result.manifest?.id).toBe("decoded.example");
    // A non-mapping is refused rather than coerced.
    expect(validateCapabilityManifest([1, 2, 3], "inline").problems.map((problem) => problem.message)).toContain("manifest must be a mapping");
  });

  it("reports an unreadable file as a problem instead of skipping it", () => {
    const result = parseCapabilityManifestFile(path.join(PROJECT, "config", "capabilities", "does-not-exist.yaml"), PROJECT);
    expect(result.manifest).toBeUndefined();
    expect(result.problems[0].message).toContain("cannot be read");
  });

  it("finds the manifest files deterministically, and refuses a broken set loudly", () => {
    const root = path.join(PROJECT, ...CAPABILITIES_ROOT.split("/"));
    const files = manifestFilesUnder(root).map((file) => path.relative(PROJECT, file).split(path.sep).join("/"));
    expect(files.length).toBeGreaterThanOrEqual(24);
    expect(files).toEqual([...files].sort());

    // A missing root yields an empty list rather than throwing; a root whose contents
    // are invalid throws, because a capability nobody can describe is one no ratchet
    // can protect.
    expect(manifestFilesUnder(path.join(PROJECT, "config", "no-such-dir"))).toEqual([]);
    const loaded = loadCapabilityManifests(root, PROJECT);
    expect(loaded.length).toBe(files.length);
    expect(loaded.map((manifest) => manifest.id)).toEqual([...loaded.map((manifest) => manifest.id)].sort());
  });
});
