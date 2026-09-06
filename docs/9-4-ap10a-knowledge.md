# AP10a — Domain-Routed Knowledge Core (local backend seed)

Compact handoff for Acceptance Pack **AP10a** (plan AP10 Knowledge Core + §15 reserved
trust/freshness/conflict metadata; audit item 1: NONE existed). Branch `9-4`.

## Why

The audits found zero knowledge infrastructure (only `ScopedMemory` KV and per-task context).
The plan requires a catalog/taxonomy/shelves/retrieval local backend with trust metadata, and
mandates the hard rule "知识库大小 != 运行时 context 大小" (retrieval budget). This pack is the
net-new local backend seed.

## What was added

- **`src/shared/knowledge.ts`** (new, pure)
  - `KnowledgeEntry { id, domain, shelf, tags, title, content, source, trust:
    UNVERIFIED|LOW|MEDIUM|HIGH, validFrom?, validUntil?, supersedes?, conflictGroup?,
    createdAt, updatedAt }` — reserved fields for v3 governance per §15.
  - `KnowledgeQuery`, `entryMatches` (domain/shelf/tags/trust/validity), `TRUST_ORDER`,
    `retrieveWithinBudget` (deterministic trust-first retrieval honoring `maxChars` — the
    knowledge size ≠ context size rule), `taxonomyOf`.
- **`electron/knowledge/knowledge-store.ts`** (new)
  - `KnowledgeStore` — schemaVersion-1 persisted catalog (`put/list/retrieve/taxonomy`),
    shelf-scoped listing, supersede-aware `put` (an entry replaces the one it supersedes),
    fail-closed corrupt reads.
- **`tests/knowledge.test.ts`** (new, 4 tests) — shelf/taxonomy persistence, supersede, filter
  + retrieval budget semantics, corrupt fail-closed.

## Verification

- Targeted: `knowledge` (4) PASS.
- Electron `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Retrieval is deterministic tag/domain/trust matching — no embeddings/rerank (AP11) and no
  auto-ingestion (AP20/v3). This is the local backend, not the runtime context compiler; wiring
  a Domain Router into `ContextManager` assembly is the next step.
- Store is file-scoped; attaching a real catalog instance at app start (`.boss/knowledge.json`)
  is follow-up wiring.
- `conflictGroup`/`supersedes`/trust fields are recorded but governance (conflict resolution,
  trust scoring, aging) is reserved for v3 per §15.

## Checkpoint

Commit with: `src/shared/knowledge.ts`, `electron/knowledge/knowledge-store.ts`,
`tests/knowledge.test.ts`.
