# Root Trust Authority Model

**Boss owns computation. The Owner owns authority.**

```text
BOSS_CAN_MODIFY_ITSELF  !=  BOSS_CAN_AUTHORIZE_ITSELF
```

This document states the model that the Root Trust Authority Lockdown implements. It is *not* the
enforcement: enforcement lives in code, in CI and in repository permissions, and each claim below names
the artifact that enforces it. A claim without an enforcer is marked as such.

---

## 1. The two planes

### Mutable Autonomous Plane

Boss may change, test, prune and replace all of this on its own:

agents · skills · plugins · prompts · task routing · orchestration · model selection and scoring ·
skill-card pruning · module replacement · knowledge indexing · memory strategy · worker topology ·
performance work · ordinary application code · ordinary tests · ordinary configuration.

### Root Trust / Owner Authority Plane

Boss may `inspect · detect · propose · patch · test · simulate · prepare · explain · generate a migration
candidate`. Boss may never `approve · self-authorize · self-sign · silently advance the epoch · disable or
weaken an owner gate · reclassify protected authority as ordinary`.

The plane covers: the Root Trust Surface definition · the trust epoch mechanism and its verifier · the
owner authorization mechanism · the self-certification prohibition · the authorization workflow · the
production qualification policy · the privileged execution boundary · the rules deciding which changes
need Owner approval · the rules deciding what Boss may modify autonomously · production
promotion/signing authority · and **anything capable of weakening any of the above** (including this
document, the classifier that produces this classification, and the tests that guard it).

This document's own membership in that plane is enforced, not implied, and §3's convention — every claim
names its enforcer — applies to it like any other: the exact path `/docs/root-trust-authority-model.md` is in
`ROOT_PROTECTED_MANIFEST` (`src/shared/root-authority/protected-surface.ts`) and in `.github/CODEOWNERS`, so
`classifyAuthorityPath` returns `OWNER_AUTHORITY` / class 3 and an autonomous change is `REQUIRE_OWNER`.
`tests/unit/root-trust-authority-lockdown.test.ts` pins that, and pins `docs/continuation-notes.md` as the
autonomous negative control, so neither deleting the protection nor widening it to `docs/**` can pass.

## 2. The four classes

| Class | Name | Who may effect it |
| --- | --- | --- |
| 0 | `ORDINARY_AUTONOMOUS_CHANGE` | Boss |
| 1 | `PRIVILEGED_NON_ROOT_CHANGE` | Boss, with extra tests/audit |
| 2 | `ROOT_TRUST_CHANGE` | Boss may prepare it; **the Owner authorizes** |
| 3 | `OWNER_AUTHORITY_CHANGE` | **The Owner only**; an autonomous actor may not even downgrade it |

Classes are derived from what a change *touches*, never from what an actor says it touches:
`effectiveChangeClass` takes the stricter of the declared and derived class and **raises** on an
autonomous downgrade. Source: `src/shared/root-authority/authority-planes.ts`.

## 3. Enforcement matrix

