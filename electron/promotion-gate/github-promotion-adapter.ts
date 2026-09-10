import { execFile } from "node:child_process";
import type { BossGitHubCredentialProvider, AutomationCredential } from "../credential-boundary/github-credential-provider";

/**
 * GitHub promotion adapter (Update-Plan/Isolation-Finalization.md §9.4, §10,
 * §11.5, §15 FI-04, §14 RT-22/RT-23).
 *
 * Every remote side effect in the evolution path happens here, in host code:
 * pushing a Candidate branch, opening a PR, reading the required check, and
 * merging an ordinary PR. A worker never reaches the network.
 *
 * Authority discipline, in the order it is applied:
 *
 *   1. the credential comes from the dedicated Boss provider. If it is missing,
 *      every method returns BLOCKED_EXTERNAL — there is no Owner fallback, no
 *      ambient `gh` session, no keyring lookup (§9.3, RT-22).
 *   2. the token is passed to git through `GIT_CONFIG_*` environment variables
 *      rather than argv, so it never appears in a process listing, and is never
 *      written to a credential file.
 *   3. REST calls go through a URL guard that refuses repository administration,
 *      rulesets, secrets, protections and ref deletion outright (§9.4). A
 *      "merge" here is an ordinary merge: `--admin` is never available.
 *   4. the protected base branch is never a push target (§4 DENY).
 */

export interface GitHubTransportRequest {
  method: "GET" | "POST" | "PUT" | "PATCH";
  url: string;
  token: string;
  body?: unknown;
}

export interface GitHubTransportResponse {
  status: number;
  body: string;
}

export interface GitHubTransport {
  request(request: GitHubTransportRequest): Promise<GitHubTransportResponse>;
}

/** Default transport. Uses global fetch (Node 18+) with no ambient auth. */
export const fetchGitHubTransport: GitHubTransport = {
  async request({ method, url, token, body }) {
    const doFetch = (globalThis as unknown as {
      fetch: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
    }).fetch;
    if (typeof doFetch !== "function") throw new Error("no fetch implementation is available in this runtime");
    const response = await doFetch(url, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "user-agent": "codex-boss-promotion-adapter"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.text() };
  }
};

export type AdapterResult<T> =
  | { status: "OK"; value: T }
  | { status: "BLOCKED_EXTERNAL"; reason: string; requiredExternalAction: string }
  | { status: "FAILED"; reason: string; httpStatus?: number };

/** URLs the adapter may never call, whatever the caller asks for (§9.4). */
const FORBIDDEN_API_PATTERNS: readonly RegExp[] = [
  /\/rulesets?(?:\/|$)/i,
  /\/branches\/[^/]+\/protection/i,
  /\/actions\/secrets(?:\/|$)/i,
  /\/actions\/permissions(?:\/|$)/i,
  /\/actions\/variables(?:\/|$)/i,
  /\/collaborators(?:\/|$)/i,
  /\/teams(?:\/|$)/i,
  /\/installations(?:\/|$)/i,
  /\/organizations\/[^/]+\/(?:settings|installations)/i,
  /\/hooks(?:\/|$)/i,
  /\/keys(?:\/|$)/i,
  /\/automation\/permissions/i
];

/** True when a URL is a repository-administration endpoint (DENY, never used). */
export function isForbiddenApiUrl(url: string): boolean {
  const pathOnly = url.replace(/^https?:\/\/[^/]+/i, "");
  return FORBIDDEN_API_PATTERNS.some((pattern) => pattern.test(pathOnly));
}

export interface GitHubPromotionAdapterOptions {
  /** `owner/name`. */
  repository: string;
  /** Protected base branch. Never a push target. */
  baseBranch?: string;
  credentialProvider: BossGitHubCredentialProvider;
  transport?: GitHubTransport;
  /** REST base. Overridable so tests can point at a local stub. */
  apiBase?: string;
  /** Pull-request state to treat as mergeable. */
  requiredCheckName?: string;
}

interface CredentialedTransport {
  credential: AutomationCredential;
  transport: GitHubTransport;
}

export class GitHubPromotionAdapter {
  readonly repository: string;
  readonly baseBranch: string;
  private readonly provider: BossGitHubCredentialProvider;
  private readonly transport: GitHubTransport;
  private readonly apiBase: string;
  private readonly requiredCheckName: string;

