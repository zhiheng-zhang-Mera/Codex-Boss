import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ROOT_POLICY, parseRootPolicy, serializeRootPolicy } from "../../src/shared/root-authority/root-policy";
import { ROOT_OPERATION_FLOOR } from "../../src/shared/root-authority/contracts";
import { assessProtectedPaths } from "../../src/shared/root-authority/protected-surface";
import { loadRootPolicy, isClaimedRootOwner, rootPolicyPath } from "../../electron/root-authority/root-policy-loader";
import { RootAuthority } from "../../electron/root-authority/root-authority";
import { ProtectedSurfaceGuard } from "../../electron/root-authority/protected-surface-guard";
import { cleanupFixtures, fixtureWorkspace, stateFile, write } from "../helpers/root-fixtures";

/**
 * Owner authority acceptance (Isolation-Finalization.md §4, §7.1, §17, §23
 * RD-001 "Root Owner 唯一性").
 *
 * Two properties are asserted here:
 *
 *   1. there is exactly ONE Root Owner, named by policy, and that identity is a
 *      string — not a list, not a pattern, not something a caller can append to;
 *   2. the boundary is narrow. §17 forbids "所有文件都变成 CODEOWNER", so the
 *      same battery proves ordinary product code is NOT Owner-gated.
 */

afterEach(cleanupFixtures);

describe("Root Owner uniqueness (RD-001)", () => {
  it("names exactly one Owner, and the schema refuses anything else", () => {
    expect(typeof DEFAULT_ROOT_POLICY.rootOwner).toBe("string");
    expect(DEFAULT_ROOT_POLICY.rootOwner).toBe("zhiheng-zhang-Mera");

    const base = { ...DEFAULT_ROOT_POLICY } as unknown as Record<string, unknown>;
    // A list of owners, a wildcard, or an empty identity is rejected: the Root
    // Owner is a single identity, never a set and never "*".
    for (const invalid of [["a", "b"], "*", "", "  ", "a b", "@owner", "a/b"]) {
      expect(() => parseRootPolicy({ ...base, rootOwner: invalid })).toThrow(/rootOwner/);
    }
  });

  it("only accepts an Owner claim from the login the policy names", () => {
    expect(isClaimedRootOwner(DEFAULT_ROOT_POLICY, "zhiheng-zhang-Mera")).toBe(true);
    expect(isClaimedRootOwner(DEFAULT_ROOT_POLICY, "ZHIHENG-ZHANG-MERA")).toBe(true);
    for (const impostor of ["some-other-user", "zhiheng-zhang", "zhiheng-zhang-Mera2", "", null, undefined, 42, ["zhiheng-zhang-Mera"]]) {
      expect(isClaimedRootOwner(DEFAULT_ROOT_POLICY, impostor)).toBe(false);
    }
  });

  it("is not satisfiable by an Owner claim when the repository policy is missing", () => {
    const root = fixtureWorkspace();
    const loaded = loadRootPolicy(root);
    expect(loaded.source).toBe("fallback-missing");
    expect(isClaimedRootOwner(loaded.policy, "zhiheng-zhang-Mera")).toBe(false);
    expect(rootPolicyPath(root)).toBe(path.join(root, ".codex-boss", "root", "root-policy.json"));
  });

  it("records an accepted claim as REQUIRE_OWNER rather than as consent", () => {
    const root = fixtureWorkspace();
    write(root, ".codex-boss/root/root-policy.json", serializeRootPolicy(DEFAULT_ROOT_POLICY));
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "owner-run" });
    expect(authority.rootOwner).toBe("zhiheng-zhang-Mera");
    // Even the real Owner's own claim does not become an ALLOW: it still parks
    // the action on the Owner-approved path.
    expect(authority.acceptOwnerClaim("zhiheng-zhang-Mera", "dashboard action")).toBe(true);
    expect(authority.history().at(-1)?.decision).toBe("REQUIRE_OWNER");
    expect(authority.history().at(-1)?.decision).not.toBe("ALLOW");
  });
});

