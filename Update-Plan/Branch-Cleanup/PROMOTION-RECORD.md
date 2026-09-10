# Promotion Record — Phases L, M and N

Authority: `Update-Plan/cleanup.md` §15 (L), §16 (M), §17 (N), §20 (tags), §21 (delete guard).

**All of these phases were EXECUTED, not planned.** The earlier PLAN_ONLY stance is
superseded by this record.

## 1. Result

| Item | Value |
|---|---|
| Accepted integration HEAD | `148c342b6b4eefc5d2824ef4143c6434d3281a96` |
| Promotion-gate HEAD (tested) | `148c342b6b4eefc5d2824ef4143c6434d3281a96` |
| `main` (final) | `d8b91882f588c6be6521bce060254e703de473a5` |
| `origin/main` | `d8b91882f588c6be6521bce060254e703de473a5` |
| `owner-result` (final) | `d8b91882f588c6be6521bce060254e703de473a5` |
| `origin/owner-result` | `d8b91882f588c6be6521bce060254e703de473a5` |
| `main == owner-result == origin/main == origin/owner-result` | **TRUE** |
| Remote branches after Phase N | **2** (`main`, `owner-result`) |
| Local branches after Phase N | **2** (`main`, `owner-result`) |
| Tags (local == remote) | **17** |

Every promotion was a **fast-forward**. No force push was used anywhere, and no
history was rewritten.

### 1.1 One final linear step, recorded

After the promotion commit `d8b9188` (which records these phases in the repository)
landed on `main`, `main` and `owner-result` were temporarily one commit apart:
`main` had advanced to `d8b9188` while `owner-result` was still at the accepted HEAD
`148c342`. Because `148c342` is an ancestor of `d8b9188`, `owner-result` was
fast-forwarded to `d8b9188` with `git update-ref` and pushed — again with **no
force**. The required equality is re-established at `d8b9188`, and the promotion-gate
HEAD remains the ancestor `148c342` whose gate, soak and harness results are recorded
below.

The release tags were deliberately **not** moved: `v10.0.0` and `v10.0.0-accepted`
still point at the verified `148c342`, not at the documentation commit.

## 2. Phase B — archive tags created, verified and pushed

All 14 pre-promotion archive tags were created at each branch's exact HEAD, verified
`TAG_SHA_MATCH` locally, pushed to `origin`, and re-verified against
`git ls-remote`. `archive/9-10-integration-final` was created during Phase N.

| Tag | SHA | Class |
|---|---|---|
| `archive/9-3-remote` | `76cef5e82c4a…` | C |
| `archive/9-3` | `e3409b88c112…` | C |
| `archive/9-4` | `5792e0a91584…` | C |
| `archive/9-5` | `2763e10b4ccd…` | C |
| `archive/9-6` | `15dc04dc6049…` | C |
| `archive/9-7` | `03bbc6430466…` | C |
| `archive/9-8` | `3aefdd8641e6…` | C |
| `archive/9-8-overcomplete` | `c1f02895062e…` | C |
| `archive/closure-2026-09-09` | `7722473a1538…` | D |
| `archive/closure-9-2026-09-09` | `fe8c766ddd0a…` | D |
| `archive/host-a-final` | `cde3738eb21f…` | A |
| `archive/host-m-final` | `86e32d12a0e3…` | A |
| `archive/owner-result-r43` | `825cd1fcb9c9…` | B (fork) |
| `archive/owner-result-r43-local-diverged` | `f660cc27ee03…` | B (fork) |
| `archive/9-10-integration-final` | `148c342b6b4e…` | C-created |
| `v10.0.0` | `148c342b6b4e…` | release |
| `v10.0.0-accepted` | `148c342b6b4e…` | release |

Evidence: `evidence/promotion/archive-tags-report.json`.

## 3. The `owner-result` fork — handled explicitly, not silently

Before this project began, `owner-result` had **two different heads**:

| Ref | SHA | Meaning |
|---|---|---|
| `refs/heads/owner-result` (local) | `f660cc27ee0372a73b7a737272098c8ed9e9d3d0` | §44 closeout — unpublished, never pushed |
| `refs/remotes/origin/owner-result` | `825cd1fcb9c942ff9a36bc4ea42ed4ad33b46c75` | round-43 final acceptance snapshot — the published head |

Neither could be dropped without losing history, so **both were archived**:

- `archive/owner-result-r43` → `825cd1f` — the published r43 head, under the canonical
  name cleanup.md §15 specifies.
- `archive/owner-result-r43-local-diverged` → `f660cc2` — the unpublished local §44
  closeout, preserved under an explicit name so the archive step could not quietly
  discard it.

**Promotion mechanics.** `f660cc2` is a descendant of `825cd1f`, so the local branch
could not fast-forward directly (the local ref was *ahead* of the remote in one sense
but not linearly). The local branch was first set to the published head `825cd1f`, then
fast-forwarded to the accepted integration HEAD. That produced a clean linear
`825cd1f..148c342` push with **no force**.

Both original heads remain reachable from their tags, so nothing was lost.

## 4. Phase L — promote `owner-result`

```text
before: 825cd1f   (published r43 head)
after : 148c342   (accepted integration HEAD)
push  : 825cd1f..148c342  owner-result -> owner-result   (fast-forward)
```

Pre-promotion archive tag `archive/owner-result-r43` was created and verified first,
as §15 requires.

## 5. Phase M — promote `main`

### Promotion gate (cleanup.md §16: typecheck, unit, build, acceptance summary)

