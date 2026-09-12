# Checkpoint 15 — CI Repair Loop (§41)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §41 (Phase 16 — CI Repair Loop):
CI → PASS? (yes → Final Gate) / no → parse failure → classify → repair → local
verify → push → CI again, until PASS or a Hard Blocker.

## What was built

### 1. `src/shared/ci-repair.ts` — parse, classify, plan (pure)

* **`parseCiFailure`** reads a CI log as it is: the failing step (`##[error]/##[group]`),
  the commands CI ran, compiler/lint diagnostics with their file, line and code
  (both `file(line,col): error TS####` and `file:line:col: error CODE:` shapes), test
  failures with their names and assertion messages, the CI wrapper annotations and
  the exit code. An unfamiliar log produces an **empty-but-honest** parse rather than
  an invented cause, and a job that could not start is flagged `infrastructure`.
  Each parse carries a `signature` hash, so the same failure is recognisable.
* **`classifyCiFailure`** hands the parsed failure to §33's model (with the gate
  inferred from what the log shows: failing tests → UNIT, TS codes → TYPECHECK), and
  an infrastructure failure is classified `ENVIRONMENT` from the log itself.
* **`planCiRepair`** maps the class to the local gates §41 must re-run
  (BUILD → TYPECHECK, TEST → UNIT, WORKSPACE → SYNTAX+TYPECHECK, …), names the files
  and tests the failure points at, and decides REPAIR vs **HARD_BLOCKER** using
  §33.2's step budgets. A TERMINAL failure is never repaired: it goes straight to the
  Hard Blocker with the Owner named.
* **`ciVerdict`** implements "CI: PASS?" strictly: only a successful conclusion
  counts, and **a CI read that failed is not a pass** — guessing at a cause would be
  worse than stopping.

### 2. `electron/engineering/ci-repair-loop.ts` — the loop

Executes the plan's cycle with the machinery from earlier checkpoints: read CI
(§39 gateway or an injected reader) → parse → classify → repair (the caller's
bounded worker, applied through the host) → **local verify** (the §31 ladder on the
gates the classification demands) → push (the §38/§39/§40 runner) → read CI again.
It stops at PASS or at a Hard Blocker, records every attempt (run id, conclusion,
step, class, signature, per-gate results, repaired files, commit, decision), writes
a durable record, and records the CI outcome as §31.3 evidence.

One design correction came out of running it: the push needs release state read
**at push time**. A checkpoint taken before the loop's own repair is stale by
definition — §38 refuses it, correctly — so `releaseInput` is a callback and the
caller takes the checkpoint immediately before the write.

## Evidence

`pnpm run acceptance:ci-repair` (CI step + local chain step) — **CR-01..CR-08 PASS,
44 observations**, offline:

* CR-01 a **real** `tsc` failure log parses into the step, the file, the line, the
  `TS2322` code and the exit code;
* CR-02 a **real** `node --test` failure parses into the failing test name;
* CR-03 the parsed failures classify as BUILD/TEST with TYPECHECK/UNIT as the local
  gates and the file/test as the target;
* CR-04 only a green conclusion is a pass; a failed read is not, and the loop
  hard-blocks instead of pretending;
* CR-05 a secret-scan CI failure is TERMINAL → HARD_BLOCKER with no repair;
* CR-06 a repair that never turns CI green stops at the bound with every attempt
  recorded and nothing pushed;
* CR-07 the whole cycle for real: a committed bad state, a real failing log, a repair
  applied through the host, a passing local typecheck, a real push of
  `boss/t-15/fix-the-gateway` (the remote commit carries the §39.2 trailers) and a
  green re-read — recorded as PASS;
* CR-08 the record is versioned, numbered per attempt, keeps the failure signature
  and belongs to a task.

## Honest boundaries

1. **CI is read through an injected reader.** `gatewayCiReader` composes the real
   gateway (workflow runs → workflow → failing steps), but the acceptance stubs the
   network boundary and feeds logs that are genuine command output. The live path
   still needs a real App installation.
2. **The repair worker is the caller's.** The loop decides *what* must be repaired
   and *what* must pass again; who writes the fix (a model, a Candidate, a human) is
   injected and its changes go through the same bounded, verified seam as everything
   else.
3. **The parser recognises the shapes this repository's CI emits** (tsc, node
   --test, the `##[error]`/`Process completed with exit code` wrappers). Another
   CI's log format would need its own patterns; the parse reports what it found
   rather than failing silently.
4. **A green re-read ends the loop**; the Final Gate (§42) that follows it is the
   next checkpoint, so a PASS here is not a release.
5. **Attempts are bounded by §33.2's budgets and by `maxAttempts`** (3 by default,
   5 hard cap); reaching either is reported as a Hard Blocker, never as success.
