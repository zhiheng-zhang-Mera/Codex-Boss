# PHASE 2 — ARCHITECTURE MIGRATION SPECIFICATION

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md` §14 (create the Phase 2 spec, then execute it)
**Principles this phase implements:** `docs/capability-city-principles.md` §15.1 – §15.9
**Predecessors:** `docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md`,
`docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md`, `docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md`
**Acceptance document:** `docs/city/PHASE2_ARCHITECTURE_MIGRATION_ACCEPTANCE.md`

---

## 0. Why this document exists, and what it is not

Phase 1A made the architecture **measured**. Phase 1B made the measurement **hosted and enforcing** (the
`architecture` job runs the governing enforcer in shadow and in enforce mode, and its parity is proven by finding
identity). Neither phase removed a single unit of architectural debt. Phase 1B's own acceptance says so.

Phase 2 is the **debt-reduction / migration / structural-repair** phase. This document is its work order: the
frozen starting measurement, the work packages, the acceptance of each, and the rule for changing the enforcement
baseline while the work is in progress.

It is **not** an authorisation to lower a threshold, to widen a baseline, to exclude a source file from
measurement, or to declare the city clean because the code "looks cleaner". Every claim in it is tied to a
measurement in §1 or to a machine check named in §4.

---

## 1. FROZEN STARTING MEASUREMENT

**Baseline commit:** `5ade1cdfdb2d71fd58f0ca57905e0090e4690a24`
**Measured at:** 2026-09-24T06:52:58Z (recorded by the observatory's own `git` block; tree clean at measurement)
**Measured on branch:** `docs/city-continuous-construction-audit` (tree identical to `origin/main` at
`1892e61c89596b7cd66257ae5b4cedb4bae8dfc0` for every measured surface: the only commits between them are
documentation, and documentation is not Root Trust Surface)

This measurement is frozen. Later phases compare against it; they do not restate it.

### 1.1 What the repository's own tooling reports

| Sensor | Command | Result |
|---|---|---|
| Observatory (truth sensor) | `node scripts/architecture-observatory.cjs` | 612 tracked source files scanned · 1671 internal edges · 25 declared-owned files · **587 undeclared** · 1 unresolved internal reference · `graph.capability_edges = 0` · self-tests PASS · semantic hash `e3447e59…` |
| Legacy ratchet (control sensor) | `node scripts/architecture.cjs graph` | 27 capabilities · **3** declared edges · 0 cycles · kernel = `[persistence, providers, runtime, state-core]` · 23 features |
| Ownership | `node scripts/architecture.cjs ownership` | 32 namespaces · **0 conflicts** |
| Ratchet | `node scripts/architecture.cjs ratchet` | `pass: true`, equal to `config/architecture-baseline.json` v2 |
| Enforcement (shadow) | `node scripts/architecture-enforcement.cjs --mode shadow` | verdict **PASS** · findings 1677 · violations 0 · engine_errors 0 · by_code `{PASS_AS_GRANDFATHERED: 1671, NOT_YET_ENFORCED: 5, NON_SOURCE_ASSET: 1}` |

**The measurement's most important admission is in the tool's own output.** The enforcement artifact's
`policy.not_yet_enforced` names five classes the repository's gate refuses to claim as measured:

```text
bundle_structure_or_district_shape
cross_domain_private_state_access
dependency_cycles
layer_or_depth_violations
runtime_dependency_not_visible_in_source
```

Two of those five — `dependency_cycles` and `cross_domain_private_state_access` — are exactly the properties
P2-C and P2-D must drive to zero. The gate saying "not yet enforced" is the honest starting position, and it is
why §4 of this document requires a **new** machine validator for each, rather than a reinterpretation of an
existing green.

### 1.2 The frozen numbers (each with its provenance)

```text
ID    METRIC                                              VALUE      PROVENANCE
----  --------------------------------------------------  ---------  ------------------------------------------
M-01  tracked source files (electron/ + src/)             612        observatory scan.tracked_source_files_scanned
M-02  internal dependency edges (lexer)                   1671       observatory observer_internal_edges
M-03  declared-owned files                                25         observatory ownership.declared_owned_files
M-04  undeclared files                                    587        observatory ownership.undeclared_files
M-05  capabilities                                        27         architecture.cjs graph
M-06  DECLARED capability-level edges                     3          architecture.cjs graph
M-07  REAL capability-level edges (capability-modules)    189        Phase 2 measurement, capability-modules mapping
M-08  declared edges / real edges                         3 / 189    M-06 vs M-07  (1.6% declared)
M-09  capability-level SCCs > 1 (capability-modules map)  1          Phase 2 measurement
M-10  capabilities in the largest SCC                     27 of 27   Phase 2 measurement
M-11  mutual capability pairs                             54         Phase 2 measurement
M-12  kernel -> feature FILE edges                        158        Phase 2 measurement
M-13  kernel -> feature distinct PAIRS                    82         Phase 2 measurement
M-14  composition-root share of M-13                      52 of 82   Phase 2 measurement (main.ts/preload.ts/platform)
M-15  durable-store literals                              29         Phase 2 measurement
M-16  stores with a cross-domain READER                   11         Phase 2 measurement
M-17  hand-verified cross-domain private-state accesses   13         Phase 2 measurement (list in §1.3)
M-18  CONFIRMED multi-writer durable stores               0          Phase 2 measurement (hand-verified)
M-19  durable stores written with NO declared namespace   4          Phase 2 measurement
M-20  manifest disagreement rows                          14         Phase 2 measurement (list in §1.4)
M-21  manifests declaring modules:[] AND state:[]         9          Phase 2 measurement
M-22  Core surface (narrowest: the 4 kernels' modules)    6 files / 49,336 B
M-23  Core surface (union bootstrap+platform+state-core
      +capability)                                        64 files / 584,567 B
M-24  unresolved internal references                      1          observatory (renderer main.tsx -> styles.css)
M-25  ownership namespace conflicts                       0          architecture.cjs ownership
```

**Two ownership models disagree, and this is itself a finding.** `config/capabilities/*.yaml` declares 25 owned
files via its `modules` field; `config/capability-modules.json` declares 597 of 612 files via 272 patterns. 572
files are owned by one model and undeclared by the other. M-06/M-08/M-09/M-10 are computed under the
`capability-modules.json` mapping and are meaningless under the manifest mapping (which yields 0 edges and 0
cycles — a green that measures almost nothing). **P2-A's first deliverable is to make this a single truthful
model**, and until it does, no cycle count may be cited without naming which mapping produced it.

### 1.3 The live foundation → building inversions (M-12 … M-14)

The observatory's own known-positive control confirms **the historical inversion is still live**:

```text
electron/bootstrap/persistence.ts  ->  electron/runtime-intelligence/live-capture.ts
```

That is a foundation module importing a building's implementation, and it is the exact example the workbook §16
names as historical — measured now, not assumed.

Under the `capability-modules.json` mapping there are **158 file edges / 82 distinct pairs** from a kernel
capability into a feature capability. **52 of the 82** are composition-root wiring (`electron/main.ts`,
`electron/preload.ts`, `electron/platform/**`), which is a different defect class from a kernel module importing
a building: the composition root is where the wiring is supposed to live, so those 52 are candidates for
**declared** edges rather than for inversion repair. The remaining **30 pairs** are the substantive P2-B work.

### 1.4 The manifest disagreements (M-20, M-21)

Fourteen rows, of which the substantive ones are:

```text
manifest                 declared                 measured                              class
-----------------------  -----------------------  ------------------------------------  ---------------------
tenx                     modules: [] state: []    owns 108 real files                   FALSE_METADATA
promotion                modules: [] state: []    owns 33 real files                    FALSE_METADATA
security                 modules: [] state: []    owns 29 real files                    FALSE_METADATA
learning                 modules: [] state: []    owns 23 real files AND durable        FALSE_METADATA
                                                  stores (episodes.jsonl, revisions.jsonl)
experience/identity/     modules: [] state: []    writeJson-backed durable stores        FALSE_METADATA +
node/project                                      whose namespaces persistence.yaml      STATE_OWNERSHIP_
                                                  claims to own                          MISMATCH
research                 requires knowledge.       NO real research -> knowledge edge    FALSE_DEPENDENCY
                         store@1                  exists
(9 manifests)            modules: [] state: []    1-108 real files each                 FALSE_METADATA
```

Clean negatives, worth recording because they bound the work:

```text
0  declared module paths that do not exist
0  unresolved `requires` endpoints
0  ownership namespace conflicts
0  double-owned files
0  confirmed multi-writer durable stores
```

### 1.5 Four durable stores with no declared namespace (M-19)

`electron/main.ts` writes four durable files directly into `.boss` with no declared namespace:

```text
restart-result.json
restart-seeded.json
theme-visual-check.json
workbook-registry.json
```

A durable store with no declared owner is precisely what P2-D exists to eliminate: there is no owner API to
consume, so every reader must know the path.

---

## 2. The migration rule

### 2.1 The unit of migration is minimum stable semantic closure (principle 15.3)

**Not** a file count, **not** a directory, **not** a line budget.

```text
A BUNDLE CONTAINING INDEPENDENT PURPOSES MUST BE SPLIT.
A LARGE COHERENT COMPOUND BUILDING IS ALLOWED.
```

A unit is at its minimum stable closure when it has one declared external purpose, it owns the durable state it
writes, every module in it has an owner or an explicit infrastructure classification, and every cross-capability
relation it has resolves to a known endpoint.

### 2.2 How the enforcement baseline may evolve while migratom is in progress (workbook §24)

The accepted baseline may evolve **only** through `architecture:enforce:baseline:accept` under the already-governed
acceptance mechanism, and every change must distinguish:

```text
RETIRED DEBT              an edge that was in the baseline and no longer exists
NEW LEGITIMATE RELATION   a declared relation that the policy authorises
NEW GRANDFATHERED DEBT    exceptional; requires an Owner architecture decision
```

For `NEW GRANDFATHERED DEBT` the change must:

1. be Owner-authorised;
2. enumerate the exact finding identity;
3. explain why;
4. carry a `CITY-DEBT-###` id and an exit condition;
5. be recorded in the baseline series **and** in
   `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md`.

**Count compensation is not acceptable.** Removing one old edge does not license adding another undeclared one.
Reintroducing retired debt must remain a failure. If a migration cannot be finished without new grandfathered
debt, the honest move is to leave the old state in place and record the blocker, not to widen the baseline.

### 2.3 Every temporary bridge needs an exit condition (principle 15.5, workbook §17)

```text
bridge id · owner · reason · source · target · exit condition · deadline/phase · tests
```

A bridge without an exit condition is not allowed. A bridge whose deadline passes without closure is a finding.

### 2.4 What must never be done to make a number smaller

```text
NO   excluding a source file from the scanner
NO   lowering a threshold
NO   widening the baseline to swallow an unexplained finding
NO   renaming MIGRATION_IN_PROGRESS to FLAT without a measurement
NO   turning enforce into shadow
NO   removing a failing test without replacing its guarantee
```

---

## 3. Work packages

Each package states: what it fixes, its measured starting state, its acceptance, and the machine check it adds.
The check is part of the deliverable — a package that fixes numbers without adding a guard has not finished.

| ID | Package | Fixes | Starting state | Acceptance | New machine check |
|---|---|---|---|---|---|
| **P2-A** | Truthful capability map and minimum stable closure | M-03, M-04, M-20, M-21, plus the two-ownership-model disagreement | 25/612 files owned; 14 disagreement rows; 2 disagreeing models | one truthful ownership model; every manifest validates; 0 stale paths; 0 unowned city sources; 0 state-ownership mismatches | `capability-closure-validator` |
| **P2-B** | Foundation must not depend on a building | M-12, M-13, M-14 | 158 file edges / 82 pairs, incl. the live `bootstrap/persistence -> runtime-intelligence/live-capture` inversion | kernel → feature implementation edges = 0 (the 52 composition-root pairs resolved as **declared** wiring, not deleted) | `foundation-inversion-validator` |
| **P2-C** | Cycles and uncontrolled lateral bearing dependencies | M-06 … M-11 | 1 SCC containing all 27 capabilities; 54 mutual pairs; 187 of 189 real edges undeclared | capability cycles = 0; uncontrolled lateral load-bearing edges = 0; every remaining cross-capability edge declared and policy-valid | `cycle-scc-validator` + declared-edge policy |
| **P2-D** | Private-state access and multiple writers | M-15 … M-19 | 11 stores with a cross-domain reader; 13 hand-verified accesses; 4 namespace-less stores | cross-domain private-path access = 0; uncontrolled multi-writer stores = 0; every durable store has exactly one authoritative owner | `private-state-access-validator`, `durable-writer-validator` |
| **P2-E** | Shared capability sink / roads | M-22, M-23 | shared concerns trapped inside buildings; no road classification | every extracted road is justified (shared infrastructure, not business capability, named consumers, owned invariant, minimal contract); road ownership explicit; no building load-bearing merely because it owns a road | `road-classification` check |
| **P2-F** | Flatness states and migration lifecycle | — | no per-plot state exists | exactly one machine-readable state per plot (`FLAT`, `TEMPORARILY_BRIDGED`, `PARTIALLY_DEGRADED`, `MIGRATION_IN_PROGRESS`, `UNSAFE_GAP`); bridge requires owner + exit; degraded requires the missing element; unsafe gap blocks that plot's promotion | `flatness-registry-validator`, `bridge-expiry-validator` |
| **P2-G** | Capability replacement lifecycle | — | no shadow/dual-validate/switch/drain machinery exists | the lifecycle is observable and rollback is executable; **one real bounded migration** demonstrates it on real input, not synthetically | `replacement-lifecycle` tests |
| **P2-H** | Core growth ban | M-22, M-23 | no Core budget exists | Core size ≤ Phase 2 starting Core size; any increase needs a separate Owner-approved architecture record answering the four questions | `core-budget-validator` |
| **P2-I** | Principles 15.1–15.9 machine-enforced | — | `docs/capability-city-principles.md` records 8 of 9 as **not enforced** | an enforcement matrix naming, per principle, the machine check **or** the machine-enforced evidence requirement plus structured architecture decision | the matrix itself + the checks above |

### 3.1 P2-A — the ownership model must be single and truthful

The measured starting state contains **two** ownership models that disagree by 572 files. No migration may
proceed on top of that, because every downstream number depends on which model is used.

A first increment has landed and is recorded here so the remaining work is not confused with it.

```text
LANDED (increment 1 — "the closure validator")
  scripts/capability-closure-validator.cjs
      the part of the check below that is decidable against the declarations that exist TODAY:
        1  declared module path exists on disk and is a FILE (not a directory)
        2  bootModules/surface are subsets of modules
        3  every scanned source file (electron/, src/) is owned by exactly one capability, named in the
           composition-root table, or exempt WITH a substantive reason
        4  no file is claimed by two capabilities
        5  the three owner tables are pairwise disjoint: capability, composition root and exemption are three
           different answers to "whose change is this?", so a file in two of them is a contradiction
        6  every capability declares at least one provided id (one external purpose)
        7  the two models AGREE: no map capability without a manifest, no manifest absent from the map, no
           declared module the declaring capability does not own
  npm run capability:closure
      the same check, named
  tests/unit/city/capability-closure-validator.test.ts
      22 cases: PASS on the committed tree, and FAIL on a fixture that breaks exactly one rule, per check

  LANDED BY INCREMENT 2 (step 2): THE COMPOSITION ROOT IS A THIRD OWNER CLASS
    electron/main.ts and electron/preload.ts were owned by `runtime` -- a KERNEL -- so every edge whose source
    is one of them was counted as a kernel-into-feature INVERSION. They are now owned by `composition_root`,
    a named non-capability class beside `capabilities` and `exempt`, each entry carrying the reason it is not a
    capability. Measured consequence, same tree both sides: kernel -> feature 154 edges / 43 pairs -> 82 / 25,
    mutual pairs 53 -> 38, with owned files UNCHANGED at 597 and the cross-capability edge total UP from 794 to
    797 -- the edges were RE-ATTRIBUTED, not deleted. Full record:
    `docs/city/PHASE2_P2A_COMPOSITION_ROOT_CLASS.md`. The impact selector's blast radius for
    `electron/main.ts` was measured before and after: 36 suites selected for `runtime` (7 of them because of the
    misattribution, and none of the seven referencing the composition root) becomes `fullRunRequired` with a
    named reason and `unattributedFiles` EMPTY.

  FIXED BY IT
    src/shared/compatibility.ts was BOTH owned by `persistence` and listed in the exemption table -- a file
    with a claim on it and an exemption saying nobody owned it, so the repository gave two answers about
    whether a change to that file selects a suite. The exemption is removed; the file keeps exactly one
    owner; the validator fails if any file becomes owned-and-exempt again. The contradiction lived in the
    tables of `scripts/extend-capability-modules.cjs`, the map's only writer, which is why the fix is there
    and not in the JSON.

NOT YET LANDED (increments 2+), and deliberately not claimed
  2  expand each manifest's `modules` to its capability's full implementation surface (341 electron/** + 217
     src/shared/** files that only the map owns today), and re-house electron/platform/** (12) and
     electron/bootstrap/** (2) as platform instrumentation rather than `runtime` implementation
     -- THE SIZE OF THIS INCREMENT IS NOW MEASURED, in `docs/city/PHASE2_P2A_EDGE_INVENTORY.md`
        (`scripts/phase2-edge-inventory.cjs`): 794 cross-capability file edges over 187 capability pairs,
        154 of them kernel -> feature over 43 pairs, 53 mutual pairs, and 186 of the 187 pairs undeclared.
        Expanding `modules` is what makes the required ratchet read those edges, so increment 2 cannot land
        without the per-pair decisions (declare / invert / extract a road), or the ratchet goes red
     -- AND 30% OF THAT COUNT IS TWO ATTRIBUTION ERRORS, established by READING the three files the inventory
        named, in `docs/city/PHASE2_P2A_REATTRIBUTION_ANALYSIS.md`:
          `runtime -> tenx` (22) and `persistence -> tenx` (11) are ONE directory, `electron/commander/**`
            (39 files), attributed to `tenx` although its contents are a task ledger, a budget manager, a
            context manager and a recovery scheduler
          `providers -> status` (13) is ONE FILE, `src/shared/contracts.ts`, attributed to `status` although it
            is a 48-importer shared type module bundling at least seven independent purposes
        Reading them first turns 43 capability-pair decisions into THREE deliberate decisions (one directory,
        one file, one composition root) followed by a re-measurement. That order is the increment's plan.
        THE COMPOSITION ROOT IS NOW DONE (increment 2, step 2 -- see LANDED above). The other two remain:
        `electron/commander/**` (step 1, decided: it is a road, and handing it to `tasks` is REJECTED; the FILE
        migration belongs to P2-E) and `src/shared/contracts.ts` (step 3, untouched).
  3  resolve the 14 manifest metadata rows: 9 manifests declaring modules:[]/state:[] over 1-108 real files,
     and `research` declaring a `knowledge.store@1` requirement with no real edge -- CONFIRMED against the
     real graph by the inventory, which finds zero research -> knowledge import edges
  4  choose ONE canonical model and generate the other from it, then re-point its readers
  5  regenerate the enforcement baseline and obtain the Owner-authorised series entry (see below -- this is
     an Owner act and it moves the Root Trust Surface)
  6  run the validator as a CI step of the `quality` job (today it is enforced through its test)
  7  (LANDED, increment 2) the P2-B/P2-C regression floor over the REAL graph, which the legacy ratchet cannot
     see because it reads the manifests: `node scripts/p2b-kernel-feature-ratchet.cjs`, against
     `config/p2b-kernel-feature-ratchet.json`. It records 82 kernel -> feature file edges over 25 pairs and 38
     mutual pairs, measured under the OWNERSHIP MAP, and refuses a rise -- including a fall achieved by
     scanning fewer files, by a kernel losing its kind, or by hiding the composition root, which is what
     workbook section 17 means by "do not reduce the numbers by hiding files from the scanner". The JUDGE is
     deliberately a separate program from the INSTRUMENT: the inventory's own header refuses to decide whether
     an edge is a defect, so the threshold lives beside it and not inside it. Ledger CC-026.
     STILL OPEN: the migration itself. The target recorded in the artifact is 0 for both counts.
  8  (LANDED, increment 2) the cycle/SCC measurement and its floor, which item 7 did NOT provide: item 7 counts
     mutual PAIRS, and the SCC decomposition says whether the graph is a KNOT. `node scripts/phase2-cycles.cjs`
     reports 28 capability nodes, 193 directed edges, 9 SCCs of which ONE holds 20 of 28 capabilities, with
     conversation / dispatch / host-status / remote / settings / state-core / task-creation and the composition
     root already outside it. Against history (43 pairs, one SCC of 25 of 27) the knot has shrunk, and the reason
     it matters is that PAIRWISE REPAIRS DO NOT SPLIT A LARGE COMPONENT: it dissolves only when every internal
     mutual dependency does, so P2-C is one connected problem with 20 members rather than 38 small ones. The
     numbers are ratcheted by the SAME judge as item 7 -- one judge, one artifact -- with `capability_nodes` and
     `capability_edges` as FLOORS so the component cannot be shrunk by losing an edge from the graph, and with
     `scc_count` deliberately NOT a ceiling because splitting raises it. The inventory's `--json` gained
     `allPairs` in the same commit: it had been publishing 60 of 193 pairs, and an SCC computed on that reports
     fewer cycles than exist. Ledger CC-030.
     ALSO RECORDED THERE: a REFUTED shortcut. Re-attributing `electron/commander/**` to a road class looked like
     a free 18-edge win by the composition root's precedent, and it was measured instead of taken --
     commander has 132 incoming edges and 122 outgoing across 13 capabilities, 39 of them onto three kernels, so
     re-labelling it would move those edges out of the measurement without repairing anything.
     STILL OPEN: P2-C's migration (cycles to 0).
  9  (LANDED, increment 2) the P2-D measurement and its validator, which section 30 names as the
     "private-state-access validator" and which did not exist. `node scripts/phase2-private-state.cjs` reports
     FIVE cross-domain private-state accesses over THREE (namespace, capability) pairs, ALL into one namespace:
     `tasks`, declared by `persistence`, resolved by hard-coded path from `host-status`, `runtime` and `tenx`.
     `host-status` reaching the task ledger is the WORKBOOK'S OWN HISTORICAL EXAMPLE from section 18
     ("host-status parsing persistence state.json"), so the instrument finds the defect it was written for.
     THE DEFINITION is a PATH rather than a name -- a `path.join` whose last segment is a declared namespace --
     because matching a name as a string reported a SKIP set and a field name as "accesses". A join is CONFIRMED
     only with a durable-root marker; the rest is a separate tier with a recorded reason each, and BOTH tiers are
     ceilings so an access cannot hide by being unclassifiable. One level of indirection is resolved on each side
     (a local name bound to the durable root, a module constant bound to a namespace), because without the root
     indirection the historical example classified as unclassified -- found by falsifying, not by reading.
     NOT CLAIMED: read-versus-write. The open mode is not in the source, so the artifact records an explicit
     NOT CLAIMED note and machine-enforces the DECLARED property (one owner per namespace) instead.
     Ledger CC-031. STILL OPEN: P2-D's migration (accesses to 0), and the multi-writer property, which needs a
     read/write signal the source does not carry.
 10  (LANDED, increment 2) the canonical city state registry and the flatness validator, which section 30 names
     and section 20 requires. `config/city-flatness.json` gives every plot ONE state from the five, with 3
     migration stages (P2-B, P2-C, P2-D) each carrying an exit condition and the instrument that tracks it, and
     the one live bridge with all eight obligations. `node scripts/city-flatness-validator.cjs` reports 27 plots:
     5 FLAT and 22 MIGRATION_IN_PROGRESS -- every plot a measured defect implicates -- and `--seal` reports
     SEAL_BLOCKED and exits 1, because section 20 permits only FLAT at the seal. THAT GATE IS THE DELIVERABLE:
     the seal is machine-checkable rather than declarable, and it cannot be made to pass by editing the file,
     because the validator cross-checks the registry against the three instruments and fails when a plot
     implicated by a measured defect is recorded FLAT. The plot set is DERIVED from the manifests, the registry is
     deliberately NOT generated (a generated one would make the cross-check compare the instrument with its own
     output), and FLAT is explicitly not a certification. Ledger CC-032.
     RECORDED WEAKNESS, CLOSED: a cross-check between two artifacts cannot validate either of them -- because the
     registry was authored from the instruments, weakening an instrument weakened both sides and the check still
     passed. A mutation proved it (the implicated set fell from 22 to 21 and the real-tree cross-check did NOT
     fail), and the gap is closed by a case that pins the expected members BY NAME, `host-status` being the one
     implicated by that instrument alone.
     STILL OPEN: the 22 declared migrations themselves, and PARTIALLY_DEGRADED / UNSAFE_GAP, which have no entries
     because no instrument measures them yet.
```

**The measured disagreement, unchanged by increment 1:**

```text
manifests (config/capabilities/*.yaml)    declare 25 module paths
ownership map (capability-modules.json)   owns 597 of 613 scanned files, exempts 1
agreement on what BOTH declare            0 map-without-manifest, 0 manifest-without-map, 0 declared-but-unowned
coverage                                  0 unowned, 0 double-claimed, 0 owned-and-exempt
```

The remaining divergence is therefore **of payload, not of contradiction**: the map owns 572 files no manifest
mentions. The validator reports agreement over the overlap it can decide and does not pretend that 25 declared
against 597 owned is agreement; check 7 is what will flip when increment 2 lands. **Do not cite a cycle count, an
owned-file count or a blast radius without naming which model produced it** until then.

**Where each of the five originally-required checks now lives:**

| Required check | Where it is enforced |
|---|---|
| declared module exists | validator check 1 (and as a FILE, not a directory) |
| declared state ownership matches reality | `scripts/architecture.cjs` loader, already enforced |
| every source module has an owner or explicit infrastructure classification | validator check 3, where the exemption must carry a substantive reason |
| every cross-capability relation resolves to known endpoints | `scripts/architecture.cjs` (`requires` resolution), and P2-C |
| capability boundary has one declared external purpose | validator check 6 |

The validator must not be satisfiable by emptying the manifests: a manifest with `modules: []` over real files
is a failure, not an exemption, and the unowned-file check fires whatever any manifest declares.

#### The Owner act increment 5 requires, stated before it is attempted

`config/architecture-enforcement-baseline.json` records a capability or `UNDECLARED` for each scanned file, and its
identity is `baseline_hash = sha256(canonicalJson(content))`. Re-owning the 572 files changes that content and
therefore that hash. The only ACCEPTED series entry names `b211c052…`
(`trust-policy/architecture-enforcement-baselines.json`), so the new baseline is **unauthorised** and
`architecture-enforcement.cjs` returns `BASELINE_SERIES_UNAUTHORISED` in **both** shadow and enforce mode — the
hosted `architecture` job fails closed rather than skipping.

Recovery is a two-part act, and the second part is an Owner act:

```text
a  regenerate a CANDIDATE baseline (--reason is mandatory and placeholder reasons are refused)
b  add the new (version, parent_baseline_hash = b211c052…, baseline_hash) triple to the series BEFORE --accept,
   because authorization must precede acceptance -- and trust-policy/** is Root Trust Surface and
   CODEOWNERS-bound, so (b) is an Owner act, and it will move the Root Trust Surface aggregate and require the
   next epoch. That is the same cadence this session already performed twice, for epochs 29 and 30.
```

The re-accept is a **hash-identity change, not a debt change**: the edge set is unaffected by ownership, and the
comparison is over edge/file **keys** rather than ownership values, so the acceptance accounting will show
re-owned files and zero added debt. Increment 5 must not be attempted as a side effect of an ordinary PR.

### 3.2 P2-B — the two classes of kernel → feature edge must not be conflated

```text
class 1  COMPOSITION-ROOT WIRING   52 of 82 pairs. main.ts / preload.ts / platform/**
         The root is where wiring belongs. Repair = DECLARE the edge, not delete it.
class 2  KERNEL MODULE IMPORTING A BUILDING IMPLEMENTATION   30 pairs, including the confirmed
         bootstrap/persistence -> runtime-intelligence/live-capture inversion.
         Repair = abstraction to land/foundation/road if genuinely shared, else invert control so the
         building depends on the platform contract.
```

`foundation -> building implementation edges = 0` is the acceptance. Declaring class 1 must not be used to hide
class 2: the validator counts an edge as an inversion when a **foundation module** imports a **capability
implementation module**, and the composition root is classified explicitly rather than by directory.

### 3.3 P2-C — do not reduce the cycle count by hiding files

M-09/M-10 say one SCC contains all 27 capabilities under the `capability-modules.json` mapping. Migrating
incrementally is required; tactics are `extract road/interface`, `invert dependency`, `event bus`, `explicit
contract`, `split bundle`, `move shared service to shared infrastructure`, and `temporary bridge with declared
expiry`. The validator must read the SAME model the manifests declare, and if the two models still disagree the
validator must fail rather than pick the flattering one.

### 3.4 P2-D — one durable state object, one authoritative owner

```text
one durable state object has one authoritative owner
cross-capability private path access = forbidden
consumers use a contract, event, query API, or declared read model
```

M-18 (0 confirmed multi-writer stores) means this package's live work is the **13 cross-domain readers** and the
**4 namespace-less stores**, not a multi-writer clean-up. That is a smaller and more honest scope than the
historical description implies.

### 3.5 P2-F — the five states, and what final seal may contain

```text
FLAT · TEMPORARILY_BRIDGED · PARTIALLY_DEGRADED · MIGRATION_IN_PROGRESS · UNSAFE_GAP
```

The programme may continue while one plot is under declared migration. **Final seal may contain none of:**
`UNSAFE_GAP`, `MIGRATION_IN_PROGRESS`, undeclared `PARTIALLY_DEGRADED`, expired `TEMPORARILY_BRIDGED`.

### 3.6 P2-G — real proof, not synthetic

The replacement lifecycle (`old active -> new shadow -> dual validation -> traffic switch -> old fallback ->
drain -> retire`) must be built once, reusably, and demonstrated on **one real bounded capability migration**
using real traffic or real host replay. A synthetic-only proof is insufficient.

### 3.7 P2-H — the Core budget

Two defensible starting numbers exist and the spec does not pretend otherwise:

```text
NARROWEST  M-22   6 files / 49,336 B     the four kernel capabilities' declared modules
UNION      M-23  64 files / 584,567 B    bootstrap + platform + state-core + capability
```

P2-A must first make the model single and truthful; the budget is then frozen against the model P2-A produces,
and `final Core size <= Phase 2 starting Core size`. The budget must be a machine-enforced number, not a
document. An increase is permitted only with a separate Owner-approved architecture record answering:

```text
1. why an existing road/foundation element cannot carry it;
2. why it is not a building;
3. what invariant only Core can hold;
4. what breaks if it remains outside Core.
```

---

## 4. The enforcement matrix (P2-I)

Before final seal, `docs/city/PHASE2_ARCHITECTURE_MIGRATION_ACCEPTANCE.md` must record, for each principle, one
of:

```text
MACHINE ENFORCED      a check exists, runs in CI, and fails on violation
MACHINE SEMANTICS PINNED   the machine records the semantic distinction even where it cannot decide it
MACHINE CHECKED + EXPLICIT REVIEW RECORD   for a judgment that cannot be automated without pretending
```

Target:

```text
15.1 foundation must not depend on a building      MACHINE ENFORCED
15.2 size is not itself a defect signal            MACHINE SEMANTICS PINNED
15.3 minimum stable closure                        MACHINE CHECKED where decidable + explicit review record
15.4 replacement lifecycle                         MACHINE-STATEFUL + real proof
15.5 least-sufficient repair / shared sink         MACHINE CHECK on prohibited added lateral load
15.6 flatness states                               MACHINE ENFORCED
15.7 no cycles / lateral bearing / private state   MACHINE ENFORCED
15.8 shared capability sink                        MACHINE CHECK / explicit road classification
15.9 Core growth ban                               MACHINE ENFORCED
```

For a principle that cannot be fully automated without pretending to solve a semantic judgment problem, the
deliverable is a **machine-enforced evidence requirement plus an explicit structured architecture decision**.
Faking semantic certainty is not permitted, and neither is leaving the principle documentary while claiming the
phase complete.

---

## 5. Lane strategy (workbook §25)

```text
lane/phase2-measurement     frozen baseline + the validators' measurement layer
lane/phase2-closure         P2-A
lane/phase2-topology        P2-B, P2-C
lane/phase2-state           P2-D
lane/phase2-replacement     P2-E, P2-G
lane/evidence               P2-F, P2-H, P2-I records
```

Rules:

```text
two lanes must not mutate the same protected authority file concurrently
before merging a lane: sync from current main with a history-preserving merge, re-run the lane's proof,
record conflicts
published evidence branches are never rebased
a blocked governance lane must not stop measurement or an independent structural lane
```

---

## 6. Order of work, and why

```text
1  P2-A   nothing downstream is measurable while two ownership models disagree
2  P2-B   the foundation inversion is the one principle with a confirmed live violation
3  P2-D   the smallest honest scope (13 readers + 4 namespace-less stores), so it closes early
4  P2-C   the largest structural work; needs A's single model and B's foundation contract
5  P2-F   the state registry must exist before migrations can be declared in progress
6  P2-E   road extraction needs to know which buildings are load-bearing (C) and who reads whom (D)
7  P2-H   the Core budget is frozen after A, and defended through C/E
8  P2-G   the replacement lifecycle needs a bounded capability to migrate, which E/C identify
9  P2-I   the matrix is written last because it names the checks the other packages built
```

P2-F is deliberately early: migrations performed without a declared state are indistinguishable from unfinished
work, which is what the five-state registry exists to prevent.
