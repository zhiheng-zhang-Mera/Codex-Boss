# PHASE 2 — ARCHITECTURE MIGRATION ACCEPTANCE

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Specification:** `docs/city/PHASE2_ARCHITECTURE_MIGRATION_SPEC.md`
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §14–§23, §30, §33
**Frozen starting measurement:** commit `5ade1cdfdb2d71fd58f0ca57905e0090e4690a24` (spec §1)
**Status of this document:** **the enforced contract for Phase 2 exit.** A row is `PASS` only with the evidence
named in its own row; `UNPROVEN` is a legitimate value and `ASSUMED` is not.

---

## 0. How to read this document

```text
PASS        the measurement was taken and satisfies the criterion
FAIL        the measurement was taken and does not satisfy the criterion
UNPROVEN    the measurement has not been taken; this is not a pass and not a failure
NOT APPLICABLE   with the reason stated
```

No row may be closed by an argument. Every `PASS` names the command that produced it, or the CI run that emitted
it. This document is filled in as the packages land; **the header table below is the current truth and is
expected to read mostly `UNPROVEN` while Phase 2 is in progress** — a mostly-green table at this point in the
programme would be the defect, not the success.

---

## 1. Package acceptance

### 1.1 P2-A — truthful capability map and minimum stable closure

```text
CRITERION                                          STARTING (M-xx)         TARGET      STATUS     EVIDENCE
-------------------------------------------------  ----------------------  ----------  ---------  ---------
one canonical ownership model                      2 models, 572 files     exactly 1   UNPROVEN
                                                   disagree (M-03/M-04)
declared module paths that do not exist            0 (already clean)       0           UNPROVEN
stale manifest paths                               (see M-20)              0           UNPROVEN
manifest disagreement rows                         M-20 = 14               0           UNPROVEN
manifests declaring modules:[] over real files     M-21 = 9                0           UNPROVEN
state-ownership mismatches (claimed vs written)    present (spec §1.4)     0           UNPROVEN
unowned city source files                          M-04 = 587 undeclared   0           UNPROVEN
every module has an owner or infra classification  not measured            100%        UNPROVEN
cross-capability relation resolves to an endpoint  M-24 = 1 unresolved     0           UNPROVEN
each capability has ONE declared external purpose  not measured            27 of 27    UNPROVEN
closure validator runs in CI                       no                       yes         UNPROVEN
```

**Not accepted by:** emptying a manifest. `modules: []` over real files is a failure (spec §3.1).

### 1.2 P2-B — foundation must not depend on a building

```text
CRITERION                                          STARTING (M-xx)         TARGET      STATUS     EVIDENCE
-------------------------------------------------  ----------------------  ----------  ---------  ---------
kernel -> feature FILE edges                       M-12 = 158              0           UNPROVEN
kernel -> feature distinct pairs                   M-13 = 82               0           UNPROVEN
  of which composition-root wiring                 M-14 = 52               declared,   UNPROVEN
                                                                           not deleted
  of which kernel-imports-building                 M-13 − M-14 = 30        0           UNPROVEN
known positive control (the historical inversion)  LIVE                    INVERTED    UNPROVEN
  electron/bootstrap/persistence.ts -> electron/runtime-intelligence/live-capture.ts
foundation-inversion validator exists and runs     no                      yes         UNPROVEN
composition root classified explicitly, not by     no                      yes         UNPROVEN
directory
```

### 1.3 P2-C — cycles and uncontrolled lateral bearing dependencies

```text
CRITERION                                          STARTING (M-xx)         TARGET      STATUS     EVIDENCE
-------------------------------------------------  ----------------------  ----------  ---------  ---------
capability dependency cycles (SCC > 1)             M-09 = 1                0           UNPROVEN
capabilities in the largest SCC                    M-10 = 27 of 27         1 (acyclic) UNPROVEN
mutual capability pairs                            M-11 = 54               0           UNPROVEN
uncontrolled lateral load-bearing edges            not measured            0           UNPROVEN
undeclared cross-capability edges                  M-07/M-08 = 187 of 189  0           UNPROVEN
cycle/SCC validator reads the DECLARED model       no                      yes         UNPROVEN
validator FAILS while two models disagree          no                      yes         UNPROVEN
```

**Not accepted by:** excluding files from the scanner, or reporting the manifest mapping's `0 cycles` while 572
files remain owned by a second model (spec §3.3).

### 1.4 P2-D — private-state access and multiple writers