| Boundary | Enforced by | Kind |
| --- | --- | --- |
| Worker cannot run an arbitrary shell | `classifyEvolutionCommand` — shells, `curl`/`gh`/`reg`, `node -e`, and every non-build node entry point are DENY | **code** |
| Worker cannot run `acceptance-evolution-bless.cjs --advance` | same classifier: `node` is restricted to `vitest\|tsc\|typescript\|eslint\|vite` entry points, so the bless script is DENY | **code** |
| Worker cannot commit, push, checkout or reset | same classifier: only read-only git subcommands are ALLOW | **code** |
| Worker holds no Owner credential | `candidateEnvironment` + `assertNoCredentialLeak`; `credential-boundary` refuses Owner-admin targets | **code** |
| A Root Trust / Owner Authority change needs the Owner | `ProtectedSurfaceGuard` + `decidePromotion` → `WAITING_FOR_ROOT_OWNER` | **code** |
| The classification cannot be narrowed | `OWNER_AUTHORITY_PATHS` is spread from `ROOT_PROTECTED_MANIFEST`, so the class model can never be narrower than the boundary the host enforces | **code** |
| The review boundary cannot be redefined by the actor it guards | `/src/shared/root-authority/`, `/.github/CODEOWNERS` and the guard tests are themselves protected | **code** |
| The epoch cannot be advanced autonomously | `decideAuthorityAction({actor:"autonomous", action:"finalize-trust-epoch"})` = `DENY` | **code** |
| A forged or stale epoch fails | `verifyTrustEpochFile` + `judgeSelfCertification` → `SELF_CERTIFICATION_FORBIDDEN` + `TRUST_EPOCH_MIGRATION` | **code** |
| Stage A cannot finalize | `scripts/trust-migration-proposal.cjs` never writes `trust-policy/**`; the lockdown test asserts the committed epoch is byte-identical after it runs | **code + test** |
| Finalization needs an external Owner act | `.github/workflows/trust-epoch-finalization.yml` — `workflow_dispatch` only, `refs/heads/main` asserted in-job, job targets the `boss-root-trust-owner` environment | **CI + external permission** |
| Boss's credential cannot approve that environment | `boss-root-trust-owner` has `required_reviewers = zhiheng-zhang-Mera` and `can_admins_bypass = false` | **external permission** |
| A pull request cannot land a protected change without the Owner | ruleset `Main-Protection`: `require_code_owner_review`, CODEOWNERS names the Owner | **external permission** |
| Owner credential is not handed to automation | the finalization workflow uses no repository secrets and holds no bypass PAT; its last act is to open a PR | **CI** |
| The model's own tests | `tests/unit/root-trust-authority-lockdown.test.ts` (the 17 attack cases), `tests/unit/owner-authority.test.ts` (the two boundaries must agree), `tests/unit/test-layers.test.ts` (the tier boundary) | **test** |

## 4. Proposal and authorization are two stages (A5)

```text
STAGE A  autonomous:  measure → propose          (never changes the epoch)
STAGE B  external:    Owner approves → advance → verify → PR → Owner merges
```

Stage A produces `artifacts/platform-foundation/trust/trust-migration-proposal.json`: current and
candidate epoch, current surface digest, whether the committed epoch anchors the live surface, the
root-trust files changed since the epoch was written (derived from git, not guessed), the reason, risk and
rollback the Owner needs, and the exact writes the migration would perform. `authorized: false` is part of
the document.

Nothing in Stage A is an authorization. The conversion happens only in the finalization workflow, after
the protected environment has been approved by the Owner.

## 5. Fake Owner controls are records, not boundaries (A6)

None of these is a trust boundary, and the lockdown test asserts the code does not read them:

Boss-written `owner-approved.json` · `OWNER APPROVED` in a commit message · a documentation note ·
`OWNER_APPROVED=true` in the environment · a marker file Boss can write · a `--force-owner` switch ·
a signing key an autonomous worker can reach · an approval record Boss can edit · a rule that exists only
in a prompt.

They may be kept as **audit records**. The only approval input the promotion gate reads is a
`rootOwnerApprovedSha` matching the candidate head, and **no production caller supplies it** — the
autonomous coordinator does not, which the lockdown test asserts over the source.

## 6. Break-glass (A11)

`OWNER_BREAK_GLASS` is external by construction: it is the Owner acting with the Owner's own credential
outside the autonomous path (the repository ruleset names exactly one always-bypass actor, the Owner), with
the reason recorded in the migration proposal and the GitHub audit trail. It is never callable by Boss
(the autonomous profile implements no such path), it is never a permanent bypass (the ruleset's other
rules stay in force), and it is never the normal execution path.

## 7. What is NOT yet machine-enforced

Recorded here rather than implied, because a model document that overstates itself is how the gap it
describes gets forgotten:

