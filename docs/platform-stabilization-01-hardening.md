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

They keep every assertion and move to the `test:platform-qualification` tier, run by
`.github/workflows/platform-qualification.yml` (`workflow_dispatch`), which generates each declared
prerequisite with its own official generator in dependency order. `test:postbuild` stays in push CI and is
now exactly the suites whose only declared prerequisite is the build — the claim a clean runner can honour.

`tests/unit/test-layers.test.ts` enforces the boundary mechanically: every postbuild entry declares
`requires: ["build"]` and nothing more, every qualification entry declares at least one requirement from
`QUALIFICATION_REQUIREMENTS`, no push-CI entry may declare one of those, each qualification entry names a
producer script that exists and is an explicit step in the qualification workflow, push CI has no step
that runs the qualification tier or any qualification producer, and the qualification workflow is
dispatch-only.

**What `Desktop CI` green means now:** this commit typechecks, contains no tracked secret, keeps the
architecture ratchet, builds, and passes the default, current-build and slow tiers on a clean runner. It
does **not** mean Phase 01–05 qualification was re-run. **What `Platform Qualification` green means:**
the frozen qualification gates passed with their real prerequisites present. Conflating the two is the
misreading this split exists to prevent.

Two facts about the qualification lane, recorded rather than hidden:

- **It is expected to be red on a hosted runner until a real corpus exists there.** The honest status is
  `BLOCKED_BY_REAL_SOAK_EVIDENCE`, and the workflow records the corpus provenance in the job summary
  before anything depends on it. No filler corpus, no lowered invariant and no `process.env.CI` branch was
  introduced to change that; a fake green would be worse than a blocked qualification.
- **This is a routing change, so Foundation gate semantics are unchanged** (`FOUNDATION_GATE_SEMANTICS_UNCHANGED`).
  No binding document was found requiring these suites to be in `test:postbuild` or to run on every push;
  the audit is recorded in the receipt for this work.

## 7. Non-goals

- No Phase 09, no new platform abstraction layer.
- No rewrite, re-tag or force-push of the Foundation chain.
- No debt closed by deletion, skipping or exemption.
- No language adapter, plugin or capability added without explicit Owner approval.
