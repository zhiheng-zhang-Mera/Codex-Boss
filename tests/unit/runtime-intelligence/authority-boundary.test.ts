import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifySurface } from "../../../src/shared/autonomous-evolution-trust";
import { CHANGE_CLASSES, deriveChangeClass } from "../../../src/shared/root-authority/authority-planes";
import { assessProtectedPaths, isProtectedPath } from "../../../src/shared/root-authority/protected-surface";
import { ProtectedSurfaceGuard } from "../../../electron/root-authority/protected-surface-guard";

/**
 * The Runtime Intelligence Plane's diff guard.
 *
 * The plane is ordinary product code, and that claim is checked against the repository's
 * own boundaries rather than against a hand-written pattern: `classifySurface` from the
 * trust module, `assessProtectedPaths` from the compiled CODEOWNERS/immutable manifest,
 * `ProtectedSurfaceGuard` from the host wrapper, and `deriveChangeClass` from the
 * authority planes. There is deliberately no simplified regex here — a second, weaker
 * definition of "protected" is exactly the failure this test exists to prevent.
 *
 * The positive controls matter as much as the assertion: a test that only ever sees
 * `ALLOW` passes just as well when the classifier is broken, so a Root Trust path, an
 * Owner Authority path and a `..` escape are each required to be caught.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");

/** Directories this plane owns. Files here are the diff the guard is asked about. */
const PLANE_DIRECTORIES = ["src/shared/runtime-intelligence", "electron/runtime-intelligence"];

function planeFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, target).split(path.sep).join("/"));
    }
  };
  for (const directory of PLANE_DIRECTORIES) walk(path.join(ROOT, directory));
  return found.sort();
}

const FILES = planeFiles();
const guard = new ProtectedSurfaceGuard({ root: ROOT });

describe("the plane is ordinary product surface", () => {
  it("scans a non-empty set, so the guard cannot pass vacuously", () => {
    expect(FILES.length).toBeGreaterThan(0);
    for (const file of FILES) expect(file.endsWith(".ts")).toBe(true);
  });

  it("touches no protected path and escapes no boundary", () => {
    const assessment = assessProtectedPaths(FILES);
    expect(assessment.escapes).toEqual([]);
    expect(assessment.protected, `protected hits: ${assessment.hits.map((hit) => `${hit.path} (${hit.rule})`).join(", ")}`).toBe(false);
  });

  it("is ALLOW under the real guard, which reads the repository's CODEOWNERS", () => {
    const assessment = guard.assessChangeSet(FILES);
    expect(assessment.decision).toBe("ALLOW");
    expect(assessment.reasons).toEqual([]);
    // The guard only means something if it actually found the review boundary to read.
    expect(guard.codeownersMissing).toBe(false);
  });

  it("classifies as ORDINARY_AUTONOMOUS_CHANGE, never a Root Trust or Owner Authority change", () => {
    expect(deriveChangeClass(FILES)).toBe(CHANGE_CLASSES.ORDINARY_AUTONOMOUS_CHANGE);
    for (const file of FILES) expect(classifySurface(file), file).toBe("PRODUCT_SURFACE");
  });

  it("uses file names that do not match a protected glob", () => {
    for (const file of FILES) {
      const base = path.basename(file);
      expect(isProtectedPath(file), file).toBe(false);
      expect(/^acceptance-/.test(base), `${file} looks like an acceptance module`).toBe(false);
      expect(/^autonomous-evolution-/.test(base), `${file} looks like a trust module`).toBe(false);
    }
  });
});

describe("the guard is not vacuous: known-boundary paths are caught", () => {
  /**
   * Two different boundaries, deliberately kept apart. The Owner-review boundary
   * (CODEOWNERS + immutable manifest) protects more files than the trust classifier's
   * Root Trust Surface: `package.json` and the vitest tier files require Owner approval
   * but are not part of the surface whose hash the trust epoch certifies. Asserting one
   * list against the other is how the two would drift, so each is asserted separately.
   */
  const OWNER_REVIEW_PATHS = [
    "trust-policy/trust-epoch.json",
    "src/shared/autonomous-evolution-trust.ts",
    "src/shared/root-authority/protected-surface.ts",
    ".github/CODEOWNERS",
    "package.json",
    "vitest.tiers.mjs",
    "tests/acceptance/platform-certificate.test.ts",
    "electron/root-authority/root-authority.ts",
    "scripts/acceptance-evolution-bless.cjs"
  ];

  /** The subset the trust module itself classifies above PRODUCT_SURFACE. */
  const TRUST_CLASSIFIED_PATHS = [
    "trust-policy/trust-epoch.json",
    "src/shared/autonomous-evolution-trust.ts",
    ".github/CODEOWNERS",
    "tests/acceptance/platform-certificate.test.ts",
    "scripts/acceptance-evolution-bless.cjs"
  ];

  it("requires Owner review for every Root Trust, Owner Authority and gate file", () => {
    for (const file of OWNER_REVIEW_PATHS) {
      expect(isProtectedPath(file), `${file} was not recognised as protected`).toBe(true);
      expect(guard.assessChangeSet([file]).decision, `${file} was not REQUIRE_OWNER`).toBe("REQUIRE_OWNER");
      expect(deriveChangeClass([file]), `${file} is not above the ordinary class`).not.toBe(CHANGE_CLASSES.ORDINARY_AUTONOMOUS_CHANGE);
    }
  });

  it("is classified above PRODUCT_SURFACE by the trust module for the Root Trust Surface", () => {
    for (const file of TRUST_CLASSIFIED_PATHS) {
      expect(classifySurface(file), `${file} should not be ordinary product surface`).not.toBe("PRODUCT_SURFACE");
    }
  });

  it("denies a path escape instead of treating it as an ordinary path", () => {
    expect(assessProtectedPaths(["../outside/secret.ts"]).escapes.length).toBeGreaterThan(0);
    expect(guard.assessPaths(["../outside/secret.ts"]).decision).toBe("DENY");
  });

  it("still allows an ordinary sibling module, so the boundary is a boundary and not a wall", () => {
    expect(assessProtectedPaths(["src/shared/runtime-intelligence/measurement.ts"]).protected).toBe(false);
  });
});
