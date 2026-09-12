# Checkpoint 17 — Soak Test (§53) and the §51 Benchmark Plan

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §53 (Soak Test), with §51's benchmark
catalogue turned into a run order.

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §53 (round) | Consecutive rounds of fresh clone → bootstrap → task → repair → PR → CI → completion, 20–50 suggested, some rounds covering theme create/activate/delete/restart. |
| §53 (metrics) | Owner decisions = 0, blind waits = 0, false COMPLETED = 0, state loss = 0, unrecovered crash = 0, theme-induced startup failure = 0. |
| §51 | The eighteen benchmark scenarios, runnable in one order. |

## What was built

### 1. `src/shared/soak.ts` — the rules (pure)

* `SOAK_STAGES` is §53's round in the plan's order and `SOAK_METRICS` its six
  counters.
* **`evaluateSoak`** refuses to be fooled: a round counts as clean only when **every**
  stage reports ok *with at least one evidence pointer*, the soak completes only with
  enough clean rounds (including the required theme rounds), **every metric must stay
  at zero**, no stage may go unexercised, and a failure whose signature repeats stops
  the soak early — repeating a known-broken path twenty times is not a soak.
* `failureSignatureOf` gives a round's failure a stable identity so a repeat is
  recognisable across rounds.
* **`benchmarkPlan()`** turns §51's eighteen-scenario catalogue into an ordered,
  theme-marked plan (B16–B18 are the theme rounds).

### 2. `electron/engineering/soak-runner.ts` — the host runner

Each round really does the plan's first stage: it **clones from a bare remote** into a
fresh directory, brings the clone up through the real §31 ladder, performs a task
through the real bounded change unit, exercises the repair path (the claim is
verified against git and then rolled back — an added file by removal, an edit by
restore), names the §39 policy branch, reads its own §31.3 ledger as the CI result,
and lets the completion stage fail if any earlier stage did. Every round is recorded
durably with its stages, evidence and failure signature, plus the §51 plan.

Two robustness gaps the acceptance exposed and fixed: the runner never created its
own scratch directory (so a mis-pointed workspace produced an *empty* failure reason),
and a spawn error was dropped from the reason.

## Evidence

`pnpm run acceptance:soak` (CI step + local chain step) — **SK-01..SK-06 PASS,
26 observations**, offline (clones come from a directory on disk, not a network):

* SK-01 §53's seven stages and six metrics;
* SK-02 three real rounds clone, bootstrap, change, roll back, branch, read CI and
  complete — every stage evidenced, the theme round marked, the soak complete with
  no metric moved, and the record durable and versioned;
* SK-03 a soak against a missing remote fails every round, claims no evidence for the
  failed stage and names the reason;
* SK-04 an identical failure twice stops the soak early, while a different failure
  does not;
* SK-05 one Owner decision in one otherwise-clean round fails the whole soak;
* SK-06 §51's plan walks all eighteen scenarios in order with B16–B18 marked as theme
  rounds.

## Honest boundaries

1. **A round is a representative task cycle on a fresh clone, not the whole product.**
   The runner clones, bootstraps, changes, repairs, branches, reads CI and completes
   using the real machinery from earlier checkpoints; it does not re-run the full
   27-step acceptance chain per round (the gate would take hours). The soak gate
   therefore defaults to 3 rounds and caps at 8, while §53's 20–50 remain the
   nightly/soak-environment target.
2. **PR and CI stages are local stand-ins.** The policy branch is computed by the real
   §39.1 rule and the CI result is the round's own ledger, because a soak round must
   not depend on a network; the real push/PR/CI paths are proven by
   `acceptance:publish` and `acceptance:ci-repair`.
3. **Theme rounds are marked, not yet executed as theme work.** The theme lane's own
   gates (create/activate/delete/restart) are `acceptance:theme` and the desktop black
   box's second phase; wiring those into the soak rounds is CP18's black box scope.
4. **The six metrics are counters supplied by the round.** The runner records zero
   breaches today because its rounds take no Owner decision and lose no state; a
   round that did would have to increment them, and `evaluateSoak` fails the soak the
   moment one moves.
