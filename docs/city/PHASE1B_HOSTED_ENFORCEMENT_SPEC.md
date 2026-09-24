# PHASE 1B — HOSTED ENFORCEMENT ACTIVATION SPECIFICATION

**Status:** SPECIFICATION ONLY. This document is the entire content of the first commit on its branch. It
contains no implementation, no workflow change, no script change, no test change, no `CODEOWNERS` change, no
ruleset change and no Root Trust mutation, and it activates nothing.

| Field | Value |
|---|---|
| Document | `docs/city/PHASE1B_HOSTED_ENFORCEMENT_SPEC.md` |
| Phase | **1B — hosted governance activation** |
| Branch | `dev/city-phase1b-hosted-enforcement` |
| Branch point | `5c1cc264448d979969595139ee8b27d7195216d1` (= tag `city-phase1a-enforcement-v1`, object `884227cb3e77f209b58ea071a64dfbaeacba9fda`) |
| First commit on this branch | this document, and nothing else |
| Implementation in this phase | **NOT STARTED** |
| Predecessor specification | `docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_SPEC.md` @ `335bf5b3a094557627eaf5d5657ae6c931f6b351` |
| Predecessor acceptance record | `docs/city/PHASE1A_MEASUREMENT_TO_ENFORCEMENT_ACCEPTANCE.md` |
| Evidence ledger | `docs/research/PAPER_EVIDENCE_LEDGER.md` (append-only; authoritative) |
| Authority to activate anything below | **Root Owner only** — see §12 |

---

## 0. The question Phase 1B answers

Phase 1B does **not** ask *"how do we repair the city?"*. It asks:

> Given a prospective enforcement engine that has completed local qualification, and a grandfathered-debt
> baseline that is frozen by identity, **how is that engine safely promoted into a hosted governance gate —
> without laundering the debt it exists to freeze, and without letting the machine identity authorise its own
> enforcement?**

The phase boundary is explicit, and it is the reason this document exists rather than a workflow patch:

| Phase | Object | Outcome | State at this freeze |
|---|---|---|---|
| **1A** | the *engine* | sensor qualified locally; candidate promoted by the Root Owner | **PROMOTED_AND_FROZEN** |
| **1B** | the *hosted gate* | the qualified policy becomes a required, fail-closed hosted check under Owner authority | **this specification** |
| **2** | the *architecture* | debt reduction, migration, structural repair | **NOT_STARTED** |

A promotion is not an activation. The Phase 1A record says so in its own words —
`PROMOTION != HOSTED_GATE_ACTIVATION` — and §1 shows the two are separated by machinery, not by intention.

```text
PHASE1A = PROMOTED_AND_FROZEN
PROSPECTIVE_ENFORCEMENT = PROMOTED
HOSTED_REQUIRED_GATE = LEGACY
PHASE1B = SPECIFICATION_ISSUED
ARCHITECTURE_MIGRATION = NOT_STARTED
```

---

## 1. The state Phase 1B starts from — every value measured at the freeze

Nothing in this section is inherited from a previous report on trust. Each row states where it was measured.

| Object | Measured value | Source of the measurement |
|---|---|---|
| `main` / branch point | `5c1cc264448d979969595139ee8b27d7195216d1` | `git ls-remote origin refs/heads/main` |
| Phase 1A immutable tag | `city-phase1a-enforcement-v1` → annotated object `884227cb3e77f209b58ea071a64dfbaeacba9fda` → commit `5c1cc26…` | `git ls-remote --tags` (peeled `^{}` ref) |
| Merge tree of the promotion | `3ca3372d3ccf2be9adc3b0a9bf0cbcc736717953` = the certified candidate tree, byte-identical | `git rev-parse <sha>^{tree}`, GitHub commits API |
| Grandfathered-debt baseline | `config/architecture-enforcement-baseline.json`, schema `city-architecture-enforcement-baseline/1`, **version 1**, hash `b211c0520f8ab72872ab0f756e92cef0cd7faad532213f52b9ebb1a9e6969f4e` | `node scripts/architecture-enforcement-baseline.cjs --check` |
| Baseline content | **612** tracked source file identities, **1671** resolved internal edge identities, `retired_edges: []`, unresolved `NON_SOURCE_ASSET 1` | the same `--check` run and the committed file |
| Baseline `not_yet_enforced` classes | `dependency_cycles`, `cross_domain_private_state_access`, `bundle_structure_or_district_shape`, `layer_or_depth_violations`, `runtime_dependency_not_visible_in_source` | the committed baseline |
| Sensor | `scripts/architecture-observatory.cjs`, sha256 `c6e879761c90a948ba158ee88c7788107445a26d6985a860702836c5a6ff687f`, spec `docs/city/PHASE0_ARCHITECTURE_OBSERVATORY_SPEC.md` @ `76b2f495…`, scan-set hash `4d489193…` | the committed baseline's `sensor` block |
| Sensor qualification | Q-01…Q-07 PASS, Q-08 MEASURED, **unexplained disagreements 0**, `CROSSCHECK_ONLY 0` | Phase 1A acceptance record; re-run at the freeze (`architecture:observe` PASS) |
| Prospective policy engine | `scripts/architecture-enforcement.cjs`, `--mode shadow\|enforce`, schema `city-phase1a-architecture-enforcement/1` | freezing round: shadow PASS and enforce PASS, findings `1677 = 1671 + 5 + 1`, violations 0 |
| Legacy control sensor | `scripts/architecture.cjs ratchet` — PASS, `violations: []` against `config/architecture-baseline.json` | run at the freeze |
| Hosted required checks | `quality`, `unit`, `acceptance`, `package` — all four, app `github-actions` (id `15368`) | ruleset `22746755`, and the check-runs on `5c1cc26…` |
| Hosted enforcement of the *new* engine | **none** — `architecture:enforce`, `architecture:enforce:shadow`, `architecture:observe` and `architecture:qualify` appear in **no** workflow file | grep over `.github/workflows/**` |
| Where the legacy gate is enforced | inside the **`quality`** job, as the step `pnpm run architecture:ratchet`; there is no separate `architecture` check | `.github/workflows/ci.yml` |
| Root Trust | epoch **24** (`boss-root-trust-24`) `MATCHES` the live surface; 63 files; aggregate `6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457` | `node scripts/acceptance-evolution-bless.cjs --check` |
| Self-hosted runners on this repository | **0** | `gh api repos/…/actions/runners` |

