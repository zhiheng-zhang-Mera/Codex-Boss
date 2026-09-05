# AP10 — Domain Router into Context + Deterministic Rerank (seam)

Compact handoff closing the remaining AP10 seam (plan AP10 Knowledge Core; audit: local backend
existed, domain router into context and rerank absent). Branch `9-5`.

## Why

AP10a shipped the knowledge catalog/taxonomy/retrieval backend with §15 trust fields, but
retrieval stayed trust-first matching only — there was no domain router (task goal → relevant
domain/shelf) and no rerank, and `ContextManager` could not pull domain knowledge into assembled
capsules. Plan §10 requires "Knowledge Size != Runtime Context Size" and routing knowledge by the
domain the task actually lives in.

## What was added

- **`src/shared/knowledge.ts`** (extended, pure)
  - `routeKnowledgeQuery(goal, entries)` — deterministic domain router: tokenizes the goal,
    scores catalog domains/tags by overlap, returns a `KnowledgeQuery` pinned to the best matching
    domain + up to 3 goal-matched tags (no embedding dependency).
  - `relevanceScore(entry, goal)` — deterministic relevance: title (×3) + tags (×2) + domain (×2)
    + content token overlap.
  - `retrieveReranked(entries, query, goal)` — same character budget as `retrieveWithinBudget`
    but candidates ordered by relevance → trust → recency.
- **`electron/knowledge/knowledge-store.ts`** (extended)
  - `retrieveForGoal(goal, query)` — domain-routes then reranks within the budget; callers get
    the slice relevant to the current goal instead of the whole library.
- **`electron/commander/context-manager.ts`** (wired)
  - `ContextManager` accepts an optional knowledge provider
    `(taskId, role, maxChars) => KnowledgeEntry[]` (constructor or `setKnowledgeProvider`) and
    `capsule()` folds returned entries in as `knowledge:<shelf>:<id>` dependency sections, so a
    knowledge slice travels with the compiled capsule under the same budget rules. Without a
    provider behavior is unchanged.
- **`tests/knowledge.test.ts`** (extended, 7 tests) — goal → domain/tag routing; relevance order
  beats trust; reranked + budgeted retrieval and `retrieveForGoal` auto-routing.

## Verification

- Targeted: `knowledge` (7), `context-manager` (3), `context-capsule` (7) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full suite: run with the batch before landing.

## Boundary notes

- Rerank is deterministic and token-based (plan §11 keeps embeddings optional/reserved).
- Knowledge enters context only through the injected provider; wiring the real
  `.boss/knowledge.json` store as the provider in `main.ts` is the follow-up adoption seam.

## Checkpoint

Commit with: `src/shared/knowledge.ts`, `electron/knowledge/knowledge-store.ts`,
`electron/commander/context-manager.ts`, `tests/knowledge.test.ts`, this handoff.
