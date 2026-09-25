# Phase 2 — The Final-City Acceptance Suite

**Workbook authority:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` — section 30 (*final-city acceptance
suite*) over the completion definition in **section 33**.
**Machine-checked by:** `scripts/city-final-acceptance.cjs`.
**Verified by:** `tests/unit/city/city-final-acceptance.test.ts`.
**Ledger:** `CC-042`.

## 1. Why this exists

Section 33 enumerates the conditions under which the programme is complete: **nine** Governance items, **fourteen**
Structure items, **five** Evidence items and **six** Final-main items. Section 30 enumerates the artifacts and commands
that must run before completion may be declared, and adds the rule that governs the whole exercise:

> **No final result may depend solely on a local run.**

Until this program existed, *"are we done?"* was a **reading** exercise over two documents and a set of validators.
That is exactly how section 30's *bridge expiry validator* went unwritten for a whole programme — a required artifact,
named in the workbook, discovered only when someone read the last section (`CC-041`).

## 2. Three statuses, and why there are three

| status | meaning | blocks the seal |
| --- | --- | --- |
| `PASS` | machine-verified, from the tree, an instrument's live output, or the hosted API when asked | no |
| `OPEN` | machine-verified as **not yet satisfied** | **always** |
| `UNVERIFIED` | the tree **cannot** decide it | unless `--attest` **and** the final acceptance record exists |

`UNVERIFIED` blocking is the point. A machine that silently passes what it cannot check is worse than one that
refuses, and the workbook's own vehicle for an Owner attestation is the **final acceptance record** — so `--attest`
without that record grants nothing. That combination is pinned by a test rather than explained in a document.

Items the tree cannot decide, and why:

- **E1** completeness of the cloud ledger — a working tree can show the entries, not that none is missing;
- **E4** that no historical failure was erased — the check that can disprove it is the **git history**, not a tree;
- **G2/G3** the live ruleset — the committed record is prose in the ledger; the live object needs `--hosted`;
- **F1/F2/F4** the named final SHA and its five hosted checks — `--main-sha` and `--hosted`.

## 3. The checklist as measured on this tree

```text
GOVERNANCE  7/9 verified
  PASS  G1 architecture hosted job exists
  PASS  G4 negative control has proved fail-closed behaviour
  PASS  G5 local/hosted parity is proved
  PASS  G6 Root Trust anchors the final live surface
  PASS  G7 trust-finalization dispatch is immutable-SHA bound
  PASS  G8 spurious dispatch incident is recorded
  PASS  G9 legacy-ratchet S4 decision is recorded
  UNVERIFIED G2/G3 the live ruleset (run with --hosted)

STRUCTURE   6/14 verified
  PASS  S1 capability ownership/manifest map is truthful
  PASS  S7 shared roads are explicitly classified
  PASS  S8 every plot has a valid flatness state
  PASS  S9 no unsafe gap remains
  PASS  S11 no expired temporary bridge remains
  PASS  S13 Core budget is enforced and final Core does not exceed the permitted budget
  OPEN  S2 kernel -> feature file edges = 62 (target 0)
  OPEN  S3 mutual capability pairs = 34 (target 0)
  OPEN  S4 largest strongly connected component = 20 of 29 nodes (target <= 1)
  OPEN  S5 confirmed cross-domain private-state accesses = 5 (target 0)
  OPEN  S6 1 namespace touched by more than one non-owner capability: tasks
  OPEN  S10 22 plots in MIGRATION_IN_PROGRESS
  OPEN  S12 stage P2-G has not been built
  OPEN  S14 the matrix reports 1 unguarded (15.4) and 2 ratcheted (15.1, 15.7)

EVIDENCE    2/5 verified          FINAL_MAIN  1/6 verified
16 PASS, 11 OPEN, 7 UNVERIFIED -> VERDICT=NOT_READY (18 blocking)
```

**`S7` is the item this round verified for the first time.** *"Shared roads are explicitly classified"* now holds
under a machine predicate: **every leaf that a kernel imports across a capability boundary is either declared a road
or refused as one** — 6 declared, 11 refused, 0 undispositioned (`CC-038`, `CC-040`). The number is computed by
`capability-roads-validator.cjs` rather than here, so one program owns it.

## 4. What the harness does NOT do

- It does not run the **normal repository suite**. Section 30 asks for that too; its hosted form is items F2 and F3,
  and its local form is `pnpm test`, which CI runs. This program is section 30's *city-specific qualification* half.
- It does not decide anything a validator decides. Every structural item is resolved from the instrument that owns
  it, and the evidence line prints the measurement rather than restating it.
- It does not close anything. It reports; the migration does the work.

## 5. Reading the verdict

`VERDICT=NOT_READY` names the blocking count, and every blocking item prints **why** beneath it. When the structural
migrations land, the same command becomes `VERDICT=READY` and §33's final line becomes permissible — at which point
`--seal --main-sha=<sha> --hosted` is the gate, and the final acceptance record is the attestation that carries the
two items no tree can decide.

## 6. Rollback

Delete `scripts/city-final-acceptance.cjs`, its test and this document; revert the catalogue entry. Nothing else reads
them.
