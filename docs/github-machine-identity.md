# GitHub Machine Identity

Codex-Boss owns one logical GitHub identity. A node only supplies capabilities and a node-local secret backend; neither tasks nor repository policy refers to Host-A, a drive letter, a username, or a performance profile.

## Architecture

The production path is `Task -> capability scheduler -> authorized node -> GitHubGateway -> Guardian policy -> GitHubAppAuthProvider -> GitHub`. The existing SecretVault, Root/Guardian hierarchy, 10.x node advertisement, dynamic scheduler and failure-isolation conventions are reused. The older environment-token promotion adapter remains compatible for historical acceptance runs, but new GitHub App work must use `electron/github/` and must not hand a token to a worker or prompt.

The configuration contains only App ID, Installation ID, an opaque private-key reference and a repository allowlist. The private key is resolved by a node-local `SecretProvider`, decrypted only into a short-lived in-memory lease, used to sign a maximum-ten-minute JWT, then released. Installation tokens are cached in memory and refreshed with a one-minute safety margin. PEM, JWT, installation tokens, authorization headers and credential paths are excluded from audit records.

Repository writes require both GitHub App installation access and the local `allowedRepositories` policy. Local denial happens before credential or network access. When GitHub returns the installation repository set, it is checked as an independent second boundary; API denial/not-found remains fail-closed.

Normal repository inspection, branch creation, commit creation, non-force push, PR creation/inspection and status/workflow inspection are Guardian-allowed within both boundaries. Repository deletion, visibility changes, protection/ruleset/security weakening, App-permission changes, installation-scope expansion, secret/deploy-key changes and destructive administration require an out-of-band Root Owner ceremony and have no autonomous Gateway method. Credential export/inspection, self-escalation, Guardian bypass and audit deletion are always denied.

GitHub failures are typed as `AUTH_MISSING`, `AUTH_INVALID`, `AUTH_EXPIRED`, `NETWORK_ERROR`, `RATE_LIMITED`, `REPOSITORY_DENIED`, `REPOSITORY_NOT_INSTALLED`, `GUARDIAN_DENIED`, `GITHUB_UNAVAILABLE` or `UNKNOWN_GITHUB_ERROR`. Network, server and rate-limit failures use bounded retry/backoff; a 401 invalidates the cached installation token and permits one refresh. Audit-sink failure and GitHub failure cannot crash Boss Core, Fleet, Scheduler or unrelated work.

## Node capabilities and scheduling

Nodes advertise `git`, `github.read`, `github.write`, `credential.github`, `filesystem`, `test` and `network`. `TaskRequirements.requiredCapabilities` is evaluated before ordinary scheduler policies. A node without credentials can still code and test; authenticated work naturally moves to any available node advertising both `github.write` and `credential.github`. GitHub capability is independent of ECO/NORMAL/PERFORMANCE/BURST runtime state.

`boss:node-status` includes a non-secret GitHub self-check: configuration presence, provider availability, authentication health, installation reachability and boolean capabilities. It never returns App private-key content, JWTs or tokens.

## One-time Root Owner bootstrap

Never paste the PEM into chat, a task, `.env`, JSON, a shell argument, logs or telemetry. On the authorized node, save the downloaded PEM temporarily in a Root Owner-only local directory. Build the Electron host, then run the local bootstrap and pass only the PEM file path:

```powershell
pnpm run build:electron
pnpm run bootstrap:github-machine -- --pem-file "D:\private\codex-boss-app.pem" --app-id "APP_ID" --installation-id "INSTALLATION_ID" --repositories "owner/repository,owner/second-repository"
```

The bootstrap validates the input and displays a local Root Owner confirmation dialog. Only after the owner confirms does it encrypt the key with Electron `safeStorage`, store ciphertext in the node-local user-data vault, and store non-secret configuration beside it. It does not delete the original PEM; the Root Owner should archive or remove that file using their normal secure-key procedure. Rotation repeats the same visible Root Owner ceremony and overwrites the encrypted vault entry.

Restart Codex-Boss and open Node Status. Confirm `configured`, `credentialProviderAvailable`, `authenticationHealthy`, `installationReachable`, `github.read` and (where configured) `github.write`. Then use the Gateway for a harmless repository inspect, followed by a dedicated test branch, a controlled file commit, a non-force push, PR creation and status inspection. Do not use an Owner `gh` login as proof of the Boss App identity.

## Verification

```powershell
pnpm run security:scan
pnpm run typecheck
pnpm test
pnpm run build
pnpm run acceptance:github-machine
```

The mock acceptance runs the complete scheduler/Gateway-side branch, commit, push, PR and status sequence without a real credential or external mutation. Until the Root Owner completes the bootstrap and the live read/write test, the honest state is `REAL_CREDENTIAL_ACCEPTANCE_PENDING`.
