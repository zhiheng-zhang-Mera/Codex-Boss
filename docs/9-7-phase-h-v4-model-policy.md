# 9-7 Phase H — DeepSeek V4 ModelPolicy + Cache-Friendly Prompt Envelope

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase H. Branch `9-7`.

## Why

DeepSeek V4 defaults thinking ON at high effort (plan §18). Every call must
explicitly state model + thinking + effort + maxOutputTokens; no call may rely
on API defaults, and cheap work must never ride Pro max (plan §17/§37).

## What was added

- **Model policy (`src/shared/model-policy.ts`)**
  - `ModelPolicy {model, thinking, effort?, maxOutputTokens, jsonOutput?, promptVersion?}`
    plus `PolicyStage` vocabulary (classify/route/plan/code/review/research/
    synthesis/adjudicate).
  - Per-stage `DEFAULT_POLICIES` matching §17: flash non-thinking (classify),
    flash low (route), pro high (plan/code/research/synthesis), pro max only for
    adjudicate.
  - `policyFor(stage, override?)` — returns `{policy, reason}`; refuses a
    thinking-enabled policy without an explicit effort. `policyFor` reason is
    the log line that explains model selection (§36).
  - `jsonOutputInstruction(policy)` — single-JSON-object output contract for
    router/planner/coder shapes (§25).
  - `buildV4Prompt(policy, statics, dynamic)` — full cache-friendly envelope:
    [SYSTEM POLICY][BOSS ROLE][TOOL CONTRACT][OUTPUT SCHEMA incl. JSON
    instruction][PROJECT MANIFEST] first, dynamic task/context/tool results
    after — reuse of the Phase G stable layout, so prefix caching hits (§20).
- **API default** — DeepSeek default model moved to `deepseek-v4-flash`
  (`electron/api-settings.ts`); all other settings untouched.

## Acceptance (Phase H)

- Every stage has an explicit policy; classify is flash non-thinking and
  adjudicate alone is Pro max (verified).
- Effort cannot be omitted for thinking calls (verified).
- Prompt prefix stable across changing dynamic tasks; JSON instruction is part
  of the output schema section (verified).
- Model choice is log-explainable through `policyFor` reasons.
- Verified by `tests/model-policy.test.ts` (5 tests).

## Verification

- `pnpm run typecheck` — green.
- `pnpm vitest run tests/model-policy.test.ts` — 5 passed.

## Next

Phase I — DSH presets (boss-dev-standard / boss-dev-ptc / boss-dev-minimal /
boss-plugin-creator) so Harness runtime modes are chosen per work type instead
of defaulting everything to Standard.
