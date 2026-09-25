# PHASE 2 — P2-A INCREMENT 2: RESUMPTION BRIEF

**Purpose.** Everything an executor needs to pick up P2-A increment 2 without re-deriving it. Written because four
construction rounds ended in state verification alone: the remaining steps are each large enough that starting one
without the budget to verify it would risk the error class the ledger has already had to correct twice (CC-018, a
claim published before it was measured; CC-019, a guard that only looked right until it was falsified).

**Baseline.** `main` at `d98d2fddd4fa343771648061b29f0f25a5f4aa95`, Root Trust epoch 33, five required contexts
(`quality, unit, acceptance, package, architecture`, strict), closure validator `VERDICT=PASS`.

---

## 1. Where to start, and why there

**STEP ② IS DONE.** Landed in P2-A increment 2. `electron/main.ts` and `electron/preload.ts` are owned by
`composition_root`, a third owner class beside `capabilities` and `exempt`. The full record, including the
BEFORE/AFTER numbers for the selector, the closure validator and the edge inventory, is
`docs/city/PHASE2_P2A_COMPOSITION_ROOT_CLASS.md`; the ledger entry is CC-023. **Do not re-derive it, and do not
re-litigate Option B** — it was checked and refuted by measurement: none of the seven `runtime`-selected suites
references `electron/main.ts` at all. The next steps are ③ (`src/shared/contracts.ts`) and ④ (the manifests'
`modules`), below.

**§6 of this brief is unchanged and still binding**, except that the 154 count is now re-measured: the
composition root was 72 of it. The remaining model-under-repair number is 82 edges over 25 pairs.

The original framing of step ②, kept so the reasoning is auditable:

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

### 3a. THE BASELINE IS MEASURED — and the AFTER result is now recorded

**RESOLVED.** Option C was chosen: a composition-root change forces a full run, announced with the reason
`"composition_root has no bounded blast radius, so no subset of the suite can be justified for a change to it"`,
with `unattributedFiles` empty. Option B was refuted by reading the seven suites: none of them references
`electron/main.ts` or `electron/preload.ts`. The construction of those seven was an artefact of the
misattribution. Measured with the same command, before and after:

```text
                                  BEFORE                                  AFTER
seeds                             ["runtime"]                             ["composition_root"]
selected                          36 suites {acceptance 5, unit 31}       29 suites {acceptance 3, unit 26}
because "runtime"                 7                                       (n/a -- always-run only)
because "always-run"              29                                      29
fullRunRequired                   false                                   TRUE
unattributedFiles                 []                                      []
blind                             false                                   false
catalogue                         289                                     289
```

The pre-change numbers below are kept as the record of what was measured first.

Taken on `main` at `c6d65868`, before any change, with the selector's own CLI:

```powershell
node scripts/test-impact.cjs select --base HEAD --changed electron/main.ts
```

```text
changedFiles   ["electron/main.ts"]
seeds          ["runtime"]        affected ["runtime"]
selected       36 suites          {"acceptance": 5, "unit": 31}
because "runtime"        7        <- the suites the ownership map actually attributes to this file
because "always-run"    29        <- independent of ownership
catalogue size          289        <- what a FULL RUN would be
```

**The number that matters for the decision is the 7, not the 36.** Thirty-six suites are selected today for a change
to the composition root, but twenty-nine of them are always-run and have nothing to do with the ownership map. So
the blast radius the new `platform` class can actually affect is **seven suites**, and the choice narrows to:

```text
OPTION A  platform-owned files select NOTHING                        -> 36 become 29 (a 7-suite narrowing, silent)
OPTION B  platform-owned files select every suite that covers them today  -> stays 36; the mapping is explicit
                                                                        and moves with the tests
OPTION C  platform-owned files force a FULL RUN                      -> 36 become 289 for these two files
```

**Option A is the silent narrowing CC-020 warned about, and it is now quantified: seven suites, with no test
currently asserting they stay selected.** Option B is the conservative correct answer *if* the seven suites really do
cover composition-root behaviour — which must be checked, not assumed. Option C is honest but turns every
composition-root edit into a 289-suite run.

