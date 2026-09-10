import {
  OWNER_CREDENTIAL_VARIABLES,
  findCredentialLeaks,
  fingerprint,
  sanitizeEnvironment
} from "./sanitized-environment";

/**
 * Credential Boundary (Update-Plan/Isolation-Finalization.md §9, §14 RT-22..RT-24).
 *
 * Boss credentials and Owner credentials are different trust domains. This
 * module is the part of the boundary that *observes* the host: it enumerates the
 * ambient authority the desktop process is holding, so the evolution path can
 * prove it neither forwards nor consumes it.
 *
 * Two deliberate limits:
 *
 *   - it reads variable NAMES and, for comparison only, their irreversible
 *     fingerprints. It never logs, persists or returns a credential value;
 *   - it never scans the home directory, the credential manager, the registry
 *     or an SSH agent. Enumerating Owner secrets is itself the escalation this
 *     Phase exists to prevent (§4: "扫描 / 复制 Owner credential" is DENY), so
 *     the boundary is built from what the process was *given*, not from what it
 *     can *find*.
 */

export type CredentialDomain = "OWNER" | "BOSS" | "UNKNOWN";

export interface AmbientCredentialObservation {
  /** Variable names present in the host environment. Names only, never values. */
  ownerAuthorityVariables: string[];
  /** Non-reversible fingerprints, for equality checks against a Boss credential. */
  ownerCredentialFingerprints: string[];
  /** Every credential-shaped variable still present (should be limited to Boss-owned). */
  credentialShapedVariables: string[];
}

/**
 * Observes the host environment without consuming it. `sanitizeEnvironment`
 * with no exceptions is used as the leak detector, so this cannot drift from the
 * boundary itself.
 */
export function observeAmbientCredentials(environment: NodeJS.ProcessEnv = process.env): AmbientCredentialObservation {
  const ownerAuthorityVariables: string[] = [];
  const ownerCredentialFingerprints: string[] = [];
  for (const name of OWNER_CREDENTIAL_VARIABLES) {
    const value = environment[name];
    if (!value) continue;
    ownerAuthorityVariables.push(name);
    ownerCredentialFingerprints.push(`${name}:${fingerprint(value)}`);
  }
  return {
    ownerAuthorityVariables,
    ownerCredentialFingerprints,
    credentialShapedVariables: findCredentialLeaks(environment)
  };
}

/** The environment an autonomous Candidate / worker child must be given. */
export function candidateEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  options: { inject?: Readonly<Record<string, string>>; deny?: readonly string[]; allow?: readonly string[] } = {}
): NodeJS.ProcessEnv {
  return sanitizeEnvironment(environment, options);
}

/**
 * §9.4 / §10: GitHub administration targets the evolution path must never drive
 * a browser to. Matched on the URL path, so a query string or fragment cannot
 * disguise them.
 */
const OWNER_ADMIN_PATH_PATTERNS: readonly RegExp[] = [
  /\/settings(?:\/|$)/i,
  /\/rules(?:\/|$)/i,
  /\/rulesets?(?:\/|$)/i,
  /\/branches\/settings(?:\/|$)/i,
  /\/actions\/secrets(?:\/|$)/i,
  /\/actions\/permissions(?:\/|$)/i,
  /\/collaborators(?:\/|$)/i,
  /\/organization\/settings(?:\/|$)/i,
  /\/account\/(?:billing|security|sessions)(?:\/|$)/i,
  /\/orgs\/[^/]+\/settings(?:\/|$)/i
];

/**
 * True when a URL targets the Owner's administrative GitHub surface. Used by
 * RT-24: "Owner browser/admin session 存在 ⇒ self-evolution path does not
 * automate it". The check is on the *target*, so holding a logged-in Owner
 * browser profile does not by itself change the decision — the path simply may
 * not navigate there.
 */
export function isOwnerAdministrationTarget(url: string): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && !host.endsWith(".github.com")) return false;
  return OWNER_ADMIN_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname));
}

/**
 * True when the given candidate credential is byte-identical to an ambient
 * Owner/authority credential. Comparison is by fingerprint so the value never
 * reaches a log or a ledger entry (RT-22/RT-23: no Owner fallback).
 */
export function isAmbientOwnerCredential(candidate: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  if (!candidate) return false;
  const candidatePrint = fingerprint(candidate);
  for (const name of OWNER_CREDENTIAL_VARIABLES) {
    const value = environment[name];
    if (value && fingerprint(value) === candidatePrint) return true;
  }
  return false;
}

export interface CredentialBoundaryAssessment {
  /** Ambient Owner authority observed on the host. Names only. */
  ownerAuthorityPresent: string[];
  /** The environment a Candidate must be given (credentials removed). */
  candidateEnvironment: NodeJS.ProcessEnv;
  /**
   * True when ambient Owner authority exists. This is informational: the
   * boundary is enforced by removal, not by pretending the authority is absent.
   */
  ambientOwnerAuthorityDetected: boolean;
  /** Names removed on the way to the candidate environment. */
  removedVariables: string[];
}

/**
 * The boundary decision. Note what this deliberately does NOT do: it does not
 * refuse to run because the Owner is logged in. RT-23 expects "ambient Owner
 * token exists ⇒ Candidate cannot receive/use it", which is a containment
 * property, not a shutdown condition.
 */
export function assessCredentialBoundary(environment: NodeJS.ProcessEnv = process.env): CredentialBoundaryAssessment {
  const observation = observeAmbientCredentials(environment);
  const candidate = candidateEnvironment(environment);
  const removed = Object.keys(environment).filter((name) => environment[name] !== undefined && candidate[name] === undefined);
  return {
    ownerAuthorityPresent: observation.ownerAuthorityVariables,
    candidateEnvironment: candidate,
    ambientOwnerAuthorityDetected: observation.ownerAuthorityVariables.length > 0,
    removedVariables: removed
  };
}
