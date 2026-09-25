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

| proof | state |
| --- | --- |
| which consumers use it | **MACHINE-MEASURED**, for every candidate, and cross-checked against the inventory (`--road-candidates`, `--kernel-targets`) |
| why it is shared infrastructure | **NOT DECIDED** — a judgement, listed below as the work |
| why it is not business capability | **NOT DECIDED** — a judgement |
| what invariant it owns | **NOT DECIDED** — a judgement |
| what its minimal contract is | **NOT DECIDED** — a judgement |

Four of the five are architecture decisions, and this document deliberately does not invent them. What it does is
remove the part that was guesswork: **who consumes what** is now a reproducible number rather than a reading.

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
