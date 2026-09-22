# Phase 1A — Measurement-to-Enforcement Convergence

**Specification.** This document is the authoritative, tracked definition of Capability City **Phase 1A**. It is
what the implementation is accepted against. Where it says *must*, the acceptance criteria in §16 are checkable.

## Provenance

| Field | Value |
|---|---|
| Issuing authority | **Owner** (mission-3, `PHASE1A = MEASUREMENT_TO_ENFORCEMENT_CONVERGENCE`) |
| Source directive | `mission-3.md` (with the resume point that closed Phase 0) |
| Base | tag `city-phase0-observatory-v1` → `66440c1d360362a0bba38332d385feed41b64acb` |
| Branch | `dev/city-phase1a-enforcement-convergence` |
| Branch point | `66440c1d…` — verified equal to the tag's commit |
| Phase 0 state at branch time | `PHASE0 = CLOSED`: technical acceptance PASS, Root Owner promotion verified, post-merge CI PASS (run `35699482212` on the merge SHA), immutable tag frozen |
| Prior spec (unchanged) | `docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md` |

Phase 1A **does not repair architecture**. It qualifies the Phase 0 sensor for enforcement, freezes the inherited
debt it measured, and builds a prospective policy that refuses *new* debt while grandfathering what already
exists.

```text
MEASURED_DEBT != NEW_REGRESSION
GRANDFATHERED != HEALTHY
DEBT_REMOVAL = ALLOWED
NEW_UNDECLARED_DEBT = REFUSED
```

## 1. Question Phase 1A answers

> Can the Phase 0 truth-producing sensor safely support prospective architecture enforcement without erasing or
> instantly failing inherited debt?

It adds exactly five things: enforcement-grade sensor qualification; a frozen grandfathered-debt baseline; a
prospective policy projection; shadow and enforce modes; and controlled regression experiments.

## 2. Roles stay separate

```text
architecture:ratchet   = legacy control sensor      (unchanged, not replaced in Phase 1A)
architecture:observe   = truth sensor               (Phase 0, unchanged semantics)
architecture:enforce   = prospective policy         (new)
```

The legacy ratchet is **not** replaced, widened or repaired in Phase 1A. Shadow and enforce modes must use
**exactly the same evaluator**; they differ only in how a policy violation is reported.

## 3. Continuous paper evidence

`docs/research/PAPER_EVIDENCE_LEDGER.md` is extended, never replaced, and no competing tracked history is
created. During construction, `artifacts/city/phase1/paper-evidence.ndjson` is appended **before moving to the
next stage** — no end-of-run backfill.

Every record carries: `evidence_id`, `timestamp`, `stage`, `commit`, `evidence_class`, `question`,
`prior_assumption`, `method`, `observed`, `expected`, `discrepancy`, `interpretation`, `alternative_explanations`,
`reproducibility`, `artifact_refs`, `paper_use`, `limitations`.

Evidence classes are never collapsed: `MEASUREMENT`, `CONTROL`, `NEGATIVE_CONTROL`, `FAILURE`, `CORRECTION`,
`GOVERNANCE`, `REPRODUCTION`, `POLICY_EXPERIMENT`, `SHADOW_ENFORCEMENT`, `REAL_HOST`, `REMOTE_GITHUB`.

**Failures, false positives, false negatives, cross-check disagreements, seeded-mutation failures,
baseline-generation mistakes, policy-design mistakes, unexpected grandfathering behaviour, count-compensation
attacks, rollback failures, negative results and self-corrections are paper material and are recorded, not
suppressed.** Only the final PASS is not enough.

## 4. Sensor qualification (Q-01..Q-08)

The Phase 0 lexer/token recogniser passed *measurement* acceptance. Enforcement needs it qualified.

