# PHASE-2 MINIMUM HUMAN ACCEPTANCE — OWNER DECISION (CC-103 D1–D4)

**Status:** OWNER DECISION, recorded 2026-09-27 under the temporary Owner-authorised construction lease, per the
CC-103 instruction sheet (`Codex-Boss_CC103_minimum_human_acceptance.md`, sha256 `9a1ee7ff…7227dc`).
**Starting cloud main:** `bf45476bb111602efe0c1811bf86d1b9aaf0da18`.
**Terminal status of the round this decision governs:** `WAITING_FOR_SINGLE_OWNER_ACCEPTANCE`.

This record is a **decision**, not a measurement. Every number it names is measured by
`scripts/city-minimum-human-acceptance.cjs` and reported in `docs/city/MINIMUM_HUMAN_ACCEPTANCE_RECORD.md`.

---

## 1. What this decision is, and what it is NOT

It creates a second, narrower acceptance **profile** — `MINIMUM_HUMAN_ACCEPTANCE` — whose only claim is:

> nothing in the city moved backwards, and every metric whose target is zero is zero.

It is a **pre-seal stopping profile**. It does **not** redefine the full-city acceptance contract, does not amend
`scripts/city-final-acceptance.cjs`, does not change workbook §33, and does not authorise a seal. The strict gate keeps
its own meaning and its own verdict, and on this tree it still reports `NOT_READY`.

There are two distinct answers, and they are deliberately different:

```text
STRICT_FULL_CITY_STATUS          = NOT_READY    (the Phase-2 contract is not met; sections 31/32/E5 are NOT performed)
MINIMUM_HUMAN_ACCEPTANCE         = READY        (no regression, every zero is zero, exact-SHA hosted evidence green)
```

A reader of either report can see both. Neither is allowed to stand in for the other, and `READY` on the minimum
profile is never a claim that the city is complete.

---

## 2. The strict historical targets are preserved (D1)

The strict Phase-2 / full-city targets remain true and remain the definition of finished:

```text
S2  kernel -> feature file edges      = 0
S3  mutual capability pairs           = 0
S4  largest SCC                       <= 1
S10 MIGRATION_IN_PROGRESS plots       = 0
S14 no NOT_GUARDED and no MACHINE_RATCHET
```

`scripts/architecture.cjs` is **not** amended in this round. Its `kernel-imports-feature` ratchet still refuses every
kernel → feature import, and it still does not distinguish a type-only import from a value import. Widening it to admit
type-only imports was considered and refused (D1): the ratchet's value is that it is a single mechanical rule an author
cannot argue with, and a policy that has to classify 49 edges by hand is not a policy.

CC-102's withdrawal of CC-101's unsound 42/7 classification stands and is final for this round. No further edge
classification programme is run. These targets become **deferred full-city renovation work**, protected by the
no-regression floors below.

---

## 3. The measured floors from `main@bf45476` are the no-regression bounds (D2)

Frozen from `bf45476`, and machine-read from `config/city-minimum-human-acceptance.json`:

| metric | strict target | frozen floor | measured at `bf45476` |
| --- | --- | --- | --- |
| kernel → feature FILE edges | 0 | ≤ 49 | 49 |
| kernel → feature distinct pairs | 0 | ≤ 16 | 16 |
| mutual capability pairs | 0 | ≤ 31 | 31 |
| largest SCC | ≤ 1 | ≤ 18 | 18 |
| `MIGRATION_IN_PROGRESS` plots | 0 | ≤ 21 | 21 |
| confirmed cross-domain accesses | 0 | = 0 | 0 |
| multi-writer candidates | 0 | = 0 | 0 |
| road edges leaving a road | 0 | = 0 | 0 |
| architecture enforcement violations | 0 | = 0 | 0 |
| `UNSAFE_GAP` | 0 | = 0 | 0 |
| expired bridge | 0 | = 0 | 0 |
| `NOT_GUARDED` principles | 0 | = 0 | 0 |

A metric may improve below its floor. It may not regress above it. A metric that is at its floor but above the strict
target is reported `RATCHETED_ACCEPTED` — accepted for this checkpoint, and visibly **not** at target, with both numbers
printed beside it. `MACHINE_RATCHET` (currently 2 principles: 15.1, 15.7) is acceptable under this profile because a
ratchet is already a machine; it is never reported as a pass, and `NOT_GUARDED` always blocks.

