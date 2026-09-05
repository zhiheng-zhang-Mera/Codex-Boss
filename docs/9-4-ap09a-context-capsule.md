# AP09a — Context Capsule Compiler (C0/C1 + fingerprint)

Compact handoff for Acceptance Pack **AP09a** (plan §1.2 context hierarchy + AP09 context
isolation; audit: no C0/C1/C2 capsule compiler). Branch `9-4`.

## Why

ContextManager already assembled/pruned task context with char budgets, but there was no
first-class C0/C1 capsule model nor a deterministic content fingerprint for cache decisions. The
plan wants C0 (symbol) / C1 (module) / C2 (architecture) capsules with content addressing so
context drift can invalidate caches.

## What was added

- **`src/shared/context-capsule.ts`** (new, pure)
  - `ContextCapsule { level: C0|C1, sections, chars, fingerprint }`;
    `compileContextCapsule(input)` — C0 = role + objective; C1 layers required `files` then
    dependency outputs, all pruned to `maxChars`; `fingerprint` is the deterministic canonical
    sections hash (drift signal).
  - `capsuleFingerprint(input)` / `canonicalize` helpers.
- **`electron/commander/context-manager.ts`**
  - `capsule(taskId, role, files?, maxChars?)` builds a C0/C1 capsule from the stored task
    context (objective/constraints + open disputes + summaries as dependency layer) — a real
    consumer of the compiler for cache-key generation.
- **`tests/context-capsule.test.ts`** (new, 5 tests) — C0 without file layers, C1 promotion +
    budget pruning, deterministic/differing fingerprints, C0 stays with huge budget, and
    ContextManager capsule adoption.

## Verification

- Targeted: `context-capsule` (5) + `context-manager` PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- This is the compiler/level model seed. C2 (architecture) capsules, required-context
  resolution over the repo graph and actually keying worker caches off capsule fingerprints are
  the remaining AP09 half (consumers: ExecutionSupervisor cache / AP11 content-addressed cache).
- Fingerprint is canonical-JSON (deterministic), not yet sha256; hashing it for the cache layer
  is one line at the consumer.

## Checkpoint

Commit with: `src/shared/context-capsule.ts`, `electron/commander/context-manager.ts`,
`tests/context-capsule.test.ts`.
