import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { HostProbes } from "./acceptance-catalog";

/**
 * Host-M P1 — real environment probes.
 *
 * These are the only "is this host able to run that check" decisions the hub
 * makes, and every one of them is reported: a probe that says "no" becomes an
 * explicit BLOCKED_EXTERNAL row with the missing prerequisite named, never a
 * silent skip and never a pass.
 *
 * Probing is deliberately cheap and side-effect free. The network probe uses a
 * short TLS connect to a fixed public host; it is allowed to fail, and failing
 * only means the network-dependent rows are reported blocked.
 */

export interface ProbeOptions {
  repoRoot: string;
  /** Overrides for tests/tools that already know the answers. */
  overrides?: Partial<Pick<HostProbes, "electronBinary" | "codexCli" | "network" | "buildOutput">>;
  networkHost?: string;
  networkTimeoutMs?: number;
}

export function electronBinaryPath(repoRoot: string): string {
  return path.join(repoRoot, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
}

/** The acceptance scripts load `dist-electron`; this is the file they need first. */
export function buildOutputPath(repoRoot: string): string {
  return path.join(repoRoot, "dist-electron", "electron", "store.js");
}

export function hasBuildOutput(repoRoot: string): boolean {
  return fs.existsSync(buildOutputPath(repoRoot));
}

export function hasElectronBinary(repoRoot: string): boolean {
  return fs.existsSync(electronBinaryPath(repoRoot));
}

/**
 * Looks for a Codex CLI the way the CLI runtimes do: an explicit environment
 * override, then PATH. Failure to find one is not an error — it is the reason
 * the CLI-lane rows are reported blocked.
 */
export function hasCodexCli(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.BOSS_CODEX_CLI && fs.existsSync(env.BOSS_CODEX_CLI)) return true;
  const names = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat", "codex"] : ["codex"];
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      try {
        if (fs.existsSync(path.join(dir, name))) return true;
      } catch {
        // unreadable PATH entry — keep looking
      }
    }
  }
  return false;
}

/**
 * A bounded TCP/TLS reachability probe. Never throws; a failure is simply
 * "no outbound network" for the purpose of the report.
 */
export async function probeNetwork(options: { host?: string; timeoutMs?: number } = {}): Promise<boolean> {
  const host = options.host ?? "registry.npmjs.org";
  const timeoutMs = options.timeoutMs ?? 6_000;
  const net = await import("node:net");
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = net.connect({ host, port: 443 });
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** Resolves every probe the catalog needs, with per-probe isolation. */
export async function collectHostProbes(options: ProbeOptions): Promise<HostProbes> {
  const overrides = options.overrides ?? {};
  const safe = <T>(probe: () => T, fallback: T): T => {
    try {
      return probe();
    } catch {
      return fallback;
    }
  };
  const electronBinary = overrides.electronBinary ?? safe(() => hasElectronBinary(options.repoRoot), false);
  const codexCli = overrides.codexCli ?? safe(() => hasCodexCli(), false);
  const buildOutput = overrides.buildOutput ?? safe(() => hasBuildOutput(options.repoRoot), false);
  const network =
    overrides.network ??
    (await probeNetwork({ host: options.networkHost, timeoutMs: options.networkTimeoutMs }).catch(() => false));
  return {
    electronBinary,
    codexCli,
    network,
    buildOutput,
    pathExists: (relative: string) => safe(() => fs.existsSync(path.join(options.repoRoot, relative)), false)
  };
}

/** `git rev-parse HEAD` — recorded in the evidence so a report names its revision. */
export function currentRevision(repoRoot: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, windowsHide: true, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

export function currentBranch(repoRoot: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot, windowsHide: true, encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}
