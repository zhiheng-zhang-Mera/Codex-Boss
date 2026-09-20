import { runGit, GIT_MAX_BUFFER_BYTES } from "../git/git-gateway";
import type { BossGitHubCredentialProvider, AutomationCredential } from "../credential-boundary/github-credential-provider";
import { REQUIRED_PROMOTION_CHECKS, REQUIRED_PROMOTION_CHECKS_SOURCE } from "../../src/shared/promotion-checks";

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

interface GitHubTransportResponse {
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

type AdapterResult<T> =
  | { status: "OK"; value: T }
  | { status: "BLOCKED_EXTERNAL"; reason: string; requiredExternalAction: string }
  | { status: "FAILED"; reason: string; httpStatus?: number; pending?: string[]; missing?: string[]; notSuccessful?: string[]; foreignSha?: string[] };

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

interface GitHubPromotionAdapterOptions {
  /** `owner/name`. */
  repository: string;
  /** Protected base branch. Never a push target. */
  baseBranch?: string;
  credentialProvider: BossGitHubCredentialProvider;
  transport?: GitHubTransport;
  /** REST base. Overridable so tests can point at a local stub. */
  apiBase?: string;
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

  constructor(options: GitHubPromotionAdapterOptions) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) throw new Error(`invalid repository slug: ${options.repository}`);
    this.repository = options.repository;
    this.baseBranch = options.baseBranch ?? "main";
    this.provider = options.credentialProvider;
    this.transport = options.transport ?? fetchGitHubTransport;
    this.apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
  }

  /** Non-secret status for evidence and the Owner dashboard. */
  describe(): {
    repository: string;
    baseBranch: string;
    credential: ReturnType<BossGitHubCredentialProvider["describe"]>;
    requiredChecks: readonly string[];
    requiredChecksSource: string;
  } {
    return {
      repository: this.repository,
      baseBranch: this.baseBranch,
      credential: this.provider.describe(),
      requiredChecks: REQUIRED_PROMOTION_CHECKS,
      requiredChecksSource: REQUIRED_PROMOTION_CHECKS_SOURCE
    };
  }

  /**
   * Resolves the credential. An App-backed provider can only answer asynchronously — an installation token is
   * minted by an HTTP call, not read from the environment — so the async answer is preferred when the provider
   * offers one, and the synchronous answer remains the fallback for providers that are genuinely synchronous
   * (the legacy environment provider, and the always-blocked placeholder).
   */
  private async credentialed(): Promise<AdapterResult<CredentialedTransport>> {
    const result = this.provider.getAutomationCredentialAsync
      ? await this.provider.getAutomationCredentialAsync()
      : this.provider.getAutomationCredential();
    if (result.status !== "AVAILABLE") return result;
    return { status: "OK", value: { credential: result.credential, transport: this.transport } };
  }

  private async rest<T>(method: GitHubTransportRequest["method"], path: string, body?: unknown): Promise<AdapterResult<T>> {
    const credentialed = await this.credentialed();
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
    const credentialed = await this.credentialed();
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
    const result = await runGit(
      input.workspace,
      ["push", "--porcelain", `https://github.com/${this.repository}.git`, `${input.sha}:refs/heads/${input.branch}`],
      // 180s: a push is bounded by the network and by how much history is new.
      // The credential still travels only in the environment (rule 2 above).
      { timeoutMs: 180_000, maxBufferBytes: GIT_MAX_BUFFER_BYTES.large, env: environment }
    );
    if (!result.ok) {
      return {
        status: "BLOCKED_EXTERNAL",
        reason: `candidate branch push failed: ${(result.stderr || result.spawnError || "").slice(0, 800)}`,
        requiredExternalAction: "Verify the dedicated Boss identity has contents:write on this repository."
      };
    }
    return { status: "OK", value: { branch: input.branch, sha: input.sha } };
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

  /**
   * Reads EVERY required check for one commit and requires all of them to be `success` on THIS sha.
   *
   * Three failures this deliberately refuses, each of which used to be possible:
   *
   *   - **a subset of CI.** The gate used to read one hard-coded name (`validate`). Reading only `quality`
   *     would be the same mistake with a different string: the candidate is eligible only when the four
   *     contexts the ruleset requires have ALL reported success.
   *   - **a stale check.** A check whose `head_sha` is not this candidate is not evidence for this candidate,
   *     even when it is green (§11.2). The binding is per-check, not just per-request.
   *   - **a pending check treated as a pass.** `conclusion` is null until a run finishes, so `status` is
   *     required to be `completed` before a `success` conclusion is trusted.
   *
   * A failed read names what it saw (`pending`, `missing`, `notSuccessful`, `foreignSha`) so the caller can
   * tell "not reported yet" from "reported and failed" instead of re-parsing a sentence.
   */
  async readRequiredCheck(sha: string): Promise<AdapterResult<{
    name: string;
    conclusion: string | null;
    status: string | null;
    sha: string;
    requiredChecks: readonly string[];
    checks: { name: string; status: string | null; conclusion: string | null; headSha: string | null }[];
    missing: string[];
    notSuccessful: string[];
    foreignSha: string[];
    allRequiredChecksSuccessful: boolean;
  }>> {
    const read = await this.rest<{ check_runs?: { name: string; conclusion: string | null; status: string | null; head_sha: string }[] }>("GET", `/repos/${this.repository}/commits/${sha}/check-runs`);
    if (read.status !== "OK") return read;
    const runs = read.value.check_runs ?? [];

    const missing: string[] = [];
    const notSuccessful: string[] = [];
    const foreignSha: string[] = [];
    /**
     * Required checks that have not reached a terminal conclusion yet — either no run exists, or the newest
     * run is still `queued`/`in_progress`. An unfinished check is an ABSENCE of evidence, not a failing one,
     * and the caller distinguishes the two: a promotion may wait for a pending check, but it must never wait
     * out a check that has already reported a non-`success` conclusion.
     */
    const pending: string[] = [];
    const checks: { name: string; status: string | null; conclusion: string | null; headSha: string | null }[] = [];

    for (const required of REQUIRED_PROMOTION_CHECKS) {
      // The newest run for the name is the one that decides, so a superseded pending run cannot mask a pass.
      const candidates = runs.filter((item) => item.name === required);
      const run = candidates[candidates.length - 1];
      if (!run) {
        missing.push(required);
        pending.push(required);
        checks.push({ name: required, status: null, conclusion: null, headSha: null });
        continue;
      }
      const headSha = run.head_sha ?? null;
      if (headSha && headSha !== sha) foreignSha.push(`${required}@${headSha.slice(0, 12)}`);
      if (run.status !== "completed") pending.push(`${required}=${run.status ?? "unknown"}`);
      else if (run.conclusion !== "success") notSuccessful.push(`${required}=completed/${run.conclusion ?? "none"}`);
      checks.push({ name: required, status: run.status, conclusion: run.conclusion, headSha });
    }

    // Every required check must be present AND finished AND green: `pending` is part of the conjunction, so
    // reporting an unfinished check separately can never turn it into a pass.
    const allRequiredChecksSuccessful = missing.length === 0 && pending.length === 0 && notSuccessful.length === 0 && foreignSha.length === 0;
    if (!allRequiredChecksSuccessful) {
      const reasons = [
        missing.length ? `no run reported for ${missing.join(", ")}` : "",
        pending.length ? `not finished: ${pending.join(", ")}` : "",
        notSuccessful.length ? `not successful: ${notSuccessful.join(", ")}` : "",
        foreignSha.length ? `reported for a different sha: ${foreignSha.join(", ")}` : ""
      ].filter(Boolean).join("; ");
      return { status: "FAILED", reason: `required checks for ${sha.slice(0, 12)} are not all green — ${reasons}`, pending, missing, notSuccessful, foreignSha };
    }
    return {
      status: "OK",
      value: {
        // The aggregate name is honest about being an aggregate: a reader must not mistake it for one check.
        name: REQUIRED_PROMOTION_CHECKS.join("+"),
        conclusion: "success",
        status: "completed",
        sha,
        requiredChecks: REQUIRED_PROMOTION_CHECKS,
        checks,
        missing,
        notSuccessful,
        foreignSha,
        allRequiredChecksSuccessful
      }
    };
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
