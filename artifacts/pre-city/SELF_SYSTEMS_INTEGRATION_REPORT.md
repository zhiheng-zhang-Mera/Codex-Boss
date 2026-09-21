# SELF-SYSTEMS — INTEGRATION REPORT

**Stage:** Pre-City Integration RC, stage 2 (Self Cognition / Self Diagnosis / Self Case Record).
**Integration branch:** `integration/pre-city-baseline`.
**Base:** the Runtime Intelligence stage tip `432f859` (itself on `origin/main` = `4da0ed0`).
**Merge commit:** `baf4108` — *integrate(self-systems): Self Cognition, Self Diagnosis and Self Case Record
as one stack*.
**State after this stage:** all local gates green (§5). CI re-run on the final RC HEAD (§6).

---

## 1. Source branches examined

| Branch | tip | ahead/behind vs merge-base `0a1bce7` | files | CI at tip | Verdict |
|---|---|---|---|---|---|
| `dev/self-case-record-v1` | `6cc84d2` | 9 / 10 | 36 | success | **SELECTED** (stack tip) |
| `dev/self-diagnosis-v1` | `32bc058` | 6 / 10 | 25 | success | superseded (stack ancestor) |
| `dev/self-cognition-v1` | `9d1b8b2` | 4 / 10 | 14 | success | superseded (stack ancestor) |

### 1.1 The chain is a pure stack — proved by ancestry, not by the arrow diagram

The task asserted the stacking relationship and then required that it be re-checked. Re-checked:

```
git rev-list --count origin/dev/self-case-record-v1..origin/dev/self-cognition-v1  =>  0
git rev-list --count origin/dev/self-case-record-v1..origin/dev/self-diagnosis-v1  =>  0
```

Both are strict ancestors of `dev/self-case-record-v1`. The commit history confirms the same order without
merge commits:

```
c0032ea  self-cognition: a self model derived from the repository's own facts
3b56045  self-cognition: the model's identity, and the drift between two bodies
3f22865  self-cognition: the drift report's own type is reached by its own test
9d1b8b2  self-cognition: the drift command refuses a description instead of comparing against one
7c9425e  self-diagnosis: ranked candidate causes, a plan to check, advisory treatments
32bc058  self-diagnosis: the engine's identity, and the line between a candidate and a claim
16e259a  self-case-record: an append-only record of what happened, thought and done
f443b60  self-case-record: provenance, dogfood metrics, and the state-core separation
6cc84d2  self-case-record: the dogfood protocol, with the first pass frozen and nothing tuned
```

**Only the tip was merged.** Merging `self-cognition-v1` and `self-diagnosis-v1` separately, as the task
forbids, would have added two merge commits and two redundant resolutions of the shared config files for
zero content.

### 1.2 Selected commits

All 9 commits of `dev/self-case-record-v1`, merged with `git merge --no-ff` to preserve the SHAs that
carried the branch's own green CI run.

| SHA | Subject | Capability |
|---|---|---|
| `c0032ea` | a self model derived from the repository's own facts | Self Cognition |
| `3b56045` | the model's identity, and the drift between two bodies | Self Cognition |
| `3f22865` | the drift report's own type is reached by its own test | Self Cognition |
| `9d1b8b2` | the drift command refuses a description instead of comparing against one | Self Cognition |
| `7c9425e` | ranked candidate causes, a plan to check, advisory treatments | Self Diagnosis |
| `32bc058` | the engine's identity, and the line between a candidate and a claim | Self Diagnosis |
| `16e259a` | an append-only record of what happened, thought and done | Self Case Record |
| `f443b60` | provenance, dogfood metrics, and the state-core separation | Self Case Record |
| `6cc84d2` | the dogfood protocol, with the first pass frozen and nothing tuned | Self Case Record |

### 1.3 Discarded / superseded

