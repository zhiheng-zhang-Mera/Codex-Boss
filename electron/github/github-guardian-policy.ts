import type { GitHubOperation } from "../../src/shared/github-machine";

export type GitHubGuardianDecision = "ALLOW" | "DENY" | "ROOT_OWNER_REQUIRED";

const NORMAL_DEVELOPMENT = new Set<GitHubOperation>([
  "repository.inspect", "branch.inspect", "branch.create", "commit.create", "push",
  "pull_request.create", "pull_request.inspect", "status.inspect", "workflow.inspect",
  "issue.read", "issue.write"
]);

const NEVER_AUTONOMOUS = new Set<GitHubOperation>([
  "credential.export", "credential.inspect", "self.privilege.escalate",
  "guardian.bypass", "audit_log.delete"
]);

/** Root Owner > Guardian > Boss. Boss can use authority but cannot enlarge it. */
export function decideGitHubOperation(operation: GitHubOperation): { decision: GitHubGuardianDecision; reason: string } {
  if (NORMAL_DEVELOPMENT.has(operation)) return { decision: "ALLOW", reason: "normal development operation within repository policy" };
  if (NEVER_AUTONOMOUS.has(operation)) return { decision: "DENY", reason: `${operation} is never available to Boss` };
  return { decision: "ROOT_OWNER_REQUIRED", reason: `${operation} requires an out-of-band Root Owner ceremony` };
}
