# Self Diagnosis — where Boss might be broken

`CAN_DIAGNOSE = YES` · `CAN_PROPOSE_TREATMENT = YES` · `CAN_EXECUTE_TREATMENT = NO`

Self Diagnosis takes the anatomy **Self Cognition** built, reads what other components already
recorded, and answers: what looks wrong, which components could be responsible, which of those are
only downstream effects, what else it could be, what evidence is missing, how far the blast radius
reaches, what to check next, and — advisory only — what might be done.

## Where it lives

| path | what it owns |
|---|---|
| `src/shared/self-diagnosis/observations.ts` | `HealthObservation`, the `SelfObservationSource` interface, source isolation |
| `src/shared/self-diagnosis/hypotheses.ts` | `DiagnosticSymptom`, the symptom vocabulary, `DiagnosisHypothesis`, roles, ranking |
| `src/shared/self-diagnosis/plan.ts` | `DiagnosticPlan`: what to check |
| `src/shared/self-diagnosis/treatment.ts` | `TreatmentProposal`: what might be done, with a risk and an authority |
| `src/shared/self-diagnosis/engine.ts` | `diagnose`: one entry point, one report |
| `electron/self-diagnosis/sources.ts` | the host adapters that read `state.json`, `telemetry.json` and `recovery.json` |
| `scripts/self-diagnosis.cjs` | the runnable diagnosis |

## What it reads, and what it owns

Three host sources, each an adapter over a file the application already writes: task and run
outcomes from `state.json`, runtime outcomes from `telemetry.json`, and park-and-retry records from
`recovery.json`. They satisfy the generic `SelfObservationSource` interface, so a future source —
including one adapted from Runtime Intelligence — plugs in without this module knowing what it is.
**It owns none of them**: a source is handed the self model, asked once, and returns readings. There
is no back-channel, no writer and no handle to the thing observed.

## The two rules that make a diagnosis worth reading

**One symptom does not produce one root cause.** `rankHypotheses` returns candidates with
confidences that are never normalised into a verdict, and the report says `MULTIPLE_HYPOTHESES` when
more than one is credible:

```text
providers   ROOT_CAUSE          0.85
tasks       DOWNSTREAM_SYMPTOM  0.75
status      DOWNSTREAM_SYMPTOM  0.75
```

**A downstream effect is not a second root cause.** `assignRoles` consults the anatomy's own
dependency graph: a suspected component that another suspected component reaches is
`DOWNSTREAM_SYMPTOM`, whatever its own evidence looks like. A provider timeout, a slow task and a
rising error rate are one problem and two consequences. Two candidates the anatomy does not connect
are both `CONTRIBUTING_FACTOR`, which is the honest answer when nothing explains the other.

A reading that names a component the anatomy does not describe is kept and reported, never dropped:
a component nobody has described is exactly what a diagnosis should surface.

## Check first, treat second

`DiagnosticPlan` is what this module produces when the evidence is thin, and it is a complete
answer rather than a failure. Steps are ordered `COLLECT` (missing measurements) → `INSPECT` (each
candidate) → `COMPARE` (against a healthy baseline), and each step says what the look would settle.
The words *restart*, *rollback*, *apply*, *repair* and *fix* do not appear in a plan.

`TreatmentProposal` is a suggestion with `expectedBenefit`, `riskDetail`, `blastRadius`,
`reversible` and `requiredAuthority`. Every proposal carries `executable: false` as a literal.

## The boundary, in the type

| target | risk | required authority | executable |
|---|---|---|---|
| a product capability with a transient failure | `LOW` | `AUTONOMOUS_CANDIDATE` | `false` |
| a capability whose failure mode needs a rebuild | `MEDIUM` | `AUTONOMOUS_CANDIDATE` | `false` |
| a downstream candidate | `HIGH` | `AUTONOMOUS_CANDIDATE` | `false` |
| `ROOT_TRUST_SURFACE`, the evolution engine, an owner-reviewed path | `OWNER_ONLY` | `OWNER` | `false` |
| qualification surface | `OWNER_ONLY` | `OWNER` | `false` |

`CAN_DIAGNOSE != CAN_TREAT`, and this module is on the left of that inequality. It cannot reach the
right-hand side: the pure modules contain no filesystem call, no process spawn, and no export that
performs an action.

## Running it

```bash
pnpm run build:electron
node scripts/self-diagnosis.cjs --summary
node scripts/self-diagnosis.cjs --json --out artifacts/self-diagnosis.json
node scripts/self-diagnosis.cjs --data-root <another-user-data-directory>
```

A data root whose files are missing produces `UNKNOWN` readings and `SOURCE_UNREADABLE` symptoms,
not a clean bill of health.

## The case record is evidence, not a verdict

`PriorEvidence` — a closed case from the Case Record — may raise or lower a candidate's confidence
by a bounded weight, and it is recorded in the hypothesis as *evidence about the past and not about
now*. A prior can never make an unhealthy observation healthy, and it can never override the
current reading: `CASE_RECORD does not redefine current self model`.

## What it deliberately is not

- **Not a self model.** It reads the anatomy as an input, returns no model, and its report carries
  `mutatesAnatomy: false` as a literal. A test asserts the model is byte-identical after a full
  diagnosis.
- **Not a case record.** It keeps `PriorEvidence` as an interface and stores no history.
- **Not a repair agent.** No retry, no restart, no cache clear, no provider switch exists as
  executable behaviour anywhere in it.

Enforced by `tests/unit/self-diagnosis/diagnosis.test.ts`, which reads the module's own source and
its own outputs.
