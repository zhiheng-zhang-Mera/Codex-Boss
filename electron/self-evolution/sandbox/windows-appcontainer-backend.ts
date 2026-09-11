import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultSandboxLauncherRoot,
  sandboxContainerName,
  type SandboxBoundaryDescription,
  type SandboxCapability,
  type SandboxGrant
} from "./sandbox-capability";
import {
  ancestorDirectories,
  normalizeSandboxPath,
  type EvolutionSandbox,
  type SandboxProcessReport,
  type SandboxRunOptions,
  type SandboxedProcessRequest,
  type SandboxedProcessResult
} from "./sandbox-backend";
import { SANDBOX_LAUNCHER_SOURCE } from "./windows-appcontainer/launcher-source";
import { ensureDriveMapping, removeDriveMapping, toSandboxPath, type DriveMapping } from "./sandbox-drive";

/**
 * Windows hard-execution sandbox (Update-Plan/Alien-Prestart.md 鎼?).
 *
 * Mechanism 閳?every part of it is the operating system, none of it is a
 * convention this codebase could talk itself out of:
 *
 *   1. **AppContainer lowbox token.** The child runs under an AppContainer SID
 *      with *no capabilities*. Windows derives that SID from a container name,
 *      applies it as the only non-deny-only identity in the token, and then
 *      performs normal DACL checks against it. Nothing on the machine grants
 *      that SID anything, so the child can touch exactly the paths the host
 *      explicitly ACLs. Because the AppContainer has no `internetClient` or
 *      `privateNetworkClientServer` capability, outbound network access is
 *      denied by the OS, not by filtering.
 *   2. **Job Object.** The child is created `CREATE_SUSPENDED`, assigned to a
 *      job with `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` and memory ceilings, and only
 *      then resumed 閳?so no process can exist outside the job, not even for an
 *      instant. `KILL_ON_JOB_CLOSE` means the whole tree dies with the run.
 *   3. **Process-creation ceiling.** `ActiveProcessLimit = 1` makes the child
 *      the only process the job will ever hold: `CreateProcess` on behalf of a
 *      Candidate fails at the kernel. That is what defeats SB-04/SB-05
 *      (`execFile("powershell", 閳?`, arbitrary executables) without relying on
 *      an executable name list.
 *   4. **Explicit environment.** The child inherits nothing. The launcher wipes
 *      its own environment and installs exactly the host-supplied block, so an
 *      ambient Owner credential is not merely filtered 閳?it is absent.
 *
 * Everything the child could still do (read a granted toolchain, write its own
 * workspace) is inside the Candidate trust domain by construction.
 */

const CANDIDATE_CLASSIFICATION = "CodexBossEvolutionSandbox";
const LAUNCHER_EXE = "SandboxLauncher.exe";
const LAUNCHER_SOURCE_FILE = "SandboxLauncher.cs";

