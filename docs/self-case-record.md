# Case Record — what happened, what was thought, and how it turned out

`CAN_RECORD = YES` · `CAN_REWRITE_HISTORY = NO` · `CAN_EXECUTE_TREATMENT = NO`

A case is the record of one anomaly: the symptoms that started it, the observations, every diagnosis
that was considered, what was actually done about it, how that was validated, and what it turned out
to be. It is **not** a diagnostic engine — it copies what Self Diagnosis said, it does not produce
hypotheses — and it is **not** a knowledge base: a case never becomes knowledge on its own.

## Where it lives

| path | what it owns |
|---|---|
| `src/shared/self-case-record/case.ts` | `SelfDiagnosisCase`, the ten statuses, the ten event types, `DiagnosisRevision` |
| `src/shared/self-case-record/timeline.ts` | `openCase`, `appendEvent`, `foldCase`, `diagnosisHistory` |
| `src/shared/self-case-record/recurrence.ts` | recurrence links, prior evidence, lesson candidates and the knowledge boundary |
| `electron/self-case-record/case-store.ts` | the durable append-only log, `CaseStore` |
| `scripts/self-case-record.cjs` | the runnable record |

## A case is its timeline

There is no mutable case object anywhere in this module. A case is a list of events; the record a
caller reads is the **fold** of that list. Two consequences, and both are the point:

- **a revision never overwrites its predecessor.** A diagnosis that changed is another
  `HYPOTHESIS_REVISED` event, so *"we thought the provider, then the ledger evidence arrived"* stays
  readable instead of being rewritten into *"we always thought the ledger"*. `diagnosisHistory`
  prints the sequence: revision, instant, leading candidate, confidence, reason.
- **history is evidence.** The fold is a pure function of the events, so any two readers agree and a
  store can be rebuilt from the log alone. `appendEvent` refuses an event that would rewrite
  history: a backdated instant, a missing opening, an unknown type, or a second `CASE_RESOLVED` on a
  case that already has a disposition.

```text
CASE_OPENED → OBSERVATION_ADDED → HYPOTHESIS_ADDED → HYPOTHESIS_REVISED
            → TREATMENT_PROPOSED → TREATMENT_PERFORMED → VALIDATION_ADDED → CASE_RESOLVED
```

The statuses are `OPEN`, `OBSERVING`, `DIAGNOSING`, `WAITING_FOR_EVIDENCE`, `TREATMENT_PROPOSED`,
`TREATED_EXTERNALLY`, `VALIDATING`, `RESOLVED`, `UNRESOLVED`, `RECURRENT`.

## The store appends, and only appends

One JSONL file, **one row per event** — never a snapshot per case, which is what makes the store
genuinely append-only rather than append-shaped. A test asserts the first row is byte-identical
after later appends. A torn row costs one row and is counted (`unreadableRows`), so a damaged log
reports itself instead of quietly shortening a history. `CaseStore` exposes `openCase`, `append`,
`records`, `record`, `timelines`, `status`, `lessonCandidates` and `priorEvidence` — and no `update`,
`delete`, `rewrite`, `reset` or `execute`.

## A recurrence is a link, not a verdict

`linkRecurrence` connects a new case to the closed cases about the same component and failure mode.
The link says, in its own reason, that it is *"evidence about the past and says nothing about whether
it is happening now"*. `priorEvidenceOf` hands Self Diagnosis a different type from a health
observation — `{ caseId, componentId, failureMode, closedAt, finalDisposition }`, with no status and
no measurement — so a past case can adjust a candidate's confidence and can never override the
current reading. `上次 Provider X 出问题 != 这次 Provider X 一定有问题`.

## A case is not knowledge

```text
CASE → repeated or validated evidence → LESSON CANDIDATE → knowledge review → KNOWLEDGE
```

`lessonCandidates` refuses a single case outright. A candidate needs either the same component and
failure mode in at least `RECURRENCE_THRESHOLD` (2) closed cases, or one case whose treatment a
validation recorded as `CONFIRMED`. Every candidate carries `isKnowledge: false`,
`requiresKnowledgeReview: true` and `reviewQueue: "knowledge-review"`, and `promoteLesson` says in
its own return value that it creates no knowledge: that is the review's decision, which this module
cannot make.

## Provenance: which body, and which rules

Every case records, at open and never afterwards:

```text
selfModelVersion        self-model-v1
selfModelHash           the fingerprint of the anatomy the diagnosis was looking at
diagnosisEngineVersion  self-diagnosis-engine-v1
diagnosisPolicyHash     the fingerprint of the rules that produced the diagnosis
source                  who supplied the four values
```

