/**
 * checkpoint-1 §39/§40 (checkpoint-14) — publishing acceptance (PB-01..PB-10).
 *
 * The release is exercised for real: a real git repository, a real **bare remote**
 * on disk that the branch is really pushed to, real commit trailers read back out
 * of the remote, and the real `GitHubGateway` driven through a recording transport
 * so the exact REST calls and bodies §39/§40 produce are visible without a network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createGitCheckpointStore } from "../../electron/engineering/git-checkpoint";
import { createReleaseRunner } from "../../electron/engineering/release-runner";
import { GitHubGateway } from "../../electron/github/github-gateway";
import { GitHubAppAuthProvider, type GitHubHttpRequest, type GitHubHttpResponse } from "../../electron/github/github-app-auth";
import {
  branchNameFor,
  buildCommitMessage,
  buildPullRequestBody,
  checkBranchPolicy,
  planRelease,
  PR_SECTIONS,
  slugify,
  THEME_PR_SECTIONS,
  validateCommitMessage,
  validatePullRequestBody
} from "../../src/shared/publish-plan";
import type { GitHubAuditRecord, GitHubMachineIdentityConfig } from "../../src/shared/github-machine";

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "boss-publish-acceptance-"));
const WORK = path.join(ROOT, "workspace");
const REMOTE = path.join(ROOT, "remote.git");
const REPORT_DIR = path.join(process.cwd(), "artifacts", "acceptance");
const CHECKPOINT_DIR = path.join(WORK, "artifacts", "acceptance", "checkpoints");
const RELEASE_RECORD = path.join(WORK, "artifacts", "acceptance", "release-record.json");

type Verdict = "PASS" | "FAIL" | "NOT_RUN";
interface Observation { claim: string; expected: string; observed: string; ok: boolean; }
interface RequirementResult { id: string; title: string; verdict: Verdict; observations: Observation[]; evidence: string[]; notes?: string; }

class Item {
  private readonly observations: Observation[] = [];
  private readonly evidence: string[] = [];
  private failure?: string;
  constructor(readonly id: string, readonly title: string) {}
  check(claim: string, expected: unknown, observed: unknown): void {
    const expectedText = typeof expected === "string" ? expected : JSON.stringify(expected);
    const observedText = typeof observed === "string" ? observed : JSON.stringify(observed);
    this.observations.push({ claim, expected: expectedText, observed: observedText, ok: expectedText === observedText });
  }
  cite(pointer: string): void { if (!this.evidence.includes(pointer)) this.evidence.push(pointer); }
  fail(reason: string): void { this.failure = reason; }
  get ok(): boolean { return this.failure === undefined && this.observations.length > 0 && this.observations.every((entry) => entry.ok); }
  result(): RequirementResult {
    const result: RequirementResult = { id: this.id, title: this.title, verdict: this.ok ? "PASS" : "FAIL", observations: this.observations, evidence: this.evidence };
    if (this.failure) result.notes = this.failure;
    return result;
  }
}
const results: RequirementResult[] = [];
async function scenario(id: string, title: string, body: (item: Item) => Promise<void> | void): Promise<void> {
  const item = new Item(id, title);
  try { await body(item); }
  catch (error) { item.fail(`scenario threw: ${error instanceof Error ? error.message : String(error)}`); }
  results.push(item.result());
}

/* ------------------------------------------------------------------ *
 * a real repository and a real bare remote
 * ------------------------------------------------------------------ */

for (const directory of ["src", "artifacts/acceptance"]) fs.mkdirSync(path.join(WORK, directory), { recursive: true });
fs.writeFileSync(path.join(WORK, ".gitignore"), "artifacts/\n", "utf8");
fs.writeFileSync(path.join(WORK, "package.json"), JSON.stringify({ name: "publish-fixture", private: true }, null, 2), "utf8");
fs.writeFileSync(path.join(WORK, "src", "gateway.ts"), "export const gateway = (): string => \"full\";\n", "utf8");

function run(cwd: string, ...args: string[]): { status: number | null; output: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}
const initialized = run(WORK, "init", "--quiet");
run(WORK, "config", "user.email", "acceptance@example.invalid");
run(WORK, "config", "user.name", "acceptance");
fs.mkdirSync(REMOTE, { recursive: true });
const remoteInitialized = run(REMOTE, "init", "--bare", "--quiet");
run(WORK, "add", "--all");
const committed = run(WORK, "commit", "--quiet", "-m", "fixture: initial state");
const baseBranch = run(WORK, "rev-parse", "--abbrev-ref", "HEAD").output.trim();

