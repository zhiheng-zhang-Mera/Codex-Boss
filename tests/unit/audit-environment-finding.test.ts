import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepoEngineeringOperations } from "../../electron/engineering/repo-engineering-operations";
import { createLiveEngineeringOperations } from "../../electron/engineering/live-engineering-operations";
import { isEnvironmentFinding } from "../../src/shared/engineering-loop";
import type { EngineeringGoalContract } from "../../src/shared/engineering-loop";

/**
 * PF-DEBT-009 — an environment fault must not be reported as a code defect.
 *
 * The audit's allowed commands run the workspace's OWN tooling by absolute path
 * (`node_modules/typescript/bin/tsc`, `node_modules/vitest/vitest.mjs`). A workspace without those —
 * a fresh clone, a linked worktree, a CI container before install — fails both commands, and that
 * failure used to be mapped straight to a HIGH code finding. Scope inference then found no candidate
 * file, because the diagnostic names `node_modules/typescript/bin/tsc`, a path with NO file extension
 * that the scope tokenizer does not match. The loop aborted with "scope inference found no candidate
 * file", so the reader could not tell "the compiler is not installed" from "the code does not
 * compile", and no patch could ever clear it.
 *
 * These tests hold BOTH directions. Classifying every failure as environmental would be the opposite
 * bug and would make the audit useless, so the second half asserts that a genuine compiler diagnostic
 * still produces a scoped code finding.
 */

const AT = "2026-09-16T00:00:00.000Z";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-env-finding-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function goal(workspace: string): EngineeringGoalContract {
  return {
    schemaVersion: 1,
    id: "goal-env",
    objective: "audit the workspace",
    workspace,
    protectedProductBehavior: [],
    allowedChangeScope: ["src/"],
    forbiddenChangeScope: [],
    verificationPolicy: "standard",
    agentCount: 1,
    convergencePolicy: { cleanRoundsRequired: 1 },
    createdAt: AT
  };
}

/** A workspace with no node_modules — the state a fresh clone or a linked worktree starts in. */
function bareWorkspace(): string {
  const workspace = path.join(dir, "bare");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "bare", version: "1.0.0" }), "utf8");
  return workspace;
}

describe("Phase 06 — an unbuildable workspace is reported as an environment fault", () => {
  it("classifies a missing toolchain as environment, not as a code defect", async () => {
    const workspace = bareWorkspace();
    expect(fs.existsSync(path.join(workspace, "node_modules"))).toBe(false);

    const findings = await createRepoEngineeringOperations({ workspace }).audit(goal(workspace));

    // The audit still reports the problem — it is not swallowed. What changed is WHAT it says.
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(isEnvironmentFinding(finding), `${finding.id} should be an environment finding`).toBe(true);
      expect(finding.kind).toBe("environment");
      expect(finding.area).toBe("environment");
      // The id says which command could not run, so a reader sees the shape immediately.
      expect(finding.id).toMatch(/^environment:(typecheck|test)$/);
      expect(finding.description).toContain("could not run");
    }
    // And the evidence states the consequence rather than leaving it to be inferred.
    expect(findings[0]!.evidence).toContain("No source change can clear this");
  });

  it("refuses to implement an environment fault, and says why", async () => {
    // The half that made the defect expensive: the loop used to run scope inference on this finding,
    // find nothing, and abort with a message about candidate files.
    const workspace = bareWorkspace();
    const live = createLiveEngineeringOperations({
      workspace,
      goal: goal(workspace),
      worker: { async ask() { throw new Error("the coder must not be reached for an environment fault"); } }
    });
    const finding = { id: "environment:typecheck", area: "environment", severity: "HIGH" as const, kind: "environment" as const, description: "the typecheck command could not run" };

    const outcome = await live.implement(goal(workspace), finding);
    expect(outcome.changedFiles).toEqual([]);
    expect(outcome.error).toContain("environment fault, not a code defect");
    expect(outcome.error).toContain("must be made buildable first");
    // It must NOT report the old, misleading reason.
    expect(outcome.error).not.toContain("scope inference found no candidate file");
  });
});

