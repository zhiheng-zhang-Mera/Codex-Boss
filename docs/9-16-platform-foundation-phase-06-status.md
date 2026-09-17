# Phase 06 — Dogfooding Closure: status record

> **STATUS: PASS.** All five tasks are delivered, a dogfood run reached `CONVERGED` on a real workspace,
> and the full inherited regression passes at the final head. No waiver was used, no test or security
> constraint was weakened, and no Phase 05 conclusion was rewritten. Nine defects were closed
> (`PF-DEBT-001` … `010`) and one boundary note recorded (`PF-DEBT-011`).
>
> `PF-DEBT-003` (`evolution-sandbox` needs an AppContainer) remains `ENVIRONMENT-BLOCKED` and is **not** a
> Phase 06 gate; its exclusion from the audit is measured, never declared, and lowering the sandbox
> requirement to make it green stays forbidden.

## 1. Identity

| | |
| --- | --- |
| Phase | `06-dogfooding-closure` |
| Branch | `platform-foundation/06-dogfooding-closure` |
| **BASE_SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` (Phase 05 certified FINAL_HEAD) |
| **FINAL_SHA** | `76ba899ea360bb86724ab7d4e37c74390cf96682` |
| `main` | `af8b85c47306b0b992fed1e1cf6eea0f1d652ba5` — untouched |
| Phase 07 | not started |

## 2. The engineering book did not exist — it is recovered, and says so

`Update-Plan/Platform-Foundation/` contained Phases 01–05 only, and a repository-wide search found no
"Phase 06" reference in any tracked file. Per the standing instruction the intent is **recovered, not
invented**, from three sources that do exist, and the book's first line states it:

1. **Phase 05 §7** — the Foundation ends at Phase 05, and the next phase is dogfooding on real workloads,
   explicitly *"rather than continuing to expand infrastructure on imagination"*;
2. **Phase 05 §4** — Quant/Health and similar projects were deliberately deferred to "later dogfooding";
3. **the evidence the five phases left** — every task traces to a located gap (Phase 05 §11) or to a
   defect verified in code before being recorded.

Book: `Update-Plan/Platform-Foundation/Phase-06-Dogfooding-Closure.md`.
`.gitignore` gained the missing `/Update-Plan/Platform-Foundation/` exception — the blanket
`/Update-Plan/*` rule never covered Phases 01–05 only because gitignore does not apply to
already-tracked files.

## 3. Tasks and their state

| Task | State | Evidence |
| --- | --- | --- |
| A — state-ownership closure | **delivered** | `engineering-journal.ts`, `machine-identity-layout.ts`; `PF-DEBT-007`, `PF-DEBT-008` FIXED |
| B — failure-surface correctness | **delivered** | `intervention-file.ts`, `BudgetManager.reconcile`; `PF-DEBT-005`, `PF-DEBT-006` FIXED |
| C — evidence-gap closure | **delivered** | `experience-capability.test.ts` (22), `remote-capability.test.ts` (22); `PF-DEBT-001`, `PF-DEBT-002` FIXED; capability coverage **27 of 27** |
| D — dogfooding harness | **delivered; CONVERGED** | `dogfood-engineering.cjs`, `engineering-goal-loop.ts`; `PF-DEBT-009`, `PF-DEBT-010` FIXED |
| E — inherited regression at final head | **PASS** | §7 below, at `76ba899` |

### PF-DEBT-010 resolved as a second loop, not a patched one

`EngineeringLoopDriver` is a REPAIR loop — every round it asks the workspace what is wrong and fixes the
first thing it finds — and its two production callers depend on exactly that. Given a goal it therefore
worked whatever was already failing. Changing it would have silently altered self-evolution, so the phase
added the loop it actually needed:

- the **audit is a precondition**: an environment finding refuses the run up front, by name;
- pre-existing **code findings are recorded, never worked**;
- the **objective is the work list**;
- convergence requires the host's checks over a **non-empty** change set — "the goal needed no change" and
  "the goal was implemented" are different answers, and a no-op is reported as the first.

### What the dogfood runs established, in order

Five real runs. Each was blocked by a genuine platform decision rather than a harness bug, which is what
makes them evidence rather than noise:

1. the audit found a pre-existing failure (`command:test`, the `PF-DEBT-003` suite) and the goal loop
   **recorded it instead of chasing it** — the inversion the phase needed;
2. a **linked worktree was refused** by the mutation guard, correctly: it shares the Boss repository's git
   identity, so ordinary engineering may not mutate it. The harness moved to a clone with no origin
   remote, which matches neither the structural nor the identity signal;
3. the coder proposed `tests/unit/intervention-file-properties.test.ts` and the host refused it as
   **out of scope** — a file that does not exist cannot be pre-authorised by listing it;
4. an opt-in, default-closed creation grant was added, and the caller then **mis-specified it** (no
   trailing slash), which the platform reported as the same refusal;
5. with all of that cleared, the run stopped on **`Invalid hash-bound change`** — the coder's own manifest
   failing schema validation, which the platform reported and refused correctly.

Run 5 reached the coder twice (4 663 provider-reported input tokens) with `checkoutUntouched=true`.

### The open item

**Closed.** A dogfood run reached `CONVERGED` on the sixth attempt: one file applied, typecheck + the test
command + `git diff` all passed, the pre-existing failure recorded and not worked, `checkoutUntouched=true`,
1 930 provider-reported input tokens, and the platform's generated test verified to pass when run
independently of the platform.

Getting there closed `PF-DEBT-010` (the goal-driven loop) and one further real defect: `parseManifest`
format-checked `expectedSha256` with a rule **stricter than the applier's own check** — `applyScopedChanges`
recomputes the target's digest and refuses a mismatch, and `null` already means "no prior hash". So a model's
formatting slip in a field the applier was going to recompute ended the run and spent the single automatic
schema retry. The format check is gone, the safety property is not, and
`tests/unit/change-manifest-boundary.test.ts` holds both halves: a malformed digest is normalised, and a
**wrong** hash is still refused with "Source changed since proposal".

### What Task A actually found

`PF-DEBT-007` was recorded as duplicated construction and turned out to be **data corruption**:
`EngineeringLoopStore`'s reader *requires* an `iterations` array and throws without one, while
`EngineeringRecoveryLedger` writes `{schemaVersion, events}` over the same path. The recovery ledger's own
comment already claimed the two were "deliberately separate" — nothing enforced it, and the loop store
ends up unable to open its own journal. `recoveryLedgerFor(file)` made it worse by accepting a
**directory** and inventing a plausible wrong path, so it was removed rather than documented.

### What Task D actually found, and how it ended

The harness puts a real objective through the production autonomous-engineering seam against a **clone
without an origin remote**, and verifies the live checkout did not move. Six real runs, each blocked by a
genuine platform decision rather than a harness bug:

1. the audit found a pre-existing failure (`command:test`, the `PF-DEBT-003` suite) and the goal loop
   **recorded it instead of chasing it** — the inversion the phase needed;
2. a **linked worktree was refused** by the mutation guard, correctly: it shares the Boss repository's git
   identity, so ordinary engineering may not mutate it. The harness moved to a clone with no origin
   remote, which matches neither the structural nor the identity signal;
3. the coder proposed `tests/unit/intervention-file-properties.test.ts` and the host refused it as
   **out of scope** — a file that does not exist cannot be pre-authorised by listing it;
4. an opt-in, default-closed creation grant was added, and the caller then **mis-specified it** (no
   trailing slash), which the platform reported as the same refusal;
5. the manifest parser **format-checked `expectedSha256` more strictly than the applier does**, so a
   model's formatting slip in a field `applyScopedChanges` recomputes ended the run and spent the single
   automatic schema retry;
6. **`CONVERGED`** — one file applied, typecheck + the test command + `git diff` all passed, the
   pre-existing failure recorded and not worked, `checkoutUntouched=true`, 1 930 provider-reported input
   tokens across 2 calls, and the platform's generated test verified to pass when run **independently of
   the platform**.

`PF-DEBT-009`, `PF-DEBT-010` and the manifest defect are fixed with file-and-line evidence in
`docs/platform-foundation-known-issues.md`. Deleting or skipping `evolution-sandbox` to make an audit
green remains forbidden, and `PF-DEBT-010` records that it must not become the reason it happens.

`PF-DEBT-011` is recorded as an `EVIDENCE-TIER NOTE`: the host verifies that a check **passes**, not that
it **asserts** anything. One of the generated test's two cases round-trips an empty array. The host cannot
judge assertion quality and should not pretend to, so the note states plainly that "the host's checks
passed" means the change compiles, the suite is green and the diff is clean — and **not** that the change
does what the objective asked.

## 4. Known-issues log

`docs/platform-foundation-known-issues.md` — a durable record, not a TODO list: every entry carries ID,
title, discovered phase, status, severity, affected capability, evidence/source, why deferred, what would
close it, target/revisit phase and last reviewed SHA, with a controlled status vocabulary and a review log.

`PF-DEBT-001` … `004` are the mandated records. `005` … `011` were located during this phase, and each was
verified in code or on a real run before being written down.

| State at `76ba899` | Entries |
| --- | --- |
| `FIXED` | `PF-DEBT-001`, `002`, `005`, `006`, `007`, `008`, `009`, `010` |
| `EVIDENCE-TIER NOTE` | `PF-DEBT-004` (Phase 05 evidence is local exact-head, not remote CI), `PF-DEBT-011` |
| `ENVIRONMENT-BLOCKED` | `PF-DEBT-003` (AppContainer) — not a Phase 06 gate |

## 5. Inherited contracts — re-verified per batch

| Contract | Verified by |
| --- | --- |
| mandatory gate vs optional Agent stage | `MANDATORY_GATE_STAGES` / `OPTIONAL_AGENT_STAGES`; the guard still refuses `verify` **by kind** (`INSUFFICIENT_EVIDENCE`) |
| `executedStages` is authoritative provenance | read live in the dogfood run's evidence; Phase 05 pairs still `executed-trace` |
| real-provider economics provenance | Phase 05 artifact intact: `real-provider`, `COST_ONLY` |
| provider usage vs heuristic estimate | kept apart in the harness's `usage` block too |
| task-grain vs stage-grain | untouched; `totalStage` still sums stage rows only |
| `COST_ONLY` is a legal verdict | Phase 05 certificate still reads `measured: true` |
| certificate status derived, not hardcoded | `notRunSections` derives `phaseStatus` |
| provider model declaration single-source | `PROVIDER_MODELS` single declaration; contract test green |
| security scan / typecheck / ratchet / state probe | green at every batch |

## 6. Acceptance at FINAL_SHA

At `76ba899ea360bb86724ab7d4e37c74390cf96682`, exact head:

| Gate | Result |
| --- | --- |
| unit tier | **2471 tests / 213 files**, 0 failed |
| postbuild tier | **113 tests / 10 files**, 0 failed |
| typecheck | electron + renderer + tests, all clean |
| security scan | `PASS files=1146` |
| architecture ratchet | `violations: []` |
| state probe | pass |
| gate 2 (targeted vs full) | 213 files / 2471 tests, 0 skipped-but-failed, 0 chosen-but-absent, 0 outside catalogue — **the selection and the full gate agree** |
| certificate | **17/17 invariants**, `phaseStatus=COMPLETE`, `notRun=[]`, 227 suites, 0 unowned source files |
| gate8 fixtures | **11/11** |
| test catalogue | current; 0 unowned source files, 0 duplicate obligations, capability coverage **27 of 27** |

**Evidence tier.** As `PF-DEBT-004` states, these are exact-head LOCAL executions recorded at this commit,
verified by re-running them here. They are **not** remote CI, and must not be described as such.

Phase 06 is **PASS**. No waiver was used, the mandatory verification gate was not weakened, no test or
security constraint was relaxed, and no Phase 05 conclusion was rewritten.
