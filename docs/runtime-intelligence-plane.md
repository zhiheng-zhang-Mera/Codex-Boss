# Runtime Intelligence Plane

The learning, measurement, adaptation and scheduling-intelligence layer of Codex-Boss.
It observes, measures, models and recommends. **It does not decide.**

This document is the operator-facing description of the plane: what exists, where it
lives, what it is allowed to do, how to run it, and what it deliberately does not do yet.

**Round 2 (`RUNTIME_INTELLIGENCE_DOGFOOD_AND_REPLAY`)** added the measurement layer that
asks whether the recommendations are any good: real outcome ingestion with failure-domain
attribution (Phase G), skill loadout replay (Phase H), node telemetry dogfooding with
growth control (Phases I and M), the scheduler and continuation replay benchmarks (Phases
J and K), confidence calibration (Phase L) and the evaluation report. Those are in
sections 15–24.

---

## Authority ladder

The plane's authority is graded, and this branch may only reach level 2.

| level | name | what it may do |
|---|---|---|
| 0 | `OBSERVE` | read and record |
| 1 | `ADVISE` | say what it would do |
| 2 | `SHADOW COUNTERFACTUAL` | record what would have happened, including at which step, **without acting** |
| 3 | `ASSISTED EXECUTION` | apply a recommendation with a human in the loop |
| 4 | `AUTONOMOUS EXECUTION` | apply it alone |

**This branch is level 2.** Levels 3 and 4 are forbidden here and require a separate
review. Concretely, nothing in this plane interrupts a model, switches a model, routes a
task, routes a node, removes a skill, deletes knowledge or prunes a capability. It records
"had you listened, I would have stopped here", and the real loop keeps its own rules.

---

## 1. Position in the architecture

```text
OBSERVE  ->  MEASURE  ->  MODEL  ->  RECOMMEND  ->  SHADOW EVALUATE
```

The plane sits beside the running application, not inside its decision path. It is
deliberately **not** a boot module: wiring it into `electron/main.ts` would change the
composition root of the running product and raise the architecture ratchet's boot-module
count, which is a change to the platform foundation rather than to this layer. Callers
construct it with a data root of their own.

Three separations are maintained on purpose:

| this plane | not this plane |
|---|---|
| observation, measurement, recommendation | Root Trust, Owner authority, qualification, production promotion |
| capability *estimates* | the promotion gate's PASS/FAIL |
| scheduling *advice* | production routing and qualification host selection |

A recommendation can never acquire authority by accident. `SchedulingRecommendation`
carries `productionRoutingAuthority: false` and `qualificationHostSelection: false` as
**literal types**, and `CONTEXT_LIFECYCLE_AUTHORITY` / `SCHEDULING_ADVISOR_AUTHORITY` are
both `"ADVISORY_ONLY"`. A consumer that needs to act on the advice has to widen the type,
which makes the decision visible in review.

---

## 2. Module map

### Pure contracts — `src/shared/runtime-intelligence/`

| module | what it owns |
|---|---|
| `measurement.ts` | the fail-closed measurement primitive: `MEASURED`, `UNKNOWN`, `UNREADABLE`, `UNAVAILABLE`, `NOT_MEASURED`, each absence carrying a mandatory reason |
| `contracts.ts` | every record the plane exchanges: `TaskProfile`, `ModelCapabilityRecord`, `SkillCard`, `NodeCapabilitySnapshot`, `SchedulingRecommendation`, `ContinuationAssessment`, `ContextLifecyclePlan`, `RuntimeObservation` |
| `telemetry.ts` | builds the unified `RuntimeObservation` and explains a recorded decision (`explainObservation`) |
| `model-ledger.ts` | the model capability ledger: warm start, prior decay, anomaly robustness |
| `skill-loadout.ts` | skill health summarisation, the six skill states, loadout recommendation, shadow evaluation |
| `node-profile.ts` | pure derivations over a node snapshot: readiness, capacity, metric-by-metric comparison |
| `scheduling-advisor.ts` | `adviseScheduling` and the requirement-token grammar |
| `continuation-evaluator.ts` | the ordered continuation rules and the shadow comparison |
| `context-lifecycle.ts` | tier placement, the injection budget, the dependency floor, and restoration |

### Host — `electron/runtime-intelligence/`

| module | what it owns |
|---|---|
| `node-profiler.ts` | the only module that reads the machine: `node:os`, `node:fs` and `node:net` only |
| `intelligence-store.ts` | durable storage: atomic JSON for derived state, append-only JSONL for logs |
| `runtime-intelligence-service.ts` | `RuntimeIntelligenceService`, the facade that runs the loop |

### Runnable report — `scripts/runtime-intelligence-report.cjs`

`package.json` is a Root surface (CODEOWNERS owns it), so adding a `pnpm` script for this
CLI is an Owner decision. Run it directly instead:

```bash
pnpm run build:electron
node scripts/runtime-intelligence-report.cjs --advise
node scripts/runtime-intelligence-report.cjs --task <taskId> --out artifacts/runtime-intelligence/report.json
```