**Record the AFTER numbers from the same command, with the same fields.** A change to this model that alters the
selection without those two sets of numbers side by side is exactly the failure the brief exists to prevent.


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
§10  hosted negative control + evidence tag      DONE  — RUN on the hosted runner; runs 36068999761 /
                                                       36069017063 on 57aeede5, evidence tag
                                                       city-evidence-s2-negative-control-v1.
                                                       Records: docs/city/S2_HOSTED_NEGATIVE_CONTROL_RECORD.md,
                                                       paper-ledger section V, ledger CC-024.
§11  S2 exit certification                       DONE  — S2_EXIT_COMPLETE = YES. 36 consecutive valid hosted
                                                       runs, 0 excluded, ONE finding digest throughout across
                                                       eight root-trust epochs. Re-derivable with
                                                       `node scripts/s2-exit-audit.cjs`.
                                                       Record: docs/city/S2_EXIT_CERTIFICATION.md, ledger CC-025.
§16  P2-B regression check                       DONE  — `node scripts/p2b-kernel-feature-ratchet.cjs` records the
                                                       REAL graph's floor (now 73 kernel -> feature edges over 25
                                                       pairs, lowered from 82 by the provider closure; under the
                                                       OWNERSHIP MAP, which the manifests-only legacy ratchet
                                                       cannot see) and refuses a silent regression, including
                                                       progress achieved by scanning fewer files.
                                                       Ledger CC-026. The MIGRATION to 0 is still open.
