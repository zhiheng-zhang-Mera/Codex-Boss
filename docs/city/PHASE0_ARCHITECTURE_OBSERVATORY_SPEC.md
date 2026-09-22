# Phase 0 — Real-Source Architecture Observatory

**Specification.** This document is the authoritative, tracked definition of Capability City **Phase 0**.
It is the specification the Phase 0 implementation is accepted against. It is not a plan, a proposal or a
design sketch: where it says *must*, the acceptance criteria in §15 are checkable against it.

## Provenance of this specification

| Field | Value |
|---|---|
| Issuing authority | **Owner** (Root Owner directive, `OWNER_DECISION = ISSUED`) |
| Source directive | `mission-2.md` — *Codex-Boss Capability City Phase 0 — Architecture Observatory Owner Directive* |
| Source directive SHA-256 | `00926f49e9702d185246699b508aa110b11fd3ccb457beefcf2da1526bc867e9` (`24674` bytes) |
| Directive ruling | `PHASE0_DEFINITION = REAL_SOURCE_ARCHITECTURE_OBSERVATORY` · `PHASE0_BASE = city-start-baseline-v1` · `PHASE0_BASE_SHA = 53aa74a7f9628765a92210d16aabcc77ae98bae4` · `LEGACY_ARCHITECTURE_GATE_MODIFICATION = FORBIDDEN_IN_PHASE0` · `RUNTIME_STATE_EVENT_OBSERVATORY = DEFERRED` · `PAPER_EVIDENCE_CAPTURE = MANDATORY` |
| Branch | `dev/city-phase0-architecture-observatory` |
| Branch point | `53aa74a7f9628765a92210d16aabcc77ae98bae4` — equal to `city-start-baseline-v1` |
| Supersedes | the earlier `PHASE0_SPEC_NOT_FOUND` stop, which was **correct at the time** because no authoritative Phase 0 definition existed in the repository |
| Does **not** supersede | any historical document. Earlier plans remain historical records and are not edited to appear as though they always agreed with this one. The statement in `research/capability-city/OWNER_MACHINE_IDENTITY_CEREMONY.md` that Phase 0 would begin from `refactor/capability-city-v1` / `836b5ed` is a **historical plan**, superseded for execution by the directive above and left unedited. |

---

## 1. Definition and purpose

Phase 0 is the **Real-Source Architecture Observatory**: a repair of the **measurement layer**, performed
before Capability City performs any structural refactoring.

It exists because the legacy architecture ratchet currently reasons over a **manifest-declared subset** of the
repository rather than the complete real source graph.

The Observatory must answer:

```text
What source files actually exist?
What internal import relations actually exist?
Which of those relations can the current manifest model see?
Which relations does it fail to represent?
Which files have explicit capability ownership?
Which files remain undeclared / unknown?
Can the measurement be reproduced and falsified?
```

Phase 0 is a **sensor**. It is not a zoning authority, a migration engine, an architecture repair engine, or an
enforcement replacement. Formally:

```text
OBSERVE != ENFORCE
MEASURE != REPAIR
UNKNOWN != PASS
```

A future phase — tentatively *Measurement-to-Enforcement Convergence* — will decide whether and how the
corrected truth is fed into, replaces, or widens the legacy ratchet. That decision is **deferred** and is not
authorised here.

## 2. Non-goals — Construction B is explicitly out of scope

The previously discussed system involving concepts such as:

```text
STATE_MODEL
EVENT_MODEL
CONFLICT_CLASSIFIER
```

is **not** Capability City Phase 0. If it is built later it is a different capability, tentatively *Runtime /
Work Observatory*, covering runtime state, task progress, event observation, conflict detection and
control-console queries.

No part of it may be implemented in this phase merely because both systems were informally called
"Observatory".

```text
CONSTRUCTION_B_STARTED = NO
```

## 3. Entry point and read-only contract

Exactly one canonical production entry point:

```text
pnpm run architecture:observe
```

backed by a dedicated implementation, `scripts/architecture-observatory.cjs`, or the smallest equivalent
consistent with repository conventions.

The production command **must**:

1. inspect the real tracked source tree;
2. perform **no** source mutation;
3. emit machine-readable JSON;
4. write runtime evidence only into an approved gitignored artifact location;
5. exit non-zero **only** for an actual observer failure or violated observer invariant — never because the
   architecture being measured is unhealthy.

A dirty architecture is valid Observatory output. The observer failing to measure it is not.