---

## 3. Fail-closed measurement

Every fact the plane reasons about is a `Measurement<T>`, never a bare value:

```ts
type Measurement<T> = { status: "MEASURED"; value: T; source: string; observedAt: string }
                    | { status: "UNKNOWN" | "UNREADABLE" | "UNAVAILABLE" | "NOT_MEASURED"; reason: string }
```

`measurementValue` returns `undefined` for an absent fact rather than a default, and
`attemptMeasurement` converts a throwing probe into `UNREADABLE`. The concrete
consequences, each with a test:

- an unread GPU is `UNKNOWN`, never `gpu: []` — an empty list reads as "this host has no
  GPU", which is a different and false claim;
- `cpu.logicalCores` is `UNREADABLE` when the probe throws, and the snapshot is still
  produced;
- `cpu.loadPercent` is `NOT_MEASURED` on Windows, because `os.loadavg()` reports 0 there
  and a confident zero would be a fabrication;
- `cpu.physicalCores` is `NOT_MEASURED` without a platform probe;
- network quality is never derived from a boolean: availability without a latency leaves
  `quality` `UNKNOWN`;
- total VRAM is `UNKNOWN` when any device did not report its VRAM;
- `nodeReadiness` returns `UNKNOWN` — never `READY` — when cores or total memory were not
  measured, while an unknown *optional* metric (a GPU, a plugin list) does not degrade a
  node. `nodeCapacityFor` reports `unknownRequirements` separately from measured
  shortfalls, so "cannot" and "do not know" are distinguishable answers;
- the store resolves a corrupt file to an empty result plus a `degradedReason`, and a torn
  JSONL line costs one row rather than the log.

---

## 4. Model capability ledger

A model first seen today is **warm-started**, not scored zero. The seed comes from a
family prior, a provider prior and the model's declared capabilities, and the prior is
carried as **pseudo-samples**:

```text
priorWeight(samples) = priorWeight0^2 / (priorWeight0 + samples)
score' = (priorWeight * score + observedWeightedValue + w * observed)
       / (priorWeight + observedWeight + w)
```

With `priorWeight0 = 6`, the prior's share is 100% at zero samples, about 33% after six
outcomes and under 5% after twenty-four. Two properties follow structurally rather than by
policy:

- a new model cannot be suppressed to zero — `warmStartScores` never produces a zero
  estimate, and a prior-only estimate carries `confidence: 0` rather than a confident low
  score;
- an established model cannot gain an irreversible advantage — every update is a weighted
  mean over a growing denominator, so one outcome moves a well-sampled estimate very
  little, and a later outcome pulls it back.

All twelve dimensions are tracked (`coding`, `reasoning`, `planning`, `review`,
`research`, `long_context`, `tool_use`, `computer_use`, `latency`, `cost`, `stability`,
`reliability`). A dimension a task kind does not exercise is **not updated**, and the
reason is recorded in `skipped`; latency and cost are only updated when they were actually
measured; a semantically attributed refusal does not move `stability`.

An **anomalous outcome** — a failure class never seen on an already-sampled model, or a
latency over five times the running mean — is folded in with weight `0.25` rather than
discarded. It is recorded (so "we saw this and counted it for little" is a fact), it moves
an established estimate by under 5%, and later successes recover it fully. All three are
asserted.

`DEFAULT_FAMILY_PRIORS` is an explicitly labelled placeholder table — every value sits
inside 0.45–0.60 — and is injectable, so replacing it with measured priors is a data change
rather than a code change.

---

## 5. Skill cards and the loadout shadow evaluator

There was no skill abstraction in the repository before this layer. A `SkillCard` declares
what a skill serves and what it costs to mount (`contextTokens`, `baseLatencyMs`).

`selected` and `used` are tracked as **different facts**, so `unusedSelections` makes the
cost of mounting a skill that never runs measurable — that is the whole point of the
module. Six states are derived with first-match-wins ordering, each with quoted reasons:

```text
HOT  ->  WARM  ->  COLD  ->  RARE  ->  REDUNDANT  ->  PRUNE_CANDIDATE
```

`PRUNE_CANDIDATE` requires **both** repeated wasted mounting (`minUnusedForPrune`
selections that never invoked the skill) **and** a replacement (`redundancy >= 1`). A
merely unused skill stays `COLD` — a cold skill is kept available, which is exactly the
difference between cold and pruned.

**`PRUNE_CANDIDATE != DELETE`, structurally.** The module exports no delete, remove,
uninstall, prune or disable function, and a test asserts that against `Object.keys` of the
module — with a control proving the check would fire if such an export appeared.
`LoadoutRecommendation` can only say "mount" or "do not mount", and
`evaluateLoadoutShadow` returns `deletesNothing: true`.

---

## 6. Node capability profiler

Reads `node:os`, `node:fs` (`statfs` for real free/total disk) and `node:net` only. It does
**not** import `node:child_process`: the repository has exactly one declared process
gateway and a profiler is not it.