- **Boss's credential separation: the identity exists and is proven; the PROMOTION PATH still does not consume
  it, and that inequality is therefore not yet proven in practice.** Three separate facts, which this entry
  previously collapsed into one:
  1. **Existing proven fact.** The Boss GitHub App machine identity exists and passed a real read/write
     acceptance as the actual actor `codex-boss[bot]`: branch creation, a detached commit, a non-force push, a
     pull request, status and workflow inspection — with the private key in platform secure storage, no PEM in
     the repository, no JWT and no installation token persisted, the repository allowlist enforced, and the
     Guardian administration endpoints denied.
  2. **Previously missing fact.** The Self-Evolution promotion path did **not** use that identity. It defaulted
     to `EnvironmentBossGitHubCredentialProvider` — a long-lived token in `CODEX_BOSS_GITHUB_TOKEN` /
     `BOSS_GITHUB_TOKEN` — which is a SECOND credential architecture for the same logical actor. On this host
     those variables are unset, so promotion reported `BLOCKED_EXTERNAL` while a working machine identity sat
     unused in the same process. The legacy provider's own defences (never reading `GH_TOKEN` /
     `GITHUB_TOKEN`, never shelling to `gh auth token`, refusing a credential byte-identical to the Owner's, and
     refusing the Root Owner's identity) remain in force and are unchanged.
  3. **Closure fact — NOT yet earned.** `AUTONOMOUS_WORKER_AUTHORITY < OWNER_TRUST_AUTHORITY` may be written
     `PROVEN_IN_PRACTICE` only after a live promotion-path acceptance using the EXISTING App identity has shown
     both directions: a candidate branch pushed and a pull request opened as `codex-boss[bot]` with every
     required check read against the exact candidate SHA, and a protected change refused with
     `WAITING_FOR_ROOT_OWNER` — the App holding `contents:write` and `pull_requests:write` but unable to bypass
     CODEOWNERS, unable to admin-merge and unable to alter the ruleset. Until that acceptance is run and
     recorded, the honest state is: **the identity is proven, the convergence toward it is prepared, and the
     promotion path's own authority has not been exercised in practice.**
  4. **Measured while preparing that acceptance: the promotion path could not have observed a green CI at all.**
     On `main` at `1d78ee67`, the remote sequence pushed the Candidate branch, opened the pull request and then
     read the required checks **exactly once, synchronously, with no wait** (`promote.readCheck`, a single call,
     no retry). A real CI cannot have reported by that instant, and the gate reads a check that has not finished
     as not-green, so the decision was `required-checks-not-passed` — a REJECTED run, never the Root-Surface
     ceiling that sits behind a green one. The repair (wait — bounded — only for a check that has NOT reported
     yet, and stop the moment one reports a non-`success` conclusion or a foreign SHA; `pending` remains part of
     the all-green conjunction so an unfinished check can never be a pass) is prepared together with the
     App-identity convergence on branch `feat/pf020-identity-convergence` at `7d558cb`, **not landed**. The live
     acceptance required above could not be run in this job because the machine identity is not installed in
     this host's data root: no `.boss/github-machine-identity.json` and no `.boss/secret-vault.json`, so
     `createGitHubMachineRuntime(...)` answers `configured: false` and
     `corepack pnpm run acceptance:promotion-identity:live` exits `2` with
     `PROMOTION_IDENTITY_LIVE_ACCEPTANCE=BLOCKED_EXTERNAL` (artifact:
     `runtime-data/.boss/promotion-identity-live-acceptance.json`). The exact Owner action is
     `corepack pnpm run bootstrap:github-machine` on this host, then that acceptance command. **No part of this
     entry is a claim that the inequality holds.**
- **The ruleset's required checks are produced — repaired, and measured.** Until the Owner-authorized repair,
  `Main-Protection` required a check named `validate`, which no workflow produced, so the Owner's bypass was
  the only way `main` moved. It now requires the four checks `Desktop CI` actually emits — `quality`, `unit`,
  `acceptance`, `package`, each pinned to the GitHub Actions integration id `15368`, with
  `strict_required_status_checks_policy = true`. The Owner bypass **remains available** (the ruleset's single
  always-allow actor is still the Owner), but it is **no longer required merely to work around a non-produced
  `validate` required check**. Measured: `required=[quality,unit,acceptance,package]`,
  `produced=[acceptance,finalize,hosted-runner-status,package,quality,unit]`, no
  `REQUIRED_CHECK_NOT_PRODUCED:*` finding (`node scripts/verify-authority-separation.cjs --platform`).
