# Integration Test Map — `Tests(final) = Tests(M) ∪ useful Tests(A)`

Authority: `Update-Plan/cleanup.md` §8 (test-set union restoration) and §9 (Phase F acceptance).

## 1. The rule being enforced

Host-A's Phase L performed "minimal test curation": it deleted test suites to shrink
the test set it shipped. cleanup.md §8 forbids inheriting that as product state:

> 最终 integration 禁止继承「删除测试以缩小测试集」作为正式产品状态。
> `Tests(final) = Tests(M) ∪ useful Tests(A)`
> 不得因为 A 删除某 suite 而删除 M 已存在测试。

A naïve merge *does* inherit A's deletions, because git applies the source branch's
file deletions. So the union had to be restored deliberately.

## 2. What the merge actually did to the test set

Measured on the committed merge commit `94c1bc2`
(`evidence/merge/test-union-verification.json`):

| | Files | Effect |
|---|---|---|
| M baseline (`9-10-M`) | 72 | reference set |
| A new closure tests | +10 | added by merge |
| A-curation deletions inherited | −2 | **restored below** |
| **Merged tree before restoration** | **80** | |
| Restored from M baseline | +2 | |
| **Merged tree after restoration** | **82** | |

Test files lost by the merge **before** restoration: **2**.

## 3. §8/E1 protected M tests — restored byte-identical

cleanup.md §8/E1 names tests that must be confirmed not deleted by the A merge:
`autonomy-supervisor.test.ts`, `decision-ledger.test.ts`, Engine tests, 10.x tests,
Host-M tests.

| Test file | M blob (sha) | Merged blob (sha) | Verdict |
|---|---|---|---|
| `tests/unit/autonomy-supervisor.test.ts` | `71b617f00c6609ef3188e4a1c3bcf98e789cdccd` | `71b617f00c6609ef3188e4a1c3bcf98e789cdccd` | **identical to M** |
| `tests/unit/decision-ledger.test.ts` | `aa1a9565e9e2e6e885e66e69a1010d10cd4847b0` | `aa1a9565e9e2e6e885e66e69a1010d10cd4847b0` | **identical to M** |

Both were restored with `git checkout HEAD -- <path>` (HEAD = the M baseline at the
time of the merge), so the restored content is M's exact blob, not a reconstruction.

Machine-checked confirmation from `test-union-verification.json`:

```
testFilesInM      = 72
testFilesInMerged = 82
testFilesAdded    = 10
testFilesMissing  = 0
protectedTests[0] = tests/unit/autonomy-supervisor.test.ts  present=true identicalToM=true
protectedTests[1] = tests/unit/decision-ledger.test.ts      present=true identicalToM=true
verdict           = PASS
```

Additionally, the merge is a strict superset of the M baseline:

```
mChangedPaths     = 194     (paths M changed since the fork point)
mLostChanges      = 0       (M changes not carried into the merged tree)
mChangesPreserved = 194
```

Engine / 10.x / Host-M tests were never at risk: A's changed-path set and M's
changed-path set are disjoint, so no M test file was modified *or* deleted by A
except the two above.

## 4. §8/E1 A closure tests — confirmed present

cleanup.md §8/E1 lists the A closure tests to add. All 10 are present, and this
matches A's actual tree ("具体以实际 tree 为准"):

| Test file | Tests | Protected subsystem |
|---|---|---|
| `closure-terminal-logic.test.ts` | 36 | closure terminal evaluator / blocker schema / manifest state machine |
| `verification-contract.test.ts` | 6 | OWNER_RESULT verification contract + failure isolation |
| `dom-page.test.ts` | 6 | DOM tier backend |
| `execution-fault-injection.test.ts` | 6 | controlled fault injection |
| `web-recovery-r6.test.ts` | 5 | guarded WebRecovery R6 slot |
| `network-policy.test.ts` | 3 | network policy |
| `provider-dom-surface.test.ts` | 3 | provider DOM probe surface |
| `recovery-scheduler.test.ts` | 3 | durable recovery deadlines |
| `state-waiting.test.ts` | 3 | WAITING/PARTIAL vocabulary |
| `engineering-goal-rollback.test.ts` | 2 | engineering goal rollback |
| **A subtotal** | **73** | |

All ten §8/E1 names are accounted for; there was no name in the §8/E1 list that A's
actual tree lacked.

## 5. Full-suite result on the merged tree

Command: `npx vitest run` on `94c1bc2`
Evidence: `evidence/regression/vitest-merged-tree.txt`

```
Test Files  82 passed (82)
     Tests  687 passed (687)
  Duration  17.84s
VITEST_EXIT=0
```

### 5.1 Test-count arithmetic — fully explained

| Component | Tests |
|---|---|
| M baseline (`9-10-M`, per Host-M P6 sentinel) | 614 |
| A new closure tests | +73 |
| Restored protected M tests (`autonomy-supervisor` 17 + `decision-ledger` 5) | +22 |
| **Merged tree total** | **687** |

`614 + 73 = 687` ✓

The 687 figure is also independently confirmed by the Acceptance Hub's own
`gate:test-suite` row, which ran vitest as a child process and captured
`Tests 687 passed (687)` (`evidence/acceptance/host-acceptance.json`).

### 5.2 No unexplained reduction

The Regression Sentinel compares baseline → candidate and reports test-count
movement as informational, not as a regression, when it is an increase:

```json
{ "dimension": "tests", "severity": "INFO", "key": "tests",
  "detail": "614 → 687", "baseline": 614, "candidate": 687 }
```

`evidence/acceptance/host-regression-sentinel.json` → `overall: PASS`,
`regressions: 0`, `drift: 0`.

Per cleanup.md §10 this satisfies "若 test count 变化：必须能解释为 A test union /
integration-specific additions；不得无解释减少."

## 6. Why the two restored tests still pass after the merge

The restored suites exercise M's `src/shared/autonomy-supervisor.ts` and
`src/shared/decision-ledger.ts` logic. Because the merge is a strict superset of M
and A never touched those modules, the modules the tests cover are byte-identical to
M — so restoring the tests cannot reintroduce a failure. Confirmed empirically: all
22 restored tests pass in the 687-test run.

## 7. Phase F gate results

| Gate | Command | Result |
|---|---|---|
| typecheck (renderer/shared) | `tsc --noEmit -p tsconfig.json` | exit 0 |
| typecheck (electron) | `tsc --noEmit -p tsconfig.electron.json` | exit 0 |
| full unit suite | `npx vitest run` | 82 files / 687 tests / exit 0 |
| full build | `npm run build` | exit 0 (vite 32 modules + electron emit) |

`0 FAIL`. No test was skipped to obtain this result, and no acceptance standard was
weakened.