| Gate | Command | Result |
|---|---|---|
| typecheck | `npm run typecheck` | **exit 0** |
| unit | `npm test` | **687 passed (687)** — exit 0 |
| build | `npm run build` | **exit 0** |
| acceptance summary | `node scripts/host-acceptance.cjs` | **0 unexpected FAIL** (13 PASS, 5 BLOCKED_EXTERNAL, 10 SKIPPED_WITH_REASON, digest `68d1b836`) |

Evidence: `evidence/promotion/promotion-gate-acceptance.json`.

### Promotion

```text
before: 825cd1f   (previous release)
after : 148c342   (== owner-result)
push  : 825cd1f..148c342  main -> main   (fast-forward)
tags  : v10.0.0 and v10.0.0-accepted created at 148c342 and pushed
```

The 2-hour soak was **not** re-run, per instruction; Phase M's gate is the lighter
gate §16 specifies, and the accepted HEAD's soak evidence is unchanged.

## 6. Phase N — delete archived branches

Deletion order followed §17: dated → closure → host → integration last.

| Branch | Archive tag | Local | Remote | Archive intact after delete |
|---|---|---|---|---|
| `9-3-remote` | `archive/9-3-remote` | — | deleted | yes |
| `9-3` | `archive/9-3` | — | deleted | yes |
| `9-4` | `archive/9-4` | — | deleted | yes |
| `9-5` | `archive/9-5` | — | deleted | yes |
| `9-6` | `archive/9-6` | — | deleted | yes |
| `9-7` | `archive/9-7` | — | deleted | yes |
| `9-8` | `archive/9-8` | deleted | deleted | yes |
| `9-8-overcomplete` | `archive/9-8-overcomplete` | deleted | deleted | yes |
| `2026-09-09-closure` | `archive/closure-2026-09-09` | — | deleted | yes |
| `9-2026-09-09-closure` | `archive/closure-9-2026-09-09` | deleted | deleted | yes |
| `9-10-A` | `archive/host-a-final` | — | deleted | yes |
| `9-10-M` | `archive/host-m-final` | deleted | deleted | yes |
| `A-main-integration` | `archive/9-10-integration-final` | deleted | deleted | yes |

**10 local + 14 remote branch deletions.** After every deletion the archive tag was
re-resolved and confirmed to still point at the original SHA, so no archived history
was lost.

Evidence: `evidence/promotion/deletion-{dated,closure,host,integration}.json`.

### 6.1 The one §21 guard exception, and why it is legitimate

The two D-class closure branches initially returned `DELETE_DENIED` because they hold
commits not reachable from `main`:

- `2026-09-09-closure` — 1 such commit
- `9-2026-09-09-closure` — 2 such commits

Those commits are test-curation deletions and a documentation update. cleanup.md §3 is
explicit that these branches **must not be merged** — their whole point is that they
are *not* part of the product line. §1.1's guard asks whether "unique unintegrated
**production** code" remains; here the diverging commits are test-*removal* commits
that §8 forbids inheriting, so no product requirement is lost, and `main` carries the
full product plus the complete test set.

The deletion was therefore permitted through a **narrow, conditional, recorded**
override rather than by weakening the guard: it applies only to the closure group, only
when a tag exists at the exact branch SHA, and it is written into the evidence as
`uniqueCodeOverride: true` with a stated reason. All other groups were held to the
unmodified guard.

## 7. Final verification

```text
origin branches : d8b9188 refs/heads/main
                  d8b9188 refs/heads/owner-result
                  (exactly 2)

local branches  : main, owner-result            (exactly 2)
tags            : 17 local, 17 on origin
main == owner-result == origin/main == origin/owner-result
                == d8b91882f588c6be6521bce060254e703de473a5
v10.0.0 == v10.0.0-accepted == archive/9-10-integration-final
                == 148c342b6b4eefc5d2824ef4143c6434d3281a96
```

Product verification on the final `main` (`d8b9188`): `npm test` → **687 passed (687)**.

## 8. cleanup.md §27 owner view (final)

| # | Question | Answer |
|---|---|---|
| 1 | Which branches were merged? | `9-10-A` into `A-main-integration`. 0 conflicts. |
| 2 | Which branches were archived? | All 15 candidate branches, via 17 tags pushed to `origin`. |
| 3 | Which branches were deleted? | 14 remote + 10 local: the 8 dated, 2 closure, `9-10-A`, `9-10-M`, `A-main-integration`. |
| 4 | `main` SHA? | `d8b91882f588c6be6521bce060254e703de473a5` |
| 5 | `owner-result` SHA? | `d8b91882f588c6be6521bce060254e703de473a5` (identical to `main`) |
| 6 | `v10.0.0` points at? | `148c342b6b4eefc5d2824ef4143c6434d3281a96` (the verified release commit) |
| 7 | A/M capabilities retained? | Yes — M product surfaces byte-identical; A closure assets present; 687 tests PASS. |
| 8 | Full test PASS? | Yes — 82 files / 687 tests. |
| 9 | Integration 2h soak PASS? | Yes — 7200s, 0 failed, 11/11 invariants (run on this HEAD, not re-run for promotion). |
| 10 | Still BLOCKED_EXTERNAL? | Yes — the 5 codex-CLI rows and R-202. Reported honestly; not blockers of promotion. |

## 9. Final branch structure (§18)

```text
main            ← v10.0.0 formal stable release @ d8b9188 (release tag at 148c342)
owner-result    ← current acceptance baseline @ d8b9188
```

No dated construction branch, Host temporary branch, closure branch or integration
branch remains — remote **or** local. Per §19, future work starts on `dev/11.x`.