Every probe is isolated, so one failing probe costs one metric. `NodeProbeSet` is the
injection seam, which is how the fail-closed cases are tested and how a platform-specific
GPU or physical-core probe is added.

`probeNetwork({ host, port, timeoutMs })` is a real TCP probe. `ECONNREFUSED` is reported
as **available** with a measured latency — the host answered, so the network and host stack
are up and only the port is closed — while a timeout or resolution failure is unavailable.
API availability is derived from which provider credentials are **present** in the
environment; the values are never read into a snapshot, and a test asserts no credential
value can appear in the result.

A host that has not been classified is `UNKNOWN_HOST`. Trust is never a default.

---

## 7. Scheduling advisor

```text
task kind              -> primary capability dimension
model capability       -> utility = score * (0.5 + 0.5 * confidence)
node readiness         -> eligible, or blocked with the reason
requirement tokens     -> gpu | cores:<n> | memory:<mb> | provider:<id>
                          | local-model:<id> | tool:<name>
skill health           -> loadout
```

The confidence floor (`ADVISOR_WEIGHTS.confidenceFloor = 0.5`) is deliberate: a
warm-started estimate is *halved*, not excluded, so a brand-new model can still be chosen
and can still earn evidence. Excluding it would make the ledger's warm start pointless.

An unrecognised requirement token is **reported, not ignored** — silently dropping `gpu` is
how a task lands on a machine that has none. A node whose readiness could not be
established is not ranked last with a low score (a score would look like a measurement); it
is `blocked` with the reason its core facts are missing. Cost and latency estimates appear
only when the ledger measured them; an unmeasured model yields absent fields, never `0`.

---

## 8. Continuation evaluator

Ordered deterministic rules over progress, novelty, uncertainty, unresolved items, tokens,
repeat rate, self-contradictions, reviewer disagreement and tool progress, producing
`CONTINUE`, `STOP`, `SWITCH_MODEL`, `ASK_REVIEWER`, `DECOMPOSE_TASK` or
`RETRY_WITH_CONTEXT`. Each assessment names the rule that fired **and** the rules that did
not, so a reader can see what was ruled out.

- obvious repetition (`repeatRate >= 0.8` with `outputNovelty <= 0.1`) advises
  `SWITCH_MODEL`;
- an exhausted plan with work left advises `DECOMPOSE_TASK`;
- `STOP` requires nothing unresolved;
- an unmeasured signal neither triggers nor vetoes a rule, and the absence is recorded.

Every assessment is `mode: "SHADOW_ONLY"` with `wouldActAtStep` and a `counterfactual`, and
a test asserts against the module's own exports that nothing here can stop, abort, restart,
apply or execute anything. `compareContinuationShadow` judges the advice later against what
the loop actually did; an unobserved loop is reported as neither agreement nor
disagreement.

The real termination path is untouched this round. Wiring the advice in is a separate,
later decision.

---

## 9. Context and knowledge lifecycle

```text
HOT (inject) -> WARM (retrieval candidate) -> COLD (cold storage) -> ARCHIVE
```

Tier placement is primarily a **recency window** (`hotWindowHours`, `warmWindowHours`,
`coldWindowHours`) with the relevance score promoting a record into a warmer tier: recency,
retrieval count, success contribution, dependency count and confidence, minus a size
penalty so a huge record cannot win on recency alone.

Two mechanisms make the plan safe:

- **the injection budget.** Records ranked highest are injected until the budget is spent;
  a record that does not fit is demoted to a retrieval candidate with the budget named as
  the reason. It is not dropped, because "not in this prompt" and "not available" are
  different;
- **the dependency floor.** If an injected record depends on another record, that
  dependency may not fall below retrieval-candidate tier, or the injected record would cite
  something the next step cannot fetch.

**`ARCHIVE != DELETE`.** Every placement carries `restorable: true`, the plan carries
`deletesNothing: true`, `requestRestore` works from every tier including `ARCHIVE`, and the
module exports no delete, remove, purge, drop, destroy or evict function (asserted against
`Object.keys`, with a control).

---

## 10. Unified telemetry

`RuntimeObservation` is the record the repository previously could not produce. It joins:

```text
Task -> Model -> Node -> Skill loadout -> Context loadout
     -> Execution -> Review -> Continuation (shadow) -> Capability update
```

`explainObservation` answers the operator's questions from that record alone — why this
model, why this node, why these skills, why not the others, what context was loaded, what
continuation was advised, and whether the outcome supports the decision. When no
recommendation was recorded it says so; it never invents provenance.

`judgeDecisionOutcome` distinguishes `NO_ADVICE_RECORDED`, `INCONCLUSIVE_NO_OUTCOME`,
`NOT_FOLLOWED`, `SUPPORTED_BY_OUTCOME` and `CONTRADICTED_BY_OUTCOME`. Counting a run with
no advice as either support or contradiction is what would let an empty log look like a
good record.

