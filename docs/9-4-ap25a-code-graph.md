# AP25a — Self Inspector / Code Knowledge Graph (seed)

Compact handoff for Acceptance Pack **AP25a** (plan AP25 Self Inspector + Code Knowledge Graph;
audit: net-new MISSING). Branch `9-4`.

## Why

The plan wants an incremental code graph (files, imports, tests, per-module responsibilities,
change risk) that is maintained without full-repo rebuilds, so self-inspection and
self-diagnosis have a ground truth. The repo inspector (AP04a) gives files + fingerprints and
semantic-slice (AP04b) gives import edges — this pack composes them into a queryable graph with
a change-risk score, cached per repo signature.

## What was added

- **`electron/engineering/code-graph.ts`** (new)
  - `CodeGraphModule { file, tests[], outbound, inbound, changeRisk }`;
    `CodeGraph { modules, edges, builtForSignature }`.
  - `buildCodeGraph(snapshot)` — modules are non-test source files; `tests` are the test files
    that import the module; `changeRisk = inbound + outbound` (broad surface = riskier), sorted
    descending by risk.
  - `cachedCodeGraph(root, cache, snapshot)` — content-addressed by repo signature via the
    AP11a cache (incremental: unchanged tree reuses the graph).
  - `moduleRisk(graph, file)` lookup.
- **`tests/code-graph.test.ts`** (new, 3 tests) — module own-tests/dependency counts + risk,
  cache hit on unchanged tree + invalidation on content change, risk-sorted order.

## Verification

- Targeted: `code-graph` (3) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- This is the graph/risk seed. Module *responsibilities* (docstring/semantic summaries),
  runtime metrics per module and self-diagnosis over failure clusters are the remaining AP25
  half — the graph is the index they query.
- Graph is per repo root; wiring per-workspace durable roots is consistent with AP01b.

## Checkpoint

Commit with: `electron/engineering/code-graph.ts`, `tests/code-graph.test.ts`.
