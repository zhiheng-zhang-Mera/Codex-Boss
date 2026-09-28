# The dependency-cut plan: what remains, costed file edge by file edge

> Measured at checkpoint `65df177` with the repository's own instruments, not estimated. The generator is
> `docs/research/post-cc103/tools/cut-list.cjs` and its output is preserved as
> `docs/research/post-cc103/evidence/cut-list-r5.txt`, so every number below can be re-derived.
>
> **This plan exists because the three strict targets are one body of work and have been described in prose five
> times without a file-level cost.** Ledger CC-077 priced the CYCLES with an Eades-Lin-Smyth ordering (138 edges over
> 32 pairs, an upper bound). This prices the 2-CYCLES exactly, per pair and per file, and states the three places
> where the cheap route is blocked.

## 1. The current state

```text
kernel -> feature file edges          46   (target 0)   -- was 49 at work start; A2-1, A2-4, A2-5 retired three
mutual capability pairs               31   (target 0)   -- UNCHANGED by every repair so far
largest SCC                           18 of 29 nodes   (target <= 1)   -- UNCHANGED
MIGRATION_IN_PROGRESS plots           21   (target 0)
total cross-capability file edges    771
capability graph                     29 nodes / 197 capability edges
```

## 2. The 2-cycles, costed by the cheaper direction

Breaking a 2-cycle requires removing the edges of **one** direction, so each pair is costed by its cheaper
direction. `cost` is file edges to remove; `files` are the source files carrying them.

| cost | pair | cut direction | files |
|---:|---|---|---:|
| **1** | `automation \| providers` | `providers -> automation` | 1 |
| **1** | `automation \| tenx` | `tenx -> automation` | 1 |
| **1** | `knowledge \| theme` | `theme -> knowledge` | 1 |
| **1** | `persistence \| tasks` | `tasks -> persistence` | 1 |
| **1** | `promotion \| status` | `promotion -> status` | 1 |
| **1** | `research \| status` | `status -> research` | 1 |
| **1** | `research \| tenx` | `research -> tenx` | 1 |
| **1** | `tasks \| theme` | `tasks -> theme` | 1 |
| **1** | `tasks \| workspace` | `tasks -> workspace` | 1 |
| **1** | `tenx \| theme` | `theme -> tenx` | 1 |
| 2 | `engineering \| knowledge` | `engineering -> knowledge` | 2 |
| 2 | `engineering \| providers` | `engineering -> providers` | 2 |
| 2 | `persistence \| status` | `persistence -> status` | 2 |
| 2 | `providers \| runtime` | `runtime -> providers` | 2 |
| 2 | `providers \| status` | `status -> providers` | 2 |
| 2 | `runtime \| status` | `runtime -> status` | 1 |
| 2 | `runtime \| tenx` | `tenx -> runtime` | 2 |
| 2 | `status \| tenx` | `status -> tenx` | 2 |
| 2 | `tasks \| tenx` | `tasks -> tenx` | 2 |
| 3 | `engineering \| status` | `status -> engineering` | 3 |
| 3 | `engineering \| tasks` | `tasks -> engineering` | 2 |
| 3 | `persistence \| workspace` | `persistence -> workspace` | 2 |
| 3 | `providers \| tasks` | `providers -> tasks` | 3 |
| 4 | `knowledge \| tenx` | `knowledge -> tenx` | 3 |
| 4 | `persistence \| providers` | `persistence -> providers` | 4 |
| 5 | `engineering \| security` | `security -> engineering` | 4 |
| 5 | `persistence \| status` | `persistence -> status` *(the LARGER direction; the 2-edge cut above is the cheap one)* | 2 |
| 6 | `persistence \| tenx` | `persistence -> tenx` | 5 |
| 6 | `promotion \| security` | `security -> promotion` | 4 |
| 6 | `status \| tasks` | `tasks -> status` | 6 |
| 7 | `engineering \| tenx` | `engineering -> tenx` | 5 |
| 9 | `engineering \| promotion` | `promotion -> engineering` | 3 |

```text
TOTAL file edges to break EVERY 2-cycle: 87
```

The full per-file listing is in `evidence/cut-list-r5.txt`.

## 3. Three findings that change the order of work

**(a) Four of the one-edge cuts are the SAME file, and it is NOT free.** `src/shared/workbook-dispatch.ts`, owned by
`tasks`, is the `tasks -> ...` source for `tasks|theme` and `tasks|workspace`, and it appears again in
`engineering|tasks` and `status|tasks`. **One file's ownership or content is worth four pairs.** Checked for
feasibility with `docs/research/post-cc103/tools/a2-2-feasibility.cjs`:

```text
src/shared/workbook-dispatch.ts   owner=tasks
  imports:  src/shared/task-contract.ts (tasks), src/shared/workbook.ts (tasks)
  imported by 7 capabilities: dispatch, task-creation, tenx (x2), knowledge (x2), tasks
```

So re-homing it to a kernel does **not** work: it imports two `tasks` files, so a kernel owner would make
`<kernel> -> tasks` a new S2 edge — the same number of kernel → feature edges, moved from the `tasks` row to the
kernel's. The four pairs it feeds cannot be cut by ownership; they need the file's OWN dependencies on `workbook.ts`
and `task-contract.ts` broken first. That is a finding about the shape of the work, not a cost saving, and it is
recorded so the first attempt is not spent on it.

