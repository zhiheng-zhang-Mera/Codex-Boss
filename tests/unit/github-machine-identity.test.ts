import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BOSS_GITHUB_LOGICAL_IDENTITY,
  repositoryAllowed,
  validateGitHubMachineIdentityConfig,
  type GitHubMachineIdentityConfig
} from "../../src/shared/github-machine";
import { redactSecrets, scanSecrets } from "../../src/shared/secret-scan";
import { allocateTask, type SchedulerNodeView, type TaskRequirements } from "../../src/shared/tenx/scheduler";
import { GitHubAppAuthProvider, createGitHubAppJwt, type GitHubHttpRequest, type GitHubHttpResponse, type GitHubHttpTransport } from "../../electron/github/github-app-auth";
import { GitHubGateway } from "../../electron/github/github-gateway";
import { decideGitHubOperation } from "../../electron/github/github-guardian-policy";
import { checkNodeGitHubCapabilities } from "../../electron/github/node-github-self-check";
import type { SecretProvider } from "../../electron/github/secret-provider";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const now = Date.parse("2026-09-11T00:00:00Z");

const config: GitHubMachineIdentityConfig = {
  schemaVersion: 1, enabled: true, logicalIdentity: BOSS_GITHUB_LOGICAL_IDENTITY,
  appId: "12345", installationId: "67890", privateKeyRef: "github/codex-boss",
  allowedRepositories: ["owner/repo"]
};

class FakeSecrets implements SecretProvider {
  constructor(private readonly secret?: string) {}
  status(reference: string) { return { available: Boolean(this.secret), backend: "fake", reference }; }
  resolve() {
    if (!this.secret) throw new Error("missing");
    const secret = this.secret;
    return { value: secret, dispose() {} };
  }
}

class QueueTransport implements GitHubHttpTransport {
  calls: GitHubHttpRequest[] = [];
  constructor(readonly responses: Array<GitHubHttpResponse | Error>) {}
  async request(request: GitHubHttpRequest): Promise<GitHubHttpResponse> {
    this.calls.push(request);
    const next = this.responses.shift();
    if (!next) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  }
}

function token(expiresAt = now + 3_600_000, repositories = ["owner/repo"]): GitHubHttpResponse {
  return { status: 201, body: JSON.stringify({ token: "ghs_mock_installation_token_123456", expires_at: new Date(expiresAt).toISOString(), repositories: repositories.map((full_name) => ({ full_name })) }) };
}

function auth(transport: GitHubHttpTransport, secret = privateKey, clock = () => now) {
  return new GitHubAppAuthProvider(config, new FakeSecrets(secret), transport, clock);
}

describe("GitHub machine identity configuration and secret boundary", () => {
  it("accepts references and rejects secret material in config", () => {
    expect(validateGitHubMachineIdentityConfig(config)).toEqual(config);
    expect(validateGitHubMachineIdentityConfig({ ...config, privateKeyRef: privateKey })).toBeNull();
    expect(validateGitHubMachineIdentityConfig({ ...config, logicalIdentity: "Host-A" })).toBeNull();
    expect(repositoryAllowed(config, "OWNER/REPO")).toBe(true);
  });

  it("credential missing is AUTH_MISSING without a crash", async () => {
    const result = await new GitHubAppAuthProvider(config, new FakeSecrets(), new QueueTransport([]), () => now).getInstallationToken();
    expect(result).toMatchObject({ ok: false, code: "AUTH_MISSING", retryable: false });
  });

  it("invalid credential is AUTH_INVALID and never echoes PEM", async () => {
    const result = await auth(new QueueTransport([]), "not-a-private-key").getInstallationToken();
    expect(result).toMatchObject({ ok: false, code: "AUTH_INVALID" });
    expect(JSON.stringify(result)).not.toContain("not-a-private-key");
  });

  it("generates a valid RS256 JWT with bounded claims", () => {
    const jwt = createGitHubAppJwt(config.appId, privateKey, now);
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({ iss: "12345", iat: now / 1000 - 60, exp: now / 1000 + 540 });
    const verifier = createVerify("RSA-SHA256"); verifier.update(`${header}.${payload}`); verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("requests, caches and refreshes installation tokens before expiry", async () => {
    let clock = now;
    const transport = new QueueTransport([token(now + 120_000), token(now + 3_600_000)]);
    const provider = auth(transport, privateKey, () => clock);
    expect((await provider.getInstallationToken()).ok).toBe(true);
    expect((await provider.getInstallationToken()).ok).toBe(true);
    expect(transport.calls).toHaveLength(1);
    clock += 70_000;
    expect((await provider.getInstallationToken()).ok).toBe(true);
    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0].headers.authorization).toMatch(/^Bearer eyJ/);
  });
});

