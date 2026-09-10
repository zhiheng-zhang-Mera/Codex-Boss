import { isAmbientOwnerCredential } from "./credential-boundary";

/**
 * Dedicated Boss GitHub credential provider
 * (Update-Plan/Isolation-Finalization.md §9.3, §9.4, §21.B, §14 RT-22).
 *
 * The interface exists so that exactly one question is asked at the remote
 * boundary: "does a credential that is *Boss's own* exist right now?" The
 * answer is either AVAILABLE or BLOCKED_EXTERNAL. There is no third branch, and
 * in particular there is no fallback:
 *
 *   - the provider reads ONLY Boss-specific variables
 *     (`CODEX_BOSS_GITHUB_TOKEN`, `BOSS_GITHUB_TOKEN`). It never reads
 *     `GH_TOKEN` / `GITHUB_TOKEN`, which belong to the Owner's ambient session.
 *   - it never shells out to `gh auth token`, so it cannot borrow the Owner's
 *     keyring entry even indirectly.
 *   - a credential that turns out to be byte-identical to an ambient Owner
 *     credential is refused, not used.
 *   - a credential whose GitHub identity is the Root Owner is refused: the Boss
 *     identity may not be the Owner identity (§9.1).
 *
 * The expected real-world configuration (a GitHub App / machine user with
 * contents+PR write and NO administration) is an Owner action outside the
 * repository. Until it exists, every remote promotion reports BLOCKED_EXTERNAL —
 * which is the honest result (RT-22), never a green run borrowed from the Owner.
 */

export interface AutomationCredential {
  /** Opaque secret. Never serialized into evidence, logs or ledger entries. */
  readonly token: string;
  /** GitHub login the credential acts as, when known. */
  readonly identity: string;
  /** Where it came from, for evidence: an environment variable name. */
  readonly source: string;
}

export type BossCredentialResult =
  | { status: "AVAILABLE"; credential: AutomationCredential }
  | { status: "BLOCKED_EXTERNAL"; reason: string; requiredExternalAction: string };

export interface BossGitHubCredentialProvider {
  /** Resolves the Boss automation credential, or reports the external blocker. */
  getAutomationCredential(): BossCredentialResult;
  /** Non-secret description for evidence and the Owner dashboard. */
  describe(): { configured: boolean; identity: string | null; source: string };
}

/** Boss-owned variable names, in priority order. Deliberately not GH_TOKEN. */
export const BOSS_CREDENTIAL_VARIABLES: readonly string[] = ["CODEX_BOSS_GITHUB_TOKEN", "BOSS_GITHUB_TOKEN"];

/** Optional companion variable naming the Boss login (non-secret). */
export const BOSS_IDENTITY_VARIABLES: readonly string[] = ["CODEX_BOSS_GITHUB_IDENTITY", "BOSS_GITHUB_IDENTITY"];

export const BOSS_CREDENTIAL_REQUIRED_ACTION =
  "Create a dedicated Boss GitHub identity (GitHub App or bot account) with contents:write, pull_requests:write and checks:read only, no repository administration and no ruleset bypass, then expose its token to Boss as CODEX_BOSS_GITHUB_TOKEN (and its login as CODEX_BOSS_GITHUB_IDENTITY).";

export interface EnvironmentBossGitHubCredentialProviderOptions {
  environment?: NodeJS.ProcessEnv;
  /**
   * The Root Owner login from the Root Policy. A Boss credential acting as the
   * Root Owner is refused, so the two trust domains cannot collapse (§9.1).
   */
  rootOwner?: string;
}

export class EnvironmentBossGitHubCredentialProvider implements BossGitHubCredentialProvider {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly rootOwner: string | undefined;

  constructor(options: EnvironmentBossGitHubCredentialProviderOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.rootOwner = options.rootOwner;
  }

  private raw(): { token: string; source: string } | undefined {
    for (const name of BOSS_CREDENTIAL_VARIABLES) {
      const value = this.environment[name];
      if (value && value.trim()) return { token: value.trim(), source: name };
    }
    return undefined;
  }

  private identity(): string {
    for (const name of BOSS_IDENTITY_VARIABLES) {
      const value = this.environment[name];
      if (value && value.trim()) return value.trim();
    }
    return "unknown";
  }

  describe(): { configured: boolean; identity: string | null; source: string } {
    const raw = this.raw();
    if (!raw) return { configured: false, identity: null, source: "none" };
    return { configured: true, identity: this.identity(), source: raw.source };
  }

  getAutomationCredential(): BossCredentialResult {
    const raw = this.raw();
    if (!raw) {
      return {
        status: "BLOCKED_EXTERNAL",
        reason: `no dedicated Boss GitHub credential is configured (looked for ${BOSS_CREDENTIAL_VARIABLES.join(", ")}); refusing to fall back to the Owner's ambient credential`,
        requiredExternalAction: BOSS_CREDENTIAL_REQUIRED_ACTION
      };
    }

    // A "dedicated" credential that is literally the Owner's ambient token is
    // the Owner's authority wearing a different name (RT-22).
    if (isAmbientOwnerCredential(raw.token, this.environment)) {
      return {
        status: "BLOCKED_EXTERNAL",
        reason: `${raw.source} is byte-identical to an ambient Owner credential; refusing to treat Owner authority as a Boss identity`,
        requiredExternalAction: BOSS_CREDENTIAL_REQUIRED_ACTION
      };
    }

    const identity = this.identity();
    if (this.rootOwner && identity !== "unknown" && identity.toLowerCase() === this.rootOwner.toLowerCase()) {
      return {
        status: "BLOCKED_EXTERNAL",
        reason: `the configured Boss identity "${identity}" is the Root Owner; the autonomous path may not act as the Owner`,
        requiredExternalAction: BOSS_CREDENTIAL_REQUIRED_ACTION
      };
    }

    return { status: "AVAILABLE", credential: { token: raw.token, identity, source: raw.source } };
  }
}

/**
 * Provider that always reports the external blocker. Used by tests and by any
 * host that has deliberately not configured unattended promotion; it makes
 * "no credential" a first-class, non-crashing state.
 */
export class UnconfiguredBossGitHubCredentialProvider implements BossGitHubCredentialProvider {
  getAutomationCredential(): BossCredentialResult {
    return { status: "BLOCKED_EXTERNAL", reason: "no Boss GitHub credential provider is configured on this host", requiredExternalAction: BOSS_CREDENTIAL_REQUIRED_ACTION };
  }

  describe(): { configured: boolean; identity: string | null; source: string } {
    return { configured: false, identity: null, source: "unconfigured" };
  }
}
