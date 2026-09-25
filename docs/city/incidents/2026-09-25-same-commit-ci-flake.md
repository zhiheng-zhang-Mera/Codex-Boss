# INCIDENT — 2026-09-25 — the seventh same-commit CI flake, and the rule that keeps "it's a flake" from becoming an excuse

**Incident id:** INC-2026-09-25-01
**Repository:** `zhiheng-zhang-Mera/Codex-Boss`
**Recorded by:** Hns, temporary Owner-authorised City construction executor
**Authority document:** `docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`
**Related ledger entries:** CC-036 (this record), CC-015, CC-016, CC-017, CC-022 (the earlier occurrences)
**Related incident:** `docs/city/S2_EXIT_CERTIFICATION.md`, whose audit enumerates the six earlier retries

Facts only. Both runs described here are preserved in GitHub history and must never be deleted, hidden, or
re-run until green without this record.

---

## 1. What happened

On PR **#68** (`feat/p2h-core-growth-budget`, head `65cf88bc629986617b8d539214d0028f81a3fd22`) the required check
`acceptance` reported **FAIL** on one workflow run and **PASS** on another run of the **same commit**, created two
minutes apart by two different events. The failed job was then re-run on the identical commit and passed.

This is the **seventh** occurrence of the same class in this programme: a required check that fails on one run of a
commit and passes on another run of that same commit, with no change to the tree.

## 2. Facts

```text
commit                     65cf88bc629986617b8d539214d0028f81a3fd22  (identical for all three observations)

run 36093439852  event push           acceptance FAILED   3m21s
                 [desktop-smoke] FAIL the restarted app serves the theme panel from the real UI
                                 -- expected true, observed false
                 [desktop-smoke] totals: PASS 62 FAIL 27 NOT_RUN 26
                 PASS discovery found the workspace test files -- expected true, observed true

run 36093456263  event pull_request   acceptance PASSED   6m50s

run 36093439852  re-run of the failed job, same commit
                                      acceptance PASSED   6m50s

first failing assertion     "the restarted app serves the theme panel from the real UI"
job lengths                 3m21s (failed) against 6m50s (passed, twice) -- the failing run aborted early,
                            which is why 26 cases are NOT_RUN rather than failing
pull request state           BLOCKED while the failed job was pending, CLEAN after the re-run
merge                        performed with no bypass, on the CLEAN state
```

## 3. Why this is classified R1 and not attributed to the change

Classification **R1** (load-sensitive, disproved on the same tree by re-run).

Two pieces of evidence are required before a failure may be dismissed, and both are present:

1. **A second run of the SAME commit succeeded.** Twice: once from the pull-request event, and once as a re-run of
   the failed job itself. A failure that does not survive a re-run of the identical tree is not evidence about the
   tree.
2. **A mechanism-level account of why the change cannot affect that suite.** The change adds `config/core-budget.json`
   (read only by `scripts/core-budget-validator.cjs`), a script, a document and a test; it touches **no** file under
   `electron/` or `src/`, no renderer code, and nothing the desktop smoke suite loads. The failing assertion is about
   the theme panel served by the real Electron application after a restart. The two are not connected by any path a
   reviewer can name, and the enforcement sensor confirms the source tree is unchanged (`violations 0`).

## 4. The rule, stated so it cannot be used as an excuse

A red check may be recorded as a flake **only** when both conditions above hold. Condition 1 alone is not enough:
a real intermittent defect also passes on the second attempt, and the difference between a flake and an
intermittent defect is whether a **mechanism** can be named. Where no mechanism can be named, the failure stays
unexplained and blocks, rather than being retired as noise.

The rate is therefore tracked rather than waved away. Seven occurrences are recorded, and **a rising rate is
itself a finding**: it would mean the hosted runner or the suite is degrading, which is a defect in the merge gate
even though no single run is evidence against any single commit.

## 5. What is NOT claimed

- No root cause is claimed for the host's timing behaviour. Nothing here asserts why the same tree behaved
  differently on two runs.
- This record does not assert that `acceptance:desktop-workbook` is unreliable in general. Sixty-two of the cases
  passed in the failing run, and the suite passed twice on the same commit.
