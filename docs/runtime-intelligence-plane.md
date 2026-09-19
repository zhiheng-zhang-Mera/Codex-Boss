# Runtime Intelligence Plane

The learning, measurement, adaptation and scheduling-intelligence layer of Codex-Boss.
It observes, measures, models and recommends. **It does not decide.**

This document is the operator-facing description of the plane: what exists, where it
lives, what it is allowed to do, how to run it, and what it deliberately does not do yet.

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

The plane's own suites live in `tests/unit/runtime-intelligence/` (twelve files). The
authority-boundary suite is the mandatory diff guard for every change to this layer.

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