| Gate | Requirement |
|---|---|
| **Q-01** production corpus integrity | On the promoted Phase 0 tree: silent skips = 0, read failures = 0, parse issues = 0. |
| **Q-02** adversarial syntax corpus | Isolated, hand-labelled fixtures covering: nested templates and `${...}`; regex literals vs division; TSX self-closing and closing tags; JSX attributes and expressions; comments/strings/template text containing import-like text; multiline and type-only imports; `export-from`; dynamic import; `require`; Unicode identifiers; escaped strings and templates. |
| **Q-03** seeded mutation / metamorphic battery | At least **500 deterministic seeded cases** covering add / remove / duplicate / change-form / whitespace / comment / string / template / TSX-noise mutations. Every case must assert the **exact expected graph delta**. |
| **Q-04** independent disagreement detector | Keep an independent conservative candidate extractor. It is **not truth**; it is a disagreement detector. Classify `OBSERVER_ONLY`, `CROSSCHECK_ONLY`, `BOTH`. Every `CROSSCHECK_ONLY` real-tree case must be explained. |
| **Q-05** determinism | At least **5 consecutive runs** at one clean commit produce the same semantic hash. |
| **Q-06** path/platform resolution | Windows/POSIX separators, case handling where applicable, `.js → .ts`, index resolution, TSX/JSX resolution. |
| **Q-07** scope honesty | Document that the Observatory scans tracked `electron/**` and `src/**`; it does **not** observe its own `scripts/**` implementation. |
| **Q-08** resource measurement | Record wall time, output size and cheap memory metrics. **Do not invent a pass threshold.** |

```text
DO NOT CONTINUE UNTIL:
  Q-01..Q-07 = PASS
  Q-08       = MEASURED
  UNEXPLAINED_SENSOR_DISAGREEMENTS = 0
```

If qualification reveals a sensor bug: **record the failure first**, add a reproducer, repair it, re-run the
Phase 0 semantic controls, and append a `CORRECTION`. Historical Phase 0 evidence is never rewritten.

## 5. Grandfathered-debt baseline

Generated **mechanically** at `config/architecture-enforcement-baseline.json`, schema
`city-architecture-enforcement-baseline/1`. It must bind:

```text
source_commit
sensor implementation / spec
sensor semantic hash
scan-set hash
tracked source files
declared / undeclared ownership (identity level)
canonical internal edge identities (identity level)
unresolved-reference classifications
generation command and reason
```

It means:

```text
THESE RELATIONS EXISTED BEFORE ENFORCEMENT
```

and **not**:

```text
THESE RELATIONS ARE HEALTHY
```

**Identity is authoritative; counts are summaries.** Raw counts alone must never be the primary ratchet.

**Baseline series and promotion.** The baseline carries a monotonically increasing `baseline_version` and a
`parent_baseline_hash`. Regenerating it is an explicit, recorded act with a reason. Debt present in the baseline
is grandfathered; a relation that disappeared in an accepted later baseline and then returns is **new**.

## 6. Unresolved-reference classification

At minimum:

```text
NON_SOURCE_ASSET
SOURCE_TARGET_MISSING
UNSUPPORTED_SOURCE_RESOLUTION
OTHER_UNKNOWN
```

Policy:

```text
NON_SOURCE_ASSET              report, normally not architecture-fail
SOURCE_TARGET_MISSING         fail
UNSUPPORTED_SOURCE_RESOLUTION fail closed
OTHER_UNKNOWN                 fail closed
```

Phase 0's historical terminology is **preserved**, not rewritten. Phase 0's single unresolved reference
(`src/renderer/main.tsx` → `./styles.css`, reason `non-source-extension`) classifies as `NON_SOURCE_ASSET`.

## 7. Enforcement engine

New, separate files:

```text
scripts/architecture-enforcement.cjs
pnpm run architecture:enforce:shadow
pnpm run architecture:enforce
```

```text
shadow:  policy violation -> report + exit 0
enforce: policy violation -> report + non-zero
engine error -> non-zero in BOTH
```

The engine is read-only with respect to source. It reads the observatory's measurement, the baseline, and the
capability declarations; it writes only under `artifacts/`.

## 8. Prospective enforcement policy

