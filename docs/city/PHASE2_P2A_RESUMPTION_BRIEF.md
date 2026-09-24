# PHASE 2 — P2-A INCREMENT 2: RESUMPTION BRIEF

**Purpose.** Everything an executor needs to pick up P2-A increment 2 without re-deriving it. Written because four
construction rounds ended in state verification alone: the remaining steps are each large enough that starting one
without the budget to verify it would risk the error class the ledger has already had to correct twice (CC-018, a
claim published before it was measured; CC-019, a guard that only looked right until it was falsified).

**Baseline.** `main` at `d98d2fddd4fa343771648061b29f0f25a5f4aa95`, Root Trust epoch 33, five required contexts
(`quality, unit, acceptance, package, architecture`, strict), closure validator `VERDICT=PASS`.

---

## 1. Where to start, and why there

**Step ② — the composition-root owner class.** It is the smallest of the four remaining steps and it unblocks the
count that steps ③ and ④ depend on. Its mechanism is already pinned in `OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md`
CC-020; what is missing is the design and its verification.

```text
THE PROBLEM
  scripts/extend-capability-modules.cjs:248-249  lists "electron/main.ts" and "electron/preload.ts" in the
                                                 `runtime` capability's EXTRA block, so `runtime` -- a KERNEL --
                                                 owns the 89 KB composition root
  consequence                                     every `runtime -> *` edge whose SOURCE is main.ts or preload.ts is
                                                 counted as a kernel-into-feature INVERSION by
                                                 scripts/phase2-edge-inventory.cjs

THE FIX THAT DOES NOT WORK
  deleting the two patterns makes both files UNOWNED, and the closure validator requires every scanned source file
  to be owned OR exempt with a reason. There is no third class, so `unowned scanned files` goes 0 -> 2 and
  `VERDICT=PASS` becomes a failure. An exemption is wrong: these files are the composition root, which owns the
  wiring, not files nobody owns.
```

## 2. The three consumers the new class must satisfy

```text
1  scripts/capability-closure-validator.cjs
   must accept a platform owner as NEITHER a capability NOR an exemption, and must still refuse a file with NO
   owner at all. Its `findings.ownedAndExempt` check must stay meaningful: a platform owner is not an exemption.

2  electron/platform/test-impact.ts   (buildModuleOwnership, ~line 119)
   iterates `extra.capabilities` keys and requires each to be a declared capability id. A new top-level key must
   therefore NOT be read as a capability -- or, if it is, its suites must be selected for it.
   THIS IS THE DANGEROUS ONE: getting it wrong silently narrows which suites a change selects, and no test in this
   repository currently catches that. Whatever shape is chosen, the selector's blast radius for a change to
   `electron/main.ts` must be OBSERVED BEFORE AND AFTER and recorded as a change.

3  scripts/generate-test-catalogue.cjs   (lines 284, 350)
   derives `covers` from the same map and prints "N of M capabilities covered". A new key changes M.
```

## 3. The recommended shape, to be confirmed against the consumers

```text
config/capability-modules.json gains a THIRD top-level section beside `capabilities` and `exempt`:

  "platform": {
    "electron/main.ts": "<why this file is the composition root rather than a capability's implementation>",
    "electron/preload.ts": "..."
  }

  -- a MAP of path -> reason, not a pattern list, so every entry states why it is not a capability, in the same
     spirit as `exempt` but a different claim: "the platform owns this" rather than "nobody owns this"

  scripts/extend-capability-modules.cjs moves the two entries out of `runtime` EXTRA into a PLATFORM table
  scripts/capability-closure-validator.cjs treats a `platform` match as OWNED-BY-PLATFORM: not a capability, not an
                                       exemption, and still an owner for the coverage check
  electron/platform/test-impact.ts   must decide, explicitly and with a measurement, whether a platform change
                                     forces a full run (safe, conservative) or selects the suites that already
                                     cover it -- and the choice must be recorded, not inferred
```

## 4. Verification that must pass before the step is called done