- No re-run was used to obtain a green that had previously failed **on a tree that had changed**. Every re-run
  recorded here is on an identical commit; a re-run after a change would be a fix, not a flake.

## 6. Consequences

- The merge was completed with **no bypass**, and only after the required check reported success on the commit.
- The seven occurrences, with the run ids and commits, are enumerated in CC-036 and in
  `docs/city/S2_EXIT_CERTIFICATION.md` for the six earlier ones.
- If an eighth occurs, the first question is whether the rate is rising; the second is whether any occurrence has
  a mechanism, which would reclassify that occurrence from R1 to a real defect.

## 7. Occurrence nine (2026-09-25, PR #81): three attempts on one commit, and the family is the SOAK suites

The class recurred, and it recurred in a shape the first eight did not: the commit did **not** go green on the first
re-run, and the three runs failed in **different tests in different steps**.

```text
commit   b839337952fef7736da2b8919f697e8861f297c2  (identical for all three observations)

attempt 1  the MERGE run itself
           step test:postbuild
             tests/acceptance/platform-soak-report.test.ts
               "reaches the allowance verdict through the production decision, whichever way this host measured"
               AssertionError: expected 2 to be greater than 3
             tests/unit/root-trust-authority-lockdown.test.ts
               "holds no public real-host dispatch surface, and uploads no corpus"
               Error: Test timed out in 120000ms
           acceptance and package SKIPPED because unit failed

attempt 2  a re-run of the failed jobs on the SAME commit
           step test:slow
             tests/unit/platform/platform-soak.test.ts
               "never deletes protected data, and never loses committed work across a restart"
               AssertionError: expected 0 to be greater than 0
           a DIFFERENT test, in a DIFFERENT step

attempt 3  a second re-run of the failed jobs on the SAME commit
           unit, acceptance and package all SUCCESS
```

### What is the same as the first eight, and what is not

**The same:** the mechanism account holds. The change that merged (ledger `CC-049`) touched
`scripts/phase2-private-state.cjs`, one config record, one test file and the ledger. None of the three failing tests
reads any of them; they are soak and lifecycle suites that measure behaviour under load. The pull-request run on the
same content was 5/5 green.

**Not the same, and this is the finding:** the failures were **not reproduced** by the re-run — they were
**replaced**. Three different assertions failed across two different steps. A run-level flake and a **family-level**
condition look identical from one failure and completely different from three, and only the third attempt made the
distinction visible.

### The rule, sharpened

The standing rule (`CC-036`) is that a red may be recorded as a flake only when **both** a same-commit green exists
**and** a mechanism can be named. That rule held here, but only after the third attempt — and it would have permitted
dismissal after attempt two, where the evidence was already *"a different test failed"*, which is strictly stronger
than *"the same test failed again"*. So the rule gains a clause:

> When a re-run of the same commit fails in a **different test** than the run before it, the condition is not a
> run-level flake to be retried until green. It is a **family-level** condition, and the family must be named in the
> record before the red is dismissed — because retrying until green is indistinguishable from not investigating.

Here the family is the **soak suites**: `platform-soak`, `platform-soak-report` and the Root Trust lockdown suite
that timed out. Two of the three measure lifecycle behaviour over time under load; the third spawns work and waits
for it. Each has a threshold that a loaded runner can miss, and the assertion messages say so (`expected 2 to be
greater than 3`, `expected 0 to be greater than 0`, `Test timed out in 120000ms`).

### What is NOT claimed

- No root cause is claimed for the runner's load or timing.
- This record does not assert that the soak suites are unreliable in general: they pass on most runs, including the
  pull-request run on this very commit.
- The green was obtained by **retrying an identical commit**, which is the definition of this class and not a repair.
  It is recorded as a green whose reliability is lower than a first-attempt green.

### Recorded debt

**The soak family's thresholds are not load-robust, and the merge gate reports the runner's load as the tree's
health.** Proposed exit condition: either each soak assertion states the load it requires and fails as
`NOT_MEASURED` rather than as a wrong value when the host cannot supply it, or the family is explicitly quarantined to
a lane whose result is recorded as evidence rather than as a required check. Debt id `CITY-DEBT-005`, recorded in
`docs/city/CITY_RENOVATION_DEBT_REGISTER.md`, `CC-050`.
