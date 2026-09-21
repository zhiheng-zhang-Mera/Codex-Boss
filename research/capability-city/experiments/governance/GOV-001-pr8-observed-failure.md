# OBS-GOV-001 — Promotion actor and Root CODEOWNER collided

```
OBSERVATION_ID       OBS-GOV-001
CLASSIFICATION       OWNER_BYPASS_USED_BECAUSE_PROMOTION_ACTOR_AND_CODEOWNER_COLLIDED
STATUS               OBSERVED (this is a measured result, not a hypothesis)
STAGE                A of A/B/C  (see PAPER_NOTES.md "governance case study")
```

All values below were re-measured from the live platform and the frozen local repository at capture
time. Raw API snapshots: `dataset/github/pr8.json`, `dataset/github/main-protection-ruleset.json`.

---

## Required record

| Field | Value |
|---|---|
| **PR number** | `8` — https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/8 |
| **Candidate SHA** | `836b5ed60aa63f3334e6cd08b193113325505880` |
| **Merge SHA** | `7024203eee3444a0115664de5e3a3d6599d9a800` |
| **Merge commit tree** | `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` |
| **Author principal** | `zhiheng-zhang-Mera` (id `U_kgDODa8elQ`, `is_bot: false`) |
| **Merging principal** | `zhiheng-zhang-Mera` (id `U_kgDODa8elQ`) — **same principal as author** |
| **CODEOWNER principal** | `@zhiheng-zhang-Mera` — **same principal as author** |
| **Review count** | **`0`** — `reviews: []`, `latestReviews: []`, `reviewRequests: []`, `reviewDecision: ""` |
| **Independent approval existed?** | **No.** No approval object of any kind exists on the PR. |
| **Required-check state** | All four `success` on the exact candidate SHA: `quality`, `unit`, `acceptance`, `package` |
| **Base SHA at open** | `4da0ed079c3a59362bc92b15091f7907ef064de7` |
| **Merge state at capture** | `MERGED` (`mergeStateStatus: UNKNOWN` post-merge — GitHub stops reporting it) |
| **Authorization path conforming?** | **No** → `PROMOTION_AUTHORIZATION_PATH_NONCONFORMING` |

### Ruleset state — `Main-Protection` (id `22746755`)

Read live from the API, not from documentation.

| Setting | Value |
|---|---|
| `enforcement` | `active` |
| `conditions.ref_name.include` | `refs/heads/main` |
| `rules` | `deletion`, `non_fast_forward`, `creation`, `required_status_checks`, `pull_request` |
| `required_status_checks` | `quality`, `unit`, `acceptance`, `package` — all `integration_id 15368` |
| `strict_required_status_checks_policy` | `true` |
| `required_approving_review_count` | `0` |
| **`require_code_owner_review`** | **`true`** |
| `allowed_merge_methods` | `merge`, `squash`, `rebase` |
| `bypass_actors` | `[ { actor_id: 229580437, actor_type: User, bypass_mode: always } ]` |
| `current_user_can_bypass` | `always` |
| `updated_at` | `2026-09-19T18:08:25+10:00` — **predates this programme**, so the ruleset was not altered to enable the merge |

### CODEOWNERS rules relevant to this patch

The patch touched **111 files**. Exactly **one** of them matches a CODEOWNERS rule:

```
/package.json                              @zhiheng-zhang-Mera
```

Its only change is the additive script
`"package:installer": "node scripts/package-installer.cjs"`. No script that `ci.yml` invokes is modified,
so the required-check indirection surface was untouched. All other CODEOWNERS rules —
`/.github/CODEOWNERS`, `/.github/workflows/`, `/pnpm-lock.yaml`, `/trust-policy/`, `/tests/acceptance/`,
`/electron/root-authority/`, `/electron/credential-boundary/`, `/electron/promotion-gate/`,
`/scripts/acceptance-*.cjs` — match **zero** files in this changeset.

### Baseline content identity

| Field | Value |
|---|---|
| `pre-city-baseline-v1` target | `7024203eee3444a0115664de5e3a3d6599d9a800` |
| Promoted `main` SHA | `7024203eee3444a0115664de5e3a3d6599d9a800` |
| `origin/main^{tree}` | `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` |
| `pre-city-baseline-v1^{tree}` | `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` |
| Verified RC `836b5ed^{tree}` | `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5` |
| `git diff pre-city-baseline-v1 origin/main` | **EMPTY** (0 lines) |
| **Protected content differed?** | **No.** The protected file (`package.json`) changed only by the additive script above; no protected *authority* content changed. |

---

## Structured case record (for the paper)

### Observed system configuration

