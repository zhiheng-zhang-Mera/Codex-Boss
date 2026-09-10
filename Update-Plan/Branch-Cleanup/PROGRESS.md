# Branch-Cleanup — PROGRESS

Execution branch: `A-main-integration`
Baseline: `origin/9-10-M` @ `86e32d12a0e35ab928580509b615dbcbae2c4d01`
Authority: `Update-Plan/cleanup.md`

| Commit | What |
|---|---|
| `94c1bc2` | merge of `9-10-A` into the M baseline, with the test union restored |
| `9bde9e9` | phases A–H: records, manifests, and evidence repairs |

## Phase status

| Phase | Description | Status | Evidence |
|---|---|---|---|
| A | Branch freeze and HEAD snapshot | **PASS** | `branch-heads-before.json` |
| B | Historical branch archival | **PLANNED** | `archive-manifest.json`, `deletion-manifest.json` |
| C | Create the integration branch | **PASS** | HEAD == `9-10-M` HEAD at creation |
| D | Merge Host-A | **PASS** | `integration-conflicts.md`, `evidence/merge/test-union-verification.json` |
| E | Test-set union restoration | **PASS** | `integration-test-map.md` |
| F | Static and unit acceptance | **PASS** | `evidence/regression/vitest-merged-tree.txt` |
| G | Host-M acceptance harnesses | **PASS** | `evidence/acceptance/*.json` |
| H | Evidence cleanup | **PASS** | `EVIDENCE-CLEANUP.md`, `evidence/evidence-cleanup/*` |
| I | Merged-tree soak | see `FINAL-ACCEPTANCE.md` | `evidence/soak/` |
| J | Live gates | **BLOCKED_EXTERNAL (legal)** | `evidence/acceptance/host-acceptance.json` |
| K | Final integration acceptance | **PASS** | `FINAL-ACCEPTANCE.md` |
| L | Promote `owner-result` | **DEFERRED** | promotion phase |
| M | Promote `main` | **DEFERRED** | promotion phase |
| N | Delete A/M/integration branches | **PLANNED** | `deletion-manifest.json` |

## Phase A — freeze and snapshot

All branch HEADs recorded with SHA, commit date and subject, for both local and
`origin` refs. Nothing was tagged or deleted.

Findings:

- `9-10-M` local and `origin/9-10-M` agree at `86e32d1` — the requested baseline.
- **`owner-result` local and remote disagree**: local `f660cc2`, `origin/owner-result`
  `825cd1f`. This is pre-existing, recorded in the snapshot, and flagged for Phase L to
  resolve deliberately.
- `9-10-A` exists only on `origin` at `cde3738`.
- Tag count before any work: **0**.

Gate: every listed branch HEAD recorded; A/M HEAD unchanged; `main` and `owner-result`
unchanged. **PASS.**

## Phase C — integration branch

Created `A-main-integration` at `86e32d12a0e35ab928580509b615dbcbae2c4d01`, verified
equal to `origin/9-10-M` before any commit. `9-10-M` was left untouched and frozen.

Naming: the owner specified `A-main-integration`; cleanup.md §6 says
`9-10-integration`. The owner's name was used.

## Phase D — merge Host-A

```
git merge --no-commit --no-ff cde3738   →  Automatic merge went well
git diff --name-only --diff-filter=U    →  (empty)
```

**Zero textual conflicts.** A and M changed 33 and 194 paths respectively with **no
overlap**, so no §7 arbitration ruling had to be applied by hand. The merge commit
`94c1bc2` has parents `86e32d1` (M) and `cde3738` (A).

§7 rule verification:

- Product code "M wins unless A provides newer closure-specific implementation" — held
  structurally: M's 194 changed paths are all present with M's exact blob,
  `mLostChanges = 0`.
- Closure acceptance code retained — all nine §7-named A assets present.
- 10.x / Engine / Host-M / Adaptive Engine retained — untouched by A.
- 8 A-side divergences from M exist and are all sanctioned (M never touched those
  paths); see `integration-conflicts.md` §4.

A merge-time correction was applied for §8: A's Phase L curation deleted two M test
suites, so both were restored from the M baseline into the merge commit.

