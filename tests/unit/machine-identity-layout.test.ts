import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GITHUB_MACHINE_IDENTITY_FILES,
  GITHUB_MACHINE_IDENTITY_VAULT_LABEL,
  githubMachineIdentityAt
} from "../../electron/github/machine-identity-layout";

/**
 * PF-DEBT-008 — a security surface must decide its file name and vault label once.
 *
 * The vault file was named and the vault LABEL was chosen independently at two construction sites: the
 * Root Owner credential ceremony in `electron/github/bootstrap.ts` (which WRITES the App private key)
 * and the production composition root in `electron/github/github-machine-runtime.ts` (which READS it).
 *
 * A label is part of a vault lookup key, so the two agreeing was a coincidence of two hand-written
 * strings rather than something the code enforced. A divergence would not throw: the ceremony would
 * store the key under one label, the runtime would look under another, find nothing, and report the
 * machine identity as "not configured" — a credential that exists appearing not to, which is the
 * failure mode hardest to diagnose and the one a security surface can least afford.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-gh-layout-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Phase 06 — the GitHub machine identity layout has one owner", () => {
  it("declares one file per concern, all distinct", () => {
    const names = Object.values(GITHUB_MACHINE_IDENTITY_FILES);
    expect(GITHUB_MACHINE_IDENTITY_FILES.vault).toBe("secret-vault.json");
    expect(GITHUB_MACHINE_IDENTITY_FILES.config).toBe("github-machine-identity.json");
    expect(GITHUB_MACHINE_IDENTITY_FILES.node).toBe("node-machine-identity.json");
    // The secret store must not share a document with the non-secret config: the one file that is
    // encrypted must be exactly one file.
    expect(new Set(names).size).toBe(names.length);
  });

  it("resolves every file under the .boss root it was given", () => {
    const layout = githubMachineIdentityAt(dir);
    expect(layout.directory).toBe(dir);
    expect(layout.vaultFile).toBe(path.join(dir, "secret-vault.json"));
    expect(layout.configFile).toBe(path.join(dir, "github-machine-identity.json"));
    expect(layout.nodeFile).toBe(path.join(dir, "node-machine-identity.json"));
  });

  it("gives the writer and the reader the same vault label, by construction", () => {
    // The property the defect removed: the label is not chosen twice, so it cannot be chosen
    // differently. Asserted through two independent resolutions because that is what two call sites
    // are.
    const asTheCeremonySeesIt = githubMachineIdentityAt(dir);
    const asTheRuntimeSeesIt = githubMachineIdentityAt(path.join(dir, "."));
    expect(asTheCeremonySeesIt.vaultLabel).toBe(asTheRuntimeSeesIt.vaultLabel);
    expect(asTheCeremonySeesIt.vaultLabel).toBe(GITHUB_MACHINE_IDENTITY_VAULT_LABEL);
    expect(asTheCeremonySeesIt.vaultFile).toBe(asTheRuntimeSeesIt.vaultFile);
  });

  it("normalises the root, so a differently-spelled root is still the same file", () => {
    // The ceremony builds its root from `app.getPath("userData")`; the runtime from an injected
    // `userData`. The same directory reached by different spellings must resolve to one path, or the
    // two would write and read different files while both looking correct.
    const plain = githubMachineIdentityAt(dir);
    const dotted = githubMachineIdentityAt(path.join(dir, "sub", ".."));
    expect(dotted.directory).toBe(plain.directory);
    expect(dotted.vaultFile).toBe(plain.vaultFile);
  });

  it("keeps two different data roots apart", () => {
    const a = githubMachineIdentityAt(path.join(dir, "a"));
    const b = githubMachineIdentityAt(path.join(dir, "b"));
    expect(a.vaultFile).not.toBe(b.vaultFile);
    expect(a.vaultLabel).toBe(b.vaultLabel);
  });

  it("reports the root it resolved, so a caller can see which one it got", () => {
    // The previous failure mode was a path that looked plausible and was not the intended location.
    const layout = githubMachineIdentityAt(dir);
    expect(layout.directory).toBe(path.resolve(dir));
    expect(path.dirname(layout.vaultFile)).toBe(layout.directory);
  });
});
