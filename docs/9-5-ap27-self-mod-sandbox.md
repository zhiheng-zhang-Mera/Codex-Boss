# AP27 — Self-Modification Sandbox + Dual BOSS

Compact handoff for Acceptance Pack **AP27** (plan §27 Self Modification Sandbox + Dual BOSS).
Branch `9-5`.

## Why

BOSS had every ingredient for safe self-engineering (git branch/worktree isolation in
`engineering/workspace.ts`, guardian `promotion.gate` in `src/shared/guardian.ts`, §6
compatibility contracts, §8/§12 evaluation records) but no orchestration that lets BOSS-A
produce a candidate **BOSS-B**, modify it, test it, replay history, A/B-evaluate against
production, and promote or discard while proving old Workspace / Adapter compatibility. This
pack ships the Dual-BOSS candidate pipeline as a deterministic, fail-closed sandbox.

## What was added

- **`src/shared/self-modification.ts`** (new, pure)
  - `SelfModCandidate { id, goal, baseCommit, branch, headCommit?, status, tests?, replay?, ab?,
    compatibility?, createdAt, updatedAt, error? }` with 8 states
    (CANDIDATE → TESTING → REPLAYING → AB_EVALUATING → PROMOTED/DISCARDED/ROLLED_BACK/FAILED).
  - `decideABPromotion()` — deterministic A/B rules: red tests → DISCARD; candidate better →
    PROMOTE; within `regressionTolerance` → PROMOTE; worse beyond tolerance → HUMAN (never an
    auto-promoted regression); no baseline + no goldens → HUMAN unless `requireBaseline=false`.
  - `candidateCompatibilityVerdicts()` — candidate core-version downgrade detection, per-adapter
    window checks against the candidate versions, and workspace-schema check against the oldest
    production workspace (plan §27: “must verify old Workspace / Adapter compatibility”).
  - `validateSelfModCandidate()` fail-closed validator.
- **`electron/self-engineering/self-mod-sandbox.ts`** (new)
  - `SelfModificationSandbox(filePath, ops, scope)` — durable (`schemaVersion:1`) Dual-BOSS
    pipeline. Heavy operations (git branch creation, modification application, test runner,
    historical replay, baseline source, promote/discard) are injected `SelfModOps` so the
    sandbox is deterministic under test; production wires the engineering runtime + Codex model.
  - Flow: `begin` (CANDIDATE) → `modify` (TESTING, records headCommit) → `test` (red →
    FAILED, green → REPLAYING) → `replay` (AB_EVALUATING) → `evaluate` (computes A/B +
    compatibility; PROMOTE requires the `promotion.gate` Guardian token; incompatible →
    DISCARDED; HUMAN stays durably pending and never auto-promotes) → `conclude` (promotes or
    discards the branch) → `rollback` (protected `rollback` area, Guardian token).
  - Fail-closed restore: corrupt sandbox state throws instead of silently resuming candidates.
- **`tests/self-mod-sandbox.test.ts`** (new, 12 tests) — pure A/B matrix (red-discard, better
  promote, regression → HUMAN, tolerance promote, no-evidence → HUMAN when required); pure
  compatibility matrix (adapter window exclusion, core downgrade, workspace schema vs oldest
  workspace, candidate validation); full sandbox flow to PROMOTED + durable reload; Guardian
  denial on promotion; red-test + incompatible discard and rollback denial without token; HUMAN
  decision kept pending; corrupt-state fail-closed.

## Verification

- Targeted: `self-mod-sandbox` (12) + `perception-loop` (8) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- The sandbox orchestrates; it does not fabricate edits. `SelfModOps.applyModification` is the
  bounded edit boundary (candidate branch receives model/proposal output, never arbitrary shell).
- `promotion.gate` and `rollback` are exercised through the shared Guardian boundary (AP28a), so
  a future live-wiring seam needs no new security surface.
- Old-workspace/adapter compatibility is *verified before any promotion side effect*: verdicts
  that fail flip the decision to DISCARD.
- LIVE seam (kept out of this pack): wiring `SelfModOps` to `prepareWorkspace`
  (git branch/worktree), the real targeted-test selector (`semantic-slice`) and historical
  evaluation replay (`evaluation-store`) in `main.ts`.

## Checkpoint

Commit with: `src/shared/self-modification.ts`, `electron/self-engineering/self-mod-sandbox.ts`,
`tests/self-mod-sandbox.test.ts`, this handoff.