An autonomous-evolution platform whose governance model declares that self-modification and
self-authorization are distinct (`BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF`). The separation is
expressed as platform *policy*: a `Main-Protection` ruleset requiring a pull request, four named required
status checks, an up-to-date branch, and a code-owner review; plus a `.github/CODEOWNERS` file naming
`@zhiheng-zhang-Mera` as the owner of the sensitive paths. The ruleset names exactly one always-bypass actor:
`zhiheng-zhang-Mera`.

### Expected invariant

A promotion to the protected branch requires an authorization by a principal **distinct from** the principal
that proposed it. Formally: `approver != author`.

### Actual event

The candidate branch was pushed and PR #8 opened **by `zhiheng-zhang-Mera`**; the required code-owner for the
one protected path in the patch is **`@zhiheng-zhang-Mera`**; and the merge was performed **by
`zhiheng-zhang-Mera`**. The one action that could have created independent authorization was refused by the
platform:

```
failed to create review: GraphQL: Review Can not approve your own pull request
```

The pull request merged with **zero reviews** in its record. `approver != author` was therefore **satisfied
by nobody**, and the promotion nevertheless completed.

### Observable facts

1. `require_code_owner_review` was `true` and the ruleset's `updated_at` predates the programme.
2. The protected path `/package.json` was **correctly matched** by CODEOWNERS.
3. All four required checks were **genuinely green** on the exact candidate SHA.
4. The PR record contains **zero reviews** and empty `reviewDecision`.
5. The merge was performed by the same principal that authored the PR, which is also the only
   `bypass_mode: always` actor.
6. `main` advanced, and the resulting tree is byte-identical to the verified candidate tree.
7. The platform **refused** the review that would have made authorization independent.

### Non-observable facts

```
NOT OBSERVABLE FROM CURRENT EVIDENCE
```

* Whether GitHub evaluated `require_code_owner_review` as **satisfied** (e.g. because the reviewer identity
  and the author identity are the same principal) or **admitted the Root Owner through the bypass path**.
  The PR, review and ruleset APIs expose the *outcome*, not the *decision path*, and no bypass event is
  recorded on the PR object.
* Whether a hypothetical second human principal would have been required to approve, or whether the merge
  would have proceeded identically.

**Therefore the claim "GitHub definitely bypassed CODEOWNER review" is NOT supported and must not be made.**
What is supported is the observable result: *a merge with zero independent reviews, performed by the same
principal that authored the change.* Proving the mechanism requires the controlled experiment frozen in
`GOV-002` and is currently `PENDING`.

### Engineering consequence

The promoted content is unaffected: `CONTENT_BASELINE_VALID` holds, and the baseline tag binds exactly the
promoted content. The engineering consequence is confined to the **authorization path**, which is
`NONCONFORMING` and therefore cannot be cited as evidence that Boss and Owner are operationally separated.
Any subsystem that reasons "a merge happened, so an independent authorization happened" is unsound on this
platform configuration.

### Research consequence

This is a **real-world observed failure**, not a seeded or synthetic one, which makes it unusually strong
evidence for the programme (see `threats-to-validity.md` §3, which prefers observed over seeded evidence).
It establishes, for this system:

> Declared authority separation was insufficient until principals were separated at the GitHub identity
> layer.

Two further properties make it valuable:

* **The failure mode was silent success, not refusal.** A refusal is safe and visible; this produced a merged
  commit with a green check record and an empty review record. Systems that treat "merge succeeded" as
  evidence of authorization are wrong in a way that leaves no error to observe.
* **It is invisible to every architecture instrument in this repository**, because it lives in roles and
  permissions rather than in the source graph — recorded as `threats-to-validity.md` §7. A programme that
  measures only the source graph would report "no coupling" for this entire class of coupling.

It also falsifies a tempting inference directly: this programme's own first analysis concluded that bypass
was *the only* executable path and that the promotion was *blocked*. It was not blocked. The rule was
satisfiable in form while degenerate in substance — the dangerous case is not an unsatisfiable rule but a
**satisfiable-looking rule with a one-element actor set**.

---

## Provenance

| Field | Value |
|---|---|
| Captured at commit | `daf20c4` (city branch) |
| Captured from | live GitHub API + frozen local repository |
| Raw snapshots | `dataset/github/pr8.json`, `dataset/github/main-protection-ruleset.json` |
| Reproduce | `gh pr view 8 --json number,state,mergedBy,author,reviews,latestReviews,reviewDecision,mergeCommit,headRefOid` |
| | `gh api repos/zhiheng-zhang-Mera/Codex-Boss/rulesets/22746755` |
| | `git diff pre-city-baseline-v1 origin/main` → expect empty |
| History rewritten / baseline recreated | **no** |
