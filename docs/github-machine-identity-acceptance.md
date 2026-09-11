# GitHub Machine Identity Acceptance

## Architecture Discovery

Baseline: `Prestart` at `5ad33531a32200a289588193a62db1d0ab1c4b14`, five commits ahead of `main`, with a clean worktree before implementation. Existing reusable components were the encrypted `SecretVaultStore`, credential sanitizer and no-Owner-fallback boundary, Root/Guardian policy, GitHub promotion adapter, 10.x node advertisement, dynamic scheduler, Fleet controller, retry/recovery conventions, telemetry and acceptance harnesses. No GitHub App JWT/installation-token provider, repository double-boundary Gateway, GitHub capability self-check or App-specific mock E2E existed.

## Implementation

Added platform-neutral GitHub identity/config/error/audit contracts, SecretProvider adapter, validated config loader, RS256 GitHub App authentication, in-memory installation-token lifecycle, bounded failure recovery, controlled GitHub Gateway, Guardian operation policy, node self-check, capability-based scheduling, Electron production composition, one-time secure bootstrap, tracked-secret scanner, CI gates and documentation. The existing architecture was extended; no duplicate Fleet, Scheduler, Guardian or vault was introduced.

## Security and Guardian

The PEM is referenced in config but stored only as platform-encrypted node-local vault ciphertext. Workers and prompts receive neither PEM nor token. JWT, installation-token and PEM redaction is tested. Writes require the GitHub installation and Boss local allowlist. Normal development operations are allowed inside both boundaries; administrative weakening/scope changes require Root Owner; credential export/inspection, self-escalation, Guardian bypass and audit deletion are denied.

## Node and Fleet

Scheduler requirements now include `git`, `github.read`, `github.write`, `credential.github`, `filesystem`, `test` and `network`. A no-credential node remains eligible for coding/testing while authenticated work routes to any capable node. Persistent node identity is generated under node-local user data, not from Host-A, a username, drive letter or performance mode.

## Tests and E2E

- Full suite: `98` test files passed; `914` tests passed; `0` failed.
- TypeScript renderer/electron typecheck: passed.
- Production renderer/electron build: passed.
- Tracked-secret scan: `PASS`, `1053` tracked and delivery-candidate files inspected at the time of validation.
- Mock GitHub E2E: `PASS`, five operations and six mock HTTP requests (token, branch, commit, push, PR, status).
- Controlled restart acceptance: `PASS`, one attempt, final state visible.
- Portable package and packaged smoke: `PASS`.
- Controlled benchmark: persistence `100/100`, recovery `20/20`, routing `10/10`.

The baseline CI failures were also repaired: `PGPASSWORD` is now removed from Candidate environments, Windows long/short path canonicalization is tested against the same native canonicalizer, concurrent/nested AppContainer tests use per-process profiles, the bundled pnpm-only runtime can execute npx-declared acceptance checks without a shell, and production Root governance defaults outside the Candidate evolution tree.

## Real GitHub

`REAL_CREDENTIAL_ACCEPTANCE_PASS` on 2026-09-11. Root Owner completed the visible local credential ceremony for App ID `4903952`, installation `160744736`, with the local and installation repository boundaries restricted to `zhiheng-zhang-Mera/Codex-Boss`. The private key remained inside the platform-encrypted node-local SecretVault path; no PEM, JWT, installation token or Authorization header was recorded in this evidence.

The production runtime self-check reported `configured`, `credentialProviderAvailable`, `authenticationHealthy`, `installationReachable`, `github.read` and `github.write` as true. The controlled Gateway authenticated as the GitHub App installation, inspected the repository, created `acceptance/github-machine-identity-20260911015734`, created detached commit `5be8123cd48bcf7c79eb7a88c81622782014258a`, advanced the branch with `force: false`, created and re-read [PR #3](https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/3), and inspected commit status plus Actions run `34552741729` through the same installation credential. The PR actor was `codex-boss[bot]`; the workflow completed with conclusion `success`.

Live acceptance exposed a bootstrap/runtime data-root mismatch and the lack of a detached-commit seam for independently observable commit and push steps. The data-root composition was aligned with the production runtime, and a guarded Git-data commit path plus reusable live acceptance runner were added. Repair commit `deb388682e0f1984db37c48db08a59af197efd7e` was pushed using the GitHub App installation credential; the remote branch SHA matched and CI run `34567424398` completed successfully. Guardian policy, Root Owner policy, GitHub App permissions, repository visibility, protection/rulesets, secrets and installation scope were not changed.
