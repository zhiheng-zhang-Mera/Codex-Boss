import { describe, expect, it } from "vitest";
import { GitHubAppPromotionCredentialProvider } from "../../electron/credential-boundary/github-app-credential-provider";
import { EnvironmentBossGitHubCredentialProvider, UnconfiguredBossGitHubCredentialProvider } from "../../electron/credential-boundary/github-credential-provider";
import { candidateEnvironment } from "../../electron/credential-boundary/credential-boundary";
import { sanitizeEnvironment } from "../../electron/credential-boundary/sanitized-environment";
import { GitHubPromotionAdapter, type GitHubTransport, type GitHubTransportRequest } from "../../electron/promotion-gate/github-promotion-adapter";
import { REQUIRED_PROMOTION_CHECKS } from "../../src/shared/promotion-checks";

/**
 * PF-DEBT-018-era convergence: the Self-Evolution promotion path must act with the SAME GitHub App machine
 * identity as ordinary Boss GitHub work, must never borrow the Owner's ambient credential, and must never hand
 * the worker either a private key or an installation token.
 *
 * These are the anti-drift cases. The behaviour they pin is the reason the second credential architecture was
 * removed rather than reconciled:
 *
 *   - one logical actor (the App installation) with one custody system (the App private key in platform
 *     secure storage, minting short-lived installation tokens);
 *   - no path from an environment variable to a promotion credential, not even when the Owner's own session
 *     variables are present;
 *   - `BLOCKED_EXTERNAL`, never a fallback, when the App cannot mint a token.
 */

const SHA = "a".repeat(40);