- **The lockdown itself is promoted** (epoch 22, `main = ac3865b` at the time of writing), so this item is
  closed; it is kept in the list because it recorded the bootstrap step that had to happen before the
  mechanism could govern its own changes. That epoch-22 note is history and is left as written. **CURRENT:
  epoch 23 / `boss-root-trust-23`**, surface `0ddb900014c924bb93b6e0998495576b8c6d72dc62afb9647f1e3363c3956a0a`,
  `node scripts/acceptance-evolution-bless.cjs --check` → `MATCHES the live surface`. Epoch 23 anchors the
  post-seal documentation-pointer correction; it does **not** re-certify the v1.2 production qualification,
  which stays historical evidence at epoch 22 and qualified SHA `506e4a9631…`.
- **Pruning is policy-only until a pruning path exists.** `decidePrune` /
  `isComponentPartOfTrustBoundary` are machine-checked and ready, but Boss has no self-pruning executor
  yet; when one is built it must call them rather than re-deciding what is protected.

## 8. Where a self-hosted runner may exist (Phase B3), and the production path (B10)

### B3 — enforced by measurement, not by memory

`node scripts/verify-authority-separation.cjs --platform` reads the platform and reports what the **host**
can enforce: repository visibility, the `Main-Protection` ruleset with its rules and bypass actors, the
environments and their protection rules, the required check contexts, and **which check contexts this
repository's workflows actually produce**.

Its verdict includes `selfHostedRunnerSafe`, and `--require-self-hosted-safe` turns that into a fail-closed
guard. The real-host qualification job — the one in the private control plane — runs it as its **first**
step, so the lane refuses to start on a
repository where a runner is reachable by untrusted workflow files — which is any PUBLIC repository, because
a runner is registered for the whole repository and no workflow-level guard can bind it to a single workflow.
This is enforced at run time and flips by itself when the repository becomes private; nobody has to remember.

Measured on this repository:

```text
visibility=public   ruleset=Main-Protection (active)   bypass actors=[{id:229580437,User,always}]
required checks=[quality,unit,acceptance,package]   (each pinned to integration_id 15368, strict=true)
produced checks=[acceptance,finalize,hosted-runner-status,package,quality,unit]
environments=[boss-root-trust-owner (required_reviewers)]
self-hosted runner safe: false
  finding: PUBLIC_REPOSITORY_CANNOT_HOST_A_SELF_HOSTED_RUNNER
```

Every required context is now produced by a workflow in this repository, so the ruleset is satisfiable
without the Owner bypass whenever CI is genuinely green. The one finding above is unchanged and is the whole
reason for the private control plane: the repository is PUBLIC, so it may not host a runner.

The transport was then decided (Owner decision 1, OPTION 2) and **built as a separate private control plane**,
so the finding above is no longer an open question — it is the reason the architecture looks the way it does:

```text
PUBLIC  zhiheng-zhang-Mera/Codex-Boss
        self-hosted runners = 0            <- this repository cannot schedule the real-soak runner
        .github/workflows/platform-qualification.yml = HOSTED DIAGNOSTIC ONLY
                    |
                    | immutable commit SHA (detached checkout)
                    v
PRIVATE zhiheng-zhang-Mera/Boss-Qualification-Control
        owns the only real-soak runner: self-hosted, windows, boss-real-soak, boss-qualification
        workflow_dispatch only, main only, exact-SHA verification, read-only corpus snapshot,
        redacted aggregate evidence
```

There is deliberately **no `runs-on: [self-hosted, …]` job in this repository**. A lane left behind after the
runner moved would not fail — it would wait — so the public workflow keeps only what a hosted runner can
honestly do, and states `HOSTED_RUNNER_NOT_A_QUALIFICATION_HOST` instead of claiming a qualification. The
Phase 04 corpus invariant is unchanged: a hosted runner has no accumulated host history, which is topology
rather than regression. `scripts/verify-authority-separation.cjs --platform` remains the instrument that
measures the facts (`selfHostedRunnerSafe`, bypass actors, environments, produced check contexts).

### B10 — the production path

```text
Boss autonomous development → Desktop CI → acceptance → Root Trust verification
  → Real Host Qualification → OWNER PRODUCTION PROMOTION
```

Boss may drive work to `QUALIFIED_CANDIDATE`. It may not create a production tag, declare a promotion, or
change the production authority policy: those stay behind the Owner gate, and a Root Trust / Owner Authority
promotion is never automated by default. A future low-risk automated promotion path would have to be designed
as its own policy, separately from this boundary.
