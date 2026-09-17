# Phase 08 — Production Qualification and Promotion

`RECONSTRUCTED, NOT AN ORIGINAL`

This document is a **reconstruction**. `Update-Plan/Platform-Foundation/` held Phases 01–07 and no
`Phase-08*` book of any kind; a repository-wide search for "Phase 08" / "Phase-08" returns only unrelated
engineering material (the Engine's Phase 8 self-healing work in `docs/checkpoint-10-self-healing.md`, and
the 9-6 research pipeline's Phase 8 in `docs/9-6-research-phase8-levelb.md`). Nothing in this file is
recovered from a lost original, and it must not be presented as one.

What it *is* recovered from:

1. **the Owner's Phase 08 instruction** (`Phase 08 目标`, given directly, with eleven numbered sections);
2. **Phase 07's actual result** — a semantic acceptance path that is production, and the finding that its
   assertion reader is a **lexical reader for TypeScript/Vitest syntax**;
3. **`PF-DEBT-003` and `PF-DEBT-004`**, the two carried-forward debts, plus `PF-DEBT-012` recorded here;
4. **real qualification runs against two external Owner repositories**, whose outcomes are in §4 and whose
   records are the authority for every claim below.

Where this document states a target that the data does not yet support, it says so in place. Where the
Owner's instruction and the real data disagree, the data is recorded and the disagreement is named.

---

## 1. The question this phase answers

Not *"what else should the platform do?"* but:

> Is the current Platform Foundation reliable enough to be used on **real external code projects**, and is
> it ready to be promoted out of the long-lived Foundation branch chain onto the mainline?

Phase 08 therefore adds **no new platform abstraction layer by default**. It qualifies, it measures, and it
decides. A new module is justified only by a defect that real external dogfooding actually exposes.

## 2. Boundary and authority

| | |
| --- | --- |
| Branch | `platform-foundation/08-production-qualification` |
| BASE_SHA | `c1752459ab762f16ef4d35a5bfa765b1e7a500a0` (Phase 07 certified FINAL_HEAD) |
| `main` | `af8b85c47306b0b992fed1e1cf6eea0f1d652ba5` — **must not be modified by this phase** |
| Phase 09 | not to be created. This phase exists to *end* Foundation construction, not to extend it. |
| Promotion | requires an explicit Owner decision. Reaching the gate is reported, never performed. |

The long-lived branch set this phase must keep intact: Phases 01–07 contracts, all sealed, each built on
the previous phase's FINAL_HEAD.

## 3. Inherited contracts that must not be weakened

Every Phase 01–07 contract stays exactly as certified. In particular, at the Phase 08 head:

- the **mandatory platform verification gate** (`intake`, `verify`, `finalize`) remains distinct from the
  optional Agent stages and remains refused as an economics candidate **by kind**;
- **Gate 8** stays `real-provider` `COST_ONLY`; Phase 05's adjudication is not reopened, and no reviewer
  Agent is added to the default pipeline;
- **`CONVERGED`** requires valid change + checks green + scope valid + mandatory platform verification PASS
  + objective acceptance `SATISFIED` (Phase 07);
- the **mutation / root-authority / scope guards** are not relaxed;
- **provider token provenance** stays the provider's own counts; `ceil(chars/4)` estimates are never
  promoted to measurements;
- `executedStages` remains the authoritative stage provenance.

A qualification run that cannot satisfy any of these must report the refusal, not route around it.

## 4. External qualification protocol

### 4.1 Which repositories

At least **two real, non-Codex-Boss** repositories. Not created for the purpose, not toy repos. The Owner
supplied two, and both were cloned into isolated workspaces under `D:\DS-Hns\temp\pf08-external\`:

| Repository | BASE commit | Composition | Nature |
| --- | --- | --- | --- |
| `zhiheng-zhang-Mera/Quant-ultra` | `1988d9a8530da91a8158de864d098ea869098923` | 231 tracked files: 154 `.py`, 69 `.pyc`, 6 `.md`; `Quant-4/Phase_1…Phase_9`, `Main`; README carries a live "On hold / to add logic" backlog | A real multi-phase Python engineering project of substantial size. **No** `package.json`, `node_modules`, `tsconfig.json`, `requirements.txt` or `pyproject.toml` |
| `zhiheng-zhang-Mera/drug-simulator` | `23cbe9b8a416bc1023bd3ddf9e3bfd1629e05c9a` | 2 tracked files: `README.md`, `idea-structure.md` | A design document, not code. Cannot carry an engineering task |

This pair satisfies the letter of "two repositories" and the spirit of "at least one substantially larger
than a single-file demo" (Quant-ultra). It does **not** satisfy the requirement that the qualification be
meaningful for the path being qualified, and §4.4 states why.

### 4.2 What each run must record

For every task, per repository:

- repository identity and **BASE commit**;
- the **objective**, drawn from that repository's own backlog / TODO / observable defect — never invented;
- the **acceptance claims** and **evidence obligations** the platform derived;
- **modified files**, and the final diff;
- **provider / model**, and the provider's **real token usage**;
- **attempts**, **pre-existing failures**, and the **final verification** result;
- the **semantic acceptance verdict**;
- **isolation**: whether the checkout was untouched, and which mutation boundaries were exercised;
- whether **Owner intervention** was required.

### 4.3 What must be proven

- **Cross-repository generalisation.** No Boss-specific assumption may leak into an external project. An
  external repository must not be required to have Boss's artifact layout, Boss's test catalogue, Boss's
  scripts, or Boss's state namespaces — unless a **capability adapter** supplies them explicitly.
- **Failure paths are evidence.** At least one genuine failure or refusal must be preserved: insufficient
  objective evidence, a refused scope, an unavailable environment dependency, a pre-existing failure, a
  provider transport failure, or a task that genuinely cannot converge. Re-running until only green
  records remain destroys the evidence.
- **No fabricated acceptance.** Scripted proposals are forbidden in this phase. A real provider writes the
  change.

### 4.4 The known structural limit, stated up front

The Foundation's production engineering path is **TypeScript/JavaScript specific**, by construction and
not by accident:

- `electron/engineering/verification-policy.ts` → `requiredEngineeringChecks` emits a `syntax` check only
  for `/\.[cm]?js$/` files, a `typecheck` check only when the workspace has a `tsconfig.json`, and a `test`
  check built from `node_modules/vitest/vitest.mjs` or Node's `--test`;
- `electron/engineering/command-runner.ts` → `runAllowedCommand` resolves the local toolchain by absolute
  path (`node_modules/typescript/bin/tsc`, `node_modules/vitest/vitest.mjs`, `node_modules/eslint/bin/eslint.js`)
  and returns a **recorded failure** (`Required local tool unavailable: …`) when it is absent — never a
  silent pass;
- `electron/engineering/gate-runner.ts` similarly requires `tsconfig.json`, a local TypeScript toolchain,
  and discovered test files.

Neither supplied repository provides any of those. Consequently, on this pair, the host's **mandatory
verification cannot be satisfied at all**: the run must fail closed before acceptance is even consulted.
That is the correct behaviour, and it is a **qualification result**, not a bug to be patched by widening
the checks.

**The phase must not solve this by inventing language support.** §5 governs what may be done.

## 5. The generalisation boundary of semantic acceptance

Phase 07's assertion reader (`src/shared/assertion-shape.ts`) is a **lexical reader for TypeScript/Vitest
syntax** — `expect(…)`, `assert(…)`, `expectTypeOf(…)`, `it`/`test`/`describe`. It has been proven against
that workload and nothing else.

Binding rules for this phase:

1. **It must not pretend to cover other languages or frameworks.** An external project whose syntax the
   reader does not understand must **fail closed** (`INSUFFICIENT_EVIDENCE`), or be served by an explicit
   **adapter** that states what it reads.
2. **Forbidden:** `unknown syntax → assume discriminating`. An unreadable assertion is not evidence.
3. **Over-fitting, if found in a real project, becomes a known issue** in
   `docs/platform-foundation-known-issues.md`, fixed only to the **minimal** extent the real exposure
   proves. A "parser for every language in the world" built in advance is explicitly out of scope: it would
   be unverifiable speculation of exactly the kind this Foundation chain exists to refuse.
4. Any adapter added must be **declared**, **tested**, and **fail-closed when it cannot read the input**.

The honest expected outcome, given §4.4: the semantic acceptance layer will **not** be exercised on these
two repositories, because the runs cannot reach it. That is recorded rather than worked around.

## 6. The Foundation Promotion Gate

Promotion of the Foundation chain onto the mainline is permitted **only** when all of the following hold.
Each is a checklist item that must be *demonstrated with a record*, not asserted:

| # | Condition | How it is demonstrated |
| --- | --- | --- |
| 1 | Phase 01–07 inherited contracts intact | `docs/9-16-platform-foundation-phase-0{1..7}-status.md`; contract tests green at the phase 08 head |
| 2 | ≥ **two** real external repositories qualified | §4.2 records for both, with BASE commits |
| 3 | ≥ **one** real external task reached `CONVERGED` **+** `SATISFIED` | a run record with a non-empty diff, passing verification and a `SATISFIED` acceptance verdict |
| 4 | Semantic acceptance not bypassed | the run reached the acceptance operation through the production path; no scripted proposal; no manual verdict |
| 5 | Mandatory verification not weakened | the check list at the phase 08 head is not a subset of Phase 07's; no `tsconfig`/vitest requirement relaxed to accommodate an external repo |
| 6 | Mutation / root / scope guards not weakened | guard tests green and unmodified |
| 7 | Real provider usage provenance preserved | run records carry provider-reported token counts |
| 8 | Known failures recorded, not hidden | `docs/platform-foundation-known-issues.md` current, including re-triage of `PF-DEBT-003` and `PF-DEBT-012` |
| 9 | Capability coverage not regressed | 27 of 27, 0 unowned source files |
| 10 | Full exact-head regression PASS | unit, postbuild, typecheck, security scan, ratchet, state probe, catalogue/ownership, targeted-vs-full |
| 11 | Platform certificate `COMPLETE` | `notRun: []`, all invariants held |
| 12 | Known-issues log current | review log row for this phase |

**Condition 3 is the load-bearing one.** The Owner's instruction names it separately for a reason: without
at least one genuine external `CONVERGED + SATISFIED`, "≥ two repositories qualified" can be satisfied by
two recorded *refusals*, which is not qualification.

If every condition holds → **stop** and report `FOUNDATION_READY_FOR_PROMOTION` with BASE_SHA, FINAL_SHA,
the external qualification evidence, the unresolved debts, and the exact proposed promotion operation.
**Do not merge `main`.**

If any condition fails → report `FOUNDATION_NOT_QUALIFIED` and name the failed conditions precisely. A
PARTIAL result is a legitimate, expected outcome of this phase; it must never be dressed as a PASS.

## 7. Explicit non-goals

- No Phase 09, no Phase 10, no new platform abstraction layer, unless a real external dogfooding run
  exposes a **structural** defect. Real problems get real fixes; with no real problem, Foundation
  construction ends here.
- No multi-language engineering support invented ahead of evidence (§5).
- No promotion performed by the agent (§6).
- No reopening of Phase 05 economics, Phase 06 determinism, or Phase 07 acceptance semantics.
- No faking of artifacts to turn a red check green — in particular, `PF-DEBT-012`'s missing prestart
  attestation is **not** to be manufactured.

## 8. Final acceptance

At the final exact head, run and record:

- full unit suite; postbuild suite; all typechecks;
- security scan; architecture ratchet; state probe;
- platform certificate; test catalogue / ownership audit; targeted-vs-full agreement;
- inherited Gate 8 checks; the Phase 07 semantic acceptance regression;
- external qualification verification (§4 records).

And confirm: `main` untouched; Phase 01–07 artifacts intact; `PF-DEBT-003` accurately classified given the
Phase 08 re-check; `PF-DEBT-012` accurately classified; local evidence described as **local**, never as
remote CI (`PF-DEBT-004`).

Then **stop**, at either `FOUNDATION_READY_FOR_PROMOTION` or `FOUNDATION_NOT_QUALIFIED`. The Owner decides
what happens to `main`.
