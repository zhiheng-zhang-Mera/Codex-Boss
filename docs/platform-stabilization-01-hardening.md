# Platform Stabilization Phase 01 — Hardening: status and plan

> **STATUS: OPEN — planning only. No production code has been changed in this phase.**
>
> Platform Foundation Phases 01–08 are **frozen**. This document opens the stabilization phase and carries
> forward the known debts. It records no fix, closes no debt, and changes no gate.
>
> Tagged certified head: `platform-foundation-v1` → `601285abe6500eb817fd450897afa82d0512538c`
> Stabilization branch: `platform-stabilization/01-hardening`, branched from that head.

## 1. What "frozen" means, and what must not happen

The Foundation chain is closed at `platform-foundation-v1`. Within this phase:

- **Foundation history is not rewritten.** Phases 01–08 commits, their status records and the
  `platform-foundation-v1` tag are immutable. No rebase, reset, force-push, amend, or re-tag.
- **No gate is weakened.** The mandatory platform verification, the semantic acceptance contract, the
  mutation/root/scope guards and the economics guard stay exactly as certified.
- **No baseline inflation.** A failure is never made to disappear by raising a recorded baseline, adding
  an exemption, or widening an allow-list. `tests/fixtures/comment-citation-baseline.json` and every
  comparable baseline may only shrink.
- **Every fix gets a focused regression**, and **every debt closure carries before/after evidence**.
- **Unrelated debt is not silently bundled.** One debt per change, named in the commit.
- **If a discovered issue turns out to be architectural, stop and report before widening scope** rather
  than resolving it in-flight.

## 2. Carried-forward debt

| ID | Title | Status | Severity | Classification | Priority |
| --- | --- | --- | --- | --- | --- |
| `PF-DEBT-003` | Slow-tier sandbox suite cannot achieve isolation on this host | `ENVIRONMENT-BLOCKED` (wording stale) | MEDIUM | **Investigation-first** | **P0** |
| `PF-DEBT-012` | Off-CI evolution/prestart attestation yields `INVALID_CERTIFICATE` | `EVIDENCE-TIER NOTE` | LOW | Evidence / attestation-path | P2 |
| `PF-DEBT-013` | Acceptance and toolchain scope is TypeScript-centric | `ARCHITECTURE ISSUE` | HIGH (as a scope limit) | **Known language-scope limitation** | P2 |
| `PF-DEBT-015` | `test:impact:verify` can print disagreement while exiting 0 | `OPEN` | MEDIUM | **Diagnostics / exit-status defect** | P1 |
| — | External mutation guard not yet exercised on a real external mutation boundary | unrecorded as an ID | MEDIUM | Qualification gap | P1 |
| — | Remote CI evidence weaker than local exact-head evidence | `PF-DEBT-004` (evidence-tier note) | LOW | Evidence tier | P1 |
| — | Rehearsal branches retained as promotion audit evidence | temporary | — | Housekeeping | — |

### `PF-DEBT-003` — sandbox / AppContainer (investigation-first, P0)

