# AP21 — Generic Software Runtime + Software Adapter SDK

Compact handoff for Acceptance Pack **AP21** (plan §21 Generic Software Runtime; audit: net-new
v3, session-lease ownership existed from AP19a). Branch `9-5`.

## Why

SoftwareSession ownership/lease existed (AP19a), but there was no generic software runtime: no
adapter declaration + capability graph, no deterministic action planner, no permission gate on
software mutations, no health/observation/artifact-exchange surface. Plan §21 requires a runtime
where software execution is a first-class, controlled capability (native/CLI → script → plugin →
semantic → vision).

## What was added

- **`src/shared/software-adapter.ts`** (new, pure)
  - `SoftwareAction { kind, capability, params }` (+`validateSoftwareAction`),
    `SoftwareObservation`, `SoftwareVerification`, `SoftwareCapability {id, family, readsOnly}`,
    `SoftwareAdapterDeclaration {id, kind, version, capabilities, contract}`,
    `SoftwareHealth`, `ArtifactExchange`.
  - `planSoftwareActions(adapter, requestedCapabilities)` — deterministic bounded plan
    (open → reads-first commands → verify), rejects unknown capability ids;
    `adapterSupports`/`capabilityFor` fail-closed.
- **`electron/software/software-runtime.ts`** (new)
  - `SoftwareSessionRegistry(adapter, executor, leases?)` — orchestration over an injected
    executor (real adapter bridge vs deterministic test fake):
    - `run({actions, permission, lease})` — obtains an exclusive/shared-read lease from the
      AP19a `SoftwareLeaseRegistry`, authorizes every mutating action against the workspace
      PermissionManifest (`side-effect` scope), executes and verifies;
    - `plan(requestedCapabilities)`; `setHealth`/`health`; `recordExchange`/`listExchanges`;
    - Permission gate is fail-closed: an un-allow-listed mutation never reaches the executor.
- **`tests/software-runtime.test.ts`** (new, 5 tests) — capability lookup + action validation;
  deterministic plan ordering (reads before mutations) + unknown-capability rejection;
  permission-gated execution under exclusive lease; manifest denial; health + artifact exchange
  recording with failed verification isolated.

## Verification

- Targeted: `software-runtime` (5) + `software-lease` (6) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Executors are injected (never arbitrary shell strings); the real Blender/Unreal bridges
  (AP22/AP23) implement the same declaration + executor surface.
- Recovery/health semantics are per-adapter health records today; the lease registry already
  yields expired sessions automatically, giving a recovery baseline without new machinery.

## Checkpoint

Commit with: `src/shared/software-adapter.ts`, `electron/software/software-runtime.ts`,
`tests/software-runtime.test.ts`, this handoff.
