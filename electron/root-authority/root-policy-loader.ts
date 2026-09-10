import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ROOT_POLICY,
  ROOT_POLICY_FALLBACK,
  RootPolicyError,
  parseRootPolicy,
  type RootPolicy
} from "../../src/shared/root-authority/root-policy";

/**
 * Repository-side Root Policy loader (Update-Plan/Isolation-Finalization.md
 * §5, §7.1). The policy file lives at `.codex-boss/root/root-policy.json` and
 * holds policy only — never a token, key, session or cookie.
 *
 * Failure discipline is the point of this module:
 *
 *   - a missing file is NOT "the Owner said yes". It yields the strict fallback
 *     policy and a `fallback-missing` source, so every Root Surface still needs
 *     the Owner and the audit ledger can say exactly why.
 *   - an unparseable or malformed file yields the strict fallback plus the
 *     concrete error, never a partially-applied policy.
 *   - a file containing secret material is refused loudly: it is a security
 *     event, not a configuration inconvenience.
 *
 * Loading never throws. Callers get the effective policy *and* its provenance,
 * so a degraded boot is always visible in durable evidence instead of silent.
 */

export type RootPolicySource = "repository" | "fallback-missing" | "fallback-unreadable" | "fallback-invalid";

export interface LoadedRootPolicy {
  policy: RootPolicy;
  source: RootPolicySource;
  /** Absolute path that was consulted. */
  file: string;
  /** Present whenever the repository policy could not be honoured. */
  error?: string;
  /** True when the effective policy is a fallback rather than the real file. */
  degraded: boolean;
}

export const ROOT_POLICY_RELATIVE_PATH = path.join(".codex-boss", "root", "root-policy.json");

export function rootPolicyPath(root: string): string {
  return path.join(path.resolve(root), ROOT_POLICY_RELATIVE_PATH);
}

/** Reads and validates the repository policy, degrading explicitly on failure. */
export function loadRootPolicy(root: string, file = rootPolicyPath(root)): LoadedRootPolicy {
  if (!fs.existsSync(file)) {
    return { policy: ROOT_POLICY_FALLBACK, source: "fallback-missing", file, error: `root policy not found at ${file}`, degraded: true };
  }
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (error) {
    return { policy: ROOT_POLICY_FALLBACK, source: "fallback-unreadable", file, error: `root policy unreadable: ${String(error)}`, degraded: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return { policy: ROOT_POLICY_FALLBACK, source: "fallback-unreadable", file, error: `root policy is not valid JSON: ${String(error)}`, degraded: true };
  }
  try {
    return { policy: parseRootPolicy(parsed), source: "repository", file, degraded: false };
  } catch (error) {
    const detail = error instanceof RootPolicyError ? error.message : String(error);
    return { policy: ROOT_POLICY_FALLBACK, source: "fallback-invalid", file, error: detail, degraded: true };
  }
}

/**
 * Writes the repository policy after validating it. Used to *create* the
 * shipped policy, never by an autonomous path — `.codex-boss/root/` is a Root
 * Surface that CODEOWNERS routes to the Owner.
 */
export function writeRootPolicy(root: string, policy: RootPolicy, file = rootPolicyPath(root)): string {
  const validated = parseRootPolicy(policy);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(validated, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, file);
  return file;
}

/**
 * Identity check for §4 "修改 Owner 身份以绕过 Owner" and RT-08.
 *
 * A claim of Root Owner authority is only accepted when the policy names the
 * claimant as the single Root Owner. An unresolved fallback policy names no
 * Owner, so every claim is refused.
 */
export function isClaimedRootOwner(policy: RootPolicy, claimedLogin: unknown): boolean {
  if (typeof claimedLogin !== "string" || !claimedLogin) return false;
  if (policy.rootOwner === ROOT_POLICY_FALLBACK.rootOwner) return false;
  return claimedLogin.toLowerCase() === policy.rootOwner.toLowerCase();
}

/** The Root Owner named by the shipped default policy; used in acceptance docs. */
export const SHIPPED_ROOT_OWNER = DEFAULT_ROOT_POLICY.rootOwner;
