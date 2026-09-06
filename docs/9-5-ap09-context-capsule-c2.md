# AP09 — C2 Capsules + Required-Context Resolver + Cache-Key Wiring (seam)

Compact handoff closing the remaining AP09 seam (plan §1.2 / AP09; audit: C0/C1 capsules existed,
no C2 architecture layer, no required-context resolver, cache-key wiring absent). Branch `9-5`.

## Why

The context capsule compiler only knew C0 (role+objective) and C1 (files/dependencies). Plan §1.2
defines C2 for architectural/cross-file work ("C2 Architecture — 核心接口迁移/安全边界"), and plan
§13.4/§13.5 requires content-addressed caching of assembled context with an explicit key. This
pack adds the C2 layer, a deterministic required-context resolver, and the cache-key derivation
on `ContextManager`.

## What was added

- **`src/shared/context-capsule.ts`** (extended, pure)
  - `ContextCapsuleLevel` is now `"C0" | "C1" | "C2"`; `CapsuleInput.architecture` (interfaces,
    module boundaries, dependency edges) and exported `C2_CHARS = 64000`.
  - `compileContextCapsule` promotes to C2 when an architecture slice is present (within the C2
    budget; otherwise C1/C0 exactly as before — no regression for file-only capsules).
  - `requiredContextLevel({kind, requiredFiles, dependencies, hasArchitecture?, crossModule?})` —
    deterministic resolver: no files → C0; scoped files → C1; architecture/cross-module or wide
    file/dependency scope → C2.
  - `capsuleCacheKeyInput(input)` → `{level, fingerprint, chars}` (the context-dependency part of
    the plan §13.4 key).
- **`electron/commander/context-manager.ts`** (wired)
  - `capsule()` accepts an optional `architecture` slice and returns C2 capsules.
  - `capsuleCacheKey(taskId, role, files?, maxChars?, architecture?)` → content-addressed key
    `sha256(scope|kind|version|level|fingerprint)` with `scope = task-context:<taskId>` (kind
    `context-capsule`, version 2). Consumers store/load through `ContentCache` and invalidate on
    scope/input drift.
- **`tests/context-capsule.test.ts`** (extended, 7 tests) — C2 promotion with an architecture
  slice; cache-key derivation, scope, level, fingerprint equality with the compiled capsule, and
  key change on file-content drift; required-context C0/C1/C2 selection incl. cross-module and
  wide-file cases.

## Verification

- Targeted: `context-capsule` (7) + `context-manager` (3) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Existing C0/C1 behavior is byte-identical for callers that pass no architecture slice.
- The cache *store* (`ContentCache`) already exists (AP11a); this pack wires the capsule cache
  key derivation — adopting the cache inside `ContextManager.capsule` call sites is the natural
  next consumer seam (engineering context assembly).

## Checkpoint

Commit with: `src/shared/context-capsule.ts`, `electron/commander/context-manager.ts`,
`tests/context-capsule.test.ts`, this handoff.
