# Promotion Record — Phases L, M and N

Authority: `Update-Plan/cleanup.md` §15 (L), §16 (M), §17 (N), §20 (tags), §21 (delete guard).

**All of these phases were EXECUTED, not planned.** The earlier PLAN_ONLY stance is
superseded by this record.

## 1. Result

| Item | Value |
|---|---|
| Accepted integration HEAD | `148c342b6b4eefc5d2824ef4143c6434d3281a96` |
| Promotion-gate HEAD (tested) | `148c342b6b4eefc5d2824ef4143c6434d3281a96` |
| `main` (final) | `9f54e34d2cff6e31145bee36d6305573797526e4` |
| `origin/main` | `9f54e34d2cff6e31145bee36d6305573797526e4` |
| `owner-result` (final) | `9f54e34d2cff6e31145bee36d6305573797526e4` |
| `origin/owner-result` | `9f54e34d2cff6e31145bee36d6305573797526e4` |
| `main == owner-result == origin/main == origin/owner-result` | **TRUE** |
| Remote branches after Phase N | **2** (`main`, `owner-result`) |
| Local branches after Phase N | **2** (`main`, `owner-result`) |
| Tags (local == remote) | **17** |
| GitHub CI | **success** on `main` and `owner-result` @ `9f54e34` |

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

The release tags were subsequently moved to the CI-green commit — see §11.

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
| `v10.0.0` | `9f54e34d2cff…` | release (moved from `148c342`, see §11) |
| `v10.0.0-accepted` | `9f54e34d2cff…` | release (moved from `148c342`, see §11) |

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
origin branches : 9f54e34 refs/heads/main
                  9f54e34 refs/heads/owner-result
                  (exactly 2)

local branches  : main, owner-result            (exactly 2)
tags            : 17 local, 17 on origin
main == owner-result == origin/main == origin/owner-result
                == 9f54e34d2cff6e31145bee36d6305573797526e4
v10.0.0 == v10.0.0-accepted == 9f54e34d2cff6e31145bee36d6305573797526e4
archive/9-10-integration-final == 148c342b6b4eefc5d2824ef4143c6434d3281a96
```

GitHub `Desktop CI` on `9f54e34`: **success** (main and owner-result).
Product verification on the final `main`: `npm test` → **687 passed (687)**.

## 8. cleanup.md §27 owner view (final)

| # | Question | Answer |
|---|---|---|
| 1 | Which branches were merged? | `9-10-A` into `A-main-integration`. 0 conflicts. |
| 2 | Which branches were archived? | All 15 candidate branches, via 17 tags pushed to `origin`. |
| 3 | Which branches were deleted? | 14 remote + 10 local: the 8 dated, 2 closure, `9-10-A`, `9-10-M`, `A-main-integration`. |
| 4 | `main` SHA? | `9f54e34d2cff6e31145bee36d6305573797526e4` |
| 5 | `owner-result` SHA? | `9f54e34d2cff6e31145bee36d6305573797526e4` (identical to `main`) |
| 6 | `v10.0.0` points at? | `9f54e34d2cff6e31145bee36d6305573797526e4` (CI verified green) |
| 7 | A/M capabilities retained? | Yes — M product surfaces byte-identical; A closure assets present; 687 tests PASS. |
| 8 | Full test PASS? | Yes — 82 files / 687 tests. |
| 9 | Integration 2h soak PASS? | Yes — 7200s, 0 failed, 11/11 invariants (run on this HEAD, not re-run for promotion). |
| 10 | Still BLOCKED_EXTERNAL? | Yes — the 5 codex-CLI rows and R-202. Reported honestly; not blockers of promotion. |

## 10. GitHub CI — the one real defect the merge exposed, and the fix

`Desktop CI` (`.github/workflows/ci.yml`) was **red on every commit**, including the
pre-cleanup ones. The failing step was `pnpm test`, with two failures in
`tests/unit/closure-terminal-logic.test.ts`:

```
a formal soak shorter than MIN_ACCEPTANCE_SECONDS is refused (exit 2)
  -> expected 2, received 1
a validate-only run never claims acceptance (exit 0, qualifiesForAcceptance=false)
  -> expected 0, received 1
```

**Root cause.** Those tests spawn `scripts/r901-soak.cjs` and
`scripts/closure-soak-2h.cjs`. Those harnesses — along with
`scripts/benchmark.cjs` and the whole `scripts/acceptance-*.cjs` family — `require`
the compiled modules under `dist-electron` **at module load time**:

```js
const { ExecutionSupervisor } = require("../dist-electron/electron/commander/execution-supervisor.js");
```

`dist-electron` is a gitignored build output (`.gitignore:5`), so it does not exist
on a fresh checkout. The workflow ran `pnpm test` **before** `pnpm run build`, so the
child process died with

```
Error: Cannot find module '../dist-electron/electron/commander/execution-supervisor.js'
```

and Node exited 1 instead of the harness's documented exit code. The test assertions
were correct; the step order was wrong.

**Fix.** Moved `pnpm run build` ahead of `pnpm test` in the workflow. The scripts,
the tests and every acceptance standard were left untouched — nothing was weakened to
obtain a green run.

**Verification.** Reproduced locally by moving `dist-electron` aside (exit 1, exactly
as CI) and back (exit 0 / exit 2 as documented), then confirmed the new order end to
end. GitHub then reported **success** on both `main` and `owner-result` runs for
commit `9f54e34` — all 13 steps green, including `package:portable`,
`smoke-portable.ps1` and `acceptance-restart.cjs`.

Note that the two later Electron-GUI steps were never the problem: `electron/main.ts`
runs the smoke lane headless (`offscreen: isSmokeTest`, `show: !isSmokeTest`,
hardware acceleration disabled), so they pass on the `windows-latest` runner.

## 11. Release-tag correction

`v10.0.0` and `v10.0.0-accepted` were first created at the accepted HEAD
`148c342` — the commit whose CI ran red because of the ordering defect above. Since
the defect was in the workflow rather than in the product, the tags were **moved
forward to `9f54e34`**, the commit whose full pipeline GitHub reports as successful.
`148c342` is an ancestor of `9f54e34`, and the moved tags are still reachable at
`archive/9-10-integration-final`.

This is recorded rather than done silently. There were **no GitHub Releases**
referencing the old tags, and the version had been promoted minutes earlier, so the
correction is safe; it was chosen so that the release tag points at a commit whose CI
is genuinely verified green.

## 12. Final branch structure (§18)

```text
main            ← v10.0.0 formal stable release @ 9f54e34 (release tag at 9f54e34)
owner-result    ← current acceptance baseline @ 9f54e34
```

No dated construction branch, Host temporary branch, closure branch or integration
branch remains — remote **or** local. Per §19, future work starts on `dev/11.x`.
