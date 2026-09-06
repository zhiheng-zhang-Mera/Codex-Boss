# 9-7 Phase C — Provider Capability Registry + Attachment Router

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase C. Branch `9-7`.

## Why

Boss must decide who reads a file — the user never picks a parser, a provider,
or a capability. Before any auto-routing can exist there has to be a real
capability registry (runtime metadata, not UI) plus a deterministic router that
maps typed input objects onto providers and answers "Chat 足够？".

## What was added

- **Shared capability model (`src/shared/provider-capabilities.ts`)**
  - `ProviderCapabilities` per plan §7: text / imageUpload / pdfUpload /
    documentUpload / spreadsheetUpload / archiveUpload / multipleFiles / vision /
    code / longContext / maxUploadBytes.
  - `capabilityNeedsForKind(kind)` — deterministic input kind → capability map.
  - `canHandleObject`, `withinUploadLimit` fail-closed guards; `noProviderCapabilities`
    (nothing assumed); deterministic `BASELINE` profiles for shipped providers
    (unknown/custom providers start at no capabilities); `mergeCapabilityProfiles`
    validates maxUploadBytes and never invents flags.
- **Registry (`electron/input/provider-capability-registry.ts`)**
  - Durable per-provider override store (`provider-capabilities.json`, schema v1):
    `capabilitiesFor` (baseline ∪ overrides), `setOverride(providerId, partial, verifiedBy)`,
    `reset(providerId)`, restart-safe.
- **Attachment Router (`electron/input/attachment-router.ts`)**
  - `routeInputObjects({objects, providers}) → ResolutionPlan`:
    per-object assignments, required capability vocabulary, chosen provider group.
    Multi-file turns require a `multipleFiles` provider that can read every kind;
    size/availability enforced; no capable provider → `mode: "WORK"` with a concrete
    `escalationReason` (switch provider → deterministic conversion).
  - `routeTextOnly(providers, preferredIds)` — cheapest/preferred available text reader.
  - `requiredCapabilitiesFor(objects)` helper.
- **Main wiring** — registry + store instances created at startup.

## Acceptance (Phase C)

- Router never assigns a PDF to a provider without `pdfUpload`; picks the
  highest-preference available capable provider; escalates honestly when no open
  provider can carry the turn (covered: single-type route, no-capability refusal,
  mixed multi-file grouping, all-can't-carry escalation, size limit + availability,
  text-only preference order).
- Registry restores overrides after restart and returns to baseline on reset.
- Verified by `tests/provider-capabilities.test.ts` (11 tests).

## Verification

- `pnpm run typecheck` — green.
- `pnpm vitest run tests/provider-capabilities.test.ts` — 11 passed.
- Full suite re-run at phase close: pending.

## Next

Phase D — Web AI file upload: extend adapters/page-scripts with real upload
(open conversation → upload → verify attachment chip → prompt → send) and verify
the baseline profiles against the actual DOM, upgrading the registry
`verifiedBy` from "baseline" to adapter-verified.