  constructor(options: GitHubPromotionAdapterOptions) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) throw new Error(`invalid repository slug: ${options.repository}`);
    this.repository = options.repository;
    this.baseBranch = options.baseBranch ?? "main";
    this.provider = options.credentialProvider;
    this.transport = options.transport ?? fetchGitHubTransport;
    this.apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
    this.requiredCheckName = options.requiredCheckName ?? "validate";
  }

  /** Non-secret status for evidence and the Owner dashboard. */
  describe(): { repository: string; baseBranch: string; credential: ReturnType<BossGitHubCredentialProvider["describe"]> } {
    return { repository: this.repository, baseBranch: this.baseBranch, credential: this.provider.describe() };
  }

  private credentialed(): AdapterResult<CredentialedTransport> {
    const result = this.provider.getAutomationCredential();
    if (result.status !== "AVAILABLE") return result;
    return { status: "OK", value: { credential: result.credential, transport: this.transport } };
  }

  private async rest<T>(method: GitHubTransportRequest["method"], path: string, body?: unknown): Promise<AdapterResult<T>> {
    const credentialed = this.credentialed();
    if (credentialed.status !== "OK") return credentialed;
    const url = `${this.apiBase}${path}`;
    if (isForbiddenApiUrl(url)) {
      return { status: "FAILED", reason: `repository administration endpoint is not available to the promotion adapter: ${path}` };
    }
    try {
      const response = await credentialed.value.transport.request({ method, url, token: credentialed.value.credential.token, body });
      if (response.status >= 200 && response.status < 300) {
        let parsed: unknown = undefined;
        if (response.body) {
          try {
            parsed = JSON.parse(response.body);
          } catch {
            parsed = undefined;
          }
        }
        return { status: "OK", value: parsed as T };
      }
      return { status: "FAILED", reason: `GitHub ${method} ${path} returned ${response.status}: ${response.body.slice(0, 400)}`, httpStatus: response.status };
    } catch (error) {
      // Network failure is an external condition, not a gate result (FI-04).
      return { status: "BLOCKED_EXTERNAL", reason: `GitHub request failed: ${String(error)}`, requiredExternalAction: "Restore network access to the GitHub API, then retry promotion." };
    }
  }

  /**
   * Pushes the Candidate branch. The token is supplied through `GIT_CONFIG_*`
   * environment variables, never argv and never a credentials file.
   */
  async pushCandidateBranch(input: { workspace: string; branch: string; sha: string }): Promise<AdapterResult<{ branch: string; sha: string }>> {
    const credentialed = this.credentialed();
    if (credentialed.status !== "OK") return credentialed;
    if (input.branch === this.baseBranch) {
      return { status: "FAILED", reason: `refusing to push the protected base branch ${this.baseBranch} directly` };
    }
    const basic = Buffer.from(`${credentialed.value.credential.identity}:${credentialed.value.credential.token}`, "utf8").toString("base64");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
      GIT_TERMINAL_PROMPT: "0"
    };
    return new Promise((resolve) => {
      execFile(
        "git",
        ["push", "--porcelain", `https://github.com/${this.repository}.git`, `${input.sha}:refs/heads/${input.branch}`],
        { cwd: input.workspace, windowsHide: true, timeout: 180000, maxBuffer: 8 * 1024 * 1024, env: environment },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ status: "BLOCKED_EXTERNAL", reason: `candidate branch push failed: ${String(stderr || error.message).slice(0, 800)}`, requiredExternalAction: "Verify the dedicated Boss identity has contents:write on this repository." });
            return;
          }
          resolve({ status: "OK", value: { branch: input.branch, sha: input.sha } });
        }
      );
    });
  }

  /** Opens a pull request against the protected base branch. */
  async createPullRequest(input: { head: string; title: string; body: string }): Promise<AdapterResult<{ number: number; headSha: string }>> {
    const created = await this.rest<{ number: number; head?: { sha?: string } }>("POST", `/repos/${this.repository}/pulls`, {
      title: input.title,
      body: input.body,
      head: input.head,
      base: this.baseBranch
    });
    if (created.status !== "OK") return created;
    return { status: "OK", value: { number: created.value.number, headSha: created.value.head?.sha ?? "" } };
  }

  /** Reads a pull request's current head SHA — the source of `prHeadSha`. */
  async readPullRequest(prNumber: number): Promise<AdapterResult<{ number: number; headSha: string; state: string; mergeableState?: string }>> {
    const read = await this.rest<{ number: number; state: string; head?: { sha?: string }; mergeable_state?: string }>("GET", `/repos/${this.repository}/pulls/${prNumber}`);
    if (read.status !== "OK") return read;
    return { status: "OK", value: { number: read.value.number, headSha: read.value.head?.sha ?? "", state: read.value.state, mergeableState: read.value.mergeable_state } };
  }

  /** Reads the required check conclusion for one commit (the `validate` gate). */
  async readRequiredCheck(sha: string): Promise<AdapterResult<{ name: string; conclusion: string | null; status: string | null }>> {
    const read = await this.rest<{ check_runs?: { name: string; conclusion: string | null; status: string | null; head_sha: string }[] }>("GET", `/repos/${this.repository}/commits/${sha}/check-runs`);
    if (read.status !== "OK") return read;
    const run = (read.value.check_runs ?? []).find((item) => item.name === this.requiredCheckName);
    if (!run) return { status: "FAILED", reason: `required check ${this.requiredCheckName} has not reported for ${sha.slice(0, 12)}` };
    // A check reported for a different SHA is not evidence for this SHA (§11.2).
    if (run.head_sha && run.head_sha !== sha) return { status: "FAILED", reason: `check ${this.requiredCheckName} reported for ${run.head_sha.slice(0, 12)}, not ${sha.slice(0, 12)}` };
    return { status: "OK", value: { name: run.name, conclusion: run.conclusion, status: run.status } };
  }

  /**
   * Ordinary merge only. There is no `--admin`, no bypass actor and no
   * `required_approvals` manipulation: this adapter cannot override the
   * repository ruleset, by construction (§11.5).
   */
  async mergePullRequest(input: { prNumber: number; sha: string; method?: "merge" | "squash" | "rebase"; commitTitle?: string }): Promise<AdapterResult<{ merged: boolean; sha: string }>> {
    const merged = await this.rest<{ merged: boolean; sha: string }>("PUT", `/repos/${this.repository}/pulls/${input.prNumber}/merge`, {
      sha: input.sha,
      merge_method: input.method ?? "squash",
      commit_title: input.commitTitle
    });
    if (merged.status !== "OK") return merged;
    return { status: "OK", value: { merged: Boolean(merged.value.merged), sha: merged.value.sha } };
  }

  /** Reads a branch tip (used to prove a base branch was not moved). */
  async readBranchSha(branch: string): Promise<AdapterResult<{ sha: string }>> {
    const read = await this.rest<{ object?: { sha?: string } }>("GET", `/repos/${this.repository}/git/ref/heads/${branch}`);
    if (read.status !== "OK") return read;
    return { status: "OK", value: { sha: read.value.object?.sha ?? "" } };
  }
}
