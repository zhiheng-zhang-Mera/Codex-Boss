# Phase 2 — P2-E: Road Candidates, Re-measured

**Workbook authority:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`, section 19 (*shared capability
sink / roads*), and section 15.8 (*shared capability sink*).
**Instrument:** `scripts/phase2-pair-edges.cjs` (`--road-candidates`, `--kernel-targets`, `--verify`).
**Verified by:** `tests/unit/city/phase2-pair-edges.test.ts`.
**Ledger:** `CC-037`.
**Status: the measurement is DONE; the classification is NOT.**

## 1. What section 19 asks for

> Identify shared concerns currently trapped inside buildings. A capability needed by several independent buildings
> is a **road candidate**. Do not blindly move code into Core.

For every extraction it requires five proofs: *why it is shared infrastructure; why it is not business capability;
which consumers use it; what invariant it owns; what its minimal contract is.* It names historical candidates —
learning episode/metric surfaces, and theme/knowledge namespace ownership — and then says: **"Re-measure before
acting."** That instruction is the reason this document exists rather than a plan.

Acceptance: *no building is load-bearing solely because it accidentally owns a shared road; road ownership is
explicit; new road does not expand Core without separate justification.*

## 2. The missing instrument, and the defect it found in its first run

The inventory publishes pair **counts** and at most three sample edges per pair — deliberately, because not deciding
is what keeps the classification out of the instrument. A pair cannot be decided from a count, so
`scripts/phase2-pair-edges.cjs` decomposes them: given a pair, it prints every edge with its file, line, raw
specifier, and the shape of its targets.

Because the counts are what CI **enforces**, an inspector that counted differently from the ratchet would be worse
than useless, so `--verify` re-derives the whole graph and asserts equality with the inventory on every total and
all 193 pair counts. **It failed on its first run**, and the failure was real:

```text
edges.totalCrossCapabilityFileEdges: inventory 801, inspector 867
edges.kernelToFeatureFileEdges:      inventory  73, inspector  84
```

The inventory's unit of measurement is a **(source file, distinct specifier)** pair, not an import statement: it
deduplicates specifiers per file, so a file importing the same module twice — once as a type, once as a value, which
this repository does — is **one** edge. Section 16's target of zero is in the inventory's currency, so a work list in
any other currency would have over-scoped the migration by 15%. Corrected, the inspector now agrees exactly: **801
edges over 193 pairs.** A test pins the invariant (`distinct (fromFile, specifier) === edges.length`), and three
cases falsify the gate itself.

## 3. The leaf test, and why re-attribution is not enough

Ledger `CC-030` refuted labelling `electron/commander/**` a road: a road that imports a kernel is not a road, it is a
feature with a lot of callers, and the label would have **hidden** 39 edges onto kernels rather than classifying
them. That refutation is about the *directory*. The measurement below applies the same test to *individual files*:

> **LEAF** — imported across a capability boundary by two or more capabilities, and imports **no** other capability.

A leaf's owner is the only thing that can be said about it, so every importer's edge onto it is an **attribution**
question. A non-leaf reaches other capabilities, so `CC-030`'s refutation applies and the repair is **extraction**.

## 4. The measurement

```text
kernel -> feature edges                              73   over 25 pairs
  onto LEAF targets (import no other capability)     34   over 25 files
  onto NON-LEAF targets                              39   over 26 files
road candidates (targets with >= 2 importing capabilities)   116
  of which LEAVES                                            57
```

So **34 of the 73 §16 edges (47%) target a shared leaf**, and 39 target something that reaches other capabilities.
The two halves need different repairs, and a plan written from the total of 73 would have treated them alike.

### The largest shared sinks

| file | owner | importers | leaf | reaches |
| --- | --- | --- | --- | --- |
| `electron/bootstrap/boot-module.ts` | `runtime` (kernel) | 18 | **LEAF** | — |
| `electron/commander/durable-json.ts` | `tenx` | 17 | **LEAF** | — |
| `src/shared/contracts.ts` | `status` | 13 | not leaf | engineering, persistence, providers, research, runtime, tasks, tenx, theme, workspace |
| `electron/workspace/path-utils.ts` | `workspace` | 9 | **LEAF** | — |
| `src/shared/input-object.ts` | `tasks` | 9 | **LEAF** | — |
| `src/shared/secret-scan.ts` | `security` | 7 | **LEAF** | — |

`boot-module.ts` is the most-imported file in the repository and is owned by a **kernel**, so edges onto it are not
`kernel → feature` at all — it is already foundation, and it is the shape a road should have. `contracts.ts` is the
counter-example: the second most-imported file, owned by a feature, reaching **nine** capabilities. It cannot be
relabelled, and the provider closure (`CC-029`) already demonstrated its repair by splitting one module off it.

### The workbook's named historical candidates, re-measured

| candidate | file | owner | importers | leaf | reaches |
| --- | --- | --- | --- | --- | --- |
| learning service | `electron/learning/learning-service.ts` | `learning` | 3 | not leaf | knowledge, tasks |
| learning episode store | `electron/learning/episode-store.ts` | `learning` | 2 | not leaf | knowledge, providers |
| learning episode surface | `src/shared/learning-episode.ts` | **`knowledge`** | 2 (learning, tenx) | not leaf | providers, tasks |
| knowledge object | `src/shared/knowledge-object.ts` | `knowledge` | 2 | not leaf | security, tasks, tenx |
| knowledge surface | `src/shared/knowledge.ts` | `knowledge` | 2 | **LEAF** | — |
| theme surface | `src/shared/theme.ts` | `theme` | 2 | not leaf | tasks |
| theme UI surface | `src/shared/ui-surface.ts` | `theme` | 3 | **LEAF** | — |
| theme visual check | `src/shared/theme-visual-check.ts` | `theme` | 2 | **LEAF** | — |

This is what **"re-measure before acting"** was for. The historical hint treats learning/theme/knowledge namespace
ownership as one road problem; the measurement splits it three ways:

- **`src/shared/learning-episode.ts` is owned by `knowledge`, not by `learning`.** The file that a reader would call
  the learning episode surface belongs to a different capability, and it reaches `providers` and `tasks`. That is a
  misattribution *and* an extraction, and neither is visible from the name.
- The three `learning`-owned candidates are all **non-leaves**, so none can be re-attributed.
- Only the smaller surfaces (`knowledge.ts`, `ui-surface.ts`, `theme-visual-check.ts`) are leaves.

## 5. Section 19's five proofs: which are machine-measured, which are judgements

| proof | state at `CC-037` | state at `CC-038` |
| --- | --- | --- |
| which consumers use it | **MACHINE-MEASURED**, for every candidate, cross-checked against the inventory (`--road-candidates`, `--kernel-targets`) | **MACHINE-ENFORCED** for every declared road |
| why it is shared infrastructure | **NOT DECIDED** — a judgement | stated per road, and required to be substantive by the validator |
| why it is not business capability | **NOT DECIDED** — a judgement | stated per road, and this is the proof `CC-038` found to be decisive |
| what invariant it owns | **NOT DECIDED** — a judgement | stated per road |
| what its minimal contract is | **NOT DECIDED** — a judgement | stated per road |

Four of the five are architecture decisions, and this document deliberately does not invent them. What it does is
remove the part that was guesswork: **who consumes what** is now a reproducible number rather than a reading.
Section 8 below records what happened when the four judgements were finally made.

## 6. Why the classification is not done in this stage, and what the next bounded step is

Every repair identified above needs a **class**, not a label. The ownership map has three classes —
`capabilities`, `composition_root`, `exempt` — and the closure validator refuses a file in two at once. Calling a
leaf a "road" therefore means adding a fourth class, and with it:

1. `scripts/extend-capability-modules.cjs` — the map's only writer gains a ROADS table;
2. `scripts/capability-closure-validator.cjs` — a road must not be owned by a capability, must not be exempt, must
   state a reason, and **must be a leaf**, which is `CC-030`'s refutation turned into a machine rule rather than a
   convention;
3. `scripts/phase2-edge-inventory.cjs` and this inspector — road edges counted on their own line, as
   `<composition-root>` already is, so the re-attribution is a visible number rather than a silently smaller total;
4. `scripts/p2b-kernel-feature-ratchet.cjs` — the new counts recorded, with a floor on road-file count so a road
   cannot be un-declared to move the numbers;
5. the cycle and private-state instruments — roads are nodes in the capability graph and must not become a way to
   hide a cycle.

That is a coherent change but it is a **schema** change across five instruments, and doing it in the same stage as
the discovery would mean shipping a new class and its first four decisions at once with no round in between to
check the class itself. It is therefore named as the next bounded step instead.

**One acceptance criterion is already satisfied, by a different stage.** *"New road does not expand Core without
separate justification"* is enforced today: `config/core-budget.json` (`CC-035`) pins the starting Core surface by
name and refuses any growth not covered by an Owner-approved exception. A road cannot enter Core silently, whether
or not a road class exists.

## 7. Rollback

Delete `scripts/phase2-pair-edges.cjs`, its test and this document, and revert the catalogue entry. Nothing else
reads them.

## 8. Update (`CC-038`) — the class was built, and the plan above was wrong in one important way

The next bounded step was taken, but **not as scoped in section 6**. That plan would have added a fourth *ownership*
class to the map's writer, which the writer cannot do for a file inside a directory pattern (it subtracts only exact
entries). The class that was built instead is a **downstream classification** in `config/capability-roads.json`,
applied by the instruments:

> a ROAD is shared surface **trapped inside a building** — the building still *contains* the file, and that containment
> is the recorded debt, with an exit condition naming the extraction that removes the declaration.

That is closer to section 19's own words (*"shared concerns currently trapped inside buildings"*), and it is what makes
the arithmetic honest: a road stays **physically** inside its building, so the building's own imports of it remain
internal. The first implementation did not do that and **inflated the total from 801 to 828** — every internal import
of the two roads became a phantom cross-capability edge. With the rule in place the total is **unchanged at 801**,
`files_owned` is unchanged at 598, and the moved edges are published as `edges_to_roads`.

### The two-part test, and the finding that matters

| half | rule |
| --- | --- |
| **necessary** | the file is a **LEAF** — imported across a boundary by ≥2 capabilities and importing **no** other capability |
| **sufficient** | the file carries **no policy of its own** — types, enumerations, tables and mechanical primitives are roads; **a function that decides an outcome is not** |

**Leafness is necessary and NOT sufficient**, and that is the finding, not a caveat. Two of the strongest candidates
pass the leaf test and are **refused**:

- `src/shared/execution.ts` — a leaf imported by four capabilities — exports `reviewResponse` and
  `defaultReviewPolicy`, which *decide* `PASS`/`RETRY`/`HUMAN_REQUIRED`/`FAILED`. That is a policy.
- `src/shared/permission.ts` — a leaf imported by `providers` and `tenx` — exports `manifestAllows`,
  `manifestNarrow` and `desktopMutationGate`, which is `security`'s decision procedure.

Both are recorded as **measured refutations**, and the validator refuses a refutation for a file that is not a leaf
with at least two consumers — a refutation record is only worth anything if it records something. Their repair is the
`CC-029` provider-closure shape: the *types* are a contract, the *decision* belongs to the owner, and the two have to
be split.

### What was declared

| road | owner | consumers | kernel edges | why it is policy-free |
| --- | --- | --- | --- | --- |
| `electron/commander/durable-json.ts` | `tenx` | 17 | 4 | `writeJson`/`readJson`/`validId` over `node:fs`/`node:path`/`node:crypto`; invariant: a durable JSON file is never observed half written |
| `src/shared/input-object.ts` | `tasks` | 9 | 3 | enumerations, interfaces and one deterministic extension table; its own header says *"Pure contract — no fs/network here"* |

### Before / after

```text
kernel -> feature file edges   73 -> 66
kernel -> feature pairs        25 -> 24
mutual capability pairs        38 -> 34
edges to roads                 -- -> 64   (published, not deleted)
edges LEAVING roads            -- ->  0   (must be 0; a road with an out-edge is not a road)
total cross-capability edges  801 -> 801  (unchanged -- the invariant that makes the fall trustworthy)
files owned                   598 -> 598  (unchanged)
```

The four mutual pairs dissolved because in four cases a capability's **only** dependency on another was the shared
file primitive: the two were never in a cycle of implementation. Both instruments report 34, so they still agree.

### The counter-pressure against `CC-030`'s failure mode

`CC-030` refuted labelling `electron/commander/**` a road because the *directory* reaches kernels. This stage
classifies two **individual files**, and gives the machine three refusals that a relabelling cannot survive:

1. a road that imports any capability fails (`CC-030` as an executable rule);
2. a road owned by a **kernel** fails — it is already foundation, so declaring it a road would move nothing;
3. the ratchet **floors** `road_files` and `edges_to_roads`, and fails if **any** edge leaves a road — so a
   declaration cannot be withdrawn to push its edges back into a building's column, and the moved edges cannot
   silently vanish.

### Still open

53 leafless shared candidates remain measured and undeclared (section 4), each needing its five proofs; the two
declared roads still need their **extraction** out of `electron/commander/**` and `src/shared/`, which is what their
exit conditions name; and the 39 non-leaf edges of section 4 are extraction work that no declaration can address.
`config/capability-roads.json` is the class; `scripts/capability-roads-validator.cjs` is the gate.

## 9. Update (`CC-040`) — the second batch, and the line the first batch only gestured at

`CC-038` stated the second half of the test as *"a function that decides an outcome is not a road"*. That is too
coarse to apply, because a shape validator, a key derivation, a URL parser and a fingerprint **all** return a
verdict. Applied literally it would have declared all thirteen remaining leaf candidates, or refused all thirteen.

The usable form is what the verdict is **about**:

> A verdict about **mechanical well-formedness** is a road — is this id shaped like an id, what is the canonical key
> for this scope, is this string a repository URL, what is the stable fingerprint of this record. A verdict about a
> **domain outcome** is not — may this execution run, did this work pass, which roles execute, how is this
> conversation handled, should the epoch roll.

### Four declared

| road | owner | consumers | why it is shape, not outcome |
| --- | --- | --- | --- |
| `src/shared/workspace.ts` | `workspace` | 9 | schema version, two id constants, two interfaces, two shape validators |
| `src/shared/behaviour-epoch.ts` | `promotion` | 2 | the trigger and metric vocabularies plus `epochScopeKey`/`epochIdFor`; no function decides **when** an epoch opens |
| `src/shared/model-identity.ts` | `tasks` | 2 | source ordering and confidence tables, predicates over a **label**, a fingerprint — its point is that a capability *cannot* fabricate a version |
| `src/shared/github-url.ts` | `security` | 2 | recognize, split owner/repo/ref/subpath, derive a cache key; it makes **no access decision** |

### Nine refused — every one passes the leaf test

| candidate | why it is the owner's policy |
| --- | --- |
| `electron/workspace/path-utils.ts` | owns path **semantics and validation codes**; the types already live apart in `src/shared/workspace-path`, the rules must follow them out (`CC-029` shape) |
| `src/shared/work-mode.ts` | the role-assignment **engine**: `rolesForAgentCount`, `assignRoles`, `effectiveRoles` — it decides which review roles run |
| `src/shared/owner-result.ts` | the Owner-Result **decision layer**: run modes, HB1–HB4 vocabulary, question classification, auto-decision, escalation ladder |
| `src/shared/result-validator.ts` | the verification **policy**: `MODEL_DONE` is not `COMPLETED`; gates by risk level |
| `src/shared/conversation-policy.ts` | `conversationPolicyFor` decides how a conversation is handled |
| `electron/commander/execution-gate.ts` | the `ExecutionGate` class **authorizes** execution; its own header calls it the question asked before a run |
| `src/shared/optional-review.ts` | `runOptionalReview` is async and performs provider work — an implementation, not a primitive |
| `electron/runtime-intelligence/live-capture.ts` | a 561-line shadow capture **adapter** attached to the ledger's write path and the event bus |
| `electron/workspace/durable-roots.ts` | 21 lines, so it *looks* like a primitive, but `durableRootFor` encodes a **layout policy** (default/scratch keep the legacy root) |

`durable-roots.ts` is the case worth keeping: **small is not the same as policy-free**, which is the companion
section 15.2 needs to its own ban on treating size as a signal.

### Before / after

```text
kernel -> feature file edges   66 -> 62
kernel -> feature pairs        24 -> 23
mutual capability pairs        34 -> 34   (unchanged)
edges to roads                 64 -> 75   (published, not deleted)
edges LEAVING roads             0 ->  0
total cross-capability edges  801 -> 801  (unchanged -- still the anchor)
files owned                   598 -> 598
capability PAIRS              206 -> 204  (two pairs COLLAPSED into one, see below)
```

### The floor that was wrong, and the anchor that replaced it

The pair count **fell**, so the ratchet failed on its `capability_edges` floor the moment this batch was applied. Two
pairs collapsed into one where a capability's only edge to another capability was onto a road and it already had a
pair to the road class. That is legitimate, and the repair was **not** to quietly lower a number: the ratchet gains a
floor on the **raw total** (`total_cross_capability_file_edges`, 801), which is the stronger anchor, because a
declaration *moves* an edge between columns and must leave the total untouched — a fall there means edges were
actually lost. The pair floor is lowered alongside it, with the reasoning recorded, so the two floors now say
different things instead of duplicating each other.

That is the second time in this stage that the right answer was a better **anchor** rather than a better number.

### Nine refutations for four declarations

That ratio is healthy and the wrong thing to optimise. **The batch where every candidate passes is the batch to
distrust.** 40 leafless candidates remain undeclared, and the six declared roads still need their extraction.