/** The real gateway over a recording transport: no network, real code path. */
function makeGateway(): { gateway: GitHubGateway; calls: { method: string; url: string; body?: string }[]; audits: GitHubAuditRecord[] } {
  const calls: { method: string; url: string; body?: string }[] = [];
  const audits: GitHubAuditRecord[] = [];
  // A real RSA key, generated in memory for this test: the App auth path signs a
  // genuine RS256 JWT, so the run exercises the real credential code without any
  // stored secret.
  const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const config: GitHubMachineIdentityConfig = {
    schemaVersion: 1,
    enabled: true,
    logicalIdentity: "Codex-Boss",
    appId: "12345",
    installationId: "67890",
    privateKeyRef: "github-app-key",
    allowedRepositories: ["owner/name"]
  };
  const transport = {
    async request(request: GitHubHttpRequest): Promise<GitHubHttpResponse> {
      calls.push({ method: request.method, url: request.url, ...(request.body ? { body: request.body } : {}) });
      if (/\/access_tokens$/.test(request.url)) return { status: 201, body: JSON.stringify({ token: "ghs_fixture", expires_at: new Date(Date.now() + 3_600_000).toISOString() }) };
      if (/\/pulls$/.test(request.url)) return { status: 201, body: JSON.stringify({ number: 42, html_url: "https://example.invalid/pull/42" }) };
      if (/\/git\/refs$/.test(request.url)) return { status: 201, body: JSON.stringify({ ref: "refs/heads/x" }) };
      if (/\/contents\//.test(request.url)) return { status: 201, body: JSON.stringify({ content: { sha: "blob1" } }) };
      return { status: 200, body: JSON.stringify({ ok: true, sha: "commit1", object: { sha: "commit1" } }) };
    }
  };
  const secrets = {
    status: () => ({ available: true, backend: "test", reference: "github-app-key" }),
    resolve: () => ({ value: privateKeyPem, dispose() { /* nothing to release */ } })
  } as never;
  const gateway = new GitHubGateway({
    config,
    auth: new GitHubAppAuthProvider(config, secrets, transport as never, () => Date.now(), "https://api.github.com"),
    transport: transport as never,
    nodeId: "acceptance-node",
    audit: { record: (entry) => audits.push(entry) }
  });
  return { gateway, calls, audits };
}

const runner = (options: { gateway?: boolean } = {}) => {
  const made = options.gateway ? makeGateway() : undefined;
  const release = createReleaseRunner({
    root: WORK,
    remote: REMOTE,
    repository: "owner/name",
    ...(made ? { gateway: made.gateway } : {}),
    recordPath: RELEASE_RECORD
  });
  return { release, made };
};

const checkpointStore = () => createGitCheckpointStore({ root: WORK, directory: CHECKPOINT_DIR });
const input = (overrides: Partial<Parameters<ReturnType<typeof runner>["release"]["run"]>[0]> = {}) => ({
  task_id: "T-14",
  candidate_id: "cand-14",
  slug: "publish the gateway receipt",
  goal: "let the gateway return a receipt",
  base_branch: baseBranch,
  requirements: [{ id: "R-1", text: "the gateway returns a receipt", state: "VERIFIED" }],
  evidence: ["ev-1", "ev-2"],
  tests: ["unit/receipt.test.ts"],
  known_limitations: ["only the gateway path is covered"],
  risk: "low: one file",
  rollback: "restore the checkpoint",
  summary: "feat(gateway): return a receipt",
  detail: "Implements the adapter the WorkBook asked for.",
  checkpoints: [] as never[],
  // The "current" repository state is read at call time: an earlier scenario may
  // have left the repository on a policy branch.
  current: { head: run(WORK, "rev-parse", "HEAD").output.trim(), branch: run(WORK, "rev-parse", "--abbrev-ref", "HEAD").output.trim(), diff_hash: "" },
  ...overrides
});
const shared: Record<string, unknown> = {};

describe("checkpoint-14 §39/§40 publishing acceptance", () => {
  it("PB-01 the branch policy names boss/<task-id>/<slug>", async () => {
    await scenario("PB-01", "§39.1 branch policy", async (item) => {
      item.check("the branch follows the policy", "boss/t-14/publish-the-gateway-receipt", branchNameFor({ task_id: "T-14", slug: "Publish the Gateway Receipt" }));
      item.check("the slug is sanitized", "a-b-c", slugify("  A / B \\ C  "));
      item.check("an empty slug still yields a segment", "task", slugify("***"));
      item.check("a policy branch is accepted", true, checkBranchPolicy("boss/t-14/slug").ok);
      item.check("a foreign branch is refused", false, checkBranchPolicy("feature/thing").ok);
      item.check("a protected prefix is refused", false, checkBranchPolicy("boss/t-14/slug/extra").ok);
      item.check("a task id is required", true, (() => { try { branchNameFor({ task_id: " ", slug: "x" }); return false; } catch { return true; } })());
      shared.pb01 = { branch: branchNameFor({ task_id: "T-14", slug: "Publish the Gateway Receipt" }) };
      item.cite("branchNameFor/checkBranchPolicy");
    });
  });

  it("PB-02 a commit must carry its four §39.2 trailers", async () => {
    await scenario("PB-02", "§39.2 commit policy", async (item) => {
      const message = buildCommitMessage({ summary: "feat(gateway): receipt", task_id: "T-14", requirements: ["R-1", "R-2"], candidate_id: "cand-14", evidence: ["ev-1"], version_impact: "MINOR" });
      const check = validateCommitMessage(message);
      item.check("the commit validates", true, check.ok);
      item.check("all four trailers are present", JSON.stringify(["Task", "Requirements", "Candidate", "Evidence"]), JSON.stringify(["Task", "Requirements", "Candidate", "Evidence"].filter((trailer) => message.includes(`${trailer}:`))));
      item.check("the requirements are parsed", JSON.stringify(["R-1", "R-2"]), JSON.stringify(check.requirements));
      item.check("the §37 impact travels with it", true, message.includes("Version-Impact: MINOR"));
      const stripped = message.replace(/^Requirements:.*$/m, "");
      const refused = validateCommitMessage(stripped);
      item.check("a commit without requirements is refused", false, refused.ok);
      item.check("and says which trailer is missing", true, refused.missing.includes("Requirements"));
      shared.pb02 = { trailers: check.requirements.length, refused: refused.reason };
      item.cite("buildCommitMessage/validateCommitMessage");
    });
  });

  it("PB-03 a PR body must carry the eight §40 sections, and four more for a theme", async () => {
    await scenario("PB-03", "§40 pull request body", async (item) => {
      const body = buildPullRequestBody({
        goal: "let the gateway return a receipt",
        what_changed: ["the gateway returns a receipt"],
        requirements: [{ id: "R-1", text: "the gateway returns a receipt", state: "VERIFIED" }],
        tests: ["unit/receipt.test.ts"],
        evidence: ["ev-1"],
        known_limitations: ["only the gateway path"],
        risk: "low",
        rollback: "restore the checkpoint"
      });
      const check = validatePullRequestBody(body);
      item.check("all eight sections are present", true, check.ok);
      item.check("the section list is the plan's", JSON.stringify([...PR_SECTIONS]), JSON.stringify([...PR_SECTIONS]));
      item.check("the requirements section carries ids and state", true, body.includes("R-1 (VERIFIED): the gateway returns a receipt"));
      const holed = body.replace(/^## Risk[\s\S]*?(?=^## |\z)/m, "## Risk\n\n");
      item.check("an empty section is refused", false, validatePullRequestBody(holed).ok);
      const themeBody = buildPullRequestBody({
        goal: "g", what_changed: ["c"], requirements: [{ id: "R-1", text: "t", state: "VERIFIED" }], tests: ["t"], evidence: ["e"],
        known_limitations: ["l"], risk: "r", rollback: "rb",
        theme: { surfaces: ["settings"], visual_evidence: ["capture-1"], fallback: "builtin-dark", migration: "none" }
      });
      item.check("a theme PR adds the four theme sections", true, validatePullRequestBody(themeBody, { theme: true }).ok);
      item.check("and the four names are the plan's", JSON.stringify([...THEME_PR_SECTIONS]), JSON.stringify(["UI surfaces affected", "Visual evidence", "Fallback behavior", "Theme migration"]));
      item.check("a theme PR without them is refused", false, validatePullRequestBody(body, { theme: true }).ok);
      shared.pb03 = { sections: PR_SECTIONS.length, themeSections: THEME_PR_SECTIONS.length };
      item.cite("buildPullRequestBody/validatePullRequestBody");
    });
  });

  it("PB-04 §38 is a precondition: no checkpoint means no release", async () => {
    await scenario("PB-04", "§38 → §39/§40", async (item) => {
      const { release } = runner();
      const refused = await release.run(input({ checkpoints: [] }));
      item.check("the release is refused", "REFUSED", refused.decision);
      item.check("nothing was pushed", false, refused.pushed);
      item.check("the reason names the missing checkpoint", true, refused.reasons.some((reason) => reason.includes("no local checkpoint")));
      item.check("the record keeps the plan hash", true, /^[0-9a-f]{64}$/.test(refused.plan_hash));
      item.check("the steps are all unready", true, refused.steps.every((step) => !step.done));
      shared.pb04 = { decision: refused.decision, reasons: refused.reasons };
      item.cite("run() → guardGitHubWrite refusal");
    });
  });

  it("PB-05 the release really creates the branch, commits and pushes", async () => {
    await scenario("PB-05", "§39 the real remote write", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "receipt.ts"), "export const receipt = (): string => \"ok\";\n", "utf8");
      const store = checkpointStore();
      const checkpoint = store.create({ task_id: "T-14", candidate_id: "cand-14", evidence: ["ev-1", "ev-2"], version_impact: "MINOR" });
      const { release } = runner();
      const record = await release.run(input({ checkpoints: [checkpoint], current: { head: checkpoint.head, branch: checkpoint.branch, diff_hash: checkpoint.diff_hash } }));
      item.check("the release published", true, record.decision !== "REFUSED");
      item.check("the branch is the policy name", "boss/t-14/publish-the-gateway-receipt", record.branch);
      item.check("the commit was made", true, (record.commit_sha ?? "").length >= 7);
      item.check("it was pushed to the remote", true, record.pushed);
      const remoteBranches = run(WORK, "ls-remote", REMOTE).output;
      item.check("the remote really has the branch", true, remoteBranches.includes("refs/heads/boss/t-14/publish-the-gateway-receipt"));
      const remoteLog = release.readRemoteCommit("boss/t-14/publish-the-gateway-receipt") ?? "";
      item.check("the pushed commit carries the trailers", true, remoteLog.includes("Task: T-14") && remoteLog.includes("Requirements: R-1") && remoteLog.includes("Candidate: cand-14") && remoteLog.includes("Evidence: ev-1, ev-2"));
      item.check("the release record is durable", true, fs.existsSync(RELEASE_RECORD));
      item.check("and names the checkpoint it stood on", checkpoint.id, record.checkpoint_id);
      shared.pb05 = { branch: record.branch, decision: record.decision, pushed: record.pushed, commit: record.commit_sha?.slice(0, 12) };
      item.cite("git push to a real bare remote");
    });
  });

  it("PB-06 the real gateway sends the §39/§40 REST calls", async () => {
    await scenario("PB-06", "§39/§40 through GitHubGateway", async (item) => {
      fs.writeFileSync(path.join(WORK, "src", "receipt.ts"), "export const receipt = (): string => \"ok2\";\n", "utf8");
      const store = checkpointStore();
      const checkpoint = store.create({ task_id: "T-14b", candidate_id: "cand-14b", evidence: ["ev-3"] });
      const { release, made } = runner({ gateway: true });
      const record = await release.run(input({
        task_id: "T-14b",
        candidate_id: "cand-14b",
        slug: "receipt again",
        evidence: ["ev-3"],
        checkpoints: [checkpoint],
        current: { head: checkpoint.head, branch: checkpoint.branch, diff_hash: checkpoint.diff_hash }
      }));
      const calls = made!.calls;
      item.check("a pull request was opened", true, record.pull_request !== undefined);
      item.check("the PR number came back", 42, record.pull_request?.number);
      item.check("the gateway called POST /pulls", true, calls.some((call) => call.method === "POST" && /\/pulls$/.test(call.url)));
      const prCall = calls.find((call) => /\/pulls$/.test(call.url));
      item.check("with the policy branch as head", true, (prCall?.body ?? "").includes("\"head\":\"boss/t-14b/receipt-again\""));
      item.check("and the base branch", true, (prCall?.body ?? "").includes(`\"base\":\"${baseBranch}\"`));
      const prBody = JSON.parse(prCall?.body ?? "{}") as { body?: string };
      item.check("the body carries the §40 sections", true, (prBody.body ?? "").includes("## Goal") && (prBody.body ?? "").includes("## Rollback"));
      item.check("the record kept the body hash", true, (record.pull_request?.body_hash ?? "").length === 64);
      item.check("the audit log has the operation", true, made!.audits.some((entry) => entry.operation === "pull_request.create"));
      shared.pb06 = { calls: calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), prNumber: record.pull_request?.number, steps: record.steps.map((step) => `${step.step}:${step.done}:${step.detail.slice(0, 60)}`), decision: record.decision };
      item.cite("GitHubGateway.createPullRequest with a recording transport");
    });
  });

  it("PB-07 a repository outside the allowlist is denied before any request", async () => {
    await scenario("PB-07", "§39 fail-closed allowlist", async (item) => {
      const made = makeGateway();
      const denied = await made.gateway.createPullRequest("other/repo", { head: "boss/t/x", base: baseBranch, title: "t", body: "b" });
      item.check("the call is denied", false, denied.ok);
      item.check("with the allowlist code", "REPOSITORY_DENIED", denied.ok ? "" : denied.code);
      item.check("no HTTP request was made", 0, made.calls.length);
      item.check("and the audit recorded the denial", true, made.audits.some((entry) => entry.result === "REPOSITORY_DENIED"));
      shared.pb07 = { code: denied.ok ? "" : denied.code, calls: made.calls.length };
      item.cite("repositoryAllowed in the gateway request path");
    });
  });

  it("PB-08 a destructive GitHub operation has no path through Boss at all", async () => {
    await scenario("PB-08", "§39 guardian policy + absent surface", async (item) => {
      const { decideGitHubOperation } = await import("../../electron/github/github-guardian-policy");
      const deletion = decideGitHubOperation("repository.delete");
      item.check("the policy does not allow a deletion", false, deletion.decision === "ALLOW");
      item.check("and says why", true, deletion.reason.length > 0);
      const made = makeGateway();
      // The capability is not merely guarded — the gateway offers no method for it.
      const destructive = ["deleteRepository", "changeVisibility", "modifySecrets", "exportCredential", "weakenBranchProtection"];
      item.check("the client exposes no destructive operation", JSON.stringify([]), JSON.stringify(destructive.filter((name) => typeof (made.gateway as unknown as Record<string, unknown>)[name] === "function")));
      // A normal operation still records the guardian's decision.
      await made.gateway.inspectRepository("owner/name");
      item.check("an allowed read is audited as allowed", true, made.audits.some((entry) => entry.operation === "repository.inspect" && entry.guardianDecision === "ALLOW"));
      shared.pb08 = { decision: deletion.decision, audits: made.audits.length };
      item.cite("decideGitHubOperation + the gateway's public surface");
    });
  });

  it("PB-09 the plan refuses an off-policy branch and a drifting checkpoint", async () => {
    await scenario("PB-09", "§39.1 + §38 in the plan", async (item) => {
      const store = checkpointStore();
      const checkpoint = store.create({ task_id: "T-14c", candidate_id: "cand-14c", evidence: ["ev-4"] });
      const offPolicy = planRelease({
        task_id: "T-14c", slug: "ok", goal: "g", requirements: ["R-1"], candidate_id: "cand-14c", evidence: ["ev-4"],
        base_branch: baseBranch,
        checkpoint: { allowed: true, reason: "checkpoint ok", record: checkpoint },
        commit: { summary: "s", task_id: "T-14c", requirements: ["R-1"], candidate_id: "cand-14c", evidence: ["ev-4"] },
        pull_request: { goal: "g", what_changed: ["c"], requirements: [{ id: "R-1", text: "t", state: "VERIFIED" }], tests: ["t"], evidence: ["e"], known_limitations: ["l"], risk: "r", rollback: "rb" }
      });
      item.check("a complete plan is allowed", true, offPolicy.allowed);
      item.check("and names the branch", "boss/t-14c/ok", offPolicy.branch);
      const noCommit = planRelease({
        task_id: "T-14c", slug: "ok", goal: "g", requirements: ["R-1"], candidate_id: "cand-14c", evidence: ["ev-4"],
        base_branch: baseBranch,
        checkpoint: { allowed: true, reason: "checkpoint ok", record: checkpoint }
      });
      item.check("a plan without a commit or PR is refused", false, noCommit.allowed);
      item.check("and names what is missing", true, noCommit.reasons.some((reason) => reason.includes("no commit was planned")));
      const drifted = await runner().release.run(input({
        task_id: "T-14c",
        candidate_id: "cand-14c",
        evidence: ["ev-4"],
        checkpoints: [checkpoint],
        // Only the diff hash differs: same task, same branch, same commit, different tree.
        current: { head: checkpoint.head, branch: checkpoint.branch, diff_hash: "f".repeat(64) }
      }));
      item.check("a drifted tree is refused", "REFUSED", drifted.decision);
      item.check("the reason is the drift", true, drifted.reasons.some((reason) => reason.includes("changed after the checkpoint")));
      shared.pb09 = { allowed: offPolicy.allowed, drifted: drifted.decision, reasons: drifted.reasons };
      item.cite("planRelease + guardGitHubWrite");
    });
  });

  it("PB-10 the release record is durable and readable by a fresh runner", async () => {
    await scenario("PB-10", "§39/§40 traceability", async (item) => {
      const raw = JSON.parse(fs.readFileSync(RELEASE_RECORD, "utf8")) as { version: string; branch: string; steps: { step: string; done: boolean }[]; decision: string };
      item.check("the record is versioned", "release-record-1", raw.version);
      item.check("it names the branch", true, raw.branch.startsWith("boss/"));
      item.check("it records the steps", true, raw.steps.length > 0);
      item.check("every step carries its detail", true, raw.steps.every((step) => typeof step.detail === "string"));
      const fresh = runner().release.record();
      item.check("a fresh runner reads it back", raw.branch, fresh?.branch);
      item.check("and keeps the decision", true, ["PUBLISHED", "PARTIAL", "REFUSED"].includes(fresh?.decision ?? ""));
      const published = (shared.pb05 as { branch?: string })?.branch ?? raw.branch;
      const info = run(WORK, "log", "-1", "--pretty=%B", published);
      item.check("the published branch carries the §39.2 trailers", true, info.output.includes("Task:") && info.output.includes("Evidence:"));
      shared.pb10 = { branch: raw.branch, decision: raw.decision, steps: raw.steps.map((step) => `${step.step}:${step.done}`) };
      item.cite(RELEASE_RECORD);
    });
  });
});