---

## 11. Storage layout

Under `<dataRoot>/.boss/runtime-intelligence/` (see `runtimeIntelligenceRoot`):

| file | shape |
|---|---|
| `observations.jsonl` | append-only, one `RuntimeObservation` per line |
| `skill-telemetry.jsonl` | append-only, one `SkillUsageTelemetry` per line |
| `models.json` | atomic whole-file JSON, the capability ledger |
| `nodes.json` | atomic whole-file JSON, bounded to `NODE_SNAPSHOT_HISTORY_LIMIT` snapshots per node |
| `context-records.json` | atomic whole-file JSON, the context records |

Nothing here is authoritative for anything else in Boss; every file is rebuildable from
observed runs.

---

## 12. Root Trust boundary

The plane is ordinary product surface, and that is checked rather than asserted.
`tests/unit/runtime-intelligence/authority-boundary.test.ts` walks the plane's own
directories and runs the repository's **real** classifiers — `classifySurface`,
`assessProtectedPaths`, `ProtectedSurfaceGuard`, `deriveChangeClass` — requiring `ALLOW`,
`PRODUCT_SURFACE` and `ORDINARY_AUTONOMOUS_CHANGE`, with positive controls for Root Trust,
Owner Authority, gate files and path escapes. No second, weaker definition of "protected"
exists in this layer.

### `BLOCKED_BY_ROOT_TRUST_BOUNDARY`

**A new capability manifest for this plane is blocked.** Registering
`config/capabilities/runtime-intelligence.yaml` would raise the architecture ratchet's
`capabilityCount` from 27 to 28, and
`tests/acceptance/platform-certificate.test.ts` pins that count at 27. `tests/acceptance/**`
is Root Trust Surface: editing it requires an Owner action and a trust-epoch advance, which
an autonomous actor may not perform. The plane's modules are therefore registered under the
**existing `tenx` capability** in `config/capability-modules.json`, which already owns
`electron/commander` (scheduler, continuation, context), `electron/fleet`, `electron/tenx`
(node identity, dynamic scheduler) and `src/shared/node-capabilities.ts`.

**Wiring the plane into the composition root is blocked for the same reason.** A boot module
would raise `bootModuleCount` and require editing the same protected acceptance test. The
facade is constructed by its caller instead.

Neither block prevents the plane from running; both are recorded here rather than worked
around.

---

## 13. Known limitations and deferred items

- **GPU and physical-core probes are absent.** Windows GPU and physical-core counts need a
  platform probe (WMI, `nvidia-smi`) and the only available mechanism is a child process,
  which this layer may not start. Both metrics are `UNKNOWN` / `NOT_MEASURED` with a reason,
  and `NodeProbeSet` is the seam for adding a probe.
- **Disk throughput is not measured.** No safe synchronous source exists, so it is not
  claimed. Only free/total capacity is collected.
- **Mapped network drives read as `LOCAL`.** Distinguishing a mapped drive from a local disk
  needs a platform probe; only UNC paths are classified as `NETWORK`.
- **`probeNetwork` is asynchronous** and is not called by `collectNodeSnapshot`; the caller
  awaits it and passes the result in through `probes.network`, so the collector stays
  synchronous.
- **The plane is not wired into execution.** No production call site records episodes,
  advises routing, or acts on a continuation opinion. This round establishes the data loop;
  granting any part of it execution authority is a later, separate decision.
- **UI is deferred.** No renderer panel was added, to avoid a large unrelated diff. The
  report CLI and the store are the current observation entry points.
- **No dashboard, no database, no distributed protocol.** Deliberately: small, composable,
  observable, testable, replaceable.

---

## 14. Verification

```bash
pnpm run typecheck
pnpm run security:scan
pnpm run architecture:ratchet
node scripts/generate-test-catalogue.cjs && pnpm run test:catalogue:check
pnpm test
```

The plane's own suites live in `tests/unit/runtime-intelligence/` (twenty files). The
authority-boundary suite is the mandatory diff guard for every change to this layer.

### The evaluation report, on real data

```bash
pnpm run build:electron
node scripts/runtime-intelligence-report.cjs --sample 6 --evaluate --out artifacts/runtime-intelligence/evaluation.json
```

`--sample n` takes n real node samples through the telemetry log; `--evaluate` assembles
the report from everything the plane recorded, ingests any real Boss data it is pointed at
with `--data-root`, and states the boundary facts by calling the same guard the diff guard
uses. `--skill-cards <file>` and `--continuation-corpus <file>` supply the corpora those
two benchmarks need.

### The branch-wide diff guard

`scripts/runtime-intelligence-diff-guard.cjs` runs the same check over a whole branch's
change set, using the compiled modules, so it can be run before a commit:

```bash
pnpm run build && node scripts/runtime-intelligence-diff-guard.cjs [--base origin/main]
```

