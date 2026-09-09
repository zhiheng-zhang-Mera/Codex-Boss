# AP22 + AP23 — Blender / Unreal Adapters

Compact handoff for Acceptance Packs **AP22** (Blender Adapter) and **AP23** (Unreal Adapter)
(plan §23/AP22/AP23; audit: net-new v3, vision/semantic primitives existed, no software
adapters). Branch `9-5`.

## Why

Plan §22/§23 require structured software adapters for Blender and Unreal with a strict control
hierarchy (native CLI/script → addon/remote → semantic GUI) and the Blender-artifact → export →
Unreal import → placement → test chain. There was no adapter surface at all. This pack delivers
the two adapters on top of the AP21 Software Adapter SDK with deterministic, fail-closed command
execution and graceful absence detection.

## What was added

- **`src/shared/software-commands.ts`** (new, pure)
  - `blenderScript`/`unrealScript` — python prefixes with capability marker;
  - `blenderCommand` — `executable --background [project] --python file -- [--render-frame N --output …]`;
  - `unrealCommand` — `[project] -run=pythonscript -script=file [-output=…]`;
  - `AdapterCommandSpec { executable, args, cwd, timeoutMs, expectedOutputs }` +
    `resolveExecutable(configured, candidates, exists)` — deterministic resolution,
    graceful absence.
- **`electron/software/media-adapters.ts`** (new)
  - `BlenderAdapter` — declares the §22 capability surface (scene read/create, mesh,
    materials, lighting, camera, animation, render, import, export; script/cli families) and
    `run()` executes `blenderCommand` through an injected runner (production default =
    `execFile`, tests inject a deterministic fake). `detect()` reports DOWN with a clear message
    when Blender is absent — never throws into the caller.
  - `UnrealAdapter` — declares the §23 surface (scene, import, placement, build, test, export)
    and `run()` executes `unrealCommand`; identical graceful-absence semantics.
- **`tests/media-adapters.test.ts`** (new, 7 tests) — declared capability surfaces incl. the
  Blender→Unreal import/placement/test chain; graceful DOWN when absent; structured argv
  capture + pass/fail semantics; deterministic executable resolution + script prefixes.

## Verification

- Targeted: `media-adapters` (7) + `software-runtime` (5) PASS; typecheck PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- No `shell:true`, no model-generated strings: every command is `execFile(executable, args)`
  from the pure command builder. Real Blender/Unreal cannot run in CI, so the adapters are
  verified through injected runners + graceful absence; live E2E (AP30 Blender/Unreal crash
  rows) requires a machine with those tools.
- The Blender→Unreal artifact chain (export artifact → import → placement → test) is expressed
  as capability ids here; the orchestration that drives it end-to-end sits with the AP21
  registry/AP24 perception loop.

## Checkpoint

Commit with: `src/shared/software-commands.ts`, `electron/software/media-adapters.ts`,
`tests/media-adapters.test.ts`, this handoff.
