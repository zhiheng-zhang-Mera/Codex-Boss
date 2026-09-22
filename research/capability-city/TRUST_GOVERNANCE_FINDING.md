# Trust & Governance Finding — Actor Separation at the Identity Layer

**Scope:** governance evidence for the Capability City research programme.
**Status:** finding recorded; separation **NOT YET PROVEN**.
**Source decision:** `RESEARCH_LEDGER.md` D-003 (initial observation) and D-004 (empirical result).

---

## 1. The recorded failure case

```
OWNER_BYPASS_USED_BECAUSE_PROMOTION_ACTOR_AND_CODEOWNER_COLLIDED
```

**Frozen content state — do not alter or recreate the baseline:**

```
main                                 7024203eee3444a0115664de5e3a3d6599d9a800
pre-city-baseline-v1                 7024203eee3444a0115664de5e3a3d6599d9a800
baseline tree                        8e31f066a1b5df7f32c9db47c80aaffd02b78dd5
verified RC commit (same tree)       836b5ed60aa63f3334e6cd08b193113325505880
git diff <RC> <main>                 empty
```

Two independent classifications, deliberately kept apart:

| Classification | Meaning |
|---|---|
| `CONTENT_BASELINE_VALID` | The content is the verified Pre-City baseline. Its tree is byte-identical to the RC commit that passed real Desktop CI and the full local acceptance chain. |
| `PROMOTION_AUTHORIZATION_PATH_NONCONFORMING` | The promotion is **not** acceptable as evidence that Boss and Owner identities are operationally separated. |

## 2. What PR #8 actually shows

