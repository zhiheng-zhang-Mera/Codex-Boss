# Engine acceptance report — Adaptive Provider Intelligence

Standard: `Update-Plan/Engine/03-ACCEPTANCE-MATRIX.md` (A01–A50) plus its three
mandatory batteries (failure injection, statistical pollution, version
isolation). Branch: `9-10-M`. Contract set: additive, all flags default OFF.

## Matrix

| ID | Requirement | Result | Evidence |
|---|---|---|---|
| A01 | all adaptive flags off ⇒ original stable routing | PASS | `engine-phase-0.test.ts` (flags default false; RoleRouter oracle), `engine-acceptance.test.ts` |
| A02 | runtime SUCCESS + normal ⇒ FULL_COMPLETION | PASS | `engine-phase-1.test.ts` |
| A03 | runtime SUCCESS + refusal ⇒ HARD_REFUSAL, not a runtime failure | PASS | `engine-phase-1.test.ts` |
| A04 | partial completion vs partial refusal distinguishable | PASS | `engine-phase-1.test.ts` |
| A05 | TIMEOUT adds no restriction penalty | PASS | `engine-phase-1.test.ts`, `engine-acceptance.test.ts` |
| A06 | AUTH_REQUIRED adds no capability/restriction penalty | PASS | `engine-phase-1.test.ts`, `engine-acceptance.test.ts` |
| A07 | PAGE_CHANGED adds no semantic negative evidence | PASS | `engine-phase-1.test.ts`, `engine-acceptance.test.ts` |
| A08 | goal drift recorded | PASS | `engine-phase-1.test.ts` |
| A09 | episodes queryable by task/job/runtime | PASS | `engine-phase-2.test.ts` |
| A10 | episode store restart loses nothing | PASS | `engine-phase-2.test.ts` |
| A11 | profile deleted ⇒ rebuildable from episodes | PASS | `engine-phase-5.test.ts`, `engine-phase-11.test.ts` |
| A12 | rebuild repeatable + version auditable | PASS | `engine-phase-5.test.ts` (builderVersion) |
| A13 | UI explicit model recorded | PASS | `engine-phase-3.test.ts` |
| A14 | Web Auto recorded as Auto, no fabricated backend id | PASS | `engine-phase-3.test.ts` |
| A15 | unobservable backend ⇒ undefined/UNKNOWN | PASS | `engine-phase-3.test.ts`, `engine-phase-11.test.ts` |
| A16 | one conversation, several turns ⇒ several snapshots | PASS | `engine-phase-3.test.ts` |
| A17 | identical snapshot dedups by reference | PASS | `engine-phase-3.test.ts` |
| A18 | new model id ⇒ new snapshot, old history intact | PASS | `engine-phase-3.test.ts` |
| A19 | sustained behaviour change ⇒ new epoch | PASS | `engine-phase-8.test.ts` |
| A20 | single anomaly ⇒ no new epoch | PASS | `engine-phase-8.test.ts` |
| A21 | new semantic cluster ⇒ concept without enum change | PASS | `engine-phase-7.test.ts` |
| A22 | concept rename does not affect id/history | PASS | `engine-phase-7.test.ts` |
| A23 | adaptive score only reorders hard-eligible candidates | PASS | `engine-phase-6.test.ts` |
| A24 | excluded runtime cannot be restored | PASS | `engine-phase-6.test.ts`, `engine-phase-9.test.ts` |
| A25 | capability-less runtime cannot be restored | PASS | `engine-phase-6.test.ts` |
| A26 | pinned runtime keeps explicit priority | PASS | `engine-phase-6.test.ts`, `engine-phase-9.test.ts` |
| A27 | adaptive service throws ⇒ existing RoleRouter | PASS | `engine-phase-6.test.ts`, `engine-acceptance.test.ts` |
| A28 | profile DB corrupt ⇒ base tasks still run | PASS | `engine-phase-5.test.ts`, `engine-phase-6.test.ts`, `engine-acceptance.test.ts` |
| A29 | concept miner broken ⇒ old concepts/basic routing | PASS | `engine-phase-7.test.ts`, `engine-acceptance.test.ts` |
| A30 | epoch detector broken ⇒ execution unaffected | PASS | `engine-phase-8.test.ts`, `engine-acceptance.test.ts` |
| A31 | historically low completion + high confidence ⇒ down-weighted | PASS | `engine-phase-6.test.ts` |
| A32 | unknown + competitive ⇒ bounded exploration | PASS | `engine-phase-9.test.ts` |
| A33 | new version inherits decayed prior (not reset, not full inherit) | PASS | `engine-phase-5.test.ts`, `engine-phase-8.test.ts`, `engine-acceptance.test.ts` |
| A34 | old-model history separately queryable | PASS | `engine-phase-8.test.ts`, `engine-acceptance.test.ts` |
| A35 | routing log explains B over A | PASS | `engine-phase-6.test.ts` (explain()), `engine-phase-11.test.ts` |
| A36 | learning disabled ⇒ tasks still run | PASS | `engine-phase-1.test.ts`, `engine-phase-11.test.ts`, `engine-acceptance.test.ts` |
| A37 | adaptive routing disabled ⇒ episodes still recorded | PASS | `engine-phase-11.test.ts` |
| A38 | permissions cannot be bypassed by learning | PASS (structural) | `engine-phase-9.test.ts` (policy cannot add/restore candidates); `docs/engine-adaptive-intelligence.md` §3 |
| A39 | execution approval cannot be bypassed | PASS (structural) | same as A38 — the reranker never reaches ExecutionGate |
| A40 | provider refusal never auto-modifies the Canonical Goal | PASS (structural) | `provider-outcome.ts` classifies only; no goal-mutation path exists in the learning layer |
| A41 | worker objection alone cannot change the user goal | PASS (structural) | same as A40 (goal ownership unchanged; GoalDriftEvaluator reports only) |
| A42 | candidate policy must replay before promotion | PASS | `engine-phase-10.test.ts` |
| A43 | replay regression ⇒ no promotion | PASS | `engine-phase-10.test.ts` |
| A44 | shadow failure ⇒ no stable replacement | PASS | `engine-phase-10.test.ts` |
| A45 | promotion carries version + rollback pointer | PASS | `engine-phase-10.test.ts` |
| A46 | rollback restores previous stable policy | PASS | `engine-phase-10.test.ts` |
| A47 | multi-device episodes aggregate to one user store | PASS | `engine-acceptance.test.ts` |
| A48 | device health not mixed with provider behaviour profile | PASS | `engine-acceptance.test.ts` (causalSource) |
| A49 | legacy RuntimeAdapter without model fields still compatible | PASS | `engine-phase-3.test.ts` |
| A50 | full regression: Commander/StateMachine/ExecutionGate intact | PASS | full suite (see gates below) |