The default/full-city gate remains strict and may continue to report `NOT_READY`.

### Why further bulk rewiring has diminishing value for this mission

The remaining S2/S3/S4 debt is no longer a set of accidents. Measured and recorded across CC-076…CC-102: 15
namespace-ownership migrations landed, S2 fell 61 → 49, mutual pairs 33 → 31, the largest SCC 20 → 18, S5 closed at
zero direct-path accesses, S10 fell 22 → 21 with the stale-migration rule machine-checked, and the one remaining
namespace claim (`workspaces`) was refused by the ratchet itself and closed as won't-do (CC-099). What is left is a
small number of imports of *capacity* into the foundation — a kernel naming a feature's type, and one composition-root
constructor — where each removal either needs a new abstraction that the city has no evidence it needs, or trades a
measured coupling for an unmeasured one. That is real work; it is not this round's work, and the executable reason is
that it cannot be validated by the evidence this round can produce.

---

## 4. CITY-DEBT-006 is `ACCEPTED_PERMANENT`, without weakening desktop acceptance (D3)

`CITY-DEBT-006` — the desktop smoke suite failing after an application **restart** on a loaded hosted runner — is
dispositioned `ACCEPTED_PERMANENT`, and the register points here.

1. The **desktop black-box contract remains strict.** It is the strongest evidence in the repository and it stays that
   way.
2. The known restart-readiness flake is accepted as **permanent CI/environmental debt**. Exit condition (a) was
   foreclosed by the contract itself (CC-081: `validateDesktopBlackBoxReport` accepts only `PASS`/`FAIL`/`NOT_RUN`, so
   an absence of evidence is refused as `RESULT_VERDICT_INVALID`). Exit condition (b), the quarantine, is **not**
   taken. **Neither exit condition is claimed to have been performed.**
3. A final checkpoint is valid only when the **exact immutable final main SHA** obtains a successful hosted
   `acceptance` job.
4. **One re-run on that same immutable SHA is permitted** for this known flake, with **both runs preserved** in Actions
   history.
5. If the second run also fails, it is a **real blocker** — not a reason to retry indefinitely.

Explicitly **not** done: the suite is not quarantined; `NOT_MEASURED` is not added to the hostile desktop evidence
contract; `acceptance` is not removed from required hosted evidence.

---

## 5. Exact-SHA evidence requirements for this checkpoint

The minimum gate is `READY` only when all of the following hold on the exact named SHA, read from the hosted API and
not from a local run:

```text
quality       completed/success
unit          completed/success
acceptance    completed/success
package       completed/success
architecture  completed/success
Root Trust    acceptance-evolution-bless.cjs --check  ==  MATCHES
```

Missing or red evidence is `BLOCKING`/`UNVERIFIED` and refuses the checkpoint. The record of the checkpoint is
`docs/city/MINIMUM_HUMAN_ACCEPTANCE_RECORD.md`, and it must carry the run/job ids of those five checks.

A file cannot name the SHA of the commit that contains it. The record therefore names the SHA it was **measured
against** and identifies the commit that carries it by its parent relation; the five-check evidence for the final main
SHA is obtained on that final SHA after the record lands and is reported with the checkpoint.

---

## 6. What remains deferred, and the one remaining human gate (D4)

**Deferred full-city renovation work** (not this round, not a blocker for the minimum checkpoint): S2 → 0, S3 → 0,
S4 → ≤ 1, S10 → 0, S14 → no `MACHINE_RATCHET`; the `workspaces` namespace claim (CC-099 won't-do) if a future round finds
a way past the ratchet; and the full Phase-2 renovation programme of workbook §15–§23.

**Not performed, and not performed implicitly:** the full-city seal; workbook §31/§32 closure; the Owner construction
lease is not closed; `docs/city/FINAL_ACCEPTANCE_RECORD.md` is not created; `STRICT_FULL_CITY_STATUS` is not moved.

**One human gate remains.** This round may collect, verify and write every machine-verifiable fact, and it may create
the minimum-human-acceptance record. It may **not** write that the Owner personally attested anything the Owner did not
personally attest. When the exact final main SHA is green on all five hosted checks and the minimum gate returns
`READY`, the round stops and asks the Owner for exactly one confirmation. Until that confirmation is given, the terminal
status is `WAITING_FOR_SINGLE_OWNER_ACCEPTANCE` — never `CITY_COMPLETE`.