Two measured properties of this starting state drive most of the design below, and both are recorded rather
than assumed:

1. **The gate's own machinery is currently autonomously mutable.** Classified with the repository's own
   classifier (`classifyAuthorityPath`, built from `dist-electron` at the freezing commit):

   | Path | `classifySurface` | authority plane |
   |---|---|---|
   | `.github/workflows/ci.yml` | `ROOT_TRUST_SURFACE` | `OWNER_AUTHORITY` |
   | `trust-policy/trust-epoch.json` | `ROOT_TRUST_SURFACE` | `OWNER_AUTHORITY` |
   | `config/architecture-enforcement-baseline.json` | `PRODUCT_SURFACE` | **`AUTONOMOUS_MUTABLE`** |
   | `scripts/architecture-enforcement.cjs` | `PRODUCT_SURFACE` | **`AUTONOMOUS_MUTABLE`** |
   | `scripts/architecture-enforcement-baseline.cjs` | `PRODUCT_SURFACE` | **`AUTONOMOUS_MUTABLE`** |
   | `scripts/architecture-observatory.cjs` | `PRODUCT_SURFACE` | **`AUTONOMOUS_MUTABLE`** |
   | `scripts/architecture.cjs` | `PRODUCT_SURFACE` | **`AUTONOMOUS_MUTABLE`** |

   A required gate assembled from autonomously mutable parts is enforceable but **not Owner-bound**: the
   machine could edit the engine, or regenerate the baseline, and CI would go green. §10 is about closing
   exactly this.