| Source | Commits | Why |
|---|---|---|
| `dev/self-cognition-v1` | `c0032ea` … `9d1b8b2` (4) | Strict ancestor of the tip; **contained**, not discarded. Reachable from the merge. |
| `dev/self-diagnosis-v1` | `7c9425e`, `32bc058` (2) | Strict ancestor of the tip; **contained**, not discarded. |

---

## 2. What arrived

36 files changed relative to the merge-base.

### 2.1 Self Cognition

| Path | Role |
|---|---|
| `src/shared/self-cognition/contracts.ts` | the shared types |
| `src/shared/self-cognition/anatomy.ts` | the component/capability anatomy |
| `src/shared/self-cognition/describe.ts` | the description surface |
| `src/shared/self-cognition/drift.ts` | drift between two bodies of the self model |
| `electron/self-cognition/facts.ts` | main-process fact gathering |
| `scripts/self-view.cjs` | the CLI |
| `docs/self-cognition.md` | docs |
| `tests/unit/self-cognition/{boundary,describe,drift,self-model}.test.ts` | tests |

### 2.2 Self Diagnosis

| Path | Role |
|---|---|
| `src/shared/self-diagnosis/{engine,hypotheses,observations,plan,policy,treatment}.ts` | the engine, ranked candidate causes, the observation source interface, the plan, the policy, advisory treatments |
| `electron/self-diagnosis/sources.ts` | the main-process observation sources |
| `scripts/self-diagnosis.cjs` | the CLI |
| `docs/self-diagnosis.md`, `docs/self-diagnosis-dogfood.md` | docs |
| `tests/unit/self-diagnosis/{diagnosis,observations}.test.ts` | tests |

### 2.3 Self Case Record

| Path | Role |
|---|---|
| `src/shared/self-case-record/{case,timeline,recurrence,dogfood}.ts` | the append-only record, the timeline, recurrence detection, the dogfood metrics |
| `electron/self-case-record/case-store.ts` | the durable store |
| `scripts/self-case-record.cjs` | the CLI |
| `docs/self-case-record.md` | docs |
| `tests/unit/self-case-record/{boundary,case,dogfood}.test.ts` | tests |

### 2.4 Required properties, verified present

The task required that the integration preserve capability boundaries, tests, docs, diagnosis evidence,
case timeline/recurrence, drift/self-model, and boundary tests. Each is present as a real file above. Two
boundary suites exist — `self-cognition/boundary.test.ts` and `self-case-record/boundary.test.ts` — and
both pass; the observed assertions include *"declares no export that could change or authorize anything"*
and *"does not diagnose: describing what depends on a component says nothing about its health"*.

The boundary is also structural: Self Cognition **observes** the anatomy, Self Diagnosis **reads what the
application already recorded** through the `SelfObservationSource` interface and owns none of its sources,
and Self Case Record **records** but does not diagnose, repair, or define the self model. All three are
advisory/observational. **No new authority is introduced**, which matters for the pre-city posture.

---

## 3. Conflicts and resolution rationale

**Conflicts encountered: none.** Both shared files auto-merged.

### 3.1 `config/capability-modules.json` — additive against the RI merge

This is the file the task specifically warned about: it must not overwrite what the Runtime Intelligence
stage already integrated. Verified by diffing the merge result against the RI stage tip `432f859`. The diff
is **purely additive** and contains only the six self-\* entries:

```diff
@@ -220,6 +220,9 @@
       "electron/evaluation",
       "electron/evidence-engine.ts",
       "electron/repro-snapshot.ts",
+      "electron/self-case-record",
+      "electron/self-cognition",
+      "electron/self-diagnosis",
       "electron/telemetry",
@@ -235,6 +238,9 @@
       "src/shared/owner-dashboard.ts",
       "src/shared/owner-intervention.ts",
       "src/shared/owner-result.ts",
+      "src/shared/self-case-record",
+      "src/shared/self-cognition",
+      "src/shared/self-diagnosis",
       "src/shared/soak-harness.ts",
       "src/shared/soak.ts"
     ],
```

The Runtime Intelligence entries **survive**, confirmed by reading the post-merge file:

```
config/capability-modules.json:284:      "electron/runtime-intelligence",
config/capability-modules.json:295:      "src/shared/runtime-intelligence",
```

So both stages' registrations coexist. Neither side was resolved with ours/theirs.

### 3.2 `config/test-catalogue.json` — additive

Diff against the RI stage tip: **64 insertions, 0 deletions**. The RI suites registered in stage 1 are
untouched; the count moved from 265 to 274 suites, and `pnpm run test:catalogue:check` confirms the
catalogue is current at 274.

### 3.3 `scripts/extend-capability-modules.cjs` — additive with intent comments

Diff against the RI stage tip is additive only: three two-entry groups appended to the `EXTRA` table, each
with a comment stating the capability's boundary ("It observes the anatomy; it does not diagnose it and
cannot change it", "It owns none of the sources it reads and cannot execute what it proposes", "It records;
it does not diagnose, repair or define the self model"). Nothing pre-existing was rewritten.

### 3.4 Trust / qualification surfaces

```
git diff --cached --name-only HEAD | Select-String \
  -Pattern 'trust-policy|\.github/workflows|tests/acceptance|promotion|credential'
=> (no output)
```

No Root Trust Surface file, no qualification semantics, no required-check declaration, no trust-epoch
anchor. **No trust-epoch advance or blessing was required or performed for this stage.**

---

## 4. Structural finding recorded rather than silently reconciled

### 4.1 `MODULE_SPECIFIER_COLLISION` — `src/shared/self-diagnosis`

This is the one genuinely novel structural result of this stage, and it is recorded rather than papered over.

`main` already contains a **file** `src/shared/self-diagnosis.ts` (76 lines, "Self diagnosis + RFC (plan
AP26). Pure failure clustering over telemetry"), exported as `clusterFailures` / `buildRfc` and consumed by
`electron/self-engineering/diagnosis.ts:2-3` and `src/shared/correction.ts:10`.

This stage adds a **directory** `src/shared/self-diagnosis/` with a different lineage — the new engine,
hypotheses, observations, plan, policy and treatment modules.

The branch does **not** modify the file (`git diff --name-status 0a1bce7f..origin/dev/self-case-record-v1 --
src/shared/self-diagnosis.ts` is empty), so both now exist:

```
src/shared/self-diagnosis.ts                 <- pre-existing, AP26 failure clustering
src/shared/self-diagnosis/engine.ts          <- new self-diagnosis engine
src/shared/self-diagnosis/hypotheses.ts
src/shared/self-diagnosis/observations.ts
src/shared/self-diagnosis/plan.ts
src/shared/self-diagnosis/policy.ts
src/shared/self-diagnosis/treatment.ts
```

**Two different lineages now share one module specifier.** Node/TypeScript resolution prefers the file
`./self-diagnosis.ts` over the directory `./self-diagnosis/index`, so `import ... from "./self-diagnosis"`
still resolves to the old file and both existing importers keep working. The typecheck and both test tiers
confirm this empirically.

**Why it was not unified in this round.** Resolving it properly means deciding which lineage owns the name
"self diagnosis" — a capability-boundary decision. The task forbids large rewrites during integration
("不得简单选择 ours/theirs", "不能因集成冲突重写大块功能") and forbids starting the city refactor. The
honest action was to integrate the capability as authored and record the collision as pre-existing
structural debt for the city phase. It is carried in `STRUCTURAL_HEALTH_BASELINE.md` as
`MODULE_SPECIFIER_COLLISION` with a suggested future treatment.

Note the deliberate asymmetry with the RI and Self-\* capability-modules entries, which are *additive
registrations*, versus this, which is a *name collision between two bodies of code*. The first is safe to
integrate; the second is a design question. They are reported separately for that reason.

---

## 5. Tests and local verification

Run on the integration branch at `baf4108` (final RC tip at the time of this stage), on this host, with
`pnpm 11.19.0` (the version `ci.yml` pins) and Node 24.