/** A stand-in for the real `GitHubAppAuthProvider`: only the two members the provider uses. */
function fakeAuth(options: { enabled?: boolean; token?: string | null; fail?: { code: string; message: string } }) {
  return {
    describe: () => ({
      logicalIdentity: "Codex-Boss",
      enabled: options.enabled ?? true,
      appIdConfigured: true,
      installationIdConfigured: true,
      privateKeyRef: "platform-secure-storage",
      credentialProviderAvailable: true,
      credentialBackend: "safeStorage"
    }),
    getInstallationToken: async () =>
      options.fail
        ? { ok: false as const, code: options.fail.code, message: options.fail.message, retryable: false }
        : { ok: true as const, value: { token: options.token ?? "installation-token", expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }
  };
}

const authProvider = (options: Parameters<typeof fakeAuth>[0]) =>
  fakeAuth(options) as unknown as ConstructorParameters<typeof GitHubAppPromotionCredentialProvider>[0];

describe("the promotion credential is the existing GitHub App identity", () => {
  it("mints the credential through the App, and names that custody system as the source", async () => {
    const provider = new GitHubAppPromotionCredentialProvider(authProvider({ token: "ghs_minted" }));
    const result = await provider.getAutomationCredentialAsync();
    expect(result.status).toBe("AVAILABLE");
    if (result.status === "AVAILABLE") {
      expect(result.credential.token).toBe("ghs_minted");
      expect(result.credential.identity).toBe("codex-boss[bot]");
      // The source names a custody system, not an environment variable — that is the whole convergence.
      expect(result.credential.source).toBe("github-app-installation-token");
    }
    const described = provider.describe();
    expect(described.configured).toBe(true);
    expect(described.source).toBe("github-app-installation-token");
    // The synchronous form is honest rather than approximate: it does not hand out a possibly-expired token.
    expect(provider.getAutomationCredential().status).toBe("BLOCKED_EXTERNAL");
  });

  it("reports BLOCKED_EXTERNAL when the App cannot mint a token, and never falls back to the environment", async () => {
    const provider = new GitHubAppPromotionCredentialProvider(authProvider({ fail: { code: "REPOSITORY_NOT_INSTALLED", message: "installation not found" } }));
    const result = await provider.getAutomationCredentialAsync();
    expect(result.status).toBe("BLOCKED_EXTERNAL");
    // The blocker names the App failure, so an operator reads the real cause rather than "no credential".
    if (result.status === "BLOCKED_EXTERNAL") expect(result.reason).toContain("REPOSITORY_NOT_INSTALLED");
    expect(provider.describe().configured).toBe(true);

    // A node where the App is not enabled is not configured at all.
    const disabled = new GitHubAppPromotionCredentialProvider(authProvider({ enabled: false }));
    expect(disabled.describe().configured).toBe(false);
  });

  it("never consumes GH_TOKEN or GITHUB_TOKEN, even when both are present", async () => {
    const ownerEnvironment = { GH_TOKEN: "owner-ambient-token", GITHUB_TOKEN: "owner-actions-token", CODEX_BOSS_GITHUB_TOKEN: "owner-ambient-token" };

    // The environment provider refuses the Owner's credential rather than using it (its oldest guarantee).
    const legacy = new EnvironmentBossGitHubCredentialProvider({ environment: ownerEnvironment });
    const legacyResult = legacy.getAutomationCredential();
    expect(legacyResult.status).toBe("BLOCKED_EXTERNAL");
    if (legacyResult.status === "BLOCKED_EXTERNAL") expect(legacyResult.reason).toMatch(/byte-identical to an ambient Owner credential/);

    // With ONLY the Owner's ambient variables set, the legacy provider finds nothing at all: those names are
    // not in its vocabulary, which is the property the convergence must not weaken.
    const onlyOwner = new EnvironmentBossGitHubCredentialProvider({ environment: { GH_TOKEN: "owner-ambient-token", GITHUB_TOKEN: "owner-actions-token" } });
    const onlyOwnerResult = onlyOwner.getAutomationCredential();
    expect(onlyOwnerResult.status).toBe("BLOCKED_EXTERNAL");
    if (onlyOwnerResult.status === "BLOCKED_EXTERNAL") expect(onlyOwnerResult.reason).toContain("CODEX_BOSS_GITHUB_TOKEN");

    // And the App provider ignores the environment entirely.
    const app = new GitHubAppPromotionCredentialProvider(authProvider({ token: "ghs_minted" }));
    const appResult = await app.getAutomationCredentialAsync();
    if (appResult.status === "AVAILABLE") expect(appResult.credential.token).toBe("ghs_minted");
  });

  it("gives the candidate environment neither the App private key nor an Owner credential", () => {
    const hostEnvironment = {
      GH_TOKEN: "owner-ambient-token",
      GITHUB_TOKEN: "owner-actions-token",
      CODEX_BOSS_GITHUB_TOKEN: "boss-env-token",
      BOSS_GITHUB_TOKEN: "boss-env-token-2",
      CODEX_BOSS_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----",
      PATH: "/usr/bin"
    };
    const sanitized = sanitizeEnvironment(hostEnvironment);
    for (const secret of ["owner-ambient-token", "owner-actions-token", "boss-env-token", "boss-env-token-2", "BEGIN RSA PRIVATE KEY"]) {
      expect(Object.values(sanitized).join("\n"), `the sanitized environment leaked ${secret}`).not.toContain(secret);
    }
    // The candidate environment is the same boundary seen from the worker's side.
    const candidate = candidateEnvironment(hostEnvironment);
    for (const secret of ["owner-ambient-token", "owner-actions-token", "boss-env-token", "boss-env-token-2"]) {
      expect(Object.values(candidate).join("\n"), `the candidate environment leaked ${secret}`).not.toContain(secret);
    }
  });
});

describe("the promotion adapter prefers the minted credential and still fails closed without one", () => {
  const requests: GitHubTransportRequest[] = [];
  const transport: GitHubTransport = {
    async request(request) {
      requests.push(request);
      if (request.url.includes("/check-runs")) {
        return { status: 200, body: JSON.stringify({ check_runs: REQUIRED_PROMOTION_CHECKS.map((name) => ({ name, status: "completed", conclusion: "success", head_sha: SHA })) }) };
      }
      if (request.url.includes("/pulls/") && request.method === "GET") return { status: 200, body: JSON.stringify({ number: 1, state: "open", head: { sha: SHA } }) };
      return { status: 200, body: "{}" };
    }
  };

  it("uses the App installation token as the transport credential", async () => {
    requests.length = 0;
    const adapter = new GitHubPromotionAdapter({
      repository: "zhiheng-zhang-Mera/Codex-Boss",
      credentialProvider: new GitHubAppPromotionCredentialProvider(authProvider({ token: "ghs_minted" })),
      transport
    });
    const read = await adapter.readRequiredCheck(SHA);
    expect(read.status).toBe("OK");
    // The token that actually travelled is the minted one, and it travelled as the App identity.
    expect(requests[0].token).toBe("ghs_minted");
    expect(adapter.describe().credential.source).toBe("github-app-installation-token");
  });

  it("makes no request at all when the App cannot mint, and never substitutes another credential", async () => {
    requests.length = 0;
    const adapter = new GitHubPromotionAdapter({
      repository: "zhiheng-zhang-Mera/Codex-Boss",
      credentialProvider: new GitHubAppPromotionCredentialProvider(authProvider({ fail: { code: "AUTH_INVALID", message: "the App private key was rejected" } })),
      transport
    });
    const read = await adapter.readRequiredCheck(SHA);
    expect(read.status).toBe("BLOCKED_EXTERNAL");
    expect(requests, "a blocked credential must not produce a single outbound request").toHaveLength(0);

    // The fail-closed default behaves the same way: no credential, no request, no fallback.
    requests.length = 0;
    const unconfigured = new GitHubPromotionAdapter({
      repository: "zhiheng-zhang-Mera/Codex-Boss",
      credentialProvider: new UnconfiguredBossGitHubCredentialProvider(),
      transport
    });
    expect((await unconfigured.readRequiredCheck(SHA)).status).toBe("BLOCKED_EXTERNAL");
    expect(requests).toHaveLength(0);
  });
});
