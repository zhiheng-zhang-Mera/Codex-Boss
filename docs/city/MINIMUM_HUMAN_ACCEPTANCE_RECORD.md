# MINIMUM HUMAN ACCEPTANCE RECORD

**Profile:** `MINIMUM_HUMAN_ACCEPTANCE` (Owner decision CC-103 D2,
`docs/city/PHASE2_MINIMUM_HUMAN_ACCEPTANCE_DECISION.md`, floors in `config/city-minimum-human-acceptance.json`).
**This is NOT the Phase-2 seal.** `STRICT_FULL_CITY_STATUS` is reported below and is `NOT_READY`.
**Terminal status:** `WAITING_FOR_SINGLE_OWNER_ACCEPTANCE`. One Owner confirmation remains.

---

## 1. The exact SHA, and the two SHAs this record distinguishes

A file cannot name the SHA of the commit that contains it. This record therefore names the SHA it was **measured
against**, and identifies the commit that carries it by its parent relation:

```text
MAIN_SHA                1faf29a6eda99d8cbf69e9512c52a3e95d10aa80   (merge of PR #139, main)
MAIN_SHA_IS_CARRIER      false -- MAIN_SHA is the PARENT of the commit that carries this record
FINAL_MAIN_SHA          the single commit on main whose parent is 1faf29a6eda99d8cbf69e9512c52a3e95d10aa80
                        and which contains this file; its five hosted checks are green, and both runs
                        are preserved in Actions history (CC-103 decision, section 5)
```

Every machine number below was read at `MAIN_SHA` on a clean tree, and `git status --porcelain` was empty.

## 2. Trust identity

```text
ROOT_TRUST_EPOCH        66  (root_contract_version boss-root-trust-66)
ROOT_SURFACE_HASH       324af881f0c2e088a3f43a7d597640e0fac9ff2b13c91422fb6bf6eb461efedd
ROOT_TRUST_CHECK        acceptance-evolution-bless.cjs --check  exit 0  ->  MATCHES
ACCEPTED_BASELINE       version 20, hash 7a6ac9397df5620b..., source_commit e5516f1d8f43a135c215b9d92bfbfd3639aef4bf
ARCHITECTURE_RATCHET    architecture.cjs ratchet: 0 violations (bootModuleCount 25, capabilityCount 27)
```

No Root Trust Surface file changed in CC-103, so no accepted-baseline and no epoch ceremony was due.

## 3. Hosted evidence on `MAIN_SHA` — workflow run `36361469126`

```text
quality       SUCCESS   job 108739357145
architecture  SUCCESS   job 108739357324
unit          SUCCESS   job 108739451703
acceptance    SUCCESS   job 108741372284
package       SUCCESS   job 108741372311
```

`unit` here includes `pnpm test` (284 files / 3678 tests), `test:postbuild` and `test:slow` — the last of which is the
tier that was red on `bf45476`. The `acceptance` job includes the desktop black-box suite; the known restart-readiness
flake (CITY-DEBT-006) did **not** recur on this SHA, so the one permitted re-run under CC-103 D3 was **not** used.

## 4. Structural measurements, with both bounds

Read by `scripts/city-minimum-human-acceptance.cjs` from the instrument that owns each number. `RATCHETED_ACCEPTED`
means: at or below the frozen floor, and **not** at the strict full-city target.

```text
metric                                  measured   frozen floor   strict target   status
S2  kernel -> feature FILE edges              49             49               0   RATCHETED_ACCEPTED
S2b kernel -> feature distinct pairs          16             16               0   RATCHETED_ACCEPTED
S3  mutual capability pairs                   31             31               0   RATCHETED_ACCEPTED
S4  largest SCC (of 29 nodes)                 18             18              <=1   RATCHETED_ACCEPTED
S10 plots in MIGRATION_IN_PROGRESS            21             21               0   RATCHETED_ACCEPTED
S5  confirmed cross-domain accesses            0              0               0   PASS
S6  multi-writer candidates                    0              0               0   PASS
S7  road edges leaving a road                  0              0               0   PASS
    (6 declared roads, 11 refuted candidates, 75 edges onto roads, 0 leaving)
S9  plots in UNSAFE_GAP                         0              0               0   PASS
S11 expired temporary bridges                  0              0               0   PASS
S14 principles with NO guard                   0              0               0   PASS
S14r principles guarded by a ratchet           2           n/a               0   RATCHETED_ACCEPTED  (15.1, 15.7)
```

## 5. Validators

```text
capability closure            PASS   0 problem(s) over 610 scanned source file(s), 27 manifests
ledger provenance             PASS   0 problem(s), 98 entr(ies) parsed
architecture legacy ratchet   PASS   0 violation(s)
architecture enforcement      PASS   --mode enforce, verdict PASS, 0 violations, 0 engine errors
Root Trust                    PASS   --check exit 0 (MATCHES)
road validation               PASS   0 undispositioned leaf candidate(s)
Core budget                   PASS   0 unexcused growth
flatness validator            PASS   verdict PASS
principle matrix              HONEST  MACHINE_ENFORCED 3 / MACHINE_RATCHET 2 / EVIDENCE_REQUIRED 4 / NOT_GUARDED 0
bridge expiry                 PASS   no expired bridge
```

## 6. Debt

```text
CITY-DEBT-005   CLOSED               (occurrence_fourteen repaired; the register now states plainly that the
                                      CC-080 sweep was NOT exhaustive)
CITY-DEBT-006   ACCEPTED_PERMANENT   (CC-103 D3: neither exit condition performed; contract unchanged)
OPEN            0
CONTAINED       0
CLOSED          5   (CITY-DEBT-001 .. -005)
ACCEPTED_PERMANENT 1  (CITY-DEBT-006)
```

## 7. The two verdicts, which are different and neither hides the other

```text
STRICT_FULL_CITY_STATUS       = NOT_READY   (strict gate at MAIN_SHA: 21 PASS / 6 OPEN / 7 UNVERIFIED, 13 blocking;
                                             OPEN items: S2, S3, S4, S10, S14, E5 -- E5 is FINAL_ACCEPTANCE_RECORD.md)
MINIMUM_HUMAN_ACCEPTANCE      = READY       (17 PASS / 6 RATCHETED_ACCEPTED / 1 ACCEPTED_PERMANENT / 0 UNVERIFIED /
                                             0 BLOCKING; `--gate --hosted --main-sha=1faf29a...` exit 0)
```

`STRICT_FULL_CITY_TARGETS = NOT_MET (S2 49>0, S2b 16>0, S3 31>0, S4 18>1, S10 21>0, S14r 2>0)`.

## 8. What is deferred, and what was not done

Deferred full-city renovation work: S2 → 0, S3 → 0, S4 → ≤ 1, S10 → 0, S14 → no `MACHINE_RATCHET`, and the Phase-2
renovation programme of workbook §15–§23. The `workspaces` namespace claim stays closed as won't-do (CC-099), and
`scripts/architecture.cjs` was not amended (CC-103 D1).

**Not performed:** the full-city seal; workbook §31/§32; `docs/city/FINAL_ACCEPTANCE_RECORD.md` does not exist; the
Owner construction lease is not closed; the desktop black-box suite is not quarantined, `NOT_MEASURED` was not added to
the hostile desktop evidence contract, and `acceptance` was not removed from required hosted evidence.

**One human gate remains.** This record is machine-verifiable evidence collected by the construction executor. It does
**not** attest anything the Owner did not personally attest, and it is not an Owner acceptance. The single remaining
Owner confirmation is requested in the CC-103 checkpoint report.