The entry point is read-only in the strong sense: it opens files for reading, shells out only to read-only Git
plumbing (`git ls-files`) and to the legacy instrument as a subprocess, and writes exclusively under
`artifacts/`.

## 4. Production scan set

The scan universe is derived from **Git-tracked files** — not from filesystem discovery, and not from
capability manifests. The equivalent of:

```text
git ls-files
```

selected to tracked source under:

```text
electron/**
src/**
```

with source extensions:

```text
.ts   .tsx   .js   .jsx   .cjs   .mjs
```

Declaration-only files are excluded:

```text
*.d.ts
```

Never scanned:

```text
tests/**   artifacts/**   runtime-data/**   dist/**   dist-electron/**   coverage/**   node_modules/**   .git/**
```

These exclusions must **not** depend on whether those directories happen to exist locally. The decisive rule is:

```text
PRODUCTION_SCAN_SET =
    tracked runtime/application source under electron/** and src/**
```

The Observatory must **never** reduce this scan set merely because a file is missing from
`config/capabilities/*.yaml → modules`. Manifest membership is **metadata about the measured file**; it is not
permission for the Observatory to see the file.

**Normative consequence.** `UNDECLARED TARGET != DROP EDGE`, and equally `UNDECLARED SOURCE != SKIP FILE`.

## 5. Import / dependency extraction

For every scanned source file the Observatory inspects actual module dependencies. It must at minimum
recognize literal internal references from:

```text
import ... from "..."
import "..."
export ... from "..."
require("...")
import("...")
```

when the specifier is statically resolvable.

**Parsing.** AST/compiler parsing is preferred over extending the regex-based legacy measurement. Import-like
text inside comments or arbitrary string literals must **not** be counted as a dependency.

**Forms.** Each recognized syntactic form is classified as exactly one of:

```text
static-import        import X from "..."  /  import { a } from "..."
side-effect-import   import "..."
export-from          export { a } from "..."  /  export * from "..."
require              require("...")   (literal argument only)
dynamic-import       import("...")    (literal argument only)
```

**Resolution.** Internal relative references are resolved source → target against the **actual tracked source
set**, trying the literal path and the standard extension/index variants. A `.js` specifier that resolves to a
tracked `.ts` file resolves to that file (TypeScript ESM convention). A bare specifier that exactly names a
tracked source path is treated as internal; every other bare specifier is an **external package** dependency,
which may be reported separately and is not required to enter the internal capability graph.

**Deduplication rule (normative, so OBS-04 is checkable).** Internal edges are deduplicated by the pair
`(from, to)`: **exactly one edge per resolved file pair**, carrying the sorted set of syntactic `forms` that
produced it. Duplicate occurrences of the same form in one file do not produce additional edges.

**Preservation.** Every resolved internal edge must be retained. If a source or target lacks explicit manifest
ownership the edge is preserved and emitted with `owner = UNDECLARED` (or an equivalent explicit unknown
value). Never infer:

```text
UNDECLARED == SAFE
UNDECLARED == SAME_CAPABILITY
UNDECLARED == IGNORE
```

**Unresolved references.** Relative references that cannot be resolved to a tracked source file are **counted
and reported as unresolved**, never silently discarded.

**Parser failures.** A scan-set file that cannot be read, or that the parser cannot process, is a reported
condition. It must never be silently skipped, and it must never be reported as a clean file.

## 6. Ownership semantics

Phase 0 must not invent semantic capability ownership merely to make the graph look complete. For this phase:

```text
explicit ownership   = ownership already supported by tracked repository declarations
undeclared ownership = UNDECLARED / UNKNOWN
```

The declarations consulted are the tracked manifests under `config/capabilities/**` — specifically each
manifest's `modules` list, which is the repository's existing declaration of capability ownership.

**Authoritative statement of the `declared_owned_files` metric.** A tracked source file is *declared owned* if
and only if some manifest names its repository-relative POSIX path in `modules`. A file named by no manifest is
`UNDECLARED`. No path-based inference may substitute for a declaration. This definition is deliberately
narrower than the historical `owned_source_files = 594` figure, which used a broader, path-attributed notion of
ownership; that figure is retained **only as historical comparison data with its provenance** and is not the
current definition.

**Edge classes.** The Observatory distinguishes, where relevant:

```text
DECLARED -> DECLARED
DECLARED -> UNDECLARED
UNDECLARED -> DECLARED
UNDECLARED -> UNDECLARED
```

