# Phase 08 — Production Qualification and Promotion: status record

> **STATUS: `FOUNDATION_NOT_QUALIFIED`.** The promotion gate is **not** met, and this is an expected
> possible outcome of the phase rather than a failure of the work.
>
> The gate fails on its load-bearing condition: **no external task reached `CONVERGED + SATISFIED`**, and
> it cannot, because the production engineering path refuses every repository supplied before it proposes
> anything. That is recorded as `PF-DEBT-013` and is **not** patched around.
>
> `main` is untouched. No Phase 09 was created. No promotion was performed or attempted.

## 1. Identity

| | |
| --- | --- |
| Phase | `08-production-qualification` |
| Branch | `platform-foundation/08-production-qualification` |
| **BASE_SHA** | `c1752459ab762f16ef4d35a5bfa765b1e7a500a0` (Phase 07 certified FINAL_HEAD) |
| Final head | see §7 |
| `main` | `af8b85c47306b0b992fed1e1cf6eea0f1d652ba5` — untouched |
| Phase 09 | **not created** |
| Verdict | `FOUNDATION_NOT_QUALIFIED` |

## 2. The book is reconstructed, and says so

`Update-Plan/Platform-Foundation/` held Phases 01–07. A repository-wide search for `Phase 08` /
`Phase-08` / `phase-08` returned only unrelated material (the Engine's Phase 8 self-healing work, and the
9-6 research pipeline's Phase 8). There is no original Phase 08 engineering book to recover.

`Phase-08-Production-Qualification-and-Promotion.md` is therefore written as
**`RECONSTRUCTED, NOT AN ORIGINAL`** on its first line, and it is recovered from the Owner's Phase 08
instruction, Phase 07's actual result (a lexical TypeScript/Vitest assertion reader), the carried debts
`PF-DEBT-003` / `PF-DEBT-004`, and the real qualification runs in §4.

## 3. Evidence debt recorded this phase

### `PF-DEBT-012` — the evolution prestart attestation is absent on this workstation

Classified **`EVIDENCE-TIER NOTE`**, after investigating the lifecycle rather than assuming:

- the file is `artifacts/acceptance/prestart-attestation.json`, written by `scripts/acceptance-prestart.cjs`
  and consumed as Validator B input by `scripts/acceptance-evolution-certificate.cjs`;
- `README.md` and `docs/prestart-completion.md` attribute it to `pnpm run acceptance:prestart` **inside a
  successful CI run** on branch `Prestart-checkpoint-3` (artifact id `10298755851`);
- a search of `electron/` and `src/` for `prestart-attestation` / `acceptance:prestart` returns **no
  matches** — no production module reads or writes it, so the normal production startup path does **not**
  owe its generation;
- it is **not** the Platform Foundation platform certificate (`scripts/platform-certificate.cjs` →
  `artifacts/platform-foundation/phase-05/platform-certificate.json`), which passes **17/17,
  `phaseStatus=COMPLETE`, `notRun=[]`** at this head. The two are different artifacts, from different
  generators, for different claims.

Because the production path does not claim the file should exist, it does **not** meet the test for
upgrading to a defect. No artifact was faked to turn `verify:certificate` green.

### `PF-DEBT-003` — re-checked, and its stated blocker is stale

The entry said the host provides no AppContainer. On this host that is **no longer true**:
`WindowsAppContainerSandbox.probe()` returns `available: true`, `mechanism: "windows-appcontainer"`,
`reasons: []`, a real container SID, `jobObject: true`, `suspendedStart: true`, `childProcessBlocked: true`,
`networkDenied: true`, and a launcher built by `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.
Reproducible via `scripts/probe-sandbox-capability.cjs`.

The entry is **not** marked closed and the sandbox requirement is **not** lowered. The slow suite still
fails 11/14 with `sandboxed: false` and its CONTROL still fails, so the failure is now attributable to
something *other* than a missing OS facility — an un-investigated, different problem. Claiming it
"closed by a capable host" from a probe alone would be the over-claim this log exists to prevent. The
entry's wording is corrected in place so the log stops asserting a cause that no longer applies.

## 4. External qualification

### 4.1 The repositories

Supplied by the Owner and cloned into isolated workspaces (`D:\DS-Hns\temp\pf08-external\`). Neither was
created for the purpose, and nothing was scripted.

| Repository | BASE commit | Composition |
| --- | --- | --- |
| `zhiheng-zhang-Mera/Quant-ultra` | `1988d9a8530da91a8158de864d098ea869098923` | 231 tracked files — 154 `.py`, 69 `.pyc`, 6 `.md`, 1 `.rar`, 1 `.yaml`; `Quant-4/Phase_1…Phase_9`; README carries a live backlog |
| `zhiheng-zhang-Mera/drug-simulator` | `23cbe9b8a416bc1023bd3ddf9e3bfd1629e05c9a` | 2 tracked files — `README.md`, `idea-structure.md` |

`Quant-ultra` satisfies "a real project materially larger than a single-file demo". `drug-simulator` is a
design document and cannot carry an engineering task at all; it is reported as such rather than padded.

### 4.2 The runs

Both used the **production path** through a new harness, `scripts/qualify-external-repo.cjs`, which clones
the external repository, removes its remote, sets a local-only git identity, and then does **nothing else**
to help — deliberately, because installing Boss's own toolchain into it would have proven nothing about
external projects. A real provider was configured (`deepseek` / `deepseek-flash`).

| | Quant-ultra | drug-simulator |
| --- | --- | --- |
| Objective | simplify the phase logger to single-line and drop the redundant debug loggers the README lists, without changing computed results | check `README.md` against `idea-structure.md` for contradictions and record them in `CONTRADICTIONS.md`, inventing nothing |
| Provider calls | **0** | **0** |
| Attempts | 0 | 0 |
| Findings | 1 — `environment:typecheck` | 1 — `environment:typecheck` |
| Changed files | none | none |
| Verification | not run | not run |
| Acceptance verdict | **not judged** | **not judged** |
| Final state | `PRECONDITION_FAILED` | `PRECONDITION_FAILED` |
| Owner intervention | none | none |
| Boss checkout | untouched | untouched |

The audit finding is the same for both and names the exact cause:

> the typecheck command could not run: the workspace is missing the tool this command runs —
> `Error: Required local tool unavailable: node_modules/typescript/bin/tsc`

### 4.2.1 Why no goal scope can get past this

The obvious objection is that the objective, not the language, caused the refusal — that a narrower or
documentation-only goal would have run. It would not, and this was tested rather than assumed. The audit
runs the workspace's **typecheck and test commands unconditionally**, whatever the goal's scope
(`electron/engineering/repo-engineering-operations.ts` → `audit()` calls `runAllowedCommand(root,
"typecheck")` and `runAllowedCommand(root, "test")` with no scope argument), and a failing or
environment-classified audit result refuses the run up front.

Each command was then probed directly against Quant-ultra, recorded in `auditCommands` in the evidence:

| Command | Passed | Exit code | What it actually did |
| --- | --- | --- | --- |
| `typecheck` | **false** | `null` (never launched) | `Required local tool unavailable: node_modules/typescript/bin/tsc` |
| `test` | true | 0 | `ℹ tests 0 … pass 0 … fail 0` — Node's built-in runner, which cannot execute `pytest`-style Python files |

So the host has **no way to verify anything** in this repository: the compiler it needs does not exist, and
the runner it falls back to discovers nothing. `exitCode: null` is `runAllowedCommand`'s distinct signal for
"the process never ran", which is why `commandFinding` classifies the typecheck result as
`kind: "environment"` and the goal loop refuses the run as `PRECONDITION_FAILED` — `PF-DEBT-009`'s fix
working exactly as designed (a missing compiler is not reported as a HIGH code defect). That behaviour is
correct; what it means is that **condition 3 cannot be reached on either supplied repository by any
objective**, not merely by the two that were tried.

The zero-test pass is **not** recorded as evidence of anything and is not a Phase 08 finding: the
zero-finding outcome still fails closed conservatively because acceptance is left unjudged. It is reported
here only because it is what the probe observed, and because a "tests passed" line that ran no tests is
exactly the kind of number this Foundation chain refuses to promote.

### 4.2.2 Mutation boundaries: measured, and the answer is "not exercised"

Phase 08 must record *which mutation boundaries were exercised*, so the harness was run twice against
`drug-simulator` with the only difference being the remote:

| Run | Remote | State | Reached a mutation boundary? |
| --- | --- | --- | --- |
| `qualify-drug-simulator.json` | removed | `PRECONDITION_FAILED` | **no** |
| `qualify-drug-simulator-remote-retained.json` | **retained** | `PRECONDITION_FAILED` | **no** |

Both refuse at the audit, before any change is proposed or applied, so **neither the scope guard, the
mutation guard, nor the root-authority guard was exercised on an external repository at all.** That is
recorded as an explicit gap rather than as a pass: the guards are unmodified and their own suites are
green, but this phase did **not** demonstrate them against external code, and a reader must not read
"guards not weakened" as "guards tested externally".

The remote-retained configuration was tried precisely because it is the one that would make an external
repository look most like a mutation target. The fact that it changes nothing is itself the measurement:
the precondition fires first, so the guard question is unreachable from here.

### 4.3 What these runs actually establish

**A genuine failure path is preserved as evidence**, which the book's own qualification protocol requires:
the failure was not deleted or re-run until only green records remained. Both records are kept, including
the fact that the provider was never asked anything.

**Cross-repository generalisation was not falsified, but it was not demonstrated either.** No Boss-specific
assumption was injected: the harness gave the external repositories no Boss artifact layout, no Boss test
catalogue, no Boss scripts and no Boss state namespaces, and the refusal came from the platform's own
toolchain resolution rather than from anything the harness imposed. But a run that stops at the first
check also cannot show that its later stages generalise.

**Phase 07's semantic acceptance layer was therefore never exercised by an external repository.** The
runs never reached it. `PF-DEBT-011`'s closure rests on the Boss/Vitest workload plus the real-provider
case B, and that limit is stated rather than glossed.

### 4.3.1 The reader was pointed at the external repository directly, and fails closed

The runs above never reached the acceptance layer, so "does the reader over-fit Boss/Vitest?" could not be
answered from them. It was answered directly instead, as the book's §5 requires, by running the reader over
the whole external repository (`scripts/qualify-assertion-reader.cjs`, record
`artifacts/platform-foundation/phase-08/assertion-reader-generalisation.json`):

| Measurement | Result |
| --- | --- |
| Tracked source files scanned | 154 (`.py`) |
| Files named like tests | 7 |
| Files with **any** readable assertion site | **0** |
| Files judged **discriminating** | **0** — the required outcome |
| Requirement | *"no file in a non-TypeScript repository may be judged discriminating"* |
| Outcome | **fails closed** |

It fails closed for a narrower reason than "we do not parse Python", and the distinction matters:
`ASSERTION_CALL = /\b(expect|assert|expectTypeOf)\s*\(/g` requires a **call**, and Python's assertion is
the `assert x == y` **statement**, which never matches. `unittest`'s `self.assertEqual(a, b)` is a method
call and `pytest.raises` is a context manager, so neither is an entry point either. The **second** layer is
independent: `judgeGoalAcceptance` selects evidence with `TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/`, so a
`.py` test file is not even a candidate, and a change adding only `tests/test_x.py` is refused as
`INSUFFICIENT_EVIDENCE` before the reader is consulted.

Both layers are now pinned by permanent tests in `tests/unit/platform/acceptance.test.ts` — a realistic
Python fixture (`assert` statements, `unittest` methods, `pytest.raises`) must yield **0 assertion sites and
0 discriminating**, and the `TEST_FILE` pattern must reject `.py`/`_test.go` names. That converts a
one-off measurement into a property that cannot silently regress, which is what §5 asks for and what a
probe alone would not have given.

**No language support was invented to make these pass.** `PF-DEBT-013` records why, and records that
widening the mandatory verification to accommodate an external repository would weaken a safety condition
the Foundation chain exists to protect.

## 5. The promotion gate

| # | Condition | Result |
| --- | --- | --- |
| 1 | Phase 01–07 inherited contracts intact | **MET** — contract tests and the inherited gate list pass at this head (§6) |
| 2 | ≥ two real external repositories qualified | **NOT MET** — two repositories were *run* in three configurations (5 records), but none qualified; every one was refused at the audit before any work was proposed |
| 3 | ≥ one real external task reached `CONVERGED + SATISFIED` | **NOT MET** — the load-bearing condition. Zero external tasks reached verification, let alone acceptance |
| 4 | Semantic acceptance not bypassed | **NOT TESTABLE EXTERNALLY** — no external run reached it; nothing was bypassed, but nothing was exercised either |
| 5 | Mandatory verification not weakened | **MET** — the check list is unchanged; no toolchain requirement was relaxed for an external repository. The audit's own commands were *probed* to attribute the refusal, never altered |
| 6 | Mutation / root / scope guards not weakened | **MET as "unmodified and their suites green", NOT MET as "tested externally"** — §4.2.2 records that no external run reached a mutation boundary |
| 7 | Real provider usage provenance preserved | **MET** — the harness records provider-reported counts only; both runs made zero calls, recorded as zero, not as unmeasured success |
| 8 | Known failures recorded, not hidden | **MET** — `PF-DEBT-012` and `PF-DEBT-013` recorded, `PF-DEBT-003` re-stated, both external refusals preserved |
| 9 | Capability coverage not regressed | **MET** — 27 of 27, 0 unowned source files |
| 10 | Full exact-head regression PASS | **MET** — §6 |
| 11 | Platform certificate `COMPLETE` | **MET** — 17/17 invariants, `notRun: []` |
| 12 | Known-issues log current | **MET** — review-log row added for this phase |

**Verdict: `FOUNDATION_NOT_QUALIFIED`.** Conditions 2, 3 and 4 are unmet, and condition 3 cannot be met
with the repositories supplied — not for the objectives that were tried, and not for any other objective
either (§4.2.1: the audit's typecheck command fails before the goal is consulted). Reporting
`FOUNDATION_READY_FOR_PROMOTION` here would require either qualifying two refusals as qualification or
faking an external `CONVERGED` — both are the fraud this Foundation chain was built to make impossible.

## 6. Inherited regression at the final head

Every gate below ran at `274f565da414033d62b5e26cd79f6eb642e1dfcd`, on a clean tree, in this session.

| Gate | Result |
| --- | --- |
| unit tier (`pnpm run test`) | **2519 tests / 215 files**, 0 failed |
| postbuild tier (`pnpm run test:postbuild`) | **113 tests / 10 files**, 0 failed |
| typecheck (electron, renderer, tests) | clean |
| security scan | `TRACKED_SECRET_SCAN=PASS files=1161` |
| architecture ratchet | `violations: []` |
| state probe | pass; migration report `promotionPhase: migrated`, `crashWindowRepaired: true` |
| platform certificate | **17/17 invariants**, `phaseStatus=COMPLETE`, `notRun=[]`, 229 suites, 0 unowned source files, permission 9/9 escapes refused, 0 wildcard grants |
| test catalogue / ownership audit | current, 229 suites; 0 unowned source files, 0 duplicate obligations |
| targeted-vs-full agreement | 215 files / 2519 tests, 0 skipped-but-failed, 0 chosen-but-absent, 0 outside catalogue — **the selection and the full gate agree** |
| Gate 8 inherited checks | fixtures **11/11**; the pair remains `real-provider` `COST_ONLY` |
| Phase 07 semantic acceptance regression | **69 tests across 4 suites** (acceptance, goal-acceptance, goal-loop, provider-models), including the two new cross-language fail-closed guards — counterexamples A / B(scripted + real provider) / C(boundary) / D all re-verified |
| external qualification verification | §4 — 2 runs, both `PRECONDITION_FAILED`, both preserved; plus the direct reader probe in §4.3.1 |

Three guards caught this phase's own new files and had to be satisfied rather than bypassed:
`comment-citation` rejected a bare section reference in **both** new harnesses (fixed by naming the tracked
document in each) and the Phase 07 status wording was de-cited rather than baselined. The baseline
(`tests/fixtures/comment-citation-baseline.json`) was **not** raised.

**Evidence tier.** As `PF-DEBT-004` states, these are exact-head **local** executions, not remote CI, and
must not be described as such.

One inherited script reports `INVALID_CERTIFICATE` off-CI — `pnpm run verify:certificate` (the *evolution*
prestart attestation, `PF-DEBT-012`). It is **not** a Phase 08 gate and is **not** the platform
certificate, which passes 17/17 here.

## 7. Final head and gate record

**FINAL_SHA = the tip of `platform-foundation/08-production-qualification`.** Its parent is BASE_SHA
`c1752459ab762f16ef4d35a5bfa765b1e7a500a0`, and it carries all of Phase 08: the reconstructed book, this
status record, `PF-DEBT-012` / `PF-DEBT-013`, `scripts/qualify-external-repo.cjs` and
`scripts/probe-sandbox-capability.cjs`.

The hash is reported to the Owner rather than written here, deliberately. Naming a commit inside the commit
that creates it is self-defeating — every correction of the name produces a new hash — and three
intermediate hashes were superseded by `git commit --amend` for exactly that reason while the gate numbers
in §6 were being filled in. A reader who meets an unreachable hash in a log should take it as that
amend cycle, not as a missing commit: `git log --oneline platform-foundation/08-production-qualification`
shows one commit on top of `c175245`, and `git show --stat HEAD` lists the files above.

The §6 gate table ran at this head, before this record was written into it. The only edits after the gate
run were the `comment-citation` fix in the harness, the per-command audit probe, and this document.

Verdict: **`FOUNDATION_NOT_QUALIFIED`** (§5). `main` untouched at
`af8b85c47306b0b992fed1e1cf6eea0f1d652ba5`. Phase 09 not created.

## 8. What the Owner should decide

The Foundation is **not** ready for promotion on the evidence in §4. The decision this phase produces is
therefore not "promote / do not promote" but **which of these the Owner wants**:

1. **Supply a TypeScript/JavaScript external repository** (a real one, not a toy) and re-run the
   qualification. The production path is built for that workload; this is the shortest honest route to a
   met condition 3.
2. **Commission language/toolchain adapters as its own phase** (`PF-DEBT-013`), if external-language
   support is the actual goal. That is a design exercise, not a patch, and it is where the semantic
   acceptance reader would need per-language declarations that fail closed.
3. **Accept `FOUNDATION_NOT_QUALIFIED` and end Foundation construction here**, on the grounds that the
   platform qualifies for the workload it was built for and that no further phase is justified without a
   real external consumer that needs one.

No option is chosen on the Owner's behalf, and `main` is untouched.
