import {
  BOSS_GITHUB_LOGICAL_IDENTITY,
  repositoryAllowed,
  type GitHubAuditRecord,
  type GitHubMachineIdentityConfig,
  type GitHubOperation,
  type GitHubResult
} from "../../src/shared/github-machine";
import { redactSecrets } from "../../src/shared/secret-scan";
import { decideGitHubOperation } from "./github-guardian-policy";
import { GitHubAppAuthProvider, classifyGitHubResponse, type GitHubHttpRequest, type GitHubHttpTransport } from "./github-app-auth";

export interface GitHubAuditSink { record(record: GitHubAuditRecord): void; }

export interface GitHubGatewayOptions {
  config: GitHubMachineIdentityConfig;
  auth: GitHubAppAuthProvider;
  transport: GitHubHttpTransport;
  nodeId: string;
  audit?: GitHubAuditSink;
  now?: () => number;
  apiBase?: string;
  maxRetries?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

type Json = Record<string, unknown>;

export class GitHubGateway {
  private readonly now: () => number;
  private readonly apiBase: string;
  private readonly maxRetries: number;
  private readonly sleep: (delayMs: number) => Promise<void>;

  constructor(private readonly options: GitHubGatewayOptions) {
    this.now = options.now ?? Date.now;
    this.apiBase = (options.apiBase ?? "https://api.github.com").replace(/\/+$/, "");
    this.maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 3));
    this.sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  private denied<T>(operation: GitHubOperation, repository: string, code: "REPOSITORY_DENIED" | "GUARDIAN_DENIED", message: string): GitHubResult<T> {
    this.audit(operation, repository, undefined, code, 0, 0, code === "GUARDIAN_DENIED" ? decideGitHubOperation(operation).decision : "DENY");
    return { ok: false, code, message, retryable: false };
  }

  private audit(operation: GitHubOperation, repository: string, branch: string | undefined, result: GitHubAuditRecord["result"], started: number, retryCount: number, decision: GitHubAuditRecord["guardianDecision"]): void {
    try {
      this.options.audit?.record({
        at: new Date(this.now()).toISOString(), logicalIdentity: BOSS_GITHUB_LOGICAL_IDENTITY,
        nodeId: this.options.nodeId, operation, repository, branch,
        guardianDecision: decision, result, latencyMs: Math.max(0, this.now() - started), retryCount
      });
    } catch { /* observability failure never takes down the gateway */ }
  }