describe("Phase 06 — a real compiler diagnostic still produces a scoped code finding", () => {
  it("keeps a genuine type failure a code finding once the workspace is buildable", async () => {
    // The direction that must not regress. This is the ONLY way to prove it end to end: the audit runs
    // the workspace's own tooling, so the workspace has to actually have it. The install is the same
    // precondition the dogfooding harness establishes.
    const workspace = path.join(dir, "broken");
    fs.mkdirSync(path.join(workspace, "src", "shared"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "src", "shared", "broken.ts"), "export const value: number = \"not a number\";\n", "utf8");
    fs.writeFileSync(path.join(workspace, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }), "utf8");
    // The workspace declares the tool the audit will run, so the install actually produces it.
    // Versioned from this repository's own devDependencies rather than hardcoded, so the test cannot
    // silently install something the project does not use.
    const repoPackage = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { devDependencies?: Record<string, string> };
    const typescriptVersion = repoPackage.devDependencies?.typescript;
    expect(typescriptVersion, "this repository must pin a typescript version for the audit to run one").toBeTruthy();
    fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({
      name: "broken", version: "1.0.0", private: true,
      devDependencies: { typescript: typescriptVersion }
    }), "utf8");

    // Two install routes, and the SAME assertion either way. A warm local store is the fast route (~4 s);
    // when there is no usable store the network is the route. Neither is a precondition this test may
    // demand.
    //
    // It previously demanded the warm route: it passed `--offline` whenever `D:\.pnpm-store` merely
    // EXISTED, and failed on the CI runner because that directory exists there but is not a usable pnpm
    // store — so the install died and took the test with it, for a reason with nothing to do with the
    // audit. "That directory exists" is not the same question as "that store is usable", and
    // `--offline` turns the wrong answer into a hard failure instead of a slow one.
    const install = (flags: string): void => {
      execFileSync("powershell", ["-NoProfile", "-Command", `corepack pnpm install --ignore-scripts${flags}`], {
        cwd: workspace,
        windowsHide: true,
        timeout: 600_000,
        stdio: ["ignore", "ignore", "ignore"]
      });
    };
    const storeDir = process.env.BOSS_PNPM_STORE ?? "D:\\.pnpm-store";
    const tsc = path.join(workspace, "node_modules", "typescript", "bin", "tsc");
    try {
      install(` --offline "--store-dir=${storeDir}"`);
    } catch {
      install("");
    }
    // A workspace that could not get a toolchain cannot answer this question at all, so this stays a hard
    // failure rather than a skip: the test must not pass on a compiler it never reached.
    expect(fs.existsSync(tsc), `the isolated workspace must have a compiler to audit with (${tsc})`).toBe(true);

    const findings = await createRepoEngineeringOperations({ workspace }).audit(goal(workspace));
    const typecheck = findings.find((finding) => finding.id === "command:typecheck");
    expect(typecheck, "a real type error must be reported as a code finding").toBeDefined();
    expect(isEnvironmentFinding(typecheck!)).toBe(false);
    expect(typecheck!.kind).toBe("code");
    expect(typecheck!.area).toBe("build");
    // The diagnostic names the offending file, which is what makes the finding scoped at all.
    expect(`${typecheck!.description}${typecheck!.evidence ?? ""}`).toContain("broken.ts");
    // No environment finding, because the toolchain ran.
    expect(findings.filter(isEnvironmentFinding)).toEqual([]);
  }, 900_000);

  it("distinguishes the two kinds by what the runner reports", async () => {
    // The audit classification keys off the runner's own signal, so the two cannot drift apart.
    const { runAllowedCommand } = await import("../../electron/engineering/command-runner");
    const workspace = bareWorkspace();
    const neverRan = await runAllowedCommand(workspace, "typecheck", [], {});
    expect(neverRan.passed).toBe(false);
    expect(neverRan.exitCode).toBeNull();
    expect(neverRan.output).toContain("Required local tool unavailable");
  });
});