```powershell
cd D:\Codex-Boss
node scripts/capability-closure-validator.cjs                 # VERDICT=PASS, unowned 0, ownedAndExempt 0
node scripts/generate-test-catalogue.cjs                      # regenerates; M must not silently drop a capability
node scripts/generate-test-catalogue.cjs --check              # current
npx vitest run --config vitest.unit.config.mjs tests/unit/platform/test-impact.test.ts
npx vitest run --config vitest.unit.config.mjs tests/unit/test-layers.test.ts tests/unit/comment-citation.test.ts
node scripts/phase2-edge-inventory.cjs                        # kernel->feature count AFTER the change, vs 154 before
npx tsc --noEmit -p tsconfig.json ; -p tsconfig.electron.json ; -p tsconfig.tests.json
node scripts/capability-closure-validator.cjs --json          # record the before/after ownership numbers
```

**Blast radius must be measured, not assumed.** Run the impact selector for `electron/main.ts` BEFORE the change and
AFTER it, and record both results. A narrowing that is not recorded is the failure mode this step is most likely to
produce.

**Root Trust consequence.** `electron/platform/test-impact.ts` is not Root Trust Surface, but
`tests/unit/platform/test-impact.test.ts` and the manifests are classified through `tests/**`; check
`acceptance-evolution-bless.cjs --check` on the branch BEFORE opening the PR. If the surface moves, the PR will fail
the epoch guard on its head and needs the documented L3 bypass followed by the next epoch ceremony — the cadence this
session already performed five times (epochs 29→33).

## 5. Steps ③ and ④, in the order the measurements support

```text
③  SPLIT src/shared/contracts.ts by its seven concerns (provider / task / council / claim-evidence / conversation /
    remote / app snapshot). 48 importers; each move is a cross-file edit whose blast radius is the whole application
    surface, and the ownership map must move in the same step or the selector's blast radii become wrong for files
    it no longer owns. Largest of the three; goes last of the three.

④  EXPAND each manifest's `modules` to the capability's real surface (572 files that only the ownership map owns
    today). The moment this lands, `architecture:ratchet` reads the real graph and reports the surviving
    cross-capability edges as `kernel-imports-feature` / `feature-imports-undeclared-surface` violations in the
    REQUIRED `quality` job -- so it lands WITH the per-pair decisions, never before them.
    Increment ⑤ then follows: regenerate the enforcement baseline and obtain the Owner-authorised series entry.
    That moves `baseline_hash`, so the only ACCEPTED series entry stops naming the committed baseline and the
    enforcement engine returns BASELINE_SERIES_UNAUTHORISED in BOTH modes -- the hosted `architecture` job fails
    closed. Recovery is two-part: regenerate a candidate, then add the (version, parent, hash) triple to
    trust-policy/architecture-enforcement-baselines.json BEFORE --accept. trust-policy/** is Root Trust Surface,
    so that is an Owner act and it requires the next epoch.
```

## 6. What is already decided and must not be re-litigated

```text
electron/commander/**     shared task-execution infrastructure (a ROAD, not a building): 129 importing statements
                          outside the directory across 20+ capabilities. Removing it from `tenx` is decided; the
                          FILE MIGRATION belongs to P2-E road extraction, which must justify an extraction on five
                          named points. Do not move the files as part of P2-A.
electron/main.ts          the composition root, NOT a kernel capability's implementation. Class 1 in the spec's
                          §3.2: declare the wiring, do not repair it.
the 154 count             30% of it is the two attribution errors above. It is an UPPER BOUND produced by a model
                          under repair, not a defect count. Re-measure after step ②, and quote neither number
                          without naming the ownership model that produced it.
```

## 7. Open items that are NOT P2-A

```text
§10  hosted negative control + evidence tag      NOT STARTED   (S2 exit depends on it)
§11  S2 exit certification                       NOT STARTED
CC-017/CC-019  the soak sample floor: a MACHINE-THROUGHPUT assertion, and `slopePerMinute` returns a placeholder 0
               below three samples. The honest trend is now null and the gate fails closed (epoch 32), so an
               under-sampled run FAILS with a readable reason. The remaining work is to choose between a longer
               soak and a sampling bound derived from measured per-cycle cost -- NOT to relax the assertion.
```