  private async request<T>(operation: GitHubOperation, repository: string, method: GitHubHttpRequest["method"], path: string, body?: unknown, branch?: string): Promise<GitHubResult<T>> {
    const guardian = decideGitHubOperation(operation);
    if (guardian.decision !== "ALLOW") return this.denied(operation, repository, "GUARDIAN_DENIED", guardian.reason);
    if (!repositoryAllowed(this.options.config, repository)) return this.denied(operation, repository, "REPOSITORY_DENIED", `Repository ${repository} is not in the Boss allowlist`);

    const started = this.now();
    let retryCount = 0;
    let refreshed = false;
    while (true) {
      const auth = await this.options.auth.getInstallationToken(refreshed);
      if (!auth.ok) {
        if (auth.retryable && retryCount < this.maxRetries) {
          await this.sleep(Math.min(auth.retryAfterMs ?? 250 * (2 ** retryCount), 30_000));
          retryCount += 1;
          continue;
        }
        this.audit(operation, repository, branch, auth.code, started, retryCount, guardian.decision);
        return auth;
      }
      // When GitHub returns the installed repository list, it is an independent
      // second boundary in addition to the local allowlist.
      if (auth.value.repositories && !auth.value.repositories.includes(repository.toLowerCase())) {
        const denied: GitHubResult<T> = { ok: false, code: "REPOSITORY_NOT_INSTALLED", message: `Repository ${repository} is not installed for the GitHub App`, retryable: false };
        this.audit(operation, repository, branch, denied.code, started, retryCount, guardian.decision);
        return denied;
      }
      try {
        const response = await this.options.transport.request({
          method, url: `${this.apiBase}${path}`,
          headers: { accept: "application/vnd.github+json", authorization: `Bearer ${auth.value.token}`, "content-type": "application/json", "user-agent": "codex-boss-github-gateway" },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (response.status >= 200 && response.status < 300) {
          const value = response.body ? JSON.parse(response.body) as T : undefined as T;
          this.audit(operation, repository, branch, "OK", started, retryCount, guardian.decision);
          return { ok: true, value };
        }
        let failure = classifyGitHubResponse(response, this.now());
        if (response.status === 401 && !refreshed) { this.options.auth.invalidate(); refreshed = true; retryCount += 1; continue; }
        if (response.status === 401 && refreshed) failure = { ...failure, code: "AUTH_EXPIRED", message: "GitHub installation token remained unauthorized after refresh", retryable: false };
        if (failure.retryable && retryCount < this.maxRetries) {
          await this.sleep(Math.min(failure.retryAfterMs ?? 250 * (2 ** retryCount), 30_000));
          retryCount += 1;
          continue;
        }
        this.audit(operation, repository, branch, failure.code, started, retryCount, guardian.decision);
        return failure;
      } catch (error) {
        const failure: GitHubResult<T> = { ok: false, code: "NETWORK_ERROR", message: `GitHub request failed: ${redactSecrets(String(error))}`, retryable: true };
        if (retryCount < this.maxRetries) { await this.sleep(250 * (2 ** retryCount)); retryCount += 1; continue; }
        this.audit(operation, repository, branch, failure.code, started, retryCount, guardian.decision);
        return failure;
      }
    }
  }

  inspectRepository(repository: string): Promise<GitHubResult<Json>> {
    return this.request("repository.inspect", repository, "GET", `/repos/${repository}`);
  }

  inspectBranch(repository: string, branch: string): Promise<GitHubResult<Json>> {
    return this.request("branch.inspect", repository, "GET", `/repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`, undefined, branch);
  }

  createBranch(repository: string, branch: string, fromSha: string): Promise<GitHubResult<Json>> {
    return this.request("branch.create", repository, "POST", `/repos/${repository}/git/refs`, { ref: `refs/heads/${branch}`, sha: fromSha }, branch);
  }

  createCommit(repository: string, input: { branch: string; path: string; message: string; contentBase64: string; currentBlobSha?: string }): Promise<GitHubResult<Json>> {
    return this.request("commit.create", repository, "PUT", `/repos/${repository}/contents/${input.path.split("/").map(encodeURIComponent).join("/")}`, {
      message: input.message, content: input.contentBase64, branch: input.branch, sha: input.currentBlobSha
    }, input.branch);
  }

  push(repository: string, branch: string, commitSha: string): Promise<GitHubResult<Json>> {
    return this.request("push", repository, "PATCH", `/repos/${repository}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commitSha, force: false }, branch);
  }

  createPullRequest(repository: string, input: { head: string; base: string; title: string; body: string }): Promise<GitHubResult<Json>> {
    return this.request("pull_request.create", repository, "POST", `/repos/${repository}/pulls`, input, input.head);
  }

  inspectPullRequest(repository: string, number: number): Promise<GitHubResult<Json>> {
    return this.request("pull_request.inspect", repository, "GET", `/repos/${repository}/pulls/${number}`);
  }

  inspectStatus(repository: string, sha: string): Promise<GitHubResult<Json>> {
    return this.request("status.inspect", repository, "GET", `/repos/${repository}/commits/${sha}/status`);
  }

  inspectWorkflow(repository: string, runId: number): Promise<GitHubResult<Json>> {
    return this.request("workflow.inspect", repository, "GET", `/repos/${repository}/actions/runs/${runId}`);
  }
}
