import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ROOT_OPERATION_FLOOR,
  ROOT_OPERATIONS,
  foldRootDecisions,
  isAtLeastAsStrict,
  strictestRootDecision,
  type RootOperation
} from "../../src/shared/root-authority/contracts";
import {
  DEFAULT_ROOT_POLICY,
  ROOT_POLICY_FALLBACK,
  RootPolicyError,
  decideRootOperation,
  decideRootOperations,
  parseRootPolicy,
  policyLoosensFloor,
  serializeRootPolicy
} from "../../src/shared/root-authority/root-policy";
import {
  ROOT_PROTECTED_MANIFEST,
  assessProtectedPaths,
  codeownersPatternToRegExp,
  normalizeRepoPath,
  parseCodeownersPatterns
} from "../../src/shared/root-authority/protected-surface";
import { ProtectedSurfaceGuard } from "../../electron/root-authority/protected-surface-guard";
import { RootAuditLedger, RootAuditError } from "../../electron/root-authority/root-audit-ledger";
import { RootAuthority, RootSurfaceError } from "../../electron/root-authority/root-authority";
import { isClaimedRootOwner, loadRootPolicy } from "../../electron/root-authority/root-policy-loader";

/**
 * F1 — Root Authority acceptance (Isolation-Finalization.md §4, §7, §16, §23
 * RD-001..RD-003, RD-009). Every assertion below drives the real classifier over
 * real files; nothing here special-cases a fixture.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
/** A workspace with a CODEOWNERS boundary, mirroring the repository layout. */
function workspace(): string {
  const root = temp("boss-root-ws-");
  fs.mkdirSync(path.join(root, ".github"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".github", "CODEOWNERS"),
    ["# fixture", "/package.json @owner", "/electron/root-authority/ @owner", "/src/**/root-authority/ @owner", "/tests/**/root-authority*.test.* @owner"].join("\n"),
    "utf8"
  );
  fs.mkdirSync(path.join(root, "src", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app", "main.ts"), "export const a = 1;\n", "utf8");
  return root;
}
/** Ledger outside the workspace, as production requires. */
function ledgerPath(): string {
  return path.join(temp("boss-root-ledger-"), "root-decisions.jsonl");
}

describe("RootDecision composition (§4)", () => {
  it("is totally ordered by strictness and never loosens", () => {
    expect(strictestRootDecision("ALLOW", "ALLOW")).toBe("ALLOW");
    expect(strictestRootDecision("ALLOW", "REQUIRE_OWNER")).toBe("REQUIRE_OWNER");
    expect(strictestRootDecision("REQUIRE_OWNER", "DENY")).toBe("DENY");
    expect(strictestRootDecision("DENY", "ALLOW")).toBe("DENY");
    expect(foldRootDecisions([])).toBe("ALLOW");
    expect(foldRootDecisions(["ALLOW", "REQUIRE_OWNER", "ALLOW"])).toBe("REQUIRE_OWNER");
    expect(isAtLeastAsStrict("DENY", "REQUIRE_OWNER")).toBe(true);
    expect(isAtLeastAsStrict("ALLOW", "REQUIRE_OWNER")).toBe(false);
  });

  it("declares a floor for every operation", () => {
    for (const operation of ROOT_OPERATIONS) expect(ROOT_OPERATION_FLOOR[operation]).toBeTruthy();
  });
});

describe("Root Policy (§7.1)", () => {
  it("ships the policy named by the plan", () => {
    expect(DEFAULT_ROOT_POLICY.schemaVersion).toBe(1);
    expect(DEFAULT_ROOT_POLICY.rootOwner).toBe("zhiheng-zhang-Mera");
    expect(DEFAULT_ROOT_POLICY.selfElevation).toBe("DENY");
    expect(DEFAULT_ROOT_POLICY.ownerCredentialAccess).toBe("DENY");
    expect(DEFAULT_ROOT_POLICY.directMainMutation).toBe("DENY");
    expect(DEFAULT_ROOT_POLICY.rulesetMutation).toBe("DENY");
    expect(DEFAULT_ROOT_POLICY.protectedSurfaceMutation).toBe("REQUIRE_OWNER");
    expect(DEFAULT_ROOT_POLICY.promotionGateMutation).toBe("REQUIRE_OWNER");
    expect(DEFAULT_ROOT_POLICY.emergencyControlMutation).toBe("REQUIRE_OWNER");
  });

  it("cannot be loosened by a policy file: the floor is applied after the policy", () => {
    const permissive = parseRootPolicy({
      schemaVersion: 1,
      rootOwner: "zhiheng-zhang-Mera",
      selfElevation: "ALLOW",
      ownerCredentialAccess: "ALLOW",
      directMainMutation: "ALLOW",
      rulesetMutation: "ALLOW",
      protectedSurfaceMutation: "ALLOW",
      promotionGateMutation: "ALLOW",
      emergencyControlMutation: "ALLOW"
    });
    // Every operation that can carry a policy knob keeps at least its floor.
    const denied: RootOperation[] = ["self.elevation", "owner.credential.use", "main.direct.push", "git.force.push", "repository.administration", "ruleset.self.rewrite", "required.check.bypass", "stale.sha.promotion", "shell.arbitrary", "workspace.escape"];
    for (const operation of denied) expect(decideRootOperation(permissive, operation)).toBe("DENY");
    expect(decideRootOperation(permissive, "protected.surface.mutate")).toBe("REQUIRE_OWNER");
    expect(policyLoosensFloor(permissive).length).toBeGreaterThan(0);
  });

  it("rejects an unknown schema, a non-login Owner, and any decision outside the vocabulary", () => {
    const base = { ...DEFAULT_ROOT_POLICY } as unknown as Record<string, unknown>;
    expect(() => parseRootPolicy({ ...base, schemaVersion: 2 })).toThrow(RootPolicyError);
    expect(() => parseRootPolicy({ ...base, rootOwner: "two owners" })).toThrow(RootPolicyError);
    expect(() => parseRootPolicy({ ...base, selfElevation: "MAYBE" })).toThrow(RootPolicyError);
    const missing = { ...base };
    delete missing.emergencyControlMutation;
    expect(() => parseRootPolicy(missing)).toThrow(RootPolicyError);
  });

  it("refuses to load a policy that carries secret material", () => {
    const base = { ...DEFAULT_ROOT_POLICY } as unknown as Record<string, unknown>;
    // A realistic mistake: pasting an Owner token next to the policy.
    expect(() => parseRootPolicy({ ...base, note: "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" })).toThrow(/secret material/);
  });

  it("round-trips through validation", () => {
    expect(parseRootPolicy(JSON.parse(serializeRootPolicy(DEFAULT_ROOT_POLICY))).rootOwner).toBe("zhiheng-zhang-Mera");
  });

  it("falls back fail-closed when the repository policy is missing or unreadable, and says why", () => {
    const root = workspace();
    const missing = loadRootPolicy(root);
    expect(missing.source).toBe("fallback-missing");
    expect(missing.degraded).toBe(true);
    expect(missing.policy).toEqual(ROOT_POLICY_FALLBACK);

    const policyFile = path.join(root, "policy.json");
    fs.writeFileSync(policyFile, "{ not json", "utf8");
    expect(loadRootPolicy(root, policyFile).source).toBe("fallback-unreadable");

    fs.writeFileSync(policyFile, JSON.stringify({ ...DEFAULT_ROOT_POLICY, schemaVersion: 9 }), "utf8");
    const invalid = loadRootPolicy(root, policyFile);
    expect(invalid.source).toBe("fallback-invalid");
    expect(invalid.error).toMatch(/schemaVersion/);

    // An unresolved fallback names no Owner, so nobody can claim to be one.
    expect(isClaimedRootOwner(missing.policy, "zhiheng-zhang-Mera")).toBe(false);
    expect(isClaimedRootOwner(DEFAULT_ROOT_POLICY, "zhiheng-zhang-Mera")).toBe(true);
    expect(isClaimedRootOwner(DEFAULT_ROOT_POLICY, "someone-else")).toBe(false);
  });
});

describe("Protected Surface (§7.2)", () => {
  it("protects the manifest paths named by CODEOWNERS and leaves ordinary code alone", () => {
    for (const protectedPath of [".github/CODEOWNERS", ".github/workflows/ci.yml", "package.json", "pnpm-lock.yaml", "tsconfig.json", "vitest.config.mjs", "scripts/acceptance-restart.cjs", ".codex-boss/root/root-policy.json", "electron/root-authority/root-authority.ts", "src/shared/root-authority/contracts.ts", "electron/credential-boundary/credential-boundary.ts", "electron/stable-candidate/runtime-isolation.ts", "electron/promotion-gate/promotion-controller.ts", "electron/emergency-control/emergency-control.ts", "electron/root-recovery/rollback-controller.ts", "tests/unit/root-authority.test.ts"]) {
      expect(assessProtectedPaths([protectedPath]).protected, protectedPath).toBe(true);
    }
    for (const ordinary of ["src/app/main.ts", "electron/engineering/gate-runner.ts", "README.md", "tests/unit/gate-runner.test.ts", "src/shared/knowledge.ts"]) {
      expect(assessProtectedPaths([ordinary]).protected, ordinary).toBe(false);
    }
  });

  it("normalizes before judging, and treats an escaping path as an escape rather than as unprotected", () => {
    expect(normalizeRepoPath("./src/app/../app/main.ts")).toBe("src/app/main.ts");
    expect(normalizeRepoPath("src\\shared\\root-authority\\contracts.ts")).toBe("src/shared/root-authority/contracts.ts");
    expect(normalizeRepoPath("../../etc/passwd")).toBeUndefined();
    expect(normalizeRepoPath("/etc/passwd")).toBeUndefined();
    expect(normalizeRepoPath("C:/Windows/system32")).toBeUndefined();

    // `src/../package.json` is still package.json: traversal cannot launder it.
    expect(assessProtectedPaths(["src/../package.json"]).protected).toBe(true);
    const escaped = assessProtectedPaths(["../outside/package.json"]);
    expect(escaped.protected).toBe(false);
    expect(escaped.escapes).toHaveLength(1);
  });

  it("handles host case differences and CODEOWNERS-only patterns", () => {
    expect(assessProtectedPaths(["PACKAGE.JSON"]).protected).toBe(true);
    expect(assessProtectedPaths(["src/Shared/Root-Authority/Contracts.ts"]).protected).toBe(true);
    // A pattern that exists only in CODEOWNERS is honoured through extraPatterns.
    expect(assessProtectedPaths(["docs/owner-notes.md"], [], { extraPatterns: ["/docs/owner-notes.md"] }).protected).toBe(true);
    expect(assessProtectedPaths(["docs/owner-notes.md"]).protected).toBe(false);
  });

  it("parses CODEOWNERS lines with owners and ignores ownerless patterns", () => {
    const patterns = parseCodeownersPatterns(["# comment", "", "/package.json @owner", "/orphan.txt", "/a/b.ts @owner @other", "   ", "/trailing/ @owner"].join("\n"));
    expect(patterns).toEqual(["/package.json", "/a/b.ts", "/trailing/"]);
    // Directory patterns cover their contents.
    expect(codeownersPatternToRegExp("/electron/root-authority/").test("electron/root-authority/root-authority.ts")).toBe(true);
    expect(codeownersPatternToRegExp("/tests/**/root-authority*.test.*").test("tests/unit/root-authority.test.ts")).toBe(true);
    expect(codeownersPatternToRegExp("/src/**/root-authority/").test("src/shared/root-authority/contracts.ts")).toBe(true);
  });

  it("assesses a rename on both source and destination, and a delete on its target", () => {
    const root = workspace();
    const guard = new ProtectedSurfaceGuard({ root });
    // Moving an ordinary file INTO a protected surface must be caught.
    const inbound = guard.assessChanges([{ path: "electron/root-authority/sneaky.ts", from: "src/app/main.ts", kind: "rename" }]);
    expect(inbound.decision).toBe("REQUIRE_OWNER");
    // Moving a protected file OUT must be caught too.
    const outbound = guard.assessChanges([{ path: "src/app/package.json", from: "package.json", kind: "rename" }]);
    expect(outbound.decision).toBe("REQUIRE_OWNER");
    // Deleting a protected file is a mutation of the surface.
    expect(guard.assessChanges([{ path: ".github/CODEOWNERS", kind: "delete" }]).decision).toBe("REQUIRE_OWNER");
    // A new file that does not exist yet, inside a protected directory, is caught.
    expect(guard.assessChanges([{ path: "electron/root-authority/brand-new.ts", kind: "create" }]).decision).toBe("REQUIRE_OWNER");
  });

  it("still protects everything when CODEOWNERS is deleted or empty (fail-closed)", () => {
    const root = workspace();
    fs.rmSync(path.join(root, ".github", "CODEOWNERS"));
    const guard = new ProtectedSurfaceGuard({ root });
    expect(guard.codeownersMissing).toBe(true);
    expect(guard.assessChanges([{ path: ".github/CODEOWNERS", kind: "delete" }]).decision).toBe("REQUIRE_OWNER");
    expect(guard.assessChanges([{ path: "package.json", kind: "write" }]).decision).toBe("REQUIRE_OWNER");
    expect(guard.assessChanges([{ path: "src/app/main.ts", kind: "write" }]).decision).toBe("ALLOW");
    expect(ROOT_PROTECTED_MANIFEST.length).toBeGreaterThan(20);
  });

  it("denies containment escapes: traversal, absolute paths outside, and junction escape", () => {
    const root = workspace();
    const outside = temp("boss-root-outside-");
    fs.writeFileSync(path.join(outside, "stable.ts"), "export const stable = 1;\n", "utf8");
    // A directory junction/symlink is a real link, not a simulated one.
    fs.symlinkSync(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");

    const guard = new ProtectedSurfaceGuard({ root });
    expect(guard.assessChanges([{ path: "../stable.txt", kind: "write" }]).decision).toBe("DENY");
    expect(guard.assessChanges([{ path: path.join(outside, "stable.ts"), kind: "write" }]).decision).toBe("DENY");
    const junction = guard.assessChanges([{ path: "escape/stable.ts", kind: "write" }]);
    expect(junction.decision).toBe("DENY");
    expect(junction.escapes.length).toBe(1);
    // A symlink that stays inside the workspace is legitimately contained.
    fs.symlinkSync(path.join(root, "src", "app"), path.join(root, "inside-link"), process.platform === "win32" ? "junction" : "dir");
    expect(guard.assessChanges([{ path: "inside-link/main.ts", kind: "write" }]).decision).toBe("ALLOW");
  });

  it("classifies a change set by its protected paths", () => {
    const root = workspace();
    const guard = new ProtectedSurfaceGuard({ root });
    expect(guard.assessChangeSet(["src/app/main.ts"]).decision).toBe("ALLOW");
    const mixed = guard.assessChangeSet(["src/app/main.ts", ".github/workflows/ci.yml"]);
    expect(mixed.decision).toBe("REQUIRE_OWNER");
    expect(mixed.protected.map((hit) => hit.path)).toContain(".github/workflows/ci.yml");
  });
});

describe("Root Audit Ledger (§7.3)", () => {
  it("is append-only with a verifiable hash chain", () => {
    const ledger = new RootAuditLedger(ledgerPath());
    ledger.append({ timestamp: "t1", runId: "r", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null });
    ledger.append({ timestamp: "t2", runId: "r", actor: "a", operation: "self.elevation", target: "-", decision: "DENY", reason: "no", candidateSha: null });
    const entries = ledger.entries();
    expect(entries).toHaveLength(2);
    expect(entries[0].seq).toBe(1);
    expect(entries[0].prevHash).toBe("");
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[1].hash).not.toBe(entries[0].hash);
  });

  it("detects truncation, deletion and tampering instead of continuing", () => {
    const file = ledgerPath();
    const ledger = new RootAuditLedger(file);
    ledger.append({ timestamp: "t1", runId: "r", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null });
    ledger.append({ timestamp: "t2", runId: "r", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null });

    // Truncation: keep only the first record.
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    fs.writeFileSync(file, lines[0] + "\n", "utf8");
    expect(() => ledger.append({ timestamp: "t3", runId: "r", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null })).toThrow(RootAuditError);

    // Deletion: the whole ledger disappears.
    fs.rmSync(file);
    expect(() => ledger.append({ timestamp: "t4", runId: "r", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null })).toThrow(RootAuditError);

    // Tampering: rewrite a record in place.
    const rebuilt = new RootAuditLedger(ledgerPath());
    rebuilt.append({ timestamp: "t1", runId: "r", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null });
    const tamperedFile = rebuilt.path;
    const entry = JSON.parse(fs.readFileSync(tamperedFile, "utf8").trim());
    entry.decision = "ALLOW";
    entry.reason = "rewritten";
    fs.writeFileSync(tamperedFile, JSON.stringify(entry) + "\n", "utf8");
    expect(() => rebuilt.entries()).toThrow(/modified/);
  });

  it("reports a write failure instead of dropping audit (FI-03)", () => {
    const ledger = new RootAuditLedger(path.join(temp("boss-root-ledger-"), "nested", "x.jsonl"));
    // Occupy the parent path with a file so mkdir/append cannot succeed.
    const blocker = path.join(temp("boss-root-block-"), "blocked.jsonl");
    fs.writeFileSync(blocker, "x", "utf8");
    const broken = new RootAuditLedger(path.join(blocker, "child.jsonl"));
    expect(() => broken.append({ timestamp: "t", runId: "r", actor: "a", operation: "candidate.test", target: "-", decision: "ALLOW", reason: "ok", candidateSha: null })).toThrow(RootAuditError);
    expect(ledger.count()).toBe(0);
  });
});

describe("RootAuthority classification and attribution (§7, §16)", () => {
  function authority(root: string) {
    return new RootAuthority({ root, ledgerFile: ledgerPath(), runId: "run-1", candidateSha: "a".repeat(40) });
  }

  it("records ALLOW, REQUIRE_OWNER and DENY as durable state, not log strings", () => {
    const root = workspace();
    fs.mkdirSync(path.join(root, ".codex-boss", "root"), { recursive: true });
    fs.writeFileSync(path.join(root, ".codex-boss", "root", "root-policy.json"), serializeRootPolicy(DEFAULT_ROOT_POLICY), "utf8");
    const authorityInstance = authority(root);

    expect(authorityInstance.classify({ operation: "candidate.workspace.write", targets: ["src/app/main.ts"], mode: "OWNER_RESULT" }).decision).toBe("ALLOW");
    expect(authorityInstance.classify({ operation: "candidate.workspace.write", targets: ["package.json"] }).decision).toBe("REQUIRE_OWNER");
    expect(authorityInstance.classify({ operation: "main.direct.push", mode: "OWNER_RESULT" }).decision).toBe("DENY");

    const history = authorityInstance.history();
    expect(history).toHaveLength(3);
    expect(history.map((entry) => entry.decision)).toEqual(["ALLOW", "REQUIRE_OWNER", "DENY"]);
    expect(history[2].reason).toMatch(/floor:main\.direct\.push/);
    expect(history[0].candidateSha).toBe("a".repeat(40));
    expect(history[1].target).toBe("package.json");
  });

  it("refuses to construct when the ledger lives inside the candidate workspace", () => {
    const root = workspace();
    expect(() => new RootAuthority({ root, ledgerFile: path.join(root, "ledger.jsonl") })).toThrow(RootSurfaceError);
  });

  it("enforce() throws on DENY and classifies the named §4 guards as DENY", () => {
    const root = workspace();
    const authorityInstance = authority(root);
    for (const classify of [
      () => authorityInstance.refuseSelfElevation("grant bypass"),
      () => authorityInstance.refuseOwnerIdentityChange("become owner"),
      () => authorityInstance.refuseDirectMainPush("push main"),
      () => authorityInstance.refuseOwnerCredentialAccess("use owner token"),
      () => authorityInstance.refuseRepositoryAdministration("patch ruleset"),
      () => authorityInstance.refuseStaleShaPromotion("reuse old PASS"),
      () => authorityInstance.refuseArbitraryShell("run cmd /c"),
      () => authorityInstance.refuseWorkspaceEscape("write stable", ["../stable/x"])
    ]) {
      expect(classify().decision).toBe("DENY");
    }
    expect(() => authorityInstance.enforce({ operation: "self.elevation" })).toThrow();
    expect(authorityInstance.history().every((entry) => entry.decision === "DENY")).toBe(true);
  });

  it("records an Owner claim that the policy does not name as DENY, and never as consent", () => {
    const root = workspace();
    const authorityInstance = authority(root);
    // No repository policy here ⇒ fallback ⇒ nobody is the Owner.
    expect(authorityInstance.acceptOwnerClaim("zhiheng-zhang-Mera", "self-declared")).toBe(false);
    const claim = authorityInstance.history().at(-1);
    expect(claim?.decision).toBe("DENY");
  });

  it("keeps a run at or above REQUIRE_OWNER for every Root-sensitive operation", () => {
    const sensitive: RootOperation[] = ["protected.surface.mutate", "ci.gate.mutate", "root.authority.mutate", "credential.boundary.mutate", "promotion.gate.mutate", "stable.candidate.boundary.mutate", "emergency.control.mutate", "root.invariant.test.mutate", "owner.identity.mutate"];
    expect(decideRootOperations(DEFAULT_ROOT_POLICY, sensitive)).toBe("DENY");
    const strictlyProtected: RootOperation[] = ["protected.surface.mutate", "ci.gate.mutate", "root.authority.mutate", "credential.boundary.mutate", "promotion.gate.mutate", "stable.candidate.boundary.mutate", "emergency.control.mutate", "root.invariant.test.mutate"];
    expect(decideRootOperations(DEFAULT_ROOT_POLICY, strictlyProtected)).toBe("REQUIRE_OWNER");
  });

  it("has no mode that turns DENY into ALLOW", () => {
    const root = workspace();
    const authorityInstance = authority(root);
    for (const mode of ["ASSISTED", "AUTONOMOUS", "OWNER_RESULT", "EVOLUTION", "UNKNOWN"] as const) {
      expect(authorityInstance.classify({ operation: "self.elevation", mode }).decision).toBe("DENY");
      expect(authorityInstance.classify({ operation: "owner.credential.use", mode }).decision).toBe("DENY");
      expect(authorityInstance.classify({ operation: "ruleset.self.rewrite", mode }).decision).toBe("DENY");
    }
  });
});
