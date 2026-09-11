import { createHash } from "node:crypto";

/**
 * Sanitized environment for Candidate / worker subprocesses
 * (Update-Plan/Isolation-Finalization.md §9.2, §14 RT-23).
 *
 * `electron/engineering/command-runner.ts` currently forwards `{ ...process.env }`
 * to the child process. That is correct for the interactive developer path, but
 * an autonomous self-evolution child inherited that way would receive every
 * ambient credential the Boss desktop happened to be holding — including the
 * Owner's `GH_TOKEN`, an SSH agent socket, or a cloud key. This module is the
 * split: the *build/test* environment is preserved, the *credential*
 * environment is removed.
 *
 * Two independent layers, so neither alone is load-bearing:
 *
 *   1. An explicit deny list of names known to carry Owner / ambient authority.
 *   2. A shape-based deny list for anything that looks like a token, secret,
 *      password, credential or private key.
 *
 * `assertNoCredentialLeak` is the post-condition the Candidate supervisor runs
 * before spawning anything: sanitization is verified, not assumed.
 */

/** Names that carry Owner or ambient authority and are always removed. */
export const OWNER_CREDENTIAL_VARIABLES: readonly string[] = [
  // GitHub / gh CLI — the Owner's own automation credentials.
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GITHUB_PAT",
  "GH_PAT",
  "GH_CONFIG_DIR",
  "GITHUB_TOKEN_FILE",
  // Git credential plumbing that can silently answer as the Owner.
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GIT_CREDENTIAL_HELPER",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  // Cloud / package-registry ambient authority.
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_CLIENT_SECRET",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "PGPASSWORD",
  // Boss Root Authority material. Root policy is policy-only; if any of these
  // ever exist they are signing/authority secrets and never enter a Candidate.
  "CODEX_BOSS_ROOT_SECRET",
  "CODEX_BOSS_ROOT_SIGNING_KEY",
  "CODEX_BOSS_OWNER_TOKEN",
  "CODEX_BOSS_OWNER_SESSION",
  "BOSS_OWNER_TOKEN",
  // Admin-session material a browser profile might expose.
  "GITHUB_ADMIN_TOKEN",
  "GH_ADMIN_TOKEN"
];

/**
 * Shape-based denial. Deliberately broad: over-removing a variable from a
 * Candidate child costs a confusing test failure, while under-removing one costs
 * Owner authority. `PATH`-like names are unaffected (the patterns require a
 * separator boundary, so `PATH` never matches `PAT`).
 */
export const CREDENTIAL_NAME_PATTERN = /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|PAT|APIKEY|API_KEY|PRIVATE_KEY|SIGNING_KEY|SESSION_KEY|ACCESS_KEY|AUTHKEY|AUTH_KEY)(_|$)/i;

/** Variables required for a normal build/test child to function. */
export const TOOLCHAIN_ENVIRONMENT_VARIABLES: readonly string[] = [
  "PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "COMSPEC",
  "TEMP", "TMP", "TMPDIR",
  "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "ProgramData",
  "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "CommonProgramFiles",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "OS",
  "LANG", "LC_ALL", "TERM", "TZ",
  "NODE_ENV", "NODE_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
  "CI", "GITHUB_ACTIONS", "GITHUB_WORKSPACE", "GITHUB_REPOSITORY", "GITHUB_SHA",
  "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_BASE_REF", "GITHUB_HEAD_REF",
  "GITHUB_EVENT_NAME", "GITHUB_RUN_ID", "GITHUB_ACTOR", "RUNNER_OS", "RUNNER_TEMP"
];

export interface SanitizedEnvironmentOptions {
  /**
   * Exact variable names to keep even though they match a credential pattern.
   * Empty by default: an exception list is how boundaries erode, so it must be
   * explicit and visible at every call site that uses it.
   */
  allow?: readonly string[];
  /** Extra variables to force-add (e.g. the Candidate's own TEMP). */
  inject?: Readonly<Record<string, string>>;
  /** Extra names to remove on top of the built-in lists. */
  deny?: readonly string[];
}

