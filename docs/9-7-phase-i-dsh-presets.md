# 9-7 Phase I — DSH 开发 Preset 策略

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase I. Branch `9-7`.

## Why

Boss development in the DeepSeek Harness should not run every task on the full
agent. Phase I establishes the four Boss development presets and a
deterministic work-type → preset mapping (plan §16/§35), so Standard is the
default for repo features, PTC for bounded multi-tool work, Minimal for a
single patch, and Creator only for plugin work — never the other way around.

## What was added

- **Preset policy (`src/shared/dsh-presets.ts`)** — pure + shareable:
  - `DshPresetId` (boss-dev-standard / boss-dev-ptc / boss-dev-minimal /
    boss-plugin-creator) with `DshPresetDefinition` for each: runtime mode
    (standard/ptc/minimal/creator), the shipped DSH base composition it maps
    onto (standard/ptc/minimal/cordis), human label + one-line purpose,
    tool-profile list and expected model tier.
  - `WORK_TYPE_TO_PRESET` — plan §35 defaults: repo-feature → Standard,
    bounded-multi-tool → PTC, small-patch → Minimal, plugin-work → Creator,
    unclassified → Standard.
  - `presetForWorkType(workType, level?)` — deterministic choice + reason;
    small patches and L0 work never route to the full agent.
  - `presetsServing(workType)` — guard-rail guidance.
  - `describePreset(choice)` — explainable one-liner incl. tool profile.

The mountable Cordis compositions themselves ship in the DeepSeek Harness
preset root (standard/ptc/minimal/cordis). This module is the Boss-side policy
naming which to mount and why; the DSH roster mounts it as a user preset
(`.agent-presets/<id>/preset.yml` + `agent.cordis.yml`) when an operator copies
the matching base composition.

## Acceptance (Phase I)

- Four presets exist mapping onto the four runtime modes (verified).
- Plan default table holds: feature→Standard, multi-tool→PTC, patch→Minimal,
  plugin→Creator (verified).
- Determinism + explainability via reasons (verified).
- Verified by `tests/dsh-presets.test.ts` (5 tests).

## Verification

- `pnpm run typecheck` — pending at phase close.
- `pnpm vitest run tests/dsh-presets.test.ts` — 5 passed.

## Next

Phase J — Live Research executor / role routing refinement on top of the
existing research machinery; Phase K autopilot `runUntilBlocked`; Phase L
manuscript LaTeX compile. (J–L extend the existing 9-6 research core rather
than inventing parallel stacks.)
