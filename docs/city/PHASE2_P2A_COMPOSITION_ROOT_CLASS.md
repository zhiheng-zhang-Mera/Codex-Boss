# PHASE 2 — P2-A INCREMENT 2, STEP ②: THE COMPOSITION ROOT AS A THIRD OWNER CLASS

**Status.** LANDED in this increment. `scripts/capability-closure-validator.cjs` reports `VERDICT=PASS`; the
ownership map is regenerated reproducibly; the impact selector's blast radius for the composition root is
measured before and after and recorded in §5.

**What it delivers.** `electron/main.ts` and `electron/preload.ts` are owned by the PLATFORM — named
`composition_root` — instead of by the `runtime` capability. The measured consequence is in §4: the
kernel → feature work list falls from `154` edges over `43` pairs to `82` over `25`, and the mutual-pair list
from `53` to `38`, with **no file and no edge removed from the measurement**.

**Why the section is not called `platform`.** The mechanism was pinned in
`OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md` CC-020 as "a named non-capability owner class" and the resumption
brief proposed `platform`. That name was rejected during implementation for a reason that only shows up when
the maps are read side by side: `electron/platform/**` — the directory holding `test-impact.ts`,
`dependency-graph.ts` and the registry — is owned by the **`runtime` capability**. A class named `platform`
would read as *the owner of `electron/platform/`*, and the class's own constant would live inside the directory
it appeared to own. `composition_root` is the name the workbook's own §3.2 uses for class-1 wiring, and it
collides with nothing.

---

## 1. The five consumers, not three

CC-020 named three consumers that the new class had to satisfy. Reading every reader of
`config/capability-modules.json` before editing found **five**. The two it did not name both *drop* the files
silently, which is the failure mode the class exists to avoid:

```text
1  scripts/capability-closure-validator.cjs      REQUIRED the class, or unowned 0 -> 2
2  electron/platform/test-impact.ts              the impact selector's ownership map
3  scripts/generate-test-catalogue.cjs           reads `.capabilities` only -> unaffected by construction
4  scripts/phase2-edge-inventory.cjs              NOT IN CC-020. Builds its owner map from `.capabilities`,
                                                 so a file owned by nothing is removed from `files` and its
                                                 edges VANISH from the inventory. The step exists to move this
                                                 program's numbers, so its behaviour is the point, not a detail:
                                                 the fix RE-ATTRIBUTES the edges and asserts that the file count
                                                 and edge total do not shrink.
5  electron/self-cognition/facts.ts               NOT IN CC-020. Reads `capabilities` and `exempt` into the
   src/shared/self-cognition/anatomy.ts          self model's ownership fact, and builds components only for
                                                 paths an owner covers. Left alone, the composition root would
                                                 disappear from Boss's description of its own anatomy.
```

Consumer 3 is satisfied by construction: `composition_root` is a separate top-level key, so the generator's
`covers` derivation and its "N of M capabilities covered" denominator are untouched — measured at **27 of 27**,
unchanged, with `config/test-catalogue.json` byte-identical after regeneration.

---

## 2. The shape chosen

```json
{
  "$comment": "... `composition_root` records the paths the PLATFORM owns ... `exempt` records paths
               deliberately owned by nobody, each with its reason.",
  "capabilities": { "runtime": ["...", "..."] },
  "exempt": { "src/renderer": "..." },
  "composition_root": {
    "electron/main.ts": "the composition root: it builds the window, registers every capability's boot
                         module and wires them to each other ...",
    "electron/preload.ts": "the other half of the composition root's boundary ..."
  }
}
```

A **map of path to reason**, as the brief proposed, not a pattern list: every entry has to state why it is not a
capability, exactly as `exempt` states why nothing owns its entries. The two non-capability tables make
*different claims* — "the platform owns this" versus "nobody owns this" — and the validator refuses a file that
is in both.

### 2a. The generator had to SUBTRACT, not merely stop adding

This is the trap in the step, and it is why the change could not be an edit to the `EXTRA` table alone:

```text
scripts/extend-capability-modules.cjs:327-330   `capabilities[capabilityId] = union(file, EXTRA)`

The file IS the base that the table widens. Deleting the two patterns from `runtime`'s EXTRA block therefore
leaves `runtime` owning them for ever: the union re-asserts the claim from the file on every run, and the
table stops describing the artifact. Verified before editing: after removing the two entries from EXTRA,
`config/capability-modules.json` still listed `electron/main.ts` under `runtime`.

The repair is that `main()` subtracts `Object.keys(COMPOSITION_ROOT)` from every capability's list BEFORE
anything is validated, so re-running the generator REPAIRS the misattribution instead of preserving it.
```

