# Checkpoint 13 — Version Impact (§37) + Local Git Checkpoint (§38)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §37 (Phase 12 — Version Impact
Assessment) and §38 (Phase 13 — Git Checkpoint).

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §37 | Boss computes NONE / PATCH / MINOR / MAJOR from API, schema, behaviour, compatibility, migration and user-facing changes — and a Worker may not decide it. An ordinary new custom theme is NONE/PATCH; a change to the Theme Engine contract forces a re-assessment. |
| §38 | Before any GitHub write, create a local checkpoint recording HEAD, branch, diff, task, candidate id and evidence, and be able to roll back. |

## What was built

### 1. `src/shared/version-impact.ts` — §37 (pure)

* One rule per factor, each returning the impact it forces **with its reason and
  the files that produced it**: a disappeared export or a public deletion/rename or
  a shipped migration is MAJOR, a new export or a user-facing change is MINOR, a
  plain implementation change is PATCH, and a change that only touches tests or
  documents is NONE.
* The result is the strongest finding, and the findings are kept so the answer can
  be argued with; `factors_examined` / `factors_not_observed` record what was
  actually looked at.
* **§37's "a worker may not decide" is enforced**: a worker's claim is compared with
  the host's own assessment and any conflict lands in `rejected_claims` with the
  host's reasoning. An agreeing claim is not rejected, so the field means something.
* **The two theme special cases**: a change consisting only of theme packages is
  capped at NONE/PATCH, and a change touching the Theme Engine's contract sets
  `requires_reevaluation` so the theme answer cannot be inherited.
* `suggestedVersion` maps the impact onto a real semver bump.

### 2. `src/shared/git-checkpoint.ts` — §38 (pure)

* `CheckpointRecord` is exactly §38's list (HEAD, branch, diff hash + size, task,
  candidate, evidence) plus the changed files and the §37 impact, so a release can
  cite why it was allowed.
* `planRollback` decides what a rollback would do: restoring paths from the
  recorded HEAD is the safe operation and is enough while the branch has not moved;
  if the branch advanced, a hard reset is required and is only planned with an
  explicit **Owner** approval; a different branch or an empty change set is refused
  with the reason.
* `guardGitHubWrite` is §38's precondition: the newest checkpoint for the task must
  exist, be on the current branch and still describe the current diff, otherwise the
  remote write is refused.
* `isUsableCheckpoint` treats an unreadable or wrong-version record as absent,
  never as valid.

### 3. `electron/engineering/git-checkpoint.ts` — the host

Runs real git and inspects the real change:

* `assess()` records, for every changed path, the change kind, whether it is part of
  the consumed surface, whether it declares a schema, whether it is user-facing,
  whether it is a test/document or a theme package, and its **exported symbols
  before and after** — the "before" from `git show <head>:<path>`, the "after" from
  disk.
* `create()` captures the real HEAD, branch, diff (bounded) and its hash, the
  changed files, and writes the record durably per checkpoint id.
* `guard()` compares the live diff hash with the checkpoint's.
* `rollback()` restores each changed path from the recorded HEAD, and — a gap the
  run itself exposed — **deletes a path that did not exist at that HEAD**, because
  "restore" cannot undo an addition. It reports the resulting HEAD/branch/dirtiness
  so the outcome is checkable, and requires the Owner's approval before a hard reset.

## Evidence

`pnpm run acceptance:version-checkpoint` (CI step + local chain step) runs the store
over a real repository. **VC-01..VC-08 PASS, 50 observations:**

* VC-01 a docs-only change is NONE, an added export is MINOR with the symbol cited;
* VC-02 a removed export is MAJOR, a worker's softer `PATCH` claim is rejected with
  the host's reasoning, and the suggested bump is 2.0.0;
* VC-03 a theme package is NONE/PATCH, a Theme Engine contract change sets
  `requires_reevaluation`;
* VC-04 the checkpoint records the real HEAD (`git rev-parse`), the real branch, a
  hashed non-empty diff, the task, the candidate, the evidence and the §37 impact,
  and a fresh store reads it back;
* VC-05 a push for a task with no checkpoint is refused, is allowed with a current
  one, and is refused again after an edit drifts the diff;
* VC-06 a rollback restores the real working tree to the committed content with
  HEAD unmoved and a clean status;
* VC-07 a rollback after a commit is refused until the Owner approves, then really
  resets HEAD back to the checkpoint and the later edit is gone;
* VC-08 the §30.3 change-unit rollback and the §38 checkpoint rollback agree on the
  same file: byte-identical restore, then a clean tree.

Unit layer: `tests/unit/version-impact.test.ts` (15 cases).

## Honest boundaries

1. **The impact rules are structural, not semantic.** They read change kinds,
   exports, paths and the surface classification; a change that alters behaviour
   without touching any of those still lands on PATCH rather than being analysed.
   The fail-closed direction is that a *breaking* observable change (removed export,
   deletion, rename, migration) always reaches MAJOR.
2. **`public_surface` and `schema` are path-based classifications** (`src/shared`,
   `src/renderer`, `schema`/`types.ts` names). A monorepo with different conventions
   would need its own classification, which the observation type allows.
3. **The diff is captured bounded** (512 KiB) and hashed over the captured text, so
   an enormous diff is detected by size but not preserved in full in the record.
4. **The checkpoint does not push anything.** §38 is the precondition for §39/§40's
   GitHub writes; connecting `guardGitHubWrite` to the real push path is the next
   checkpoint's job, and until then the guard is enforced by callers.
5. **A hard reset requires `owner_approved_discard: true`** — there is no path by
   which the loop can discard commits on its own.
