import { afterEach, describe, expect, it } from "vitest";
import { ROOT_OPERATION_FLOOR, type RootOperation } from "../../src/shared/root-authority/contracts";
import { DEFAULT_ROOT_POLICY, decideRootOperation, parseRootPolicy, policyDecisionFor } from "../../src/shared/root-authority/root-policy";
import { RootAuthority } from "../../electron/root-authority/root-authority";
import { writeRootPolicy } from "../../electron/root-authority/root-policy-loader";
import { classifyEvolutionCommand } from "../../electron/root-authority/execution-profile";
import { cleanupFixtures, fixtureWorkspace, stateFile } from "../helpers/root-fixtures";

/**
 * Self-elevation acceptance (Isolation-Finalization.md §4 DENY, §23 RD-002,
 * §14 RT-05..RT-08).
 *
 * The Root invariant is not "Boss is polite". It is "Boss cannot, even if it
 * becomes adversarial or simply wrong, acquire Owner-equivalent authority". This
 * battery enumerates the concrete escalations the plan names and asserts each
 * one is DENY — then asserts that no policy file, no run mode and no execution
 * profile can move any of them.
 */

afterEach(cleanupFixtures);

/** Every escalation §4 lists as absolutely forbidden. */
const ESCALATIONS: { id: string; operation: RootOperation; label: string }[] = [
  { id: "EG-01", operation: "self.elevation", label: "make Boss itself the Root Owner" },
  { id: "EG-02", operation: "owner.identity.mutate", label: "rewrite the Owner identity to get around the Owner" },
  { id: "EG-03", operation: "required.check.bypass", label: "give itself a required-check bypass" },
  { id: "EG-04", operation: "main.protection.disable", label: "switch off or bypass Main-Protection" },
  { id: "EG-05", operation: "emergency.stop.disable", label: "delete or disable the Owner emergency stop" },
  { id: "EG-06", operation: "owner.credential.use", label: "use an Owner credential" },
  { id: "EG-07", operation: "owner.credential.scan", label: "scan for or copy Owner credentials" },
  { id: "EG-08", operation: "repository.administration", label: "call repository administration" },
  { id: "EG-09", operation: "main.direct.push", label: "push main directly" },
  { id: "EG-10", operation: "git.force.push", label: "force push" },
  { id: "EG-11", operation: "stale.sha.promotion", label: "prove a new SHA with an old SHA's PASS" },
  { id: "EG-12", operation: "stable.worktree.write", label: "have a Candidate write the Stable working tree" },
  { id: "EG-13", operation: "stable.runtime.write", label: "have a Candidate overwrite Stable runtime-data" },
  { id: "EG-14", operation: "shell.arbitrary", label: "open an arbitrary shell in the evolution profile" },
  { id: "EG-15", operation: "workspace.escape", label: "escape the Candidate workspace via symlink/junction/traversal" },
  { id: "EG-16", operation: "ruleset.self.rewrite", label: "change the rules and then claim the rules pass" },
  { id: "EG-17", operation: "gate.self.rewrite", label: "weaken its own promotion gate" }
];

describe("§4 DENY is absolute and mode-independent (RD-002)", () => {
  it("denies every escalation the plan enumerates", () => {
    for (const escalation of ESCALATIONS) {
      expect(decideRootOperation(DEFAULT_ROOT_POLICY, escalation.operation), `${escalation.id} ${escalation.label}`).toBe("DENY");
      // No escalation has an ALLOW floor either — the floor is the last word on
      // what a policy file is allowed to be lenient about.
      expect(ROOT_OPERATION_FLOOR[escalation.operation], escalation.id).not.toBe("ALLOW");
    }
  });

  it("denies them for every run mode, including OWNER_RESULT and EVOLUTION", () => {
    const root = fixtureWorkspace();
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "self-elevation" });
    for (const mode of ["ASSISTED", "AUTONOMOUS", "OWNER_RESULT", "EVOLUTION", "UNKNOWN"] as const) {
      for (const escalation of ESCALATIONS) {
        const classification = authority.classify({ operation: escalation.operation, mode });
        expect(classification.decision, `${escalation.id} under ${mode}`).toBe("DENY");
      }
    }
    // Every attempt is durably recorded, not merely refused.
    expect(authority.history()).toHaveLength(ESCALATIONS.length * 5);
  });

  it("denies them even when the policy file asks for ALLOW", () => {
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
    for (const escalation of ESCALATIONS) {
      const decision = decideRootOperation(permissive, escalation.operation);
      // Never ALLOW. Operations whose floor is DENY stay DENY; the one operation
      // whose floor is REQUIRE_OWNER (an Owner-identity edit) can only fall back
      // to that floor, which still parks it on the Owner.
      expect(decision, escalation.id).not.toBe("ALLOW");
      if (ROOT_OPERATION_FLOOR[escalation.operation] === "DENY") expect(decision, escalation.id).toBe("DENY");
      else expect(decision, escalation.id).toBe("REQUIRE_OWNER");
    }
    // The policy *did* loosen its own knobs — and the floor ignored that.
    expect(policyDecisionFor(permissive, "self.elevation")).toBe("ALLOW");
  });

  it("denies a policy that tries to remove its own gate", () => {
    const root = fixtureWorkspace();
    // Writing a looser Root Policy is still REQUIRE_OWNER, and the mutation is
    // recorded as such — the autonomous path cannot rewrite its own policy.
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "policy-rewrite" });
    expect(authority.classify({ operation: "root.policy.mutate", targets: [".codex-boss/root/root-policy.json"] }).decision).toBe("REQUIRE_OWNER");
    // And the Owner-authored write of a policy is possible directly on disk.
    writeRootPolicy(root, DEFAULT_ROOT_POLICY);
    expect(authority.classify({ operation: "candidate.workspace.write", targets: [".codex-boss/root/root-policy.json"] }).decision).toBe("REQUIRE_OWNER");
  });
});