Idempotence is verified: two consecutive runs produce the same file (`272` → `270` owned patterns, `8` changed
lines, no further change on the second run).

---

## 3. What each consumer now does

```text
closure validator        a `platform` match is OWNED-BY-PLATFORM: not a capability, not an exemption, and still
                         an owner for coverage. `findings.ownedAndExempt` keeps its meaning because a
                         composition-root file is not an exemption. Three new contradiction checks, because a
                         third class means three more ways to contradict: capability+composition_root,
                         composition_root+exempt, and a composition-root entry with no substantive reason.

impact selector          `electron/platform/test-impact.ts` adds the composition root to the ownership map
                         under `COMPOSITION_ROOT_OWNER_ID`, AFTER the manifest-id check rather than through it
                         (`composition_root` is deliberately not a capability, so it must not be validated as
                         one). `ImpactRepository` gains `unboundedCapabilities`, derived from the map's own
                         `composition_root` keys, so adding a composition-root file is a data change.

pure decision            `src/shared/test-impact.ts` gains `SelectOptions.unboundedCapabilities` and one rule:
                         a seed with no bounded radius forces a full run, with a reason that NAMES the owner.
                         The reason string is generic ("has no bounded blast radius") because the module is
                         pure and does not know what a composition root is.

edge inventory           builds its owner map from `capabilities` AND `composition_root`, and gives the
                         composition root the kind `composition-root`, which can never satisfy
                         `fromKind === "kernel" && toKind === "feature"`.

self-cognition           `SelfFacts["ownership"]` gains an optional `compositionRoot`; `facts.ts` reads the
                         section and includes its paths in the anatomy path set; `anatomy.ts` recognises the
                         composition root as an owner so `electron/main.ts` keeps its MODULE component,
                         reported as `owned by the composition root`. Optional, so that the many hand-built
                         facts objects in the self-cognition tests stay valid.
```

---

## 4. The measurement the step exists to produce

`node scripts/phase2-edge-inventory.cjs`, before and after, on the same tree:

```text
                                       BEFORE            AFTER
owned files                            597               597      <- unchanged: nothing was dropped
manifests declare                      25 module paths   25
composition root                       (no such class)   2 file(s), 95 outgoing edge(s), 0 incoming
cross-capability file edges            794 / 187 pairs   797 / 192 pairs   <- WENT UP, not down
kernel -> feature (P2-B target: 0)     154 / 43 pairs    82 / 25 pairs
mutual capability pairs (P2-C: 0)      53                38
pairs already declared                 1 of 187          1 of 192
```

**The edge total going UP by three is the proof that nothing was hidden.** Two effects are in it: edges that
were previously `runtime -> runtime` (a file `main.ts` imports that `runtime` also owns) are now
`composition_root -> runtime` and so become cross-owner; and neither the file count nor the edge total shrank.
Had the class been implemented by deleting the patterns, `filesOwned` would have fallen to 595 and every one of
the composition root's 95 outgoing edges would have left the inventory — the kernel → feature number would have
fallen for exactly the wrong reason.

The largest kernel → feature pairs after the change:

