# AP07a — Explicit Session Lifecycle Kinds (NEW/CONTINUE/FORK/REVIEW/ARCHIVED)

Compact handoff for Acceptance Pack **AP07a** (plan AP07 + §1.3 GOOD example: enum →
serialization → scheduler transition → resume behavior → tests). Branch `9-4`.

## Why

Sessions were implicit per-(task, provider) worker records with only a `resumeStrategy`
(RECONSTRUCT/EXPLICIT_SESSION/RESTORE_URL), no lifecycle vocabulary, no workspace binding, and
health strings stored directly on the session. AP07 requires sessions to carry an explicit kind
(NEW/CONTINUE/FORK/REVIEW/ARCHIVED), hang off task+workspace, and keep provider health separate.

## What was added

- **`src/shared/session-state.ts`** (new)
  - `SESSION_LIFECYCLE_KINDS = ["NEW","CONTINUE","FORK","REVIEW","ARCHIVED"]`; labels;
    `sessionKindActive`; `sessionKindForResumeStrategy` (RESTORE_URL/EXPLICIT_SESSION →
    CONTINUE, RECONSTRUCT → NEW); `transitionSessionKind` with a fixed transition table and
    fail-closed on invalid moves; `isSessionLifecycleKind`.
- **`electron/commander/task-ledger.ts`**
  - `WorkerSession.kind?: SessionLifecycleKind` and `workspaceId?: string` (additive; legacy
    records load as NEW).
- **`electron/commander/provider-session-registry.ts`**
  - Kind-aware `sessionFor(taskId, provider, workspaceId?, kind?)` (create NEW / transition),
    `save()` derives kind when absent, `archive()` moves to ARCHIVED, `lifecycle(taskId)`
    summary.
- **`electron/commander/execution-supervisor.ts`**
  - First use of a provider session creates NEW; reusing an existing provider session marks
    CONTINUE; workspace path bound when known. (Provider `health` string on the session is
    untouched in this pack; real provider health stays in `RuntimeHealth`, per separation note.)
- **`electron/store.ts`**
  - The ledger mirror for web/API runs now derives `kind` from the resume strategy and binds
    `workspaceId` from the task workspace fingerprint.
- **`tests/session-lifecycle.test.ts`** (new, 8 tests) — vocabulary/labels, transition
  validation, resume-strategy derivation, registry create/continue/archive, persistence,
  supervisor NEW on first step + CONTINUE on reuse, and store mirror with RESTORE_URL →
  CONTINUE + workspace binding.

## Verification

- Targeted: `session-lifecycle` (8) + `recovery-closure`, `execution-supervisor`, `store`,
  `delivery-integration` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- FORK/REVIEW kinds are part of the validated vocabulary and transition table; no UI/creation
  flow forces them yet (FORK will map to parent-task sessions in AP12 decomposition, REVIEW to
  the review-gate phase in a later presentation pack).
- Session `health` still stores the last interruption kind from the supervisor for audit
  continuity; separating it into a dedicated health record is SoftwareSession territory
  (AP19/AP21).
- `workspaceId` today is the workspace path (or its ledger fingerprint for web runs); a real
  Workspace id arrives with AP01.

## Checkpoint

Commit with: `src/shared/session-state.ts`, `electron/commander/task-ledger.ts`,
`electron/commander/provider-session-registry.ts`, `electron/commander/execution-supervisor.ts`,
`electron/store.ts`, `tests/session-lifecycle.test.ts`.
