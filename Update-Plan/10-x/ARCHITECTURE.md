# 10.x Architecture — Contract Documentation (Phase 10A)

Status: Phase 10A (architecture boundary definition).
Branch target: forward development branch `9-10-M` (owner-designated cloud name).
Contract set version: `10.0.0` — see `src/shared/tenx/contracts.ts`.

## 1. Purpose

This directory defines the 10.x forward architecture for Codex Boss before any
large implementation is layered on. The architecture goal is unchanged from the
taskbook:

```text
Single Device   = fully functional Boss node
Multiple Devices = cooperative Boss fleet
```

Every contract below is platform-neutral: it is expressible as plain JSON, uses
no Windows/Linux/macOS-specific assumptions, and is carried by adapters when a
real host must be touched. Contracts in this directory are 10.x-owned; they do
not read, inherit, or modify any older closure requirement-manifest state.

## 2. Contract documents

| Contract | File | Owning phase |
|---|---|---|
| Node identity & capability advertisement | NODE-CONTRACT.md | 10B |
| Device self-inspection report | (schema in NODE-CONTRACT + inspection module) | 10C |
| Fleet control plane | FLEET-CONTRACT.md | 10D |
| Task lease & ownership | FLEET-CONTRACT.md (lease/ownership) + scheduler | 10E/10F |
| Shared knowledge space | KNOWLEDGE-CONTRACT.md | 10G–10J |
| Artifact & memory architecture | ARTIFACT-CONTRACT.md | 10K |
| Network routing vNext | NETWORK-CONTRACT.md | 10L/10M |
| Session lifecycle vNext & login health | SESSION-CONTRACT.md | 10N/10O |
| Failure isolation | FLEET-CONTRACT.md (degraded/offline) | 10P |
| Platform adapter layer | NETWORK-CONTRACT.md + platform module | 10Q |
| Observability | observability module (10R) | 10R |

## 3. Universal principles

1. **Fail isolated.** Any single module — fleet controller, provider matrix,
   KB backend, proxy — may fail, be disabled, or be partially complete without
   crashing Boss or unrelated work (§23 module failure rule).
2. **Fail explicit.** Unknown schema, unknown capability, or missing
   observation yields an explicit UNKNOWN/DEGRADED state, never a fabricated
   READY/SUCCESS.
3. **Provenance preserved.** Artifacts, knowledge, checkpoints, and task
   ownership all carry `nodeId`/`runId`/`createdAt`-style provenance so a claim
   can always be traced to its source.
4. **Local first.** A single node must work with no fleet and no remote KB;
   fleet mode and shared-KB mode are enhancements.
5. **Offline is a state, not a crash.** Every node has a degraded/offline
   posture; unrelated work continues.
6. **No forced uniformity.** Node A may route DIRECT while Node B routes
   PROXY; per-node network and provider choice are first-class.

## 4. Schema skeleton

`src/shared/tenx/contracts.ts` provides the shared vocabulary:

- `TENX_CONTRACT_VERSION = "10.0.0"` — one immutable generation marker.
- `TenxContractId` + `TENX_CONTRACTS` — the complete phase→contract coverage.
- `TENX_SCHEMA_MARKERS` — per-contract integer schema generations.
- `TenxEnvelope` — the universal cross-node wire envelope (schema/version/kind/
  nodeId/sentAt/payload).
- `isTenxEnvelope` — deterministic structural validation.
- `roundTrip` — JSON round-trip helper shared by schemas.

Rules for contributors:

- No `node:` import, no Electron import, no `process`/`os`/`fs` in
  `src/shared/tenx/**`; the neutrality test enforces this.
- Any field added to a contract increments its schema marker (append-compatible
  by default; breaking changes must be a separate schema generation).
- All timestamps are ISO-8601 UTC strings; all ids are strings; all enums are
  string unions.

## 5. Implementation order

The taskbook phase order is preserved (10A → 10S). Each phase adds: docs (where
needed), schema/interface evolution, deterministic unit tests, failure/degraded
tests, typecheck + build green, evidence JSON under `evidence/<phase>/`, and a
separate commit. Scenario/regression evidence is preserved and never deleted by
later builds (§27).