/** Candidate locations for the .NET Framework compiler that ships with Windows. */
function cscCandidates(): string[] {
  const windir = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return [
    path.join(windir, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(windir, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")
  ];
}

export function findCSharpCompiler(): string | undefined {
  return cscCandidates().find((candidate) => fs.existsSync(candidate));
}

export interface WindowsAppContainerSandboxOptions {
  /** Host-owned directory for the compiled launcher. Never inside a Candidate. */
  launcherRoot?: string;
  /** Deterministic container name; defaults to the per-run name. */
  containerName?: string;
  /** Wall-clock ceiling applied when a request does not carry one. */
  defaultTimeoutMs?: number;
  /**
   * Roots that must never receive a grant 閳?Stable, the Owner home, credential
   * stores. A request that tries to grant one is refused before the OS is asked.
   */
  denyRoots?: readonly string[];
  /**
   * Root of the Candidate trust domain. When set, the backend maps it onto a
   * dedicated drive letter so the AppContainer can stat every path component
   * (see `sandbox-drive.ts`) and grants `write` on the run directory only.
   */
  candidateRoot?: string;
  /**
   * Read-only roots placed on the same drive mapping as the candidate, so a
   * sanitized copy of the toolchain is reachable without widening the volume.
   */
  readOnlyRoots?: readonly string[];
}

interface LauncherBuild {
  executable: string;
  sourceHash: string;
  compiler: string;
}

function readReport(file: string): SandboxProcessReport | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as SandboxProcessReport;
  } catch {
    return undefined;
  }
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * The Windows implementation of `EvolutionSandbox`. It compiles the launcher
 * from the embedded host-owned source, then drives it with a request file 閳?the
 * launcher never parses a Candidate-supplied command line.
 */
export class WindowsAppContainerSandbox implements EvolutionSandbox {
  private readonly launcherRoot: string;
  private readonly containerName: string;
  private readonly defaultTimeoutMs: number;
  private readonly denyRoots: string[];
  private readonly candidateRoot?: string;
  private readonly readOnlyRoots: string[];
  private build?: LauncherBuild;
  private capability?: SandboxCapability;
  private mapping?: DriveMapping;

  constructor(options: WindowsAppContainerSandboxOptions = {}) {
    this.launcherRoot = path.resolve(options.launcherRoot ?? defaultSandboxLauncherRoot());
    this.containerName = options.containerName ?? sandboxContainerName("default");
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15 * 60 * 1000;
    this.denyRoots = (options.denyRoots ?? []).map(normalizeSandboxPath);
    this.candidateRoot = options.candidateRoot ? path.resolve(options.candidateRoot) : undefined;
    this.readOnlyRoots = (options.readOnlyRoots ?? []).map((root) => path.resolve(root));
  }

  /** The sandbox-visible alias of the Candidate root, once a mapping exists. */
  sandboxVisibleRoot(): string | undefined {
    return this.mapping ? this.mapping.driveRoot : undefined;
  }

  /** Removes a drive mapping this backend created. Safe to call repeatedly. */
  release(): void {
    if (this.mapping) removeDriveMapping(this.mapping);
    this.mapping = undefined;
  }

  describe(): SandboxBoundaryDescription {
    return {
      mechanism: "windows-appcontainer",
      enforcement: "operating-system",
      token: `AppContainer lowbox token for ${this.containerName} (no capabilities) + Job Object with ActiveProcessLimit`,
      reads: [
        "Candidate workspace (explicit ACL grant)",
        "read-only toolchain roots (explicit ACL grant)",
        "Windows system runtime files (ALL APPLICATION PACKAGES)"
      ],
      writes: [
        "Candidate workspace", "Candidate runtime-data", "Candidate temp", "Candidate evidence staging"
      ],
      denied: [
        "Stable repository", "Stable runtime-data", "Owner home secret fixtures", "credential stores",
        "SSH keys", "Owner browser profile", "Root private material", "any path without an explicit grant"
      ],
      childProcesses:
        "denied by the kernel: the Job Object holds exactly one process, so CreateProcess from a Candidate fails even for a system executable",
      network: "denied: the AppContainer carries no network capability, so name resolution and sockets fail at the OS boundary",
      environment: "explicit host-supplied block only; the launcher wipes its own environment before creating the child"
    };
  }

  async probe(): Promise<SandboxCapability> {
    if (this.capability) return this.capability;
    const reasons: string[] = [];
    let compiler: string | undefined;
    let build: LauncherBuild | undefined;
    let sid: string | undefined;
    let jobObject = false;

    if (process.platform !== "win32") reasons.push(`hard sandbox is implemented for win32, this host is ${process.platform}`);

    if (!reasons.length) {
      compiler = findCSharpCompiler();
      if (!compiler) reasons.push("no .NET Framework C# compiler (csc.exe) is present, so the launcher cannot be built");
    }

    if (!reasons.length) {
      try {
        build = this.ensureLauncher(compiler!);
      } catch (error) {
        reasons.push(`launcher build failed: ${String((error as Error).message).slice(0, 300)}`);
      }
    }

    if (build) {
      const probe = this.runLauncherProbe(build.executable);
      sid = probe.sid;
      jobObject = probe.jobObject;
      if (!probe.ok) reasons.push(`AppContainer probe failed: ${probe.failure ?? "unknown"}`);
    }

    this.capability = {
      available: reasons.length === 0,
      mechanism: reasons.length === 0 ? "windows-appcontainer" : "unavailable",
      platform: process.platform,
      reasons,
      details: {
        containerName: this.containerName,
        containerSid: sid,
        jobObject,
        suspendedStart: true,
        childProcessBlocked: true,
        sanitizedEnvironment: true,
        networkDenied: true,
        launcher: build?.executable,
        compiler,
        sourceHash: build?.sourceHash
      }
    };
    return this.capability;
  }

  async run(request: SandboxedProcessRequest, options: SandboxRunOptions = {}): Promise<SandboxedProcessResult> {
    const started = Date.now();
    const capability = await this.probe();
    if (!capability.available || !this.build) {
      return {
        sandboxed: false,
        mechanism: "unavailable",
        exitCode: null,
        timedOut: false,
        refused: true,
        failure: `hard sandbox unavailable: ${capability.reasons.join("; ")}`,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started
      };
    }

    let prepared: { request: SandboxedProcessRequest; grants: SandboxGrant[] };
    try {
      prepared = this.prepare(request, options);
    } catch (error) {
      return {
        sandboxed: false,
        mechanism: "unavailable",
        exitCode: null,
        timedOut: false,
        refused: true,
        failure: String((error as Error).message).slice(0, 500),
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started
      };
    }
    const { grants } = prepared;
    const controlDirectory = request.controlDirectory;
    fs.mkdirSync(controlDirectory, { recursive: true });
    const stem = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
    const requestFile = path.join(controlDirectory, `${stem}.request`);
    const reportFile = path.join(controlDirectory, `${stem}.report.json`);

    const activeProcessLimit = options.allowHelperProcesses ? request.activeProcessLimit ?? 16 : request.activeProcessLimit ?? 1;
    fs.writeFileSync(requestFile, this.renderRequest(prepared.request, grants, reportFile, activeProcessLimit), "utf8");
    const launch = await new Promise<{ code: number | null; error?: string }>((resolve) => {
      const child = spawn(this.build!.executable, [requestFile], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows", PATH: process.env.PATH ?? "" }
      });
      let stderr = "";
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => resolve({ code: null, error: String(error.message) }));
      child.on("close", (code) => resolve({ code, error: stderr.trim() || undefined }));
    });

    const report = readReport(reportFile);
    const timedOut = report?.timedOut === true;
    const sandboxed = report?.ok === true && report.containerSid !== null;
    const result: SandboxedProcessResult = {
      sandboxed,
      mechanism: sandboxed ? "windows-appcontainer" : "unavailable",
      exitCode: report ? report.exitCode : null,
      timedOut,
      refused: !report,
      failure: report?.failure ?? launch.error,
      report,
      stdout: readText(request.stdoutFile),
      stderr: readText(request.stderrFile),
      durationMs: Date.now() - started
    };
    try {
      fs.rmSync(requestFile, { force: true });
    } catch {
      // A leftover request file is inert; never fail a sandboxed run over it.
    }
    return result;
  }

  /**
   * Refuses any grant that would hand the AppContainer identity something
   * outside the Candidate trust domain, then derives the full grant set:
   * metadata-only traversal for every ancestor the loader will stat, the
   * Candidate run directory read/write, and the declared read-only roots.
   *
   * Called before the OS is asked, so a misconfigured coordinator cannot widen
   * the boundary at run time.
   */
  private prepare(
    request: SandboxedProcessRequest,
    options: SandboxRunOptions
  ): { request: SandboxedProcessRequest; grants: SandboxGrant[] } {
    for (const grant of request.grants) {
      const normalized = normalizeSandboxPath(grant.path);
      for (const denied of this.denyRoots) {
        if (normalized === denied || normalized.startsWith(`${denied}${path.sep}`)) {
          throw new Error(`sandbox refuses to grant ${grant.access} on ${grant.path}: it is inside a denied root (${denied})`);
        }
      }
    }

    // A drive alias removes the one path component a standard user cannot ACL.
    if (this.candidateRoot && !this.mapping) {
      this.mapping = ensureDriveMapping(this.candidateRoot);
    }
    const mapping = this.mapping;

    const explicit = request.grants.filter((grant) => grant.access !== "traverse");
    const grants: SandboxGrant[] = [];
    const seen = new Set<string>();
    const add = (grant: SandboxGrant): void => {
      const key = `${grant.access}:${normalizeSandboxPath(grant.path)}`;
      if (seen.has(key)) return;
      seen.add(key);
      grants.push(grant);
    };

    // Ancestors inside the mapped Candidate tree are granted metadata-only
    // traversal: the loader's `lstat` walk stops at the drive root, which is
    // the mapping itself. Paths outside the mapping are deliberately NOT
    // walked — traversing them would mean writing ACLs on unrelated
    // directories, which is both slow and an unnecessary widening.
    if (mapping) {
      const mappingRoot = normalizeSandboxPath(mapping.hostRoot);
      for (const grant of explicit) {
        if (!normalizeSandboxPath(grant.path).startsWith(mappingRoot)) continue;
        for (const ancestor of ancestorDirectories(grant.path, mapping.hostRoot)) add({ path: ancestor, access: "traverse" });
      }
      add({ path: mapping.hostRoot, access: "traverse" });
    }

    for (const grant of explicit) add(grant);
    for (const root of this.readOnlyRoots) {
      if (fs.existsSync(root)) add({ path: root, access: "read" });
    }

    const translate = mapping ? (value: string) => toSandboxPath(mapping, value) : (value: string) => value;
    return {
      grants,
      request: {
        ...request,
        cwd: translate(request.cwd),
        executable: translate(request.executable),
        args: request.args.map(translate),
        grants
      }
    };
  }

  private renderRequest(
    request: SandboxedProcessRequest,
    grants: SandboxedProcessRequest["grants"],
    reportFile: string,
    activeProcessLimit: number
  ): string {
    const lines: string[] = [
      `container ${request.containerName || this.containerName}`,
      `cwd ${request.cwd}`,
      `exe ${request.executable}`,
      ...request.args.map((argument) => `arg ${argument}`),
      ...grants.map((grant) => `grant ${grant.access} ${grant.path}`),
      `timeoutMs ${request.timeoutMs ?? this.defaultTimeoutMs}`,
      `activeProcessLimit ${activeProcessLimit}`,
      `memoryLimitMb ${request.memoryLimitMb ?? 0}`,
      `stdout ${request.stdoutFile}`,
      `stderr ${request.stderrFile}`,
      `report ${reportFile}`
    ];
    for (const [name, value] of Object.entries(request.environment)) {
      if (value === undefined) continue;
      const line = `env ${name}=${value}`;
      if (line.includes("\n")) continue;
      lines.push(line);
    }
    return `${lines.join("\n")}\n`;
  }

  private ensureLauncher(compiler: string): LauncherBuild {
    const sourceHash = crypto.createHash("sha256").update(SANDBOX_LAUNCHER_SOURCE).digest("hex");
    if (this.build && this.build.sourceHash === sourceHash && fs.existsSync(this.build.executable)) return this.build;

    fs.mkdirSync(this.launcherRoot, { recursive: true });
    const executable = path.join(this.launcherRoot, LAUNCHER_EXE);
    const sourceFile = path.join(this.launcherRoot, LAUNCHER_SOURCE_FILE);
    const stampFile = path.join(this.launcherRoot, "SandboxLauncher.source.sha256");

    const upToDate =
      fs.existsSync(executable) &&
      fs.existsSync(stampFile) &&
      fs.readFileSync(stampFile, "utf8").trim() === sourceHash &&
      fs.existsSync(sourceFile) &&
      fs.readFileSync(sourceFile, "utf8") === SANDBOX_LAUNCHER_SOURCE;
    if (!upToDate) {
      fs.writeFileSync(sourceFile, SANDBOX_LAUNCHER_SOURCE, "utf8");
      const output = path.join(this.launcherRoot, `${LAUNCHER_EXE}.${process.pid}.tmp`);
      fs.rmSync(output, { force: true });
      try {
        execFileSync(compiler, ["/nologo", "/target:exe", `/out:${output}`, "/platform:x64", sourceFile], {
          timeout: 120_000,
          windowsHide: true
        });
      } catch (error) {
        fs.rmSync(output, { force: true });
        throw new Error(`csc failed: ${String((error as Error).message).slice(0, 400)}`);
      }
      // The packaged executable may be mapped by a concurrent probe; retry the swap.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          fs.renameSync(output, executable);
          break;
        } catch (error) {
          if (attempt === 4) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
        }
      }
      fs.writeFileSync(stampFile, sourceHash, "utf8");
    }

    this.build = { executable, sourceHash, compiler };
    return this.build;
  }

  private runLauncherProbe(executable: string): { ok: boolean; sid?: string; jobObject: boolean; failure?: string } {
    const directory = path.join(this.launcherRoot, "probe");
    fs.mkdirSync(directory, { recursive: true });
    const requestFile = path.join(directory, "probe.request");
    const reportFile = path.join(directory, "probe.report.json");
    fs.rmSync(reportFile, { force: true });
    fs.writeFileSync(requestFile, `probe\ncontainer ${this.containerName}\nreport ${reportFile}\n`, "utf8");
    try {
      execFileSync(executable, [requestFile], { timeout: 60_000, windowsHide: true, stdio: "ignore" });
    } catch (error) {
      return { ok: false, jobObject: false, failure: String((error as Error).message).slice(0, 300) };
    }
    const report = readReport(reportFile) as (SandboxProcessReport & { probe?: { appContainer: boolean; appContainerSid: string; jobObject: boolean } }) | undefined;
    if (!report?.ok || !report.probe) return { ok: false, jobObject: false, failure: report?.failure ?? "probe report missing" };
    return { ok: report.probe.appContainer === true, sid: report.probe.appContainerSid, jobObject: report.probe.jobObject === true };
  }
}

/** True when this host's OS is one the sandbox can confine. */
export function supportsHardSandbox(): boolean {
  return process.platform === "win32";
}

export { os, ancestorDirectories, CANDIDATE_CLASSIFICATION };
export { toSandboxPath, toHostPath, ensureDriveMapping, removeDriveMapping } from "./sandbox-drive";