```text
CRITERION                                          STARTING (M-xx)         TARGET      STATUS     EVIDENCE
-------------------------------------------------  ----------------------  ----------  ---------  ---------
cross-domain private-path accesses                 M-17 = 13 (M-16 = 11     0          UNPROVEN
                                                   stores)
uncontrolled multi-writer durable stores           M-18 = 0 (already)       0          UNPROVEN
durable stores with >= 2 construction sites        present (project-state   0          UNPROVEN
                                                   .json, 2 sites)
durable stores with NO declared namespace          M-19 = 4                 0          UNPROVEN
  restart-result.json / restart-seeded.json / theme-visual-check.json / workbook-registry.json
every durable store has ONE authoritative owner    not measured             100%       UNPROVEN
private-state-access validator exists and runs     no                       yes        UNPROVEN
durable-writer validator exists and runs           no                       yes        UNPROVEN
```

### 1.5 P2-E — shared capability sink / roads

```text
CRITERION                                          STARTING                 TARGET      STATUS     EVIDENCE
-------------------------------------------------  -----------------------  ----------  ---------  ---------
every extracted road justified on the five points  no roads classified      100%        UNPROVEN
road ownership explicit                            no                       yes         UNPROVEN
no building load-bearing solely for owning a road  not measured             0           UNPROVEN
a new road does not expand Core without separate   no budget yet            enforced    UNPROVEN
justification
```

### 1.6 P2-F — flatness states and migration lifecycle

```text
CRITERION                                          STARTING                 TARGET      STATUS     EVIDENCE
-------------------------------------------------  -----------------------  ----------  ---------  ---------
exactly one machine-readable state per plot        none exist               27 of 27    UNPROVEN
bridge requires owner + exit condition             n/a                      100%        UNPROVEN
degraded state requires the missing element        n/a                      100%        UNPROVEN
migration state requires source/target/exit        n/a                      100%        UNPROVEN
unsafe gap blocks that plot's promotion            n/a                      enforced    UNPROVEN
UNSAFE_GAP at final seal                           0                        0           UNPROVEN
MIGRATION_IN_PROGRESS at final seal                0                        0           UNPROVEN
undeclared PARTIALLY_DEGRADED at final seal        0                        0           UNPROVEN
expired TEMPORARILY_BRIDGED at final seal          0                        0           UNPROVEN
flatness-registry validator exists and runs        no                       yes         UNPROVEN
bridge-expiry validator exists and runs            no                       yes         UNPROVEN
```

### 1.7 P2-G — capability replacement lifecycle

```text
CRITERION                                          STARTING                 TARGET      STATUS     EVIDENCE
-------------------------------------------------  -----------------------  ----------  ---------  ---------
replacement state is observable                    no machinery              yes         UNPROVEN
rollback is executable                             no machinery              yes         UNPROVEN
one REAL bounded migration demonstrates the         none                     1           UNPROVEN
lifecycle on real traffic / real host replay
tests pin the lifecycle semantics                  none                      yes         UNPROVEN
a future capability can adopt it without a new     none                      yes         UNPROVEN
protocol
```

**Not accepted by:** a synthetic-only demonstration (spec §3.6).

### 1.8 P2-H — Core growth ban

```text
CRITERION                                          STARTING (M-xx)          TARGET           STATUS   EVIDENCE
-------------------------------------------------  -----------------------  ---------------  -------  ---------
canonical Core classification exists               no single label          yes              UNPROVEN
Core budget frozen as a machine-enforced number    no budget                yes              UNPROVEN
  narrowest candidate                              M-22 6 files/49,336 B
  union candidate                                  M-23 64 files/584,567 B
final Core size <= Phase 2 starting Core size      n/a                      <= baseline      UNPROVEN
every increase has a separate Owner architecture   n/a                      100% of increases UNPROVEN
record answering the four questions
core-budget validator exists and runs              no                       yes              UNPROVEN
```

### 1.9 P2-I — principles 15.1–15.9 machine-enforced