| Code | Rule |
|---|---|
| **E-01** | A baseline edge is `PASS_AS_GRANDFATHERED`, and is still labelled as debt where applicable. |
| **E-02** | A baseline edge that disappears is `PASS` with `DEBT_REDUCED`. |
| **E-03** | An edge removed in an accepted later baseline and then reintroduced is **new**, not eternally grandfathered. |
| **E-04** | New tracked production source with `owner = UNDECLARED` fails: `NEW_UNDECLARED_SOURCE`. Existing undeclared files stay grandfathered. |
| **E-05** | Any new edge with an undeclared source or target fails: `NEW_EDGE_UNDECLARED_ENDPOINT`. |
| **E-06** | A new `DECLARED A -> DECLARED A` edge passes unless another invariant fails. |
| **E-07** | A new `DECLARED A -> DECLARED B` (`A != B`) edge passes **only** when the repository's own capability declarations authorize the relationship — operationally, when `A` declares a `requires`/`optional` reference that `B` provides. Otherwise `NEW_UNDECLARED_CROSS_CAPABILITY_EDGE`. |
| **E-08** | Multiple authoritative owners for one source: `OWNERSHIP_CONFLICT`, fail. |
| **E-09** | A read failure, parse issue, silent skip, unsupported source resolution or unknown evaluation state must **never** produce `PASS`. |
| **E-10** | Defect classes not yet represented (cycles, private-state access, bundle structure) are labelled **`NOT_YET_ENFORCED`**, never "clean". |

## 9. Required enforcement tests

```text
ENF-01 grandfathered edge passes
ENF-02 edge removal passes / debt reduced
ENF-03 new undeclared source fails
ENF-04 new edge to undeclared target fails
ENF-05 new edge from undeclared source fails
ENF-06 same-capability declared edge passes
ENF-07 declared cross-capability relation passes
ENF-08 undeclared cross-capability relation fails
ENF-09 ownership conflict fails
ENF-10 sensor failure fails closed
ENF-11 non-source asset classified correctly
ENF-12 shadow/enforce findings identical
ENF-13 shadow exits zero on policy violation
ENF-14 enforce exits non-zero on the same violation
ENF-15 deterministic ordering
ENF-16 baseline regeneration reproducible
ENF-17 count-compensation attack refused
ENF-18 removed-debt reintroduction treated as new
```

## 10. Real-tree shadow trial

On the exact Phase 1A baseline:

```text
architecture:ratchet
architecture:observe
architecture:enforce:shadow
architecture:enforce
```

Expected: legacy ratchet `PASS` under legacy semantics; observer = qualified truth; shadow evaluates with no
engine error; enforce `PASS` because every inherited relation is grandfathered; `NEW_REGRESSIONS = 0`. If the
baseline fails enforce mode, **measure the cause**; do not weaken policy casually. Record any failure before
fixing it.

## 11. Controlled regression experiments

Isolated fixtures/worktrees only — **never production architecture**. At least:

```text
new undeclared source
declared -> undeclared edge
undeclared -> declared edge
undeclared -> undeclared edge
unauthorized cross-capability edge
ownership conflict
missing source target
instrument failure
raw-count compensation attack
```

For each, record: baseline semantic hash, mutation, expected machine code, observed machine code, shadow exit,
enforce exit, rollback result, post-rollback semantic hash.

## 12. CI and Root Trust boundary

Phase 1A must **not** modify `.github/workflows/ci.yml`, the Root Trust Surface, required-check definitions,
`CODEOWNERS` or branch protection, and must **not** advance Root Trust.

Turning the new enforcer into a hosted required gate is a separate municipal-law / Root-Trust act: **Phase 1B**.
Unit tests may exercise the engine on the branch; that must not be misreported as hosted-gate activation.

```text
ENFORCEMENT_ENGINE = QUALIFIED_CANDIDATE
HOSTED_REQUIRED_GATE = LEGACY
```

## 13. Required artifacts and acceptance record

Runtime, under `artifacts/city/phase1/` (gitignored; repository path-ownership policy is not violated to track
them):

```text
sensor-qualification.json
sensor-qualification-report.md
baseline-generation.json
architecture-enforcement-shadow.json
architecture-enforcement-live.json
controlled-regressions.json
legacy-vs-observer-vs-enforcer.json
paper-evidence.ndjson
paper-evidence.json
paper-evidence-index.md
PHASE1A_MEASUREMENT_TO_ENFORCEMENT_REPORT.md
```

