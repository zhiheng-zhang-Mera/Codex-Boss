# Self-Diagnosis Dogfood — the incident protocol

`CAN_DESCRIBE_SELF = YES` · `CAN_DIAGNOSE = YES` · `CAN_RECORD_CASE = YES` · **`CAN_TREAT = NO`** · `CAN_AUTHORIZE_SELF = NO`

The three self-* modules are **frozen**. From here the input that matters is not another module — it
is a real incident. This page is the protocol for one, and the command that performs each step.

## The one rule that makes the numbers mean anything

**The first-pass diagnosis is made before anyone investigates, and it is scored.**

If the diagnosis is allowed to see the root cause that the investigation later found, then
`TOP1_DIAGNOSIS_CONFIRMED` measures nothing. So:

- `T2` runs before `T4`, always;
- the first hypothesis revision is copied into `case.firstPass` and never rewritten;
- every accuracy figure is computed from `firstPass`, not from the latest revision;
- a case whose first revision arrived *after* a treatment or validation is reported as a protocol
  violation rather than averaged in.

## T0 — incident observed

Any of: a runtime error, a task failure, a provider failure, an unexpected refusal, a state failure,
a capture failure, a performance anomaly, a recovery event, a dependency that became unreadable, an
unexpected restart, a corruption signal.

A *persistent* condition is not a new case every day. Link it:

```bash
node scripts/self-case-record.cjs --case <existing-id>          # look before opening
```

## T1 — self model snapshot (before any repair)

```bash
node scripts/self-view.cjs --json --out artifacts/self-view.json
node scripts/self-view.cjs --drift artifacts/self-view.json     # optional: what moved since last time
```

The case stores `selfModelVersion`, `selfModelHash` and — from the same build —
`diagnosisEngineVersion` and `diagnosisPolicyHash`. A later repository change does not rewrite them:
a reader can always tell which body and which rules judged a case.

## T2 — first-pass diagnosis (before Hns starts)

```bash
node scripts/self-diagnosis.cjs --data-root "$LOCALAPPDATA/CodexBoss" --json --out artifacts/first-pass.json
```

Freeze that file. It is `FIRST_PASS_DIAGNOSIS`: symptoms, ranked hypotheses with confidences,
missing evidence, the diagnostic plan and the advisory treatment proposals.

## T3 — open the case

```bash
node scripts/self-case-record.cjs --from-diagnosis artifacts/first-pass.json \
  --case-id <id> --incident-class REAL_INCIDENT --root <caseLogDir>
```

`--incident-class` is **required**, and there is no default:

| class | meaning | counts in the headline |
|---|---|---|
| `REAL_INCIDENT` | a real Boss problem | yes |
| `RETROSPECTIVE_FIXTURE` | replayed historical evidence | no |
| `DEVELOPMENT_TEST` | a test or an injection | no |

A fixture recorded as a real incident would enter the dogfood headline, which is the one mistake
this field exists to prevent.

## T4 — Hns / Owner investigate

Reading logs, inspecting code, running tests, tracing and reproducing are all allowed now. What they
learn is **appended**, never used to rewrite the first pass:

```bash
node scripts/self-case-record.cjs --observe <id> --detail "what was learned" --root <caseLogDir>
node scripts/self-case-record.cjs --revise  <id> --in artifacts/second-pass.json --detail "why it changed" --root <caseLogDir>
```

`--revise` copies a new diagnosis in as `HYPOTHESIS_REVISED`. The old revision stays readable, so
"we thought A, then found B" survives in the record.

## T5 — treatment, performed by someone else

```bash
node scripts/self-case-record.cjs --performed <id> --proposal <proposalId> \
  --by OWNER|HNS|EXTERNAL_SYSTEM --treatment <kind> --outcome "what happened" --root <caseLogDir>
```

`--by SELF_DIAGNOSIS` is **refused by the timeline**, not merely discouraged: the vocabulary has
three sources and this plane is not one of them. `CAN_TREAT = NO` holds at confidence 1.0.

## T6 — validation

```bash
node scripts/self-case-record.cjs --validate <id> --verdict CONFIRMED|PARTIALLY_CONFIRMED|REFUTED|INCONCLUSIVE \
  --evidence "what was observed afterwards" --by HNS --root <caseLogDir>
```

An unknown verdict word is refused rather than stored as `INCONCLUSIVE`.

## T7 — close

```bash
node scripts/self-case-record.cjs --resolve <id> --disposition RESOLVED|UNRESOLVED [--root-cause <component>] --root <caseLogDir>
```

A disposition of `RESOLVED` needs a root cause; `UNRESOLVED` deliberately does not. **Never force a
root cause to close a case** — `ROOT_CAUSE_INCONCLUSIVE` is a real answer, and it is counted
separately from a wrong one.

## Reading the result

```bash
node scripts/self-case-record.cjs --metrics --root <caseLogDir>
node scripts/self-case-record.cjs --defects --root <caseLogDir>
```

```text
CASES_OPENED / CASES_CLOSED                 real incidents only
EXCLUDED_BY_INCIDENT_CLASS                  fixtures and tests, named
ROOT_CAUSE_CONFIRMED / _REFUTED / _INCONCLUSIVE
TOP1_DIAGNOSIS_CONFIRMED / TOP3_CONTAINED_ROOT_CAUSE     scored on the first pass
MISSING_EVIDENCE_CASES
TREATMENT_PROPOSALS / TREATMENT_PROPOSALS_USED
RECURRENT_CASES
FALSE_HIGH_CONFIDENCE_DIAGNOSES             the first safety metric
UNKNOWN_CORRECTLY_PRESERVED
PROTOCOL_VIOLATIONS
```

Every metric carries its own definition in the report, and an empty denominator is a note rather
than a zero.

### The one to watch

`FALSE_HIGH_CONFIDENCE_DIAGNOSES` counts a closed real incident whose **first-pass** leading
candidate was at or above `HIGH_CONFIDENCE_THRESHOLD` (0.7) and was later refuted or resolved to a
different root cause. When it moves, `--defects` writes a
`SELF_DIAGNOSIS_POLICY_DEFECT_REPORT` naming the claimed component, the actual root cause, the
evidence and a *candidate hypothesis* — with `mutatesPolicy: false` and `requiresOwnerReview: true`.

**Record it; do not tune from it.** One case is not a systematic failure. Construction re-opens only
on a severe high-confidence misdiagnosis or a visible systematic failure mode.

## Milestones

```text
first evaluation:   >= 10 REAL cases, of which >= 5 have an adjudicable root cause
```

If real faults are not happening yet, wait. Faults are not manufactured to fill the record: a
fabricated incident would make the only interesting number in this plane meaningless.

## Two independent observations

| | Runtime Intelligence (Boss-Live) | Self Diagnosis (Boss-Doctor) |
|---|---|---|
| answers | do the frozen policies generalise? | where might I be broken, and was that right? |
| milestone | 20 real user tasks, 100 prospective continuation steps | 10 real incidents, 5 adjudicable |
| state | `PASSIVE_OBSERVATION` | `DOGFOOD` |

They share no code path today. When they do, it is through the generic `SelfObservationSource`
interface — never by merging the experimental branches.

## Root Trust and Owner Authority

Nothing in this protocol touches them. A case records; a treatment proposal against a Root Trust or
Owner-reviewed component is `OWNER_ONLY` with `executable: false`; and the case log is a diagnostic
evidence store, not a second authoritative journal.