## Mandatory batteries

| Battery | Result | Evidence |
|---|---|---|
| Failure injection: episode DB unavailable, profile builder exception, malformed model metadata, concept miner broken, adaptive scorer throws, change-point/epoch corrupt state | PASS — every case degrades learning, none crashes Boss | `engine-acceptance.test.ts`, `engine-phase-3.test.ts` |
| Statistical pollution: 100× TIMEOUT/AUTH_REQUIRED/PAGE_CHANGED | PASS — semantic metrics identical to the fault-free control while `runtimeReliability` (runtime layer) moves | `engine-acceptance.test.ts` |
| Version isolation: model A epoch1 (50× 0.5) vs epoch2 (50× 0.95) | PASS — epoch 2 converges > 0.9, epoch 1 stays queryable at 0.5, family aggregate displayed but version-aware resolution wins | `engine-acceptance.test.ts` |

## Gates

- `tsc --noEmit` (renderer/shared + electron): PASS
- `vitest run` (full suite): 65 files / 428 tests PASS
- `vite build` + electron emit: PASS

## Notes / honest limits

- A38/A39/A40/A41 are proved **structurally**: the learning layer has no code path
  that can grant a permission, approve execution, or rewrite the Canonical Goal.
  They are not (and cannot be) proved by exercising a bypass, because none exists.
- Exploration is bounded to a single explorer per decision and is OFF unless the
  operator enables it (the stable reference policy uses `epsilon: 0`).
- Live multi-device fleet operation still depends on the 10.x fleet layer
  (Phases 10D–10R on this branch); A47/A48 are verified at the episode/profile
  contract level with injected node ids.
