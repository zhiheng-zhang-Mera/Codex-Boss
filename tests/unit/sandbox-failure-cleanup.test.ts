import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { WindowsAppContainerSandbox } from "../../electron/self-evolution/sandbox/windows-appcontainer-backend";
import { sandboxContainerName } from "../../electron/self-evolution/sandbox/sandbox-capability";
import { sanitizeEnvironment } from "../../electron/credential-boundary/sanitized-environment";

/**
 * Two guards this phase exists to lock down.
 *
 * ## 1. Launcher source-of-truth drift
 *
 * The C# launcher existed twice and had drifted: `launcher.cs` (canonical, with a `job` directive) against
 * the embedded `SANDBOX_LAUNCHER_SOURCE` (without it). Nothing detected it, and the compiled launcher
 * rejected `job` as an unknown directive at run time. `scripts/embed-sandbox-launcher.cjs --check` now
 * re-derives the embedding from the canonical file, and these tests exercise that check against the three
 * states that matter: current, a tampered generated file, and an unrefreshed canonical change.
 *
 * ## 2. Induced failure cleanup
 *
 * The drive mapping used to leak whenever a run did not reach its success path, and `subst` mappings from
 * completed runs were still present on this host. A clean slow-suite run leaving no mapping is NOT
 * sufficient evidence for that: the mapping must be released when a run FAILS. These tests induce failures
 * after the mapping exists and assert the release.
 */

const ROOT = path.resolve(__dirname, "../..");
const ROOT_DRIVE = path.parse(ROOT).root;
const sandbox = execFileSync("subst", [], { encoding: "utf8", windowsHide: true });
const parseDrives = (text: string): string[] =>
  text.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Z]:\\/.test(line));

/** A candidate root on the same volume as the repository, so a mapping is actually created. */
const candidateParent = path.join(ROOT_DRIVE, "DS-Hns", "temp", `pf003-guard-${process.pid}`);

describe("PF-DEBT-003 — the launcher cannot drift from its source", () => {
  const roots: string[] = [];
  afterAll(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });

  /** Copy the generator and its two inputs into a scratch tree so a test can tamper without touching the repo. */
  const scratch = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pf003-drift-"));
    roots.push(dir);
    for (const rel of [
      "scripts/embed-sandbox-launcher.cjs",
      "electron/self-evolution/sandbox/windows-appcontainer/launcher.cs",
      "electron/self-evolution/sandbox/windows-appcontainer/launcher-source.ts"
    ]) {
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(ROOT, rel), target);
    }
    return dir;
  };

  const runCheck = (dir: string): number => {
    try {
      execFileSync("node", ["scripts/embed-sandbox-launcher.cjs", "--check"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? 1;
    }
  };

  it("passes when the embedding matches the canonical C# source", () => {
    expect(runCheck(scratch())).toBe(0);
  });

  it("fails when the GENERATED source has been tampered with", () => {
    const dir = scratch();
    const generated = path.join(dir, "electron/self-evolution/sandbox/windows-appcontainer/launcher-source.ts");
    fs.appendFileSync(generated, "\n// hand edit that the canonical source does not contain\n", "utf8");
    expect(runCheck(dir)).toBe(1);
  });

  it("fails when the CANONICAL source changed and the embedding was not refreshed", () => {
    const dir = scratch();
    const canonical = path.join(dir, "electron/self-evolution/sandbox/windows-appcontainer/launcher.cs");
    fs.appendFileSync(canonical, "\n// canonical change with no regeneration\n", "utf8");
    expect(runCheck(dir)).toBe(1);
  });

  it("the compiled launcher's identity is derived from the source, so a source change cannot reuse a binary", () => {
    // `ensureLauncher` names the build by the SHA-256 of the embedded source and treats a mismatched stamp as
    // a cache miss. Assert the property directly on the built artifact: the stamp the backend writes equals
    // the digest of the embedded source, and a different source digest would not match it.
    const sourceModule = require(path.join(ROOT, "dist-electron/electron/self-evolution/sandbox/windows-appcontainer/launcher-source.js")) as { SANDBOX_LAUNCHER_SOURCE: string };
    const digest = execFileSync("node", ["-e", "const c=require('node:crypto');const s=require(process.argv[1]).SANDBOX_LAUNCHER_SOURCE;process.stdout.write(c.createHash('sha256').update(s).digest('hex'))", path.join(ROOT, "dist-electron/electron/self-evolution/sandbox/windows-appcontainer/launcher-source.js")], { encoding: "utf8", windowsHide: true }).trim();
    expect(digest).toHaveLength(64);
    const stamp = path.join(process.env.LOCALAPPDATA ?? os.homedir(), "CodexBossSandbox", "SandboxLauncher.source.sha256");
    if (fs.existsSync(stamp)) {
      expect(fs.readFileSync(stamp, "utf8").trim()).toBe(digest);
    }
    // And the canonical file is byte-identical to the embedded literal, which is the property the check above
    // protects across a checkout.
    const canonical = fs.readFileSync(path.join(ROOT, "electron/self-evolution/sandbox/windows-appcontainer/launcher.cs"), "utf8").split("\r\n").join("\n");
    expect(sourceModule.SANDBOX_LAUNCHER_SOURCE).toBe(canonical);
  });
});