§17  P2-C cycle/SCC measurement + floor          DONE  — `node scripts/phase2-cycles.cjs`: 28 capability nodes,
                                                       193 directed edges, 9 SCCs and ONE of them holds 20 of 28,
                                                       with 8 capabilities already outside the knot. History was
                                                       one SCC of 25 of 27. Ratcheted by the same judge as §16,
                                                       with node/edge FLOORS so the component cannot be shrunk by
                                                       losing an edge. Ledger CC-030.
                                                       THE PLANNING CONSEQUENCE: pairwise repairs do not split a
                                                       component of 20, so P2-C is one connected problem.
                                                       ALSO IN CC-030: re-attributing electron/commander/** to a
                                                       road class was REFUTED by measurement -- 132 incoming and
                                                       122 outgoing edges, 39 onto three kernels -- so it would
                                                       hide those edges rather than repair them. The MIGRATION to
                                                       0 cycles is still open.
§18  P2-D private-state measurement + validator  DONE  — `node scripts/phase2-private-state.cjs`: FIVE
                                                       cross-domain private-state accesses over THREE pairs, ALL
                                                       into one namespace (`tasks`, owned by persistence,
                                                       resolved by hard-coded path from host-status, runtime and
                                                       tenx). host-status reaching the task ledger is the
                                                       workbook's OWN historical example, so the instrument finds
                                                       the defect it was written for. A CONFIRMED ceiling and a
                                                       TOTAL one -- so an access cannot hide by being
                                                       unclassifiable -- over declared-namespace and scanned-file
                                                       floors. Ledger CC-031.
                                                       NOT CLAIMED there: read-versus-write, which the source
                                                       does not carry; the declared single-owner property is
                                                       machine-enforced instead.
                                                       The MIGRATION to 0 accesses is still open, and it is a
                                                       STRUCTURAL change, so it costs the ceremony in section 8.
CC-017/CC-019  the soak sample floor: a MACHINE-THROUGHPUT assertion, and `slopePerMinute` returns a placeholder 0
               below three samples. The honest trend is now null and the gate fails closed (epoch 32), so an
               under-sampled run FAILS with a readable reason. The remaining work is to choose between a longer
               soak and a sampling bound derived from measured per-cycle cost -- NOT to relax the assertion.
§20  P2-F flatness registry + validator  DONE  — `config/city-flatness.json` gives every plot ONE state from the
                                               five; the plot set is DERIVED from the manifests. Measured: 27
                                               plots, 5 FLAT, 22 MIGRATION_IN_PROGRESS, one bridge declared, 3
                                               migration stages each with an exit condition.
                                               `node scripts/city-flatness-validator.cjs` passes; `--seal`
                                               reports SEAL_BLOCKED and exits 1, which IS the deliverable: the
                                               seal is machine-checkable and cannot be made to pass by editing the
                                               file, because the validator cross-checks the registry against the
                                               three instruments and refuses FLAT on an implicated plot.
                                               Ledger CC-032.
                                               THE 22 MIGRATIONS ARE THE PROGRAMME'S REMAINING WORK, in one
                                               place, each naming its stage and exit. Section 8 below is why they
                                               cannot simply be done.
```

## 8. READ THIS BEFORE STARTING ANY STRUCTURAL STEP: the gate prices it as an Owner act

Measured while attempting step ③a (the provider closure). It changes how every remaining migration step must be
planned, so it is recorded on `main` rather than only in the branch that found it.

```text
THE MEASUREMENT
  Step ③a was built, typechecked and measured: the provider closure moved out of src/shared/contracts.ts into
  src/shared/provider-contracts.ts, 30 importers re-pointed, ownership map and providers.yaml moved with it.
  Effect under the ownership map: kernel -> feature 82 -> 73, `providers -> status` 13 -> 3, mutual pairs
  unchanged at 38, all three tsconfigs clean, closure VERDICT=PASS, legacy ratchet pass: true.

  IT CANNOT LAND WITHOUT AN OWNER-AUTHORISED CEREMONY, and `architecture:enforce` says exactly why: 29
  violations, being
    25  NEW_EDGE_UNDECLARED_ENDPOINT   new edges onto the new module whose SOURCE file no manifest declares.
                                       NO DECLARATION CAN FIX THESE -- the sources are 25 files no manifest lists.
     4  NEW_UNDECLARED_CROSS_CAPABILITY_EDGE  the four feature boot modules that name a provider type without
                                       declaring a `requires:` on `providers`.

  So ANY structural change -- a new module, a moved type, a split file -- costs:
    1  the manifest declarations that can be made (these raise the legacy ratchet's dependencyEdgeCount), then
    2  config/architecture-baseline.json                       (Root Trust Surface)
    3  trust-policy/architecture-enforcement-baselines.json     the (version, parent, hash) TRIPLE, added BEFORE
                                                                regenerating, or the engine returns
                                                                BASELINE_SERIES_UNAUTHORISED in BOTH modes
    4  config/architecture-enforcement-baseline.json            regenerated (Root Trust Surface)
    5  an epoch ceremony, because 2, 3 and 4 are all on the surface

  This is deliberate -- it is what "no new architecture debt without an Owner act" means operationally -- but it
  was invisible until a refactor was attempted, and it means the P2 migration is gated on a ceremony PER STEP,
  not only on code. Budget for it.

A SECOND, SMALLER TRAP
  The architecture sensor scans TRACKED files. A new module measured BEFORE `git add` is invisible to it, and the
  run reports 32 UNRESOLVED_SOURCE_TARGET_MISSING instead of the two real classes -- same exit code, same
  POLICY_VIOLATION verdict, different meaning. Commit (or at least `git add`) before measuring, or the
  measurement describes a tree the sensor cannot see.

THE STEPS ABOVE WERE PERFORMED — THIS SECTION IS A CONSTRAINT, NOT A PENDING TASK
  Step ③a landed through exactly the sequence described: the module was declared in `providers.yaml`
  (`modules` AND `surface`), the enforcement baseline version 2 was accepted with its series entry added FIRST,
  and epoch 34 was carried through the protected finalization workflow. Measured on main afterwards: kernel ->
  feature 73, `providers -> status` 3, closure PASS, legacy ratchet pass, enforcement PASS with 0 violations
  and 0 engine errors, epoch 34 MATCHES. Records: ledger CC-027 (measurement), CC-028 (acceptance), CC-029
  (landing + ceremony).

  KEEP THIS SECTION FOR THE NEXT STRUCTURAL STEP. It is not a report of an obstacle that was overcome once; it
  is the price list. Section 15 item 4 (expand each manifest's `modules` to its real surface) is the next
  structural change and will cost the same ceremony, so budget for it rather than discovering it.

  ONE PIECE OF DEBT WAS CREATED BY THE CEREMONY AND IS OPEN (CC-029): the protected finalization workflow
  interpolates the three Owner inputs into a DOUBLE-QUOTED PowerShell command line, so a justification
  containing a dollar-brace expression is a ParserError and the run fails closed -- which is what happened to
  the first dispatch of this ceremony. The repair is to pass those inputs through ENVIRONMENT VARIABLES and
  assert the recorded value equals the input byte-for-byte. It needs its own epoch because
  `.github/workflows/trust-epoch-finalization.yml` is Root Trust Surface.
```