This is intentional. A future city phase may repair the declarations; Phase 0 measures their incompleteness.

Optional heuristic labels may exist only if explicitly marked `NON_AUTHORITATIVE_HINT`, and must never replace
`UNDECLARED`. If the Observatory emits any such hint it must be additive, clearly named, and excluded from every
count that feeds §15.

## 7. Legacy comparison — the control arm

Phase 0 does **not** modify:

```text
scripts/architecture.cjs
config/architecture-baseline.json
config/capabilities/**
```

except if an unrelated generated metadata update is mechanically unavoidable and can be proven semantically
neutral; otherwise stop.

`pnpm run architecture:ratchet` must remain available and behave as before. The new Observatory runs **beside**
it and produces a comparison showing at least:

```text
legacy_scanned_files
observer_scanned_files
legacy_internal_edges
observer_internal_edges
declared_owned_files
undeclared_files
legacy_visible_edges
observer_only_edges
unresolved_internal_references
```

**Inherited counts must not be treated as acceptance truth.** `25`, `594`, `187` and `43` are historical
measurements; the current city-start tree is measured again. Historical numbers may appear only as comparison
data **with provenance**.

**How the legacy arm is obtained.** The legacy instrument exposes no machine-readable file/edge counts, so the
comparison arm is produced two ways and both are recorded:

1. **`legacy_cli`** — `node scripts/architecture.cjs ratchet` and `… graph` are executed as subprocesses; the
   recorded values are the unmodified instrument's own output (pass/fail, declared-graph edge count, metrics,
   violations). This is the behavioural control: the legacy gate must still run and still exit as before.
2. **`legacy_rule_rederivation`** — the legacy *visibility rule* (scan only files named in manifest `modules`;
   resolve relative specifiers only; **drop** any edge whose target is not a declared module) is re-derived
   here so that file and edge counts exist to compare against. This is labelled
   `LEGACY_RULE_REDERIVATION`, cites its source of truth, and is never presented as the instrument's own
   output.

`legacy_visible_edges` is the set the legacy rule keeps; `observer_only_edges` is
`observer_internal_edges \ legacy_visible_edges` compared on `(from, to)` pairs.

## 8. Known-positive control

The Observatory must specifically test the historical blind spot involving:

```text
electron/bootstrap/persistence.ts
```

and the Runtime Intelligence / `tenx` live-capture dependency documented by the pre-city evidence.

**The actual current target must be resolved from source at run time**, not hard-coded. The control passes only
if the Observatory retains that real internal dependency even when the legacy ownership/manifest representation
would have hidden or incompletely represented it.

Do **not** modify the production dependency to make this test pass. The dependency is a **measurement target**
in Phase 0, not a repair target.

## 9. Required falsification / self-tests

Phase 0 requires at least the following six semantic test classes. Each must be implemented as an executable
test against the real Observatory code path — not as a prose assertion.

### OBS-01 — manifest independence
Construct a fixture where a tracked source file exists but is absent from manifest `modules`.
Expected: **the new observer sees the file.**

### OBS-02 — undeclared target preservation
Construct `declared/known source -> real tracked but undeclared target`.
Expected: **edge remains present; target owner = `UNDECLARED`.** It must not disappear.

### OBS-03 — false-import negative control
Place import-looking text in a comment, in an ordinary string, and in template text that is not an import
expression.
Expected: **no dependency edge.**

### OBS-04 — supported import forms
Exercise static import, side-effect import, export-from, `require` literal and dynamic import literal.
Expected: **every supported real edge appears exactly once**, according to §5's deduplication rule.

### OBS-05 — mutation sensitivity
In an isolated fixture/test tree: baseline → add one real internal dependency → observe exactly the expected
graph delta → remove it → return to baseline.
Expected: **the Observatory reacts to an actual architecture change.**

### OBS-06 — determinism
Run the Observatory twice against the same clean commit. After removing explicitly volatile metadata such as a
generation timestamp, the semantic output must be byte-identical or canonical-hash-identical. Order must be
deterministic.

Fixtures are isolated: **no test may change production architecture to pass.**

## 10. Required runtime artifacts

A real Mech host run must produce:

```text
artifacts/city/phase0/architecture-observatory.json
artifacts/city/phase0/legacy-comparison.json
artifacts/city/phase0/observatory-self-test.json
artifacts/city/phase0/ARCHITECTURE_OBSERVATORY_REPORT.md
```

