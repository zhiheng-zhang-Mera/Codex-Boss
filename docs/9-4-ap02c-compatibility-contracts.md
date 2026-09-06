# AP02c — Compatibility Version Contracts (Core / Capability / Adapter API)

Compact handoff for Acceptance Pack **AP02c** (plan §6 Runtime Compatibility Contracts).
Branch `9-4`.

## Why

Boss previously recorded only opaque per-run labels (`adapterVersion: "api-openai-compatible/v1"`,
`"chatgpt-web/2026-09-v1"`) that were never checked. The plan requires explicit version axes
(Core API / Capability Contract / Adapter API) and provider/adapter declarations of
`min_supported_version` / `max_supported_version`, so an upgrade never silently assumes every
adapter moved in lockstep.

## What was added

- **`src/shared/compatibility.ts`** (new)
  - `CompatibilityAxis = "core_api" | "capability_contract" | "adapter_api"`;
    `CURRENT_VERSIONS` per axis (all `"1"` today).
  - `VersionWindow { min, max }`, `compareVersions` (dotted numeric), `versionInWindow`,
    `CompatibilityDeclaration { id, kind, windows }`, and `compatibilityIssue(declaration)`
    returning a human reason when any declared window excludes the current core version.
- **`electron/runtimes/runtime.ts`** — `RuntimeAdapter` gains optional
  `readonly compatibility?: CompatibilityDeclaration` (absence = legacy/unversioned, accepted).
- **`electron/commander/runtime-registry.ts`** — `register()` fails fast when a runtime declares
  an out-of-window contract, with the specific axis/version reason, instead of discovering the
  mismatch at dispatch.
- Concrete declarations added to the shipped adapters:
  - `NativeRuntime` (`local:native`) — `adapter_api 1..1`
  - `ApiRuntime` (`api:<provider>`) — `adapter_api 1..1`
  - `CodexCliRuntime` (`codex:cli`) — `adapter_api 1..1` + `capability_contract 1..1`
  - `ProviderRuntimeAdapter` (`web:<provider>`) — `adapter_api 1..1`
- **`tests/compatibility.test.ts`** (new, 4 tests) — version comparison/window semantics,
  null-issue on compatible declarations, fail-closed reason on out-of-window, and registry
  registration of the real adapters + rejection of an out-of-contract stub.

## Verification

- Targeted: `compatibility` (4) + `runtime-registry` + `codex-cli-runtime` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green (all added fields are optional or additive).

## Boundary notes

- Workspace Schema Version and Artifact Schema Version are reserved axes once those objects
  exist (AP01/AP05); only the three contracts that have real objects today were versioned.
- Existing web page-selector adapters keep their `AdapterDefinition.version` display label; their
  RuntimeAdapter wrappers now declare the adapter-API window.
- `UnsupportedRuntime` stubs declare no window and stay accepted-but-`UNSUPPORTED` at health
  check, preserving the "configured but not implemented" story.

## Checkpoint

Commit with: `src/shared/compatibility.ts`, `electron/runtimes/runtime.ts`,
`electron/runtimes/native-api-runtime.ts`, `electron/runtimes/codex/codex-cli-runtime.ts`,
`electron/runtimes/web/provider-runtime-adapter.ts`, `electron/commander/runtime-registry.ts`,
`tests/compatibility.test.ts`.
