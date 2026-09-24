# S2 EXIT CERTIFICATION — STAGE D (§11)

**Verdict.** `S2_EXIT_COMPLETE = YES`. The Phase 1B specification's S2 exit condition is satisfied, and it was
**recomputed from the real GitHub hosted history** rather than inherited from a prior report, as §11 requires.

**Recomputed, not inherited.** The prior closing report claimed *"30 consecutive valid runs, 0 excluded, 0
unexplained, same findings hash throughout"*. That statement was not taken on trust. The audit below is produced
by `scripts/s2-exit-audit.cjs`, a read-only program that walks the hosted runs and reads the two lines the
`architecture` job itself publishes — the same lines the job's own evidence step refuses to proceed without.

**The exit condition, quoted from its source.** `docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md` §3, stage S2:

> ≥ 10 consecutive runs in which enforce and shadow produce identical finding sets and enforce's exit code is
> explained by a declaration in the change, plus one deliberate negative control: a known-undeclared-edge PR
> fails enforce and passes shadow

```text
MEASURED, against that condition
  consecutive valid runs                        36          (required >= 10)   MET
  runs excluded WITHIN the window                0
  distinct findings digests across the window    1                             MET
  engine errors across the window                0 in all 36                   MET
  shadow findings identity == enforce identity  yes, on every run (ENF-12)     MET
  deliberate negative control                   RUN on the hosted runner      MET   (see section 6)
```

---

## 1. Window definition

```text
POPULATION   completed `Desktop CI` `push` runs on `main`
VALID        the run's `architecture` job concluded success
             AND its `Hosted shadow/enforce parity (ENF-12)` step concluded success
             AND the two published evidence lines report shadow PASS, enforce PASS,
                 0 policy violations and 0 engine errors
ORDER        newest first; "consecutive" means unbroken in that order
BOUNDARY     the window begins where the ENF-12 parity step first appears in the job, which is a STRUCTURAL
             boundary and not a query limit: runs older than it cannot satisfy the criterion at all
```

The 46 excluded runs are excluded for two structural reasons, and **none of them is a gate failure**:

```text
  5 runs   the `architecture` job exists but carries NO ENF-12 parity step -- they predate the S2 rollout
           newest: 35842939290 @ 5da81700, then 35833020418 @ 8c0e2add, 35826683308 @ 7b33d785,
                   35823811961 @ b2a76078 (unit failed), 35815493644 @ adf92b61 (unit failed)
           These are the last runs before stage S2 was rolled out.
 41 runs   NO `architecture` job at all -- they predate the job itself (the S1 rollout and earlier)
           newest: 35801514014 @ b5b511d7, 35717399512 @ 5c1cc264, 35699482212 @ 66440c1d, ...
```

Because both exclusions are structural, **the window is the whole of the usable history** — the audit was widened
to 100 runs and the count did not grow beyond 36. This is the real count, not a truncation.

## 2. The window — every run, in order

```text
first valid run   35863273132 @ f2aedd27  (epoch 26)
last  valid run   36068773868 @ 5740b7ca  (epoch 33)
count             36 valid, 0 excluded
epochs spanned    26, 27, 28, 29, 30, 31, 32, 33   -- eight root-trust epochs, one digest
```

