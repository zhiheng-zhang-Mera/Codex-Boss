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