export interface SanitizationReport {
  kept: string[];
  removed: string[];
  /** Names removed because an explicit deny list named them. */
  removedExplicitly: string[];
  /** Names removed because they matched the credential shape. */
  removedByPattern: string[];
}

function isDenied(name: string, extraDeny: readonly string[], allow: readonly string[]): "explicit" | "pattern" | undefined {
  const upper = name.toUpperCase();
  if (allow.some((item) => item.toUpperCase() === upper)) return undefined;
  if (OWNER_CREDENTIAL_VARIABLES.some((item) => item.toUpperCase() === upper)) return "explicit";
  if (extraDeny.some((item) => item.toUpperCase() === upper)) return "explicit";
  if (CREDENTIAL_NAME_PATTERN.test(name)) return "pattern";
  return undefined;
}

/**
 * Public form of the removal decision, so callers and acceptance tests can ask
 * *why* a name was removed without duplicating the rule.
 */
export function credentialNameIsDenied(name: string, options: { allow?: readonly string[]; deny?: readonly string[] } = {}): "explicit" | "pattern" | undefined {
  return isDenied(name, options.deny ?? [], options.allow ?? []);
}

/** Returns a child environment containing the toolchain and nothing that carries
 * authority. The input is never mutated. */
export function sanitizeEnvironment(source: NodeJS.ProcessEnv, options: SanitizedEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const allow = options.allow ?? [];
  const deny = options.deny ?? [];
  const output: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (isDenied(name, deny, allow)) continue;
    output[name] = value;
  }
  for (const [name, value] of Object.entries(options.inject ?? {})) output[name] = value;
  return output;
}

/** Same computation as `sanitizeEnvironment`, with the reasons recorded. */
export function describeSanitization(source: NodeJS.ProcessEnv, options: SanitizedEnvironmentOptions = {}): SanitizationReport {
  const allow = options.allow ?? [];
  const deny = options.deny ?? [];
  const report: SanitizationReport = { kept: [], removed: [], removedExplicitly: [], removedByPattern: [] };
  for (const name of Object.keys(source)) {
    if (source[name] === undefined) continue;
    const reason = isDenied(name, deny, allow);
    if (reason === "explicit") { report.removed.push(name); report.removedExplicitly.push(name); }
    else if (reason === "pattern") { report.removed.push(name); report.removedByPattern.push(name); }
    else report.kept.push(name);
  }
  for (const name of Object.keys(options.inject ?? {})) report.kept.push(name);
  return report;
}

/**
 * Names still present that carry authority. Used as a spawn-time post-condition
 * (RT-23) and by the acceptance evidence.
 */
export function findCredentialLeaks(environment: NodeJS.ProcessEnv): string[] {
  const leaks: string[] = [];
  for (const name of Object.keys(environment)) {
    if (environment[name] === undefined) continue;
    if (isDenied(name, [], [])) leaks.push(name);
  }
  return leaks;
}

export class CredentialBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialBoundaryError";
  }
}

/**
 * True when a variable belongs to the documented toolchain allow-list. Exposed
 * so callers (and the acceptance tests) can assert that the sanitizer preserved
 * everything a build/test child genuinely needs.
 */
export function isToolchainVariable(name: string): boolean {
  const upper = name.toUpperCase();
  return TOOLCHAIN_ENVIRONMENT_VARIABLES.some((item) => item.toUpperCase() === upper);
}

/** Throws unless the environment is free of credential-shaped variables. */
export function assertNoCredentialLeak(environment: NodeJS.ProcessEnv): void {
  const leaks = findCredentialLeaks(environment);
  if (leaks.length) throw new CredentialBoundaryError(`candidate environment still carries credential variables: ${leaks.join(", ")}`);
}

/** Stable, non-reversible fingerprint used to compare credentials without logging them. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
