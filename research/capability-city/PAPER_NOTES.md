# Paper Notes — Capability City

Facts and candidate narratives only. **Not** a draft paper, and deliberately not written to sound like one.
Every statement is either bound to a measurement, or labelled `DESIGN CLAIM` / `UNVERIFIED`.

Standing rules: no claim from "feels more modular", "should be safer", "looks more elegant". Negative
results are retained. `PENDING` is not `PASS`.

---

## Motivation

AI orchestration systems accumulate capabilities continuously — providers, research pipelines, self-diagnosis,
runtime intelligence, fleet coordination. The dominant engineering pattern for this growth is *modularity*:
many modules, clear file boundaries, a manifest describing what exists. Modularity of that kind is real but
weak. It says what code is *placed* where; it does not say what may *depend* on what, what may be *removed*,
what can be *replaced*, or who may *authorize* a change.

The motivating question is whether a system can keep growing capabilities under **enforceable structural
constraints** rather than conventions:

> Can an AI orchestration system maintain structural integrity across long-term capability growth, replacement
> and self-modification, through explicit capability boundaries, minimum stable closure, topology constraints,
> least-sufficient repair, and independent qualification?

`DESIGN CLAIM` / `UNVERIFIED` — the question is a programme goal, not a result.

---

## Problem

Observed conditions in the subject system, all measured at `pre-city-baseline-v1` (tree `8e31f066…`):

| Observation | Value | Source |
|---|---|---|
| Declared dependency edges | **3** | `architecture:graph` |
| Real file-level cross-capability import edges | **187** | independent scan |
| Kernel→feature implementation edges in the real graph | **43** | independent scan |
| Files scanned by the repository's own architecture gate | **25 of 594** | `collectImports` reads only manifest-declared modules |
| Manifests declaring `modules: []` | **9 of 27** | `config/capabilities/*.yaml` |
| Capability-level 2-cycles (implementation graph) | **43** | independent scan |
| Largest strongly-connected component | **25 of 27 capabilities** | independent scan |
| Cross-domain private-state accesses | **7** | independent scan |
| Capabilities with a replacement path | **0** | no shadow/dual-validate/drain machinery exists |
| Declared durable state namespaces | **32**, with several undeclared writer stores | ownership graph + source |

The central problem is therefore **not** "the code is tangled". It is that **the instrument used to judge
tangling was blind**, so every architectural claim rested on a measurement that could not see the thing being
claimed. `pnpm run architecture:ratchet` reported `violations: []` while 43 kernel→feature implementation
edges existed.

`MEASURED` for this system.

---

## Design principles

Adopted from the Owner's architectural intent; stated here as principles, not as validated results.

| Principle | Statement |
|---|---|
| Boss is substrate, not a product | Land, foundation, roads, pipes, municipal rules. Business capabilities are buildings. |
| Observed architecture > declared architecture | The real source graph outranks self-declaration. |
| Minimum stable closure | Split to the smallest closure satisfying an invariant — not to the smallest code unit. |
| Stable surface, replaceable implementation | The address stays; the building may be replaced. |
| Least-sufficient repair | Repair to just enough, never "bigger is safer". |
| Bridges may connect, not bear | A bridge may exist; it must not become foundation. |
| Capability failure ≠ city failure | One building failing must not collapse the city. |
| Architectural debt must be visible | Repairing debt is allowed; manufacturing it silently is not. |
| Core growth ban | New business capability does not enter the kernel without separate justification. |
| Self-improvement ≠ self-certification | Independent evaluation boundary preserved for future research. |

`DESIGN CLAIM` / `UNVERIFIED` as *effects*. The principles are the intervention; whether they produce the
claimed effects is exactly what RQ1–RQ5 test.

---

## System architecture (subject system)

Codex-Boss: an Electron main process plus a shared TypeScript core, with 27 declared capabilities in two
declared layers — `kernel` (4: `persistence`, `providers`, `runtime`, `state-core`) and `feature` (23). No
`infrastructure` tier exists; creating one is city-phase work. Bootstrap is a composition root of 25 wired
boot modules. Durable state is declared as 32 namespaces with a single declared owner each and zero reported
conflicts. The trust boundary is machine-enforced independently of the architecture gate (trust epoch 24,
`boss-root-trust-24`, root surface aggregate `6eaf71e9…`).

---

## Research questions

Frozen in `RQ.md` before construction: RQ1 structural isolation, RQ2 replaceability, RQ3 coupling control,
RQ4 repair minimality, RQ5 architectural observability. Permitted outcomes include `NO IMPROVEMENT`,
`REGRESSION`, `MIXED RESULT`, `INCONCLUSIVE`. No question may be added, removed or reworded after results
exist.

---

## Experimental setup

* **Subject:** one repository (Codex-Boss), Windows, `pnpm` 11.19.0, Node 24, Electron 44.
* **Baseline arm:** `pre-city-baseline-v1`, tree `8e31f066a1b5df7f32c9db47c80aaffd02b78dd5`.
* **Comparison discipline:** `BEFORE` and `AFTER` measured with the *same* instrument; if the instrument
  changes, both instruments are reported (`threats-to-validity.md` §8).
* **Old detector retained deliberately** as the comparison arm for RQ5, so that manifest-driven vs
  real-source-graph detection is answerable (`RESEARCH_LEDGER.md` D-001).
* **Determinism:** commit-bound, seeded where applicable, raw output retained
  (`research/capability-city/experiments/`, `dataset/`).

---

## Baseline

Captured and content-addressed before any change. `pre-city-baseline-v1` binds the promoted content; the
promoted tree is byte-identical to the verified RC commit. Content validity and authorization-process
validity are recorded separately (`GOV-003`).

---

## Results

`PENDING` for RQ1–RQ5. Phase 0 has not started; no migration has been performed.

