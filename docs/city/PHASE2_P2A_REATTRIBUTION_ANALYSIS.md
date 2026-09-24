# PHASE 2 — P2-A INCREMENT 2: the first three re-attribution decisions, read rather than inferred

**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Analysed at:** `40dd3082c448c7f8faf04e08927bf202692b6993` (`origin/main`, epoch 31)
**Predecessor:** `docs/city/PHASE2_P2A_EDGE_INVENTORY.md` — whose section 3a instructed that no pair be treated as
a defect until its endpoints had been read, and named three places to read first.
**Status:** analysis, not migration. Nothing was moved, re-owned, declared or exempted to produce it.

---

## 1. The headline

Section 3a of the inventory said the 154 "kernel → feature" edges were an **upper bound produced by a model under
repair**, not a defect count. Reading the three named files confirms it, and quantifies it:

```text
rank  pair                  edges   what it actually is
----  --------------------  ------  ---------------------------------------------------------------
  1   runtime -> tenx            22  electron/commander/** (39 files) attributed to `tenx`
  2   providers -> status        13  src/shared/contracts.ts attributed to `status`
  3   persistence -> tenx        11  the same electron/commander/** attribution
                                  ---
                                   46 of the 154 counted edges
```

**46 of 154 — 30% of the headline count — reduce to the attribution of ONE DIRECTORY and ONE FILE.** Neither is a
foundation module reaching into a building's implementation. Both are ownership errors that make an ordinary shared
dependency *look* like an inversion. The programme was about to migrate 43 capability pairs; the first real step is
to fix two attributions and re-measure.

## 2. `src/shared/contracts.ts` — owned by `status` (13 of the 154 edges)

```text
size          28 996 bytes
importers     48 files under electron/ and src/, of which the app's composition root (electron/main.ts) and the
              preload bridge are two
listed as a pattern by exactly one capability: `status`  (config/capability-modules.json)
```

Its first twenty lines are **type declarations with no capability identity at all**: `ProviderId`, `TaskStatus`,
`TaskMode`, `AppMode`, `RunTransport`, `ApiProtocol`, `AdapterOutcome`, `ProviderRunPhase`, `CouncilStage`,
`ClaimStatus`, `EvidenceDecision`, `ProviderAccountMode`, `DispatchCheckpointStatus`, `RemoteChannel`,
`RemoteChannelStatus`, `RemoteCommandStatus`, then `interface Provider`.

So the file bundles **at least seven independent purposes** that belong to different capabilities:

```text
provider identity and run phases      provider / providers
task status, mode and dispatch        tasks
council session stages                tasks or a council capability
claim and evidence decisions          status / evidence-engine
conversation and folder shapes        conversation
remote channel shapes                 remote
the app snapshot                      the composition root's view
```

**That is the specification's own P2-A criterion firing**, not a judgement call: §2.1 of the Phase 2 spec says *"a
bundle containing independent purposes must be split"* and *"the unit of migration is minimum stable semantic
closure"*. `contracts.ts` is a bundle of independent purposes wearing one filename.

**The decision, and why it is not "give it a better owner":**

```text
REJECTED   hand it to `runtime` or `providers`. A different label on the same bundle leaves seven capabilities'
           types inside one file that any of them may extend; the next count would be just as misleading.
REJECTED   split it mechanically by type name. A split whose boundaries are the alphabet produces seven files
           nobody owns.
ACCEPTED   split by the seven concerns above, each landing with the capability that already owns the behaviour
           those types describe, and leave in place only shapes that genuinely span capabilities -- the app
           snapshot and the preload bridge contract -- classified explicitly as a composition-root contract
           rather than as a capability's implementation.
```

**Why it is not this increment's work:** 48 importers. Every move is a cross-file edit whose blast radius is the
whole application surface, and the test-impact selector's map (`config/capability-modules.json`) has to move in the
same step or the selector's blast radii become wrong for files it no longer owns. That is a migration with its own
PR, its own before/after measurement, and its own rollback.

## 3. `electron/main.ts` — owned by `runtime`, a kernel (part of every `runtime -> *` pair)

```text
size          89 002 bytes
role          the composition root: it constructs the app, wires the store, registers every IPC surface and
              launches the window
owner         `runtime`, kind `kernel`
```

