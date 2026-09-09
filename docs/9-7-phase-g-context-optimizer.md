# 9-7 Phase G — Context Optimizer（稳定前缀 / repo manifest / dedup / token budget）

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase G. Branch `9-7`.

## Why

Even with a 1M-context model, re-sending unchanged code every round is the
biggest token waste (plan §22/§23/§24/§26). Repeated tasks must reuse cached
content hashes, never re-summarize unchanged files, and keep a stable static
prompt prefix so DeepSeek context cache hits (plan §20).

## What was added

- **Repo manifest (`electron/input/repo-manifest.ts`)**
  - `statWorkspace` — bounded walk (heavy dirs skipped) returning posix paths +
    size + mtimeMs.
  - `RepoManifestStore.scan(root)` — incremental content index: unchanged rows
    (same size+mtime) keep their prior sha256 **without re-reading the file**;
    only stat-changed/new files are re-hashed. Persists `<root>/.boss/
    workspace-index/manifest.json` shape and returns a typed `ManifestDelta`
    {changed, removed, unchanged}.
  - `hashFor(relativePath)` — deterministic lookup used by dedup callers.
- **Stable prompt layout (`src/shared/prompt-layout.ts`)** — plan §20/§21:
  - `assembleStablePrompt(static, dynamic)` — fixed order [SYSTEM POLICY →
    BOSS ROLE → TOOL CONTRACT → OUTPUT SCHEMA → PROJECT MANIFEST] first, then
    dynamic [TASK → CONTEXT PACKAGE → TOOL RESULTS] after a separator. Static
    half stays byte-identical when inputs are unchanged.
  - `staticPrefixFingerprint` — pure deterministic hash of the static half;
    unchanged contracts → unchanged fingerprint (cache-key/audit input).
- **Token budget manager (`electron/commander/token-budget-manager.ts`)** —
  plan §26:
  - Durable ledger (schema v1) recording {taskId, stage, model, inputTokens,
    cacheHitTokens, cacheMissTokens, outputTokens, estimatedCost}.
  - `spendFor(taskId)`, `statusFor(taskId, stage)` with soft ceilings per stage
    (router tiny → research extended) and a concrete degradation ladder:
    compress context → prefix-stability note when cache hit < 30% → drop stale
    artifacts / switch Pro→Flash / request only delta when > 2× soft limit.
  - `recent()` audit view. Stage/model names are strings so this ledger feeds
    the Phase H model policy without new coupling.

## Acceptance (Phase G)

- Untouched workspace → second scan reports no changes and reuses hashes
  (verified: same `hashFor` result, zero changed files).
- Edit/add/remove → exact delta; node_modules excluded; manifest restarts from
  disk.
- Static prompt half is byte-stable across changing tasks; fingerprint stable.
- Budget ledger: per-stage aggregation, soft-limit flags and concrete advice.
- Verified by `tests/context-optimizer.test.ts` (8 tests).

## Verification

- `pnpm run typecheck` — green.
- `pnpm vitest run tests/context-optimizer.test.ts` — 8 passed.

## Next

Phase H — DeepSeek V4 ModelPolicy (flash non-thinking/low, pro high/max,
explicit maxOutputTokens, JSON output) + cache-friendly request ordering built
on the stable prompt layout.
