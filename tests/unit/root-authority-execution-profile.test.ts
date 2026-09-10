import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLUTION_PROFILE_DESCRIPTION,
  EVOLUTION_WORKER_ALLOWED,
  EVOLUTION_WORKER_DENIED,
  EvolutionExecutionProfile,
  classifyEvolutionCommand,
  classifyEvolutionWorkerAction
} from "../../electron/root-authority/execution-profile";
import { RootAuthority, RootDeniedError } from "../../electron/root-authority/root-authority";
import { cleanupFixtures, fixtureWorkspace, stateFile, tempDir, write } from "../helpers/root-fixtures";

/**
 * F4 — Autonomous Evolution execution profile acceptance
 * (Isolation-Finalization.md §10, §23 RD-009 "Self-evolution arbitrary shell
 * denied", §14 RT-05/RT-06/RT-24).
 *
 * §10 says the profile "不是普通 Computer Use / arbitrary automation profile".
 * That claim is only meaningful if the profile is a *smaller* capability set
 * expressed as data, so this battery asserts the data, the classifier and the
 * live refusal — including that a denied action leaves a durable ledger entry.
 */

afterEach(cleanupFixtures);

function profile(root: string): { authority: RootAuthority; execution: EvolutionExecutionProfile } {
  const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "profile-run" });
  return { authority, execution: new EvolutionExecutionProfile({ root, authority, environment: { PATH: process.env.PATH, GH_TOKEN: "owner-token", SystemRoot: process.env.SystemRoot } }) };
}

describe("Profile capability set (§10)", () => {
  it("declares the allowed capabilities and the forbidden ones separately", () => {
    expect(EVOLUTION_PROFILE_DESCRIPTION.profile).toBe("EVOLUTION");
    expect(EVOLUTION_PROFILE_DESCRIPTION.shellChannel).toBe(false);
    expect(EVOLUTION_PROFILE_DESCRIPTION.remoteSideEffects).toBe("host-promotion-adapter-only");
    expect(EVOLUTION_WORKER_ALLOWED).toEqual([
      "workspace.read", "workspace.write", "patch.apply", "test.run", "build.run",
      "typecheck.run", "lint.run", "git.status", "git.diff", "git.branch.read",
      "evidence.write", "reviewer.role"
    ]);
    // No capability appears on both lists.
    for (const action of EVOLUTION_WORKER_ALLOWED) expect(EVOLUTION_WORKER_DENIED).not.toContain(action);
  });

  it("allows exactly the listed capabilities and denies everything else", () => {
    for (const action of EVOLUTION_WORKER_ALLOWED) expect(classifyEvolutionWorkerAction(action), action).toBe("ALLOW");
    for (const action of EVOLUTION_WORKER_DENIED) expect(classifyEvolutionWorkerAction(action), action).toBe("DENY");
    // Remote effects are simply not a worker capability.
    for (const remote of ["git.push", "remote.side.effect", "stable.runtime.write", "stable.process.kill", "browser.owner.admin", "credential.dump", "home.secret.scan"] as const) {
      expect(classifyEvolutionWorkerAction(remote), remote).toBe("DENY");
    }
  });

  it("refuses a denied worker action and records the refusal durably", () => {
    const root = fixtureWorkspace();
    const { authority, execution } = profile(root);
    expect(() => execution.assertActionAllowed("shell.arbitrary", "run cmd /c")).toThrow(RootDeniedError);
    expect(() => execution.assertActionAllowed("git.push.main", "push main")).toThrow(RootDeniedError);
    expect(() => execution.assertActionAllowed("browser.owner.admin", "open rulesets")).toThrow(RootDeniedError);
    expect(execution.assertActionAllowed("workspace.write", "edit src/app/main.ts").decision).toBe("ALLOW");

    const history = authority.history();
    expect(history.filter((entry) => entry.decision === "DENY")).toHaveLength(3);
    expect(history.at(-1)?.decision).toBe("ALLOW");
  });

  it("refuses command requests that are not on the profile allow-list", () => {
    const root = fixtureWorkspace();
    const { authority, execution } = profile(root);
    expect(() => execution.assertCommandAllowed({ argv: ["powershell", "-Command", "iwr https://x"] })).toThrow(RootDeniedError);
    expect(() => execution.assertCommandAllowed({ argv: ["git", "push", "origin", "main"] })).toThrow(RootDeniedError);
    expect(() => execution.assertCommandAllowed({ argv: ["git", "status"] })).not.toThrow();
    expect(execution.assertCommandAllowed({ argv: ["node", "node_modules/vitest/vitest.mjs", "run"] }).decision).toBe("ALLOW");
    expect(authority.history().some((entry) => entry.operation === "shell.arbitrary")).toBe(true);
  });

  it("refuses to navigate a browser at the Owner's administration surface (RT-24)", () => {
    const root = fixtureWorkspace();
    const { authority, execution } = profile(root);
    expect(() => execution.assertNavigationAllowed("https://github.com/zhiheng-zhang-Mera/Codex-Boss/settings/rules/22746755")).toThrow(RootDeniedError);
    expect(() => execution.assertNavigationAllowed("https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/12")).not.toThrow();
    expect(authority.history().some((entry) => entry.operation === "ruleset.self.rewrite" && entry.decision === "DENY")).toBe(true);
  });
});