```text
13  providers -> status          <- the `src/shared/contracts.ts` misattribution (step 3)
11  persistence -> tenx          <- `electron/commander/**` (step 1 / P2-E road extraction)
 9  persistence -> tasks
 7  runtime -> tenx              <- was 22 before this step
 6  persistence -> workspace
```

`runtime` has left the list except for `runtime -> tenx` at 7, from 22. **The brief's estimate was that the two
attribution errors accounted for "30%" of the 154; the composition root alone accounted for 72 of them (47%).**
Both numbers are measurements of a model under repair and neither is a defect count.

---

## 5. The impact selector's blast radius, before and after

The one genuinely dangerous consequence, measured with the selector's own CLI on both sides:

```powershell
node scripts/test-impact.cjs select --base HEAD --changed electron/main.ts
```

```text
                                  BEFORE                                  AFTER
seeds                             ["runtime"]                             ["composition_root"]
affected                          ["runtime"]                             ["composition_root"]
selected                          36 suites {acceptance 5, unit 31}       29 suites {acceptance 3, unit 26}
because "runtime"                 7                                       (n/a -- always-run only)
because "always-run"              29                                      29
fullRunRequired                   false                                   TRUE
fullRunReasons                    []                                      ["composition_root has no bounded
                                                                           blast radius, so no subset of the
                                                                           suite can be justified for a
                                                                           change to it"]
unattributedFiles                 []                                      []      <- attributed, NOT a hole
blind                             false                                   false
catalogue                         289                                     289
```

**Option C was chosen, and option B was refuted by measurement rather than by preference.** The brief's three
options were: A select nothing (a silent 7-suite narrowing), B keep selecting the seven suites if they really
cover composition-root behaviour, C force a full run. B was tested and is false — **none of the seven suites
references `electron/main.ts` or `electron/preload.ts` at all**; they are selected because they cover the
`runtime` capability, and they assert the invariants of `electron/bootstrap/runtime.ts`, `runtime-paths.ts` and
`src/shared/provider-models.ts`. They never covered the composition root; their selection was an artefact of the
misattribution. So A would have removed a false positive rather than real coverage — but A is still wrong,
because the composition root's blast radius genuinely is the application and nothing in the catalogue would
have said so.

Two facts make C the cheap and honest answer here:

```text
CI does not use the selector. `.github/workflows/ci.yml` runs `pnpm test` (the whole default tier),
`pnpm run test:postbuild` and `pnpm run test:slow` -- full runs. The selector is a local fast-feedback device,
and `fullRunRequired` is a first-class, recorded outcome rather than a failure.

The alternative reached the same place by accident. With the class unread, `electron/main.ts` becomes
UNATTRIBUTED, and an unattributed change also forces a full run -- but it reports the repository as owning a
file it owns, and makes a mapped file indistinguishable from a hole in the map. The whole point of
`unboundedCapabilities` is that "we know exactly who owns this and its radius is everything" is a different
fact from "we cannot tell who owns this".
```

---

## 6. Verification

```text
node scripts/capability-closure-validator.cjs           VERDICT=PASS; owns 595 + composition root 2 = 597;
                                                        unowned 0; two-model agreement AGREE
node scripts/extend-capability-modules.cjs              idempotent; 27 capabilities, 270 owned paths,
                                                        2 composition-root file(s), 1 exempt
node scripts/generate-test-catalogue.cjs --check        "test catalogue is current: 289 suites"
node scripts/generate-test-catalogue.cjs                "27 of 27 capabilities covered"; config file UNCHANGED
node scripts/phase2-edge-inventory.cjs                  §4 above
node scripts/architecture.cjs ratchet                   no new violation; manifests untouched
node scripts/scan-tracked-secrets.cjs                   TRACKED_SECRET_SCAN=PASS files=1342
npx tsc --noEmit -p tsconfig{.json,.electron.json,.tests.json}   all three clean
vitest tests/unit/platform/test-impact.test.ts          30 passed
vitest tests/unit/city/capability-closure-validator.ts  22 passed
vitest tests/unit/city/phase2-edge-inventory.test.ts     6 passed
```

### 6a. The new guards were FALSIFIED, not merely observed to pass

Every new rule was disabled in turn and the tests re-run, because a passing test proves nothing about a guard
that is never exercised. All three mutations were caught, and the wording of the failures is the evidence:

```text
MUTATION 1  the `unboundedCapabilities` rule in src/shared/test-impact.ts disabled
            -> "a change to the wiring selected a subset of the suite: expected false to be true"
            -> "an unbounded seed selected a subset: expected false to be true"
            THE SILENT NARROWING CC-020 WARNED NO TEST CAUGHT IS NOW CAUGHT, and the failure names it.

MUTATION 2  the composition root removed from the edge inventory's owner map
            -> "the composition root owns no file, so its edges have no owner to be attributed to"

MUTATION 3  the composition-root class ignored by the closure validator's coverage check
            -> "a file with NO owner is still a failure" and the two pre-existing unowned cases
```

**One case passed for the wrong reason and was repaired.** The first version of the constructed selector case
gave its catalogue a single suite, so an unbounded seed emptied the selection and the full run arrived through
`blind` instead — it would have passed with the new rule deleted. It now includes an always-run suite, asserts
`blind === false`, and asserts the negative direction as well: the same change with the class *not* declared
must NOT force a full run. Re-falsified after the repair, and it fails as intended.

---

## 7. What this step does NOT do

```text
the remaining 82 kernel -> feature edges   NOT defects yet. 30% of the pre-step 154 was two attribution
                                           errors, and step 2 has now removed the larger one. The next two are
                                           named in the re-attribution analysis: `src/shared/contracts.ts`
                                           (providers -> status, 13) and `electron/commander/**`
                                           (persistence -> tenx, 11), the latter being a road whose FILE
                                           migration belongs to P2-E.
the composition root's own edges           `composition_root -> runtime` and its 94 siblings are now counted as
                                           cross-capability edges. They are legitimate class-1 wiring, and the
                                           inventory reports them rather than excusing them. P2-B's target of zero
                                           kernel -> feature edges does not apply to them.
`src/shared/contracts.ts`                  step 3, untouched.
the manifests' `modules`                   step 4, untouched.
```
