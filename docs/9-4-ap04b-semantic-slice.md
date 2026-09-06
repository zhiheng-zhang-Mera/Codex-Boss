# AP04b — Semantic Code Slice + Dependency-Aware Targeted Test Selection

Compact handoff for Acceptance Pack **AP04b** (plan AP04; the queue's third sub-item "Token
Governor" is covered by existing per-task `limits`/`usage` + DegradedController — see Boundary
notes). Branch `9-4`.

## Why

AP04a added the repo index/test map. The remaining dev-plane need this pack closes is to turn a
list of changed files into the *right* tests: follow actual import/require edges rather than
only directory co-location, so verification runs a deterministic subset of the full suite on
real fixtures.

## What was added

- **`electron/engineering/semantic-slice.ts`** (new)
  - `importEdges(snapshot)` — bounded per-file relative import/require/`from`/bare side-effect
    edge scan (`.ts/.tsx/.js/.cjs/.mjs/.svelte/.vue`), stem-extension resolution, non-relative
    imports skipped.
  - `affectedTests(snapshot, changedFiles)` — reverse-dependency walk over importers; returns
    tests whose graph reaches a changed file (or the changed file itself when it is a test),
    deterministic subset of the discovered suite.
  - `dependencyClosure(snapshot, roots, limit?)` — forward import closure (bounded) for prompt
    slicing.
  - `targetedTestsForChanged(root, changedFiles)` convenience (scan + select).
- **`electron/engineering/verification-policy.ts`**
  - `requiredEngineeringChecks` now picks tests through `affectedTests` for the files being
    changed and falls back to the full discovered set when nothing matches — guaranteeing the
    targeted run stays a subset of the full suite while never silently skipping verification.
- **`tests/semantic-slice.test.ts`** (new, 5 tests) — import edges (relative/re-export/bare),
    affected-test subset vs unrelated tests, dependency closure, convenience helper, and
    verification-policy adoption with fallback-to-full behaviour.

## Verification

- Targeted: `semantic-slice` (5) + `repo-inspector`, `plan-integration`, engineering suites PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- The import scanner is a heuristic (regex + stem resolution), not a full TS/JS parser; it is
  deliberately bounded (1 MB file cap, deterministic ordering) and used only to *narrow* tests —
  the fallback to the full discovered suite keeps engineering verification sound.
- **Token Governor sub-item:** per-pack token/cost budget telemetry already exists as
  `TaskLedgerRecord.usage`/`limits` (AP02d) plus `BudgetManager` and `DegradedController`
  (budget exhaustion → deterministic/paused mode); the plan's "已有且等价功能 → 不重写" rule
  applies, so no duplicate governor was added. A dedicated dev-session Token Governor can be
  layered later when the dev orchestrator (Auto Handoff) lands.
- Semantic Code Slice (import closure) is wired for tests here; using it to slice context for
  workers is a further AP09 context-compiler concern.

## Checkpoint

Commit with: `electron/engineering/semantic-slice.ts`,
`electron/engineering/verification-policy.ts`, `tests/semantic-slice.test.ts`.
