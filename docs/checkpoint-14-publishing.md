# Checkpoint 14 — GitHub App Execution (§39) + PR Automation (§40)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §39 (Phase 14 — GitHub App Execution)
and §40 (Phase 15 — Pull Request Automation).

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §39 | Boss performs create branch → commit → push → PR → read CI → repair → update PR through a GitHub App / machine identity. |
| §39.1 | Branches are generated as `boss/<task-id>/<slug>`. |
| §39.2 | A commit must be tied to its Task, Requirements, Candidate and Evidence. |
| §40 | The PR body carries Goal, What changed, Requirements, Tests, Evidence, Known limitations, Risk and Rollback — plus UI surfaces affected, visual evidence, fallback behavior and theme migration when the Theme Engine is involved. |

## What was built

### 1. `src/shared/publish-plan.ts` — the policy (pure)

* **§39.1**: `branchNameFor` produces `boss/<task-id>/<slug>` with a bounded,
  sanitized slug; `checkBranchPolicy` refuses anything else — a foreign prefix, a
  four-segment name, an unsafe path segment.
* **§39.2**: `buildCommitMessage` writes the summary, the detail, the §37
  `Version-Impact` and the four trailers; `validateCommitMessage` refuses a commit
  that drops any of them, names no requirement or cites no evidence.
* **§40**: `buildPullRequestBody` emits the eight sections in the plan's order (and
  the four theme ones when the Theme Engine is involved);
  `validatePullRequestBody` refuses a body with a missing or empty section.
* **`planRelease`** puts §38 + §39 + §40 into one sequence —
  CHECKPOINT → BRANCH → COMMIT → PUSH → PULL_REQUEST → READ_CI — where the first
  step that cannot be justified stops the plan, so a missing checkpoint, an
  off-policy branch name, a trailer-less commit or a holed PR body each prevent the
  release before anything is written.

### 2. `electron/engineering/release-runner.ts` — the execution

Runs the plan for real:

* refuses outright (and records why) when the §38 guard does not allow the write;
* creates the policy branch, stages the change and commits with the planned message;
* pushes the branch to the **configured remote**;
* opens the pull request through the **real `GitHubGateway`**
  (`createPullRequest` → `POST /repos/<owner>/<name>/pulls`) when a gateway and
  repository are attached;
* writes a durable release record (branch, base, checkpoint id, commit sha, PR
  number/URL and body hash, plan hash, per-step detail, decision
  PUBLISHED / PARTIAL / REFUSED);
* never invents a remote: with none configured it says the work stays local.

## Evidence

`pnpm run acceptance:publish` (CI step + local chain step) — **PB-01..PB-10 PASS,
62 observations**, with **no network**: the remote is a real bare repository on
disk and the gateway's transport is a recorder.

* PB-01 the branch policy, slug sanitization and refusals;
* PB-02 the four §39.2 trailers, with a stripped commit refused;
* PB-03 the eight §40 sections, an empty section refused, and a theme PR requiring
  the four extra sections;
* PB-04 no checkpoint ⇒ the release is REFUSED and records why;
* PB-05 the real push: `git ls-remote` shows `refs/heads/boss/t-14/...` on the bare
  remote and the pushed commit's message still carries all four trailers;
* PB-06 the real gateway: `POST /app/installations/67890/access_tokens` then
  `POST /repos/owner/name/pulls`, with the policy branch as `head`, the base branch,
  the §40 body in the payload, and `pull_request.create` in the audit log — the App
  JWT is genuinely signed with an RSA key generated in-memory for the test;
* PB-07 a repository outside the allowlist is denied with `REPOSITORY_DENIED` and
  **no HTTP request is made**;
* PB-08 the guardian policy refuses `repository.delete`, and the gateway exposes no
  destructive method at all — the capability is absent, not merely guarded;
* PB-09 an incomplete plan and a drifted working tree are both refused with the
  blocking step named;
* PB-10 the release record is durable and readable by a fresh runner.

## Honest boundaries

1. **The gateway calls are proven offline.** The real gateway code, auth path and
   payloads run, but the transport is a recorder; the live path
   (`acceptance:github-machine:live`) still requires a real App installation and is
   not exercised in CI.
2. **Push targets a configured remote, not necessarily GitHub.** The runner pushes
   with git and opens the PR with the API; wiring them to the same repository is the
   caller's configuration, and this gate deliberately points the push at a local bare
   remote so the proof needs no credentials.
3. **The release does not yet read CI results** (§41): the READ_CI step is planned
   and its precondition is checked, but the parse → classify → repair → push loop is
   the next checkpoint.
4. **`guardGitHubWrite` guards the runner's first step** rather than every API call;
   the gateway's own guardian policy still decides each operation, so a denied
   operation is refused even if the plan allowed it.
5. **The commit message's `Evidence` trailer lists pointers, not payloads**, so a
   commit body stays small; the §31.3 ledger remains the evidence store.
