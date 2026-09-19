# PF-DEBT-019 gate-tiering proposal

**Status: `READY_FOR_OWNER_DECISION` — nothing in this document has been executed.**
`STOP = GATE_DESIGN_OWNER_DECISION_REQUIRED`. No timeout, budget, workload, tier or PRAGMA was changed in
this round, and no case was moved. This is the Owner's next decision, not a change waiting to be applied.

## 1. Why a decision is needed

The authorized investigation ran. The cost was measured, the append path was made measurably cheaper without
touching a single guarantee, and the entry still cannot be closed honestly, because **the closure bar is a
hosted margin and the hosted margin is still ~9%**.

| Hosted observation (same candidate SHA `a890314…`, code identical, fix in place) | Event | 100k case | Share of the 600 s budget |
| --- | --- | --- | --- |
| run 35442171945 attempt 1 | push | **543 823 ms** | 90.6% |
| run 35442182999 attempt 1 | pull_request | **548 153 ms** | 91.4% |
| run 35442171945 attempt 2 | push (rerun) | **442 269 ms** | 73.7% |
| run 35442182999 attempt 2 | pull_request (rerun) | *no data* — `unit` aborted earlier in `test:postbuild` on the unrelated `PF-DEBT-017` flake | — |

Three executions, zero timeouts, and a 1.24× spread (442 → 548 s) **between runs of identical code**. The
slowest sits in the 450–590 s band that the closure criteria call "not stably closed", and a runner ~10%
slower than the slowest observation times out. Closing on this evidence would be exactly the "looks green"
outcome the round was told to avoid.

## 2. What the fix already bought (landed, measured)

Two semantics-preserving changes in `electron/state-core/event-journal.ts`: the append hot path prepares its
statements once per journal instead of once per event, and the common path is a single
`INSERT … ON CONFLICT(producer, idempotency_key) DO NOTHING RETURNING *` instead of SELECT/INSERT/SELECT.

| Metric | Before | After |
| --- | --- | --- |
| local case (vitest basis) | 87 522 ms | **63 915 ms median** (61 605 / 66 848 over 5 runs) |
| local append loop (harness) | 84 833 ms | ~57 000 ms |
| statement compilations in the loop | 300 000 | **0** |
| SELECTs in the loop | 200 000 | **0** |
| local `test:slow` tier | ~330 s | **258.62 s** |
| hosted, unfixed (green runs) | 426 719 / 517 641 ms | — |
| hosted, unfixed (timed out) | >600 000 ms (case 696 564 / 676 829 ms) | — |
| hosted, fixed | — | 442 269 / 543 823 / 548 153 ms |

The ~1.35× the fix buys locally is real and is why the fixed runs above did not time out: on the runner that
produced 548 s fixed, the unfixed code would have needed roughly 750 s. What the fix cannot buy is immunity
from a shared runner's I/O variance — the append loop is dominated by durable WAL/file I/O that grows with
the database (measured: 4.9 µs of JavaScript per append; 57 µs in-memory vs 219 µs on disk at 20k events), and
that is the machine's property, not the code's.

## 3. Option A — retain the hosted required gate, with a measured budget

Keep the 100k-event case exactly where it is, with the budget raised from data rather than from impatience.

| Field | Value |
| --- | --- |
| observed max (fixed, n=3) | **548 153 ms** |
| observed p50 (fixed, n=3) | 543 823 ms |
| observed min (fixed, n=3) | 442 269 ms |
| observed spread, identical code | **1.24×** |
| proposed budget | **1 100 000 ms** (~18 min) — max observed × 2.0 |
| resulting minimum headroom | 2.0× against the slowest observation, 2.5× against the median |
| cost | the `unit` job's slow tier grows to roughly 20–25 min on the hosted runner, on **every** push and PR |

**What it keeps:** every push and PR proves "100 000 durable appends complete on a clean hosted runner within
one budget", which is the strongest form of the claim and needs no tier move.

**What it risks:** the sample is three runs. Runner variance alone is 1.24× within the sample and the unfixed
distribution already contained runs slower than the previous 600 s ceiling, so a 2.0× factor is an engineering
judgement over a thin sample, not a bound. Raising the ceiling also makes a genuine hang take 18 minutes to
surface instead of 10.

**What it does not change:** the workload (still 100 000), the assertions, the tier, the durability settings.

## 4. Option B — move the true host-scale evidence to the qualification tier

Run the 100k-event scale case **unchanged** on the real soak host, under the private control plane's
qualification tier (dispatch-only, main-only, exact-SHA, no shared-runner clock), and keep in the hosted
required CI a case that still proves the *contract* at a volume a shared runner can decide deterministically.

| | Hosted required CI (`unit`) | Qualification (real host) |
| --- | --- | --- |
| what it proves | append durability across reopen, strictly monotonic sequence, `UNIQUE(producer, idempotency_key)` (a replay returns the ORIGINAL row), per-aggregate ordering, rollback atomicity, read paging, stats/head — at a bounded volume, labelled as a **correctness** case and **not** as the scale claim | the full **100 000 durable-event** case, unchanged, with no shared-runner budget deciding it |
| cadence | every push and PR | `workflow_dispatch` on the real host, alongside the Phase 01–05 gates that already live there |
| evidence cadence lost | "100k durable appends complete within a bounded time on a clean hosted runner" is no longer proven per push | — |
| evidence cadence gained | the required `unit` check stops being decided by shared-runner I/O weather | the scale claim runs where the book's Task F soak trend lives, with a real budget and a real corpus |

**What must NOT happen under Option B, and would make it a weakening rather than a tiering:** deleting the
100k case, reducing `EVENTS`, dropping any assertion, or claiming the hosted correctness case proves the scale
claim. The 100k case moves; it does not shrink, and its assertions do not change.

**The honest cost of Option B:** the scale property becomes qualification-cadence evidence instead of
per-push evidence, so a regression that only appears at 100k volume can now reach `main` between qualification
runs. That is a real loss and it is the reason this is an Owner decision rather than a tidy-up.

## 5. What this document is not

It is not a proposal to raise the timeout *instead of* fixing the code — the code was already fixed in this
round, before anyone reached for the budget. It is not a licence to weaken the case. And it is not a decision:
`PF-DEBT-019` stays `OPEN` until the Owner chooses, or until enough hosted observations accumulate that the
slowest one carries a real margin.
