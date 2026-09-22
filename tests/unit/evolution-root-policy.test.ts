import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_ROOT_ENV,
  evolutionRootConstraints,
  evolutionRootFingerprint,
  resolveEvolutionRoot
} from "../../electron/stable-candidate/evolution-root-policy";
import { evolutionLayout, verifyRuntimeSeparation } from "../../electron/stable-candidate/runtime-isolation";
import { cleanupFixtures, tempDir, write } from "../helpers/root-fixtures";

/**
 * Production evolution-root placement policy (Update-Plan/Isolation-Finalization.md §8.3).
 *
 * The defect these tests pin is not in the isolation invariant — `verifyRuntimeSeparation` was always
 * correct. It is in the root-placement policy: defaulting the Candidate tree to `<userData>/evolution`
 * made the separation a property of where the OS puts application data. In development `userData` is
 * `runtime-data/` inside the checkout, so the Candidate landed inside Stable and the invariant correctly
 * refused it:
 *
 *     RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces: <candidate root inside stable root>
 *
 * PROD-ROOT-01..07 are the required matrix. The last case keeps the historical nested geometry as an
 * explicit negative control, so the original failure stays detectable.
 */

afterEach(cleanupFixtures);

const SHA = "a".repeat(40);

/** A fake Stable checkout. No git needed: the policy reasons about paths, not refs. */
function stableCheckout(label = "Boss"): { stableRoot: string; userData: string } {
  const parent = tempDir("boss-policy-parent-");
  const stableRoot = path.join(parent, label);
  fs.mkdirSync(stableRoot, { recursive: true });
  write(stableRoot, "package.json", "{}\n");
  return { stableRoot, userData: path.join(stableRoot, "runtime-data") };
}