| Principle | Target | Actual | Evidence |
|---|---|---|---|
| 15.1 foundation must not depend on a building | MACHINE ENFORCED | UNPROVEN | — |
| 15.2 size is not itself a defect signal | MACHINE SEMANTICS PINNED | UNPROVEN | — |
| 15.3 minimum stable closure | MACHINE CHECKED where decidable + review record | UNPROVEN | — |
| 15.4 replacement lifecycle | MACHINE-STATEFUL + real proof | UNPROVEN | — |
| 15.5 least-sufficient repair / shared sink | MACHINE CHECK on prohibited added lateral load | UNPROVEN | — |
| 15.6 flatness states | MACHINE ENFORCED | UNPROVEN | — |
| 15.7 no cycles / lateral bearing / private state | MACHINE ENFORCED | UNPROVEN | — |
| 15.8 shared capability sink | MACHINE CHECK / explicit road classification | UNPROVEN | — |
| 15.9 Core growth ban | MACHINE ENFORCED | UNPROVEN | — |

The starting row for all nine is recorded in `docs/capability-city-principles.md` ("Enforcement status — what is
machine-checked today and what is not"), which stated 8 of 9 as **not enforced** before Phase 2 began. A
principle that cannot be fully automated must become a **machine-enforced evidence requirement plus an explicit
structured architecture decision**; it may not remain documentary while the phase is declared complete.

---

## 2. Baseline-evolution acceptance (workbook §24)

For every accepted-baseline change made during Phase 2:

```text
[ ] the change went through architecture:enforce:baseline:accept, not a hand edit
[ ] it is classified as RETIRED DEBT / NEW LEGITIMATE RELATION / NEW GRANDFATHERED DEBT
[ ] no change is count compensation (one edge removed does not license one added)
[ ] reintroducing a retired edge still FAILS
[ ] every NEW GRANDFATHERED DEBT carries a CITY-DEBT id, an exit condition, and a ledger entry
[ ] the baseline series entry names the exact (version, parent, hash) triple
```

---

## 3. Final acceptance commands (workbook §30)

Every command below must be run on the FINAL main SHA. None may be replaced by a local-only run.

```text
pnpm install --frozen-lockfile
build · typecheck · lint/quality · unit · acceptance · package (where applicable)

architecture observe
architecture baseline integrity
architecture baseline series authorization
architecture shadow
architecture enforce
architecture hosted parity
architecture legacy ratchet
test catalogue
Root Trust --check

capability ownership/manifest validator          (P2-A)
foundation inversion validator                   (P2-B)
cycle/SCC validator                              (P2-C)
private-state-access validator                   (P2-D)
durable-writer validator                         (P2-D)
flatness registry validator                      (P2-F)
bridge expiry validator                          (P2-F)
Core budget validator                            (P2-H)
replacement-lifecycle tests                      (P2-G)
```

Hosted CI must emit and pass, on that SHA:

```text
quality · unit · acceptance · package · architecture
```

and the final delivered branch's CI must be **all green** — this is the binding condition of the Owner
directive that governs this programme.

---

## 4. What would make this acceptance invalid

```text
lowering a threshold
excluding difficult source files from measurement
widening the baseline to swallow unexplained debt
marking unknown red as flaky
turning enforce into shadow
making architecture non-required again
removing a failing test without replacing its guarantee
moving a tag
rewriting the commit history
merging a temporary bridge with no exit condition
renaming MIGRATION_IN_PROGRESS to FLAT without a measurement
creating dummy promotion merges to satisfy H5
keeping Owner construction authority active forever
filling a row above in with an argument instead of a measurement
```

---

## 5. Sign-off block (filled at Phase 2 exit)

```text
PHASE2_START_MEASUREMENT_COMMIT = 5ade1cdfdb2d71fd58f0ca57905e0090e4690a24
PHASE2_FINAL_MEASUREMENT_COMMIT =
FOUNDATION_TO_BUILDING_EDGES   = starting 158 file edges / 82 pairs
CAPABILITY_CYCLES              = starting 1 SCC / 27 of 27 capabilities
UNCONTROLLED_LATERAL_EDGES     = starting not measured
PRIVATE_STATE_ACCESSES         = starting 13 (11 stores)
MULTI_WRITER_STORES            = starting 0 confirmed
UNSAFE_GAPS                    = starting n/a (no registry)
MIGRATIONS_IN_PROGRESS         = starting n/a
TEMP_BRIDGES                   = starting n/a
CORE_BUDGET_RESULT             = starting 6 files/49,336 B (narrowest) or 64 files/584,567 B (union)
REPLACEMENT_LIFECYCLE_PROOF    = (pending)
PHASE2_STATUS                  = IN_PROGRESS
```

A row is filled only when its measurement has been taken. **`PHASE2_STATUS = COMPLETE` requires every row above
to be a measurement and every `UNPROVEN` in §1 to be `PASS`.**