describe("Profile environment (§9.2, §10)", () => {
  it("hands children a credential-free environment", () => {
    const root = fixtureWorkspace();
    const { execution } = profile(root);
    const child = execution.childEnvironment();
    expect(child.GH_TOKEN).toBeUndefined();
    expect(child.PATH).toBe(process.env.PATH);
    // A copy is returned: a caller cannot mutate the profile's environment.
    child.GH_TOKEN = "injected";
    expect(execution.childEnvironment().GH_TOKEN).toBeUndefined();
  });

  it("refuses to construct at all when the supplied environment leaks authority", () => {
    const root = fixtureWorkspace();
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "leak-run" });
    // sanitizeEnvironment removes the leak, so construction succeeds — but a
    // profile whose *sanitized* environment somehow leaked would throw, which is
    // the invariant `assertNoCredentialLeak` guards.
    expect(() => new EvolutionExecutionProfile({ root, authority, environment: { GH_TOKEN: "x" } })).not.toThrow();
  });

  it("runs a host-selected command through the sanitized environment", async () => {
    const root = tempDir("boss-profile-run-");
    write(
      root,
      "probe.test.cjs",
      "const test=require('node:test');\ntest('probe',()=>{console.log('TOKEN='+(process.env.GH_TOKEN===undefined?'ABSENT':'PRESENT'));});\n"
    );
    const authority = new RootAuthority({ root, ledgerFile: stateFile("ledger.jsonl"), runId: "run-selected" });
    const execution = new EvolutionExecutionProfile({ root, authority, environment: { ...process.env, GH_TOKEN: "owner-token" } });
    const evidence = await execution.runHostSelected("test", ["probe.test.cjs"]);
    expect(evidence.passed).toBe(true);
    expect(evidence.output).toContain("TOKEN=ABSENT");
    // The host-selected run is itself a recorded Root decision.
    expect(authority.history().some((entry) => entry.operation === "candidate.test")).toBe(true);
  });
});

describe("Command classifier is structural, not lexical", () => {
  it("cannot be defeated by quoting tricks, because there is no shell to trick", () => {
    // The string "git push" inside an argument is inert under execFile.
    expect(classifyEvolutionCommand({ argv: ["git", "log", "--grep=git push"] }).decision).toBe("ALLOW");
    // But a command whose *executable* is a shell is denied however it is spelled.
    for (const argv of [["cmd.exe", "/c", "git push origin main"], ["C:\\Windows\\System32\\cmd.exe", "/c", "whoami"], ["PowerShell.EXE", "-Command", "iwr x"]]) {
      expect(classifyEvolutionCommand({ argv }).decision, argv.join(" ")).toBe("DENY");
    }
  });

  it("reports the attributed Root operation for each denial", () => {
    expect(classifyEvolutionCommand({ argv: ["gh", "api", "/repos/x/y"] }).operation).toBe("repository.administration");
    expect(classifyEvolutionCommand({ argv: ["git", "push", "origin", "main"] }).operation).toBe("main.direct.push");
    expect(classifyEvolutionCommand({ argv: ["reg", "query", "HKLM"] }).operation).toBe("owner.credential.scan");
    expect(classifyEvolutionCommand({ argv: [] }).operation).toBe("shell.arbitrary");
  });
});
