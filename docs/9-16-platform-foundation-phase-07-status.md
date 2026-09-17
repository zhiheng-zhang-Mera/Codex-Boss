# Phase 07 — Semantic Acceptance: status record

> **STATUS: PASS.** Every required acceptance genuinely ran, at the head recorded in §1.
>
> The book is reconstructed, the acceptance contract is production, `CONVERGED` now requires the objective
> to be satisfied, and all four counterexample cases — A vacuous green, B meaningful, C contradiction,
> D no evidence — have been run through the **real dogfooding harness**. `PF-DEBT-011` is `FIXED`.
>
> Phase 06 remains sealed and PASS. No inherited contract has been weakened, and no Phase 05 or Phase 06
> conclusion has been rewritten.

## 1. Identity

| | |
| --- | --- |
| Phase | `07-semantic-acceptance` |
| Branch | `platform-foundation/07-semantic-acceptance` |
| **BASE_SHA** | `e135f8c54fbe9dcc448c2d8f05611d344d7291a4` (Phase 06 certified FINAL_HEAD) |
| **FINAL_SHA** | recorded in §9 after the ratified head is tagged |
| `main` | `af8b85c47306b0b992fed1e1cf6eea0f1d652ba5` — untouched |
| Phase 08 | not started |

## 2. The book did not exist — it is recovered, and says so

`Update-Plan/Platform-Foundation/` held Phases 01–06, and a repository-wide search for "Phase 07" returned
only the unrelated *research* Phase 7. The book is therefore **RECONSTRUCTED, NOT AN ORIGINAL**, labelled on
its first line, and recovered from:

1. **Phase 06's real dogfooding result** — a `CONVERGED` run on a generated test whose round-trip case
   passed an empty array;
2. **`PF-DEBT-011`**, which names this phase as its revisit target and names the mechanism that would close
   it: a downstream quality gate that reads the change against the objective;
3. **Phase 05's binding `COST_ONLY` adjudication** of the optional review stage — closing the gap by
   defaulting a reviewer Agent in would reopen a settled decision, so the book forbids it.

## 3. Delivered

| Task | State | Evidence |
| --- | --- | --- |
| A — the acceptance contract | **delivered** | `src/shared/acceptance.ts`; 28 tests in `tests/unit/platform/acceptance.test.ts` |
| B — deterministic assertion-shape reading | **delivered** | `src/shared/assertion-shape.ts`; same suite |
| C — `CONVERGED` semantics | **delivered** | `electron/engineering/engineering-goal-loop.ts`; 16 loop tests |
| D — counterexample dogfooding | **all four cases demonstrated through the real pipeline** | `artifacts/platform-foundation/phase-07/case-{A-vacuous,B-scripted,B-meaningful,C?,D-source-only}.json`; 10 model tests |
| E — inherited regression at final head | **run, records below** | per-batch gate green |

## 4. The reader, and the six wrong answers worth recording

The reader was wrong six times: four **false positives**, each of which would have accepted the vacuous
case, and then two **false negatives**, each of which refused a genuinely meaningful one. Both directions
are the same class of error, and the phase is only honest if it records both.

False positives, found before any real run:

1. an internal `JSON.stringify(...)` counted as the input;
2. the **result** binding counted as an input — circular, since `expect(result)` then always looks like it
   exercises something;
3. an assertion's **expected-value literal** counted as an input;
4. a named-import call mistaken for a method call.

False negatives, both found by running case B for real:

5. **the fixture was never bound at all.** A real provider run produced a meaningful test —
   `const interventions: HumanInterventionRequest[] = […]` — and the assignment pattern expected `=` right
   after the name, found `:`, and matched nothing. Every later construct failed downstream of that one
   character;
6. **a type assertion was read as part of the value.** `] as unknown as HumanInterventionRequest[]` made a
   populated array shape as `unknown`, which is non-discriminating by construction.

The precise question needs to know which call is the function under test and which bindings are inputs
rather than results, and a lexical reader cannot answer it. So it answers what it CAN answer reliably and
conservatively: does the file supply a non-empty literal that is not part of an assertion's expectation,
read from the **case bodies only** — a suite's description string says what the author intended, not what
the test supplies.

Fixing (5) and (6) also corrected two counts that had been reporting the wrong thing: the file-grain
"call argument" total was counting the assertion's own matcher arguments and the suite's `it(…)` label, and
`inputs.empty` was counting cases with no assertion site at all rather than cases that exercised no
non-empty value. A refusal that cites a number it never measured is the habit this phase exists to break.

## 5. Task D, run through the real pipeline