It calls the repository's real boundaries — `ProtectedSurfaceGuard`, `assessProtectedPaths`,
`deriveChangeClass` and `decideAuthorityAction` — and exits non-zero unless every one of
them agrees. Its verdict is the **authoritative decision**, not a private opinion:
`decideAuthorityAction({ actor: "autonomous", action: "change" })` is asked directly, and
its rule is that a change is autonomous below `ROOT_TRUST_CHANGE`.

A note on reading the output: test files classify as `VERIFICATION_SURFACE` and the change
class is `PRIVILEGED_NON_ROOT_CHANGE (1)`, not `ORDINARY_AUTONOMOUS_CHANGE (0)`, because the
trust model's tier list includes `tests/**`. That is expected for any commit that adds a
test, and the decision function answers `ALLOW` with the reason `change class 1 is
autonomous`. What must be empty is `rootTrustSurfacePathsChanged`, `ownerReviewPaths`,
`deniedPaths` and `escapes`.

```text
base                             origin/main
changedFiles                     28
protectedSurfaceDecision         ALLOW
authority.decision               ALLOW  ("change class 1 is autonomous")
rootTrustSurfacePathsChanged     []
ownerReviewPaths                 []
escapes                          []
verdict                          ORDINARY_AUTONOMOUS_CHANGE
```

---

## 15. Phase G — real outcome ingestion and failure attribution

`src/shared/runtime-intelligence/outcome-ingestion.ts` and
`electron/runtime-intelligence/outcome-source.ts`.

The rule the phase exists for: **an environment failure is never charged to model
capability.** A network outage, a missing tool, an unavailable host, a refused credential,
a provider rate limit and a changed automation surface all produce a failed run, and none
of them is evidence about `reasoning`, `coding` or `stability`.

- `attributable` is true only for the `MODEL` and `SEMANTIC` domains. `chargeable` is a
  separate, wider fact: a success and a partial success are chargeable too, because they are
  positive evidence. A non-attributable failure is neither, so `toModelOutcomeInput` returns
  `undefined` and there is literally nothing to fold into the ledger. The observation is
  still recorded, with its domain and the reason it was not charged.
- Real Boss vocabularies are classified directly — `RuntimeResult.status` (`AUTH_REQUIRED` →
  `CREDENTIAL`, `RATE_LIMITED` → `RATE_LIMIT`, `PAGE_CHANGED` → `AUTOMATION_SURFACE`, …) and
  `SemanticOutcome` (refusals → `SEMANTIC`, quality failures → `MODEL`) — so no text
  guessing is needed for the cases the runtime already names.
- The marker table is consulted in a declared **precedence order** with the transport
  domains ahead of the prose ones. This is not cosmetic: `ECONNREFUSED` contains the word
  "refused", and a semantic marker checked first would classify a socket error as a model
  refusal and charge it to the model. A test asserts the ordering.
- Fail-closed both ways: an unrecognised failure with no judged output is `UNKNOWN`, and a
  bare timeout is `TRANSIENT`. Neither is charged.
- Ingestion reads the two durable sources that already exist, through their **real**
  readers: `TelemetryStore` over `<dataRoot>/.boss/telemetry.json` and `EpisodeStore` over
  `<dataRoot>/.boss/learning/episodes.jsonl`. Both throw on an invalid file, so each read is
  wrapped: a damaged source degrades to zero records with the reader's own reason, and the
  healthy source still contributes.
- Model identity is derived honestly: provider from the episode, family from the runtime id,
  and **no version**, so `modelKeyOf` spells it `unknown`. A runtime id is not a model
  version.

## 16. Phase H — historical skill loadout replay

`src/shared/runtime-intelligence/skill-replay.ts`. Nothing here changes a real loadout.

The safety property is structural: the recommended set is the advisor's choice **unioned
with every skill the task actually invoked**, so a skill that did work cannot be dropped by
construction. A test injects a dropped invoked skill to prove the aggregate would catch a
defect anyway, and an invoked skill with no card is preserved and reported as uncosted — a
saving computed by discarding something we cannot describe is not a saving.

The honesty property is separate: a task with no usage telemetry cannot prove anything was
wasted. Its saving goes to `unprovenContextSaved` (reported, never quoted), its risk is
`UNKNOWN` rather than `LOW`, and only usage-observed replays feed `estimatedTokenSaved`,
`loadReduction` and the `OK` verdict.

## 17. Phase I — node telemetry dogfooding

`electron/runtime-intelligence/node-telemetry-log.ts` and
`src/shared/runtime-intelligence/snapshot-retention.ts`.

Alienware-2 is the first node this samples, and nothing in the code knows that: the node id
is whatever the profiler observed, it is data, and no branch compares it to a literal. A
second machine needs no code change, and a test proves it by profiling an injected id.

Growth is controlled at both ends:

- **at write time**, `append` refuses a snapshot whose substance is identical to the last
  one *within* the sampling interval and counts the suppression in a persisted index.
  Outside the interval an identical sample **is** stored, because periodic evidence that the
  node is still there with the same capabilities is worth a row;
