# Phase 2 — Principle Enforcement Matrix

**Workbook authority:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`, section 23 (*principle enforcement
matrix*), stage **P2-I**.
**Machine-checked by:** `scripts/principle-enforcement-validator.cjs`.
**Matrix data:** `config/principle-enforcement.json`.
**Verified by:** `tests/unit/city/principle-enforcement-validator.test.ts`.

## 1. What this matrix is

Section 23 asks that each of the nine architecture principles (`15.1`–`15.9`) be recorded under one of an explicit
set of strengths, and it closes with an instruction that governs the whole exercise: **do not fake semantic
certainty.**

A matrix written as prose can fake it trivially, and the specific forgery it invites is *promotion* — writing
`MACHINE ENFORCED` beside a principle whose only guard is a **regression ratchet**, so that *"the count cannot
silently grow back"* is recorded as *"the count is zero"*. Those are different claims, and the tree can tell them
apart. So the matrix is data, and this document is generated from it by the validator that checks it.

## 2. The four strengths

| strength | means |
| --- | --- |
| `MACHINE_ENFORCED` | a guard fails on **any** violation; the resolved measurement is at or below a target of `0` |
| `MACHINE_RATCHET` | a guard refuses a **regression**, but the principle's target is not met and the row says so |
| `EVIDENCE_REQUIRED` | the principle cannot be automated without dressing a judgement as a test, so the machine enforces that the **evidence exists** and a structured decision record names the judgement |
| `NOT_GUARDED` | nothing checks this, and the row names the **stage that owns the gap** |

## 3. The matrix

<!-- BEGIN GENERATED MATRIX -->
| principle | claim | section 23 requires | measured strength | guard | measured | target |
| --- | --- | --- | --- | --- | --- | --- |
| 15.1 | foundation must not depend on building | MACHINE ENFORCED | MACHINE_RATCHET | `scripts/p2b-kernel-feature-ratchet.cjs` | 55 | 0 |
| 15.2 | size is not itself a defect signal | MACHINE SEMANTICS PINNED | EVIDENCE_REQUIRED | -- | see decision record | -- |
| 15.3 | minimum stable closure is the unit of migration | MACHINE CHECKED where decidable + explicit review record | EVIDENCE_REQUIRED | `scripts/capability-closure-validator.cjs` | see decision record | -- |
| 15.4 | capability replacement lifecycle exists and carries one real proof | MACHINE-STATEFUL + real proof | EVIDENCE_REQUIRED | `scripts/replacement-lifecycle-validator.cjs` | see decision record | -- |
| 15.5 | least-sufficient repair: no PROHIBITED ADDED lateral load | MACHINE CHECK on prohibited added lateral load | MACHINE_ENFORCED | `scripts/p2b-kernel-feature-ratchet.cjs` | 0 (added) | 0 |
| 15.6 | every plot has exactly one valid flatness state | MACHINE ENFORCED | MACHINE_ENFORCED | `scripts/city-flatness-validator.cjs` | 0 | 0 |
| 15.7 | no cycles, no uncontrolled lateral bearing, no cross-domain private state access | MACHINE ENFORCED | MACHINE_RATCHET | `scripts/p2b-kernel-feature-ratchet.cjs`, `scripts/phase2-private-state.cjs` | mutual capability pairs: 31; largest strongly connected component: 18; cross-domain private-state accesses: 3 | 0; 0; 0 |
| 15.8 | shared roads are explicitly classified | MACHINE CHECK / explicit road classification | EVIDENCE_REQUIRED | `scripts/capability-roads-validator.cjs` | see decision record | -- |
| 15.9 | Core growth ban | MACHINE ENFORCED | MACHINE_ENFORCED | `scripts/core-budget-validator.cjs` | 0 | 0 |
<!-- END GENERATED MATRIX -->

## 4. What the validator refuses to let the matrix do

Every rule below is a refusal, and each one was falsified before it was trusted: the test suite builds a matrix
that breaks the rule and asserts the validator rejects it.

1. **Omission** — a principle `15.1`–`15.9` with no row, or an invented principle, fails.
2. **Silent shortfall** — a row whose strength falls short of what section 23 asks must carry `why_not_enforced`.
   Recorded gaps are the point; hidden ones are the failure.
3. **Phantom guards** — a cited guard file that does not exist fails.
4. **Mutating guards** — a cited guard whose source writes to the tree fails. A check that edits what it inspects
   is not a check.
5. **Failing guards** — a row may not cite a guard that currently exits non-zero.
6. **Unreached guards** — every cited guard must be reached by a cited test, so *enforced* means *runs in a
   required tier*, not *exists somewhere*.
7. **Typed-in measurements** — the measured value is **not in the matrix at all**. It is resolved from the guard's
   own live `--json` output for the key the row names. A number that cannot be typed cannot drift away from the
   instrument that produced it.
8. **Promotion** — `MACHINE_ENFORCED` requires the resolved measurement to be at or below a target of `0`. A row
   reporting `73` cannot say `MACHINE_ENFORCED`.
9. **Stale ratchets** — `MACHINE_RATCHET` requires the resolved measurement to be **above** its target. If a
   migration ever drives a count to zero, the validator fails until the row is promoted. Progress cannot be
   recorded as a floor.
10. **Empty evidence** — `EVIDENCE_REQUIRED` requires a substantive `evidenceRequirement` and decision records that
    exist on disk.
11. **Anonymous gaps** — `NOT_GUARDED` requires naming the stage that owns the gap.

## 5. How to read the current state

The honest reading, as measured:

- **3 enforced** — `15.5` (no *added* lateral load), `15.6` (exactly one valid flatness state per plot) and `15.9`
  (Core growth ban, over the stable classification and the starting surface recorded in `config/core-budget.json`).
- **2 ratchets** — `15.1` (foundation→building edges, 62 against a target of 0) and `15.7` (34 mutual pairs, a
  largest component of 20 of 29 capability-graph nodes, and 5 cross-domain private-state accesses).
- **4 evidence-required** — `15.2` and `15.3`, the two principles about the *reasoning* behind a migration: no rule
  here keys a threshold on a file count, and whether a given bundle of files is one purpose or seven is a design
  judgement. `15.8` joins them on the same footing, and so does `15.4` — see below.
- **0 unguarded** — every principle now has at least a machine-checked evidence requirement. `15.4` was the last one
  to leave this list, when stage P2-G built the replacement lifecycle (`CC-043`).

`15.5` and `15.1` are the pair worth reading together. Section 23 asks `15.5` for a check on **added** lateral load
and `15.1` for the absolute. The ratchet supplies exactly the former — a rise in kernel→feature edges, in
kernel→feature pairs or in mutual capability pairs fails — while the absolute count of 66 remains `15.1`'s open
problem. Recording both as `MACHINE ENFORCED` would have been the easy and wrong move.

`15.6` is enforced as a **state machine**: exactly one state per plot from the five, the per-state obligations, and
a refusal to record `FLAT` on a plot that a measured defect implicates. That the seal is not ready is a different
fact — `config/city-flatness.json` records 22 plots still mid-migration, and the seal gate reports it.

`15.9` is the row that moved in stage P2-H, and the move is worth reading because it shows what the matrix is for.
It was `NOT_GUARDED` with the gap assigned to P2-H. The stage supplied a **mechanism** — a stable classification
(`kind: kernel`), a starting surface pinned **by name**, and a budget with an Owner-approved exception path — and
only then did the row become `MACHINE_ENFORCED`. The measured quantity is growth *not covered by an approved
exception*, so the row stays at 0 when the exception path is used legitimately and rises when growth is unapproved.
What is proved is the **ban**: no exception has yet been recorded, so the exception path is exercised only on
fixtures, and the budget says so rather than implying that a governance mechanism has been used.

`15.8` is the second row to move, in stage P2-E, and it moved to `EVIDENCE_REQUIRED` rather than to
`MACHINE_ENFORCED` — deliberately. The road class makes the classification **explicit** and the machine check is
real: a declaration that imports any capability fails (ledger `CC-030`'s refutation as an executable rule), and so
does one owned by a kernel or by no capability, one with fewer than two consumers, one whose declared owner
disagrees with the ownership map, one missing any of the five proofs section 19 requires, and a *refutation* for a
file that was never a candidate. What cannot be automated is whether a given leaf carries a **policy of its own** —
and that is the half that actually decides: `src/shared/execution.ts` and `src/shared/permission.ts` both **pass**
the leaf test and are refused, because they export their owner's decision procedure. So the judgement is recorded
as evidence and as a measured refutation instead of being dressed up as a test, and the row says out loud that 53
measured leaf candidates remain undeclared. `15.8` is not "enforced"; it is **checked, with its judgement on the
record** — which is exactly what section 23 asks for when a principle cannot be fully automated.

## 6. Consequences for the remaining work

**No `NOT_GUARDED` row remains.** `15.4` was the last one, and it left the list when stage P2-G built the replacement
lifecycle (`CC-043`) — an eight-state protocol with ten transitions, a required evidence field per state, and refusals
for a history that skips a state, a state claimed but never entered, and a rollback proof file that does not exist. It
left it **honestly**, as `EVIDENCE_REQUIRED` rather than `MACHINE_ENFORCED`, because section 23's target has two
halves and only one is built: the mechanism is **machine-stateful**, and the **real proof** — one actual bounded
migration walked end to end — has not run. Section 21 is explicit that a synthetic-only proof is insufficient, so the
row says the mechanism is done and the demonstration is pending.

`15.8` left the same list earlier, when P2-E built the road class (`CC-038`), and it left it on the same footing: the
deciding half of the test — does this leaf carry a policy of its own? — is a judgement that is recorded rather than
automated. Two files prove the judgement is doing work: `src/shared/execution.ts` and `src/shared/permission.ts` both
**pass** the machine-checked leaf test and are refused for exporting their owner's decision procedure. The measured
refutation of `electron/commander/**` as a *directory* still stands (ledger `CC-030`: 132 incoming and 122 outgoing
edges, 39 onto three kernels), and the class handles it the only honest way — individual **leaf** files are
classified, the directory is not, and any declaration that imports a capability fails.

**What remains is therefore not a missing guard but two unmet targets**, and the acceptance suite prints both:
`15.1` and `15.7` are ratchets whose measured values are 62 kernel→feature edges, 34 mutual pairs and 5 private-state
accesses — all of which need `src/` or `electron/` changes and therefore a Root Trust epoch — and `15.4` needs its
first real retirement, which is the same kind of change and is already declared as an instance in `DECLARED`.