So a later reader can tell which body, and which diagnosis rules, judged a case, rather than
assuming they were today's. The values are computed in the host — the CLI reads the checkout and the
diagnosis policy — and handed in as strings: the case record stores provenance and never derives it,
which is what keeps it from depending on the modules it describes. A checkout that cannot be read
records an explicit `UNKNOWN` with the reason; a blank is refused, because "not established" and "not
filled in" must not look the same.

## Dogfood metrics: accuracy, not activity

`dogfoodMetrics` (and `scripts/self-case-record.cjs --metrics`) counts what the dogfood phase is
actually for. Every number carries its own definition in the report, so a quoted figure cannot drift
from what it means, and an empty denominator is reported as a note rather than as a zero that reads
like a result.

```text
CASES_OPENED / CASES_CLOSED
ROOT_CAUSE_CONFIRMED / _REFUTED / _INCONCLUSIVE
TOP1_DIAGNOSIS_CONFIRMED / TOP3_CONTAINED_ROOT_CAUSE
MISSING_EVIDENCE_CASES
TREATMENT_PROPOSALS / TREATMENT_PROPOSALS_USED
RECURRENT_CASES
FALSE_HIGH_CONFIDENCE_DIAGNOSES
UNKNOWN_CORRECTLY_PRESERVED
```

**`FALSE_HIGH_CONFIDENCE_DIAGNOSES` is the one to watch.** It counts a closed case whose leading
candidate was at or above `HIGH_CONFIDENCE_THRESHOLD` — imported from the diagnosis policy, so the
two cannot drift — and which was later refuted or resolved to a different root cause. Saying "the
cause is X" and being wrong costs more than saying the evidence was not enough, and
`UNKNOWN_CORRECTLY_PRESERVED` counts that second, better outcome: a closed case that named no root
cause while no candidate had reached the claim threshold.

## The case log is not a second state-core journal

State-core already owns the authoritative durable event journal: SQLite, in the same transaction as
`state_record`, with idempotency keys, consumer cursors and dispatch. The case log is a **diagnostic
evidence store** and must never become a replacement for it:

| | state-core journal | case record |
|---|---|---|
| authority | the durable source of truth for state changes | a record of what was observed and judged |
| substrate | SQLite inside the state database | one JSONL file under the caller's root |
| replay | consumer cursors and idempotent dispatch | none; readers fold the events |
| wiring | a boot module with a manifest and a namespace | no boot module, no namespace, no import |

The case-record modules mention no part of state-core (`state-core`, `event-journal`,
`StateRepository`, `idempotencyKey`, `aggregateId`, `withTransaction`, `state.db`) and claim no
journal authority (`sourceOfTruth`, `publish(`, `dispatch(`, `replay(`, `cursor(`); nothing under
`electron/state-core/` references the case record or its file; and the log's name
(`case-record.jsonl`) is not a state path. `tests/unit/self-case-record/dogfood.test.ts` checks all
three.

**Architectural debt, recorded rather than acted on:** the repository now holds two append-only logs
— state-core's authoritative journal and this diagnostic one. The distinction above keeps them from
competing, but it is a distinction a future change could erode. If a self-* module ever needs to
change authoritative state, it must go through state-core rather than growing this log into a second
journal. The state-core performance change at `a890314` did not touch this: the two share no import,
no file and no namespace.

## Running it

```bash
pnpm run build:electron
node scripts/self-diagnosis.cjs --json --out artifacts/self-diagnosis.json
node scripts/self-case-record.cjs --from-diagnosis artifacts/self-diagnosis.json --case-id case-1
node scripts/self-case-record.cjs --list
node scripts/self-case-record.cjs --case case-1
node scripts/self-case-record.cjs --validate case-1 --verdict CONFIRMED --evidence "no recurrence in 24h"
node scripts/self-case-record.cjs --resolve case-1 --disposition RESOLVED --root-cause providers
node scripts/self-case-record.cjs --candidates
```

The CLI records and reports. It has no flag that treats anything.

## What it deliberately is not

- **Not a diagnostic engine.** It imports no hypothesis builder, and the word `diagnose` appears in
  its implementation only in an import of the diagnosis *types* it records.
- **Not a repair agent.** The pure modules contain no filesystem call and no process spawn.
- **Not a redefinition of the self model.** The case-record modules do not import
  `self-cognition` at all — the strongest available form of `does not redefine current self model`.

Enforced by `tests/unit/self-case-record/boundary.test.ts`, which reads the module's own source and
its own prototype.