- **at compaction time**, consecutive duplicates collapse into a representative that counts
  them and the overflow beyond `maxPerNode` is archived, not deleted. The plan carries
  `deletesNothing: true`.

A snapshot's substance is every measured fact except `capturedAt` and the node identity, so
a timestamp difference is never mistaken for a capability change and an `UNKNOWN(no probe)`
is part of the substance rather than a blank.

**A real interaction the tests surfaced:** because the digest covers every measured fact on
purpose, a volatile metric such as free disk makes consecutive real samples distinct. On a
live host the retention limit and the archive — not digest collapse — are therefore the
binding growth control. Collapse bounds a quiet node; retention bounds a busy one.

## 18. Phase J — scheduler replay benchmark

`src/shared/runtime-intelligence/scheduler-benchmark.ts`. The first of the two instruments.

- Per-case verdicts `SUPPORTED` / `CONTRADICTED` / `INCONCLUSIVE` / `NOT_FOLLOWED`, with
  model and node agreement, fallback use, loadout agreement, both estimation errors and the
  reasons.
- A failure only **contradicts** the advice when it is attributable to the model. A run that
  died on a network outage is `INCONCLUSIVE`, because the choice had nothing to do with it.
- The headline metric is a **lift over a stated baseline**, never a bare percentage:
  `successLiftOverOverall` compares followed recommendations with every observed run, so an
  all-success corpus cannot flatter the advisor, and `agreementLiftOverMajority` scores
  agreement against always naming the most common model. The tests demonstrate why: a wrong
  advisor that always names the model which then failed agrees with reality on every one of
  those cases, and only the lift separates it from a good one.
- Calibration is measured over **followed cases only**. The confidence is a claim about the
  advised choice, so only a run that took the advice can test it; including ignored advice
  would punish the advisor for an outcome it never influenced.

## 19. Phase K — continuation replay benchmark

`src/shared/runtime-intelligence/continuation-benchmark.ts`.

- Per-step flags: `falseStop`, `falseContinue`, `unnecessarySwitch`, `missedDecomposition`,
  `unnecessaryReview`, plus the calls a correct `STOP` would have saved.
- `FALSE_STOP_RATE` is reported as the plan names it, and is `undefined` when the advice
  never said `STOP`: no stops is not a perfect record, it is no record.
- The plan's asymmetry is data. `CONTINUATION_PENALTIES.falseStop` is **5** against
  `unnecessaryContinue` **1**; a test asserts both the ordering and the 5× ratio, and the
  per-kind penalty breakdown is reported so the weighting is visible in the output.
- A step whose observed behaviour was `UNKNOWN` is left unjudged, fires no flag and
  contributes to no rate, so an unrecorded step can never be counted as the advice being
  right.

## 20. Phase L — confidence calibration

`src/shared/runtime-intelligence/calibration.ts`. A reliability table (ten buckets), a
Brier score, an expected and a maximum calibration error, and a verdict:
`WELL_CALIBRATED`, `OVERCONFIDENT`, `UNDERCONFIDENT` or `INSUFFICIENT_EVIDENCE`.

- An empty bucket has **no** support rate — `undefined`, never `0`. A bucket nobody landed
  in is not evidence of anything, and a zero would read as "always wrong". Empty buckets also
  contribute nothing to the expected calibration error and are not counted, so an advisor
  that only ever predicts one value is not flattered by nine empty buckets.
- A verdict needs `MIN_SAMPLES_FOR_CALIBRATION` samples. Below it the table and the bias are
  still reported and the verdict is withheld, because a bias computed from ten outcomes is a
  rumour. The comparison carries an epsilon, so a bias arithmetically equal to the threshold
  does not flip on floating-point rounding.
- A per-source breakdown answers "which advisor's confidence has no meaning".

## 21. Phase M — telemetry growth control

The same two mechanisms as Phase I, applied to the plane's own store, plus the classification
the plan asks for: raw observation, derived evaluation and aggregate summary are distinct
kinds, and compaction moves and collapses rather than removes. `deletesNothing` is a literal
on the retention plan, so a caller cannot mistake it for a deletion, and nothing in this
round deletes a record at all — a collapsed duplicate keeps its count, which is the
information that mattered.

## 22. The evaluation report

`src/shared/runtime-intelligence/evaluation-report.ts`, produced by
`node scripts/runtime-intelligence-report.cjs --evaluate`.

It answers nine questions — is the model scoring calibrated, how often are the scheduler's
recommendations successful, which skills are mounted but unused, which context is injected
without contributing, how many calls the continuation evaluator would save, how many false
stops it produces, which advice is confident but often wrong, which nodes are often
`UNKNOWN`, and whether there is enough data for the next stage.

Two rules shape it. **Evidence and readiness are separated**: the report states what was
measured and then, separately, whether that is enough to propose level 3. It carries
`grantsExecutionAuthority: false` as a literal, so reading it can never be mistaken for a
permission. And **it never invents a number**: every metric is either measured or the string
`NOT_MEASURED`, and a question whose data does not exist says so with the specific reason.

