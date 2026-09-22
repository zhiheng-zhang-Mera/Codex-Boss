# PHASE 0 SPECIFICATION FINDING

**Question this file answers:** *what is the authoritative Phase 0 specification — its path, its commit, its
scope and its acceptance criteria?*

**Answer:**

```
FINAL_STATUS = PHASE0_SPEC_NOT_FOUND
```

No unambiguous, authoritative Phase 0 specification exists in this repository at `city-start-baseline-v1`
(`53aa74a`), at current `main`, or on any other ref.

This is a **finding**, not a failure to search. Phase 0 was therefore **not started**, no Phase 0 branch was
created, no implementation commit exists, and `PHASE0_ACCEPTED` is **not** claimed. §3 of the round brief
instructs exactly this stop, and §5 forbids substituting a newly invented rubric for the authoritative one.

---

## 1. What was searched, and how

| Search | Command / method | Result |
|---|---|---|
| The frozen baseline tree | `git grep -l -i "observatory" origin/main` | **0 files** |
| The frozen baseline tree | `git grep -l -E "CONFLICT_CLASSIFIER\|NON_BLOCKING_QUERY\|WAITING_VS_DEAD\|PHASE0_ACCEPTANCE" origin/main` | **0 files** |
| **Every** remote ref (≈40) | `git grep -l -i "observatory" <ref>` for each | hits **only** on `refactor/capability-city-v1` (6 files) |
| **Every** remote ref | `git grep -l -E "CONFLICT_CLASSIFIER\|NON_BLOCKING_QUERY\|WAITING_VS_DEAD\|PHASE0_ACCEPTANCE" <ref>` | **0 files — the tokens exist nowhere in git** |
| Filenames ever added | `git log --all --diff-filter=A --name-only` filtered on `city\|phase0\|observatory` | no Phase 0 specification or acceptance contract was ever committed |
| Tracked `Update-Plan/` at `main` | `git ls-tree -r --name-only origin/main -- Update-Plan` | **Platform-Foundation Phase 01–08 only.** No Capability City phase book. (`Update-Plan/Autonomous-Evolution-Phase0/` is a *different*, earlier programme — root defence and isolation — and is not Capability City.) |
| Working tree / other checkouts | `D:\Codex-Boss`, `D:\Boss-PreCity-RC`, `D:\Boss-PF020-Live-Acceptance`, `D:\cbx-research` | no Phase 0 specification |
| Gitignored runtime reports | `D:\Boss-PreCity-RC\artifacts\city\reports\` | one prior-round report contains a **PHASE0 field table** (§3, candidate C7) — the only surviving trace of a *different* definition, and it cites a mission document that is not in the repository |

The baseline commit is the critical negative result:

> **At `city-start-baseline-v1` / current `main` (`53aa74a`) there is no city plan at all.** The word
> "observatory" does not occur in a single file. The entire Capability City plan, the frozen research
> questions, the decision ledger `D-001..D-009` and every governance artefact live **only** on
> `refactor/capability-city-v1`, whose merge base with `main` is `836b5ed` — i.e. it is **not** an ancestor of
> `main`:
>
> ```
> git merge-base --is-ancestor 3aa237fd51571951fcb7b51036e92dfe7285f948 origin/main   ->  exit 1
> ```

---

## 2. Candidate documents, with commit chronology

Ordered by introduction. `COMMIT` is the commit that introduced or last authoritatively amended the text.
All of these are on `refactor/capability-city-v1` (base `836b5ed`), **not** on `main`.

| # | Path | Commit | Date (+1000) | What it actually is |
|---|---|---|---|---|
| **C1** | `docs/capability-city-principles.md` | `5c06f7e` (later frozen by `c265ede`) | 2026-09-21 | Principles 15.1–15.9 **the Owner had already decided**. It states its own status: *"FORMAL BUT NOT YET MACHINE-ENFORCED"*, *"Nothing in this document is implemented, and nothing here authorises construction"*, and *"DO NOT BEGIN Capability City / Kernelization construction from this document"*. §15.7 says *"Fixing the measurement is the first act of the city phase"* — a **priority statement, not a work order with criteria**. |
| **C2** | `research/capability-city/RESEARCH_LEDGER.md` **D-001** | `347de00` | 2026-09-22 06:18 | The decision that motivates Phase 0: chosen design **"(b), then (a)"** — *build a real-source observatory as a separate instrument first*, keeping the legacy manifest gate intact as the **comparison arm** for RQ5. It has *Expected effect* and *Potential confounders*, and its *Actual effect* is `Pending — Phase 0`. **It contains no acceptance criteria.** |
| **C3** | `research/capability-city/evidence/BUG_FINDING_LEDGER.md` **FINDING-001** | `da80400` | 2026-09-22 11:11 | `FIX_SHA = NOT FIXED — Phase 0 is authorised to repair it`; `FIX_DESCRIPTION = "Phase 0: scan the real source tree; stop dropping undeclared targets; add falsification self-tests"`; `AFTER_RESULT = NOT YET MEASURED (Phase 0)`; `RELATED_TESTS = "Phase 0 will add the observatory's own falsification tests"`. **A one-line fix description, not a specification.** |
| **C4** | `research/capability-city/dataset/metrics.json` | `dc42346` | 2026-09-22 09:40 | The most concrete artefact. `instruments.realSourceObservatory` gives scans / excludes / `mustParse` / `mustNotDependOn` / `rule`, **and its `command` field is literally `"PENDING — Phase 0"`** — i.e. the entry point was never fixed. M-01..M-25 carry baselines, many `"PENDING (Phase 0)"`. **Metric definitions are not acceptance criteria.** |
| **C5** | `research/capability-city/RQ.md` **RQ5** | `347de00` | 2026-09-22 06:18 | *"Can a real-source-graph architecture gate detect more true violation relationships than a manifest-driven gate?"* Measures: true positives, **false negatives**, false positives, per detector, against **ground truth**. Answer: `OPEN`. |
| **C6** | `research/capability-city/OWNER_MACHINE_IDENTITY_CEREMONY.md` step 6 | `da80400` | 2026-09-22 11:11 | *"only then begins **Phase 0** (Architecture Observatory Repair) on `refactor/capability-city-v1`"*. Names a branch, not a specification. |
| **C7** | `artifacts/city/reports/MISSION_ROUND_WAITING_FOR_ROOT_OWNER_REPORT.md` §`PHASE0` | uncommitted (gitignored runtime report) | 2026-09-22 12:06 | A **different** Phase 0 definition. Its acceptance field set is `OBSERVATORY_ARCHITECTURE`, `STATE_MODEL`, `EVENT_MODEL`, `CONFLICT_CLASSIFIER`, `NON_BLOCKING_QUERY_TEST`, `NON_CONFLICTING_CHANGE_TEST`, `CONFLICTING_CHANGE_TEST`, `WAITING_VS_DEAD_TEST`, `FAILURE_ISOLATION_TEST`, `ROOT_AUTHORITY_TEST`, `PHASE0_TEST_COUNTS`, `PHASE0_ACCEPTANCE`. It cites *"mission §20"* as the Phase 0 gate and *"§20–§35"* as the Phase 0 definition. **That mission text is not in this repository.** |

---

## 3. The ambiguities — stated, not resolved by preference

### 3.1 Two incompatible constructions of "the Observatory"

| | **Construction A — the architecture measurement observatory** | **Construction B — the state/event observation system** |
|---|---|---|
| Carried by | C2 (D-001), C3 (FINDING-001), C4 (`metrics.json`), C5 (RQ5) | **C7 only** — and C7 is a gitignored runtime report |
| What it is | a **new instrument** that scans the real source tree and reports the real dependency graph, run **alongside** the legacy manifest gate so the two can be scored against ground truth | a **passive observer of durable state and events** with a `STATE_MODEL`, an `EVENT_MODEL` and a `CONFLICT_CLASSIFIER`, queryable without blocking writers |
| Its acceptance | not stated. RQ5 proposes TP/FN/FP against a *"seeded ground-truth violation set"* — but the seed set, its author, and the threshold that counts as acceptance are **all undefined** | a named list of six tests (`NON_BLOCKING_QUERY`, `NON_CONFLICTING_CHANGE`, `CONFLICTING_CHANGE`, `WAITING_VS_DEAD`, `FAILURE_ISOLATION`, `ROOT_AUTHORITY`) — **none of which exists as a test, a script, a config key or a document anywhere in git** |
| Exists in tracked form? | **Partially** — as prose and metric definitions only | **No.** Only the field *names* survive, in an untracked report |

The round brief's own language — *"measure, expose, correlate, timestamp, attribute provenance, detect
unknowns, and make system state inspectable"*, and the invariant pair `OBSERVATION != AUTHORIZATION` /
`BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF` — is **satisfiable by either construction**. It does not
adjudicate between them, and the repository does not either.

`PHASE0_SPEC_PATH` and `PHASE0_SPEC_COMMIT` cannot be reported, because there is no single path and no single
commit: construction A is spread across four files at three different commits (`347de00`, `dc42346`,
`da80400`), and construction B has no path in the repository at all.

### 3.2 The branch-base conflict

| Source | Required Phase 0 branch base |
|---|---|
| C6 (`OWNER_MACHINE_IDENTITY_CEREMONY.md` step 6, written `da80400`) | `refactor/capability-city-v1` — base **`836b5ed`** |
| This round's brief §4 | must resolve to **`53aa74a`** (`city-start-baseline-v1`) |

These are not reconcilable by choosing the newer document: C6 is the *only* repository statement of where
Phase 0 runs, and the round brief is the *only* statement that the base must be the new baseline. Deleting
either would be a preference, not an inference.

### 3.3 The scan-scope tension

`metrics.json` declares the legacy manifest gate **"Deliberately retained unmodified (RESEARCH_LEDGER D-001).
Its known blindness is part of the experiment, not a bug to fix."** FINDING-001's `FIX_DESCRIPTION`, by
contrast, says *"stop dropping undeclared targets"* — which is a change to that same gate. `D-001`'s
*"(b), then (a)"* resolves the ordering in principle (observatory first, widen in place afterwards), but
**no document says whether Phase 0 is complete at (b) or only at (a)** — which is the difference between a
small additive instrument and a change to the gate CI runs.

### 3.4 There are no acceptance criteria anywhere

The round brief requires `PHASE0_ACCEPTANCE_CRITERIA` **from the authoritative specification**, and forbids a
newly invented rubric. No artefact states what must be true for Phase 0 to be accepted. The closest things —
`D-001`'s *"Expected effect: the observatory reports orders of magnitude more edges than the declared graph,
and detects seeded violations the old gate misses entirely"*, and RQ5's TP/FN/FP proposal — are an
*expectation* and a *research question*, not criteria: they name no threshold, no required test list, no
required artefacts, and no definition of the ground-truth set they measure against.

That a prior round wrote `PHASE0_ACCEPTANCE = NOT ATTEMPTED` and `OBSERVATORY_ARCHITECTURE = not designed yet`
is consistent with this: the round that produced C7 was itself *waiting* for the specification to arrive
through the mission text, not reading it from the repository.

---

## 4. Why this is a stop and not a judgement call

1. **The brief's own stop condition is met verbatim.** *"If no unambiguous Phase 0 specification exists:
   `FINAL_STATUS = PHASE0_SPEC_NOT_FOUND`. Stop and report the candidate documents and ambiguity. Do not
   improvise a new Phase 0."*
2. **Two constructions exist and cannot both be Phase 0.** Implementing A would produce a dependency-graph
   instrument; implementing B would produce a durable-state observation layer. They share a word and almost
   nothing else. Whichever were chosen, the *other* would be silently dropped — which is precisely the
   *"do not silently blend conflicting versions"* failure the brief names.
3. **The acceptance criteria cannot be chosen by the implementer without becoming the easier rubric.** The
   brief explicitly forbids this in §5.
4. **The ambiguity is itself research material.** It is a measured instance of the programme's central theme:
   a specification that exists only as a shared assumption is not a specification — the same class as
   `OBS-GOV-001` (a rule whose actor set was degenerate) and `D-006` (an invariant the configuration could not
   satisfy). Here it is the *task* rather than the rule that fails to bind. Recorded deliberately.

---

## 5. What would resolve it (for the Owner, not for this round)

Any one of the following ends the ambiguity. None of them is a code change.

1. **Designate one construction and publish it as a tracked document** — e.g. `docs/capability-city-phase-0.md`
   on `refactor/capability-city-v1` or, preferably, on a branch based on `city-start-baseline-v1` — containing:
   scope, the instrument's required entry point, the exact scan set, the falsification tests, the required
   artefacts, and the acceptance criteria as a checkable list.
2. **Or restore the mission text** that C7 cites (`§20–§35`) as a tracked document, since it evidently once
   carried the Phase 0 definition and the acceptance field set.
3. **Rule on the branch base** (§3.2) and on the scan-scope question (§3.3): is Phase 0 `(b)` only, or
   `(b)` then `(a)`?

Until then the honest states are:

```
PHASE0_SPEC              = NOT FOUND
PHASE0_STARTED           = NO
PHASE0_BRANCH            = NOT CREATED
PHASE0_IMPLEMENTATION    = 0 commits
PHASE0_ACCEPTED          = NOT CLAIMED
PHASE1_STARTED           = NO
```

---

## 6. Reproduction

```powershell
cd D:\Codex-Boss
git grep -l -i "observatory" origin/main                      # (nothing)
$refs = git for-each-ref --format='%(refname)' refs/remotes/origin
foreach ($r in $refs) { git grep -l -i "observatory" $r -- }  # only refactor/capability-city-v1
foreach ($r in $refs) { git grep -l -E "CONFLICT_CLASSIFIER|NON_BLOCKING_QUERY|WAITING_VS_DEAD|PHASE0_ACCEPTANCE" $r -- }  # (nothing, anywhere)

# the city plan is not on the baseline
git merge-base --is-ancestor 3aa237fd51571951fcb7b51036e92dfe7285f948 origin/main ; $LASTEXITCODE   # 1

# the candidates, in order
git show --stat 5c06f7e      # docs/capability-city-principles.md
git show --stat 347de00      # RQ.md, D-001/D-005
git show --stat dc42346      # OBS-GOV-001 freeze; metrics.json
git show --stat da80400      # D-008/D-009; FINDING-001 FIX_SHA=NOT FIXED
```
