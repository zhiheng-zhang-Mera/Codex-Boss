# 9-7 Phase F — GitHub URL Resolver + Repo 物化

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase F. Branch `9-7`.

## Why

Acceptance 4 requires that pasting a GitHub URL results in Boss actually
reading real code — never forwarding the URL to a visible web page as prose.
A repo URL must be treated as an InputObject that gets materialized into the
local repo cache, bound to the conversation, and scanned.

## What was added

- **URL model (`src/shared/github-url.ts`)** — pure parser:
  - `parseGithubUrl` handles repo, tree/branch/subpath, blob, commit and
    `git@github.com:` URLs; returns `{owner, repo, ref?, subpath?}` or
    undefined; `looksLikeGithubUrl`, `extractGithubUrlFromMessage`
    (finds the first repo URL inside a prompt), `githubCacheKey`.
- **Materializer (`electron/input/github-resolver.ts`)** — `GithubResolver`:
  - Cache layout `<dataRoot>/.cache/repos/<repo-hash>/`; marker file records
    origin + ref so repeat resolves reuse the checkout.
  - `resolve(target, {forceFetch?, origin?})` shallow-clones a named ref,
    falls back to full clone + local checkout when the ref is not a branch
    name git knows, and refreshes existing checkouts on `forceFetch`.
    `origin?` exists for deterministic local-origin tests.
- **Main wiring (`electron/main.ts`)**
  - `GithubResolver` instantiated over `<userData>/.cache/repos`.
  - `boss:dispatch-task`: when the message contains a GitHub URL, it is
    materialized once, registered as a conversation InputObject
    (`kind REPOSITORY`, `source GITHUB`, `localPath = checkoutDir`), and bound
    to the task via `inputObjectIds`. The workspace for execution is then the
    materialized repo instead of the app root.
  - Chat→Work approval (Phase E) resolves the workspace from the bound
    REPOSITORY input, so "approve → scan real code" runs against the checkout.

## Acceptance (Phase F, deterministic core)

- Parse: plain / branch / subpath / commit / ssh URLs resolve to stable
  targets; non-GitHub and malformed inputs are rejected.
- Materialize: local-origin clone checkouts the requested ref, lands real
  files, and a second resolve reuses the cache (verified in tests).
- Dispatch: message with `https://github.com/…` becomes a bound REPOSITORY
  input object with a durable local path.
- Verified by `tests/github-resolver.test.ts` (7 tests, incl. two real
  local-origin clone/ref/cache round-trips).

## Verification

- `pnpm run typecheck` — green.
- `pnpm vitest run tests/github-resolver.test.ts` — 7 passed.
- Full suite at last phase close: 114 files / 558 tests passed.

## Next

Phase G — Context Optimizer: stable prompt prefixes, repo manifest with
content hashes, range selection, artifact refs and dedup so repeated tasks stop
re-sending unchanged code.