It emits the round's required metric names in one place (`EVALUATION_METRIC_KEYS`), so none
can be dropped silently:

```text
MODEL_OUTCOMES_INGESTED   TASKS_REPLAYED
SCHEDULER_SUPPORTED       SCHEDULER_CONTRADICTED   SCHEDULER_INCONCLUSIVE
CONTINUATION_DECISIONS_REPLAYED   FALSE_STOP_COUNT   FALSE_STOP_RATE
UNNECESSARY_CONTINUE_RATE SWITCH_MODEL_ERROR_RATE
SKILL_LOADOUT_REPLAYS     ESTIMATED_SKILL_OVERHEAD_REDUCTION
NODE_SNAPSHOTS_RAW        NODE_SNAPSHOTS_AFTER_COMPACTION
CONFIDENCE_CALIBRATION_ERROR   TELEMETRY_STORAGE_GROWTH
ROOT_TRUST_TOUCHED        QUALIFICATION_TOUCHED    OWNER_REVIEW_PATHS
```

Readiness is `READY_FOR_ASSISTED_EXECUTION_PROPOSAL` only when all four gates pass on
measured data — the scheduler beats a stated baseline, the false-stop rate is at or below
`MAX_FALSE_STOP_RATE_FOR_ASSISTED` (2%), the ledger is `WELL_CALIBRATED`, and no replay would
have dropped an invoked skill. Anything less, including "the data does not exist", is
`INSUFFICIENT_EVIDENCE`. The report never returns a "probably fine".

## 23. What this host actually measured

```text
node samples            6 requested, 5 stored, 1 suppressed inside the interval
node coverage           55% of metrics observed on this machine
not measured            cpu.physicalCores, cpu.loadPercent, gpu.devices, gpu.vram,
                        network.*, load.currentTasks, localModels, plugins
ingested outcomes       0    (no Boss application data root exists on this host)
scheduler replay        0 cases
continuation replay     0 judged steps
skill loadout replays   0
calibration samples     0
readiness               INSUFFICIENT_EVIDENCE
```

This is the honest result, not a failure of the pipeline: the pipelines are exercised by
their own tests and by the corpus-driven CLI, and the instrument itself is validated by
controls (a deliberately correct and a deliberately wrong policy must be told apart). What
is missing is real task data, which this host has never produced.

Two specific findings worth carrying forward:

- **a real continuation replay is not possible from what the plane records.** The shadow
  decision *is* recorded (`RuntimeObservation.continuation`), but the loop's per-step
  completion state is not, so `taskComplete` at step N cannot be derived and a false-stop
  rate cannot be computed. Recording that per-step state is the prerequisite for Phase K on
  real data;
- **per-record context contribution does not exist yet.** Injection is recorded; attributing
  an outcome back to an individual context record needs a later phase, and the report says
  so rather than estimating it.

## 24. Boundary notes for this round

