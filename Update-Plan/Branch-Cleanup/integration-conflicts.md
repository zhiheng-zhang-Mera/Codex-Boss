# Integration Conflicts — `9-10-A` into `A-main-integration`

Authority: `Update-Plan/cleanup.md` §7 (conflict arbitration) and §22 (failure isolation).

## 1. Summary

| Item | Value |
|---|---|
| Integration branch | `A-main-integration` |
| Baseline (M) | `9-10-M` @ `86e32d12a0e35ab928580509b615dbcbae2c4d01` |
| Source (A) | `9-10-A` @ `cde3738eb21f858ae33465f77940ee98e7a30b4f` |
| Fork point | `8b0675f2d11650850d17f6f9af272f5f01b8e6c4` |
| Merge commit | `94c1bc23033d26814285f81112be2a8c8dee4b1c` |
| **Textual merge conflicts** | **0** |
| Files changed on M side | 194 |
| Files changed on A side | 33 |
| Paths changed on both sides | 0 |
| M-side changes lost by merge | 0 |
| A-side updates applied | 8 (all sanctioned) |

## 2. Why there were zero conflicts

`9-10-M` and `9-10-A` diverged from `8b0675f2` and edited **disjoint sets of file
paths**. M advanced the product surface (`electron/tenx/**`, `electron/learning/**`,
`electron/host/**`, `src/shared/tenx/**` and the 10.x/Engine/Host-M layers); A
advanced the closure acceptance surface (`scripts/closure-*`, `scripts/r901-soak.cjs`,
`scripts/live-r202-provider-repair.cjs`, `Update-Plan/2026-09-09-closure/**`).

A trial `git merge --no-commit` was run first and reported
`Automatic merge went well` with an empty `--diff-filter=U` set. The merge was then
committed for real, preserving the double parentage
(`94c1bc2` has parents `86e32d1` and `cde3738`).

Because no path was edited on both sides, **no arbitration ruling under §7 was
actually needed.** This is recorded explicitly: "M wins unless A provides newer
closure-specific implementation" and "10.x / Engine / Host-M must keep M" were both
satisfied structurally rather than by manual adjudication.

## 3. §7 rule checking

### 3.1 Product code — `M wins unless A provides newer closure-specific implementation`

M's product surface is untouched by the merge. Verified in
`evidence/merge/test-union-verification.json`:

```
mChangedPaths      = 194
mLostChanges       = 0
mChangesPreserved  = 194
```

Every one of the 194 paths M changed is present in the merged tree with M's exact
blob. Nothing A carried overrode product code, because A never touched a product path.

### 3.2 Closure acceptance code — A content retained

All named A assets from §7 are present in the merged tree:

| §7 named asset | Present |
|---|---|
| `closure-terminal-logic.mjs` | yes |
| `closure-set-status.mjs` | yes |
| `closure-final-regression.mjs` | yes |
| `live-r202-provider-repair.cjs` | yes |
| `r901-soak.cjs` | yes |
| `start-r901-soak.ps1` | yes |
| Host-A final evidence | yes (`final-regression.json`, `minimal-suite-regression.json`) |
| R202 live evidence | yes (`r202-live-provider-repair.json`) |
| R901 7202s evidence | yes (`r901-2026-09-10T00-33-51Z-2daa9e6e.json` + heartbeat) |

### 3.3 10.x / Engine / Host-M — M retained

Verified present and unmodified relative to `9-10-M`:
`electron/tenx/**`, `electron/learning/**`, `electron/host/**`, `src/shared/tenx/**`,
Adaptive Provider Intelligence, the Host-M maturity layer (Acceptance Hub, Fault Lab,
Regression Sentinel, Doctor, Observer, Evidence Inspector).

## 4. The 8 A-side divergences from M (sanctioned, not defects)

