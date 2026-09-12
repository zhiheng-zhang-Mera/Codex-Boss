# Checkpoint 8 — Verification Engine (§30 Implementation Loop host side + §31 Verification Engine)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §30 (Phase 5 — Implementation Loop),
§31 (Phase 6 — Verification Engine). This record states what exists, what was
proved, and what is deliberately left to the next checkpoint.

## What §30/§31 demand

| Plan clause | Requirement |
| --- | --- |
| §30.1 | A worker must have a scope: allowed files, allowed commands, workspace, requirement IDs. It may not modify the repository without limit. A theme worker is narrower still. |
| §30.2 | After every claimed modification the host must verify `git diff`, file existence, syntax, typecheck and target tests. |
| §30.3 | Every change unit should be small, testable, rollbackable, traceable. |
| §31.1 | The verification ladder climbs cheapest-first: syntax → typecheck → target unit tests → module tests → integration → full test → build → benchmark → runtime smoke → desktop black-box → visual runtime verification. |
| §31.2 | Verification is requirement-aware: UI → screenshot/DOM/runtime; theme → sandbox preview + screenshot + fallback test; performance → benchmark; persistence → restart; failure recovery → fault injection. |
| §31.3 | Every verification result is written to the Evidence Ledger with requirement, command, environment, result, artifact, timestamp and hash. |

## What was built

### 1. `src/shared/verification.ts` — the decision layer (pure)

The ladder and §31.2's routing, with no fs, clock or process access, so the
engine's *judgement* is testable without a machine:

* `VERIFICATION_LADDER` — the eleven §31.1 rungs in the plan's own order, with
  `LADDER_COST` and `orderByLadder`. `BENCHMARK` and `BLACKBOX` were added to
  `VERIFICATION_GATES`/`GATE_RANK` (`src/shared/execution-planner.ts`) so the
  ladder in the plan is expressible instead of approximated.
* `selectGates(requirement)` — chooses the rungs from the requirement's type, its
  declared §28.4 evidence kinds and its own wording (English and Chinese signals).
  The §31.1 base (syntax, typecheck) is attempted whenever the host has the
  command; §31.2 adds benchmark / restart / fault injection / preview / black box
  with the reason that put each rung there.
* `GateSelection.unavailable` — rungs the requirement wants but this host cannot
  climb, each with a reason ("no benchmark harness is attached"). They are never
  reported as passes.
* `GateSelection.external_evidence` — §28.4 kinds no runnable rung can produce
  (REVIEW, PREVIEW, SCREENSHOT). A requirement that needs them stays unverified
  until the review layer (§32) or the theme capture (§17) supplies them.
* `boundedScopeFor(node)` — §30.1's worker scope from a §29 plan node; an empty
  `allowed_files` grants no write permission at all.
* `verifyChangeClaims(claims, observations)` — §30.2/§2.3: a claim survives only
  when the file exists, git reports it modified and the hash matches. A worker
  that reports a change it never made fails here.
* `changeUnitProblems(unit, scope)` — §30.3 preflight: empty units, duplicates,
  out-of-scope paths, protected metadata (`.git`, `.codex`, `.agents`,
  `AGENTS.md`) and the one-megabyte budget.
* `ladderOutcome(selection, runs)` — the verdict of one climb: the cheapest
  failing rung decides, everything above it is `SKIPPED` with the reason, and a
  rung that could not run is `NOT_RUN`. Only a rung that actually passed may be
  named as the strongest.
* `evidenceInputsForRun(...)` — §31.3 rows for a climb, including the skipped
  ones, so the ledger shows "not attempted" rather than silently omitting it.

### 2. `electron/engineering/verification-engine.ts` — the host executor

The only part that touches the machine:

* `applyChangeUnit(scope, unit)` — §30.1/§30.3: the unit is preflighted whole and
  either applied whole or refused whole (nothing is written when any path is
  out of scope), writes go through a temp file + rename, and failure while
  writing rolls back what was already written. It also passes the §7.3
  `assertMutationAllowed` host assertion, so a verification-engine write cannot
  become a second, unguarded way into the Stable Boss repository.
* `rollback()` — restores the exact previous bytes (`before_sha256` recorded) or
  removes a file that did not exist before.