| # | run id | head sha | epoch | findings digest | attempt | run conclusion | non-green jobs |
|---|--------|----------|-------|-----------------|---------|----------------|----------------|
| 1 | 36068773868 | `5740b7ca` | 33 | `db536b066ec8…` | 1 | success | — |
| 2 | 36062716100 | `91eb915c` | 33 | `db536b066ec8…` | 1 | success | — |
| 3 | 36058556569 | `c6d65868` | 33 | `db536b066ec8…` | 1 | success | — |
| 4 | 36054317574 | `d98d2fdd` | 33 | `db536b066ec8…` | 1 | success | — |
| 5 | 36052112041 | `e9bd9588` | 32 | `db536b066ec8…` | 1 | failure | unit:failure |
| 6 | 36048933514 | `19edbb5e` | 32 | `db536b066ec8…` | 1 | success | — |
| 7 | 36043113229 | `9182ffb7` | 32 | `db536b066ec8…` | 2 | success | — |
| 8 | 36038524991 | `889ff09f` | 32 | `db536b066ec8…` | 1 | success | — |
| 9 | 36034105340 | `57d81aa6` | 32 | `db536b066ec8…` | 1 | success | — |
| 10 | 36031737989 | `dc37826c` | 31 | `db536b066ec8…` | 1 | failure | unit:failure |
| 11 | 36027768868 | `551227d0` | 31 | `db536b066ec8…` | 1 | success | — |
| 12 | 36022984730 | `1fd10894` | 31 | `db536b066ec8…` | 1 | success | — |
| 13 | 36018159960 | `34030960` | 31 | `db536b066ec8…` | 1 | success | — |
| 14 | 36012762253 | `7f125ce4` | 31 | `db536b066ec8…` | 2 | success | — |
| 15 | 36008034749 | `8f44cec2` | 31 | `db536b066ec8…` | 1 | success | — |
| 16 | 36003384154 | `40dd3082` | 31 | `db536b066ec8…` | 1 | success | — |
| 17 | 36000888483 | `d39fb0ff` | 30 | `db536b066ec8…` | 1 | failure | unit:failure |
| 18 | 35997570148 | `2c63f29c` | 30 | `db536b066ec8…` | 1 | success | — |
| 19 | 35993659352 | `3ebe9e3b` | 30 | `db536b066ec8…` | 1 | success | — |
| 20 | 35989272641 | `0429d59d` | 30 | `db536b066ec8…` | 2 | success | — |
| 21 | 35984898693 | `ba39c881` | 30 | `db536b066ec8…` | 1 | success | — |
| 22 | 35979904818 | `ae2cb8f7` | 30 | `db536b066ec8…` | 1 | success | — |
| 23 | 35977080133 | `e121d846` | 30 | `db536b066ec8…` | 1 | failure | unit:failure |
| 24 | 35974795982 | `476388bd` | 30 | `db536b066ec8…` | 1 | success | — |
| 25 | 35971361792 | `90c5e483` | 30 | `db536b066ec8…` | 1 | success | — |
| 26 | 35969635809 | `5c589e4a` | 29 | `db536b066ec8…` | 1 | failure | unit:failure |
| 27 | 35969599609 | `09e68cd0` | 29 | `db536b066ec8…` | 1 | success | — |
| 28 | 35965095036 | `1892e61c` | 29 | `db536b066ec8…` | 1 | success | — |
| 29 | 35961901372 | `79af142b` | 28 | `db536b066ec8…` | 1 | failure | unit:failure |
| 30 | 35959657663 | `8897ddc3` | 28 | `db536b066ec8…` | 1 | success | — |
| 31 | 35945252442 | `c4c2e278` | 28 | `db536b066ec8…` | 1 | success | — |
| 32 | 35941761018 | `a6bacfc7` | 28 | `db536b066ec8…` | 1 | success | — |
| 33 | 35938815380 | `f6e0274f` | 27 | `db536b066ec8…` | 1 | failure | unit:failure |
| 34 | 35874903277 | `039a261a` | 27 | `db536b066ec8…` | 1 | success | — |
| 35 | 35870412527 | `86ee83a9` | 27 | `db536b066ec8…` | 1 | failure | acceptance:failure |
| 36 | 35863273132 | `f2aedd27` | 26 | `db536b066ec8…` | 1 | failure | unit:failure |

## 3. The identities (§11 asks for both)

```text
SHADOW  finding identity/hash   db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
ENFORCE finding identity/hash   db536b066ec8eeb5c7a54fcddd146d1646630f9c0258712892d644efb7aab1ba
findings count                  1677 in both modes, on every run
comparison                      finding identity (code + subject + severity + policy_class + detail digest),
                                MULTISET with multiplicity -- a count-only match cannot fake it
                                (`count_only_match_cannot_fake_parity: true`, `count_only_trap_observed: false`)
only_shadow / only_enforce      [] / []
multiplicity_differences        []
```