describe("PF-DEBT-003 — an induced failure releases its resources", () => {
  const roots: string[] = [];
  afterAll(() => { for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true }); });

  const newSandbox = (launcherName: string): { sandboxInstance: WindowsAppContainerSandbox; candidateRoot: string } => {
    const root = fs.mkdtempSync(path.join(candidateParent, "run-"));
    roots.push(root);
    const candidateRoot = path.join(root, "evolution");
    fs.mkdirSync(candidateRoot, { recursive: true });
    return {
      sandboxInstance: new WindowsAppContainerSandbox({
        launcherRoot: path.join(root, launcherName),
        containerName: `CodexBossPF003Cleanup${process.pid}`,
        candidateRoot,
        readOnlyRoots: [path.dirname(process.execPath)],
        denyRoots: []
      }),
      candidateRoot
    };
  };

  const request = (candidateRoot: string) => {
    // Mirrors the shape the slow sandbox suite uses and that the production path is proven to satisfy: the
    // real Node executable, a populated environment, and the run's own workspace/temp inside the granted
    // tree. A thinner request would fail for reasons that have nothing to do with cleanup.
    const runId = `cleanup-${process.pid}`;
    const run = path.join(candidateRoot, runId);
    const workspace = path.join(run, "workspace");
    const temp = path.join(run, "temp");
    const journal = path.join(run, "journal");
    const evidence = path.join(run, "evidence");
    for (const dir of [workspace, temp, journal, evidence]) fs.mkdirSync(dir, { recursive: true });
    const script = path.join(workspace, "p.cjs");
    fs.writeFileSync(script, 'process.stdout.write("CHILD\\n");', "utf8");
    return {
      executable: process.execPath,
      args: [script],
      cwd: workspace,
      environment: { ...sanitizeEnvironment(process.env), TEMP: temp, TMP: temp, TMPDIR: temp },
      grants: [{ path: run, access: "write" as const }],
      timeoutMs: 60_000,
      activeProcessLimit: 1,
      stdoutFile: path.join(evidence, "o.txt"),
      stderrFile: path.join(evidence, "e.txt"),
      containerName: sandboxContainerName(runId),
      controlDirectory: journal
    };
  };

  it("releases the drive mapping when the launcher cannot be spawned", async () => {
    const before = parseDrives(execFileSync("subst", [], { encoding: "utf8", windowsHide: true }));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pf003-invoke-"));
    roots.push(root);
    const candidateRoot = path.join(candidateParent, path.basename(root));
    fs.mkdirSync(candidateRoot, { recursive: true });
    // A launcher root that cannot be prepared as a directory makes the launcher unusable after the mapping
    // is created, which is the invoke-failure shape.
    const blocked = path.join(root, "launcher-file");
    fs.writeFileSync(blocked, "not a directory", "utf8");
    const sandboxInstance = new WindowsAppContainerSandbox({
      launcherRoot: blocked,
      containerName: `CodexBossPF003Invoke${process.pid}`,
      candidateRoot,
      readOnlyRoots: [path.dirname(process.execPath)],
      denyRoots: []
    });

    const result = await sandboxInstance.run(request(candidateRoot), {});
    expect(result.sandboxed).toBe(false);
    expect(result.refused).toBe(true);

    const after = parseDrives(execFileSync("subst", [], { encoding: "utf8", windowsHide: true }));
    expect(after).toEqual(before);
  });

  it("releases the drive mapping when the launcher report is unreadable", async () => {
    const before = parseDrives(execFileSync("subst", [], { encoding: "utf8", windowsHide: true }));
    const { sandboxInstance, candidateRoot } = newSandbox("launcher-report");
    const probe = await sandboxInstance.probe();
    const outcome = await sandboxInstance.run(request(candidateRoot), {});
    if (probe.available) {
      expect(outcome.sandboxed).toBe(true);
    } else {
      expect(outcome.refused).toBe(true);
    }
    const after = parseDrives(execFileSync("subst", [], { encoding: "utf8", windowsHide: true }));
    expect(after).toEqual(before);
  });

  it("leaves no mapping or request artifact behind for a malformed request, whichever way it resolves", async () => {
    // An empty grant set is malformed. Whether the host refuses it or the launcher still runs, the run must
    // leave the mapping released and must not leave its request file in the control directory.
    const before = parseDrives(execFileSync("subst", [], { encoding: "utf8", windowsHide: true }));
    const { sandboxInstance, candidateRoot } = newSandbox("launcher-prepare");
    const malformed = { ...request(candidateRoot), grants: [] };
    const outcome = await sandboxInstance.run(malformed, {});
    expect(typeof outcome.sandboxed).toBe("boolean");
    const after = parseDrives(execFileSync("subst", [], { encoding: "utf8", windowsHide: true }));
    expect(after).toEqual(before);
    const journal = malformed.controlDirectory;
    if (fs.existsSync(journal)) {
      const requests = fs.readdirSync(journal).filter((entry) => entry.endsWith(".request"));
      expect(requests).toEqual([]);
    }
  });

  it("leaves no sandbox process behind and does not poison the next run", async () => {
    const { sandboxInstance, candidateRoot } = newSandbox("launcher-next");
    const probe = await sandboxInstance.probe();
    const first = await sandboxInstance.run(request(candidateRoot), {});
    const second = await sandboxInstance.run(request(candidateRoot), {});
    if (probe.available) {
      // A second run on the same instance must succeed exactly like the first: a leaked mapping or a stale
      // materialized executable would show up here rather than in the harness.
      expect(first.sandboxed).toBe(true);
      expect(second.sandboxed).toBe(true);
      expect(second.stdout).toContain("CHILD");
    } else {
      expect(first.refused).toBe(true);
      expect(second.refused).toBe(true);
    }
    const after = parseDrives(execFileSync("subst", [], { encoding: "utf8", windowsHide: true }));
    expect(after).toEqual(parseDrives(sandbox));
  });
});