These remain runtime-owned / gitignored, because repository path-ownership policy declares `artifacts/` a
runtime-owned path that must own no tracked file. Policy must not be violated in order to track them.

Additionally, exactly one **durable tracked acceptance record** outside `artifacts/**`:

```text
docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_ACCEPTANCE.md
```

It must bind the runtime evidence by SHA-256 and record:

```text
source commit
spec commit
host evidence class
commands executed
scan-set count
edge counts
legacy comparison
known-positive result
OBS-01..OBS-06 results
artifact hashes
limitations / UNKNOWN values
```

The full generated dataset is **not** copied into the tracked document. It is bound by hashes and summarized.

## 11. Phase 0 may expose bad news

All of the following are **valid successful measurements**:

```text
large number of undeclared files
large number of previously invisible edges
cycles
kernel -> feature dependencies
cross-domain relations
unresolved ownership
manifest inconsistencies
```

The Observatory must not fail merely because it finds them. Success means:

```text
measurement is trustworthy
```

not:

```text
architecture is already healthy
```

This distinction is mandatory for the research design.

## 12. Explicitly forbidden Phase 0 changes

Do not repair any architecture defect discovered by the Observatory. Do not:

```text
widen or replace the legacy ratchet
rewrite capability manifests to make coverage look better
move capabilities
split tenx
repair persistence -> runtime-intelligence coupling
repair private-state access
repair cycles
introduce new zoning enforcement
change Root Trust
change promotion rules
change required CI contexts
implement Construction B
begin Phase 1
```

If a test needs fixture data, it uses isolated fixture data rather than changing production architecture.

## 13. Why the legacy gate stays unchanged

This is intentional experiment design. At the end of Phase 0 Boss has:

```text
LEGACY SENSOR
    existing architecture ratchet
    known blind spot
    unchanged

NEW SENSOR
    real-source Architecture Observatory
    tested and falsifiable
    read-only
```

which allows the project to measure legacy observation **vs** real-source observation against the **exact same
production tree**. Changing the old gate at the same time would destroy that control comparison.

The historical finding *"stop dropping undeclared targets"* is therefore interpreted as:

```text
Phase 0:            stop dropping them in the new truth-producing Observatory
later enforcement:  decide how the production ratchet should consume the corrected truth
```

The legacy manifest gate is **not** widened in Phase 0.

## 14. Paper-evidence capture (mandatory)

This requirement is not optional and applies throughout the entire Phase 0 run. The goal is not merely to
preserve the final successful implementation: the run must preserve **all scientifically useful evidence**,
including failed assumptions, negative results, discrepancies, control comparisons, governance boundaries and
measurement corrections.

A tracked ledger is created and maintained at:

```text
docs/research/PAPER_EVIDENCE_LEDGER.md
```

If a durable equivalent already existed **on this branch's base**, that exact ledger would be extended instead
of creating a competing source of truth. It does not: the research ledgers of earlier rounds live on
`refactor/capability-city-v1`, which the directive states remains **evidence** and is explicitly not this
phase's base. This ledger therefore cross-references them rather than duplicating them.

The ledger is append-only in semantic meaning: historical entries may be annotated or superseded, but not
rewritten to hide prior states.

Every paper-useful item records, where applicable:

```text
EVIDENCE_ID
timestamp
source commit / branch / tag / PR / workflow
evidence class
claim being tested
prior assumption
method
observed result
expected result
discrepancy
interpretation
alternative explanation
whether independently corroborated
whether reproducible
artifact/file/hash references
paper-use category
limitations
supersedes / superseded_by
```

Allowed evidence classes must include at least:

```text
HISTORICAL   REMOTE_GITHUB   LOCAL_REAL_HOST   CONTROL   NEGATIVE_CONTROL
FIXTURE      SIMULATION      FAILURE           CORRECTION   GOVERNANCE
MEASUREMENT  REPRODUCTION
```

These categories are **not** collapsed.

**Mandatory historical paper items.** At minimum preserve or cross-reference: the pre-city baseline at
`7024203…`; the city-start baseline at `53aa74a…`; the PF020 research/test lineage; the production
runtime-isolation defect; the nested Candidate-root negative control; `D-007`; `OBS-GOV-001`; the `GOV-002` P8
measurement; the first Root Owner ceremony failure; the genuine Root Owner approval; the PR #10 genuine merge;
post-merge CI run `35679289373`; the Root Trust epoch 24 aggregate digest; `COR-1`; `D-4`; the `RQ.md` D-1
discrepancy; the legacy architecture ratchet blind spot; the historical 25/594 scan observation; the historical
187-edge observation; the historical 43 two-cycle observation; the historical 25-of-27 SCC observation; the
historical 7 cross-domain private-state observations; and the manifest-only / undeclared-target dropping
mechanism.