describe("§4 escalation attempts are refused at the execution boundary (RT-05..RT-08)", () => {
  it("denies arbitrary shells, escalation binaries, and unknown executables", () => {
    const denied: [string[], string?][] = [
      [[], undefined],
      [["cmd", "/c", "whoami"]],
      [["cmd.exe", "/c", "dir"]],
      [["powershell", "-Command", "Get-ChildItem"]],
      [["pwsh", "-c", "ls"]],
      [["bash", "-c", "ls"]],
      [["sh", "-c", "ls"]],
      [["gh", "api", "/repos/x/y/rulesets"]],
      [["curl", "https://api.github.com"]],
      [["wget", "https://example.com"]],
      [["reg", "query", "HKLM"]],
      [["cmdkey", "/list"]],
      [["ssh", "git@github.com"]],
      [["totally-unknown-binary", "--go"]]
    ];
    for (const [argv] of denied) {
      expect(classifyEvolutionCommand({ argv }).decision, argv.join(" ")).toBe("DENY");
    }
    // A raw shell string is refused before the executable is even considered.
    expect(classifyEvolutionCommand({ argv: ["node"], shell: "git push origin main" }).decision).toBe("DENY");
    expect(classifyEvolutionCommand({ argv: ["node"], shell: "git push origin main" }).operation).toBe("shell.arbitrary");
  });

  it("denies every mutating git subcommand, including pushes to main", () => {
    const mutating = [
      ["git", "push", "origin", "main"],
      ["git", "push", "--force", "origin", "main"],
      ["git", "push"],
      ["git", "fetch"],
      ["git", "pull"],
      ["git", "remote", "add", "evil", "https://example.com"],
      ["git", "clone", "https://example.com/x"],
      ["git", "reset", "--hard", "HEAD~1"],
      ["git", "checkout", "main"],
      ["git", "switch", "main"],
      ["git", "clean", "-fd"],
      ["git", "commit", "-m", "x"],
      ["git", "merge", "other"],
      ["git", "rebase", "main"],
      ["git", "config", "user.email", "evil@example.com"],
      ["git", "apply", "patch.diff"]
    ];
    for (const argv of mutating) {
      expect(classifyEvolutionCommand({ argv }).decision, argv.join(" ")).toBe("DENY");
    }
    // Read-only inspection stays available, because that is how a Candidate
    // understands its own diff.
    for (const argv of [["git", "status", "--short"], ["git", "diff", "--stat"], ["git", "rev-parse", "HEAD"], ["git", "log", "-1"]]) {
      expect(classifyEvolutionCommand({ argv }).decision, argv.join(" ")).toBe("ALLOW");
    }
  });

  it("denies node eval flags, which are a shell channel in disguise", () => {
    expect(classifyEvolutionCommand({ argv: ["node", "-e", "require('child_process').execSync('whoami')"] }).decision).toBe("DENY");
    expect(classifyEvolutionCommand({ argv: ["node", "--eval", "1"] }).decision).toBe("DENY");
    expect(classifyEvolutionCommand({ argv: ["node", "-p", "process.env.GH_TOKEN"] }).decision).toBe("DENY");
    expect(classifyEvolutionCommand({ argv: ["node", "node_modules/vitest/vitest.mjs", "run"] }).decision).toBe("ALLOW");
    expect(classifyEvolutionCommand({ argv: ["node", "some-random-script.js"] }).decision).toBe("DENY");
  });
});
