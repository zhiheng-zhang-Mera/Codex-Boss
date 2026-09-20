import { BOSS_CREDENTIAL_REQUIRED_ACTION, type BossGitHubCredentialProvider } from "./github-credential-provider";
import type { GitHubAppAuthProvider } from "../github/github-app-auth";

/** The provider's own answer shape, so this class cannot drift from the interface it implements. */
type BossCredentialResult = ReturnType<BossGitHubCredentialProvider["getAutomationCredential"]>;

/**
 * The Boss promotion credential, taken from the EXISTING GitHub App machine identity.
 *
 * ## Why this exists (the convergence, not a second identity)
 *
 * The host already had a proven GitHub App machine identity — a private key in the platform's secure storage,
 * a short-lived installation token minted by `GitHubAppAuthProvider`, a live acceptance that acted as
 * `codex-boss[bot]` — and the Self-Evolution promotion path did not use it. That path defaulted to
 * `EnvironmentBossGitHubCredentialProvider`, i.e. a long-lived token in `CODEX_BOSS_GITHUB_TOKEN`, which is a
 * SECOND credential architecture for the same logical actor: two custody systems, two rotation stories, two
 * ways for authority to leak, and a promotion path that reports BLOCKED_EXTERNAL on a host whose App identity
 * works.
 *
 * This provider removes the second architecture rather than reconciling the two. It owns NO auth logic:
 *
 *   - it does not create a JWT,
 *   - it does not load or reference the private key,
 *   - it does not refresh or cache tokens,
 *   - it does not check repository installation scope.
 *
 * All of that already exists once, in `GitHubAppAuthProvider`, which mints and caches the installation token.
 * This class asks that provider for a token at the moment a promotion operation needs one, and hands the
 * caller a short-lived `AutomationCredential`. Duplicating any of the four would be a second implementation of
 * the same authority, which is exactly what this round exists to prevent.
 *
 * ## What it cannot do
 *
 * It cannot widen authority. The token it returns is the installation token, so its reach is the App's
 * installation: the repositories the Owner installed the App on, with the permissions the App was granted —
 * no administration, no ruleset access, no bypass. The App's own permission set is the ceiling, and this class
 * cannot raise it.
 *
 * ## What the worker sees
 *
 * Nothing. This object lives on the host and is handed to the host-owned promotion adapter. The candidate
 * worker reaches promotion only through typed host requests, so it never receives a token, a vault lease, or a
 * key reference — the rule is that a credential stays on the host side of the request boundary.
 */
export class GitHubAppPromotionCredentialProvider implements BossGitHubCredentialProvider {
  constructor(
    private readonly auth: GitHubAppAuthProvider,
    /**
     * The login the installation acts as, for evidence. Not authorization: it is compared with nothing here,
     * because the App's identity is established by the token itself, not by a string this class was handed.
     */
    private readonly logicalIdentity = "codex-boss[bot]"
  ) {}

  describe(): { configured: boolean; identity: string | null; source: string } {
    const described = this.auth.describe();
    return {
      // `enabled` is the auth provider's own answer to "is this App usable here" — read from it rather than
      // re-deriving the conditions (appId, installationId, private key) a second time.
      configured: Boolean(described.enabled),
      identity: this.logicalIdentity,
      source: "github-app-installation-token"
    };
  }

  /**
   * Honest synchronous answer: a minted credential is not available synchronously.
   *
   * Returning a cached token here would be a guess about freshness, and returning the last token after it
   * expired is how a promotion fails at the push step with a confusing 401 instead of a clear blocker. Callers
   * use `getAutomationCredentialAsync`.
   */
  getAutomationCredential(): BossCredentialResult {
    return {
      status: "BLOCKED_EXTERNAL",
      reason: "the Boss GitHub App credential is minted asynchronously; this provider is read through getAutomationCredentialAsync()",
      requiredExternalAction: BOSS_CREDENTIAL_REQUIRED_ACTION
    };
  }

  /** Mints (or reuses the provider's cached) installation token and reports it as the Boss credential. */
  async getAutomationCredentialAsync(): Promise<BossCredentialResult> {
    const result = await this.auth.getInstallationToken();
    if (!result.ok) {
      return {
        status: "BLOCKED_EXTERNAL",
        reason: `the GitHub App installation token could not be minted (${result.code}: ${result.message})`,
        requiredExternalAction: BOSS_CREDENTIAL_REQUIRED_ACTION
      };
    }
    if (!result.value.token) {
      return {
        status: "BLOCKED_EXTERNAL",
        reason: "the GitHub App returned an empty installation token",
        requiredExternalAction: BOSS_CREDENTIAL_REQUIRED_ACTION
      };
    }
    return {
      status: "AVAILABLE",
      credential: {
        token: result.value.token,
        identity: this.logicalIdentity,
        // Recorded so evidence names the custody system rather than an environment variable: this credential
        // has no environment variable to name, which is the point.
        source: "github-app-installation-token"
      }
    };
  }
}