**Historical numbers remain labelled historical.** They must never be silently turned into Phase 0 current
measurements.

**Mandatory Phase 0 paper items.** Capture the current tracked production source count; current legacy
scanned-file count; current Observatory scanned-file count; current legacy internal-edge count; current
Observatory internal-edge count; observer-only edge count; `UNDECLARED` file count; `UNDECLARED` edge-endpoint
counts; unresolved internal-reference count; the known-positive persistence/live-capture result; OBS-01..OBS-06
raw results; determinism hashes; runtime duration where meaningful; parser/analysis failures if any; false
positives discovered; false negatives discovered; differences from historical measurements; differences from
prior assumptions; and any correction made during implementation.

**Failed attempts are preserved.** If an implementation approach fails, it is not erased because a later one
passes. Record what was attempted, why it appeared reasonable, how it failed, what evidence falsified it, and
what changed afterwards. Candidate examples: a regex parser rejected for false-positive behaviour; AST parser
incompatibility; Git tracked-set mismatch; path-resolution edge case; Windows path/case discrepancy; dynamic
import limitation; ownership ambiguity; determinism failure; a fixture that exposed a mistaken assumption. Only
source code may be replaced during normal development; the ledger retains the epistemic history.

**Negative results are preserved.** Results such as *historical claim did not reproduce*, *expected edge is
absent*, *old count changed*, *no owner can be established*, *no difference exists between two methods* are
paper-useful evidence and must be recorded. A negative result must not be converted into silence.

**Correction events are preserved.** Whenever this programme changes its own interpretation, a correction entry
is added with: `CORRECTION_ID`; original claim; evidence that falsified or weakened it; corrected claim;
whether historical text was left intact; downstream consequences. `COR-1` (an agent correcting its own
over-generalisation) is the precedent: a correction is research evidence, not embarrassment to remove.

**Experimental-control framing.** The following distinction is preserved explicitly:

```text
legacy ratchet   = control sensor
new Observatory  = experimental sensor
production tree  = same measured object
```

Because production architecture is intentionally not repaired in Phase 0, differences between the two sensors
form a clean measurement comparison. That comparison is a primary paper asset.

**Paper-evidence outputs.** In addition to the main ledger:

```text
artifacts/city/phase0/paper-evidence.json
artifacts/city/phase0/paper-evidence-index.md
```

The JSON contains structured evidence records. The Markdown index groups evidence into candidate paper
sections:

```text
Motivation / Problem · Research Questions · Method · Experimental Design · Baselines and Controls ·
Failure Discovery · Measurement Blind Spot · Governance Boundary · Negative Results ·
Corrections / Epistemic Updates · Phase 0 Results · Threats to Validity · Reproducibility · Future Work
```

The tracked acceptance document binds these two runtime paper-evidence artifacts by SHA-256.

## 15. Acceptance criteria

`PHASE0_ACCEPTED` requires **all** of the following.

```text
A01  Phase 0 branch point == 53aa74a7f9628765a92210d16aabcc77ae98bae4
A02  tracked Phase 0 specification exists and was committed before implementation
A03  architecture:observe scans Git-tracked real source independently of manifest modules
A04  all resolved internal edges are preserved even when ownership is UNDECLARED
A05  known historical persistence/live-capture blind spot is observable
A06  OBS-01 PASS
A07  OBS-02 PASS
A08  OBS-03 PASS
A09  OBS-04 PASS
A10  OBS-05 PASS
A11  OBS-06 PASS
A12  legacy architecture ratchet remains operational and semantically unchanged
A13  scripts/architecture.cjs is unchanged from city-start baseline
A14  config/architecture-baseline.json is unchanged from city-start baseline
A15  config/capabilities/** is unchanged from city-start baseline
A16  real-host Mech evidence exists
A17  runtime evidence hashes are bound into the tracked acceptance record
A18  Root Trust remains MATCHES and its surface is not modified
A19  required repository regression suites pass
A20  Phase 1 has not started
A21  PAPER_EVIDENCE_LEDGER exists and contains historical + current Phase 0 evidence
A22  failed attempts, corrections and negative results were preserved rather than overwritten
A23  paper-evidence.json and paper-evidence-index.md exist and are hash-bound
A24  historical measurements are distinguished from current measurements
A25  legacy-vs-Observatory control comparison is explicitly recorded
```

