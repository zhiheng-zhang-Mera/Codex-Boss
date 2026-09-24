# PHASE 2 — P2-A EDGE INVENTORY (measured)

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Measured at:** `ba39c88150053ea757314267184e840641158b3d` (`origin/main`)
**Method:** read-only. Every owned file under `electron/` and `src/` was read, its relative imports resolved with the
repository's own pattern and resolver (`scripts/architecture.cjs:256-266`, copied verbatim so this inventory and the
ratchet cannot disagree about what an edge is), and each resolved target attributed to its owning capability through
`config/capability-modules.json`.
**Status:** measurement only. Nothing was migrated, declared, exempted or waived to produce it.
**Read section 3a before quoting any kernel → feature number from this document.** The classification rests on the
ownership map and the manifests' `kind` fields — the declarations P2-A exists to correct — and the three largest
pairs were read and found to contain implausible attributions. The edges are real; the classification of each is not
yet a defect count.

---

## 1. Why this exists

P2-A increment 1 (`scripts/capability-closure-validator.cjs`) made the two ownership models' disagreement a
**failing check**. Increment 2 has to expand each manifest's `modules` to its capability's real implementation
surface — and the moment it does, the architecture ratchet starts reading 597 files instead of 25 and reports the
cross-capability edges that were previously invisible. This inventory is the size of that work, measured before it
starts, so the size is known rather than discovered.

## 2. The numbers

```text
files owned (electron/ + src/, by the ownership map)          597
capabilities with a declared kind                             27
module paths the manifests declare                            25      (0 of 597 are fully declared on both sides)

cross-capability file edges                                   794
distinct capability pairs                                     187
kernel -> feature file edges                                  154     (P2-B's target: 0)
kernel -> feature capability pairs                            43
mutual capability pairs (2-cycles, P2-C's target: 0)          53
cross-capability edges with BOTH endpoints declared           0
capability pairs already declared in `requires`/`optional`    1       of 187  ->  186 undeclared
```

The declared requirement pairs, in full:

```text
knowledge requires persistence.store@1      <- a real pair (the measurement finds knowledge -> persistence edges)
research  requires knowledge.store@1        <- measured: NO research -> knowledge import edge exists
theme     requires theme.registry@1         <- same capability, so not a cross-capability edge at all
```

So of 187 real cross-capability pairs, **one** is declared, and the other two declared requirements are a
requirement with no corresponding import in the tree and a capability requiring its own namespace. That is the
"FALSE_DEPENDENCY" row the Phase 2 spec records, now confirmed against the real graph rather than against the
manifests, and it is why **186 of 187 pairs are undeclared**.

## 3. P2-B — the 43 kernel → feature pairs (154 file edges)

The unit of repair is the **pair**, not the edge: a pair is one design decision (declare it, or invert it), and the
file edges are its instances.

```text
COUNT  PAIR                          COUNT  PAIR
-----  ----------------------------  -----  ----------------------------
   22  runtime -> tenx                  3  runtime -> attachments
   13  providers -> status              3  runtime -> security
   11  persistence -> tenx              2  providers -> engineering
   10  runtime -> workspace             2  providers -> workspace
    9  persistence -> tasks             2  runtime -> automation
    9  runtime -> research              (and 23 further pairs with 1-2 edges each)
    7  runtime -> tasks
    6  persistence -> workspace
    6  runtime -> status
    4  providers -> security
    4  providers -> tasks
    4  providers -> tenx
    4  runtime -> engineering
    4  runtime -> theme
    3  persistence -> status
```

The workbook §16 demands `foundation -> building implementation edges = 0`.

## 3a. **THE PAIR LIST IS NOT YET A DEFECT LIST** — the classification rests on the model P2-A is repairing

This is the most important caveat in this document, and it was found by trying to verify the counts rather than by
trusting them. Every pair above is derived from **two** inputs: the real import graph (measured) and each file's
owning capability plus its `kind` (the ownership map and the manifests — the very declarations P2-A exists to
correct). The map's attributions are demonstrably wrong, so the pair list inherits those errors.

