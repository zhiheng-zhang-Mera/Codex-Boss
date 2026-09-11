const { generateKeyPairSync } = require("node:crypto");
const { GitHubAppAuthProvider } = require("../dist-electron/electron/github/github-app-auth.js");
const { GitHubGateway } = require("../dist-electron/electron/github/github-gateway.js");

const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const config = {
  schemaVersion: 1,
  enabled: true,
  logicalIdentity: "Codex-Boss",
  appId: "12345",
  installationId: "67890",
  privateKeyRef: "github/codex-boss",
  allowedRepositories: ["owner/repo"]
};
const secrets = {
  status: (reference) => ({ available: reference === config.privateKeyRef, backend: "acceptance-fake", reference }),
  resolve: () => ({ value: key, dispose() {} })
};
const replies = [
  [201, { token: ["ghs", "mockacceptancetoken123456789"].join("_"), expires_at: "2099-01-01T00:00:00Z", repositories: [{ full_name: "owner/repo" }] }],
  [201, { ref: "refs/heads/feature/mock" }],
  [201, { commit: { sha: "mock-commit" } }],
  [200, { object: { sha: "mock-commit" } }],
  [201, { number: 1 }],
  [200, { state: "success" }]
];
const observed = [];
const transport = {
  async request(request) {
    observed.push({ method: request.method, url: request.url });
    const next = replies.shift();
    if (!next) throw new Error("mock transport exhausted");
    return { status: next[0], body: JSON.stringify(next[1]) };
  }
};

(async () => {
  const auth = new GitHubAppAuthProvider(config, secrets, transport);
  const gateway = new GitHubGateway({ config, auth, transport, nodeId: "acceptance-node", maxRetries: 0 });
  const results = [
    await gateway.createBranch("owner/repo", "feature/mock", "base-sha"),
    await gateway.createCommit("owner/repo", { branch: "feature/mock", path: "acceptance.txt", message: "mock acceptance", contentBase64: "T0s=" }),
    await gateway.push("owner/repo", "feature/mock", "mock-commit"),
    await gateway.createPullRequest("owner/repo", { head: "feature/mock", base: "main", title: "Mock acceptance", body: "No real side effect" }),
    await gateway.inspectStatus("owner/repo", "mock-commit")
  ];
  if (!results.every((result) => result.ok) || replies.length !== 0) throw new Error("mock GitHub E2E did not complete");
  console.log(`MOCK_GITHUB_E2E=PASS steps=${results.length} requests=${observed.length}`);
  console.log("REAL_CREDENTIAL_ACCEPTANCE_PENDING");
})().catch((error) => {
  console.error(`MOCK_GITHUB_E2E=FAIL ${String(error)}`);
  process.exitCode = 1;
});