**(a2) The same check explains why the cheap cuts are rare.** Most `src/shared/*.ts` files owned by one capability
import one or two other `src/shared/*.ts` files owned by the same capability, so moving them re-points edges rather
than removing them — the pattern CC-078 already recorded ("a moved utility re-points edges rather than deleting
them"). The one-edge cuts in §2 that ARE real are the ones whose file is a genuine leaf, and each of those still has
to be checked before it is attempted.

**(b) One cut is deliberately refused.** `persistence|tasks` costs ONE edge: `src/shared/workbook.ts` imports
`sha256Hex` from `src/shared/hash.ts`, which `persistence` owns. `hash.ts` is a dependency-free SHA-256 that exists
because **the renderer bundle cannot import `node:crypto`**, and it is verified against Node's crypto in
`tests/unit/workbook-hash.test.ts`. The only cheap way to cut that edge is a second copy of the algorithm inside
`workbook.ts`. That trades a test-pinned correctness invariant for one metric point, so it is **refused** and this
pair waits for a real repair. Recorded here so the next round does not rediscover it and take the cheap route.

**(c) The `persistence|tenx` cut is 6 well-identified files, not a mystery.** `electron/bootstrap/persistence.ts`
constructs `TaskLedger`, `DecisionLedgerStore` and `RuntimeIntelligenceCapture`; `electron/store.ts` imports
`TaskLedger` and `state-budget.ts`. Those are the ledger cluster A2-2 could not reach by ownership (the precedence
rule) and A2-3 could not move (it made the cycles worse). They need the implementations relocated into the kernel or
the need removed.

**(d) STEP 3's target is ONE hub, not a misplaced file.** Measured after STEP 1 was exhausted (CC-117):

```text
electron/provider-automation.ts   554 lines, owner automation, the orchestration loop
  imports:  tenx (commander/continuation-router, commander/event-bus)
            providers (runtimes/runtime, adapters/registry, adapters/page-scripts, provider-api, provider-views,
                       input/attachment-store, input/attachment-upload, account-sessions)
            persistence (store)
            providers (src/shared/provider-contracts, src/shared/provider-policy)
  imported by: bootstrap/provider-pool.ts (CONSTRUCTS it), bootstrap/research.ts, commander/web-recovery.ts
               (TYPE only)
```

Moving this file anywhere re-points edges rather than removing them, and in several directions it would create a
kernel -> feature edge where a feature -> feature one stands today — the same number of S2 edges, moved. So the
`automation|providers` and `automation|tenx` pairs cannot be cut by relocating the file: **the automation loop
genuinely implements behaviour belonging to several capabilities**, and the only honest repairs are to split the
behaviour or to inject the construction. That is a different kind of work from everything STEP 1 attempted, and it is
the reason STEP 3 is where the remaining S2 and S3 cost actually lives.

## 4. Sequencing

```text
STEP 1  The seven remaining ONE-edge cuts, cheapest first, each attempted and MEASURED: automation|providers,
        automation|tenx, knowledge|theme, promotion|status, research|status, research|tenx, tenx|theme.
        A one-edge cut that fails is a one-edge finding, which is why they are worth trying before anything large.
        NOT persistence|tasks (§3b, refused) and NOT the workbook-dispatch group (§3a, blocked by its own imports).
STEP 2  The 2-edge cuts, which are the first ones where a file must move rather than a value be declared.
STEP 3  The ledger cluster (cost 6), which needs an architectural decision rather than a repair.
STEP 4  The leaf files behind the blocked groups: `workbook.ts`/`task-contract.ts` first (§3a), then whatever the
        measurements say after each landing.
```

**Every step carries the same obligations, established by CC-107, CC-111 and CC-112:**

```text
- the acceptance entry is written FROM the candidate baseline's retire/add report, never from the intent of the
  change (CC-112 caught a claim of two retired edges where the instrument measured one);
- p2b values are lowered in the same commit, and only the keys the instrument moved;
- every independent readback of a moved value is updated in that commit (the 15.1 literal, the generated principle
  table, the test catalogue);
- config/architecture-enforcement-baseline.json is a Root Trust Surface path, so the ceremony (candidate ->
  ACCEPTED series entry -> accept -> epoch advance) is due whenever the frozen identity changes, and the epoch
  number is quoted by every later measurement.
```

## 5. What this plan does NOT claim

```text
It does not claim 87 edges is enough for S3 and S4 TOGETHER. Breaking every 2-cycle is exactly S3; S4 is a
FEEDBACK ARC SET over what remains, and CC-077 measured that removing one edge of a 2-cycle leaves the members
mutually reachable through other paths -- the component reads 18 until the last cycle is gone. So S4 needs S3
PLUS a further cut whose size this plan does not state, and CC-077's 138-edge upper bound is the only figure that
covers both.

It does not claim the cuts are independent. Every cut changes the graph the next one is measured against, so the
list is a plan for the first pass and must be re-derived after each landing.
```