The three largest "kernel → feature" pairs, with the real edges the instrument found for each:

```text
runtime -> tenx  (22)
    electron/capability/integration/execution-authorization.ts -> electron/commander/execution-gate.ts
    electron/main.ts                                          -> electron/commander/recovery-scheduler.ts
    electron/main.ts                                          -> electron/commander/web-recovery.ts

providers -> status  (13)
    electron/account-sessions.ts     -> src/shared/contracts.ts
    electron/adapters/registry.ts    -> src/shared/contracts.ts
    electron/api-settings.ts         -> src/shared/contracts.ts

persistence -> tenx  (11)
    electron/bootstrap/persistence.ts -> electron/commander/task-ledger.ts
    electron/bootstrap/persistence.ts -> electron/commander/budget-manager.ts
    electron/bootstrap/persistence.ts -> electron/commander/context-manager.ts
```

Reading those edges changes their meaning:

```text
`electron/commander/**` is attributed to the `tenx` capability. But `task-ledger`, `budget-manager`,
`context-manager`, `recovery-scheduler`, `web-recovery` and `execution-gate` are not obviously a "tenx"
capability's business — several look like ordinary runtime/task machinery that has been placed in, or attributed
to, a feature. If that attribution is wrong, these are not kernel -> feature inversions at all; they are
attribution errors, and the repair is to name the owner correctly rather than to invert a dependency.

`src/shared/contracts.ts` is attributed to `status`. A file named `contracts` in the SHARED tree being the
"status" capability's implementation is implausible; if it is really shared foundation, then `providers ->
status` is not an inversion either.

The capability named `runtime` — a KERNEL — owns `electron/main.ts`, `electron/preload.ts` and the twelve
`electron/platform/**` instrumentation modules. A composition root and a platform's own instruments are not a
capability's implementation, so a large share of "runtime -> *" edges are the composition root wiring the
application, which P2-B's own note (spec §3.2) already classifies as a DIFFERENT class from an inversion.
```

**Consequence, stated as an instruction rather than an apology:** no pair in this list may be treated as a defect
until its two endpoints have been read. The work list is real (the edges exist), but each pair needs a decision
made by reading the code, and the decision is one of **three**, not two:

```text
1  DECLARE     the relation is legitimate wiring; put it on the importing capability's `surface`/`requires`
2  INVERT      a foundation module genuinely implements against a building; move the contract or invert control
3  RE-ATTRIBUTE the owning capability or the `kind` is wrong; repair the attribution and the "inversion" dissolves
```

`shared/contracts.ts`, `electron/main.ts` and the `electron/commander/**` family are the first three places to
read, because they account for most of the two largest pairs. Until they are read, the headline count of 154
kernel → feature edges is an **upper bound produced by a model under repair**, not a defect count — and it must
not be quoted as one.

**The historical inversion named in the workbook needs no such caveat**, because it was verified by reading the
file rather than by inferring it from the edge list:

```text
electron/bootstrap/persistence.ts  imports  ../runtime-intelligence/live-capture
```

That one is a foundation module importing a capability's implementation, and it is live.

## 4. P2-C — the 53 mutual pairs (2-cycles)

```text
tenx <-> tasks                27 / 2        engineering <-> promotion     10 / 9
tenx <-> providers            24 / 4        research <-> tenx             10 / 5
runtime <-> tenx              22 / 3        runtime <-> workspace         10 / 1
tenx <-> engineering          21 / 13       automation <-> providers       9 / 1
engineering <-> runtime       18 / 4        persistence <-> tasks          9 / 1
runtime <-> providers         18 / 9        runtime <-> research           9 / 6
engineering <-> tasks         16 / 3        knowledge <-> tenx             8 / 4
promotion <-> security        16 / 6        tenx <-> workspace             8 / 4
engineering <-> status        15 / 3        (and 34 further pairs)
status <-> tasks              14 / 6
providers <-> status          13 / 1
tenx <-> persistence          13 / 11
tenx <-> status               13 / 5
```

`tenx` participates in **16 of the 53** mutual pairs and has the largest single asymmetric pair
(`tenx <-> tasks`, 27 against 2) — which says its 27 outbound edges are mostly *reads of other capabilities*
rather than a genuine two-way dependency. That distinction matters for the repair: an asymmetric pair is often not
a design cycle at all but a hidden read model or a missing contract, and P2-C's tactics list starts with exactly
that ("extract road/interface"). Treating all 53 as equivalent would produce the wrong work.

## 5. What this inventory does not claim

```text
NOT CLAIMED  that the 154 kernel -> feature edges are 154 defects. Section 3a shows why: the classification rests
             on the ownership map and the manifests' `kind` fields -- the declarations P2-A exists to correct --
             and reading the three largest pairs shows implausible attributions (`src/shared/contracts.ts` owned by
             `status`; `electron/main.ts` owned by a kernel capability; `electron/commander/**` owned by `tenx`).
             The number is an UPPER BOUND produced by a model under repair. The EDGES are real; the classification
             of each is not yet.
NOT CLAIMED  that every edge is a defect. A pair is one design decision, and there are three options, not two:
             declare the relation, invert it, or repair the attribution that made it look like an inversion.
NOT CLAIMED  that the edge count is stable. It is a measurement at one commit; `tenx`, `engineering`, `status` and
             `runtime` carry most of it, so it will move as they are repaired -- and it will move when
             `runtime`'s ownership of `electron/main.ts` and `electron/platform/**` is corrected, before any code
             changes at all.
NOT CLAIMED  that expanding `modules` is safe to land alone. It is not: the expanded manifests make the required
             `quality` job's `architecture:ratchet` report these edges as `kernel-imports-feature` /
             `feature-imports-undeclared-surface` violations, which is the intended measurement and a hard red
             gate. Increment 2 therefore has to land WITH the per-pair decisions, or the ratchet has to keep
             reading the declared surface until those decisions exist -- and the second option is the status quo
             this phase exists to end.
NOT CLAIMED  that the enforcement baseline can stay as it is. Re-owning the files changes
             `config/architecture-enforcement-baseline.json`'s identity, so the Owner-authorised series entry has
             to be re-accepted -- a Root Trust Surface change, a new epoch, and an Owner act. The Phase 2 spec
             states the two-part recovery before it is attempted.
```

## 6. A CI-flake observation from shipping this increment (recorded, not fixed here)

The merge of this work produced one red `unit` job on `main` at `0429d59d` **while the identical tree was green on
the pull request**, and a re-run of the failed job on the same commit returned success. That is a flake by
definition, and it is the second of the same class in this programme:

```text
commit      0429d59d6b3e5d63ff0c1d2f454a9c61d07e38cf   run 35989272641   unit FAILED
            tests/acceptance/autonomous-evolution-adversarial.test.ts :: AD-36
            Error: Test timed out in 60000ms.
same commit, re-run of that failed job                ALL FIVE GREEN

earlier     e121d84 (the S3 merge)                     run 35977080133   unit FAILED
            tests/unit/platform/durable-event-correctness.test.ts :: the 10k-event case
            Error: Test timed out in 60000ms.   (measured 123s under load; ~24s when runner load is low)
```

Both are the same mechanism: a heavy case in the default `unit` tier against that tier's 60 s per-test ceiling
(`vitest.unit.config.mjs`), where the case's cost depends on how many of the 273 files are running in parallel on a
shared Windows runner. Neither is a defect in the code those commits changed. Both ARE real availability defects in
the merge gate, because a red `unit` blocks the merge and, on `main`, fails this programme's binding acceptance
condition.

**What is deliberately NOT done here:** no timeout was raised, no case was excluded from measurement, and no
assertion was weakened to make the gate green. A per-test timeout is a legitimate performance declaration, but
raising one without measuring the case's cost under contention would be guessing. The honest fix belongs to the
increment that can measure it, and it is written down so that increment starts from this observation:

```text
RECOMMENDATION FOR THE NEXT INCREMENT
  1  measure the per-case duration of the heavy cases under the parallel load CI actually produces;
  2  give each load-dependent case an explicit per-test budget justified by that measurement, or move it to a
     tier that runs it with a declared cost -- keeping it inside the merge gate either way;
  3  do NOT widen the global tier timeout, which would hide every future case that genuinely hangs.
```

### 6a. The measurement has been taken, and the fix is NOT a judgment call

Step 1 is done. Per-file durations were extracted from the **green** `unit` job of run `35993659352` (`main` at
`3ebe9e3`) — the same job that intermittently fails:

```text
107 968 ms  tests/acceptance/autonomous-evolution-adversarial.test.ts   (its AD-36 case timed out at 60 000 ms)
 22 532 ms  tests/unit/platform/durable-event-correctness.test.ts       (measured 123 450 ms in the run that failed)
```

Nothing else in the tier is close: the next slowest suites are 32s, 31s and 30s as files, and the slowest single
CASE anywhere in that green run was 31s against the 60s ceiling. The tier's other heavy suites (`platform-soak`,
`scale-synthetic`, `evolution-sandbox`, `review-loop`) are **already** in the slow tier, which is why they appear in
the log without being part of the default run — an independent confirmation that this diagnosis and the existing
split agree.

**So the fix follows a precedent this repository already set and needs no new design decision.** The slow tier exists
for exactly this: `vitest.slow.config.mjs` records that `tests/acceptance/review-loop.test.ts` had a slowest scenario
of ~29s that "exceeded the 60s default per-test ceiling under the load of a full parallel run, failing green commits
three times" — the identical mechanism — and the response was to move that file to the slow tier, raise that tier's
ceiling to 180s, and run it with `maxWorkers: 1` so the bound is the measured one rather than a guess.

One of the two suites makes the argument for itself: the header of `durable-event-correctness.test.ts` claims
"roughly an order of magnitude of margin on a shared runner". The measurement is 22.5s green against a 60s ceiling —
a factor of 2.7, not 10 — and 123s under contention. The documented margin does not exist, and that claim should be
corrected in the same commit that moves the file.

**What ships in this increment:** this measurement and the citation of the precedent. **What does NOT:** the file
moves, because moving a suite into the slow tier is governed by `tests/unit/test-layers.test.ts`, which requires each
entry to declare a `kind` (`spawns` or `in-process`), its `measured` cost and its `because` reason, and to back the
claim with evidence inside the file:

```text
autonomous-evolution-adversarial.test.ts   1 spawn marker  -> declarable as `spawns`, whose evidence the guard checks
durable-event-correctness.test.ts          0 spawn markers AND 0 database markers: it opens its database through
                                           `runDurableEventContract`, so the guard's evidence regex would have to
                                           accept the helper call as durable-work evidence -- a REFINEMENT of the
                                           guard's evidence, stated and justified, not a weakening of it.
```

The increment that moves them must make that declaration and carry the guard's evidence with it. Doing it here, on a
measurement taken minutes earlier and with no local reproduction of the contended case, would be the guess this
section exists to refuse.

## 7. How to reproduce

```powershell
cd D:\Codex-Boss
git rev-parse HEAD                     # ba39c88150053ea757314267184e840641158b3d
node scripts/capability-closure-validator.cjs          # the two-model state: owned 597, declared 25
node scripts/phase2-edge-inventory.cjs                 # this inventory (summary)
node scripts/phase2-edge-inventory.cjs --json          # this inventory (full)
# the historical inversion, read directly rather than inferred from the edge list:
Select-String -Path electron\bootstrap\persistence.ts -Pattern "runtime-intelligence"
```
