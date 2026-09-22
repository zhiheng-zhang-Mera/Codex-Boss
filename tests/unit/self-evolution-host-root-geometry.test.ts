import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSelfEvolutionHost } from "../../electron/self-evolution/self-evolution-host";
import { createCandidateWorkspace } from "../../electron/stable-candidate/workspace-manager";
import { evolutionLayout, verifyRuntimeSeparation } from "../../electron/stable-candidate/runtime-isolation";
import { evolutionRootFingerprint } from "../../electron/stable-candidate/evolution-root-policy";
import { cleanupFixtures, gitRepo } from "../helpers/root-fixtures";

/**
 * Production composition geometry (Update-Plan/Isolation-Finalization.md §8.3).
 *
 * `evolution-root-policy.test.ts` pins the policy. This file pins that the REAL composition —
 * `createSelfEvolutionHost` — is wired to it, and that the resulting geometry lets a Candidate be
 * created without the invariant being weakened. A resolver test alone would not prove the host no longer
 * defaults to `<userData>/evolution`.
 */

afterEach(cleanupFixtures);

const RUN_ID = "composition-run-a";

describe("production composition resolves a disjoint Candidate root (§8.3)", () => {
  it("in development topology the host resolves an external root and can create the Candidate", async () => {
    const stable = gitRepo("boss-composition-stable-");
    // The development topology: userData lives INSIDE the Stable checkout.
    const userData = path.join(stable.root, "runtime-data");
    fs.mkdirSync(userData, { recursive: true });

    const host = createSelfEvolutionHost({
      appPath: stable.root,
      stableRoot: stable.root,
      userData,
      rootOwner: "zhiheng-zhang-Mera",
      worker: () => ({ ask: async () => "" })
    });

    // 1. The host no longer hands out a root inside Stable.
    const origin = host.evolutionRootOrigin();
    expect(origin.source).toBe("external-sibling");
    expect(origin.stableRoot).toBe(path.resolve(stable.root));
    expect(origin.fingerprint).toBe(evolutionRootFingerprint(stable.root));
    expect(host.stableRoot()).toBe(path.resolve(stable.root));

    // 2. The invariant's own predicate confirms the geometry the host will use.
    const layout = evolutionLayout(host.evolutionRoot(), RUN_ID, stable.sha);
    expect(verifyRuntimeSeparation(layout, host.stableRoot())).toEqual({ separated: true, overlaps: [] });

    // 3. And a real Candidate can actually be created — the step that used to throw
    //    `RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces`.
    const candidate = await createCandidateWorkspace({
      stableRoot: host.stableRoot(),
      evolutionRoot: host.evolutionRoot(),
      baseSha: stable.sha,
      runId: RUN_ID,
      allowNonHeadBase: true
    });
    // Containment is decided by the path predicate, never by string prefix: the sibling directory
    // `<stable>-evolution-<fingerprint>` is a DIFFERENT directory that merely shares a name prefix.
    expect(candidate.layout.root.startsWith(host.stableRoot())).toBe(true);
    expect(verifyRuntimeSeparation(candidate.layout, host.stableRoot())).toEqual({ separated: true, overlaps: [] });
    expect(path.relative(host.stableRoot(), candidate.layout.root).startsWith("..")).toBe(true);
  });

  it("in packaged topology the host keeps the external userData location", () => {
    const stable = gitRepo("boss-composition-packaged-");
    // The packaged topology: userData is outside the checkout entirely.
    const userData = path.join(path.dirname(stable.root), "Codex-Boss-userdata");
    fs.mkdirSync(userData, { recursive: true });

    const host = createSelfEvolutionHost({
      appPath: stable.root,
      stableRoot: stable.root,
      userData,
      rootOwner: "zhiheng-zhang-Mera",
      worker: () => ({ ask: async () => "" })
    });

    expect(host.evolutionRootOrigin().source).toBe("user-data");
    expect(host.evolutionRoot()).toBe(path.join(path.resolve(userData), "evolution"));
    const layout = evolutionLayout(host.evolutionRoot(), RUN_ID, stable.sha);
    expect(verifyRuntimeSeparation(layout, host.stableRoot()).separated).toBe(true);
  });

  it("refuses an explicit evolutionRoot that is inside Stable instead of silently relocating it", () => {
    const stable = gitRepo("boss-composition-override-");
    const userData = path.join(stable.root, "runtime-data");
    fs.mkdirSync(userData, { recursive: true });

    expect(() =>
      createSelfEvolutionHost({
        appPath: stable.root,
        stableRoot: stable.root,
        userData,
        // An operator explicitly pointing the Candidate tree inside Stable is a hard error: relocating it
        // silently would hide the misconfiguration.
        evolutionRoot: path.join(userData, "evolution"),
        rootOwner: "zhiheng-zhang-Mera",
        worker: () => ({ ask: async () => "" })
      })
    ).toThrow(/outside the Stable root/i);
  });
});
