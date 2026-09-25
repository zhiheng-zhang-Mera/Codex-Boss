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
