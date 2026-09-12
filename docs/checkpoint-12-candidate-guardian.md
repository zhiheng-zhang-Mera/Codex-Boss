# Checkpoint 12 — Candidate State (§35) + Guardian Final Gate (§36)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §35 (Phase 10 — Candidate State) and
§36 (Phase 11 — Guardian Final Gate).

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §35 | A task never goes `RUNNING → COMPLETED`. It walks RUNNING → IMPLEMENTED → VERIFYING → REVIEWING → CANDIDATE → ACCEPTED, and CANDIDATE means *all the code is done but no release permission has been granted yet*. A theme candidate is a candidate too. |
| §36 | A Candidate must pass, again: goal compliance, requirement coverage, secret scan, scope validation, evidence completeness, destructive-change check, Owner-override compliance. Theme candidates add theme isolation, fallback validation, no executable payload, built-in theme integrity. Any failure: Candidate → Repair. |

## What was built

### 1. `src/shared/candidate-gate.ts` — the lifecycle and the checklist (pure)

* **The lifecycle is a machine, not a convention.** `TASK_LIFECYCLE`,
  `TASK_TRANSITIONS` and `advanceLifecycle(state, event)` implement §35: moving
  forward needs the plan's own event, `REPAIR` moves a rejected candidate *back*
  (CANDIDATE → REVIEWING), and anything else is refused with the legal transitions.
  `RUNNING → ACCEPTED` is not expressible.
* **CANDIDATE has a recorded meaning.** `candidateRecordFor` writes
  `awaiting_release_permission: true` until the state is ACCEPTED, alongside the
  requirements, the completion evidence, the steps taken and the Guardian verdict.
* **The §36 checklist, evaluated on evidence.** `evaluateGuardian` runs the seven
  checks plus the four theme ones, each reporting `PASS` / `FAIL` / `NOT_RUN` with
  the artifacts it inspected and the reasons. Two rules carry the doctrine:
  * a check that could not be performed is `NOT_RUN`, which **blocks** — "we did not
    look" is not "we looked and it is fine";
  * the verdict is `ACCEPTED` only when every required check passed, and otherwise
    `REPAIR` with the blocking check ids, which is exactly the repair input §36 asks
    for.
* **The checks themselves are specific**: coverage below 100%, a credential shape,
  a write outside the grant, owed/failed evidence, an uncovered §32 review, an
  Owner-unapproved deletion, an override the work does not reflect, a theme that
  references another package, an executable payload, an invalid fallback plan, a
  damaged built-in.
* **Owner-override compliance is lexical and says so**: a requirement must carry at
  least half of the override's own significant terms (`termsOf`), because "the work
  reflects the Owner's words" cannot be decided semantically here.
* `theme_required` keeps the four theme checks mandatory when the candidate touched
  a theme lane even if no package could be read — otherwise a theme change could
  skip its checks by failing to be observed.

### 2. `electron/engineering/candidate-guardian.ts` — the host gate

Supplies the observations from artifacts rather than summaries:

* the §31.3 ledger (evidence completeness, newest row per gate so a repaired
  failure clears; plus the passing rows as completion evidence);
* the §32 review's coverage (via the caller's `reviewCovered`);
* the written files through the **real secret scanner**;
* `git status` for deletions, and a package.json diff for removed scripts;
* the compiled contract's overrides, split into items;
* real theme package directories read faithfully and handed to the §20 validator;
* a durable `<workspace>/artifacts/acceptance/candidate-record.json`.

A bug this caught in itself: the first version synthesized a manifest for the
validator (id/name/version only), which made **every** theme report schema errors.
The reader now passes the package through exactly as it is on disk — a Guardian
must not manufacture the evidence it judges.

## Evidence

`pnpm run acceptance:candidate` (CI step + local chain step) drives the gate over
artifacts a real run produced. **GD-01..GD-10 PASS, 52 observations:**

* GD-01 §35's jump is refused, the legal path reaches ACCEPTED;
* GD-02 a candidate with an empty goal and an empty ledger cannot be released and
  keeps owing the permission;
* GD-03 a fully evidenced candidate is released, all seven checks name what they
  inspected, and the record is durable;
* GD-04 a real `AKIA…` credential shape in a written file fails the secret scan and
  becomes the repair input;
* GD-05 a file written outside the grant (and a refused unit) fails scope
  validation;
* GD-06 an uncovered §32 review and an unevidenced requirement fail evidence
  completeness; with coverage it passes;
* GD-07 a real `git`-visible deletion fails the destructive-change check unless the
  Owner approved that exact path;
* GD-08 an override the work does not reflect fails, and passes once a requirement
  carries its terms;
* GD-09 real theme packages: a clean one passes all four theme checks, adding an
  executable `javascript:` payload makes the §20 validator report it, the candidate
  is refused, and a theme lane with nothing read is `NOT_RUN` rather than a pass;
* GD-10 a refused Guardian returns the lifecycle to REVIEWING with the blocking
  check ids named and the release permission still owed.

Unit layer: `tests/unit/candidate-gate.test.ts` (17 cases).

## Process note

Repairing a fixture string with PowerShell's `-replace` re-encoded this
checkpoint's acceptance file and produced mojibake (`§` → garbage) plus a BOM;
it was repaired with byte-explicit Node replacements and the BOM stripped. The
repository's existing convention — never edit UTF-8 sources with PowerShell
`Set-Content`/`-replace` — is the rule that was broken, and the checkpoint's own
gate is what surfaced it (GD-06 compared a mojibake literal against the
implementation's correct `§32`).

## Honest boundaries

1. **Goal compliance and override compliance are lexical.** A requirement "serves"
   the goal (or reflects an override) when it shares significant terms. A semantic
   reader would be better; the fail-closed direction is that an unrelated
   requirement does not satisfy either check.
2. **The destructive-change check sees path deletions and removed scripts**, not
   semantic destruction (a rewrite that guts a function is not a deletion).
3. **The Guardian is a gate, not a runner.** It decides the verdict and produces
   the repair input; driving a repair round through the §30/§32 loop and returning
   to CANDIDATE is the integration step.
4. **`reviewCovered` is supplied by the caller** (the §32 report), so the gate
   depends on the review actually having run; when it did not, the check fails.
5. **Candidate records are written per evaluation**, not appended as a history; the
   sequence of candidate attempts is visible through the steps and the ledger.
