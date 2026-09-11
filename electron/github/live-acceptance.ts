import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import { redactSecrets, scanSecrets } from "../../src/shared/secret-scan";
import { createGitHubMachineRuntime } from "./github-machine-runtime";

type Json = Record<string, unknown>;
const repository = "zhiheng-zhang-Mera/Codex-Boss";
const baseBranch = "feature/github-machine-identity";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const branch = `acceptance/github-machine-identity-${stamp}`;
const dataRoot = path.join(app.isPackaged ? app.getAppPath() : process.cwd(), "runtime-data");
app.setPath("userData", dataRoot);

function requireOk<T>(label: string, result: { ok: true; value: T } | { ok: false; code: string; message: string }): T {
  if (!result.ok) throw new Error(`${label}: ${result.code} ${result.message}`);
  return result.value;
}

function field(object: Json, name: string): string {
  const value = object[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name} in GitHub response`);
  return value;
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

app.whenReady().then(async () => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Platform secure storage is unavailable");
  const runtime = createGitHubMachineRuntime({
    userData: dataRoot,
    crypto: {
      protect: (plainText) => safeStorage.encryptString(plainText).toString("base64"),
      unprotect: (cipherText) => safeStorage.decryptString(Buffer.from(cipherText, "base64"))
    }
  });
  if (!runtime.configured) throw new Error("GitHub machine identity runtime is not configured");
  const selfCheck = await runtime.selfCheck();
  if (!selfCheck.configured || !selfCheck.credentialProviderAvailable || !selfCheck.authenticationHealthy || !selfCheck.installationReachable || !selfCheck.capabilities["github.read"] || !selfCheck.capabilities["github.write"]) {
    throw new Error(`GitHub machine self-check failed: ${selfCheck.error ?? "capability unavailable"}`);
  }
  if (process.argv.includes("--self-check-only")) {
    console.log(`GITHUB_MACHINE_SELF_CHECK=PASS configured=${selfCheck.configured} credentialProviderAvailable=${selfCheck.credentialProviderAvailable} authenticationHealthy=${selfCheck.authenticationHealthy} installationReachable=${selfCheck.installationReachable} github.read=${selfCheck.capabilities["github.read"]} github.write=${selfCheck.capabilities["github.write"]}`);
    app.quit();
    return;
  }

  const repo = requireOk("repository inspect", await runtime.gateway.inspectRepository(repository));
  const base = requireOk("base branch inspect", await runtime.gateway.inspectBranch(repository, baseBranch));
  const baseSha = field(base.object as Json, "sha");
  requireOk("branch creation", await runtime.gateway.createBranch(repository, branch, baseSha));

  const acceptancePath = `docs/acceptance/github-machine-identity-${stamp}.md`;
  const acceptanceText = [
    "# GitHub Machine Identity Live Acceptance",
    "",
    `Timestamp: ${new Date().toISOString()}`,
    "",
    "This harmless file was created through the Codex-Boss GitHub App installation identity.",
    "It changes no repository administration, protection, policy, secret, visibility, or installation scope."
  ].join("\n");
  const commit = requireOk("detached commit creation", await runtime.gateway.createDetachedCommit(repository, {
    parentCommitSha: baseSha,
    path: acceptancePath,
    message: "test(github): record machine identity live acceptance",
    contentBase64: Buffer.from(acceptanceText, "utf8").toString("base64")
  }));
  const commitSha = field(commit, "sha");
  requireOk("non-force push", await runtime.gateway.push(repository, branch, commitSha));
  const pr = requireOk("pull request creation", await runtime.gateway.createPullRequest(repository, {
    head: branch,
    base: baseBranch,
    title: "test(github): machine identity live acceptance",
    body: "Harmless live acceptance performed through the Codex-Boss GitHub App machine identity. No administrative settings are changed."
  }));
  const prNumber = Number(pr.number);
  if (!Number.isInteger(prNumber)) throw new Error("GitHub PR response did not include a number");
  const inspectedPr = requireOk("pull request inspect", await runtime.gateway.inspectPullRequest(repository, prNumber));
  requireOk("status inspect", await runtime.gateway.inspectStatus(repository, commitSha));

  let workflow: Json | undefined;
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const runs = requireOk("workflow status inspect", await runtime.gateway.inspectWorkflowRuns(repository, branch));
    const candidates = Array.isArray(runs.workflow_runs) ? runs.workflow_runs as Json[] : [];
    workflow = candidates.find((run) => (run.head_sha === commitSha || run.head_branch === branch));
    if (workflow && workflow.status === "completed") break;
    await sleep(10_000);
  }
  if (!workflow) throw new Error("No pull-request workflow run was observed before timeout");
  if (workflow.status !== "completed") throw new Error("Pull-request workflow did not reach a terminal state before timeout");

  const user = inspectedPr.user as Json | undefined;
  const identity = user && typeof user.login === "string" ? user.login : "unknown";
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    logicalIdentity: runtime.auth.describe().logicalIdentity,
    actualGitHubIdentity: identity,
    appId: runtime.auth.config.appId,
    installationId: runtime.auth.config.installationId,
    repository: repo.full_name,
    baseBranch,
    branch,
    commitSha,
    pullRequest: { number: prNumber, url: inspectedPr.html_url },
    workflow: { id: workflow.id, url: workflow.html_url, status: workflow.status, conclusion: workflow.conclusion },
    selfCheck,
    operations: {
      repositoryRead: true, branchCreation: true, detachedCommitCreation: true,
      nonForcePush: true, pullRequestCreation: true, pullRequestInspection: true,
      statusInspection: true, workflowInspection: true
    },
    guardianBoundary: "UNCHANGED",
    finalState: workflow.conclusion === "success" ? "REAL_CREDENTIAL_ACCEPTANCE_PASS" : "REAL_CREDENTIAL_ACCEPTANCE_PENDING"
  };
  const serialized = JSON.stringify(report, null, 2);
  if (scanSecrets(serialized).length) throw new Error("Sanitized acceptance report failed the credential leakage gate");
  const output = path.join(dataRoot, ".boss", "github-machine-live-acceptance.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, "utf8");
  console.log(`GITHUB_MACHINE_LIVE_ACCEPTANCE=${report.finalState} identity=${identity} branch=${branch} commit=${commitSha} pr=${String(inspectedPr.html_url)} ci=${String(workflow.conclusion)}`);
  app.quit();
}).catch((error) => {
  console.error(`GITHUB_MACHINE_LIVE_ACCEPTANCE=FAIL ${redactSecrets(String(error))}`);
  app.exit(1);
});