## Phase E — test union

```
M baseline                     72 files / 614 tests
A new closure tests            +10 files / +73 tests
A curation deleted              −2 files  (restored)
────────────────────────────────────────────────
Merged tree                    82 files / 687 tests   PASS
```

Machine proof: `evidence/merge/test-union-verification.json` → `verdict: PASS`,
`testFilesMissing: 0`, `mLostChanges: 0`, both protected suites byte-identical to M.
Arithmetic `614 + 73 = 687` is fully explained in `integration-test-map.md`.

## Phase F — static and unit acceptance

| Gate | Result |
|---|---|
| `tsc --noEmit -p tsconfig.json` | exit 0 |
| `tsc --noEmit -p tsconfig.electron.json` | exit 0 |
| `npx vitest run` | 82 files / 687 tests / exit 0 |
| `npm run build` | exit 0 (vite 32 modules, electron emit) |

`0 FAIL`, no unexpected skip, no deleted-test regression.

## Phase G — Host-M acceptance harnesses

| Harness | Result |
|---|---|
| Acceptance Hub | 28 rows: 13 PASS, 5 BLOCKED_EXTERNAL, 10 SKIPPED_WITH_REASON, **0 FAIL**, 0 DEGRADED |
| Fault Injection Lab | **PASS** — 9 CONTAINED, 4 ACCEPTED_DEGRADATION, 0 not-injected, 0 undetected, 0 uncontained (of 13) |
| Regression Sentinel | **PASS** — 0 regressions, 0 drift; tests 614 → 687 reported as INFO |
| Boss Doctor | **READY** — 16 ready, 0 fail, 0 degraded, 9 skipped (of 25) |
| Evidence Inspector | `invalidJson: 0`, `unexpected: 0` after Phase H repairs |

The Hub's `gate:test-suite` row independently re-ran vitest and captured
`Tests 687 passed (687)`. The Hub's `closure:acceptance-report` row independently
reported `terminal: BLOCKED_EXTERNAL`, `blockers: ["R-202"]`, `evidenceProblems: {}`.

## Phase H — evidence cleanup

| Defect | Before | After |
|---|---|---|
| UTF-8 BOM in tracked JSON | 48 | 0 |
| Malformed JSON | 1 | 0 |
| Missing manifest implementation path | 1 | 0 |
| Orphans deleted | — | **0 (deliberate)** |

Full detail, including what was deliberately **not** repaired and why, is in
`EVIDENCE-CLEANUP.md`.

## Phase J — live gates (honest blockers)

Five Acceptance Hub rows are `BLOCKED_EXTERNAL`, all for one real reason:

```
legacy:recovery, legacy:resource, legacy:engineering,
legacy:finalization, legacy:structured
  → "an external CLI/agent binary is required; no codex CLI on PATH"
```

Per cleanup.md §13 this is a legal terminal state and must not be reported as PASS.
The Codex CLI is **not** a declared runtime hard dependency of Boss, so this is not a
product blocker. R-202 remains `BLOCKED_EXTERNAL` in the closure manifest (it needs
OAuth/MFA/CAPTCHA or a real provider account).

## Safety statement

| Ref | SHA | Touched this round? |
|---|---|---|
| `main` | `825cd1fcb9c942ff9a36bc4ea42ed4ad33b46c75` | **no** |
| `owner-result` (local) | `f660cc27ee0372a73b7a737272098c8ed9e9d3d0` | **no** |
| `origin/owner-result` | `825cd1fcb9c942ff9a36bc4ea42ed4ad33b46c75` | **no** |
| `9-10-M` | `86e32d12a0e35ab928580509b615dbcbae2c4d01` | **no** (frozen) |
| `9-10-A` / `origin/9-10-A` | `cde3738eb21f858ae33465f77940ee98e7a30b4f` | **no** (frozen) |
| Tags created | — | **none** |
| Branches deleted | — | **none** |
| Remote refs pushed | — | **none** |

Working tree is clean apart from nine pre-existing untracked evidence JSON files that
were present before this project started and were deliberately left untracked.