[PR #8](https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/8) — `integration/pre-city-baseline` → `main`.

| Fact | Value |
|---|---|
| Merged | yes, `2026-09-21T20:16:27Z` |
| Merge commit | `7024203eee3444a0115664de5e3a3d6599d9a800` |
| Merged by | `zhiheng-zhang-Mera` |
| **Reviews** | **`[]` — zero** |
| **latestReviews** | **`[]` — zero** |
| **reviewDecision** | **`""` — empty** |
| Required checks | all four (`quality`, `unit`, `acceptance`, `package`) `success` on the exact head SHA |
| `require_code_owner_review` at merge time | **`true`** (ruleset `22746755`, `updated_at` predates this programme) |
| Protected path in patch | `/package.json` → `@zhiheng-zhang-Mera` (correctly matched in `.github/CODEOWNERS`) |
| `bypass_actors` | `[User 229580437, bypass_mode: always]`; `current_user_can_bypass: always` |

**PR #8 must not be described as independently approved.** No code-owner approval exists in its record, and
none was ever created. The merge was performed by the same identity that authored the pull request, which is
also the identity holding `bypass_mode: always`.

## 3. Why this is a governance failure and not a platform quirk

At the GitHub identity layer, the proposing actor and the authorizing actor were **the same principal**:

```
author          zhiheng-zhang-Mera
Root CODEOWNER  zhiheng-zhang-Mera      (identical)
merging actor   zhiheng-zhang-Mera      (identical, with always-bypass)
```

The platform then refused the only thing that would have created independent authorization:

```
failed to create review: GraphQL: Review Can not approve your own pull request
```

So the rule could not be satisfied by the actor set that existed. Every individual control behaved exactly as
configured — the requirement was live, the path was protected, the checks were genuinely green — and their
**composition** still produced an unseparated authorization. This is a compositional failure, not a
misconfiguration.

The repository's own documentation states the requirement this violates
(`docs/github-machine-identity.md`, one-time Root Owner bootstrap):

> "Do not use an Owner `gh` login as proof of the Boss App identity."

PR #8 is precisely an Owner `gh` login standing in for the Boss App identity.

## 4. The general claim this supports

> **Declared authority separation was insufficient until principals were separated at the GitHub identity
> layer.**

This is the finding to carry forward, and it is `MEASURED` for this system:

* A separation-of-duties rule expressed only in *policy* (CODEOWNERS + ruleset) is satisfiable in form while
  being degenerate in substance whenever one principal occupies both roles.
* The failure mode is **silent success**, not refusal. A refusal is safe: it stops and is visible. This
  produced a merged commit with a green check record and a non-conforming authority path.
* Therefore authority separation must be verified at the **identity/credential** layer, not inferred from
  policy configuration.

It is also **invisible to every architecture instrument in this repository**, because it lives in roles and
permissions rather than in the source graph. Recorded as `threats-to-validity.md` §7.

Relevant standing principles:

```
BOSS_CAN_MODIFY_ITSELF   != BOSS_CAN_AUTHORIZE_ITSELF
BOSS_CAN_IMPROVE_ITSELF  != BOSS_CAN_CERTIFY_ITSELF
```

## 5. Required resolution — and current blocker

The prescribed resolution is the **intended Boss machine identity (GitHub App)** path. That path already
exists in this repository and has already worked: `docs/github-machine-identity-acceptance.md` records the
App installation creating branch `acceptance/github-machine-identity-20260911015734`, a detached commit, a
non-force push, and [PR #3](https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/3) with **actor
`codex-boss[bot]`**. So the capability is not in question — it simply was not used for this promotion.

### What must be proven (acceptance criteria for `PROMOTION_IDENTITY_SEPARATION_PROVEN`)

1. The machine identity can create/push the candidate branch and open the promotion PR.
2. The machine identity **cannot** satisfy Owner approval itself.
3. `zhiheng-zhang-Mera` remains the independent Root CODEOWNER.
4. Required checks still run normally on the machine-identity PR.
5. No admin/bypass path is needed for normal autonomous promotion.

### Current blocker (measured, not assumed)

```
PRE_CITY_PROMOTION_BLOCKED_BY_IDENTITY_SEPARATION
```

The App credentials are **not present on this host** and **cannot be self-provisioned**. Measured:

| Check | Result |
|---|---|
| `.boss/github-machine-identity.json` | absent |
| `.boss/secret-vault.json` | absent |
| `runtime-data/.boss/github-machine-identity.json` | absent |
| `%LOCALAPPDATA%\CodexBoss`, `%LOCALAPPDATA%\Codex-Boss` | absent |
| `gh` identity | `zhiheng-zhang-Mera` (`gho_…`, user token, scopes `gist, read:org, repo, workflow`) |
| App JWT available | no — `repos/…/Codex-Boss/installation` → `401 A JSON web token could not be decoded` |
| `acceptance:github-machine:live` on `main` | present (`electron dist-electron/electron/github/live-acceptance.js`) |
| `acceptance:promotion-identity:live` | **absent on `main`** — it ships only with the unmerged PF020 branch |

The ceremony requires material only the Root Owner holds (`electron/github/bootstrap.ts`):
`--pem-file`, `--app-id`, `--installation-id`, `--repositories`.

```
pnpm run build:electron
pnpm run bootstrap:github-machine -- --pem-file "D:\private\codex-boss-app.pem" --app-id "APP_ID" --installation-id "INSTALLATION_ID" --repositories "zhiheng-zhang-Mera/Codex-Boss"
```

The bootstrap shows a **local Root Owner confirmation dialog** and encrypts the key with Electron
`safeStorage`. The PEM must never be pasted into chat, a task, `.env`, JSON, a shell argument, logs or
telemetry — **so it must not be sent to this agent.** The ceremony runs on the authorized node, by the Owner.

### Note on PF020 (unchanged)

PF020 stays `NOT MERGED BY DESIGN`. Its `acceptance:promotion-identity:live` script is **not on `main`**, and
PF020's own qualification requirements are not satisfied. It must not be merged to obtain the acceptance
tooling. The live-acceptance step is owed *after* the machine identity is provisioned, and PF020 remains
gated on its own evidence.

## 6. UPDATE — the credential ceremony was completed, and the acceptance then failed materially

The Root Owner ceremony was performed this round. The Owner selected the PEM in a local Windows file picker
and clicked `Register securely` in the Electron confirmation; this programme ran everything else. Result:

```
GITHUB_MACHINE_BOOTSTRAP=OK repositories=1 backend=platform-secure-store
```

The identity is now genuinely installed and correctly configured:

| Field | Value |
|---|---|
| `github-machine-identity.json` | present |
| `secret-vault.json` | present, encrypted, **0** plaintext-PEM markers |
| `logicalIdentity` | `Codex-Boss` |
| `appId` | `4903952` |
| `installationId` | `160744736` |
| `privateKeyRef` | `github/codex-boss` |
| `allowedRepositories` | `zhiheng-zhang-mera/codex-boss` |
| `runtime.configured` | **true** (bounded evidence: the run did not emit `BLOCKED_EXTERNAL`, which only the two credential guards emit) |

**The general `acceptance:promotion-identity:live` preflight then failed — for a non-credential reason:**

```
PROMOTION_IDENTITY_LIVE_ACCEPTANCE=FAIL
RuntimeIsolationError: candidate runtime tree overlaps Stable surfaces: <candidate root inside stable root>
```

### Cause

```
live-promotion-acceptance.ts:58   dataRoot      = appDataUnder(process.cwd())
live-promotion-acceptance.ts:186  evolutionRoot = <dataRoot>/evolution
live-promotion-acceptance.ts:187  createCandidateWorkspace({ stableRoot: process.cwd(), evolutionRoot, ... })
runtime-isolation.ts:82           candidateRoot = <evolutionRoot>/<runId>
runtime-isolation.ts:180          if (isInside(stableRoot, candidateRoot)) overlaps.push("<candidate root inside stable root>")
workspace-manager.ts:117          verifyRuntimeSeparation(layout, stableRoot)
```

Resolved: `stableRoot = D:\Boss-PF020-Live-Acceptance`,
`candidateRoot = D:\Boss-PF020-Live-Acceptance\runtime-data\evolution\<runId>` — strictly nested. In
development mode the acceptance's Stable root *is* the checkout, so §8.3 can never be satisfied. The check is
correct; the acceptance's environment cannot meet the invariant it verifies.

### This is a second instance of the same defect class

| | `OBS-GOV-001` | this (`D-006`) |
|---|---|---|
| Invariant | independent code-owner authorization | Candidate isolated from Stable |
| Requirement enabled? | yes | yes (the check fired) |
| Outcome | **silent success** — promotion completed, zero reviews | **loud refusal** — nothing mutated |

Same class: a correctly specified, correctly enabled invariant that the actual configuration cannot satisfy.
**Opposite failure direction**, and that difference is the finding — the dangerous case is the one that fails
**open**. `OBS-GOV-001` is dangerous; this one is safe, and its safety is demonstrable: 0 branches, 0 PRs,
0 approvals, 0 merges, `main` unchanged.

### Stage status after this attempt

| Stage | Status |
|---|---|
| A — PR #8, same principal, zero independent reviews, promotion completed | **OBSERVED** |
| B — no machine credential, fail-closed `BLOCKED_EXTERNAL`, no Owner fallback | **OBSERVED** |
| C — machine creates the protected candidate but cannot self-authorize | **NOT YET MEASURED** |

**Stage C was not reached.** The protocol never got to the promotion path, so nothing was learned about
whether the machine can self-authorize. It is not `INCONCLUSIVE` either: it is an execution failure
**upstream of the measurement**.

### Terminal state

```
IDENTITY_SEPARATION_TEST_FAILED_OR_BLOCKED
```

The remaining blocker is **no longer a credential**. It is the acceptance instrument's inability to establish
Candidate/Stable separation in development mode. Repairing that is a code change to the acceptance
instrument, which this round forbids; no change was made to PF020, `trust-policy/`, `credential-boundary/`,
`promotion-gate/`, the ruleset, CODEOWNERS or App permissions.

---

## 7. Status

| Field | Value |
|---|---|
| `CONTENT_BASELINE_VALID` | **yes** |
| `PROMOTION_AUTHORIZATION_PATH_NONCONFORMING` | **yes — recorded, not hidden** |
| `PROMOTION_IDENTITY_SEPARATION_PROVEN` | **no** |
| `PRE_CITY_BASELINE_CONTENT_VALID` | **yes** |
| `PF020` | `NOT MERGED BY DESIGN` (unchanged) |
| Root Trust epoch | 24 (`boss-root-trust-24`), `MATCHES` |
| Rules weakened to make progress | **none** |
| History rewritten / baseline recreated | **none** |
| Machine identity | **PRESENT and configured** (ceremony completed this round) |
| Blocking condition now | **the live-acceptance instrument cannot establish Candidate/Stable separation in development mode** (`D-006`) |
| Stage C | `NOT YET MEASURED` |
| Terminal state | `IDENTITY_SEPARATION_TEST_FAILED_OR_BLOCKED` |
