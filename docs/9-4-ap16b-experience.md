# AP16b — Experience Hierarchy + Promotion Rules

Compact handoff for Acceptance Pack **AP16b** (plan §14 Experience 层级与 Promotion). Branch `9-4`.

## Why

The plan requires four experience levels (task → workspace → domain → global) where promotion
only happens on repeated/cross-validated evidence — a single project's accidental observation
must never pollute global. AP16a added the Performance DB (observations); this pack adds the
hierarchy and promotion rules over recorded observations.

## What was added

- **`src/shared/experience.ts`** (new, pure)
  - `ExperienceLevel = task|workspace|domain|global` (+ order), `ExperienceObservation`,
    `ExperienceEntry { claim, domain, level, observations[], promotedFrom? }`.
  - `decidePromotion(entry, thresholds?)`:
    - task → workspace needs ≥2 own-level observations;
    - workspace → domain needs observations from ≥2 distinct workspaces;
    - domain → global needs ≥3 distinct workspaces.
  - Single-observation task insights never reach workspace+; single-workspace never reaches
    domain/global.
- **`electron/experience/experience-store.ts`** (new)
  - `ExperienceStore` — schemaVersion-1 persisted store; `observe(claim, domain, source)`
    appends an observation and returns `{ entry, promotion }` when a promotion rule fires.
- **`electron/main.ts`** — store wired for the active workspace under its durable root
  (`.boss/experience.json`).
- **`tests/experience.test.ts`** (new, 4 tests) — promotion rules at each level + single-
  observation guard, and store observe/promote/persistence + corrupt fail-closed.

## Verification

- Targeted: `experience` (4) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Promotion is observation-count based (deterministic seed). Feeding real telemetry/evaluation
  outcomes into `observe` (worker contribution metrics) is the remaining AP16 wiring half.
- Global pollution protection is structural (thresholds) — trust-weighted promotion over
  evaluation data is a later extension.

## Checkpoint

Commit with: `src/shared/experience.ts`, `electron/experience/experience-store.ts`,
`electron/main.ts`, `tests/experience.test.ts`.