- `WindowsAppContainerSandbox.probe()` reports **`available: true`**, `mechanism: "windows-appcontainer"`,
  a real `containerSid`, `jobObject: true`, `suspendedStart: true`, `childProcessBlocked: true`,
  `networkDenied: true`, launcher built by `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.
  Reproducible with `scripts/probe-sandbox-capability.cjs`.
- The slow sandbox suite (`tests/unit/evolution-sandbox.test.ts`) **still fails 11/14** and its CONTROL
  case still fails because **`result.sandboxed === false`**.
- **The previously recorded root cause is stale.** "The host provides no AppContainer" is no longer the
  explanation: the probe succeeds where the executed run does not.
- **The sandbox requirement must not be weakened.** `sandboxed` is never mocked, the case is never
  skipped, and the AppContainer requirement is never lowered to make the suite green. A green suite that
  no longer proves isolation is worse than a red one that says so.
- **Classification: investigation-first.** The next step is diagnosis (why a successful probe still
  yields `sandboxed: false` at run time — launcher argument handling, container creation, job-object
  assignment, or path granting), not a fix. No code change is authorised until the cause is established.

### `PF-DEBT-012` — attestation path (P2)

- `pnpm run verify:certificate` reports `INVALID_CERTIFICATE` because
  `artifacts/acceptance/prestart-attestation.json` is absent. That file is the **evolution / bootstrap
  prestart** attestation, written by `scripts/acceptance-prestart.cjs` inside a CI graduation run and
  consumed by `scripts/acceptance-evolution-certificate.cjs`. No module under `electron/` or `src/` reads
  or writes it, so the production startup path does not owe it.
- It is **distinct from the platform certificate**: `scripts/platform-certificate.cjs` →
  `artifacts/platform-foundation/phase-05/platform-certificate.json`, which reports **17/17 invariants
  held, `phaseStatus=COMPLETE`, `notRun=[]`**.
- **Classification: evidence / attestation-path issue.** Not a defect in the production path; the two
  certificates must never be conflated. No artifact is to be fabricated to turn the check green.

### `PF-DEBT-013` — language scope (P2, known limitation)

- The production engineering path is **TypeScript-centric**: checks are selected for JS/TS files, the
  toolchain is resolved from `node_modules`, and the Phase 07 assertion reader is a lexical reader for
  `expect(…)` / `assert(…)` / `expectTypeOf(…)` inside `it`/`test`/`describe`.
- **Python and docs-only repositories fail closed**, as measured on `Quant-ultra` (231 files, 154 `.py`)
  and `drug-simulator` (2 docs): both refused at the audit with `PRECONDITION_FAILED` and the provider
  never called. That is correct behaviour, not a bug to route around.
- Two TypeScript repositories subsequently **converged and satisfied acceptance**
  (`dsh-health-scheduler`, `dsh-restart`), so the limitation is a **scope** limit, not universal breakage.
- **Do not invent language adapters** unless explicitly approved. **Classification: known language-scope
  limitation.**

### `PF-DEBT-015` — `test:impact:verify` exit status (P1, diagnostics)

- `scripts/test-impact.cjs` → `commandVerify` sets `process.exitCode = 1` when `!audit.agrees`, then
  returns `0`; the entry point exits with the return value, so **the non-zero signal never reaches the
  caller**. Observed: `corepack pnpm run test:impact:verify` on a **clean** tree printed
  `"agrees": false` with 214 `missedSuites` and **exited 0**.
- A clean tree also **manufactures** the disagreement: `changedFiles` is empty ⇒ `changedSetUnknown` ⇒
  the selector sets `fullRunRequired: true` and returns its 15 always-run suites, which `verify` then
  compares against all 229 catalogue suites. The comparison does not model the unknown-changed-set case.
- **`verify:targeted` is the actual passing promotion gate** (`scripts/verify-targeted-vs-full.cjs`), and
  it agreed at the certified head. This defect is in the separate diagnostics command.
- **Classification: diagnostics / exit-status defect.**

## 3. Facts carried forward that are not yet debt IDs

- **External mutation guard not exercised on a real external boundary.** Every external qualification run
  either refused before proposing or applied a creation-granted file; no run reached a mutation boundary
  on genuinely external code. The guard's own suites are green, but "unmodified and green" is a weaker
  claim than "exercised externally", and the two must not be conflated.
- **Remote CI evidence is weaker than local exact-head evidence.** Phase 05–08 acceptance is exact-head
  **local** execution (`PF-DEBT-004`), not remote CI. It must not be described as CI-verified.
- **Rehearsal branches are retained temporarily** as audit evidence for the promotion:
  `promotion-test/platform-foundation-08` and `promotion-test/final-platform-foundation-08`. They are not
  part of the product and are to be deleted only once promotion evidence no longer needs them.

## 4. Proposed execution order

Nothing below is started in this phase. The order is recorded so work is not taken out of sequence.

**P0**

1. **`PF-DEBT-003` sandbox / AppContainer investigation.** Diagnose why a successful probe still produces
   `sandboxed: false`. Investigation first; a fix is authorised only after the cause is established, and
   the requirement is never lowered.

**P1**

2. **External mutation-guard qualification** on a disposable external TypeScript repository — reach a real
   mutation boundary on non-Boss code and record what the guard does, rather than inferring it.
3. **`PF-DEBT-015`** — make `test:impact:verify`'s exit status authoritative and model
   `changedSetUnknown` explicitly, so a clean-tree invocation cannot manufacture a disagreement.
4. **Remote CI evidence for the certified head** — strengthen the evidence tier so the certified main is
   backed by CI, not only by local exact-head runs.

**P2**

5. **`PF-DEBT-012`** attestation-path cleanup — reconcile the evolution/prestart attestation path with
   `verify:certificate`, without fabricating artifacts.
6. **`PF-DEBT-013`** language adapters — **only if a real Python/Go engineering need appears.** Not on
   speculation.

## 5. Exit criteria for this phase

- Each addressed debt has a focused regression test and before/after evidence recorded in
  `docs/platform-foundation-known-issues.md`.
- No gate has been weakened and no baseline has been inflated; the drift is visible in the diff.
- `platform-foundation-v1` and Phases 01–08 history are byte-identical to their certified state.
- Any newly discovered architectural issue has been reported and **not** resolved in-flight.

## 6. CI topology: push CI versus platform qualification

This section was added while making the certified head green on real CI. It records a **routing** change,
not a gate change: no assertion, threshold, corpus invariant or fail-closed path was touched.

The measured starting point: `Desktop CI` had never been green (fifteen consecutive failing runs). The
default tier was fixed first (218 files / 2544 tests green in run 35327676450), which exposed the next
tier for the first time — `test:postbuild` had always been skipped behind it. Running it on the hosted
runner showed three of its ten suites failing for one shared reason: they need evidence a clean checkout
does not have.

| Suite | Needs | Evidence |
| --- | --- | --- |
| `data-lifecycle-report.test.ts` | accumulated host corpus | hosted runner: 56 files; a real host: ~71 367, of which ~65 125 is `artifacts/host-soak` soak residue. The gate's own invariant is `>1000` files |
| `platform-certificate.test.ts` | Phase 01–04 generated artifacts | the artifacts were read from a sibling test's side effect inside a parallel tier — a race, not a prerequisite |
| `targeted-vs-full.test.ts` | a real full-suite pairing record | `pnpm run verify:targeted` executes the whole unit tier before it can write one |

They keep every assertion and move to the `test:platform-qualification` tier, run on the real soak host by the
qualification workflow in the separate **private** control repository
(`zhiheng-zhang-Mera/Boss-Qualification-Control`, `workflow_dispatch`, main-only), which generates each declared
prerequisite with its own official generator in dependency order. **No workflow in this repository runs the
tier** — `.github/workflows/platform-qualification.yml` is the public hosted DIAGNOSTIC lane, and
`tests/unit/test-layers.test.ts` asserts the negative over the whole workflow directory rather than over push
CI alone. `test:postbuild` stays in push CI and is now exactly the suites whose only declared prerequisite is
the build — the claim a clean runner can honour.

A fourth case surfaced only when the acceptance chain reached its final step (run 35334147247: **68 of 69
steps green**). `pnpm run acceptance:autonomous-evolution` ends in `judgeSelfCertification`, and the observed
refusal was `trust epoch 20 REFUSED` (`epoch 20 certifies 35448480… but the surface is 1ebe2141…`) plus
`self-certification:SELF_CERTIFICATION_FORBIDDEN:TRUST_EPOCH_MIGRATION`.

**This section originally recorded that refusal wrongly, and the correction is kept rather than edited
away.** The first reading was that `judgeSelfCertification` refuses *any* run whose diff touches the Root
Trust Surface — which `ci.yml` is — so no commit editing CI could ever pass, and the step was moved out of
push CI on that basis. The premise is false about the **caller**: `scripts/acceptance-autonomous-evolution.cjs`
compares the surface with itself (`assessRootTrustChange({ baseline: entries, candidate: entries })`), so
`rootTrustTouched` is false there and the binding condition is whether the **committed trust epoch anchors
the live Root Trust Surface**. The refusal was an unanchored epoch — exactly what the `TRUST_EPOCH_MIGRATION`
required-action names, and what one Owner-authorised migration fixes. Moving the step away would have hidden
it. The step is back in the acceptance chain, and `tests/unit/test-layers.test.ts` now asserts all three
load-bearing facts: the touched-diff refusal is real, the committed epoch anchors the live surface, and the
graduation gate runs in push CI. A Root Trust change therefore takes
`node scripts/acceptance-evolution-bless.cjs --advance` **in the same commit** (the cadence epochs 11 and 13
followed, per `docs/phase-status.md`), and CI is the run that certifies the new epoch.

`tests/unit/test-layers.test.ts` enforces the tier boundary mechanically: every postbuild entry declares
`requires: ["build"]` and nothing more, every qualification entry declares at least one requirement from
`QUALIFICATION_REQUIREMENTS` and names a producer script that exists, no push-CI entry may declare one of
those, **no workflow in this repository runs the qualification tier or any qualification producer**, and the
public qualification lane is dispatch-only. A lane here that runs a producer must state
`HOSTED_RUNNER_NOT_A_QUALIFICATION_HOST`, so a public lane cannot generate the prerequisites of a
qualification it cannot perform and read as one that performed it.

**What `Desktop CI` green means now:** this commit typechecks, contains no tracked secret, keeps the
architecture ratchet, builds, and passes the default, current-build and slow tiers on a clean runner. It
does **not** mean Phase 01–05 qualification was re-run. **What a green real-host qualification run means:**
the frozen qualification gates passed with their real prerequisites present, on the dedicated host in the
private control plane. Conflating the two is the misreading this split exists to prevent. The public
`Platform Qualification (hosted status)` lane is a DIAGNOSTIC: green there means the hosted runner has no
accumulated corpus, which is the topology, not a qualification.

Two facts about the qualification lane, recorded rather than hidden:

- **It cannot pass the Phase 04 gate on a hosted runner, and says so instead of pretending.** The honest
  status is `BLOCKED_BY_REAL_SOAK_EVIDENCE`, the workflow records the corpus provenance in the job summary
  before anything depends on it, runs the Phase 04 generator to SHOW the refusal, and warns loudly if that
  gate ever passes on a hosted runner. No filler corpus, no lowered invariant and no `process.env.CI` branch
  was introduced to change that; a fake green would be worse than a blocked qualification.
- **This is a routing change, so Foundation gate semantics are unchanged** (`FOUNDATION_GATE_SEMANTICS_UNCHANGED`).
  No binding document was found requiring these suites to be in `test:postbuild` or to run on every push;
  the audit is recorded in the receipt for this work.

## 7. Decision record (Owner-authorised)

### Decision A — `EXECUTION_BUDGET_ADJUSTMENT` (not a threshold change)

Two **execution-time budgets** changed while making CI honestly green, and the Owner classified them
explicitly:

| Change | File | Was | Now |
| --- | --- | --- | --- |
| per-test time budget for the 100k-event scale gate | `tests/unit/platform/scale-synthetic.test.ts` | 300 s | 600 s |
| per-test ceiling of the qualification tier | `vitest.qualification.config.mjs` | 60 s | 120 s |

Classification: **`EXECUTION_BUDGET_ADJUSTMENT`** — *not* a `QUALITY_THRESHOLD_CHANGE`, *not* an
`EVIDENCE_THRESHOLD_CHANGE`, *not* a `GATE_SEMANTICS_CHANGE`. The grounds are that the scale gate itself
records the time and asserts nothing about it ("Recorded, not asserted as a budget: the book's priority at
scale is correctness"), the failure was the GitHub Windows runner's fsync/runtime behaviour rather than a
wrong result, and the scale, inputs, assertions, correctness requirements and evidence requirements are all
unchanged. The durability setting was deliberately **not** relaxed to flatter the number.

Bound on this: **no timeout may be expanded again without new measured evidence and a fresh report to the
Owner.** `data-lifecycle-report.test.ts` measured 63 s on a real corpus, above the postbuild tier's 60 s
ceiling, which is a second reason it belongs in the qualification tier rather than the push-CI one.

### Decision B — authorised Trust Epoch Migration (epoch 20 → 21)

Owner authorisation, scoped to the change `f15794c..3f16e44` plus the minimal metadata/certificate/provenance
needed to complete one migration. It is **not** a standing authorisation for future Root Trust changes.

- **Why epoch 20 could not speak for this change.** Epoch 20 (`boss-root-trust-20`) anchors surface aggregate
  `3544848099c2102016724783f8a63942ef8ad415d2ab69c08dafab33f7c8813e`. The authorised change edits two Root
  Trust paths — `.github/workflows/ci.yml` and `tests/acceptance/platform-architecture-diagnostics.test.ts` —
  so the live aggregate became `1ebe2141fc4f035bf5c69f72bfbee61017231f5b6c7df4f31c8e40f42c1b113e` and the
  committed epoch no longer anchored the tree. A run may not certify its own Root Trust change, so the
  transition is performed by the separate, explicit blessing step, and the commit carrying it is the one CI
  certifies (`docs/autonomous-evolution.md`, and the same cadence as epochs 11 and 13).
- **Which diff the Owner authorised.** `f15794c..3f16e44` on `main`, as delivered by `Desktop CI`
  run 35349303657 (all four jobs green), plus this migration's own metadata.
- **Which epoch it migrates from, and to.** Parent record: epoch 20, `b289815451c956efdbaedea8fa123cf94aedd25333de9ea89daf18d510fd22a5`.
  New record: epoch 21, `boss-root-trust-21`, whose `parent_epoch_hash` is that digest — the chain is
  machine-verifiable and history is appended to, never rewritten.
- **What is trusted after the migration.** The tree of the migration commit (the direct child of `3f16e44`),
  anchored by epoch 21's `root_surface_hash` over every file the policy classifies `ROOT_TRUST_SURFACE`.
- **Which files are the authorised root-trust change.** `.github/workflows/ci.yml` and
  `tests/acceptance/platform-architecture-diagnostics.test.ts`. No root trust path was added to or removed
  from `ROOT_TRUST_SURFACE_PATHS`, and the classifier, `SELF_CERTIFICATION_FORBIDDEN` and every
  acceptance/qualification assertion are untouched.
- **Which gate semantics are unchanged.** All of them: no assertion, evidence requirement, corpus invariant,
  fail-closed path or acceptance threshold changed in this migration. The only non-root changes are the
  correction of a routing decision this document already records (the graduation gate returns to the
  ordinary acceptance chain), the qualification lane's added trust-epoch `--check`, and documentation.
- **How the authorisation enters the evidence chain.** The epoch record's parent-linked transition is the
  machine-verifiable part (a tampered record breaks `verifyTrustEpochFile`); this decision record and the
  commit that carries both bind the authorisation to the tree; `Desktop CI` on that commit re-certifies it.
  There is no separate Owner-authorisation schema in this repository and none was invented.

## 8. Non-goals

- No Phase 09, no new platform abstraction layer.
- No rewrite, re-tag or force-push of the Foundation chain.
- No debt closed by deletion, skipping or exemption.
- No language adapter, plugin or capability added without explicit Owner approval.
