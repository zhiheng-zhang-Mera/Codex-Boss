# Research Questions — Capability City

**Status: FROZEN** at branch point `836b5ed` (`pre-city-baseline-v1`), before any construction.

Frozen deliberately, and early, so that questions cannot be selected after seeing which results look good.
The construction phase is not permitted to add, remove or reword a question. It may only add *evidence*.

**Permitted outcomes for every question:** `IMPROVEMENT`, `NO IMPROVEMENT`, `REGRESSION`, `MIXED RESULT`,
`INCONCLUSIVE`. A question whose answer is `NO IMPROVEMENT` is a **result**, not a failure of the program,
and is retained (`RESEARCH_LEDGER.md` D-001 rules; §7 and §29 of the program brief).

**Claim discipline.** Every answer must bind to a measurement, an experiment or a source-code fact.
Anything else is labelled `DESIGN CLAIM` / `UNVERIFIED`. "Feels more modular", "should be safer" and
"looks more elegant" are not permitted as conclusions.

---

## RQ1 — Structural Isolation

> Does a Capability City architecture reduce the cascading impact of capability removal or failure on
> unrelated functionality?

| Field | Value |
|---|---|
| **Unit of analysis** | capability |
| **Intervention** | remove one non-kernel capability; kill one provider; corrupt one capability's state |
| **Primary measures** | (1) does Boss Core still boot; (2) do unrelated capabilities remain functional; (3) is the missing surface reported as `NOT_INSTALLED`/`DEGRADED` rather than crashing or silently succeeding |
| **Baseline arm** | `pre-city-baseline-v1` = `836b5ed` |
| **Threats** | synthetic seeded faults; removal may be performed more gently than a real uninstall; single codebase |
| **Answer** | OPEN |

## RQ2 — Replaceability

> Does a stable capability surface plus a replacement protocol allow an implementation to be replaced
> without requiring consumer modification?

| Field | Value |
|---|---|
| **Unit of analysis** | capability surface + its consumers |
| **Intervention** | replace one capability implementation through the full lifecycle (active → shadow → dual-validate → primary/fallback → drain → retire) |
| **Primary measures** | number of consumer files modified (target: 0); surfacing of the switch; rollback viability; behavioral equivalence under dual validation |
| **Baseline arm** | `pre-city-baseline-v1` |
| **Threats** | a single replacement trial is weak evidence; dual validation on synthetic traffic validates less than it appears to |
| **Direct prior evidence** | `RESEARCH_LEDGER.md` **D-003**: the promotion path's "independent validator" was the same GitHub identity as the proposer, so independent authorization was impossible without bypass. Evidence that validator separation must be verified at the *identity* level, not only the code level. |
| **Answer** | OPEN |

## RQ3 — Coupling Control

> Can machine-enforced topology rules reduce kernel→feature and lateral bearing dependencies?

| Field | Value |
|---|---|
| **Unit of analysis** | dependency edges between classified components |
| **Intervention** | enforce topology rules (no cycles, no kernel→feature implementation, no lateral bearing edge, no cross-domain state access) against a real-source dependency graph, with a debt ratchet |
| **Primary measures** | kernel→feature implementation edges; lateral implementation edges; structural cycles; cross-domain state accesses; `UNCLASSIFIED` production files; each measured before and after with the same instrument |
| **Baseline arm** | `pre-city-baseline-v1` |
| **Threats** | measurement instrument changed mid-program (mitigated by keeping the old detector as a comparison arm, D-001); edge classification is partly judgement |
| **Known hazard, recorded up front** | **Rule-induced regression**: an enforced rule can push coupling into a hidden channel (event bus, service locator) that the same rules cannot see, producing an apparent improvement that is a real regression. §53 forbids using an event bus to hide a real dependency. The program must test for this explicitly rather than assume the rules are sound. |
| **Answer** | OPEN |

## RQ4 — Repair Minimality

> Does least-sufficient repair introduce fewer dependencies, permissions and subsequent cleanup work than an
> oversized repair?

| Field | Value |
|---|---|
| **Unit of analysis** | repair action for one missing capability |
| **Intervention** | a controlled comparison for an identical `1×1` missing capability — exact-fit repair vs oversized composite repair |
| **Primary measures** | files touched; dependency edges introduced; permissions added; state namespaces added; test scope; cleanup steps; architecture debt delta; runtime overhead where measurable |
| **Baseline arm** | not applicable (the two arms are the comparison) |
| **Threats** | the "oversized" arm must be a plausible engineer's actual choice, not a strawman; `RepairCost` weighting is a design choice and must be reported as such; n=1 per arm unless repeated |
| **Answer** | OPEN |

## RQ5 — Architectural Observability

> Can a real-source-graph architecture gate detect more true violation relationships than a
> manifest-driven gate?

| Field | Value |
|---|---|
| **Unit of analysis** | detector × seeded violation |
| **Intervention** | seed a known violation set and score both detectors against ground truth |
| **Seeded violations** | kernel→feature import; hidden/deep import; cycle; cross-state read; unclassified production file; expired bridge |
| **Primary measures** | true positives, **false negatives**, false positives, per detector, against ground truth |
| **Baseline arm** | the existing manifest-driven detector (`scripts/architecture.cjs`), retained unmodified for exactly this comparison (D-001) |
| **Threats** | seeded violations are synthetic; ground truth is authored by the same program that authors the detectors; the new detector may be tuned against the seed set (must be reported if so) |
| **Pre-change evidence (already measured, baseline arm)** | Manifest-driven detector scans **25 of 594** owned files, sees **3** declared edges, reports `violations: []`, and is blind to **187** real cross-capability edges including **43** kernel→feature implementation edges. Independent verification: 9 of 27 manifests declare `modules: []`. |
| **Answer** | OPEN (partial baseline characterization already measured) |

---

## Non-questions (explicitly out of scope this round)

Recorded so that their absence is not mistaken for an oversight:

```
Co-Learning capability implementation        FROZEN
Judgment Growth implementation               FROZEN
Decision Ledger v2                           NOT BUILT
fully automated self-certification           NOT ATTEMPTED
Quant integration                            NOT ATTEMPTED
PhD-specific capability                      NOT ADDED
```

`BOSS_CAN_IMPROVE_ITSELF != BOSS_CAN_CERTIFY_ITSELF` is treated this round as a **research requirement and
architecture seam only**. D-003 supplies the first measured evidence for why that seam matters.
