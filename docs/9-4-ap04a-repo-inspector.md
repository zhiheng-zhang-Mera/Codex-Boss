# AP04a — Development Plane: Repo Inspector + Test Map + Context Fingerprint

Compact handoff for Acceptance Pack **AP04a** (plan AP04 foundation + §13.3 incremental
everything / §13.4 content addressing). Branch `9-4`.

## Why

The audit marked all of AP04's dev-plane tooling MISSING. Before this pack there was no shared
index of the repo, no test map, and every consumer re-walked the filesystem ad hoc
(`requiredEngineeringChecks` had its own visitor; `PlanCompiler` did a shallow `readdir` + slice
of 100). This pack seeds the Development Plane with the smallest genuinely-adopted piece: a
bounded deterministic repo index with a per-directory test map + change fingerprint, and a
context-fingerprint primitive.

## What was added

- **`electron/engineering/repo-inspector.ts`** (new)
  - `scanRepo(root)` — bounded walk (50k entries; skips symlinks, dot-entries and
    node_modules/artifacts/dist/dist-electron/runtime-data/history/coverage/.git/.cache/
    .codex-boss/.codex-controller), deterministic posix relative paths, produces
    `RepoSnapshot { files[], testMap[dir][] , skippedDirectories, fingerprint }`.
  - `discoverTestFiles(root)` — flattened test map.
  - `selectTestsForFiles(snapshot, changedFiles)` — targeted-test seed: tests co-located in the
    same directory or subdirectories of each changed file.
  - `fingerprint` = sha256 over the sorted file list (index-invalidation signal).
- **`electron/engineering/verification-policy.ts`**
  - `requiredEngineeringChecks` now discovers tests through the inspector instead of its own
    duplicated walk (identical semantics + existing "No test files discovered" fail-closed).
- **`electron/commander/plan-compiler.ts`**
  - Planner inventory now uses the repo index (deep, deterministic, ignores dependency trees)
    rather than a shallow first-100 `readdir` listing.
- **`src/shared/context-fingerprint.ts`** (new, pure)
  - `canonicalJson` (undefined-free stable JSON) + `canonicalSections` for deterministic
    content-addressable hashing inputs (plan §13.4); node-free so it can be shared with the
    renderer.
- **`tests/repo-inspector.test.ts`** (new, 5 tests) — index/test-map/fingerprint, fingerprint
  change on add + targeted selection, verification-policy adoption, planner inventory adoption,
  canonical section determinism.

## Verification

- Targeted: `repo-inspector` (5) + `plan-integration` (14) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- This is the **index/fingerprint base only**. Symbol index, dependency index, semantic code
  slice, context-capsule compiler and full targeted-test automation remain queued (AP04b); the
  selector here is the co-location seed they build on.
- The fingerprint is an invalidation signal, not a cache itself; content-addressed caching with
  version+policy keys is AP11/§13.5.
- scanRepo intentionally mirrors the old discovery skip-list plus dot-entries so engineering
  verification semantics are preserved.

## Checkpoint

Commit with: `electron/engineering/repo-inspector.ts`,
`electron/engineering/verification-policy.ts`, `electron/commander/plan-compiler.ts`,
`src/shared/context-fingerprint.ts`, `tests/repo-inspector.test.ts`.