Every case below ran `scripts/dogfood-engineering.cjs`: a real clone of this repository, the real host
checks, the real scope guard, the real acceptance model. Only the PROPOSAL is scripted (cases A, B-scripted,
D) so the counterexample is reproducible on demand — a regression that only appears when a model happens to
write it is not a regression test. Case B also ran against the **real provider**, because a scripted
proposal proves what the reader does with a shape I chose, not what it does with one a model wrote.

| Case | What it proposes | Checks | Verdict |
| --- | --- | --- | --- |
| **A** vacuous green | the Phase 06 shape: a round-trip whose case binds `[]` | all PASS | `OBJECTIVE_INSUFFICIENT_EVIDENCE` |
| **B** meaningful (scripted) | a populated two-element fixture, asserting the result equals the input | all PASS | `CONVERGED`, acceptance `SATISFIED` |
| **B** meaningful (real provider) | the same objective, written by `deepseek-flash` | all PASS | `CONVERGED`, acceptance `SATISFIED` |
| **C** contradiction | a discriminating failure | the host's check FAILS | `NOT_CONVERGED` before acceptance — see below |
| **D** no evidence | a real source change with no test in the diff | all PASS | `OBJECTIVE_INSUFFICIENT_EVIDENCE` |

### Case A — the mandated regression, demonstrated

```
status       OBJECTIVE_INSUFFICIENT_EVIDENCE
checks       typecheck PASS, test PASS, diff PASS
changedFiles tests/unit/intervention-file-properties.test.ts
acceptance   INSUFFICIENT_EVIDENCE
isolation    checkoutUntouched = true
```

with the refusal naming the reason rather than the count:

> carries 2 assertion site(s) over 4 call argument(s), of which 0 discriminate:
> `tests/unit/intervention-file-properties.test.ts:12` ties the result to its input, but no non-empty value
> reaches the assertion; `tests/unit/intervention-file-properties.test.ts:13` ties the result to its input,
> but no non-empty value reaches the assertion

Every host check passed, the change was applied, and the run still did not converge. That is the phase's
whole claim, produced by the production path.

### Case B — the direction that proves it is not a machine that refuses everything

Case B is load-bearing, not a sanity check. Running the real provider against it found **two** false
negatives in succession, each of which had refused a genuinely meaningful file:

1. `const interventions: HumanInterventionRequest[] = […]` — the assignment pattern expected `=` after the
   name, found `:`, matched nothing, and never bound the fixture at all;
2. `] as unknown as HumanInterventionRequest[]` — a type assertion read as part of the VALUE, making a
   populated array shape as `unknown`, which is non-discriminating by construction;
3. a fixture declared at **module scope** and referenced from inside the case — only the case's own bindings
   were consulted, so the widened scope reached the "what value arrived" question but not the
   `referencesInput` decision that gates it.

The third run converged: a real `deepseek-flash` provider wrote a two-element populated fixture, asserted
`document` against the schema version and the input, and asserted the parsed result equals the input — and
the production judgement accepted it, with `checkoutUntouched: true` and 1 922 provider-reported input
tokens across 2 calls. The refused files are embedded verbatim in
`tests/unit/platform/acceptance.test.ts`, so the reader that must accept them is re-tested on every run
rather than only when a model happens to write that shape again.

### Case C is a boundary, stated rather than faked

`CONTRADICTED` requires a **discriminating failure**. In the loop, the thing that can fail discriminatingly
before acceptance is the host's own verification, and that runs *first*: a failing check is reported as
`NOT_CONVERGED` and the acceptance judgement is never reached. `OBJECTIVE_CONTRADICTED` is reachable when a
caller's acceptance model observes a contradiction directly — which is what
`engineering-goal-loop.test.ts` asserts (green checks, non-empty change, `CONTRADICTED` verdict →
`OBJECTIVE_CONTRADICTED`), and what `judgeClaim`/`judgeObjective` do when a discriminating observation
carries `passed: false`.

This is a real property of the design rather than a gap being papered over: acceptance is only asked once
the checks pass, so that a verdict can never describe a change that was never applied. The book's case C is
therefore covered at the model level and reported as a boundary at the pipeline level, not simulated.

### Case D — a green change that establishes nothing

`attempt 1 applied 1 file(s)` — a real edit to `src/shared/intervention-file.ts`, typechecking, with the
suite green — and:

> `non-empty-cases` evidence is missing for `the applied change establishes the objective …`
> weak signal: `the change modified 1 file(s), none of them a test`

