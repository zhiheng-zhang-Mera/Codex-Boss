import path from "node:path";
import type { SandboxBoundaryDescription, SandboxCapability, SandboxGrant } from "./sandbox-capability";

/**
 * The sandbox seam used by the Autonomous Evolution trust domain
 * (Update-Plan/Alien-Prestart.md §9, §10, §19).
 *
 * Every Candidate-controlled execution — vitest, tsc, a generated test, a
 * generated script, a runtime smoke — must be expressed as a
 * `SandboxedProcessRequest` and handed to an `EvolutionSandbox`. Production code
 * must never call `child_process` directly for Candidate work; the only
 * sanctioned route is `runAllowedCommand` with a `sandbox` attached, and the
 * coordinator always attaches one.
 */

export interface SandboxedProcessRequest {
  /** Absolute path of the executable. Resolved by the host, never by a model. */
  executable: string;
  args: readonly string[];
  /** Working directory inside the granted tree. */
  cwd: string;
  /** The complete child environment. Nothing else is inherited. */
  environment: NodeJS.ProcessEnv;
  /** Filesystem grants. Anything not granted is unreadable and unwritable. */
  grants: readonly SandboxGrant[];
  /** Wall-clock ceiling; the whole job is terminated on expiry. */
  timeoutMs?: number;
  /**
   * Maximum number of processes the job may hold at once. `1` means the child
   * may not create any process at all (the strict execution profile).
   */
  activeProcessLimit?: number;
  memoryLimitMb?: number;
  /** Host paths for captured output; the sandbox writes them. */
  stdoutFile: string;
  stderrFile: string;
  /** Container identity; defaults to a per-run container name. */
  containerName: string;
  /** Directory for the launcher's own request/report files. */
  controlDirectory: string;
}

/** The launcher's structured report, parsed by the host. */
export interface SandboxProcessReport {
  launcher: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  container: string | null;
  containerSid: string | null;
  processId: number;
  exitCode: number;
  activeProcessLimit: number;
  jobObject: boolean;
  suspendedStart: boolean;
  timedOut: boolean;
  ok: boolean;
  failure: string | null;
  win32Error: number;
  grants: string[];
}

export interface SandboxedProcessResult {
  /** True only when the operating-system sandbox actually confined the child. */
  sandboxed: boolean;
  mechanism: SandboxCapability["mechanism"];
  exitCode: number | null;
  timedOut: boolean;
  /** The launcher could not establish the sandbox at all. */
  refused: boolean;
  failure?: string;
  report?: SandboxProcessReport;
  /** Raw captured streams, read back by the host. */
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface SandboxRunOptions {
  /** Test/acceptance seam: run with no process-creation ceiling. */
  allowHelperProcesses?: boolean;
}

export interface EvolutionSandbox {
  probe(): Promise<SandboxCapability>;
  run(request: SandboxedProcessRequest, options?: SandboxRunOptions): Promise<SandboxedProcessResult>;
  describe(): SandboxBoundaryDescription;
}

/**
 * A request that the sandbox must refuse outright, before the OS is involved.
 * Raised by the host policy layer, not by the launcher.
 */
export class SandboxPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxPolicyError";
  }
}

/** Normalized, comparable form of a filesystem path. */
export function normalizeSandboxPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Ancestor directories that a granted path needs in order to be reachable.
 * The Windows loader performs an `lstat` walk up to the volume root when it
 * resolves a module, so each component must at least be stat-able. The walk
 * stops *below* the volume root, which is the one component a standard user
 * cannot modify; the caller is expected to have relocated the tree onto a
 * subst drive when it needs that last component.
 */
export function ancestorDirectories(target: string, stopAt?: string): string[] {
  const result: string[] = [];
  const stop = stopAt ? path.resolve(stopAt) : path.parse(path.resolve(target)).root;
  let current = path.resolve(target);
  while (true) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (parent.length <= stop.length) break;
    result.push(parent);
    current = parent;
  }
  return result;
}
