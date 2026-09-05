# AP24 — Perception–Action Loop

Compact handoff for Acceptance Pack **AP24** (plan §24 Perception–Action Loop). Branch `9-5`.

## Why

BOSS had semantic computer-use primitives (SemanticRuntime + vision/OCR backends, plan AP08)
but no closed perception–action loop: an operator/goal drove a one-shot action and verification,
with no bounded act → observe → critic → requirement-compare → revise cycle, and no key-frame
evidence discipline (plan §24: keep only `before` / `after` / `error` / `final`). This pack ships
the loop core with deterministic requirement comparison and a bounded-revision guarantee.

## What was added

- **`src/shared/perception.ts`** (new, pure)
  - `PerceptionFrameKind` (`before|after|error|final`) + `PERCEPTION_FRAME_KINDS`; `PerceptionFrame`.
  - `PerceptionRequirement { goal, mustContain[] }` + fail-closed `validatePerceptionRequirement`
    (1–20 literals, bounded length).
  - `critiqueRequirement(observation, requirement)` — deterministic, case-insensitive
    must-contain compare returning the exact `missing` literals (requirement compare never relies
    on model self-report).
  - `retainKeyFrames(frames)` — §24 key-frame policy: ≤ one frame per kind, newest wins, unknown
    kind rejected. `PerceptionEpisode` outcome/attempt/reason model with bounded `steps` labels
    (operational only — never private reasoning).
  - `validatePerceptionFrame`.
- **`electron/computer/perception-loop.ts`** (new)
  - `PerceptionSurface` interface (`act(action) → {status, observed?, message?}` + optional
    `capture()` for real frames) so the loop is deterministic under test and wraps a
    `SemanticRuntime` in production.
  - `PerceptionLoop.run(requirement, plan, revise?)` — bounded act → observe → critic →
    compare → revise:
    - attempt ≤ `maxAttempts` (default 4, hard cap 20 — §20 bounded retry);
    - action FAILED/UNCERTAIN records an `error` frame and consults the revision planner
      (no revision → STOPPED/FAILED);
    - action SUCCESS is critiqued against `mustContain`; a failed critique records `error` +
      revision; a passed critique records the `final` frame and PASSED;
    - episode retains only key frames (`retainKeyFrames`), so the journal never grows with
      revision attempts.
  - optional durable `stateFile` journal (`.boss/…json`, schemaVersion 1, key frames only) with
    `restore()` for operator display.
- **`tests/perception-loop.test.ts`** (new, 8 tests) — deterministic critique incl. case handling
  and missing-literal lists; key-frame retention (newest-wins + unknown-kind rejection); loop
  PASS on first attempt; revise-on-failed-critique then PASS with a single error frame; STOP when
  no revision exists; UNCERTAIN-action failure surfaced with error frame and bounded journal;
  durable state-file write + restore.

## Verification

- Targeted: `perception-loop` (8) PASS.
- Full suite + both tsconfigs: to be run before the pack batch lands; expectations green.

## Boundary notes

- Pure shared model has no node imports; compiles under both tsconfigs.
- `PerceptionLoop` is intentionally surface-agnostic (works with UIA/vision/DOM/structured
  `SemanticRuntime` instances via `computer-service`). Adopting it into `main.ts`/commander
  dispatch is a deliberate later seam (AP30 hardening exercises live perception paths).
- Revision planner is caller-supplied (deterministic planner in tests; planner/model callback in
  live use) — the loop itself never fabricates private reasoning.
- Key-frame storage only persists images/OCR text produced by the surface; no raw full logs.

## Checkpoint

Commit with: `src/shared/perception.ts`, `electron/computer/perception-loop.ts`,
`tests/perception-loop.test.ts`, this handoff.