2. **A check conclusion is a property of a run, not of a SHA.** Measured on the frozen commit itself:

   | Run | Event | `unit` conclusion |
   |---|---|---|
   | `35717399512` (push → `main`, the promotion's post-merge run) | post-merge certification | **success** |
   | `35731576930` (push of tag `city-phase1a-enforcement-v1`, same commit, no content change) | administrative | **failure** (`tests/unit/platform/platform-soak.test.ts:201`, `recoveredCircuits` 0, slow tier) |
   | local real host, same frozen tree | independent re-execution | slow tier **35/35 pass**, including that exact test |

   The failing run is classified in the ledger as a hosted-runner timing flake (`FAILURE` + `HOSTED_PARITY`),
   not as a defect of the frozen content — but the governance consequence is permanent and is designed for in
   §9: *"the latest check named X on SHA Y"* is **not** a certifying identity, and an enforcement gate that is
   required must be able to say which **run** certified it.

---

## 2. Responsibilities of the hosted gate (§2.1)

Four commands exist. They have four different jobs, and Phase 1B must not blur them into "a new architecture
test".

| Role | Command | Canonical artifact | Exit semantics | Hosted status today | Intended Phase 1B status |
|---|---|---|---|---|---|
| **legacy control** | `architecture:ratchet` | `config/architecture-baseline.json` (metrics, `version`, `reason`, `updatedAt`) | exit 1 on absolute violations *or* on any metric *above* the recorded value | **required**, as a step inside the `quality` check | remains required, in parallel, until the retirement criteria in §3 H5 are met |
| **truth sensor** | `architecture:observe` | `artifacts/city/phase0/architecture-observatory.json` (612 files, 1671 edges, semantic hash) | exit non-zero only on its own self-test failure; it is a *measurement*, not a policy | not hosted | **not** a required gate. It stays a measurement/prerequisite; making a measurement blocking invites the sensor to be adjusted until green |
| **shadow policy** | `architecture:enforce:shadow` | `artifacts/city/phase1/architecture-enforcement-shadow.json` | policy violation → reported, **exit 0**; engine error → **exit non-zero** | not hosted | Stage 1 hosted, **not required** (§8) |
| **enforce policy** | `architecture:enforce` | `artifacts/city/phase1/architecture-enforcement-live.json` | policy violation → reported, **exit non-zero**; engine error → **exit non-zero** | not hosted | Stage 2 visible, Stage 3 **required** (§8) |
| *(prerequisite)* | `architecture:qualify` | `artifacts/city/phase1/sensor-qualification.json` | `ALLOWED_TO_PROCEED: true/false` | not hosted | not hosted: qualification needs a corpus and cost budget a clean runner does not have; the *result* is pinned by hash instead (§4 PRE-04) |

Decisions, stated so that no later reader has to infer them:

- **H1 — the enforcer enters hosted CI as its own job, not as a step inside an existing required check.**
  A new job `architecture` with check name `architecture`. Rationale: a step inside `quality` would make
  enforcement *silently required* the moment it is added, would change the meaning of a check named `quality`
  that the ruleset already requires, and would make "enforcement failed" indistinguishable from "typecheck
  failed" in the required-check UI. A separate job gives the activation act its own name and its own history,
  and makes the Stage 2 → Stage 3 transition a governance act about a *check*, not an edit that quietly
  redefines an existing one.
- **H2 — shadow and enforce are different promises and must never be aliased.** Shadow means *"report the
  policy violation, do not block the change"*. It does **not** mean *"a broken sensor may pass"*: an engine
  error fails in both modes (§5), because a gate that cannot measure must not report success.
- **H3 — the legacy ratchet runs in parallel.** `architecture:ratchet` is not replaced, not weakened and not
  removed by Phase 1B activation. Two gates over one tree is deliberate redundancy while the new one is
  earning trust; the *cost* of the redundancy is the reason H5 exists.
- **H4 — the required gate is the enforce step of the `architecture` job.** Not shadow, not observe, not
  qualify. Shadow is evidence; enforce is policy.
- **H5 — the legacy gate may be retired only against evidence, and never in the same act as activation.**
  Retirement is permitted only when all of:
  1. `architecture` has been **required** and green on `main` for a continuous window of at least **30
     consecutive promotion merges**, with zero post-hoc reversals;
  2. the new gate's findings are a **superset** of the legacy gate's detection classes on the same tree — for
     every class the legacy gate can fail on, a named test or experiment shows the new gate failing on the
     same injection (the C9 battery is the template);
  3. the legacy baselines (`config/architecture-baseline.json`) show no metric drift unexplained by the
     changes that landed in the window;
  4. the retirement is proposed with its own evidence record and performed by the Owner as a **separate**
     change from any activation.
- **H6 — nothing else enters the hosted required set.** No automatic baseline regeneration (see §7), no
  observation-as-gate, no policy derived from a source that a clean runner cannot reproduce.

---

## 3. Hosted CI migration stages (§2.6)

The stages below are expressed against the **real** workflow (`on: push`, `on: pull_request`; jobs `quality`,
`unit`, `acceptance`, `package`, chained `unit←quality`, `acceptance←unit`, `package←unit`). They are not a
mechanical template: each stage states what changes in the file, and what must be true before and after.

| Stage | `ci.yml` change | Required? | Entry condition | Exit condition |
|---|---|---|---|---|
| **S1 — hosted shadow** | add job `architecture` running `pnpm run architecture:enforce:shadow`; **no** `needs:` on it, no ruleset change | **no** | PRE-01…PRE-04, PRE-08 satisfied; the baseline `--check` passes in the same job | ≥ 20 consecutive PR/push runs on `architecture` in which (a) shadow and local agree on `new_regressions`, (b) shadow reports `engine_errors 0`, (c) findings counts differ from the recorded baseline expectation only where a change explains them |
| **S2 — hosted enforce, visible** | same job additionally runs `pnpm run architecture:enforce`; the job now can fail; still not in the ruleset's required list | **no** | S1 exit conditions; the ENF-12 identity (shadow findings == enforce findings on the same inputs) verified **on the hosted runner**, not only locally | ≥ 10 consecutive runs in which enforce and shadow produce identical finding sets and enforce's exit code is explained by a declaration in the change, plus one deliberate negative control: a known-undeclared-edge PR fails enforce and passes shadow |
| **S3 — enforce becomes required** | **ruleset edit only** — add context `architecture` (app `github-actions`, id `15368`) to `required_status_checks`, keeping `strict_required_status_checks_policy: true` | **yes** | S2 exit conditions; §4 fully satisfied; §10 Owner-authority move completed; §11 rollback rehearsed and recorded | the gate is required on `main`; every subsequent merge carries a green `architecture` check run on the exact head SHA |
| **S4 — legacy retirement decision** | remove `pnpm run architecture:ratchet` from the `quality` job *(or keep it and record the decision not to)* | — | H5's four conditions, measured, in a separate proposal | a recorded Owner decision; the legacy baseline file is either frozen with a final `reason` or explicitly retained |

Ordering constraint that is easy to get wrong, and is therefore stated here: **S3 is a ruleset change and
nothing else.** The check must already exist, already report, and already be understood; activating it must
not be combined with adding it. A ruleset edit that introduces a context no workflow emits is the documented
failure mode in §9 — a permanently pending required check.

---

## 4. Activation preconditions (§2.2)

Every precondition is either **machine-verifiable** (a command whose output decides it) or an explicit
**Owner ceremony** (an act only the Owner may perform). Nothing here may be satisfied by assertion.

| ID | Precondition | Kind | How it is decided |
|---|---|---|---|
| PRE-01 | The immutable Phase 1A tag exists and resolves to the promoted commit | machine | `git ls-remote --tags` → `refs/tags/city-phase1a-enforcement-v1` and its peeled `^{}` both present, peeled target = the promotion merge commit |
| PRE-02 | Baseline identity is complete: every tracked source file and every resolved internal edge is bound by identity, and `counts` is marked as summaries only | machine | `architecture:enforce:baseline -- --check` → `identical: true`, `hash_matches: true` |
| PRE-03 | The baseline's series identity is authorised | machine + ceremony | `baseline_version` / `parent_baseline_hash` present, non-null where required, and the chain head named by an Owner-authorised record (§7.2) |
| PRE-04 | Sensor qualification is complete and pinned | machine | pinned hashes (sensor sha256, spec commit, scan-set hash) equal the values in the committed baseline; the qualification artifact's `ALLOWED_TO_PROCEED` is `true` at the recorded hash |
| PRE-05 | No unexplained sensor disagreement | machine | the qualification artifact's `CROSSCHECK_ONLY = 0` and `unexplained_disagreements = 0`; any non-zero value must be enumerated with a written explanation or the precondition fails |
| PRE-06 | Local/hosted parity has been demonstrated | machine | for the same commit: the hosted `architecture` job's finding set equals the local finding set, element for element, compared by identity (not by count) |
| PRE-07 | Rollback path exists and has been rehearsed | ceremony + machine | §11's `normal rollback` executed once on a scratch branch and recorded; the record names the commit, the check conclusion before and after, and the elapsed time |
| PRE-08 | `.github/workflows/ci.yml` is unchanged by the freezing round and still contains no enforcement step | machine | blob identity of `ci.yml` at the freeze equals the blob at the Phase 0 promotion; grep shows no `architecture:enforce` in any workflow |
| PRE-09 | Required-check name is stable and pinned | machine | a test asserts the job name is exactly `architecture`; a rename fails the test rather than silently orphaning a required context (§9) |
| PRE-10 | Failure semantics are fixed before activation, not after | machine | §5's table is implemented as machine codes; every listed condition has a test that observes a non-zero exit |
| PRE-11 | Root Trust preparation is complete | ceremony | §10's surface extension merged, and the trust epoch advanced through the Owner-authorised finalization workflow, so the epoch anchors the new surface |
| PRE-12 | The Owner authorises activation | **ceremony** | an explicit Owner approval on the activation proposal, followed by the ruleset edit performed by the Owner. The machine may prepare, measure and propose; it may not perform this |
| PRE-13 | The legacy gate is green on the activation commit | machine | `architecture:ratchet` exit 0 with `violations: []` |
| PRE-14 | No self-hosted runner is introduced | machine | `gh api repos/…/actions/runners` → `total_count: 0` still holds for this repository |

---

## 5. Fail-closed semantics (§2.3)

The hosted gate must **FAIL** — non-zero, blocking — on every row below. The middle column is the machine
code; the right column is what already exists versus what Phase 1B must add.

| Condition | Code | State |
|---|---|---|
| sensor incomplete / instrumented read count ≠ scanned file count | `SENSOR_INCOMPLETE` | implemented (E-09) |
| a file could not be read | `SENSOR_INCOMPLETE` | implemented |
| a parse issue occurred | `SENSOR_INCOMPLETE` | implemented |
| a source was silently skipped | `SENSOR_INCOMPLETE` | implemented |
| unresolved reference with an unsupported resolution | `UNRESOLVED_UNSUPPORTED_SOURCE_RESOLUTION` | implemented |
| unresolved reference whose target is missing | `UNRESOLVED_SOURCE_TARGET_MISSING` | implemented |
| unresolved reference of an unknown class | `UNRESOLVED_OTHER_UNKNOWN` | implemented |
| baseline file unreadable / malformed | engine error, non-zero in **both** modes | implemented; Phase 1B must add the hosted `--check` invocation |
| baseline self-consistency fails (`--check` `identical: false` or `hash_matches: false`) | non-zero | **must be added to the hosted gate** — today nothing runs `--check` |
| baseline series identity not authorised (§7.2) | `BASELINE_SERIES_UNAUTHORISED` | **to be implemented in Phase 1B** |
| ownership conflict | `OWNERSHIP_CONFLICT` | implemented |
| new undeclared source | `NEW_UNDECLARED_SOURCE` | implemented |
| new edge with an undeclared endpoint | `NEW_EDGE_UNDECLARED_ENDPOINT` | implemented |
| new declared edge (declaration changed to permit a relation) | `NEW_EDGE_DECLARED_ENDPOINT` | implemented |
| unauthorised cross-capability edge | `NEW_UNDECLARED_CROSS_CAPABILITY_EDGE` | implemented |
| reintroduced retired debt | `REINTRODUCED_DEBT` | implemented |
| engine error of any kind | `ENGINE_ERROR` | implemented — **never** converted into a skip |
| evidence disagreement beyond the accepted condition (hosted ≠ local, shadow ≠ enforce on the same inputs) | parity failure | **to be implemented in Phase 1B** (§8 S2) |

Three rules that are part of the semantics rather than an implementation detail:

1. **An engine failure is never a skip.** The shadow mode's exit-0 contract applies to *policy violations*
   only. Any inability to measure exits non-zero in both modes. A gate that turns "I could not look" into
   "nothing to report" is the failure mode this whole phase exists to prevent.
2. **`NOT_YET_ENFORCED` is not silent.** The five defect classes Phase 1A does not model must appear in the
   gate's output with their count, and the count must be published as part of the check's evidence. The set
   may only **shrink**, and any shrink is a recorded governance event with its own evidence. If the gate
   cannot produce the list, it fails — an empty list and an unread list must be distinguishable.
3. **A missing required check is a failure, not a pass.** No workflow-level `continue-on-error`, no
   `if: always()` substitution, and no path by which the enforcement step can be skipped while the job still
   reports success.

---

## 6. Grandfathering must not become debt-washing (§2.4)

Phase 1B inherits the Phase 1A rule verbatim:

```text
GRANDFATHERED != HEALTHY
MEANS          THESE RELATIONS EXISTED BEFORE ENFORCEMENT
DOES NOT MEAN  THESE RELATIONS ARE HEALTHY
```

Rules that follow, all of which are policy for the hosted gate and not merely documentation:

- A grandfathered edge **may continue to exist**. Enforcement is prospective; the inherited tree is not
  required to become healthy for the gate to be honest.
- **Debt removal is always allowed**, and is reported as `DEBT_REDUCED`, never as a violation.
- **A removed edge may never reappear.** `retired_edges` is a series, not a counter; a re-added relation is
  `REINTRODUCED_DEBT` and fails.
- **Count compensation must fail.** Removing one grandfathered edge while adding one undeclared-endpoint edge
  leaves the totals unchanged and must still fail; this is exactly the C9 `EXP-09` injection, and it is the
  reason identity, not counts, is the ratchet.
- **A baseline update is a governance event, not a developer convenience** (§7). No ordinary PR may enlarge
  the grandfathered set.

### 6.1 The laundering path that exists today, measured

This is the concrete defect Phase 1B must close, stated with its evidence rather than as a principle:

```text
CI fails on new debt
  → run `pnpm run architecture:enforce:baseline`         (plain invocation; no authorisation required)
  → the generator measures the CURRENT tree, records everything it finds as grandfathered,
    bumps baseline_version, and adopts the previous baseline_hash as parent_baseline_hash
  → commit the regenerated baseline
  → CI passes
```

Measured properties of that path at the freeze:

1. The plain invocation of `scripts/architecture-enforcement-baseline.cjs` **regenerates** the tracked
   baseline. There is no confirmation, no owner check, and the `--reason` argument has a default value, so it
   can be run with no arguments at all.
2. Nothing in `.github/workflows/ci.yml` and no test tier runs `--check`; the only `--check` invocations in
   the repository are in the Phase 1A acceptance record's reproduction block.
3. `--check` verifies **self-consistency** (`identical` and `hash_matches` between the file and a
   recomputation from the same tree). A regenerated baseline is self-consistent by construction, so
   `--check` alone cannot detect laundering.
4. Both the baseline file and its generator are classified **`AUTONOMOUS_MUTABLE`** by the repository's own
   authority classifier (§1), and neither appears in `CODEOWNERS`.

Therefore, at this freeze, the laundering path is **available to an autonomous actor and is invisible to
every existing gate**. Closing it is a precondition for activation (PRE-03), not a follow-up.

---

## 7. Baseline evolution governance (§2.5)

### 7.1 What a baseline update must carry

Every accepted evolution of `config/architecture-enforcement-baseline.json` records, in the file itself and
in a governance record beside it:

```text
baseline_version          monotonically increasing, never reused
parent_baseline_hash      the hash of the immediately preceding ACCEPTED baseline (never null after v1)
retired_edges             append-only series of relation identities removed by decision
added identity accounting  the identities added as grandfathered, enumerated, not counted
deleted identity accounting the identities no longer present, enumerated
reason                    free text, but non-empty and specific
authorisation             the reference to the Owner authorisation for THIS version
evidence                  the artifact hash of the measurement that produced it
```

### 7.2 The closure design

1. **`--check` becomes part of the hosted gate** (Stage 1 onward): a baseline that is not self-consistent
   fails.
2. **Series authorisation.** A new record — proposed path
   `config/architecture-enforcement-authorisations.json` or an entry under `trust-policy/` — names, for each
   accepted `baseline_version`, its `baseline_hash`, its parent, the authorising reference and the evidence
   hash. The gate reads the committed baseline's `(baseline_version, parent_baseline_hash, baseline_hash)`
   and fails with `BASELINE_SERIES_UNAUTHORISED` if the triple is not in that record. Self-consistency alone
   is then no longer sufficient to widen the frozen set.
3. **Owner review on the artefact.** The baseline file, the generator and the engine join the Owner-review
   boundary (§10), so a PR that changes them cannot merge without an Owner review under the existing ruleset
   (`require_code_owner_review: true`, `required_approving_review_count: 0`). This is the mechanism that
   turns "CI fails → regenerate → CI passes" into "CI fails → the change is proposed → the Owner decides".
4. **`--record-only` stays what it is.** Refreshing the untracked runtime record is not a governance act and
   remains available unattended; regenerating the tracked baseline is not, and must not be reachable by the
   same invocation as an ordinary build step.
5. **The default reason is removed from the untracked path.** A default that makes an unattended
   regeneration succeed silently is itself part of the laundering surface; an empty reason must fail.

---

## 8. Required-check identity (§2.7)

### 8.1 What actually enforces `main` today — measured, not assumed

| Fact | Measured value |
|---|---|
| Legacy branch-protection REST API | `404 Branch not protected` — protection is **not** implemented with classic branch protection |
| Ruleset | id `22746755`, name `Main-Protection`, target `branch`, enforcement `active`, condition `ref_name.include: ["refs/heads/main"]` |
| Rules in that ruleset | `deletion`, `non_fast_forward`, `creation`, `required_status_checks`, `pull_request` |
| Required contexts | `quality`, `unit`, `acceptance`, `package` — each with `integration_id: 15368` (`github-actions`) |
| Strict policy | `strict_required_status_checks_policy: true` (the branch must be up to date before merge) |
| Review rules | `require_code_owner_review: true`, `required_approving_review_count: 0`, `require_last_push_approval: false`, `required_review_thread_resolution: false`, `require_extra_approval_for_unattributed_changes: true` |
| Allowed merge methods | `merge`, `squash`, `rebase` |
| Bypass actors | one: `User` `229580437` (`zhiheng-zhang-Mera`), `bypass_mode: always`. `CODEOWNERS` states the intended policy in words: *"Boss has NO bypass"* |
| Merge queue | **no** `merge_queue` rule exists, `allow_auto_merge: false` — there is no merge queue and Phase 1B must not pretend there is |
| Check-run emitter | every check run on the promotion SHA was `app: github-actions`, `app_id: 15368` |

### 8.2 The identity a certifying gate must be able to state

Because the check name, the SHA and the run are three different things, the required gate is only meaningful
as a four-part statement:

```text
THE EXPECTED CHECK  — exact context string, pinned to app id 15368
ON THE EXPECTED SHA — the head SHA the required checks are evaluated against
IN THE EXPECTED RUN — the run id, because conclusions are per-run (measured: §1)
COMPLETED WITH SUCCESS
```

The middle two are why §1's second observation matters. A tag push re-ran the four checks against the frozen
commit and produced, on the *same* `unit` context and the *same* SHA, a **failure** where the certifying run
had reported **success** — with no content change whatsoever. Any governance record that says "`unit`
succeeded on `5c1cc26…`" without naming the run is under-specified, and Phase 1B's evidence records must name
the run.

### 8.3 Check-name stability, and the two ways a required check dies

- **Rename.** The ruleset requires a context *by name*. If the job named `architecture` is renamed, the
  required context is never reported again: the check stays `Expected — waiting for status to be reported`
  and the merge stays blocked. The Owner can bypass; the machine cannot. A rename is therefore a **self-
  inflicted deadlock of the autonomous path**, recoverable only by an Owner ruleset edit. Phase 1B must pin
  the name with a test (PRE-09) rather than rely on memory.
- **Disappearance.** If the job stops running on the relevant event — for example because a `paths:` filter
  is added, or because the job is moved behind a condition — the same pending state results, but *silently*
  and only for changes that match the filter. Any `paths:`/`branches:` narrowing on the enforcement job is
  forbidden; the check must be emitted on every push and every pull request, exactly as `quality` is.
- **Event consistency.** The job must run on both `push` and `pull_request` (as the workflow already does),
  so that the same check exists on the branch head SHA *and* on the post-merge `main` SHA. A gate that only
  runs on PRs leaves `main` uncertified after the merge; one that only runs on pushes leaves PRs unblocked.

---

## 9. Root Trust (§2.8)

Phase 1B touches the governance surface, so the surface must be named before it is touched.

| Surface | Classified today | Phase 1B intent |
|---|---|---|
| `.github/workflows/ci.yml` | `ROOT_TRUST_SURFACE` / `OWNER_AUTHORITY` | already Root Trust. **Any** edit therefore moves the surface aggregate and requires an epoch advance in the same commit; the stages in §8 are edits to this file and must be sequenced accordingly |
| `.github/CODEOWNERS` | `VERIFICATION_SURFACE` / `OWNER_AUTHORITY` (self-protected by its first rule) | extend: the enforcement engine, the baseline generator and the baseline artefact |
| `package.json` | `PRODUCT_SURFACE` / `OWNER_AUTHORITY` | already Owner-review-required; the new `architecture` job's script entry points live here, so they are covered |
| `config/architecture-enforcement-baseline.json` | `PRODUCT_SURFACE` / **`AUTONOMOUS_MUTABLE`** | **must move into the Owner-review boundary and the Root Trust Surface** — this is the laundering closure of §7 |
| `scripts/architecture-enforcement.cjs`, `scripts/architecture-enforcement-baseline.cjs` | `PRODUCT_SURFACE` / **`AUTONOMOUS_MUTABLE`** | as above: the judge must be Owner-bound |
| `scripts/architecture-observatory.cjs`, `scripts/architecture.cjs` | `PRODUCT_SURFACE` / **`AUTONOMOUS_MUTABLE`** | the sensors the gate trusts; same treatment |
| `trust-policy/**` | `ROOT_TRUST_SURFACE` | already Root Trust; the series-authorisation record belongs here if it is placed under this prefix |
| `vitest.tiers.mjs`, `vitest.*.config.mjs` | `PRODUCT_SURFACE` / `OWNER_AUTHORITY` | already CODEOWNERS-protected; they decide *which* gates run, so they stay protected |
| `docs/**` | `AUTONOMOUS_MUTABLE` | deliberately autonomous. Specifications and the ledger stay writable by the machine |

Epoch mechanics, as they actually exist:

- The epoch record is `trust-policy/trust-epoch.json`; at the freeze it anchors epoch **24** with
  `root_surface_hash 6eaf71e9e2c81122522be86743bc619fcbc823b3c1cff07b229f94edda40d457`.
- `node scripts/acceptance-evolution-bless.cjs --advance` establishes the next epoch and refuses to rewrite
  history: it appends with `parent_epoch_hash` pointing at the previous record. `--check` decides whether the
  committed epoch still anchors the live surface.
- The only place an epoch is advanced under external authority is
  `.github/workflows/trust-epoch-finalization.yml`: `workflow_dispatch` only (no `push`, no `pull_request`,
  no schedule), `refs/heads/main` only, targeting the **`boss-root-trust-owner`** environment whose required
  reviewer is `zhiheng-zhang-Mera` (measured via the environments API; `prevent_self_review: false`,
  `deployment_branch_policy: null`). It contains no bypass credential, creates the epoch commit on a branch
  and opens a PR so that the final act is the Owner's merge.

Two consequences Phase 1B must design around rather than discover:

1. **A surface-changing commit without its epoch advance fails CI.** `acceptance:autonomous-evolution` runs
   in the required `acceptance` job and refuses an unanchored epoch
   (`SELF_CERTIFICATION_FORBIDDEN:TRUST_EPOCH_MIGRATION`). So the `ci.yml` edit, the `CODEOWNERS` edit and the
   epoch advance are not independent steps in time: they must land in the same commit, or on a branch whose
   activation is sequenced so that the epoch and the surface agree at every commit CI evaluates.
2. **The surface list is itself surface.** Extending the Root Trust Surface to include the enforcement engine
   and its baseline is a change to the trust boundary, so it cannot be done by the machine as an ordinary
   change; it is an Owner ceremony. The order therefore matters: **extend the surface → advance the epoch →
   then activate the check.** Activating first would create a required gate whose own definition is still
   autonomously mutable.

Authority to change trust: the **Root Owner**, through the finalization workflow's environment approval plus
the merge of the resulting PR. The machine may *propose* (Stage A measures and writes a proposal artifact)
and may not approve, may not dispatch-and-approve its own environment deployment, and may not write the epoch
record directly.

---

## 10. Emergency rollback (§2.9)

"Failed" must have a designed response that is not "delete the gate".

```text
normal rollback      a change that the gate correctly fails is repaired, or reverted. The gate stays.
emergency disable    the gate itself is defective or is blocking honest work. The gate stops being
                     REQUIRED — it is not deleted, its history is not rewritten.
re-enable            the disable is lifted only through the recorded re-enable conditions below.
```

| Step | Action | Who |
|---|---|---|
| R1 | Preserve evidence: the failing run id, the check conclusion, the artifact the engine wrote, and the exact command line | machine, automatically |
| R2 | Classify the defect: *the gate is right, the work is wrong* vs *the gate is wrong* | machine proposes, Owner decides |
| R3 | **Normal rollback** — repair or revert the change; the gate remains required | machine |
| R4 | **Emergency disable** — remove `architecture` from the ruleset's required contexts, leaving the job running and reporting; record the reason, the run id and the failing evidence | **Owner only** (ruleset edit) |
| R5 | Freeze the baseline: while disabled, **no** baseline regeneration is permitted, and `--record-only` may only refresh the runtime record for the already-committed baseline | machine, verified by the series authorisation of §7 |
| R6 | Re-enable only when: the defect has a named cause and a regression test that fails before the fix and passes after; the baseline hash is unchanged from the disable; a full parity run (hosted and local) agrees; and the Owner authorises. Record the re-enable as its own governance event | Owner + machine evidence |

Forbidden under all rollback paths, and worth stating because each is the tempting move:

- rewriting the failure out of the record, including re-running the failed hosted job and reporting only the
  second attempt (a retry is allowed; hiding the first result is not — the Phase 1A C11 addendum is the
  pattern to follow, and this specification's §1 follows it for the tag-push run);
- widening the baseline to make the failure disappear (`baseline laundering`);
- moving or deleting `city-phase1a-enforcement-v1`, `city-phase0-observatory-v1`, or force-pushing `main`;
- disabling the gate by editing the workflow so that it no longer reports, rather than by removing it from
  the required list.

---

## 11. Owner boundary (§2.10)

| The machine identity **may** | The machine identity **may not** |
|---|---|
| measure the tree, the surface and the gate | self-approve any change to the governance surface |
| implement the engine, the gate and its tests | self-authorise policy activation (the ruleset edit is Owner-only) |
| run and re-run verification, including hosted runs | bypass a required check, or use a bypass credential |
| open pull requests and produce evidence | move or delete a protected/frozen tag |
| propose a promotion, with its evidence and its preconditions | regenerate an accepted baseline outside the governance act of §7 |
| write specifications, ledgers and reports | perform the Root Owner ceremony (approve, merge, environment approval) |
| dispatch a workflow whose design forbids self-authorisation | approve an environment deployment for its own proposal |

The Phase 1A record already contains the measured form of this boundary — the machine opened PR #12 and
could not approve or merge it — and the trust-epoch machinery contains its mechanical form. Phase 1B
**preserves** the boundary; it does not relax it, and it must not be read as permission for the machine to
activate its own enforcement.

---

## 12. Acceptance criteria for Phase 1B

Each criterion is machine-checkable or explicitly an Owner ceremony. `PB-AC-nn` identifiers are stable.

| ID | Criterion |
|---|---|
| PB-AC-01 | The `architecture` check exists, is emitted on both `push` and `pull_request`, and its job name is pinned by a test |
| PB-AC-02 | In shadow (Stage 1) the job never fails on a policy violation, and always fails on an engine error |
| PB-AC-03 | In enforce (Stage 2) the job fails on every condition in §5, each with a test that observes the non-zero exit |
| PB-AC-04 | Hosted and local enforcement produce identical finding sets, compared by relation identity, on the same commit |
| PB-AC-05 | Shadow and enforce produce identical finding sets on identical inputs, on the hosted runner (the existing ENF-12 identity, re-proved hosted) |
| PB-AC-06 | `architecture:enforce:baseline -- --check` runs inside the gate and fails on `identical: false` or `hash_matches: false` |
| PB-AC-07 | A baseline whose `(baseline_version, parent_baseline_hash)` is not in the authorisation record fails with its own machine code |
| PB-AC-08 | A PR that regenerates the baseline without an authorisation reference **cannot** reach a green required check |
| PB-AC-09 | `CODEOWNERS` requires Owner review for the baseline artefact, the baseline generator and the engine; a test asserts each path is protected |
| PB-AC-10 | The Root Trust Surface includes those paths; the epoch anchors the extended surface (`--check` passes) |
| PB-AC-11 | The five `NOT_YET_ENFORCED` classes are published by the gate, and the published set may only shrink across accepted baselines |
| PB-AC-12 | A retired edge cannot reappear: the C9-style injection fails with `REINTRODUCED_DEBT` in the hosted gate |
| PB-AC-13 | Count compensation fails: the `EXP-09` injection fails in the hosted gate |
| PB-AC-14 | `architecture:ratchet` remains a required step throughout Stages 1–3, and any retirement is a separate Owner decision with the H5 evidence |
| PB-AC-15 | Removing `architecture` from the required contexts (R4) leaves the job running and reporting; the check does not vanish |
| PB-AC-16 | A record that certifies the gate names `(check name, SHA, run id, conclusion)`, never merely `(check name, SHA)` |
| PB-AC-17 | No workflow in this repository schedules a self-hosted runner; `actions/runners` remains `0` |
| PB-AC-18 | `city-phase1a-enforcement-v1` and `city-phase0-observatory-v1` still resolve to their original targets, and no tag has been moved |
| PB-AC-19 | The counterfactual is recorded: a negative control shows the gate failing on an undeclared edge, and passing on the same tree after the declaration is added |
| PB-AC-20 | Every retry, flake and reversal that occurred during the phase is present in the ledger, including any run that was re-run |

---

## 13. Explicitly out of scope for Phase 1B

```text
NO architecture migration            NO tenx split
NO dependency-cycle repair           NO persistence/runtime boundary repair
NO private-state repair              NO ownership cleanup
NO mass manifest cleanup             NO module migration
NO debt reduction of any kind        NO baseline widening
```

Phase 1B changes **who is allowed to say no, and what happens when they do**. It does not change the
architecture that the answer is about. Any pull request that both activates the gate and repairs inherited
debt mixes two phases whose evidence must stay separable, and is rejected on that ground alone.

---

## 14. Open questions — recorded rather than resolved

1. **Sequencing versus the epoch anchor.** §9 requires surface extension, epoch advance and activation to
   agree at every commit CI evaluates, but a required check can only be activated by a ruleset edit that is
   not a commit. Whether the ruleset edit belongs before, with, or strictly after the epoch-advancing commit
   is unresolved; the safe reading is that the gate must be *visible and green* before it is *required*, and
   the epoch must be anchored before the check is required.
2. **Where the authorisation record lives.** `config/architecture-enforcement-authorisations.json` (a product
   path, Owner-review-required) versus `trust-policy/` (already Root Trust). The first keeps the trust
   aggregate smaller; the second makes the record's authority unambiguous. Unresolved.
3. **Whether the legacy ratchet's density metrics should move into the new engine** rather than remain two
   separately maintained baselines. H5's superset requirement makes this a Phase 2 question, and Phase 2 is
   not started.
4. **The hosted soak-tier flake.** §1 records a real, unexplained-in-cause timing failure in the slow tier on
   a hosted runner. It is not the enforcement gate's problem, but a required-check regime inherits it: the
   `acceptance` and `unit` contexts that Phase 1B depends on can fail for throughput reasons. Whether Phase 1B
   should also specify a flake budget and a quarantine policy for required checks is unresolved and is
   deliberately left visible.

---

## 15. Reproduction

```powershell
git fetch --all --tags
git rev-parse city-phase1a-enforcement-v1^{commit}     # 5c1cc264448d979969595139ee8b27d7195216d1
git rev-parse city-phase0-observatory-v1^{commit}      # 66440c1d360362a0bba38332d385feed41b64acb
node scripts/architecture-enforcement-baseline.cjs --check      # identical true, hash_matches true
node scripts/acceptance-evolution-bless.cjs --check            # epoch 24 MATCHES
node scripts/architecture-enforcement.cjs --mode shadow         # PASS, findings 1677
node scripts/architecture-enforcement.cjs --mode enforce        # PASS, exit 0
node scripts/architecture.cjs ratchet                           # legacy control, violations []
gh api repos/zhiheng-zhang-Mera/Codex-Boss/rulesets/22746755    # the required contexts and the review rules
gh api repos/zhiheng-zhang-Mera/Codex-Boss/environments         # boss-root-trust-owner, required reviewer
```

---

## 16. Phase 1B-A implementation record — spec corrections and measurements

Phase 1B-A (GOVERNANCE_FOUNDATION) implemented §6, §7, §9 and §10. Where the implementation could not follow
this document as written, the discrepancy is recorded here rather than resolved silently in the code. The
normative text above is deliberately **not** rewritten: this section is what a later reader must reconcile
against it, and each entry says which text it supersedes.

### 16.1 Corrections applied

| # | What this document said | What the implementation does, and why |
|---|---|---|
| C-1 | §7.2: "a new record — proposed path `config/architecture-enforcement-authorisations.json` or an entry under `trust-policy/`" | **`trust-policy/architecture-enforcement-baselines.json`**, schema `city-architecture-enforcement-baseline-series/1`. Placing it under `trust-policy/**` means the authorization record is Owner-review-required by a rule that already exists, instead of by a new one this phase would have had to add. |
| C-2 | §7.1 required every accepted evolution to record "added/deleted identity accounting", and §6.1 named the laundering path | The generator no longer writes the tracked baseline **at all** unless `--accept` is given *and* an accepted series entry already names the exact triple. A plain invocation now writes a **candidate** under `artifacts/city/phase1/` that grandfathers nothing. §7's closure was written as a *check*; a check would still have permitted a naked regeneration to be committed, so the closure was moved to the *write*. |
| C-3 | §5 listed `BASELINE_SERIES_UNAUTHORISED` as "to be implemented", and did not mention fixture seams | Implemented as an `ENGINE_ERROR` in **both** modes. Additionally, `--authorizations <path>` is a fixture seam that is **refused on the governing path**: an authorization check whose source the caller chooses is not a check. The engine records `series_authorization.source` on every run so a governed run is distinguishable from a fixture. |
| C-4 | §9: extending the Root Trust Surface is listed among the things that are "an Owner ceremony" | The extension is an ordinary commit that *necessarily* moves the surface aggregate; the Owner ceremony is the **epoch finalization**. Measured: `advanceTrustEpoch` is a pure function the machine may run to derive the candidate, while `tests/unit/root-trust-authority-lockdown.test.ts` case 2 denies an autonomous actor the `--advance` *write*. That is the line Phase 1B-A holds. |
| C-5 | §9: "the `ci.yml` edit, the `CODEOWNERS` edit and the epoch advance … must land in the same commit" | **Not achievable as written, measured this round.** `.github/workflows/trust-epoch-finalization.yml` runs `workflow_dispatch` on `refs/heads/main` and measures **main's** surface, so it cannot anchor a branch. The epoch advance for a surface extension must therefore follow the merge, as a second Owner act. This is the sequencing constraint that puts Phase 1B-A in `WAITING_FOR_ROOT_OWNER_TRUST_EPOCH_CEREMONY`. |
| C-6 | §4 PRE-11: "Root Trust preparation is complete … so the epoch anchors the new surface" as an activation precondition | Unchanged as a precondition, but its satisfaction is now known to require **two** Owner merges (the extension, then the epoch), so it cannot be satisfied by a single PR. |

### 16.2 Defect found in existing machinery, recorded and not fixed

**The documented trust-data generation mode destroys the epoch chain.**
`tests/acceptance/autonomous-evolution-trust.test.ts` documents `BOSS_GENERATE_EVOLUTION_TRUST=1` as the way to
re-bless `trust-policy/root-trust-surface.json` **and** `trust-policy/trust-epoch.json`. Its
`writeTrustPolicyData` builds the epoch with `advanceTrustEpoch({ previous: null, … })`, i.e. a **genesis** epoch
(`trust_epoch: 1`, no parent). Running the documented generation mode after any epoch history exists would
replace epoch 24 with epoch 1 and break the append-only chain the trust model depends on.

Phase 1B-A therefore regenerated the declaration mirror **only**, from the module's own
`declaredRootTrustSurface()` (the same generator the acceptance suite calls), and did not run the generation
mode. This is a defect in a Root Trust file, so fixing it is a separate governance act with its own epoch; it is
out of scope for this round and is recorded in `docs/research/PAPER_EVIDENCE_LEDGER.md`.

### 16.3 Measurement note: what the Root Trust aggregate is sensitive to

Measured while freezing this phase: editing `scripts/architecture-baseline-series.cjs` moved the surface
aggregate (`b1e8a5ca…` → `37c98265…`, 72 files), while adding two ordinary unit-test files under
`tests/unit/city/` moved the **observatory's** `semantic_hash` (`21eac0cb…` → `ac115cc8…`) but **not** the
accepted baseline (`--check` stayed `identical: true` with 612 files / 1671 edges).

The asymmetry is real and is worth knowing before either number is used as evidence: the observatory's semantic
hash covers the tracked-file inventory (so any new tracked file moves it), whereas the enforcement baseline
covers the *scan set* and the resolved graph. A baseline that moved every time an unrelated file was added
would be unusable as a ratchet; a semantic hash that did not move would not be a hash of the measurement.


---

## 17. Phase 1B-B implementation addendum — the PRE-08 stage-scope reconciliation

This section is **appended**. Sections 0–16 above are unchanged, and no earlier normative text is rewritten. It
records a specification discrepancy found during the S2-exit audit, its provenance, and the evidence-based
resolution. The discrepancy is recorded rather than silently reinterpreted.

### 17.1 The inconsistency as written

The stage table (§3) states the S3 entry condition as *"S2 exit conditions; §4 fully satisfied; §10 Owner-authority
move completed; §11 rollback rehearsed and recorded"*. §4 still lists **PRE-08** unchanged:

> `PRE-08` — `.github/workflows/ci.yml` is unchanged by the freezing round and still contains no enforcement step.

That requirement is coherent for **S1**, whose entry condition explicitly cites it. It cannot hold at **S3**:
`ci.yml` must by then contain `architecture:enforce`, because adding that step *is* stage S2.

```text
SPEC_DISCREPANCY_PRE08_STAGE_SCOPE = PRESENT
```

### 17.2 Provenance, measured

```text
1. PRE-08 WAS SATISFIED AT THE S1 ENTRY POINT.
   S1's parent commit 4a89ff1e has NO `architecture` job at all; ci.yml blob ff344cc08e50e5a0a9de576f0b86d6004fb6bab5.
   grep for `architecture:enforce` in that tree: absent.

2. S1 ADDED THE JOB, SHADOW ONLY.
   commit eca87987 "feat(city): the architecture judge enters hosted CI in shadow, and does ..."

3. S2 INTENTIONALLY SUPERSEDED THAT STATE.
   commit 388dec8b "city(phase1b-s2): hosted enforce visible, not required"
     parent 5da81700:  `architecture:enforce` ABSENT   ci.yml blob 45b17862281afa27dac926082f36e11e0faf0dca
     the commit:       `architecture:enforce` PRESENT  ci.yml blob 9fd6b58eeab3087a99b93425d3f0c9599d028d1c

4. NO EARLIER RECORD ALREADY SUPERSEDES IT.
   Section 16 (the Phase 1B-A implementation record) exists and does not mention PRE-08, so this addendum is the
   first correction rather than a duplicate.
```

### 17.3 The resolution

```text
PRE-08 is an S1-ENTRY HISTORICAL PRECONDITION.

For S3, the evidence must prove that PRE-08 was satisfied at S1 entry, and that the only later evolution of the
workflow is the authorised S1 -> S2 rollout described in §3. It is NOT a current-state requirement that enforce be
absent during S3 activation: requiring that would make S3 unreachable by construction, because the very change S3
certifies is the presence of the enforcement step.

Consequently PRE-08's status at S3 is SUPERSEDED_BY_STAGE_PROGRESSION, not FAIL and not waived. Every other
precondition in §4 remains a live current-state requirement, and nothing here licenses waiving any of them.
```

This addendum is evidence about a specification's internal consistency. It changes no code, no workflow, no baseline,
no ruleset and no required context, and it does not by itself assert that S2 has exited.