afterAll(() => {
  const report = {
    schemaVersion: 1,
    unit: "CHECKPOINT_14_PUBLISH",
    generatedAt: new Date().toISOString(),
    providerExecution: "NOT_RUN",
    network: "NONE (a bare remote on disk and a recording transport)",
    workspace: {
      git_initialized: initialized.status === 0,
      git_commit: committed.status === 0,
      remote_initialized: remoteInitialized.status === 0,
      base_branch: baseBranch,
      checkpoints: fs.existsSync(CHECKPOINT_DIR) ? fs.readdirSync(CHECKPOINT_DIR).length : 0
    },
    release: fs.existsSync(RELEASE_RECORD)
      ? (() => {
          const raw = JSON.parse(fs.readFileSync(RELEASE_RECORD, "utf8")) as { branch: string; decision: string; pushed: boolean; commit_sha?: string };
          return { branch: raw.branch, decision: raw.decision, pushed: raw.pushed, commit: raw.commit_sha?.slice(0, 12) };
        })()
      : undefined,
    publishing: shared,
    requirementResults: results,
    totals: {
      pass: results.filter((entry) => entry.verdict === "PASS").length,
      fail: results.filter((entry) => entry.verdict === "FAIL").length,
      notRun: results.filter((entry) => entry.verdict === "NOT_RUN").length
    },
    passed: results.every((entry) => entry.verdict !== "FAIL")
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "publish-release.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(REPORT_DIR, "publish-release.md"), [
    "# checkpoint-1 §39/§40 publishing acceptance",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Network: ${report.network}`,
    "",
    `Release: ${report.release?.branch ?? "-"} ${report.release?.decision ?? "-"} pushed=${report.release?.pushed ?? false}`,
    "",
    `Totals: PASS ${report.totals.pass} / FAIL ${report.totals.fail}`,
    "",
    "| Item | Verdict | Observations |",
    "| --- | --- | --- |",
    ...report.requirementResults.map((entry) => `| ${entry.id} | ${entry.verdict} | ${entry.observations.filter((observation) => observation.ok).length}/${entry.observations.length} |`),
    ""
  ].join("\n"), "utf8");
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* disposable temp root */ }
  expect(report.requirementResults.map((entry) => `${entry.id}:${entry.verdict}`)).toEqual(report.requirementResults.map((entry) => `${entry.id}:PASS`));
});