* `verifyClaims(claims)` — real §30.2 checks: `git status --porcelain
  --untracked-files=all` for the diff, `fs.statSync` for existence, sha256 for
  content. When git cannot answer, the claim is refused with that reason instead
  of being credited.
* `verifyRequirement(selection)` — climbs the selected rungs cheapest-first and
  **stops at the first failure**; syntax runs real `node --check` per
  JavaScript-family file (and says so when TypeScript is all that was granted,
  because `node --check` cannot parse it), typecheck/build/test run through the
  allowlisted `runAllowedCommand` (host-computed argv, never a model-supplied
  string), and benchmark/runtime/black-box/visual rungs are only satisfied by a
  real ingested harness report.
* `ingestReport(...)` — records an externally produced harness artifact
  (theme preview, benchmark, desktop black box) with the file's sha256; a path
  that escapes the workspace is refused.
* Durable ledger: the engine loads `<root>/artifacts/acceptance/verification-ledger.json`
  at construction and **writes through on every verification and ingest**, so a
  crash after a gate ran cannot lose the fact that it ran (§47).

### 3. Gate

* `scripts/acceptance-verify.cjs` + `package.json` `acceptance:verify` +
  CI step + `scripts/phase0-validation-chain.ps1` step.
* `tests/acceptance/verification-engine.test.ts` — V-01..V-10 against a **real**
  git fixture with a **real** TypeScript toolchain (including this repository's
  native-TypeScript platform package, so `tsc` produces a genuine diagnostic
  rather than dying in its launcher):
  * V-01 §30.1 scope (out-of-scope write refused, nothing written)
  * V-02 §30.3 atomicity (mixed unit writes nothing; a granted unit is applied)
  * V-03 §30.2 git + existence + hash (lying claim refused, real change confirmed)
  * V-04 §31.1 fail-fast (syntax failure; typecheck provably never executed)
  * V-05 real `tsc --noEmit` failure with exit code and a real `TS2322`
    diagnostic, then a real `node --test` pass after the fix
  * V-06 harness-only rung never faked; a real benchmark report satisfies it
  * V-07 durability + no double-counting on re-run; a fresh engine reads it back
  * V-08 rollback to byte-identical content with a clean git status
  * V-09 no invented evidence (no SCREENSHOT/REVIEW/PREVIEW, no visual pass)
  * V-10 the §28.4 bridge: `evidenceForRequirements` / `outstandingEvidence`
* `tests/unit/verification-ladder.test.ts` — 19 cases pinning the ladder order,
  §31.2 routing per requirement category, refusal of unrunnable rungs, and the
  §30.1/§30.2/§30.3 rules.

## Honest boundaries (not compression of the plan)

1. **The implementation loop that consumes this engine is checkpoint 9.** §30's
   full cycle (“Plan → Worker → Host Verification → Review → Repair → Reverify”)
   needs the §32 review layers; CP8 delivers the *Host Verification* stage as a
   first-class module with a real, tested API. The existing seams
   (`electron/engineering/verification.ts` `verifyAndRepair`, `proposal-runner`,
   `main-commander`) are untouched, so nothing regressed; CP9 replaces them with
   the ladder-based engine and records the ledger in the task record.
2. **Runtime/black-box/visual rungs are satisfied only by an ingested harness
   report.** The desktop black box remains its own CI gate
   (`acceptance:desktop-workbook`, 89/89 claims). CP8's engine reads such a report
   and hashes it; it does not pretend to drive Electron itself.
3. **No screenshots, previews or reviews are manufactured.** The ledger's
   `evidenceKindForGate` maps SYNTAX/TYPECHECK → IMPLEMENTATION, test/build rungs
   → TEST, BENCHMARK → COMMAND, RUNTIME/BLACKBOX/VISUAL → VISUAL_VERIFICATION.
   REVIEW/PREVIEW/SCREENSHOT stay outstanding until their own layers produce them.
4. **`gpu_available` is still always false** (§29.3 snapshot) — unrelated to this
   checkpoint but still an open gap in the progress ledger.
5. **Scope matching and §31.2 signal detection are lexical.** A requirement whose
   wording carries no performance/persistence/recovery/visual signal is routed to
   the ladder base, not guessed at. This is deliberate fail-closed behaviour.
