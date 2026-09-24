# ROOT TRUST EPOCH 30 — FINALIZATION RECORD

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Epoch:** 28 → **29** → **30** (two ceremonies in one construction session; both records below)
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §9 B4, §28
**Ledger entries:** CC-003 (epoch-29 approval), CC-006 (epoch-29 promotion), CC-009 (epoch-30)
**Debt:** closed `CITY-DEBT-003`; landed the records for `CITY-DEBT-001` and `CITY-DEBT-002`

This record is written from live GitHub state, not from recollection. Every number below was read from a run, a
commit or a local `--check` on a clean checkout.

---

## 1. The two ceremonies

```text
                        EPOCH 29                            EPOCH 30
----------------------  ----------------------------------  ----------------------------------
run                     35962014554                         35969656991
dispatched on           79af142b9c0e9f634dc099bd2ad289cff…  5c589e4aa487313c4b8f44bd0682092ec1aac424
workflow shape          OLD: checkout `ref: main`           NEW: checkout `${{ github.sha }}` + assertion
dispatch method         operator `gh workflow run`          scripts/trust-epoch-dispatch.cjs --confirm
environment approval    deployment 6631222136               deployment 6632502688
epoch branch            trust-epoch/boss-root-trust-29      trust-epoch/boss-root-trust-30
epoch commit            e632d10b83dfa974b393c9aa96649…      0184008c3f97a29c72669b3cf86cf4258d70bb9c
epoch branch parent     79af142b (= main at the time)       5c589e4a (= main at the time)
FINALIZATION_RESULT     EPOCH_BRANCH_READY                  EPOCH_BRANCH_READY
promotion PR            #27                                 #30
promotion checks        5/5 green before merge              5/5 green before merge
merged as               1892e61c89596b7cd66257ae5b4cedb4…   90c5e4832ba87cd48fa107625e31746bfad5b20b
```

**No bypass was used for either promotion PR.** The L3 bypass in this session was used once, on PR #29 (the
repair), because an epoch cannot be advanced *for* a branch — the ceremony workflow is `refs/heads/main`-only.

## 2. The epoch-30 record

```json
{
  "schema_version": 1,
  "record": {
    "trust_epoch": 30,
    "root_contract_version": "boss-root-trust-30",
    "root_surface_hash": "f6e811d6661519a07a67a05e3d24e9fab617716cfc5702732e35123784f179c4",
    "parent_epoch_hash": "78ae6c22f644e6a55e6e818d2bd1799d083157ea003bfeec12d796944e53de14",
    "created_at": "2026-09-24T07:28:29.054Z"
  },
  "epoch_hash": "6fcc89d1aabcc75609d6969a6c80c67c4cfa3132c259cc76a97d74a003e79983"
}
```

```text
parent_epoch_hash == epoch 29's epoch_hash    YES  (78ae6c22…)
branch commit parent == main at the time      YES  (5c589e4a…)
diff of the epoch commit                      trust-policy/trust-epoch.json only, 6 insertions / 6 deletions
```

## 3. What moved the surface, and what did NOT

```text
                 AGGREGATE (74 files both times)                                                     FILE COUNT
epoch 29 anchor  2abacb6f069b5bf577682294c9b4b4c82f0686ebe7165d9fc5bd4ba8c8aa30d7  (after PR #26)    74
epoch 30 anchor  f6e811d6661519a07a67a05e3d24e9fab617716cfc5702732e35123784f179c4  (after PR #29)    74
```

The file **count is unchanged**, which is the measurement that distinguishes "a protected file changed" from
"the protection was widened". The declaration `trust-policy/root-trust-surface.json` is byte-stable: no pattern
was added, removed or altered.

**The files that changed content between the two anchors:**

```text
scripts/trust-epoch-finalization-handoff.cjs     the §9 B1 provenance binding (Root Trust Surface)
docs/city/*                                      (trust-policy/** is Root Trust Surface; docs are not, but the
                                                 declaration's own digest is over tracked files matching the
                                                 declared patterns, so only the paths in §4 below matter)
```

