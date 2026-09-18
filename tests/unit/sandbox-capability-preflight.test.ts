import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { WindowsAppContainerSandbox } from "../../electron/self-evolution/sandbox/windows-appcontainer-backend";

/**
 * PF-DEBT-003 — `probe().available` must mean the production sandbox path is reachable.
 *
 * It used to mean only "the AppContainer API works", so a host that could not actually run a sandboxed
 * process — no candidate root to materialize a readable executable into, an unwritable cache — still
 * reported itself ready, and the failure surfaced later as an unattributable `sandboxed: false`.
 *
 * Two properties are asserted here, and the second matters as much as the first:
 *
 *  - a host that CAN reach the path reports `available: true` with `reasons: []`;
 *  - a host that cannot reports `available: false` with a STABLE CODE, not an exception string.
 *
 * The preflight is deliberately lightweight: it inspects the environment and performs the real
 * materialization of one executable. It never runs a Candidate workload, which is why a workload-specific
 * runtime failure can never be misreported as an unavailable capability.
 */

const launcherRootBase = path.join(os.tmpdir(), `pf003-preflight-${process.pid}`);

describe("PF-DEBT-003 — capability preflight refuses with stable codes", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(launcherRootBase, { recursive: true, force: true });
  });

  const make = (options: { candidateRoot?: string; executable?: string; name: string }): WindowsAppContainerSandbox => {
    fs.mkdirSync(launcherRootBase, { recursive: true });
    const root = fs.mkdtempSync(path.join(launcherRootBase, `${options.name}-`));
    roots.push(root);
    const instance = new WindowsAppContainerSandbox({
      launcherRoot: path.join(root, "launcher"),
      containerName: `CodexBossPF003Preflight${options.name}`,
      ...(options.candidateRoot ? { candidateRoot: options.candidateRoot } : {}),
      readOnlyRoots: [path.dirname(process.execPath)],
      denyRoots: []
    });
    if (options.executable) instance.setPreflightExecutable(options.executable);
    return instance;
  };

  it("reports available:true with NO reasons on a host that can reach the production path", async () => {
    const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pf003-pre-ok-"));
    roots.push(candidateRoot);
    const capability = await make({ candidateRoot, name: "ok" }).probe();

    // This is the environment the Owner runs: a normal non-elevated Windows 11 account whose toolchain lives
    // in a machine-owned directory. It must be ready, with nothing to report.
    expect(capability.available).toBe(true);
    expect(capability.reasons).toEqual([]);
    expect(capability.reasonCodes).toEqual([]);
    expect(capability.mechanism).toBe("windows-appcontainer");
    expect(capability.details.containerSid).toBeTruthy();
    expect(capability.details.jobObject).toBe(true);
  });

  it("refuses with CANDIDATE_ROOT_NOT_CONFIGURED when there is nowhere to materialize", async () => {
    const capability = await make({ name: "noroot" }).probe();
    expect(capability.available).toBe(false);
    expect(capability.mechanism).toBe("unavailable");
    expect(capability.reasonCodes.map((reason) => reason.code)).toContain("CANDIDATE_ROOT_NOT_CONFIGURED");
    // The human-readable list is populated from the same refusals, so the two cannot disagree.
    expect(capability.reasons.length).toBe(capability.reasonCodes.length);
    expect(capability.reasons[0]).toContain("CANDIDATE_ROOT_NOT_CONFIGURED");
  });

  it("refuses with EXECUTABLE_MISSING when the executable it would materialize is absent", async () => {
    const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pf003-pre-missing-"));
    roots.push(candidateRoot);
    const missing = path.join(candidateRoot, "definitely-not-here.exe");
    const capability = await make({ candidateRoot, executable: missing, name: "missing" }).probe();
    expect(capability.available).toBe(false);
    expect(capability.reasonCodes.map((reason) => reason.code)).toContain("EXECUTABLE_MISSING");
  });

  it("refuses with a materialization code when the candidate root cannot be written", async () => {
    // A candidate root whose parent is a FILE cannot be created, which is the unwritable-root shape.
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pf003-pre-blocked-"));
    roots.push(parent);
    const blocker = path.join(parent, "blocker");
    fs.writeFileSync(blocker, "not a directory", "utf8");
    const capability = await make({ candidateRoot: path.join(blocker, "evolution"), name: "blocked" }).probe();
    expect(capability.available).toBe(false);
    expect(capability.reasonCodes.map((reason) => reason.code)).toContain("CANDIDATE_ROOT_NOT_WRITABLE");
  });

  it("every refusal carries a non-empty code and detail, never a bare exception string", async () => {
    const capability = await make({ name: "shape" }).probe();
    expect(capability.reasonCodes.length).toBeGreaterThan(0);
    for (const reason of capability.reasonCodes) {
      expect(typeof reason.code).toBe("string");
      expect(reason.code.length).toBeGreaterThan(0);
      expect(reason.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(typeof reason.detail).toBe("string");
      expect(reason.detail.length).toBeGreaterThan(0);
    }
  });

  it("caches its verdict, so a probe is a one-time cost", async () => {
    const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pf003-pre-cache-"));
    roots.push(candidateRoot);
    const instance = make({ candidateRoot, name: "cache" });
    const first = await instance.probe();
    const second = await instance.probe();
    expect(second).toBe(first);
  });
});
