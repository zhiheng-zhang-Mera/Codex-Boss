# Checkpoint 11 — Capability Gap → Self Improvement (§34)

Status: **delivered** (2026-09-12, branch `Prestart-checkpoint-2`).

Source plan: `Update-Plan/checkpoint-1.md` §34 (Phase 9 — Capability Gap → Self
Improvement), consuming the §33.3 gap records checkpoint 10 made durable.

## What the plan demands

| Plan clause | Requirement |
| --- | --- |
| §34 (record) | When Boss cannot do something, ending the task is not allowed: the gap must be recorded as `CapabilityGap { missingCapability, task, failure, workaround, frequency, severity }`. |
| §34 (chain) | Once the conditions are met: Capability Gap → Improvement Task → Implementation → Regression Test → Knowledge Update → Capability Registry. |
| §34 (theme) | The Theme Generator's own gaps go through the same mechanism. |

## What was built

### 1. `src/shared/capability-gap.ts` — the chain's decision layer (pure)

* **Aggregation by capability** (§34's `frequency`): `aggregateGaps` keys a gap on
  the *capability*, not on the task that hit it, so two tasks blocked by the same
  missing capability are one gap seen twice. Occurrences, worst severity, failure
  classes, tasks, workarounds and first/last seen are merged; a gap with no named
  capability is not knowledge of anything and is dropped.
* **"Conditions met"** (`qualifiesForImprovement`): a gap becomes work when it
  repeats (default 2 occurrences) or when a single occurrence is already severe
  enough (HIGH+). Both thresholds are reported with their values, so the decision
  is auditable rather than felt.
* **The improvement task** (`planImprovement`): carries the gap, the §28-shaped
  deliverable requirement the implementation loop is scored against, the scope
  terms, **the probe that will judge closure**, and the verdict observed when the
  gap was recorded.
* **Chain order** (`chainProblems`, `nextChainStage`): the six stages are a
  sequence; a stage recorded before its predecessor, or with one skipped, is a
  problem even when everything else is green.
* **Closure** (`closureFor`): three doors — the regression test passed *and cited
  §31.3 evidence*, the knowledge update was ACCEPT or SUPERSEDE, and the
  capability probe actually moved (MISSING/PARTIAL/RESERVED → better). Anything
  else returns the chain to IMPLEMENTATION with the reasons. A green test that
  leaves the capability just as missing is `NOT_CLOSED`.
* **Knowledge and registry** (`knowledgeCandidateFor`, `registryEntryFor`): the
  §5.3 candidate is written as host-verified information (producer VERIFICATION,
  authority VERIFIED_HOST, the probe evidence cited) and is deliberately marked
  UNVERIFIED and lower-confidence when the gap did not close, so the gate cannot
  pass an open gap off as fact. The registry entry records the movement, the
  frequency, the evidence and one of GAINED / PARTIAL / OPEN.

### 2. `electron/engineering/improvement-loop.ts` — the host side

* reads the §33.3 backlog the recovery engine wrote (`capability-gaps.json`);
* probes the live workspace with the real §6.3 machinery
  (`buildWorldModelWithGraph` + `probeCapability`), so a capability counts as
  gained only when an implementation module is matched **and** something imports
  it — a module nobody wires stays PARTIAL;
* runs the implementation stage through the real §30 loop (bounded worker →
  apply → verify → review), with the caller's worker and granted files;
* runs the regression stage as a fresh §31 ladder climb and cites its PASS rows;
* commits the knowledge update through the real `KnowledgeBase`/§5.3 gate;
* writes a durable capability registry (`capability-registry.json`) whose entry
  replaces the previous one for the same capability.

## Evidence

`pnpm run acceptance:capability-gap` (CI step + local chain step) walks the chain
with real machinery on a real git fixture that genuinely lacks a capability.
**CG-01..CG-10 PASS, 64 observations:**

* CG-01 the gaps come from a real §33.3 run (two HNS fallbacks, the second refused
  by the crutch ceiling) and read back as two occurrences of one capability;
* CG-02 the thresholds: a repeated gap qualifies, a single LOW one does not, a
  single CRITICAL one does, with both thresholds named;
* CG-03 the probe reports MISSING before any work, and the planned task records it;
* CG-04 a worker that proposes nothing leaves the probe MISSING → NOT_CLOSED,
  returns to IMPLEMENTATION, registry OPEN;
* CG-05 a real implementation that writes the module **and wires it** moves the
  probe MISSING → EXISTS, the regression climb passes with cited rows, the §5.3
  gate approves the update and the chain closes as CAPABILITY_GAINED with all six
  stages in order;
* CG-06 a module that is written and wired but does not compile moves the probe and
  still fails closure on the regression door (a second capability, so the two
  scenarios cannot contaminate each other);
* CG-07 the stored knowledge is a real ACTIVE `CAPABILITY_GAP` object with
  VERIFIED_HOST authority, VERIFIED provenance and its evidence, while the
  unclosed gap's fact stays UNVERIFIED;
* CG-08 a candidate carrying a credential shape is REJECTed by the §5.3 gate and
  that door blocks closure;
* CG-09 the registry and the backlog survive a fresh loop;
* CG-10 only the gaps whose conditions are met become tasks — the one-off stays a
  recorded gap with no registry entry.

Unit layer: `tests/unit/capability-gap.test.ts` (18 cases).

## Honest boundaries

1. **The worker still comes from outside.** The implementation stage runs the real
   §30 loop, but who writes the missing capability (a model, a Candidate, a human)
   is injected; the chain judges the result, not the author.
2. **The chain runs one round per invocation.** An unclosed gap is registered OPEN
   and returns to IMPLEMENTATION, so a caller can iterate; automatic re-opening
   across rounds belongs with the live-path integration.
3. **Capability identity is lexical** (the §6.3 probe's strict term-majority
   matching, unchanged from checkpoint 3): a capability whose name does not appear
   in the implementation's identifiers is not detected as gained, which is the
   fail-closed direction.
4. **The gap→knowledge step writes one fact per closure attempt.** It does not yet
   supersede an earlier CAPABILITY_GAP for the same capability explicitly; the
   §5.3 conflict machinery decides that, and the gate log records which door it
   took (ACCEPT or SUPERSEDE).
5. **No theme-specific gap path was added.** §34 says the Theme Generator's gaps
   use the same mechanism, and they do — through the same recovery → backlog →
   improvement chain; a theme-specific regression ladder would be a §17/§26
   concern, not a new chain.
