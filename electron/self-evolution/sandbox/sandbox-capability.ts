import os from "node:os";
import path from "node:path";

/**
 * Hard-execution sandbox capability contract (Update-Plan/Alien-Prestart.md §9).
 *
 * The plan is explicit that a sandbox must be enforced by a real host
 * mechanism, never by a prompt or a JavaScript convention, and that "we
 * restricted the command string" is not a substitute. This module therefore
 * describes *what the operating system is doing*, in data, so acceptance
 * evidence can be machine-derived instead of asserted in prose.
 */

/** How the operating system actually confines a Candidate subprocess. */
export type SandboxMechanism =
  /** Windows AppContainer (lowbox) token + Job Object. */
  | "windows-appcontainer"
  /** No usable hard sandbox is present on this host. */
  | "unavailable";

/** One filesystem grant handed to the sandbox identity. */
export interface SandboxGrant {
  /** Absolute host path. */
  path: string;
  /**
   * `write` — content read+write (the Candidate workspace and its temp);
   * `read`  — content read + execute (a read-only toolchain);
   * `traverse` — metadata only (stat/traverse a path component).
   */
  access: "read" | "write" | "traverse";
}

/** The result of asking the host whether it can confine a process. */
export interface SandboxCapability {
  available: boolean;
  mechanism: SandboxMechanism;
  platform: NodeJS.Platform;
  /** Human-readable reasons, populated when `available` is false. */
  reasons: string[];
  /** Facts the acceptance evidence records verbatim. */
  details: {
    /** Identity/container name the OS sandbox is bound to. */
    containerName?: string;
    /** The AppContainer SID the OS derived for that name. */
    containerSid?: string;
    /** Whether a Job Object will own the process tree. */
    jobObject: boolean;
    /** Whether the process is created suspended and only resumed inside the job. */
    suspendedStart: boolean;
    /** Whether the sandbox can forbid the child from creating any process. */
    childProcessBlocked: boolean;
    /** Whether a caller-supplied environment block is honoured. */
    sanitizedEnvironment: boolean;
    /** Whether network access is denied by the mechanism. */
    networkDenied: boolean;
    /** Compiler used to build the launcher, when one is needed. */
    launcher?: string;
    /** Free-form extra facts (compiler version, probe timings). */
    [key: string]: unknown;
  };
}

/**
 * What the in-process attack surface looks like after the mechanism is applied.
 * Emitted into `S5-hard-sandbox.json` so a reviewer can see the boundary without
 * reading this file.
 */
export interface SandboxBoundaryDescription {
  mechanism: SandboxMechanism;
  enforcement: "operating-system";
  token: string;
  reads: string[];
  writes: string[];
  denied: string[];
  childProcesses: string;
  network: string;
  environment: string;
}

/** Deterministic container name for one evolution run. */
export function sandboxContainerName(runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 48);
  return `CodexBossEvolution-${safe || "run"}`;
}

/**
 * The host-owned directory that holds the compiled launcher. It must live
 * outside every Candidate workspace and outside the Stable working tree, so a
 * Candidate can never replace the launcher that confines it.
 */
export function defaultSandboxLauncherRoot(): string {
  const base = process.env.CODEX_BOSS_SANDBOX_HOME?.trim();
  if (base) return path.resolve(base);
  const localAppData = process.env.LOCALAPPDATA?.trim();
  const root = localAppData && localAppData.length > 0 ? localAppData : os.homedir();
  return path.join(root, "CodexBossSandbox");
}