describe("The boundary does not swallow ordinary product code (§17)", () => {
  it("leaves ordinary source, tests, docs and UI files unprotected", () => {
    const ordinary = [
      "src/renderer/App.tsx",
      "src/shared/knowledge.ts",
      "src/shared/council-engine.ts",
      "electron/engineering/engineering-loop-driver.ts",
      "electron/engineering/proposal-runner.ts",
      "electron/adapters/openai.ts",
      "electron/fleet/fleet-controller.ts",
      "electron/research/service.ts",
      "electron/knowledge/space.ts",
      "tests/unit/gate-runner.test.ts",
      "tests/unit/knowledge-phase-f.test.ts",
      "docs/9-7-milestone-phase-15.md",
      "README.md",
      "Update-Log.md"
    ];
    for (const file of ordinary) expect(assessProtectedPaths([file]).protected, file).toBe(false);
  });

  it("keeps the Root Surface list finite and derived from CODEOWNERS, not from a directory sweep", () => {
    const root = fixtureWorkspace();
    const guard = new ProtectedSurfaceGuard({ root });
    const manifestPatterns = guard.patterns().filter((rule) => rule.source === "immutable-manifest");
    const codeownersPatterns = guard.patterns().filter((rule) => rule.source === "codeowners");
    expect(manifestPatterns.length).toBeGreaterThan(20);
    expect(codeownersPatterns.length).toBeGreaterThan(5);
    // No repository-wide rule exists in either boundary.
    expect(guard.patterns().some((rule) => rule.pattern === "*" || rule.pattern === "/*" || rule.pattern === "/")).toBe(false);
    // A random file deep in the tree is ordinary.
    write(root, "electron/knowledge/deep/new-file.ts", "export const a = 1;\n");
    expect(guard.assessChangeSet(["electron/knowledge/deep/new-file.ts"]).decision).toBe("ALLOW");
  });

  it("gates only the paths the plan names as Root Surface (§4 REQUIRE_OWNER)", () => {
    const root = fixtureWorkspace();
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "scope-run" });
    for (const ordinary of ["src/renderer/App.tsx", "electron/engineering/gate-runner.ts", "tests/unit/gate-runner.test.ts"]) {
      expect(authority.classify({ operation: "candidate.workspace.write", targets: [ordinary] }).decision).toBe("ALLOW");
    }
    for (const surface of ["electron/root-authority/root-authority.ts", ".github/workflows/ci.yml", "package.json", ".codex-boss/root/root-policy.json", "tests/unit/root-authority.test.ts"]) {
      expect(authority.classify({ operation: "candidate.workspace.write", targets: [surface] }).decision, surface).toBe("REQUIRE_OWNER");
    }
  });

  it("never lets a read of a Root Surface decide a write", () => {
    const root = fixtureWorkspace();
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "read-run" });
    // Reading CODEOWNERS is ordinary; writing it is not.
    expect(authority.classify({ operation: "candidate.workspace.read", targets: [".github/CODEOWNERS"] }).decision).toBe("ALLOW");
    expect(authority.classify({ operation: "candidate.workspace.write", targets: [".github/CODEOWNERS"] }).decision).toBe("REQUIRE_OWNER");
  });
});

describe("Root policy provenance is always visible", () => {
  it("reports the repository policy as non-degraded when it is present and valid", () => {
    const root = fixtureWorkspace();
    write(root, ".codex-boss/root/root-policy.json", serializeRootPolicy(DEFAULT_ROOT_POLICY));
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "provenance-run" });
    expect(authority.policySource).toBe("repository");
    expect(authority.policyDegraded).toBe(false);
    expect(authority.policyError).toBeUndefined();
    expect(authority.policy.rootOwner).toBe("zhiheng-zhang-Mera");
    expect(ROOT_OPERATION_FLOOR["self.elevation"]).toBe("DENY");
  });

  it("reports a degraded policy in the durable ledger reason", () => {
    const root = fixtureWorkspace();
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "degraded-run" });
    authority.classify({ operation: "candidate.workspace.write", targets: ["src/app/main.ts"] });
    expect(authority.policyDegraded).toBe(true);
    expect(authority.history()[0].reason).toMatch(/policy:fallback-missing/);
  });

  it("survives a policy file that is a directory", () => {
    const root = fixtureWorkspace();
    fs.mkdirSync(path.join(root, ".codex-boss", "root", "root-policy.json"), { recursive: true });
    const loaded = loadRootPolicy(root);
    expect(loaded.degraded).toBe(true);
    expect(loaded.policy.rootOwner).toBe("unresolved");
  });
});
