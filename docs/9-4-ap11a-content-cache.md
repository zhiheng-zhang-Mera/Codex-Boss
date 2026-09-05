# AP11a — Content-Addressed Cache + Repo-Scan Invalidation

Compact handoff for Acceptance Pack **AP11a** (plan §13.4 content-addressed cache + §13.5
invalidation graph; audit item 10). Branch `9-4`.

## Why

The audits found only targeted fingerprint reuse (ledger job keys, graph re-validation) and no
generic cache store or explicit invalidation. The plan wants hash+version+policy keys with a
cache-invalidation graph so one observed change drops every dependent entry. The repo scan
(`scanRepo`) is re-run on every plan/verification path — the cheapest, highest-value first
consumer.

## What was added

- **`electron/cache/content-cache.ts`** (new)
  - `ContentCache<T>` — keyed by `key(scope, policy, input)` = sha256 over scope + kind +
    version + canonical input (content addressing); `get/put` with dependency scopes,
    `invalidate(dependencyScope)` drops every dependent entry (invalidation graph), `clear/
    size`, optional schemaVersion-1 persistence, fail-closed corrupt files.
- **`electron/engineering/cached-repo-scan.ts`** (new)
  - `repoScanSignature(snapshot)` — deterministic cheap signature (path + size + mtimeMs of
    every scanned file, no content reads).
  - `cachedScanRepo(root, cache)` — returns `{snapshot, fromCache}`; an unchanged tree reuses
    the cached full scan; a content/size change produces a signature miss and rescans, storing
    under the repo dependency scope.
- **`tests/content-cache.test.ts`** (new, 6 tests) — put/get + scope invalidation, input/version
  key sensitivity, persistence + corrupt fail-closed, cache hit on unchanged tree, miss on
  change, explicit repo-scope invalidation.

## Verification

- Targeted: `content-cache` (6) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Only repo scans are cached so far; context capsules (AP09a) and other fingerprints can plug
  into the same store later. The cache is in-memory by default; persistence is available via
  the file constructor (no app wiring yet).
- The signature uses size + mtimeMs, so an in-place same-size rewrite may not invalidate on
  coarse-mtime filesystems — callers that need content guarantees should include a content hash
  in the key.

## Checkpoint

Commit with: `electron/cache/content-cache.ts`, `electron/engineering/cached-repo-scan.ts`,
`tests/content-cache.test.ts`.