| Gate | Command | Result |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | PASS — `added 162` |
| Typecheck | `pnpm run typecheck` | PASS (exit 0) — all three tsconfigs |
| Security scan | `pnpm run security:scan` | PASS — `TRACKED_SECRET_SCAN=PASS files=1287` |
| Architecture ratchet | `pnpm run architecture:ratchet` | PASS — `violations: []` |
| Build | `pnpm run build` | PASS (exit 0) |
| Test catalogue | `pnpm run test:catalogue:check` | PASS — `test catalogue is current: 274 suites` |
| Architecture snapshot | `pnpm run architecture:snapshot` | PASS (exit 0) |
| Unit tier | `pnpm test` | **PASS — 258 files, 3274 tests, 0 failures** (226 s) |
| Post-build tier | `pnpm run test:postbuild` | **PASS — 8 files, 119 tests, 0 failures** (59 s) |
| Slow tier | `pnpm run test:slow` | **PASS — 4 files, 35 tests, 0 failures** (196 s) |
| **Self-\* specific suite** | `vitest run tests/unit/self-cognition tests/unit/self-diagnosis tests/unit/self-case-record` | **PASS — 9 files, 108 tests, 0 failures** (7.7 s) |

The self-\* specific run is the dedicated check the task requires. 108 tests pass across all nine suites,
including both boundary suites.

Tier growth from the RI stage to this stage is fully accounted for: unit `249 → 258` files and
`3166 → 3274` tests, exactly the 9 new self-\* suites and their 108 tests; catalogue `265 → 274` suites,
exactly +9. Nothing existing was removed or skipped, and no test was weakened to make either stage pass.

---

## 6. CI result

`dev/self-case-record-v1` at `6cc84d2`: `Desktop CI` **success** (re-queried via
`gh run list --branch dev/self-case-record-v1`; two intervening commits `f443b60` and `60c7b31` are also
visible in that branch's history, the former red and superseded).

As in the Runtime Intelligence report, this is **not offered as the integration CI result**. The integration
branch's own `Desktop CI` against its final HEAD is recorded in `PRE_CITY_FREEZE_MANIFEST.json` and
`PRE_CITY_FINAL_REPORT.md` after the push.

---

## 7. Remaining limitations

1. **All three capabilities are observational/advisory.** No self-modification authority, no automatic
   repair, no ability to change the self model from the diagnosis path. Verified by the boundary suites and
   intended. It is not a limitation of the integration but of the capability as authored, and it is the
   correct pre-city posture.
2. **`MODULE_SPECIFIER_COLLISION` remains (§4.1).** Two lineages share `src/shared/self-diagnosis`. It is
   harmless to resolution today and is carried as structural debt, not fixed.
3. **Dogfood evidence is a first pass, frozen by the branch's own commit** ("with the first pass frozen and
   nothing tuned"). It is a record of one pass, not a tuned or statistically meaningful result, and must not
   be read as a performance claim.
4. **Self Cognition's self model is derived from repository facts.** It describes what the repository
   contains; it does not establish that the description is complete or that the anatomy it reads is
   exhaustive. `CAPABILITY_INVENTORY.md` and `CITY_CLASSIFICATION.md` are independent surveys, and
   divergence between them and the self model is expected, not an error.
5. **Recurrence/timeline need accumulated real history.** With little recorded history, recurrence detection
   has little to detect. Its correctness is unit-tested; its usefulness is not yet demonstrated at scale.
6. **No real-host qualification, machine credential or external provider acceptance was performed or
   claimed** (§9). Unchanged from stage 1.

---

## 8. Stage verdict

**PASS.** Self Cognition, Self Diagnosis and Self Case Record are integrated into
`integration/pre-city-baseline` at `baf4108` as a single stacked tip, with zero conflicts, zero Root Trust
Surface changes, the Runtime Intelligence registrations preserved, and every locally executable gate green —
including the 108-test self-\* suite. The one structural collision found is recorded as debt rather than
hidden, and no code was rewritten to make the integration look cleaner than it is.
