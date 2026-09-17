# Phase 07 — Semantic Acceptance: status record

> **STATUS: IN PROGRESS — this phase is NOT complete and must not be reported as PASS.**
>
> The book is reconstructed, the acceptance contract is built and unit-tested, `CONVERGED` now requires
> the objective to be satisfied, and Task D's counterexample cases pass **at the model level**. What is
> outstanding is running those cases through the **real dogfooding harness** (Task D's actual requirement)
> and the full inherited regression at a final head.
>
> Phase 06 remains sealed and PASS. No inherited contract has been weakened.

## 1. Identity

| | |
| --- | --- |
| Phase | `07-semantic-acceptance` |
| Branch | `platform-foundation/07-semantic-acceptance` |
| **BASE_SHA** | `e135f8c54fbe9dcc448c2d8f05611d344d7291a4` (Phase 06 certified FINAL_HEAD) |
| Head so far | `54508aa56ead9000805b836351b5c86efeb044b2` |
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
| A — the acceptance contract | **delivered** | `src/shared/acceptance.ts`; 22 tests |
| B — deterministic assertion-shape reading | **delivered** | `src/shared/assertion-shape.ts`; same suite |
| C — `CONVERGED` semantics | **delivered** | `electron/engineering/engineering-goal-loop.ts`; 5 new loop tests |
| D — counterexample dogfooding | **A proven end to end; B is a false negative; C structural** | `case-A-vacuous.json`; `tests/unit/engineering/goal-acceptance.test.ts`; 10 tests |
| E — inherited regression at final head | **not run** | per-batch gate green |

### Case A, proven through the real pipeline

The scripted vacuous proposal — the exact Phase 06 shape, its round-trip case binding an empty array —
produced:

```
status       OBJECTIVE_INSUFFICIENT_EVIDENCE
checks       typecheck PASS, test PASS, diff PASS
changedFiles tests/unit/intervention-file-properties.test.ts
acceptance   INSUFFICIENT_EVIDENCE
isolation    checkoutUntouched = true
```

Every check passed and the change was applied, and the run still did not converge. That is the phase's
mandated regression, demonstrated rather than asserted. `scripts/fixtures/phase07-case-A-vacuous.json`
makes it reproducible: a counterexample that only reproduces when a model happens to write it is not a
regression test, so the harness gained `--scripted` to fix the proposal while leaving everything else real.

Getting there fixed the acceptance model three times, each a false positive that would have accepted the
vacuous case: it judged the **file** rather than each case (so one case's fixture vouched for another's
empty one); it counted a non-empty literal **anywhere**, including an assertion's expected value; and it
accepted a bare identifier without checking what it holds.

### Case B is a FALSE NEGATIVE, and that is why the phase is not PASS

A meaningful proposal through the same real pipeline produced genuinely good evidence — a populated
two-element fixture, and an assertion echoing the input inside the expected object:

```ts
const interventions = [ { id: "intervention-1", … }, { id: "intervention-2", … } ];
expect(parsed).toEqual({ status: "ok", interventions });
```

The judgement returned `INSUFFICIENT_EVIDENCE` anyway:

> compares a value derived from the result against a literal and never references the input

So the reader is now **too strict where it was too loose**: `referencesInput` looks for a known binding
name in the matcher operand text and is not recognising `{ status: "ok", interventions }`.

This asymmetry is the honest state of the work. **A model that refuses everything is not a solution to
`PF-DEBT-011`** — it would fail real work instead of accepting the vacuous version of it. Fixing this
direction is the next concrete step.

### Case C is structural, and stated rather than faked

`CONTRADICTED` arises from a **discriminating failure**, and in the loop that is the host's verification —
which runs *before* acceptance. A failing check is therefore reported as `NOT_CONVERGED`, and the
acceptance judgement is never reached. `OBJECTIVE_CONTRADICTED` is reachable when a caller's acceptance
model observes the contradiction directly, which is exactly what `engineering-goal-loop.test.ts` asserts
(green checks, non-empty change, `CONTRADICTED` verdict → `OBJECTIVE_CONTRADICTED`). It is stated here
because it is a real property of the design, not a gap to be papered over.

## 4. What the phase actually establishes so far

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

### The reader, and four wrong answers worth recording

Getting the assertion reader right took four attempts, each a confident **false positive** that would have
let the vacuous case through. They are documented in `assertion-shape.ts` because the next person to touch
this will be tempted by the same shortcuts:

1. an internal `JSON.stringify(...)` counted as the input;
2. the **result** binding counted as an input — circular, since `expect(result)` then always looks like it
   exercises something;
3. an assertion's **expected-value literal** counted as an input;
4. a named-import call mistaken for a method call.

The precise question needs to know which call is the function under test and which bindings are inputs
rather than results, and a lexical reader cannot answer it. So it answers what it CAN answer reliably and
conservatively: does the file supply a non-empty literal that is not part of an assertion's expectation,
read from the **case bodies only** — a suite's description string says what the author intended, not what
the test supplies.

## 5. Task D at the model level

| Case | Construction | Verdict |
| --- | --- | --- |
| **A** vacuous green | the real Phase 06 test, reduced to its decisive lines | `INSUFFICIENT_EVIDENCE` |
| **B** meaningful | a representative non-empty value echoed back | `SATISFIED` |
| **C** contradiction | a discriminating failure (the host's checks) | `CONTRADICTED` — loop reports `OBJECTIVE_CONTRADICTED` |
| **D** no evidence | a source-only change / an unreadable test / an empty change | `INSUFFICIENT_EVIDENCE` |

Plus the two directions that keep the model honest: twenty vacuous assertions are still vacuous (the count
is recorded and changes nothing), and one discriminating case among weak ones is accepted, so it is not a
machine that refuses everything.

## 6. What remains before Phase 07 can be called PASS

1. **Wire the dogfooding harness to the acceptance model** — `scripts/dogfood-engineering.cjs` still drives
   the goal loop's operations, and the acceptance operation must be supplied there (the default is
   production `judgeGoalAcceptance`, so this is a wiring and evidence-capture task).
2. **Run cases A / B / C / D through the REAL harness** — Task D's actual requirement. The book is explicit
   that A / C / D are the core: an implementation that only says `SATISFIED` for good evidence has not
   closed `PF-DEBT-011`.
3. **Only then** update `PF-DEBT-011` to `FIXED`, with the real-run evidence cited.
4. **Phase 07 evidence + certificate-lineage** under `artifacts/platform-foundation/phase-07/`.
5. **Task E** — the full inherited regression at the final exact head.

Until then the phase is IN PROGRESS. No waiver, no weakened test, no Phase 05 or Phase 06 conclusion
rewritten.

## 7. Inherited regression at `10fb071`

unit **2508 tests / 215 files** · typecheck (electron, renderer, tests) · security scan (1152 files) ·
architecture ratchet `violations: []` · state probe · 0 unowned source files · 0 duplicate obligations ·
capability coverage **27 of 27**.

Phase 06 contracts re-verified: the mandatory gate is still refused as an economics candidate **by kind**;
the Gate 8 pair is still `real-provider` `COST_ONLY`; records are still `executed-trace`; the goal loop
still records pre-existing findings without working them; the mutation/scope/root-authority guards are
untouched.
