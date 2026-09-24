# INCIDENT — 2026-09-24 — four spurious trust-epoch finalization dispatches, in a burst

**Incident id:** INC-2026-09-24-02
**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Recorded by:** Hns, temporary Owner-authorised City construction executor
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`
**Related ledger entries:** CC-007 (cancellation), CC-002 (the first occurrence)
**Related debt:** CITY-DEBT-004; and CITY-DEBT-001, the same failure class one level up
**Related incident:** `docs/city/incidents/2026-09-24-spurious-trust-epoch-dispatch.md` (INC-2026-09-24-01)

Facts only. The four runs described here are preserved in GitHub history as `cancelled` and must never be
deleted, hidden, or re-dispatched.

---

## 1. What happened

Within fifteen seconds, **four** `workflow_dispatch` runs of the protected `Trust Epoch Finalization` workflow
were created on `main`, all on the same commit, all waiting on the protected environment
`boss-root-trust-owner`.

That commit already carried **epoch 29**, whose record anchors the live Root Trust Surface. No migration was
needed by any of the four. None of them was intended.

## 2. Facts

```text
main at the time          1892e61c89596b7cd66257ae5b4cedb4bae8dfc0  ("Merge pull request #27")
committed epoch           29  (epoch_hash 78ae6c22f644e6a55e6e818d2bd1799d083157ea003bfeec12d796944e53de14)
live surface at the time  2abacb6f069b5bf577682294c9b4b4c82f0686ebe7165d9fc5bd4ba8c8aa30d7  (74 files)
epoch 29 anchors it?      YES  (acceptance-evolution-bless.cjs --check = MATCHES)
migration needed?         NO

run 1  35965428473   created 2026-09-24T06:37:58Z   workflow_dispatch   head_sha 1892e61c
run 2  35965431153   created 2026-09-24T06:38:00Z   workflow_dispatch   head_sha 1892e61c
run 3  35965446098   created 2026-09-24T06:38:11Z   workflow_dispatch   head_sha 1892e61c
run 4  35965449267   created 2026-09-24T06:38:13Z   workflow_dispatch   head_sha 1892e61c

actor / triggering actor  zhiheng-zhang-Mera (the Owner account; the host's authenticated gh client)
environment               boss-root-trust-owner (required reviewer, can_admins_bypass = false)
status at observation     waiting (4) — no environment deployment had been approved for any of them
terminal status           cancelled (all four)
```

## 3. Cause

The immediate cause is a defect in the **test harness of this very repair**, and it is recorded here rather than
quietly fixed, because it is the same failure class as INC-2026-09-24-01.

`tests/unit/city/trust-epoch-dispatch-helper.test.ts` must prove that a dry run cannot dispatch. To do that it
injects a fake executor. Its first revision injected that fake through `PATH` and `NODE_OPTIONS`, on the
assumption that a spawned `gh` would be a Node program. On this host `gh` is a **native binary**, which ignores
`NODE_OPTIONS` — so the injection silently did nothing, the "a confirmed run reaches the executor" case reached
the **real** `gh`, and each execution of that case performed a real dispatch of the protected workflow.

```text
declared intent   run a fake executor
actual effect     run the real executor, four times, against a protected ceremony
why invisible     the injection path failed open: the fixture did not record, and the test that noticed
                  ("the confirmed run did not reach the executor") was written to prove the fake worked,
                  not to prove the real one was unreachable
```

**The harness repair:** the fake is now injected through the helper's own command override
(`TRUST_EPOCH_DISPATCH_GH`), so the process the helper spawns *is* the recorder and the real `gh` is unreachable
from that test by construction. The same commit asserts that the helper resolves its command from that
overridable route, so the injection cannot silently miss again.

## 4. Impact on correctness

```text
Effect on the committed epoch        NONE. No run was approved, so none started, measured, advanced, or wrote
                                     trust-policy/trust-epoch.json. Main still carries epoch 29, and `--check`
                                     still reports MATCHES.
Effect on the epoch lineage          NONE. No branch, commit, record or parent hash was produced.
Effect on main CI                    NONE. Desktop CI run 35965095036 was unaffected and continued.
```

## 5. Impact on provenance

```text
Effect on provenance                 REAL AND NOT ZERO. The Actions history now contains four protected-ceremony
                                     runs that correspond to no intended act, created in a burst. A later reader
                                     must be able to tell which finalization runs were authorised; this record is
                                     how, and the runs are preserved rather than hidden.
Compounding risk (not realised)      Each was a waiting run on the protected environment. An approval given out of
                                     habit — "there is a waiting run, approve it" — would have started a ceremony
                                     for a commit that needed none. Since `--advance` finds nothing to migrate it
                                     would have reported NO_MIGRATION, so the record would have been a spurious
                                     ceremony rather than a wrong epoch: less severe than CORRUPTION, still not
                                     nothing, and exactly the habit the environment gate exists to prevent.
```

## 6. Cancellation result

```text
action      gh run cancel for each of 35965428473, 35965431153, 35965446098, 35965449267
result      Request to cancel workflow <id> submitted.  (four times)
terminal    completed / cancelled  (verified for all four)
approved    NO. No environment deployment was approved for any of the four.
```

## 7. Follow-up hardening (required, and tracked)

```text
1. CITY-DEBT-004  the test harness injects the fake executor through the helper's overridable command route and
                  asserts that the route is what is used. DONE in the same commit as this record.
2. CITY-DEBT-004  an ordinary `pnpm test` on a clean main must be shown to open ZERO protected runs. To be
                  proven by observing the Actions history after the next full test cycle on main.
3. CITY-DEBT-001  the dispatch helper requires an explicit `--confirm` for every write, prints the exact argv
                  before confirmation, and refuses a confirmation that omits reason/risk/rollback.
4. Standing rule     after any full test run that touches the trust machinery, check the Actions history for
                  unexpected `workflow_dispatch` runs before doing anything else. This incident was caught only
                  because the run list was read immediately after a merge.
```

## 8. What this incident illustrates

A "dry run" that performs a real protected dispatch is a helper whose name overstates its safety. A **test
fixture** that reaches the real system is not a test. Both are the same defect — an artifact whose declared
intent and effect disagree — and in both cases the disagreement was invisible precisely because the artifact was
supposed to make it impossible. The first incident was a helper; this one is the harness written to prove the
helper safe. Fixing one occurrence does not fix the class: the class is "an injection that fails open".

## 9. Evidence references

```text
run 1   https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35965428473   cancelled
run 2   https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35965431153   cancelled
run 3   https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35965446098   cancelled
run 4   https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35965449267   cancelled
main CI https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/runs/35965095036   (unaffected)
workbook clauses  §2 (blocked lane != blocked programme), §4.3 (incident record), §5 (classification),
                  §7 (credential handling: the host client was used, no credential was read or copied)
ledger entries    CC-002, CC-007
debt entries      CITY-DEBT-001, CITY-DEBT-004
```
