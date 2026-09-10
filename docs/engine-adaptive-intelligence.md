# Adaptive Provider Intelligence — implementation notes (Engine plan)

Source plan: `Update-Plan/Engine/00-ENGINEERING-BOOK.md` … `04-MIGRATION-ROLLBACK.md`.
This document describes what was actually built, and the contract a future
contributor must keep.

## 1. Architecture

```text
MainCommander ──► RoleRouter ──► Runtime ──► RuntimeResult        (unchanged core)
                     │
                     └─ optional AdaptiveReranker (soft ranking only)
                              │
   ┌──────────────────────────┴─────────────────────────────────────────────┐
   │ electron/learning/  (Adaptive Provider Intelligence — all optional)    │
   │                                                                        │
   │  adaptive-flag-store ──► flags (all OFF by default, single kill switch)│
   │  episode-store ─────────► append-only episodes.jsonl + revisions.jsonl │
   │  outcome-evaluator ─────► RuntimeOutcome ‖ SemanticOutcome             │
   │  providers/model-* ─────► ModelSnapshotRegistry (dedup by identity)    │
   │  providers/behaviour-* ─► epochs, profiles, change-point detection     │
   │  concepts/* ────────────► mined concepts (registry/miner/merge/split)  │
   │  routing/adaptive-scorer► expected utility, explanation, exploration   │
   │  routing/routing-feedback► decision log ("why B not A")                │
   │  evolution/* ───────────► candidate → replay → shadow → trial → promote│
   │  learning-service ──────► single facade + owner controls (IPC/UI)      │
   └────────────────────────────────────────────────────────────────────────┘
```

Data layering (Engine §17): `Raw Artifact / Runtime Result / Learning Episode`
are the SOURCE OF TRUTH; `Provider Profile / Concept / Epoch statistics / routing
cache` are DERIVED and may be deleted and rebuilt at any time.

## 2. Runtime adapter contract (unchanged, additive only)

`RuntimeResult` keeps its four statuses (`SUCCESS`, `RETRYABLE_FAILURE`,
`PERMANENT_FAILURE`, `CANCELLED`) and every optional field. No adapter has to be
migrated: an adapter that exposes no model identity simply yields
`observedModelId: undefined` and `versionSource: UNKNOWN` (never a guess).

Optional additive field for adapters that can observe identity:

```ts
modelSnapshotId?: string;   // set when the pipeline recorded a ModelSnapshot
```

## 3. Routing contract

Hard eligibility (capability, availability, explicit pin/exclude, budget,
deterministic fallback) belongs to `RoleRouter` and is never touched by learning.

A reranker may only:
- reorder the candidate set it receives (the router re-validates that the set is
  identical — no additions, removals or duplicates);
- keep an explicit pin in the top position;
- return `undefined`/throw to fall back to the deterministic order.

It may NOT: restore an excluded or capability-less runtime, bypass permissions,
the ExecutionGate, or an irreversible-action boundary, or alter the candidate set.

## 4. Failure taxonomy

| Layer | Failure | Behaviour |
|---|---|---|
| Runtime | TIMEOUT / AUTH_REQUIRED / PAGE_CHANGED / RATE_LIMITED | Semantic outcome `UNCLASSIFIED`, `runtimeAttributable: true`, `penalizesSemanticProfile: false` — excluded from semantic aggregates |
| Runtime | call failed | recorded as `runtimeStatus`, counted in `runtimeReliability` only |
| Semantic | refusal / partial / sanitization / drift / format / verification | explicit `SemanticOutcome` + continuous axes |
| Learning | episode store corrupt | bad rows skipped, `degradedReason` recorded, tasks continue |
| Learning | profile store corrupt | no profile ⇒ deterministic routing |
| Learning | concept miner/registry broken | previous concepts kept, routing unchanged |
| Learning | epoch detector/ledger broken | no epoch separation, tasks continue |
| Learning | adaptive scorer throws | `RoleRouter` keeps its own order (`usedFallbackRouter`) |
| Security | permission/approval missing | still fail-closed — learning never relaxes it |

## 5. Profile schema

`ProviderBehaviourProfile` (schemaVersion 1) — derived, rebuildable:

```text
profileId, runtimeId, provider?, surface?,
modelSnapshotKey?, behaviourEpochId?, parentProfileId?,
global { completion, goalFidelity, restrictionImpact, runtimeReliability,
         verificationPass, latency } : MetricEstimate { mean, confidence, samples, updatedAt }
byRole { <role>: Partial<global> }        // persisted only at >= 3 samples
conceptOverrides [ { conceptId, <metrics>, deviation } ]  // only meaningful (|Δ| >= 0.1)
builtFromEpisodeCount, builderVersion, rebuiltAt
```

Rebuild: `LearningService.rebuildDerived()` or
`ProviderProfileStore.rebuild(episodes)`. Reset: `resetDerived()` clears derived
data only — episodes are never touched (§12).

## 6. Migration guide

1. All Engine flags default OFF; nothing changes until an operator enables
   `adaptiveProviderLearning` (umbrella) plus a capability flag.
2. Persisted data is additive and versioned: episodes (`schemaVersion 1`),
   model snapshots, behaviour epochs, profiles, concepts, routing feedback,
   promotion gate. Existing state files are untouched.
3. `TaskIR.riskLevel` keeps its meaning (execution/side-effect risk). If it is ever
   renamed to `executionRiskLevel` (04 §2), read `executionRiskLevel ?? riskLevel`
   during the compatibility window; this was NOT changed here to keep the change
   surface small.
4. Derived data from an older builder version is flagged `stale` and can be
   rebuilt: `boss:learning-control` → `rebuild`.

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| Panel shows "degraded: … unreadable" | delete the offending derived JSON under `userData/.boss/learning` and press *rebuild* |
| No providers listed | learning is off, or no episodes recorded yet (`learning` checkbox) |
| Routing never adapts | `adaptiveRouting` capability requires the umbrella flag too |
| Learned ranking looks wrong | inspect the routing explanation (utility + per-metric n/confidence); low `n` means low trust |
| Old behaviour needed | *reset derived* (profiles/snapshots/decisions) or roll back the promoted policy version |