### Governance case study (the one measured result so far)

This is a real, non-seeded observation, and it is currently the strongest evidence in the programme.

**Stage A — declared separation, same principal (OBSERVED)**

```
PR #8
author principal        zhiheng-zhang-Mera
CODEOWNER principal     zhiheng-zhang-Mera        (identical)
merging principal       zhiheng-zhang-Mera        (identical)
reviews                 0
required checks         all four success
require_code_owner_review   true (ruleset unchanged since before the programme)
protected path          /package.json, correctly matched
platform refusal        "Review Can not approve your own pull request"
outcome                 promotion COMPLETED with zero independent reviews
```

The invariant `approver != author` was satisfied by **nobody**, and the promotion completed anyway.
Full record: `experiments/governance/GOV-001-pr8-observed-failure.md`.

**Stage B — machine credential absent (OBSERVED, partial)**

The promotion path fails closed rather than silently reverting to Owner credentials. Observation to be
completed by the no-credential preflight (`NO_MACHINE_CREDENTIAL_FALLBACK_OBSERVED`) — see "Negative results".

**Stage C — machine principal can act but cannot self-authorize (NOT YET MEASURED)**

```
PROTOCOL   GOVERNANCE_NEGATIVE_AUTHORITY_TEST
STATUS     FROZEN, not executed
```

The experiment asks *"can the bot write enough to perform work, while still being unable to authorize its own
protected promotion?"* — not *"can the bot write?"*. Protocol:
`experiments/governance/GOV-002-machine-principal-negative-control-protocol.md`.

**Stage C must not be written as PASS in advance.**

### Candidate narrative (explicitly premature)

```
Declared Separation
        ↓
Real-world failure                       ← OBSERVED (Stage A)
        ↓
Principal-level separation
        ↓
Negative authority experiment            ← NOT YET MEASURED (Stage C)
        ↓
Machine can act
   BUT
Machine cannot self-authorize
```

The last two steps are `PENDING`. The narrative is recorded because it is the intended shape of the study, not
because it has been demonstrated.

---

## Negative results

Recorded in full, including this programme's own errors.

| # | Negative result | Status |
|---|---|---|
| N-1 | **The repository's architecture gate is blind.** `violations: []` while 43 kernel→feature implementation edges exist; 25 of 594 files scanned; 9 of 27 manifests declare `modules: []`. | `MEASURED` |
| N-2 | **A declared separation-of-duties rule was satisfied in form, not substance.** Zero independent reviews, promotion completed. Failure mode was *silent success*, not refusal. | `OBSERVED` |
| N-3 | **This programme asserted bypass was the only path and that promotion was blocked. Both were false.** The merge succeeded with zero reviews. Retained with correction notice. | `RETRACTED INFERENCE, RETAINED` |
| N-4 | **The programme's own merge of PR #8 was an operator error** against an explicit "do not merge" instruction. Disposition recorded rather than hidden. | `OBSERVED, RECORDED` |
| N-5 | **`acceptance:promotion-identity:live` does not exist on `main`** — it ships only with the unmerged PF020 branch, so the live acceptance tooling is not available on the baseline. | `MEASURED` |
| N-6 | **The general GitHub machine acceptance on `main` cannot prove the Root-CODEOWNER ceiling.** It proves authentication, branch creation, commit, push, PR creation and CI inspection; it does **not** prove `WAITING_FOR_ROOT_OWNER`, self-authorization refusal, or the ceiling. | `MEASURED` (see §J findings) |
| N-7 | **Provisioning a second principal is a real, non-trivial cost** (local Root-Owner ceremony, App private key, installation id, platform secure storage). Evidence that policy-only separation hides its own operational cost. | `OBSERVED` |

---

## Threats to validity

Recorded up front in `threats-to-validity.md` (§1–§15), including: single codebase; single main developer and
agent-generated implementation; synthetic seeded faults; Windows-heavy environment; benchmark
representativeness; measurement instrumentation effects; instrument scope (cannot see credential-level
coupling); two retained detector versions; baseline drift; qualification-semantics risk; environment-bound
irreproducible steps; **unobservable governance decision path**; the external-principal requirement; the
privileged nature of measuring a live credential boundary; and the retention of retracted inferences.

The single most important item for the governance result is that GitHub's internal decision path at
`OBS-GOV-001` is `NOT OBSERVABLE FROM CURRENT EVIDENCE`, so the claim is restricted to the observable
outcome.

---

## Limitations

* `n = 1` codebase, developer, and governance configuration. Existence proof and method, not base rate.
* Fault-isolation and detector results will rest substantially on **seeded** faults; observed infrastructure
  violations are used where available to reduce that dependence.
* Real-host qualification, long soak, provider acceptance, installer-VM cycles and machine identity are
  environment-bound and remain `NOT_RUN` / `BLOCKED_EXTERNAL`. They are never substituted by mocks.
* The city architecture may **increase** total code size and declared surface while reducing coupling; this
  is a live confounder and must be reported, not hidden.
* Replaceability is currently **absent** (zero capabilities have any replacement path), so RQ2 begins from a
  zero baseline.

---

## Future work

1. Execute `GOV-002` once the Owner ceremony is complete; record Stage C as measured or as `INCONCLUSIVE`.
2. A **separate** controlled probe of GitHub's evaluation order (`require_code_owner_review` ×
   `current_user_can_bypass`) on a throwaway protected branch, to establish the mechanism that stays
   `NOT OBSERVABLE` today.
3. Governed least-sufficient-repair ablation (exact-fit vs oversized) with a declared `RepairCost`.
4. Detector benchmark scored against a seeded violation set with ground truth (`RQ5`).
5. After city v1: Co-Learning as the first genuinely complex new building — currently `FROZEN`.
