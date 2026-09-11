import { createSign } from "node:crypto";
import { BOSS_GITHUB_LOGICAL_IDENTITY, type GitHubMachineIdentityConfig, type GitHubResult } from "../../src/shared/github-machine";
import { redactSecrets } from "../../src/shared/secret-scan";
import type { SecretProvider } from "./secret-provider";

export interface GitHubHttpRequest {
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface GitHubHttpResponse {
  status: number;
  headers?: Record<string, string | undefined>;
  body: string;
}

export interface GitHubHttpTransport {
  request(request: GitHubHttpRequest): Promise<GitHubHttpResponse>;
}

export const fetchGitHubHttpTransport: GitHubHttpTransport = {
  async request(request) {
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body });
    const headers: Record<string, string | undefined> = {};
    for (const name of ["retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"]) headers[name] = response.headers.get(name) ?? undefined;
    return { status: response.status, headers, body: await response.text() };
  }
};

export interface InstallationToken {
  token: string;
  expiresAt: string;
  repositories?: string[];
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export function createGitHubAppJwt(appId: string, privateKeyPem: string, nowMs = Date.now()): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // Backdate by 60 seconds for small node clock drift; GitHub permits at most 10 minutes.
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKeyPem).toString("base64url")}`;
}

function retryDelay(response: GitHubHttpResponse, nowMs: number): number | undefined {
  const retryAfter = Number(response.headers?.["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return retryAfter * 1000;
  const reset = Number(response.headers?.["x-ratelimit-reset"]);
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - nowMs);
  return undefined;
}

type GitHubFailure = Exclude<GitHubResult<never>, { ok: true }>;

export function classifyGitHubResponse(response: GitHubHttpResponse, nowMs = Date.now()): GitHubFailure {
  const safe = redactSecrets(response.body).slice(0, 300);
  if (response.status === 401) return { ok: false, code: "AUTH_INVALID", message: `GitHub authentication rejected (${safe})`, retryable: true };
  if (response.status === 404) return { ok: false, code: "REPOSITORY_NOT_INSTALLED", message: "GitHub installation or repository was not found", retryable: false };
  if (response.status === 429 || (response.status === 403 && response.headers?.["x-ratelimit-remaining"] === "0")) {
    return { ok: false, code: "RATE_LIMITED", message: "GitHub rate limit reached", retryable: true, retryAfterMs: retryDelay(response, nowMs) };
  }
  if (response.status === 403) return { ok: false, code: "GUARDIAN_DENIED", message: `GitHub permission denied (${safe})`, retryable: false };
  if (response.status >= 500) return { ok: false, code: "GITHUB_UNAVAILABLE", message: `GitHub unavailable (${response.status})`, retryable: true };
  return { ok: false, code: "UNKNOWN_GITHUB_ERROR", message: `GitHub request failed (${response.status}: ${safe})`, retryable: false };
}

export class GitHubAppAuthProvider {
  private cached?: InstallationToken;

  constructor(
    readonly config: GitHubMachineIdentityConfig,
    private readonly secrets: SecretProvider,
    private readonly transport: GitHubHttpTransport = fetchGitHubHttpTransport,
    private readonly now: () => number = Date.now,
    private readonly apiBase = "https://api.github.com"
  ) {}

  describe() {
    const secret = this.secrets.status(this.config.privateKeyRef);
    return {
      logicalIdentity: BOSS_GITHUB_LOGICAL_IDENTITY,
      enabled: this.config.enabled,
      appIdConfigured: Boolean(this.config.appId),
      installationIdConfigured: Boolean(this.config.installationId),
      privateKeyRef: this.config.privateKeyRef,
      credentialProviderAvailable: secret.available,
      credentialBackend: secret.backend
    };
  }

  invalidate(): void { this.cached = undefined; }

  async getInstallationToken(forceRefresh = false): Promise<GitHubResult<InstallationToken>> {
    if (!this.config.enabled) return { ok: false, code: "AUTH_MISSING", message: "GitHub integration is disabled", retryable: false };
    if (!forceRefresh && this.cached && Date.parse(this.cached.expiresAt) - this.now() > 60_000) return { ok: true, value: this.cached };
    const status = this.secrets.status(this.config.privateKeyRef);
    if (!status.available) return { ok: false, code: "AUTH_MISSING", message: `Private-key reference ${this.config.privateKeyRef} is unavailable`, retryable: false };

    let lease;
    try {
      lease = this.secrets.resolve(this.config.privateKeyRef);
      const jwt = createGitHubAppJwt(this.config.appId, lease.value, this.now());
      const response = await this.transport.request({
        method: "POST",
        url: `${this.apiBase}/app/installations/${this.config.installationId}/access_tokens`,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "content-type": "application/json",
          "user-agent": "codex-boss-github-app"
        },
        body: "{}"
      });
      if (response.status < 200 || response.status >= 300) return classifyGitHubResponse(response, this.now());
      const parsed = JSON.parse(response.body) as { token?: string; expires_at?: string; repositories?: Array<{ full_name?: string }> };
      if (!parsed.token || !parsed.expires_at) return { ok: false, code: "AUTH_INVALID", message: "GitHub returned an invalid installation-token response", retryable: false };
      this.cached = { token: parsed.token, expiresAt: parsed.expires_at, repositories: parsed.repositories?.flatMap((item) => item.full_name ? [item.full_name.toLowerCase()] : []) };
      return { ok: true, value: this.cached };
    } catch (error) {
      const safe = redactSecrets(String(error));
      const code = /key|pem|sign|secret|decoder|openssl/i.test(String(error)) ? "AUTH_INVALID" : "NETWORK_ERROR";
      return { ok: false, code, message: code === "AUTH_INVALID" ? "GitHub App credential is invalid" : `GitHub authentication request failed: ${safe}`, retryable: code !== "AUTH_INVALID" };
    } finally {
      lease?.dispose();
    }
  }
}