describe("PROD-ROOT — evolution root placement policy", () => {
  it("PROD-ROOT-01: development geometry (userData inside Stable) resolves to a disjoint external root", () => {
    const { stableRoot, userData } = stableCheckout();

    // Precondition: this is genuinely the broken development topology.
    expect(userData.startsWith(stableRoot)).toBe(true);
    const historical = evolutionLayout(path.join(userData, "evolution"), "run-a", SHA);
    expect(verifyRuntimeSeparation(historical, stableRoot).separated).toBe(false);

    const resolved = resolveEvolutionRoot({ stableRoot, userData });

    expect(resolved.origin.source).toBe("external-sibling");
    expect(resolved.origin.stableRoot).toBe(path.resolve(stableRoot));
    expect(resolved.origin.fingerprint).toBe(evolutionRootFingerprint(stableRoot));
    // The decision is proven by the invariant's own predicate, not by string comparison.
    const layout = evolutionLayout(resolved.evolutionRoot, "run-a", SHA);
    expect(verifyRuntimeSeparation(layout, stableRoot)).toEqual({ separated: true, overlaps: [] });
    expect(fs.existsSync(resolved.evolutionRoot)).toBe(true);
  });

  it("PROD-ROOT-02: packaged geometry (userData already outside Stable) keeps the existing location", () => {
    const { stableRoot } = stableCheckout();
    const separateUserData = path.join(tempDir("boss-packaged-userdata-"), "Codex-Boss");

    const resolved = resolveEvolutionRoot({ stableRoot, userData: separateUserData });

    expect(resolved.origin.source).toBe("user-data");
    expect(resolved.evolutionRoot).toBe(path.join(path.resolve(separateUserData), "evolution"));
    const layout = evolutionLayout(resolved.evolutionRoot, "run-b", SHA);
    expect(verifyRuntimeSeparation(layout, stableRoot).separated).toBe(true);
  });

  it("PROD-ROOT-03: an explicit override inside Stable is rejected, with no silent fallback", () => {
    const { stableRoot, userData } = stableCheckout();
    const unsafe = path.join(stableRoot, "runtime-data", "evolution");

    expect(() => resolveEvolutionRoot({ stableRoot, userData, explicitOverride: unsafe })).toThrow(/outside the Stable root/i);
    // Nothing was created at the unsafe location.
    expect(fs.existsSync(path.join(unsafe, "..", "evolution"))).toBe(false);
  });

  it("PROD-ROOT-04: an explicit safe external override is accepted", () => {
    const { stableRoot, userData } = stableCheckout();
    const safe = path.join(tempDir("boss-explicit-evolution-"), "evolution");

    const resolved = resolveEvolutionRoot({ stableRoot, userData, explicitOverride: safe });

    expect(resolved.origin.source).toBe("override");
    expect(resolved.evolutionRoot).toBe(path.resolve(safe));
    const layout = evolutionLayout(resolved.evolutionRoot, "run-c", SHA);
    expect(verifyRuntimeSeparation(layout, stableRoot).separated).toBe(true);
  });

  it("PROD-ROOT-05: an evolution root that CONTAINS Stable is rejected", () => {
    const { stableRoot, userData } = stableCheckout();
    // The parent of Stable contains Stable: the inverse overlap.
    const containsStable = path.dirname(stableRoot);

    expect(evolutionRootConstraints(stableRoot, containsStable)).toMatchObject({ constraint: "must-not-contain-stable" });
    expect(() => resolveEvolutionRoot({ stableRoot, userData, explicitOverride: containsStable })).toThrow(/must not contain the Stable root/i);
  });

  it("PROD-ROOT-06: distinct checkouts sharing a directory name do not collide", () => {
    // Same basename, different absolute paths — the reason the default is keyed by a fingerprint rather
    // than by the directory name alone.
    const first = stableCheckout("Codex-Boss");
    const secondParent = tempDir("boss-policy-parent2-");
    const secondRoot = path.join(secondParent, "Codex-Boss");
    fs.mkdirSync(secondRoot, { recursive: true });
    const second = { stableRoot: secondRoot, userData: path.join(secondRoot, "runtime-data") };

    const a = resolveEvolutionRoot({ ...first, osTempRoot: tempDir("boss-temp-a-") });
    const b = resolveEvolutionRoot({ ...second, osTempRoot: tempDir("boss-temp-b-") });

    expect(a.origin.fingerprint).not.toBe(b.origin.fingerprint);
    expect(a.evolutionRoot).not.toBe(b.evolutionRoot);
    // And each remains correctly separated from its own Stable root.
    expect(verifyRuntimeSeparation(evolutionLayout(a.evolutionRoot, "run-d", SHA), first.stableRoot).separated).toBe(true);
    expect(verifyRuntimeSeparation(evolutionLayout(b.evolutionRoot, "run-d", SHA), second.stableRoot).separated).toBe(true);
  });

  it("PROD-ROOT-07: failure to establish a writable external root fails closed", () => {
    const { stableRoot, userData } = stableCheckout();

    // Every candidate location fails its writability probe. There is no fallback to an unsafe location.
    expect(() =>
      resolveEvolutionRoot({ stableRoot, userData, probe: () => false })
    ).toThrow(/no Candidate evolution root outside the Stable root could be established/i);
  });

  it("keeps the historical nested geometry as a negative control", () => {
    // The exact shape that failed Stage C attempt 1 must remain detectable by the invariant.
    const { stableRoot, userData } = stableCheckout();
    const layout = evolutionLayout(path.join(userData, "evolution"), "run-e", SHA);

    expect(verifyRuntimeSeparation(layout, stableRoot)).toEqual({
      separated: false,
      overlaps: ["<candidate root inside stable root>"]
    });
    // And the policy refuses to hand that shape out, even via the environment override.
    const previous = process.env[EVOLUTION_ROOT_ENV];
    process.env[EVOLUTION_ROOT_ENV] = layout.root;
    try {
      expect(() => resolveEvolutionRoot({ stableRoot, userData })).toThrow(/outside the Stable root/i);
    } finally {
      if (previous === undefined) delete process.env[EVOLUTION_ROOT_ENV];
      else process.env[EVOLUTION_ROOT_ENV] = previous;
    }
  });
});