**One digest spans eight root-trust epochs.** That is worth stating plainly: the epoch ceremonies moved the Root
Trust Surface and did not move the enforcement finding set by one identity. The two are independent, and the
constant digest is what shows it rather than asserting it.

### 3a. Local/hosted parity evidence

Measured with the repository's own comparator (`scripts/architecture-findings-parity.cjs`), never with a
hand-written comparison:

```text
node scripts/architecture-findings-parity.cjs --mode shadow-enforce --shadow <hosted engine-shadow> \
                                                             --enforce <hosted engine-enforce>
  SHADOW_FINDINGS_HASH == ENFORCE_FINDINGS_HASH == db536b066ec8...     HASHES_EQUAL: true

node scripts/architecture-findings-parity.cjs --mode local-hosted --local <local shadow> --hosted <hosted shadow>
  LOCAL_FINDINGS_HASH  == HOSTED_FINDINGS_HASH  == db536b066ec8...     HASHES_EQUAL: true
  counts equal 1677                                                    COUNTS_EQUAL: true
```

So three observations agree by identity: **the local tree, the hosted run at `5740b7ca`, and all 36 historical runs
produce the same 1677 findings with the same hash.** The local shadow was run on the current tree (`5dd6c7b`),
which differs from the hosted run's tree (`5740b7ca`) only in documentation; the enforcement sensor reads
`electron/` and `src/`, and the equal hash is the measurement that confirms the difference is invisible to it
rather than an assumption that it is.

## 4. Engine error counts

```text
engine errors across the window      0 in every one of the 36 runs
policy violations across the window  0 in every one of the 36 runs
shadow verdict                       PASS in every run
enforce verdict                      PASS in every run
not_yet_enforced classes             5 in every run (the unmodelled classes, listed not hidden)
```

The `not_yet_enforced` list is present and non-empty on every run, which the job's evidence step asserts as a
*list* rather than as contents — an unread list and an empty list are different findings.

## 5. Every excluded run, retry and flake

**Excluded runs: 46, all outside the window, all structural** (section 1). **Zero runs were excluded from inside
the window** — no run in the window failed the criterion, was unreadable, or had to be dropped.

```text
RETRIES and FLAKES
  inside the window (3)     36043113229 @ 9182ffb7  attempt 2, success   <- the CC-022 run, re-run on the
                                                                           identical commit and green
                            36012762253 @ 7f125ce4  attempt 2, success
                            35989272641 @ 0429d59d  attempt 2, success
  outside the window (3)    35436872129 @ 2129576e  attempt 2, success
                            35423339856 @ 8a8d12a8  attempt 2, success
                            35417327632 @ ac3865b0  attempt 2, success
  every retry is a FLAKE: in all six the same commit went green on the second attempt, which is the definition
  of R1 under workbook section 5 -- disproved on the identical tree by re-run, not repaired into green.

NON-GREEN RUNS INSIDE THE WINDOW: 9 of 36
  8  failed in the `unit` job        e9bd9588, dc37826c, d39fb0ff, e121d846, 5c589e4a, 79af142b, f6e0274f,
                                     f2aedd27
  1  failed in the `acceptance` job  86ee83a9
  ALL 9 had a GREEN `architecture` job, which is why all 9 remain valid S2 observations: the S2 claim is about
  the architecture gate's evidence, and a red in a different job neither supplies nor withholds it. Classified
  under workbook section 5 as non-architecture reds; the load-sensitive ones are already recorded as R1 in the
  ledger (CC-015, CC-017, CC-019, CC-022), and 79af142b is the epoch-28 stale-anchor red recorded in CC-004.
```

One run was still executing when the audit ran (`36071175401 @ 5dd6c7b`). It is reported as **PENDING** and counted
as neither valid nor excluded, so an unfinished run at the head of the window cannot understate it.