## 4. THE LIVE PROOF OF THE §9 REPAIR

The epoch-29 ceremony ran under the **old** workflow shape (checkout `ref: main`). The epoch-30 ceremony ran under
the **repaired** shape. The repair's value is only established if the repaired run really asserted the binding, so
the run's own log is the evidence:

```text
run 35969656991, step "Assert the checked-out commit IS the dispatch SHA (fail closed)"

  dispatch_sha=5c589e4aa487313c4b8f44bd0682092ec1aac424
  checked_out_sha=5c589e4aa487313c4b8f44bd0682092ec1aac424
  TRUST_EPOCH_FINALIZATION_SHA_BOUND=5c589e4aa487313c4b8f44bd0682092ec1aac424

and the handoff step published the same pair:
  DISPATCH_SHA:     5c589e4aa487313c4b8f44bd0682092ec1aac424
  CHECKED_OUT_SHA:  5c589e4aa487313c4b8f44bd0682092ec1aac424
```

Under the old shape this comparison did not exist. Under the old shape, had `main` moved between the dispatch and
the approval, the run would have measured and anchored the newer tree while reporting the older run id. That is
the defect `CITY-DEBT-002` recorded, and this run is the demonstration that it is closed rather than described —
which is the strongest form of evidence available for a governance repair that cannot be unit-tested end to end.

`tests/unit/city/trust-finalization-sha-binding.test.ts` (14 cases) reproduces the counterfactual: the old
`ref: main` shape is shown unbound once main moves, the repaired shape stays on the dispatch SHA for an arbitrary
number of intervening commits, and the workflow's own checkout ref and assertion step are measured from the
parsed YAML so a revert of either half fails the suite.

## 5. Dispatch provenance

The epoch-30 dispatch was performed through the **new** helper, which is itself part of the repair:

```text
node scripts/trust-epoch-dispatch.cjs --repository zhiheng-zhang-Mera/Codex-Boss --confirm \
     --reason <…> --risk <…> --rollback <…>
```

Properties this exercised, all of which the helper enforces and the workbook §9 B2 requires:

```text
no write without an explicit --confirm     the dry run printed "no dispatch is planned without --confirm"
the exact argv is printed first            the CONFIRMED output showed the full `gh workflow run … -f reason=…`
argv arrays, never a shell                 the free-form reason text travelled as its own argument
reason/risk/rollback are mandatory         --confirm without them is refused as MALFORMED
```

## 6. Post-promotion verification

On a clean local checkout of `main` at `90c5e4832ba87cd48fa107625e31746bfad5b20b`:

```text
[bless] root trust surface: 74 files, aggregate f6e811d6661519a07a67a05e3d24e9fab617716cfc5702732e35123784f179c4
[bless] repository: main @ 90c5e4832ba87cd48fa107625e31746bfad5b20b
[bless] epoch 30 (boss-root-trust-30) MATCHES the live surface
git status --short                          (empty)
```

Hosted, on the same SHA — Desktop CI run `35971361792`:

```text
quality       success
architecture  success
unit          success
package       success
acceptance    success
```

## 7. Status

```text
ROOT_TRUST_START_EPOCH (this session) = 28
ROOT_TRUST_FINAL_EPOCH (this session) = 30
ROOT_TRUST_FINAL_SURFACE              = f6e811d6661519a07a67a05e3d24e9fab617716cfc5702732e35123784f179c4  (74 files)
ROOT_TRUST_CHECK                      = MATCHES on main 90c5e4832ba87cd48fa107625e31746bfad5b20b
MAIN_CI                               = all five checks green on that SHA
```

Root Trust is **not** stale. This is a checkpoint, not the final seal: the workbook's remaining stages (§10–§13,
§15–§23, §30–§32) are still outstanding, and any further change to a Root Trust Surface file will move the
surface again and require the next epoch.
