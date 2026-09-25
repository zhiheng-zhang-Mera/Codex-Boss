# Phase 2 — P2-G: The Replacement Lifecycle

**Workbook authority:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` section 21 (stage **P2-G**), principle
**15.4**.
**Machine-checked by:** `scripts/replacement-lifecycle-validator.cjs` over `config/city-replacement-lifecycle.json`.
**Verified by:** `tests/unit/city/replacement-lifecycle.test.ts`.
**Ledger:** `CC-043`.

## 1. What section 21 asks for

Section 21 requires a **reusable** replacement-governance mechanism — *"Do not attempt to replace every capability
merely to exercise this"* — and names seven pieces of machinery:

```text
authoritative-side declaration   shadow execution mode   dual-output comparison
traffic switch                   rollback to old side    drain state
retirement evidence
```

Its acceptance is that **replacement state is observable**, **rollback is executable**, **one real migration
demonstrates the lifecycle**, **tests pin the lifecycle semantics**, and **future capabilities can adopt it without
inventing a new protocol**.

## 2. Why it is a state machine rather than a checklist

A replacement that reports `RETIRED` without ever having run the old side and the new side side by side is
**indistinguishable, in prose,** from one that did: both read like a completed migration. The difference is the
**order** of the steps, so the order is what the machine checks.

```text
DECLARED -> SHADOW -> DUAL_VALIDATED -> TRAFFIC_SWITCHED -> OLD_FALLBACK -> DRAINED -> RETIRED
                \__________\_______________\_________________/  -> ROLLED_BACK
```

Every instance carries a `history` of the states it has **actually entered**, and the validator refuses a history that

1. **skips a state** or arrives by an undeclared transition — *"a RETIRED instance that never passed `DUAL_VALIDATED`
   is the specific forgery this refuses"*;
2. carries **no evidence** for the state it enters (each state names the evidence field it requires);
3. cites a **ledger entry the ledger does not contain**;
4. has a clock that runs backwards;
5. **claims a state its history never reached** (`state` must be the state the history reaches);
6. names a **rollback proof file that does not exist** — *"rollback is executable"* is otherwise an assertion.

The protocol itself is checked too: the first state must be `DECLARED`, all six named stages must exist and each must
require evidence, a transition may not return to `DECLARED`, terminal states must have no outgoing transition, and no
non-terminal state may be a dead end.

## 3. The first declared instance

`P2A-BRIDGE-01-RETIREMENT` — the one-symbol re-export added by the P2-A provider closure (`CC-029`), which is also the
temporary bridge the seal gate refuses to seal past (`CC-041`). It fits all seven pieces of machinery because the two
sides already run **side by side**:

| machinery | this instance |
| --- | --- |
| authoritative side | `src/shared/contracts.ts` (owner `status`): `export type { ProviderId } from "./provider-contracts";` |
| successor side | `src/shared/provider-contracts.ts` (owner `providers`): the declaration itself |
| shadow mode | the successor already serves every direct importer; the old side serves only five `tests/acceptance/**` suites |
| dual-output comparison | **typecheck is the comparison** — three tsconfigs plus the provider-closure test prove both paths resolve to the *same* declaration |
| traffic switch | move the five imports in one commit and delete the re-export in the same commit |
| rollback | restore the re-export and revert the five edits; the successor is never modified, so a rollback cannot half-move a surface |
| drain | a scan of `tests/acceptance/**` for a `ProviderId` import from `./contracts` returns **zero** |

**What is replaced is an import PATH, not a capability.** That is stated in the artifact rather than glossed over: the
retained unit is a symbol's import path, and a capability-level instance remains for a future migration.

**The rollback proof is this stage's test file, and it is a real check.** `provider-contracts.ts` declares the type and
`contracts.ts` carries exactly one re-export pointing at it, so the authoritative side is a **pure alias** — restoring
it cannot change semantics, which is precisely what *"rollback is executable"* requires. A case asserts both files, the
single occurrence, and the alias target.

## 4. Genericity: the protocol is proved adoptable, not asserted

Section 21's acceptance is that *"future capabilities can adopt it without inventing a new protocol"*. The test suite
drives a **second, synthetic instance for a different capability** down the full path through the **same** validator,
using only the fields the protocol declares. If any capability-specific logic were hiding in the validator, that case
would fail. The reuse is therefore a **demonstration** rather than a claim.

## 5. Current state, honestly

```text
[lifecycle] protocol: 8 state(s), 10 transition(s)
[lifecycle]   P2A-BRIDGE-01-RETIREMENT  capability providers  state DECLARED  0 step(s)
[lifecycle] 0 instance(s) have reached RETIRED
[lifecycle] VERDICT=HOLDS
```

**The mechanism exists and the proof has not run.** The acceptance suite says so in the same words: `S12` moved from
passing on the mere **existence** of an artifact — the weakest predicate a checklist can carry — to resolving this
validator and requiring an instance that has reached `RETIRED`. It therefore stays **`OPEN`**, and the next step is to
walk the path: the migration is a `src/`+`tests/acceptance/**` change, so it needs a **Root Trust epoch**, and the
bridge's own exit condition says to retire it in a commit that is *already* moving the surface for another reason
rather than spending a ceremony on it.

## 6. Rollback

Delete `config/city-replacement-lifecycle.json`, `scripts/replacement-lifecycle-validator.cjs`, its test and this
document; revert `S12` in the acceptance suite and the catalogue entry.
