# AP06 — Capability Graph Resolution + Router Wiring (seam)

Compact handoff closing the remaining AP06 seam (plan AP06 / §4.4 / §13.2; audit:
`requiredCapabilities` free text never resolved, cheapest-sufficient not wired into routing).
Branch `9-5`.

## Why

`TaskIR.requiredCapabilities` was free text ("native", "general_reasoning", "web_search",
"code_edit", …) that nothing ever resolved against the executor vocabulary, and the
cheapest-sufficient cost model (AP06b) was not consulted when routing. The planner must face a
capability graph, not brand names (plan §4.4). This pack ships the resolution layer and wires it
through `PlanCompiler` → `RoleRouter` → `MainCommander.dispatchRole`.

## What was added

- **`src/shared/capability-graph.ts`** (new, pure)
  - `AICapability` mirror of the runtime role vocabulary + `AI_CAPABILITIES`;
    `NATIVE_CAPABILITIES` (deterministic: native/read/list/git/computer/test/build/lint/
    typecheck), `GENERIC_CAPABILITIES` (general_reasoning/reasoning/model/analysis/…).
  - `resolveCapabilityGraph(tokens)` — deterministic canonicalization (underscore/hyphen →
    space) into `{ aiRoles, nativeSufficient, kinds, unresolved }`. Unrecognized tokens are
    reported, never silently assumed.
  - `capabilitySatisfiedBy(resolution, candidate)` gate — unresolved → denied; native demand
    satisfied by a native executor; role demand must appear in candidate roles; empty AI demand
    needs a model-capable runtime.
- **`electron/commander/role-router.ts`** (wired)
  - `RoleRoutingRequest.capabilityTokens?: string[]`; `route()` now resolves them additively to
    the role's own capability (plan §4.4: route on the capability graph, not preference only).
  - Cheapest-sufficient ordering when capability-driven: brand-kind fit first (a demanded kind
    like `web` restricts to web runtimes), then brand cost order, then resource score. Pinned and
    preferred runtimes stay authoritative (score first). Default behavior (no capabilityTokens)
    is byte-identical to the previous comparator.
  - `resolveCapabilityTokens()` helper exposed for callers/supervisor.
- **`electron/commander/plan-compiler.ts`** (wired)
  - `parse()` now accepts planner-declared `requiredCapabilities`; they are validated against the
    capability graph (unknown token → schema error → bounded replan retry) and canonicalized;
    absent/empty tokens keep `compileIntent` defaults unchanged.
- **`electron/commander/main-commander.ts`** (wired)
  - Worker/verify step dispatch now passes `plan.requiredCapabilities` as `capabilityTokens`
    into the role router, so a compiled plan's capability demands actually constrain executor
    selection.
- **`tests/capability-router.test.ts`** (new, 8 tests) — native→deterministic sufficiency; role +
  tool tokens → AI capabilities; generic reasoning → no brand demand; unresolved reported; gate
  semantics; additive routing excludes a role-insufficient runtime; cheapest ordering under
  generic demand; kind restriction (`web_search` → web first); pin/preferred precedence.

## Verification

- Targeted: `capability-router` (8), `role-router` (1), `cheapest-execution` (5),
  `intent-compiler` (3), `plan-integration` (14) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: run with the batch before landing.

## Boundary notes

- Pinned/preferred runtime configuration continues to win over cost ordering; capability-driven
  cost ordering only ever re-orders *compatible fallbacks*.
- Generic reasoning tokens demand no specific brand, preserving prior routing when a plan was
  compiled without explicit capability demands.
- The supervisor (`ExecutionSupervisor`) path consumes the same `RoleRouter` candidates, so the
  resolution applies there automatically without a separate change.

## Checkpoint

Commit with: `src/shared/capability-graph.ts`, `electron/commander/role-router.ts`,
`electron/commander/plan-compiler.ts`, `electron/commander/main-commander.ts`,
`tests/capability-router.test.ts`, this handoff.