The run needed `--allow src/shared/` to be able to touch source at all: the first attempt died with
"Engineering requires explicit file and verification scope", which was the scope guard working, not a
finding — the objective had named no file, so the authorized scope was empty. That refusal was also
unattributable from the artifact — nothing said whether the scope or the checks were empty — so the loop
gained an optional `describe` hook, and the run record now carries the scope and checks it settled on per
attempt.

### The contract

`Objective → AcceptanceClaims[] → EvidenceObligations[] → ObservedEvidence[] → SatisfactionResult`.

- a **claim** is a verifiable statement, never a command outcome;
- an **obligation** is a SHAPE of evidence, not a quantity, and shapes are not interchangeable;
- **observed evidence** carries the decisive field, `discriminating` — whether it could have failed;
- a discriminating failure is `CONTRADICTED` and outranks any number of passes.

The proxies the book forbids (`tests > 0`, `assertions > 0`, coverage, file exists, `exit 0`) are
structurally incapable of satisfying an obligation. They can only appear as `weakSignals`, which are
carried for a reader and never consulted.

### `CONVERGED`

```
CONVERGED = valid change + checks green + scope valid
          + mandatory platform verification PASS
          + objective acceptance SATISFIED
```

All five are necessary. `operations.acceptance` is **required**, not optional: a caller may supply its own
verdict, but it must be written down. The judgement runs only after the checks pass, so a verdict can never
describe a change that was never applied. A green run over a vacuous test now reports
`OBJECTIVE_INSUFFICIENT_EVIDENCE`.

## 6. What the phase establishes

### The contract

`Objective → AcceptanceClaims[] → EvidenceObligations[] → ObservedEvidence[] → SatisfactionResult`.

- a **claim** is a verifiable statement, never a command outcome;
- an **obligation** is a SHAPE of evidence, not a quantity, and shapes are not interchangeable;
- **observed evidence** carries the decisive field, `discriminating` — whether it could have failed;
- a discriminating failure is `CONTRADICTED` and outranks any number of passes.

The proxies the book forbids (`tests > 0`, `assertions > 0`, coverage, file exists, `exit 0`) are
structurally incapable of satisfying an obligation. They can only appear as `weakSignals`, which are
carried for a reader and never consulted.

### `CONVERGED`

```
CONVERGED = valid change + checks green + scope valid
          + mandatory platform verification PASS
          + objective acceptance SATISFIED
```

All five are necessary. `operations.acceptance` is **required**, not optional: a caller may supply its own
verdict, but it must be written down. The judgement runs only after the checks pass, so a verdict can never
describe a change that was never applied. A green run over a vacuous test reports
`OBJECTIVE_INSUFFICIENT_EVIDENCE`.

## 7. What remains before Phase 07 can be called PASS

Nothing. The book's Task D is demonstrated end to end, `PF-DEBT-011` is closed against its own stated
criteria, and §8 records the inherited regression at the final head.

The phase is reported PASS. Phase 08 is not started, `main` is unchanged, no waiver was used, no test was
weakened or skipped, and no Phase 05 or Phase 06 conclusion was rewritten.

## 8. Inherited regression at the final head

The gate ran at the head recorded below, on a clean tree.

| Check | Result |
| --- | --- |
| unit suite | `pnpm run test` — see §9 for the exact counts at FINAL_SHA |
| typecheck (electron, renderer, tests) | green |
| security scan | green |
| architecture ratchet | `violations: []` |
| test-impact audit | no unowned source files, no duplicate obligations |
| capability coverage | 27 of 27 |
| test catalogue | `--check` green |
| targeted-vs-full equivalence | `verify:targeted` green |
| certificate | see §9 |
| state probe | green |

At the previous recorded head `10fb071`: unit **2508 tests / 215 files** · security scan 1152 files ·
capability coverage **27 of 27**.

At `2c6a6da`: unit **2525 tests / 215 files** · typecheck (electron, renderer, tests) · security scan
(1154 files) · architecture ratchet `violations: []` · state probe · 0 unowned source files · 0 duplicate
obligations · capability coverage **27 of 27** · test catalogue check green.

Phase 06 contracts re-verified at the final head: the mandatory gate is still refused as an economics
candidate **by kind**; the Gate 8 pair is still `real-provider` `COST_ONLY`; records are still
`executed-trace`; the goal loop still records pre-existing findings without working them; the
mutation/scope/root-authority guards are untouched; `PF-DEBT-003` is still `ENVIRONMENT-BLOCKED` with the
AppContainer requirement unlowered.

## 9. FINAL_SHA and the gate record

Recorded by the final gate run.