- `PF-DEBT-018` (the qualification corpus provenance record's runner labels) and the
  qualification topology are **not touched**: the retired public real-host lane is not
  restored, and no qualification generator, workflow or tier declaration is modified. The
  evaluation report simply records `QUALIFICATION_TOUCHED` from the guard's own assessment.
- `PF-DEBT-003` (the AppContainer suites) remains `ENVIRONMENT-BLOCKED` and untouched. The
  unit tier's sandbox suites fail identically on an unmodified baseline, the known-issues log
  explicitly forbids lowering, mocking or skipping them, and the failure signature on this
  host — `APPCONTAINER_PROBE_FAILED` masking every specific refusal code including the
  suite's own control case — is the documented stale-profile accumulation, verified by
  counting 16 leftover `codexbossevolution-*` profiles.
- The capability-manifest and composition-root blockers from the previous round are
  unchanged and still recorded in section 12.

---

## 25. Real data acquisition (round 3, `RUNTIME_INTELLIGENCE_REAL_DATA_ACQUISITION`)

The previous round ended with `REAL_DATA_SAMPLE_COUNTS task-level = 0` and concluded that no
Boss data root existed on this host. **That conclusion was wrong**, and the correction is the
first result of this round.

### What was actually there

```text
root      C:\Users\15601\AppData\Local\CodexBoss   (the application's userData)
          426 files, from 2026-09-03/04
holds     state.json   5 tasks · 13 runs · 18 dispatch checkpoints · 4 artifacts
                       2 evidence bundles · 12 runtime statuses · 200 events
          .boss/tasks/<id>/checkpoints/*.json     58 task-ledger checkpoints
also      %LOCALAPPDATA%\CodexBossSandbox         the sandbox launcher stamp (PF-DEBT-003)
absent    <repo>/runtime-data, <repo>/history, telemetry.json, learning/episodes.jsonl
```

Two causes compounded. The plane's reader defaulted to the repository's `runtime-data/`, which
this application never writes; and the reconnaissance that "confirmed" absence had a PowerShell
operator-precedence bug — `@($a + "x", $b + "x")` concatenated the two candidate roots into one
string, so neither was ever checked. `locateRealDataRoots` now searches the plausible roots and
reports per root what it holds, so a zero read can no longer be mistaken for an absence.

### The pipeline

```bash
pnpm run build:electron
node scripts/runtime-intelligence-report.cjs --sample 8 --real-data --out artifacts/runtime-intelligence/report.json
```

locate → export → sanitize → import → replay → benchmark → report, and read-only until the
plane's own `runtime-intelligence/replay/` area is written. The exporter builds each field from
a whitelist, so objectives, prompts, messages, constraints, artifact bodies and session ids are
never read into a record; the provenance names every redacted field, `scanSecrets` verifies the
result, and a corpus that fails that check is discarded rather than written. A test asserts the
production root is byte-unchanged after an export.

### What the real corpus measured

```text
records                     58  (5 tasks, 58 checkpoints, 0 skipped, 0 problems)
records with an outcome     49  (SUCCESS 49, NOT_MEASURED 9 — the 9 still-queued runs)
review outcome              NOT_RUN 58   (the application recorded no review)
failure domains             NOT_MEASURED 58
continuation steps replayed 58  (all judged; 0 skipped, 0 invalid)
scheduler cases             31
calibration samples         31

CONTINUATION_DECISIONS_REPLAYED  58
FALSE_STOP_COUNT                  5
FALSE_STOP_RATE                   0.5
UNNECESSARY_CONTINUE_RATE         0
SWITCH_MODEL_ERROR_RATE           NOT_MEASURED (no switch was advised)
CONFIDENCE_CALIBRATION_ERROR      0.7331  (UNDERCONFIDENT, n=31)
SCHEDULER_LIFT                    0
SKILL_LOADOUT_REPLAYS             0
NODE_SNAPSHOTS_RAW / AFTER        8 / 8   (25 781 bytes)
```

### The finding that matters

**The continuation evaluator produced a false-stop rate of 0.5 on real data.** It advised STOP
on 10 steps and 5 of those were wrong about the work being finished. The five are the five
COMPILE checkpoints: at compile time `pendingSteps` is empty because the work list has not been
created yet, every other signal is unmeasured, and the evaluator's fallback when no rule fires
is STOP — the most expensive decision it can make. Its own asymmetric penalty (5 against 1)
prices that at 25, and the report's `false-stop-rate-low` gate (≤ 2%) fails by a factor of 25.

This is exactly what the instrument was built to find, and it is a defect in the *evaluator*,
not in the data: a state the evaluator cannot see must not produce its most dangerous decision.
**It was deliberately NOT fixed in this round.** Changing the fallback now would erase the
measurement that proves it is wrong, and the round's rule is that the benchmark measures — it
does not tune. The measurement is recorded here so the change can be made against evidence
rather than against taste.

The other gates fail for honest, non-alarming reasons. The scheduler agreement is 1.0 but so is
the majority-model baseline, because all 31 dispatches resolved to a single runtime identity —
there is nothing to discriminate on, and `successLiftOverOverall` is 0. `ledger-calibrated` is
`UNDERCONFIDENT` (bias −0.73): advice given at confidence ~0.15 was right far more often than it
claimed. Skill replay has no data because the application of 2026-09 recorded no skill usage,
and cost/latency estimation has none because a web transport exposes neither.

**Readiness is `INSUFFICIENT_EVIDENCE`, and the report still grants no execution authority.**
The branch remains at level 2.

### Two more real gaps, closed as contracts

- **Step completion** (`step-completion.ts`) is now derived from the loop's own
  `completedSteps` / `pendingSteps` / `nextAction`, so a false-stop rate is computable at all.
  Its decisive rule came from the data rather than from reasoning: `pending === 0` is not
  completion, because the COMPILE checkpoint reports zero pending work before any work item
  exists.
- **Context contribution** (`context-contribution.ts`) records only observable signals and
  keeps the plan's line: being injected is not contribution. A record that was retrieved and
  injected and observed nowhere else is `UNKNOWN` and reported as `injectedButUnattributed` —
  measurable waste, and not proof the record was useless. No real context signal exists in this
  corpus, so the report answers `NOT_MEASURED` rather than estimating.

### Known limitations of this corpus

- **Per-step provider attribution is unavailable.** The checkpoint records `activeProvider` as
  null and the export uses the task's first recorded run provider for every step of that task,
  so the 31 scheduler cases are task-level attributions, not 31 independent dispatch decisions.
  That is why a single model identity appears. Mapping the checkpoint's worker sessions to a
  provider is the prerequisite for a per-dispatch scheduler replay.
- **`TASKS_REPLAYED` counts replay cases**, and each case is a task-step, so the name is looser
  than the number.
- The five tasks are a chat/work corpus from one day in September; nothing here is a
  representative sample of Boss usage, and the report says so instead of implying otherwise.