If any item fails:

```text
FINAL_STATUS = PHASE0_ACCEPTANCE_FAILED
```

No criterion may be weakened.

## 16. Required execution order

```text
 1. verify city-start baseline and frozen history
 2. cut Phase 0 branch from 53aa74a
 3. write tracked Phase 0 spec
 4. commit + push spec alone
 5. record PHASE0_SPEC_COMMIT
 6. initialize / extend PAPER_EVIDENCE_LEDGER
 7. implement Observatory
 8. implement OBS-01..OBS-06
 9. record failed attempts and corrections during implementation
10. run legacy measurement unchanged
11. run new Observatory
12. run known-positive control
13. generate real-host evidence
14. generate paper-evidence.json + paper-evidence-index.md
15. run regression/CI suites
16. write tracked acceptance record with artifact hashes
17. update PAPER_EVIDENCE_LEDGER with final measured results
18. commit + push implementation/evidence binding
19. final verification
20. stop
```

No Phase 1 work.

## 17. Report format

The round returns `BOSS_CITY_PHASE0_ARCHITECTURE_OBSERVATORY_REPORT` containing at least:

```text
FINAL_STATUS
CITY_START_BASELINE_SHA · PHASE0_BRANCH · PHASE0_BRANCH_POINT · PHASE0_SPEC_PATH · PHASE0_SPEC_COMMIT · PHASE0_IMPLEMENTATION_SHA
SCAN_ROOTS · TRACKED_SOURCE_FILES_SCANNED · LEGACY_FILES_SCANNED
OBSERVER_INTERNAL_EDGES · LEGACY_INTERNAL_EDGES · OBSERVER_ONLY_EDGES
DECLARED_OWNED_FILES · UNDECLARED_FILES · UNRESOLVED_INTERNAL_REFERENCES
KNOWN_POSITIVE_PERSISTENCE_LIVE_CAPTURE
OBS_01 · OBS_02 · OBS_03 · OBS_04 · OBS_05 · OBS_06 · DETERMINISM_RESULT
LEGACY_ARCHITECTURE_GATE_MODIFIED = NO · CAPABILITY_MANIFESTS_MODIFIED = NO · ROOT_TRUST_MODIFIED = NO
HISTORY_REWRITTEN = NO · CONSTRUCTION_B_STARTED = NO · PHASE1_STARTED = NO
REAL_HOST_ARTIFACTS · TRACKED_ACCEPTANCE_RECORD · ARTIFACT_SHA256
PAPER_EVIDENCE_LEDGER · PAPER_EVIDENCE_JSON · PAPER_EVIDENCE_INDEX · PAPER_EVIDENCE_ITEMS_TOTAL
CORRECTIONS_RECORDED · FAILED_ATTEMPTS_RECORDED · NEGATIVE_RESULTS_RECORDED
HISTORICAL_VS_CURRENT_MEASUREMENTS_SEPARATED · LEGACY_VS_OBSERVATORY_CONTROL_RECORDED
REQUIRED_TESTS · CI_RESULT · ROOT_TRUST_RESULT
```

Successful terminal form:

```text
PHASE0_DEFINITION = REAL_SOURCE_ARCHITECTURE_OBSERVATORY
PHASE0_MEASUREMENT = TRUSTWORTHY
LEGACY_GATE = PRESERVED_AS_CONTROL
PAPER_EVIDENCE = PRESERVED_AND_INDEXED
ENFORCEMENT_CONVERGENCE = NOT_STARTED
RUNTIME_STATE_EVENT_OBSERVATORY = NOT_STARTED
PHASE1_STARTED = NO

FINAL_STATUS = PHASE0_ACCEPTED
```

## 18. Research interpretation guardrails

The final report may identify candidate findings but must not overclaim. Language is drawn from:

```text
observed · measured · reproduced · not reproduced · correlated · consistent with ·
supports · does not support · remains unknown
```

One-host or one-repository observations are not upgraded into universal claims. Every proposed paper claim
points to evidence IDs, source commits, runtime artifact hashes, reproduction commands and known limitations.

The scientific record is more important than making Phase 0 look clean. A failure that teaches why the old
measurement was wrong is often more valuable than a silent green check.