## 6. The deliberate negative control (§10, executed)

```text
negative-control PR            #56, CLOSED without merge; evidence comment 5823478991
negative-control runs          36068999761 (push) · 36069017063 (pull_request), both on 57aeede5
experimental commit            57aeede5021f69392280cbea1bc58375fed43d82
evidence tag                   city-evidence-s2-negative-control-v1
                               annotated tag object d85217d97dad63ae71e18fa4dbd5f8b55ce4ad1f  (never moved)

negative-control exact violation
  code     NEW_UNDECLARED_CROSS_CAPABILITY_EDGE
  subject  electron/bootstrap/persistence.ts -> electron/bootstrap/theme-ipc.ts
  detail   new cross-capability edge not authorized by any declaration: persistence -> theme
  identity sha256 b9682ef67c874267945503f4f4e9881f6beb3b33f1d7f7fd7468ac58bfa3e4b6   (shadow == enforce)

shadow   exit 0, verdict POLICY_VIOLATION, the violation reported
enforce  exit 1, verdict POLICY_VIOLATION, the SAME identity
hosted   the `architecture` job passed steps 1-12 and FAILED AT the enforce step -- it reached enforce
engine_errors 0 in both modes
legacy ratchet reported the same edge independently as kernel-imports-feature
```

Full record: `docs/city/S2_HOSTED_NEGATIVE_CONTROL_RECORD.md`; paper-ledger section V.

## 7. What is proven, and the one direction that is not

```text
PROVEN HOSTED
  the gate passes when nothing undeclared is introduced          36 consecutive runs
  shadow and enforce agree by identity, on the same inputs        36 consecutive runs + both parity modes
  the gate REFUSES an undeclared cross-capability edge            the negative control, with a named finding
  local and hosted produce the same finding identity              ENF-12 local-hosted parity, hashes equal
  a re-run of the same commit is green after a red                three in-window flakes, all R1

PROVEN LOCALLY ONLY, AND NOT CLAIMED HOSTED
  the gate ACCEPTS a deliberately DECLARED new edge (the negative control's counterfactual, "commit B"). Its
  local half is recorded in paper-ledger section T-4; it was never run on the hosted runner. The S2 exit
  condition does not require it -- it requires identical finding sets over >= 10 runs plus one negative
  control, both of which are hosted here -- but a reader should not infer from this certificate that the
  accepting direction has been observed hosted.

STILL OPEN, AND NOT CLAIMED BY THIS CERTIFICATE
  section T-5a's tension: no declaration form lets the enforcement engine accept a legitimate new edge
  without raising a legacy density metric in `config/architecture-baseline.json`. That is a property of the
  LEGACY ratchet, not of the enforcement gate, and it remains open.
```

## 8. Reproducing this certificate

```powershell
node scripts/s2-exit-audit.cjs                 # the window, every run, every exclusion, retries and flakes
node scripts/s2-exit-audit.cjs --json          # the same audit as JSON
node scripts/s2-exit-audit.cjs --limit 100     # widen the population; the window boundary is structural
```

The audit is read-only: its only `gh` verbs are reads, and a unit case fails if a write, a re-run, a dispatch or a
cancel is ever added to it. A window audit that could change the history it certifies would not be a certificate.

## 9. Governance consequence

```text
S2_EXIT_COMPLETE      YES   (this certificate)
NEGATIVE_CONTROL      RUN and PROVEN hosted   (runs 36068999761 / 36069017063)
S3                    ALREADY ACTIVATED -- the ruleset `Main-Protection` requires `quality, unit, acceptance,
                      package, architecture` with strict_required_status_checks_policy = true; recorded in
                      ledger CC-011. S2 exit was the last evidence item behind that activation, and it is now
                      certified retroactively rather than used to gate it.
S4                    RETAIN_LEGACY_RATCHET, recorded in ledger CC-012 and unchanged by this certificate.
BASELINE_WIDENED      NO.  RULESET_CHANGED  NO (by this certificate).  EPOCH  33, unchanged.
```