One durable tracked record, `docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_ACCEPTANCE.md`, binds those artifacts
by SHA-256 and records the acceptance verdicts and limitations. The full generated dataset is bound by hashes and
summarized, not copied.

The paper index must group evidence under at least: Motivation · Measurement validity · Legacy control · Phase 0
sensor · Sensor qualification · Instrument failures/corrections · Grandfathered-debt design · Policy experiments ·
Shadow enforcement · Controlled regressions · Governance boundary · Negative results · Threats to validity ·
Reproducibility · Deferred architecture repair.

## 14. Evidence checkpoints

Before leaving each checkpoint, append paper evidence:

```text
C2  Phase 0 genuine promotion + immutable tag
C3  Phase 1A spec
C4  sensor qualification
C5  every qualification failure / correction
C6  enforcement baseline
C7  policy implementation
C8  shadow trial
C9  controlled regressions
C10 full regression suite
C11 hosted branch CI
C12 Phase 1A promotion request
```

A missing record means the checkpoint is incomplete.

## 15. Forbidden in Phase 1A

```text
.github/workflows/ci.yml        NOT MODIFIED
Root Trust Surface              NOT MODIFIED
required-check definitions      NOT MODIFIED
CODEOWNERS / branch protection  NOT MODIFIED
architecture migration          NOT STARTED
tenx split · cycle repair · persistence/runtime-intelligence repair ·
private-state repair · mass manifest cleanup · ownership migration   ALL NOT DONE
Phase 1B · Phase 2              NOT STARTED
```

Phase 1A establishes only: a qualified sensor, a grandfathered-debt baseline, prospective enforcement, shadow
evidence and controlled-regression evidence.

## 16. Technical acceptance

```text
P1A-01 Phase 0 promoted by Root Owner            P1A-16 ownership conflict fails
P1A-02 post-merge CI green                       P1A-17 sensor failure fails closed
P1A-03 city-phase0-observatory-v1 frozen         P1A-18 shadow/enforce findings identical
P1A-04 Phase 1A branches from that tag           P1A-19 controlled regression battery passes
P1A-05 spec precedes implementation              P1A-20 baseline tree passes enforce mode
P1A-06 Q-01..Q-08 satisfied                      P1A-21 legacy ratchet unchanged
P1A-07 unexplained sensor disagreement = 0       P1A-22 production architecture repair = NONE
P1A-08 baseline mechanically generated            P1A-23 CI workflow unchanged
P1A-09 identity-level debt, not count-only        P1A-24 Root Trust MATCHES
P1A-10 inherited debt visible/grandfathered       P1A-25 evidence captured continuously
P1A-11 debt removal passes                        P1A-26 failures/corrections/negative results preserved
P1A-12 new undeclared source fails                P1A-27 Phase 0 history not rewritten
P1A-13 new undeclared-endpoint edge fails         P1A-28 branch CI green
P1A-14 declared same-capability semantics proven  P1A-29 Phase 1B not started
P1A-15 cross-capability semantics proven          P1A-30 architecture migration not started
```

If any item fails:

```text
FINAL_STATUS = PHASE1A_ACCEPTANCE_FAILED
```

No criterion may be weakened.

## 17. Promotion boundary and terminal state

After technical acceptance the machine identity may open `dev/city-phase1a-enforcement-convergence -> main` and
must then stop. It may **not** approve or merge its own promotion.

The PR must state explicitly:

```text
This does NOT activate the new gate in .github/workflows/ci.yml.
This does NOT repair inherited architecture.
This creates a qualified enforcement candidate and grandfathered-debt baseline.
A later Root Owner act is required for hosted enforcement activation.
```

```text
PHASE0 = PROMOTED_AND_FROZEN
SENSOR = ENFORCEMENT_QUALIFIED
GRANDFATHERED_DEBT_BASELINE = FROZEN
PROSPECTIVE_ENFORCEMENT = QUALIFIED
HOSTED_REQUIRED_GATE = LEGACY
PAPER_EVIDENCE = CONTINUOUSLY_PRESERVED
PHASE1B = NOT_STARTED
ARCHITECTURE_MIGRATION = NOT_STARTED

FINAL_STATUS = WAITING_FOR_ROOT_OWNER_PHASE1A_PROMOTION
```