These 8 paths differ from `9-10-M`, and in every case **M never touched the path** —
so the difference is A's own work under §7, not a lost M change. (A ninth
A-side path, `r901-soak-2h-heartbeat.json`, was deleted by A and is classified
`a-side-deletion` below.)

| Path | Kind | Rationale |
|---|---|---|
| `Update-Plan/2026-09-09-closure/ACCEPTANCE-MATRIX.md` | a-side-update | closure acceptance asset (§7) |
| `Update-Plan/2026-09-09-closure/FINAL-ACCEPTANCE.md` | a-side-update | closure acceptance asset (§7) |
| `Update-Plan/2026-09-09-closure/PROGRESS.md` | a-side-update | closure execution record (§7) |
| `Update-Plan/2026-09-09-closure/requirement-manifest.json` | a-side-update | closure manifest (§7) |
| `Update-Plan/2026-09-09-closure/evidence/r1003-acceptance-report.json` | a-side-update | closure terminal evidence (§7) |
| `scripts/closure-acceptance-report.mjs` | a-side-update | closure report runner (§7) |
| `scripts/closure-soak-2h.cjs` | a-side-update | legacy soak harness, deprecated by A in favour of `r901-soak.cjs` (§7) |
| `Update-Plan/2026-09-09-closure/evidence/r901-soak-2h-heartbeat.json` | a-side-deletion | superseded by A's R-901 durable run evidence; M never touched it |

### 4.1 On the deprecated soak harness

A's commit `e68624b` ("Host-A Phase L map + deprecate legacy soak harness (S6)") is
the provenance for both `closure-soak-2h.cjs` being rewritten and the old heartbeat
file being retired. The replacement durable engine is `scripts/r901-soak.cjs` with
`scripts/start-r901-soak.ps1`. The retired artifact's observations are superseded by
`r901-2026-09-10T00-33-51Z-2daa9e6e.json`, whose run is the 7202-second soak cited
in §7. This is an upgrade of the evidence, not a loss of it.

## 5. Phase E correction applied during the merge

A's Phase L "minimal test curation" deleted two M test files. Those deletions are
inherited by any naïve merge, and cleanup.md §8 forbids inheriting them as product
state. Both were restored from the M baseline and staged into the merge commit:

| Test file | M blob | Restored blob | Match |
|---|---|---|---|
| `tests/unit/autonomy-supervisor.test.ts` | `71b617f0…` | `71b617f0…` | identical |
| `tests/unit/decision-ledger.test.ts` | `aa1a9565…` | `aa1a9565…` | identical |

Details and the full union arithmetic are in `integration-test-map.md`.

## 6. Failure isolation (§22) — not triggered

No step failed, so no rollback path was exercised. For the record, the protections
that were in place and were left untouched throughout this phase:

- `main` @ `825cd1fcb9c942ff9a36bc4ea42ed4ad33b46c75` — unmodified
- `owner-result` (local) @ `f660cc27ee0372a73b7a737272098c8ed9e9d3d0` — unmodified
- `owner-result` (origin) @ `825cd1fcb9c942ff9a36bc4ea42ed4ad33b46c75` — unmodified
- `9-10-M` @ `86e32d12a0e35ab928580509b615dbcbae2c4d01` — frozen, unmodified
- `9-10-A` @ `cde3738eb21f858ae33465f77940ee98e7a30b4f` — frozen, unmodified

> **Note for the promotion phase:** local `owner-result` (`f660cc2`) and remote
> `origin/owner-result` (`825cd1f`) **disagree** before this project began. That
> divergence is pre-existing and was recorded in `branch-heads-before.json`. Phase L
> must decide deliberately which of the two it archives as `archive/owner-result-r43`
> rather than assuming they are the same commit.

## 7. Evidence

- `evidence/merge/test-union-verification.json` — machine-checked superset proof
- `evidence/merge/merge-commit-message.txt` — the merge commit message as committed
- `branch-heads-before.json` — all branch HEADs before work began
