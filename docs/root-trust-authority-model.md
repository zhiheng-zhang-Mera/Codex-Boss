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

- **Boss's credential separation is unproven in practice.** `CODEX_BOSS_GITHUB_TOKEN` /
  `BOSS_GITHUB_TOKEN` are unset, so the promotion path is fail-closed *by absence*: Boss cannot push at
  all. That is safe but it is not the same claim as "Boss holds a strictly weaker credential". Proving
  `AUTONOMOUS_WORKER_AUTHORITY < OWNER_TRUST_AUTHORITY` needs a dedicated Boss identity
  (`contents:write`, `pull_requests:write`, `checks:read`, no admin, no bypass) to exist and to be shown
  unable to merge a protected change.
- **The ruleset's required status check cannot be satisfied.** `Main-Protection` requires a check named
  `validate`, which no workflow produces. The Owner's bypass is currently the only way `main` moves; the
  effective protections are `require_code_owner_review` plus `non_fast_forward`.
- **The lockdown itself is promoted** (epoch 22, `main = ac3865b` at the time of writing), so this item is
  closed; it is kept in the list because it recorded the bootstrap step that had to happen before the
  mechanism could govern its own changes.
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
guard. The real-host qualification job runs it as its **first** step, so the lane refuses to start on a
repository where a runner is reachable by untrusted workflow files — which is any PUBLIC repository, because
a runner is registered for the whole repository and no workflow-level guard can bind it to a single workflow.
This is enforced at run time and flips by itself when the repository becomes private; nobody has to remember.

Measured on this repository at the time of writing:

```text
visibility=public   ruleset=Main-Protection (active)   bypass actors=[{id:229580437,User,always}]
environments=[boss-root-trust-owner (required_reviewers)]
required checks=["validate"] produced=[acceptance,finalize,hosted-runner-status,package,quality,real-host-qualification,unit]
self-hosted runner safe: false
  finding: PUBLIC_REPOSITORY_CANNOT_HOST_A_SELF_HOSTED_RUNNER
  finding: REQUIRED_CHECK_NOT_PRODUCED:validate
```

So the real-host qualification lane is **built and refuses to run**: the qualification cannot be performed
until the Owner decides how to transport it (make the repository private; use a separate private repository;
or run it as an Owner-run local procedure, which the prohibitions explicitly say may NOT be presented as a
formal workflow attestation).

### B10 — the production path

```text
Boss autonomous development → Desktop CI → acceptance → Root Trust verification
  → Real Host Qualification → OWNER PRODUCTION PROMOTION
```

Boss may drive work to `QUALIFIED_CANDIDATE`. It may not create a production tag, declare a promotion, or
change the production authority policy: those stay behind the Owner gate, and a Root Trust / Owner Authority
promotion is never automated by default. A future low-risk automated promotion path would have to be designed
as its own policy, separately from this boundary.
