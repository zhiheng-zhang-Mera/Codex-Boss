/** Platform-neutral contracts for the Codex-Boss logical GitHub identity. */

export const BOSS_GITHUB_LOGICAL_IDENTITY = "Codex-Boss" as const;

export type GitHubCapability =
  | "git"
  | "github.read"
  | "github.write"
  | "credential.github"
  | "filesystem"
  | "test"
  | "network";

export type GitHubErrorCode =
  | "AUTH_MISSING"
  | "AUTH_INVALID"
  | "AUTH_EXPIRED"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "REPOSITORY_DENIED"
  | "REPOSITORY_NOT_INSTALLED"
  | "GUARDIAN_DENIED"
  | "GITHUB_UNAVAILABLE"
  | "UNKNOWN_GITHUB_ERROR";

export interface GitHubMachineIdentityConfig {
  schemaVersion: 1;
  enabled: boolean;
  logicalIdentity: typeof BOSS_GITHUB_LOGICAL_IDENTITY;
  appId: string;
  installationId: string;
  /** Opaque lookup key only. Secret content is forbidden in configuration. */
  privateKeyRef: string;
  allowedRepositories: string[];
}

export type GitHubResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: GitHubErrorCode;
      message: string;
      retryable: boolean;
      retryAfterMs?: number;
    };

export type GitHubOperation =
  | "repository.inspect"
  | "branch.inspect"
  | "branch.create"
  | "commit.create"
  | "push"
  | "pull_request.create"
  | "pull_request.inspect"
  | "status.inspect"
  | "workflow.inspect"
  | "issue.read"
  | "issue.write"
  | "repository.delete"
  | "repository.visibility.change"
  | "branch.protection.weaken"
  | "ruleset.weaken"
  | "security.policy.weaken"
  | "github_app.permissions.change"
  | "installation.scope.expand"
  | "secrets.modify"
  | "credential.export"
  | "credential.inspect"
  | "deploy_key.modify"
  | "repository.admin.destructive"
  | "self.privilege.escalate"
  | "guardian.bypass"
  | "audit_log.delete";

export interface GitHubAuditRecord {
  at: string;
  logicalIdentity: typeof BOSS_GITHUB_LOGICAL_IDENTITY;
  nodeId: string;
  operation: GitHubOperation;
  repository: string;
  branch?: string;
  guardianDecision: "ALLOW" | "DENY" | "ROOT_OWNER_REQUIRED";
  result: "OK" | GitHubErrorCode;
  latencyMs: number;
  retryCount: number;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SECRET_SHAPE = /-----BEGIN|\bgh[pousr]_|\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

/** Fail closed: the checked-in/runtime config may contain references, never secrets. */
export function validateGitHubMachineIdentityConfig(value: unknown): GitHubMachineIdentityConfig | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Partial<GitHubMachineIdentityConfig>;
  if (config.schemaVersion !== 1 || typeof config.enabled !== "boolean") return null;
  if (config.logicalIdentity !== BOSS_GITHUB_LOGICAL_IDENTITY) return null;
  if (typeof config.appId !== "string" || !/^\d+$/.test(config.appId)) return null;
  if (typeof config.installationId !== "string" || !/^\d+$/.test(config.installationId)) return null;
  if (typeof config.privateKeyRef !== "string" || !/^[A-Za-z0-9._/-]{3,200}$/.test(config.privateKeyRef)) return null;
  if (SECRET_SHAPE.test(config.privateKeyRef)) return null;
  if (!Array.isArray(config.allowedRepositories) || !config.allowedRepositories.length) return null;
  const repositories = config.allowedRepositories.map((item) => String(item).trim().toLowerCase());
  if (repositories.some((item) => !REPOSITORY.test(item))) return null;
  if (new Set(repositories).size !== repositories.length) return null;
  return { ...config, allowedRepositories: repositories } as GitHubMachineIdentityConfig;
}

export function repositoryAllowed(config: GitHubMachineIdentityConfig, repository: string): boolean {
  return config.enabled && config.allowedRepositories.includes(repository.trim().toLowerCase());
}