An 89 KB composition root being a **kernel capability's implementation** is the second implausible attribution. The
spec's §3.2 already classifies composition-root wiring as a *different class* from an inversion:

```text
class 1  COMPOSITION-ROOT WIRING   the root is where wiring belongs. Repair = DECLARE the edge, not delete it.
class 2  KERNEL MODULE IMPORTING A BUILDING IMPLEMENTATION   Repair = abstract, invert, or extract a road.
```

**The decision:** classify `electron/main.ts` (and `electron/preload.ts`) as the composition root, explicitly and by
name, rather than as `runtime`'s implementation. Then every `runtime -> *` edge whose SOURCE is one of those two
files becomes class 1 and is **declared** instead of repaired. The 52-of-82 composition-root share the inventory
already measured is this, and it is now confirmed by reading the file rather than by its path.

## 4. `electron/commander/**` — owned by `tenx` (33 of the 154 edges, via two pairs)

```text
size      39 files
owner     `tenx`, kind `feature`
contents  task-ledger, budget-manager, context-manager, recovery-scheduler, web-recovery, execution-gate, …
```

A task ledger, a budget manager, a context manager and a recovery scheduler are not "tenx" business. Read against
the capability list, they are **task execution infrastructure** — closer to `tasks` (a feature) or to shared task
machinery than to `tenx`. The consequence is that two of the three largest "kernel → feature inversions"
(`runtime -> tenx` and `persistence -> tenx`) are the same single attribution question, not 33 separate dependency
problems.

**The decision:** determine `electron/commander/**`'s real owner by reading what it does and who consumes it, then
re-attribute the directory in one step. This is deliberately NOT decided here, because the answer changes which
capability owns a 39-file tree and therefore which suites the impact selector selects for it — a decision that must
be made with the consumers in hand, not from a directory name.

## 5. What this changes about increment 2

```text
BEFORE THIS ANALYSIS                      AFTER
--------------------------------------    ----------------------------------------------------------------
154 kernel -> feature edges to repair     46 of them are two attribution questions first
43 capability pairs needing a decision    3 things to read and decide: one file, one directory, one root
"the manifests declare 25 paths"          unchanged -- and the 572 undeclared files still need declaring
```

The re-measurement that follows should be done with the attribution fixed, because a count taken before it will
mislead in exactly the way this document exists to correct.

## 6. The next increment's concrete work list

```text
1  DECIDE `electron/commander/**`'s owner, with its consumers in hand, and re-attribute it. Re-measure the pairs.
2  CLASSIFY `electron/main.ts` and `electron/preload.ts` as the composition root by name, so that class-1 wiring
   is declared rather than counted as an inversion. Re-measure.
3  Then split `src/shared/contracts.ts` by its seven concerns, landing each with the capability that owns the
   behaviour the types describe. This is the largest of the three (48 importers) and it goes last, after the
   measurement it feeds is trustworthy.
4  Only then expand each manifest's `modules` to the real surface -- with the per-pair decisions already made for
   the pairs that survive steps 1-3.
```

## 7. What this document does not claim

```text
NOT CLAIMED  that steps 1-3 remove all 154 edges. They remove the MISCLASSIFIED ones; edges that survive are real
             and each still needs declare / invert / extract-a-road.
NOT CLAIMED  that `tenx` is the wrong owner for electron/commander/**. It is IMPLAUSIBLE on the file names, and
             this document says implausible rather than wrong, because the decision needs the consumers read.
NOT CLAIMED  that contracts.ts is worthless as it stands. It is a working file with 48 importers; the claim is
             about its ownership and its closure, not its correctness.
```

## 8. How to reproduce

```powershell
cd D:\Codex-Boss
git rev-parse HEAD                                      # 40dd3082c448c7f8faf04e08927bf202692b6993
node scripts/phase2-edge-inventory.cjs --json           # the 154 / 43 / 53 figures
node -e "const m=require('./config/capability-modules.json');console.log(m.capabilities.status.filter(p=>p.includes('contracts')))"
Select-String -Path src\shared\contracts.ts -Pattern "^export (type|interface)" | Measure-Object
Select-String -Path electron\*\*.ts,electron\*.ts -Pattern 'shared/contracts' | Measure-Object   # 48 importers
Get-Item electron\main.ts | Select-Object Length        # 89 002 bytes
(Get-ChildItem electron\commander -File).Count          # 39
```