describe("Guardian, double boundary, failures and recovery", () => {
  it("allows normal work, requires Root Owner for administration and denies credential export", () => {
    expect(decideGitHubOperation("branch.create").decision).toBe("ALLOW");
    expect(decideGitHubOperation("branch.protection.weaken").decision).toBe("ROOT_OWNER_REQUIRED");
    expect(decideGitHubOperation("credential.export").decision).toBe("DENY");
  });

  it("local allowlist denies before any credential or network access", async () => {
    const transport = new QueueTransport([]);
    const result = await new GitHubGateway({ config, auth: auth(transport), transport, nodeId: "node-b" }).inspectRepository("owner/denied");
    expect(result).toMatchObject({ ok: false, code: "REPOSITORY_DENIED" });
    expect(transport.calls).toHaveLength(0);
  });

  it("installation repository list forms the second boundary", async () => {
    const transport = new QueueTransport([token(now + 3_600_000, ["owner/other"])]);
    const result = await new GitHubGateway({ config, auth: auth(transport), transport, nodeId: "node-a" }).inspectRepository("owner/repo");
    expect(result).toMatchObject({ ok: false, code: "REPOSITORY_NOT_INSTALLED" });
    expect(transport.calls).toHaveLength(1);
  });

  it("recovers once from an expired token and audits the logical identity", async () => {
    const transport = new QueueTransport([token(), { status: 401, body: "expired" }, token(), { status: 200, body: "{\"name\":\"repo\"}" }]);
    const records: unknown[] = [];
    const result = await new GitHubGateway({ config, auth: auth(transport), transport, nodeId: "node-c", audit: { record: (item) => records.push(item) } }).inspectRepository("owner/repo");
    expect(result).toMatchObject({ ok: true });
    expect(transport.calls.filter((call) => call.url.includes("access_tokens"))).toHaveLength(2);
    expect(records).toMatchObject([{ logicalIdentity: "Codex-Boss", nodeId: "node-c", retryCount: 1, result: "OK" }]);
  });

  it("recovers from a transient token-acquisition network failure", async () => {
    const transport = new QueueTransport([new Error("temporary DNS failure"), token(), { status: 200, body: "{}" }]);
    const result = await new GitHubGateway({ config, auth: auth(transport), transport, nodeId: "node-r", maxRetries: 1, sleep: async () => {} }).inspectRepository("owner/repo");
    expect(result).toMatchObject({ ok: true });
    expect(transport.calls).toHaveLength(3);
  });

  it("classifies rate limit and GitHub outage without infinite retry", async () => {
    const limited = new QueueTransport([token(), { status: 429, headers: { "retry-after": "2" }, body: "slow" }]);
    const limitedResult = await new GitHubGateway({ config, auth: auth(limited), transport: limited, nodeId: "n", maxRetries: 0 }).inspectRepository("owner/repo");
    expect(limitedResult).toMatchObject({ ok: false, code: "RATE_LIMITED", retryAfterMs: 2000 });
    const unavailable = new QueueTransport([token(), { status: 503, body: "down" }]);
    expect(await new GitHubGateway({ config, auth: auth(unavailable), transport: unavailable, nodeId: "n", maxRetries: 0 }).inspectRepository("owner/repo")).toMatchObject({ ok: false, code: "GITHUB_UNAVAILABLE" });
  });

  it("isolates network failure, retries a bounded number and keeps later work usable", async () => {
    const sensitive = ["ghs", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
    const transport = new QueueTransport([token(), new Error(`socket secret ${sensitive}`), new Error("offline"), { status: 200, body: "{}" }]);
    const gateway = new GitHubGateway({ config, auth: auth(transport), transport, nodeId: "n", maxRetries: 1 });
    const failed = await gateway.inspectRepository("owner/repo");
    expect(failed).toMatchObject({ ok: false, code: "NETWORK_ERROR" });
    expect(JSON.stringify(failed)).not.toContain(sensitive);
    expect(await gateway.inspectRepository("owner/repo")).toMatchObject({ ok: true });
  });

  it("redacts PEM, JWT and installation-token shapes", () => {
    const jwt = createGitHubAppJwt(config.appId, privateKey, now);
    const installationToken = ["ghs", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
    const text = `${privateKey}\n${jwt}\n${installationToken}`;
    expect(scanSecrets(text).map((match) => match.shape)).toEqual(expect.arrayContaining(["private-key", "jwt", "github-token"]));
    const safe = redactSecrets(text);
    expect(safe).not.toContain("BEGIN PRIVATE KEY"); expect(safe).not.toContain(jwt); expect(safe).not.toContain("ghs_");
  });
});

describe("node self-check, scheduler delegation and mock E2E", () => {
  it("reports no GitHub capability on a node without credentials", async () => {
    const provider = new GitHubAppAuthProvider(config, new FakeSecrets(), new QueueTransport([]), () => now);
    const check = await checkNodeGitHubCapabilities({ auth: provider, gitAvailable: true, filesystemAvailable: true, testAvailable: true, networkAvailable: true });
    expect(check.capabilities).toMatchObject({ git: true, filesystem: true, "credential.github": false, "github.write": false });
    expect(check.error).toBe("AUTH_MISSING");
    expect(JSON.stringify(check)).not.toMatch(/PRIVATE KEY|ghs_/);
  });

  it("delegates authenticated work to a credential-capable node without a host name rule", () => {
    const task: TaskRequirements = { taskId: "push", policies: [], risk: "low", requiredCapabilities: ["git", "github.write", "credential.github"] };
    const base: SchedulerNodeView = { nodeId: "coding-node", state: "AVAILABLE", busy: false, providers: [], providersReady: [], browser: false, networkEffective: "DIRECT", offlineCapable: true, capabilities: { git: true, filesystem: true } };
    const result = allocateTask(task, [base, { ...base, nodeId: "authorized-node", capabilities: { git: true, "github.write": true, "credential.github": true } }]);
    expect(result).toMatchObject({ allocated: true, nodeId: "authorized-node" });
    expect(result.blocked).toEqual([]);
  });

  it("runs branch → commit → push → PR → status through the controlled gateway", async () => {
    const transport = new QueueTransport([
      token(),
      { status: 201, body: "{\"ref\":\"refs/heads/feature\"}" },
      { status: 201, body: "{\"commit\":{\"sha\":\"c1\"}}" },
      { status: 200, body: "{\"object\":{\"sha\":\"c1\"}}" },
      { status: 201, body: "{\"number\":7}" },
      { status: 200, body: "{\"state\":\"success\"}" }
    ]);
    const gateway = new GitHubGateway({ config, auth: auth(transport), transport, nodeId: "node-any" });
    expect((await gateway.createBranch("owner/repo", "feature", "base")).ok).toBe(true);
    expect((await gateway.createCommit("owner/repo", { branch: "feature", path: "safe.txt", message: "controlled", contentBase64: "b2s=" })).ok).toBe(true);
    expect((await gateway.push("owner/repo", "feature", "c1")).ok).toBe(true);
    expect((await gateway.createPullRequest("owner/repo", { head: "feature", base: "main", title: "controlled", body: "mock" })).ok).toBe(true);
    expect((await gateway.inspectStatus("owner/repo", "c1")).ok).toBe(true);
  });
});
