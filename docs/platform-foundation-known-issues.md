# Platform Foundation — Known Issues / Engineering Debt Log

Durable, retrievable records of platform problems that are **known, attributed and deliberately not
closed** at the commit that last reviewed them. This is not a scratch TODO list: every entry carries the
fields below so it can be searched, re-reviewed, updated and closed as a record rather than rediscovered
as a surprise.

**Field contract.** Every entry MUST carry all of: `ID`, `Title`, `Discovered phase`, `Status`,
`Severity`, `Affected capability`, `Evidence / source`, `Why deferred`, `What would close it`,
`Target / revisit phase`, `Last reviewed SHA`.

**Status vocabulary** (use exactly one):

| Status | Meaning |
| --- | --- |
| `OPEN` | Confirmed, attributed, not yet worked. |
| `DEFERRED` | Confirmed, deliberately postponed; carries a revisit phase. |
| `ENVIRONMENT-BLOCKED` | Cannot be closed on the current machine regardless of effort. |
| `EVIDENCE-TIER NOTE` | Not a defect. A provenance statement that must stay accurate. |
| `FIXED` | Closed; the entry is kept with the closing commit so the history is not lost. |
| `ARCHITECTURE ISSUE` | A contract disagreement that must be resolved as design, not patched. |

**Severity vocabulary:** `CRITICAL` (silently wrong results or lost work) · `HIGH` (a stated platform
property is false in practice) · `MEDIUM` (degraded diagnosability or duplicated authority) · `LOW`
(hygiene / documentation accuracy).

**Rule for adding entries.** A problem enters this log when it is *located in code or observed in a real
run* — never when it is merely suspected. The `Evidence / source` field names the file and line, or the
run and artifact, that establishes it.

---

## PF-DEBT-001 — `experience` capability has no authoritative test suite

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-001` |
| **Title** | `experience` capability has no authoritative test suite |
| **Discovered phase** | 05 (recorded in `docs/9-16-platform-foundation-phase-05-status.md` §11) |
| **Status** | `FIXED` (Phase 06 Task C) |
| **Severity** | `HIGH` |
| **Affected capability** | `experience` |
| **Evidence / source** | `test-impact` ownership audit: `electron/experience/` and `src/shared/experience.ts` are owned by the `experience` capability, and no catalogue entry declared an authoritative obligation for it. Phase 05 §11 records it by name: *"`experience` and `remote` have no authoritative suite at all … This is a real evidence gap in the platform, not a selector bug."* |
| **Why deferred** | Not a Phase 05 gate, and the gap cannot be closed honestly by inventing a suite: an authoritative suite must test the capability's declared contract, and the contract itself has to be established first. Writing a test that asserts whatever the implementation happens to do would manufacture coverage rather than evidence. |
| **What would close it** | An authoritative suite in `config/test-catalogue.json` whose obligations match the capability's declared invariants, passing at an exact head, and the capability no longer appearing in the ownership audit's unowned-obligation list. If the contract turns out not to exist in the implementation, the honest close is a `ARCHITECTURE ISSUE` entry instead — not an empty test. |
| **Target / revisit phase** | Phase 06 Task C |
| **How it was closed** | `tests/unit/experience-capability.test.ts` (22 tests) is the authoritative suite. It covers the promotion hierarchy and its thresholds (including that distinct WORKSPACES are counted, not observations, so a single project's habit cannot become a domain rule), the contribution statistics (including a `null` rate rather than a `0` for an unrated runtime), the durable store (claim-keyed entries, the 200-observation bound, restart durability, fail-closed reads, missing-is-empty), and the bus→store bridge (which events become observations, the caller's source mapping and weight, that an event without a task or runtime is ignored, and that detaching really detaches). The suite states what it does NOT cover: the Commander's USE of a promoted claim. Nothing in the platform reads the store back to alter a decision — wiring promotion into routing is a product change Phase 06 is forbidden to make — and that is recorded rather than dressed up as coverage. |
| **Last reviewed SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` |

## PF-DEBT-002 — `remote` capability has no authoritative test suite

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-002` |
| **Title** | `remote` capability has no authoritative test suite |
| **Discovered phase** | 05 (recorded in `docs/9-16-platform-foundation-phase-05-status.md` §11) |
| **Status** | `FIXED` (Phase 06 Task C) |
| **Severity** | `HIGH` |
| **Affected capability** | `remote` |
| **Evidence / source** | `electron/remote-relay.ts` was named only by `tests/unit/process-gateway.test.ts`, which asserts the **import boundary** rather than behaviour. No catalogue entry declared an authoritative obligation for `remote`. |
| **Why deferred** | Same as `PF-DEBT-001`. Additionally, a relay's real behaviour is partly environmental (it drives an external channel), so the authoritative suite has to separate what is testable in-process from what is not — and say which half it covers rather than implying full coverage. |
| **What would close it** | An authoritative suite covering the relay's in-process contract (parsing, routing, refusal, status reporting, lifecycle), explicitly declaring which behaviour is **not** covered in-process, and `remote` ceasing to appear in the unowned-obligation list. |
| **Target / revisit phase** | Phase 06 Task C |
| **How it was closed** | `tests/unit/remote-capability.test.ts` (22 tests) is the authoritative suite. The relay was made testable by two narrow changes that add no behaviour: `parseRelayLine` is exported (it is pure, it is the relay's entire input contract, and it was the untested part that must not drift), and the launcher is an injectable constructor parameter defaulting to the real `spawn`, so the channel lifecycle is exercised deterministically. The suite covers both halves: the input contract (well-formed status/command records, trim, and the refusals — an unserved channel, an unmodelled status including `disabled`, a missing field, a whitespace-only command, malformed input without throwing, and the body/window bounds) and the lifecycle (only the enabled channel starts, an unchanged prefix is not restarted, a changed prefix replaces the old listener, disabling stops and reports, chunk reassembly, multiple records per chunk, status forwarding, an unparseable line ignored, an unexpected exit reported as an error carrying stderr, a DELIBERATE stop NOT reported as an error, a launcher failure surfaced, and disposal). The suite states what it does NOT cover: `scripts/pc-chat-relay.ps1` and the Windows desktop automation behind it, which needs a logged-in WeChat/QQ client on a Windows host. The relay treats that script as an untrusted line producer, which is why the parsing contract is authoritative on its own. |
| **Last reviewed SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` |

> **Both entries must stay visible.** Closing the evidence gap is allowed; making the capability disappear
> from coverage or ownership reporting by widening a selector exemption is **not**. A capability that is
> silent must read as silent.

## PF-DEBT-003 — `evolution-sandbox` slow-tier validation requires an AppContainer

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-003` |
| **Title** | `evolution-sandbox` slow-tier validation cannot pass without an AppContainer |
| **Discovered phase** | 03 (recorded) / re-confirmed 05 (recorded in §11) |
| **Status** | `ENVIRONMENT-BLOCKED` |
| **Severity** | `MEDIUM` |
| **Affected capability** | `evolution` (self-modification sandbox) |
| **Evidence / source** | `tests/unit/evolution-sandbox.test.ts` on the slow tier: 11/14 pass, and its own CONTROL case fails because `result.sandboxed === false`. Established as pre-existing by running it on the unmodified Foundation baseline `4b623b9`, where it fails identically. **Not** a Phase 05 regression and **not** a Phase 05 gate. |
| **Why deferred** | The host provides no AppContainer. No amount of code change makes an unavailable OS isolation facility available, and the test correctly refuses to claim it sandboxed something it did not. |
| **Phase 08 re-check — the stated blocker no longer applies** | The condition above is **stale**. On this host the backend's own probe now reports the mechanism as available: `WindowsAppContainerSandbox.probe()` → `available: true`, `mechanism: "windows-appcontainer"`, `reasons: []`, `containerSid S-1-15-2-1182052323-…`, `jobObject: true`, `suspendedStart: true`, `childProcessBlocked: true`, `networkDenied: true`, launcher built by `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` (source hash `5530a6be…`). The launcher artefact exists at `%LOCALAPPDATA%\CodexBossSandbox\SandboxLauncher.exe`. Reproducible with `node scripts/probe-sandbox-capability.cjs`. |
| **What that changes, and what it does not** | It does **not** close the entry, and the sandbox requirement is **not** lowered. The slow suite still fails 11/14 with `sandboxed: false`, and the CONTROL still fails — so the failure is now attributable to something other than a missing OS facility (the probe succeeds where the executed run does not, which points at launcher/container creation at run time rather than availability). That is a different, un-investigated problem, and claiming the entry "closed by a capable host" on the strength of a probe would be exactly the over-claim this log exists to prevent. |
| **Required environment capability** | A Windows host with AppContainer support available to the Electron process (the sandbox host must be able to create the container). **Prerequisite present as of Phase 08**; see the re-check row. |
| **Current fallback / skip / refusal behaviour** | Fail-closed refusal. `result.sandboxed === false` is reported as a failed sandbox, and the run does **not** claim isolation it did not obtain. The suite is on the slow tier, so it does not block the default unit gate. |
| **What would close it** | All 14 slow-tier cases passing, including the CONTROL, with `sandboxed: true` — or a diagnosis of why a successful probe still yields `sandboxed: false` at run time. Running the suite on a host that provides an AppContainer was the original stated close and is now necessary but demonstrably not sufficient. |
| **Explicitly forbidden** | Lowering the sandbox requirement, mocking `sandboxed`, or marking the case skipped in order to make the suite green. A green suite that no longer proves isolation is worse than a red one that says so. |
| **Target / revisit phase** | Phase 08 (re-checked, re-stated). It is **not** a Phase 08 promotion blocker unless the original Phase 08 book requires sandbox promotion — it does not — but the stale `ENVIRONMENT-BLOCKED` wording is corrected here so the log does not keep asserting a blocker that is no longer the cause. |
| **Last reviewed SHA** | `c1752459ab762f16ef4d35a5bfa765b1e7a500a0` |

## PF-DEBT-004 — Phase 05 acceptance is exact-head **local** execution evidence

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-004` |
| **Title** | Phase 05 acceptance evidence is local exact-head execution, not remote CI |
| **Discovered phase** | 05 |
| **Status** | `EVIDENCE-TIER NOTE` |
| **Severity** | `LOW` (a provenance-accuracy requirement, not a defect) |
| **Affected capability** | platform-wide (the certification claim itself) |
| **Evidence / source** | The Phase 05 gate record in `docs/9-16-platform-foundation-phase-05-status.md`: unit (2372 tests / 204 files), postbuild (113 / 10), typecheck, security scan (1128 files), architecture ratchet, state probe, gate 2 pairing and certificate (17/17 invariants) were all executed **on this machine at the recorded commit**. No GitHub Actions or other remote CI run corresponds to them. |
| **Why deferred** | No remote CI pipeline is configured in this repository. Establishing one is out of Phase 05's scope and is not required for its PASS. |
| **What this obliges** | The evidence must be described accurately: **exact-head locally executed and recorded**, verified by re-running at that commit. It must **not** be described as "remote CI independently verified", "CI green", or "verified by an independent runner". Phase 05 PASS does not depend on remote CI and is not reduced by its absence — but the provenance wording must stay true. |
| **What would close it** | A remote CI pipeline that runs the same gates on the same commit, after which this entry is downgraded or closed with the run URL recorded here. |
| **Target / revisit phase** | Not a Phase 06 gate; revisit when remote CI is introduced |
| **Last reviewed SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` |

---

# Defects found during Phase 06 reconstruction

These were located in the code while reconstructing the Phase 06 engineering book, and each was verified
before being recorded. They are in scope for Phase 06 Task B.

## PF-DEBT-005 — `interventions.json` writer and reader disagree on the document shape

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-005` |
| **Title** | Unresolved human interventions are silently never collected |
| **Discovered phase** | 06 (during book reconstruction) |
| **Status** | `FIXED` (Phase 06 Task B1, commit `phase-06` batch 1) |
| **Severity** | `HIGH` |
| **Affected capability** | `tasks` (write side — the guidance gate) / `status` (read side — the observation surface) |
| **Evidence / source** | **Writer:** `electron/commander/human-guidance-gate.ts:14-17` declared `InterventionFile { schemaVersion: 1; interventions: HumanInterventionRequest[] }` and `:78` wrote that key. **Reader:** `electron/host/host-observer-collector.ts:441-446` parsed the same file as `{ items?: Array<{ taskId; kind; question; resolvedAt? }> }` and iterated `parsed?.items ?? []`. The key differed (`interventions` vs `items`), and the whole read sat inside a `try/catch` that treated any problem as "interventions.json absent" (`:447-449`). |
| **Consequence** | The observation surface reports **zero** unresolved human interventions, always. Tasks waiting on a human are invisible to the failure/inspection surface, and the failure is silent rather than reported — a defect disguised as "nothing wrong". |
| **Why recorded now** | Located during reconstruction and confirmed by reading both sides. Not fixed here because the Phase 06 book is written before construction begins. |
| **What would close it** | Reader and writer constrained by one shared type/constant rather than two hand-written key strings; a **two-way** test proving an unresolved intervention *is* collected and a resolved one *is not*; and a parse failure distinguished from "no interventions" and surfaced as degradation instead of swallowed. |
| **How it was closed** | `src/shared/intervention-file.ts` is now the single contract: `interventionFileDocument()` is what the gate persists, and `parseInterventionFile()` is what the observation surface reads, so the two cannot drift into different keys again. The read has three explicit states — `ok` / `missing` / `unreadable` — and `unreadable` is reported as a `store-degradation` failure rather than swallowed as absence. `tests/unit/intervention-store-contract.test.ts` (10 tests) exercises BOTH sides against one file, in both directions: an unresolved pause is collected, a resolved pause is not, a missing file is not a degradation, and an unreadable one is. |
| **Target / revisit phase** | Phase 06 Task B1 |
| **Last reviewed SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` |

## PF-DEBT-006 — `BudgetManager.eligible()` is a predicate that writes to disk

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-006` |
| **Title** | A high-frequency eligibility predicate performs persisted state transitions |
| **Discovered phase** | 06 (during book reconstruction) |
| **Status** | `FIXED` (Phase 06 Task B2) |
| **Severity** | `MEDIUM` |
| **Affected capability** | `runtime` (the budget predicate is consumed by the scheduler and the execution supervisor) |
| **Evidence / source** | `electron/commander/budget-manager.ts:52-56`: `eligible()` called `this.update(...)` when `resetAt` had passed; `update()` writes the whole state list to disk at `:42` when a file is configured. `eligible()` is called per dispatch candidate from the scheduler/supervisor path. |
| **Consequence** | Every eligibility check on an expired reset window rewrites the budget file — a predicate with I/O, called on a hot path. A write failure propagates out of a predicate whose callers treat it as a pure question, and repeated calls produce repeated writes. |
| **Why recorded now** | Located during reconstruction by reading the class end to end. |
| **What would close it** | Expiry evaluation separated from persistence: the predicate stays pure, repeatable and free of I/O errors, while the expiry transition still happens and is still persisted. A test proving repeated predicate calls cause no extra write, and that an expired window is genuinely corrected. |
| **Target / revisit phase** | Phase 06 Task B2 |
| **How it was closed** | `eligible()` is now a pure predicate — no clock-driven transition, no I/O, no throwing. `reconcile(now)` applies every reset window that has passed and RETURNS the released runtime ids, so the transition a dispatch depends on is explicit and observable instead of hidden inside a question. It deliberately does not persist: a clock tick is not an observation, and the durability contract for this store is that observed transitions persist. Callers that need the transition (`ExecutionSupervisor.run`, `MainCommander.synthesizeAccepted`) reconcile once per dispatch before asking. `tests/unit/budget-predicate-purity.test.ts` (8 tests) proves both halves — 50 consecutive predicate calls produce byte-identical and untouched files, and an expired window is still genuinely released, while a verdict with no reset forecast is not. |
| **Last reviewed SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` |

## PF-DEBT-007 — `engineering-loop.json` is constructed at up to three sites

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-007` |
| **Title** | One durable state file is built by several independent construction sites |
| **Discovered phase** | 06 (during book reconstruction) |
| **Status** | `FIXED` (Phase 06 Task A) |
| **Severity** | `MEDIUM` — raised from the originally recorded suspicion: the two documents are mutually destructive, so this is data corruption, not only duplicated authority |
| **Affected capability** | `engineering` / `self-evolution` |
| **Evidence / source** | `electron/commander/main-commander.ts:778` and `:779` built two stores over the same resolved path inside one function; `:871` built a third; `electron/self-evolution/self-evolution-coordinator.ts:434` built one over `layout.journal`. Reading both stores end to end showed the sharper fact: `EngineeringLoopStore`'s reader **requires** an `iterations` array and throws `Invalid engineering loop file` without it (`engineering-loop-store.ts:128`), while `EngineeringRecoveryLedger` writes `{ schemaVersion, events }` (`engineering-recovery.ts:137`). The recovery ledger's own comment already claimed it is *"deliberately separate from the iteration rows: a recovery event must not overwrite the iteration's findings"* — nothing enforced it. `recoveryLedgerFor(file)` compounded this by building a sibling of whatever path it was handed, so passing a directory silently produced a plausible wrong path. |
| **Consequence** | Beyond duplicated authority, the two documents are **mutually destructive**. Writing a recovery event over the loop document leaves a file the loop store can no longer open at all — its reader throws rather than reporting an empty journal — so a run whose journal hits this cannot be inspected or resumed through the loop store. The failure is worse than loud: the loop store spreads what it parsed, so the recovery event survives inside the loop document and the file becomes a silent mixture of two shapes that neither owner knows about. |
| **Why recorded now** | Located during reconstruction by reading both stores end to end. Whether the self-evolution root is genuinely a different namespace had to be **proved** rather than assumed — merging two distinct namespaces would be a worse defect than the duplication. |
| **What would close it** | One resolution point per namespace, used by every caller; the ownership report's owner being the code that actually constructs it; existing Phase 02/03/05 tests still passing; and a documented reason for any site that legitimately resolves a different root. |
| **Target / revisit phase** | Phase 06 Task A |
| **How it was closed** | `electron/engineering/engineering-journal.ts` now owns the layout: `ENGINEERING_JOURNAL_FILES` names the two documents and `engineeringJournalAt(directory)` returns both stores plus the directory it resolved, so a caller cannot pair a loop store from one run with a recovery ledger from another. All three `main-commander` sites and the self-evolution site resolve through it. The path-taking `recoveryLedgerFor(file)` was **removed** — a helper that accepted the wrong kind of path and invented an answer is worse than one that refuses — and its test callers were routed through the resolver. The self-evolution journal was proved to be a genuinely different directory (`layout.journal`) and is kept, now via the shared resolver rather than a hand-derived filename. `tests/unit/engineering-journal-layout.test.ts` reproduces the collision, asserts the loop store throws over the shared file, then asserts both documents stay readable through the resolved paths. |
| **Last reviewed SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` |

## PF-DEBT-008 — `secret-vault.json` is constructed at two sites with differing labelling

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-008` |
| **Title** | The machine-identity vault file has two construction sites |
| **Discovered phase** | 06 (during book reconstruction) |
| **Status** | `FIXED` (Phase 06 Task A) |
| **Severity** | `MEDIUM` |
| **Affected capability** | `security` / `github-machine-identity` |
| **Evidence / source** | `electron/github/bootstrap.ts:39` constructs `SecretVaultStore` over `path.join(root, "secret-vault.json")`; `electron/github/github-machine-runtime.ts:47` constructs it over the same file name while passing a vault label (`"machine-identity"`). |
| **Consequence** | Same namespace-shape risk as `PF-DEBT-007`, in the security surface: two places decide what the vault's file and label are, so a label or root change in one silently disagrees with the other. |
| **Why recorded now** | Located during reconstruction. Security-adjacent, so any consolidation must be behaviour-preserving and covered by the existing tests before and after. |
| **What would close it** | A single resolver for the vault's path and label, used by both callers, with the existing security tests passing unchanged. |
| **How it was closed** | `electron/github/machine-identity-layout.ts` declares the three files (`github-machine-identity.json`, `secret-vault.json`, `node-machine-identity.json`) and the vault label, and `githubMachineIdentityAt(bossDirectory)` resolves them together. Both construction sites use it — the Root Owner credential ceremony that WRITES the private key and the production runtime that READS it — so the file name and the label are one declaration instead of two coincidences. `tests/unit/machine-identity-layout.test.ts` asserts the vault document is distinct from the non-secret config, that writer and reader resolve the same file and label, and that a differently-spelled root normalises to the same path. |
| **Target / revisit phase** | Phase 06 Task A |
| **Last reviewed SHA** | `14fd222aba782f97ec40662b04fc19f391f2653d` |

## PF-DEBT-009 — the engineering audit cannot tell an environment failure from a code finding

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-009` |
| **Title** | A toolchain/environment failure is reported as an unscopable HIGH code finding |
| **Discovered phase** | 06 (Task D — the dogfooding harness, on its first real run) |
| **Status** | `FIXED` (Phase 06 Task D follow-up) |
| **Severity** | `HIGH` |
| **Affected capability** | `engineering` (the audit → triage → scope path) |
| **Evidence / source** | Established by running the dogfooding harness against a linked worktree that had no `node_modules`. `runAllowedCommand` invokes the workspace's own compilers by absolute path (`node_modules/typescript/bin/tsc`, `node_modules/vitest/vitest.mjs` — `command-runner.ts:61-64`), so with no toolchain both commands exit 1. `commandFinding` (`repo-engineering-operations.ts:46-56`) maps that to `{ id: "command:typecheck", area: "build", severity: "HIGH" }`, and `candidateFilesForFinding` (`finding-scope.ts:62-80`) finds no candidate because the diagnostic names `node_modules/typescript/bin/tsc` — a path with **no file extension**, which `CODE_PATH_TOKEN` (`finding-scope.ts:18-19`) does not match. The loop then aborts with *"scope inference found no candidate file for finding command:typecheck (build); aborting bounded patch"*, recorded in `artifacts/platform-foundation/phase-06/dogfood-run-1.json`. |
| **Consequence** | A missing toolchain, an uninstalled dependency or any other environment fault is presented as a HIGH-severity code finding with no scope. A reader cannot tell "the compiler is not installed" from "the code does not compile", and the loop consumes its iteration budget aborting on a problem no code change can fix. The finding's own description would have distinguished them — it carries the compiler's message — but the abort reason does not, and nothing in the pipeline classifies it. |
| **Why it matters beyond this harness** | Any workspace whose toolchain is incomplete — a fresh clone, a CI container before install, a user's first run — produces this shape. It is the platform's first impression of an unbuildable tree. |
| **What would close it** | The audit distinguishing an environment/toolchain fault from a code diagnostic and reporting it as such (its own finding kind, or an explicit non-implementable classification) instead of a HIGH code finding; the abort reason naming that classification rather than "no candidate file"; and a test proving both directions — an environment fault is classified as environment, and a genuine compiler diagnostic still yields a scoped code finding. |
| **Target / revisit phase** | Phase 06 (Task D follow-up) |
| **How it was fixed** | `EngineeringFinding` gained an optional `kind: "code" \| "environment"` (absent means code, so every existing producer is unchanged) plus `isEnvironmentFinding()`. `commandFinding` now keys off the runner's own signal — `runAllowedCommand` reports a missing tool with `exitCode: null` and a "Required local tool unavailable" message — and produces `environment:<command>` with `area: "environment"`, a description that says the command could not run and why, and evidence stating that no source change can clear it. `createLiveEngineeringOperations.implement` refuses an environment finding with *"is an environment fault, not a code defect … the workspace must be made buildable first"* instead of running scope inference and reporting "no candidate file". `tests/unit/audit-environment-finding.test.ts` proves **both** directions: a workspace with no `node_modules` yields environment findings and an implement refusal that does not mention candidate files, and a workspace that has a compiler and a genuine type error still yields a scoped `command:typecheck` code finding naming the offending file. The path-escape case is classified as environment too, with its own wording, because the runner already distinguishes "the tool is missing" from "the tool resolved outside the workspace" and the two need different remedies. |
| **Last reviewed SHA** | `02943b0de912be52dbe6513b721e1722df1407bf` |

## PF-DEBT-010 — the engineering loop is a REPAIR loop, so it cannot run a new-goal objective

| Field | Info |
| --- | --- |
| **ID** | `PF-DEBT-010` |
| **Title** | A new-goal objective is driven through repair semantics, so the loop targets pre-existing failures it was never asked to fix |
| **Discovered phase** | 06 (Task D — observed on a real run) |
| **Status** | `FIXED` (Phase 06 Task D follow-up) |
| **Severity** | `HIGH` |
| **Affected capability** | `engineering` (and `self-evolution`, which consumes the same driver) |
| **Evidence / source** | `engineering-loop-driver.ts:114-144`: every round begins with `audit(goal)`, and `target` is the first non-out-of-contract finding of HIGH-or-significant severity — **the goal's objective is never consulted to decide whether a finding is in scope for it**. On a real dogfooding run against an objective that asked for a new test file, the audit reported `command:test` (the `PF-DEBT-003` AppContainer suite, environment-blocked on this host), that pre-existing failure became the round's target, and the loop aborted. Recorded in `artifacts/platform-foundation/phase-06/dogfood-run-3.json`. `audit()` also runs the full suite every iteration — **489 503 ms** for that one finding (`repo-engineering-operations.ts:74-83`). |
| **Why this is an architecture issue and not a defect to patch** | The driver is correct for what it was built for: **repair**. Its two production callers are `main-commander.ts:821` (the autonomous engineering goal, whose documented purpose is converging a repo to a clean audit) and `self-evolution-coordinator.ts:453` (which repairs the platform itself). In both, "the audit found a failure ⇒ fix it" is exactly the intended semantics, and changing it would silently alter self-evolution behaviour. What is missing is a DIFFERENT loop: one that treats the audit as a **precondition** (is this workspace in a known-good state?) and then works the goal's objective, targeting only findings attributable to the change it made. Two different jobs are being asked of one driver. |
| **Consequence** | A dogfooding run cannot exercise the platform's real engineering path on any host or workspace that has a pre-existing failing suite — which is every real repository at some point. The run measures the environment's existing faults instead of the goal, and burns a full-suite audit per iteration doing it. |
| **What would close it** | Either a goal-driven loop alongside the repair loop (audit as a precondition and a post-change attributable-delta, objective worked directly), or an explicit, measured baseline-difference mode on the existing driver — with the pre-existing set derived from a measured baseline run and never from a hand-maintained skip list. Phase 01's impact selector already exists for the cost half and is not used here. |
| **Explicitly forbidden** | Deleting, skipping or relaxing `evolution-sandbox` to make an audit green. `PF-DEBT-003` forbids exactly that, and this entry must not become the reason it happens. A baseline difference must be measured, not declared. |
| **Target / revisit phase** | Phase 06 (Task D follow-up) — **this was the largest single item between Phase 06 and PASS** |
| **How it was resolved** | Not by patching the repair loop — that would have silently changed self-evolution. `electron/engineering/engineering-goal-loop.ts` adds the second loop the phase needed, and the split is the design: the audit is a **precondition** (an environment finding refuses the run up front, by name) and a **record** (pre-existing CODE findings are carried in the result and never worked); the **objective** is the work list; convergence requires the host's checks to pass over a NON-EMPTY change set. The dogfooding harness now uses it. Two platform refinements came out of making it runnable, both default-closed: `applyScopedChanges` gained an opt-in `options.mayCreate` predicate consulted only for a file that does not exist (narrower than authorising a directory, which would also permit overwriting it), and `createGoalLoopOperations` distinguishes a file allowance from a directory/prefix allowance — including tolerating `"tests/unit"` without a trailing slash, which had been read as a file allowance and made every creation fail. `tests/unit/engineering-goal-loop.test.ts` (11 tests) covers the semantics and `tests/unit/root-authority-red-team.test.ts` still refuses an unauthorised path. |
| **Evidence the resolution produced** | Six real dogfood runs, each blocked by a genuine platform decision rather than a harness bug: the audit found a pre-existing failure and the goal loop recorded it instead of chasing it; the tree was refused as Boss-itself until it became a clone without an origin remote; the coder proposed a file and the host refused it as out of scope until a creation grant existed; then the grant was mis-specified by the caller; then the manifest's `expectedSha256` was format-checked by a rule stricter than the applier's own check, so a formatting slip in a field the applier recomputes ended the run and burned the automatic retry. The SIXTH run reached `CONVERGED`: one file applied, typecheck + test + `git diff` all passed, the pre-existing failure recorded and not worked, `checkoutUntouched=true`, 1 930 provider-reported input tokens, and the produced test verified to pass when run independently of the platform. |
| **Last reviewed SHA** | `c192d0d14362bacf49f88a90f7a4d4d421c024d8` |

## PF-DEBT-011 — the host verifies that a check passes, not that it asserts anything

| Field | Info |
| --- | --- |
| **ID** | `PF-DEBT-011` |
| **Title** | A vacuously-passing test satisfies the host's verification |
| **Discovered phase** | 06 (Task D — the first CONVERGED dogfood run) |
| **Status** | `FIXED` |
| **Severity** | `LOW` — a boundary to state, not a defect to fix |
| **Affected capability** | `engineering` (verification) |
| **Evidence / source** | The converged run's objective asked for a round-trip test **and** a malformed-entry test. The platform produced `tests/unit/intervention-file-properties.test.ts` (1 019 bytes, 2 cases, verified to pass when run independently), and the host's checks — typecheck, the test command and `git diff` — all passed. One of the two cases round-trips an **empty** array, which is weaker evidence than the objective described. |
| **Why this is a note rather than a defect** | The host cannot judge whether an assertion is meaningful, and it should not pretend to: it runs the allowlisted commands and reports their outcome. That is the correct division of labour — `MANDATORY_GATE_STAGES` establishes completion eligibility, and judging the *quality* of a test is what an independent reader is for. The alternative (a heuristic that rejects "weak-looking" tests) would be a false-confidence machine. |
| **Consequence, stated plainly** | "The host's checks passed" means the change compiles, the suite is green and the diff is clean. It does NOT mean the change does what the objective asked. A reader of a `CONVERGED` result must not inflate it into a quality claim, and Phase 06's own evidence is worded accordingly. |
| **How it was resolved** | Phase 07 built the semantic acceptance path rather than leaving the boundary as a note. `src/shared/acceptance.ts` states the contract — `Objective → AcceptanceClaims[] → EvidenceObligations[] → ObservedEvidence[] → SatisfactionResult` — and `src/shared/assertion-shape.ts` reads what a test actually exercises from its source, deterministically, with no model in the loop. `electron/engineering/goal-acceptance.ts` is the **production** judgement `createGoalLoopOperations` defaults to, and `CONVERGED` now requires it: a green run over a vacuous test reports `OBJECTIVE_INSUFFICIENT_EVIDENCE`. The proxies the book forbids (`tests > 0`, `assertions > 0`, coverage, file exists, `exit 0`) are recorded as `weakSignals` and are structurally incapable of satisfying an obligation. |
| **Evidence the resolution produced** | Four counterexamples run through the real pipeline (`scripts/dogfood-engineering.cjs`: real clone, real host checks, real scope guard, real acceptance model; only the proposal scripted, so each is reproducible on demand). **A** vacuous green → `OBJECTIVE_INSUFFICIENT_EVIDENCE` with typecheck/test/diff all PASS. **B** meaningful → `CONVERGED`, acceptance `SATISFIED`, from a real `deepseek-flash` run (2 calls, 1 922 provider-reported input tokens, `checkoutUntouched: true`). **C** contradiction → `NOT_CONVERGED`, because the host's verification fails before acceptance is consulted; `CONTRADICTED` itself is exercised at the model level where a discriminating observation carries `passed: false`. **D** a real source-only change, typechecking with the suite green → `INSUFFICIENT_EVIDENCE`, weak signal *"the change modified 1 file(s), none of them a test"*. Records: `artifacts/platform-foundation/phase-07/case-*.json`. |
| **Not closed by a single direction** | The reader was wrong SIX times: four confident false positives that would have accepted the vacuous case, and then two false negatives that refused genuinely meaningful ones (`assertion-shape.ts` documents all six). A reader that refuses everything is the same defect pointing the other way — it fails real work instead of the fake version of it — which is why case B is load-bearing and not merely a sanity check. |
| **What would close it** | As originally stated: a downstream quality gate that reads the change against the objective. Phase 07 delivered one that is deterministic and fail-closed rather than an Agent stage — deliberately, because Phase 05 adjudicated the optional review stage `COST_ONLY` and defaulting a reviewer in would reopen a settled economics decision. Closing it this way is strictly stronger than the entry anticipated: the judgement is on the production path, not an optional extra. |
| **Target / revisit phase** | **Phase 07** (`platform-foundation/07-semantic-acceptance`) — **closed**. |
| **Last reviewed SHA** | `2c6a6da7bf79` (head at the first complete run of all four cases; the records are the authority for each verdict). |



## PF-DEBT-012 — the evolution prestart attestation is absent on this workstation

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-012` |
| **Title** | `verify:certificate` reports `INVALID_CERTIFICATE` because the prestart attestation is not on this machine |
| **Discovered phase** | 07 (observed while running the inherited gate list; recorded in Phase 08) |
| **Status** | `EVIDENCE-TIER NOTE` |
| **Severity** | `LOW` — a provenance statement that must stay accurate, not a defect |
| **Affected capability** | `promotion` (attestation provenance) and `experience` (acceptance artifacts) |
| **Evidence / source** | `pnpm run verify:certificate` → `verdict INVALID_CERTIFICATE`, with `note certificate schema: D:\Codex-Boss\artifacts\acceptance\prestart-attestation.json is missing or not a JSON object (ENOENT)`. Every section then reads `NOT_CHECKED (no certificate was readable)`. Reproduced in Phase 07 (`docs/9-16-platform-foundation-phase-07-status.md` §8) and again in Phase 08. |
| **What this file is** | The **evolution / bootstrap prestart** attestation. It is written by `scripts/acceptance-prestart.cjs` (`PRESTART_ATTESTATION = "prestart-attestation.json"`, written under `artifacts/acceptance/`) and consumed as Validator B input by `scripts/acceptance-evolution-certificate.cjs`. `README.md` names it, together with the CI run that produced it, as the authority for the `PRESTART_CERTIFIED` / `BOOTSTRAP_COMPLETE` claim, and `docs/prestart-completion.md` records that it is produced by `pnpm run acceptance:prestart` **inside a successful CI run** on branch `Prestart-checkpoint-3`. |
| **What it is NOT** | It is **not** the Platform Foundation platform certificate. That one is `scripts/platform-certificate.cjs` → `artifacts/platform-foundation/phase-05/platform-certificate.json`, and at Phase 07's head it reports **17/17 invariants held, `phaseStatus=COMPLETE`, `notRun=[]`, 229 suites, 0 unowned source files**. The two certificates are different artifacts, from different generators, for different claims; conflating them is the error this entry exists to prevent. Phase 05, 06 and 07 each recorded their acceptance against the **platform** certificate, never `verify:certificate`. |
| **Lifecycle investigation** | `grep` over `electron/` and `src/` for `prestart-attestation` / `acceptance:prestart` returns **no matches**: no production module reads or writes it. The only producers are `scripts/acceptance-prestart.cjs` (the graduation command) and the CI workflow that invokes it; the only consumers are the evolution certificate validator and the acceptance tests that construct their own fixture (`tests/acceptance/autonomous-evolution-independent.test.ts`). It is therefore **not** owed by the normal production startup path. |
| **Why it is absent here** | This workstation has never run the evolution/bootstrap **graduation ceremony** (`acceptance:prestart`) — it was run in CI on the `Prestart-checkpoint-3` branch, and the artifact lives with that CI run (artifact id `10298755851`). Its absence is the correct state of a machine that has not performed that ceremony, not a production-path omission. |
| **Why it is not upgraded to a defect** | The test for upgrading is whether the production path *claims* the file should exist and then fails to generate it. It does not claim that anywhere: no startup code touches it, `README.md` attributes it to a CI run, and `docs/prestart-completion.md` states it is a ceremony product. The production path's own certificate is complete. Faking the artifact to make `verify:certificate` green is explicitly refused — that would manufacture a graduation record for a ceremony that did not run, which is worse than a red check. |
| **Consequence, stated plainly** | `verify:certificate` cannot pass on a workstation that has not run the prestart ceremony, and its `INVALID_CERTIFICATE` must not be read as "the Foundation failed verification" nor as "the platform certificate is missing". A reader comparing gate results should expect this check to be `NOT_CHECKED`/`INVALID` off-CI, and should read the platform certificate for the platform claim. |
| **What would close it** | Nothing in code. It closes as a **provenance statement** when either (a) the reader is told which certificate a gate refers to — already true in the Phase 05/06/07 status records and here — or (b) a machine runs `pnpm run acceptance:prestart` and the artifact is written, which is a ceremony, not a fix. If a future phase makes `verify:certificate` a **required** gate for a promotion decision, this entry must be re-triaged first, because a required gate that is structurally un-passable off-CI is a real defect at that point. |
| **Target / revisit phase** | Phase 08 (promotion gate) — recorded; re-triage only if promotion is ever made to depend on `verify:certificate`. |
| **Last reviewed SHA** | `c1752459ab762f16ef4d35a5bfa765b1e7a500a0` |

## PF-DEBT-013 — the production engineering path cannot qualify a non-TypeScript repository

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-013` |
| **Title** | External qualification fails closed at `audit` for any repository without a TypeScript toolchain |
| **Discovered phase** | 08 (first real external qualification runs) |
| **Status** | `ARCHITECTURE ISSUE` |
| **Severity** | `HIGH` — the platform's stated purpose ("usable on real external code projects") is false in practice for any repository that is not TypeScript/JavaScript |
| **Affected capability** | `engineering` (audit + mandatory verification) |
| **Evidence / source** | Two real external qualification runs, records in `artifacts/platform-foundation/phase-08/qualify-quant-ultra.json` and `qualify-drug-simulator.json`. Both return `state: PRECONDITION_FAILED`, `attempts: 0`, `changedFiles: []`, **`calls: 0`** (the provider was never asked anything), `verification: null`, `acceptanceVerdict: null`. The single audit finding is `environment:typecheck` — *"the typecheck command could not run: the workspace is missing the tool this command runs — Error: Required local tool unavailable: node_modules/typescript/bin/tsc"*. `Quant-ultra` is a 231-file, 154-`.py` real project with no `package.json`, `tsconfig.json`, `node_modules`, or Python manifest; `drug-simulator` is a 2-file design document. |
| **Why this is structural, not a bug** | The TypeScript specificity is deliberate and correct for the codebases the Foundation was built against: `electron/engineering/verification-policy.ts` emits `syntax` only for `/\.[cm]?js$/` files and `typecheck` only when a `tsconfig.json` exists; `electron/engineering/command-runner.ts` resolves the toolchain by absolute path (`node_modules/typescript/bin/tsc`, `node_modules/vitest/vitest.mjs`) and reports a **recorded environment failure** rather than passing silently; `electron/engineering/repo-engineering-operations.ts` classifies that as `kind: "environment"` and the goal loop refuses the run as `PRECONDITION_FAILED` — which is `PF-DEBT-009`'s fix working exactly as designed. Nothing here is wrong. What is wrong is the **claim** that follows from it: a platform that refuses every non-TS repository before it proposes anything has not qualified for "real external code projects" in general. |
| **Explicitly NOT done in Phase 08** | No language adapter, no `pytest`/`python` check, no relaxation of the toolchain resolution to accommodate an external repository. Phase 08 §5 forbids inventing multi-language support ahead of evidence, and widening the mandatory verification to make an external repo pass would weaken a Phase 04–07 safety condition — the exact move the whole Foundation chain exists to refuse. The refusal is preserved as the qualification result. |
| **Second consequence, recorded because it is easy to miss** | Because the run never reaches the acceptance operation, **Phase 07's semantic acceptance layer was not exercised by any external repository.** `PF-DEBT-011`'s closure rests on the Boss/Vitest workload plus the real-provider case B, not on external evidence. That is a real limit on the generality claim and must not be described otherwise. |
| **The over-fitting question, answered by measurement rather than assumption** | The reader *was* pointed at the external repository directly (`scripts/qualify-assertion-reader.cjs` → `artifacts/platform-foundation/phase-08/assertion-reader-generalisation.json`): **154 Python files scanned, 0 with any readable assertion site, 0 judged discriminating** — it fails closed, as Phase 08 §5 requires. Two independent layers produce that: `ASSERTION_CALL` requires a call (`assert(`, `expect(`) and Python's assertion is the `assert x == y` statement; and `judgeGoalAcceptance`'s `TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/` excludes `.py` names entirely, so a Python test file never reaches the reader. Both are pinned by permanent tests. **No generalisation fix was made**, because the real exposure proved no *incorrect acceptance* — only an inability to read, which is the designed fail-closed boundary. |
| **What would close it** | A **declared capability adapter** per language/toolchain that (a) states which command satisfies `test`/`typecheck`, (b) states which syntax the assertion reader understands for that language, and (c) **fails closed** when it cannot read the input. That is a design exercise with its own phase, not a patch; it must be driven by a repository that actually needs it rather than by speculation about languages in general. |
| **Target / revisit phase** | A future phase, if the Owner wants external-language support. It is **not** required to close Phase 08, and Phase 08 must not treat it as in-scope. |
| **Last reviewed SHA** | `c1752459ab762f16ef4d35a5bfa765b1e7a500a0` |

## PF-DEBT-014 — the assertion reader did not recognise the Node `assert.<method>` dialect

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-014` |
| **Title** | The Phase 07 acceptance reader recognised no assertion in a repository that uses Node's built-in `assert` |
| **Discovered phase** | 08 (external qualification, second repository pair) |
| **Status** | `FIXED` |
| **Severity** | `HIGH` — every change to such a repository was judged `INSUFFICIENT_EVIDENCE` regardless of the quality of its evidence |
| **Affected capability** | `engineering` (semantic acceptance) |
| **Evidence / source** | `scripts/measure-assertion-dialect.cjs` → `artifacts/platform-foundation/phase-08/dialect-dsh-health-scheduler.json` and `dialect-dsh-restart.json`. Two real Owner repositories contain **0** `expect(` calls and 1 057 `assert.<method>(` calls between them (`equal`, `ok`, `deepEqual`, `match`, `throws`, `rejects`, `notEqual`). Before the fix the reader reported **0 assertion sites readable, 0 discriminating** in both. After: **511** and **546** readable sites. |
| **Why it happened** | The reader's entry-point pattern was `/\b(expect\|assert\|expectTypeOf)\s*\(/` — the identifier followed IMMEDIATELY by a parenthesis. A namespaced library puts a method in between, so `assert.equal(a, b)` could never match, and neither could the branch written to handle it. The first attempt at the fix therefore changed nothing at all and looked like a broken fix rather than an unrun one; it was caught only by probing the regex in isolation (`assert.equal(a, b)` against `assert\s*\(` → NO MATCH). |
| **The fix, and its exact size** | The entry point became the IDENTIFIER (`/\b(expect\|expectTypeOf\|assert)\b/`), after which the form is decided by what follows: `<namespace>.<method>(…)` is a complete assertion whose arguments are the operands, otherwise `identifier(` must follow or the hit is not a call. `assert.equal(result, input)` gets the SAME echo and reference reasoning as `expect(result).toEqual(input)` — the dialect must not change the verdict, which is asserted. `assertionDiscriminates` now strips the `assert.` namespace before consulting `NON_DISCRIMINATING_ASSERTIONS`, and `ok`/`notOk` were added to that list because they are Node's spellings of `toBeTruthy`/`not.toBeTruthy`. **This last step mattered**: with a variable operand, `assert.ok(result)` was reaching the operand reasoning and coming out **discriminating** — a false POSITIVE that would have counted `assert.ok(x)` as evidence. |
| **Scope discipline** | This is the minimal generalisation the real exposure proved, as `Phase-08-Production-Qualification-and-Promotion.md` §5 requires. No parser was built, no other language was claimed, and the fail-closed behaviour for non-TS syntax is unchanged and still tested. |
| **Pinned by** | Three permanent tests in `tests/unit/platform/acceptance.test.ts`: the `assert.<method>` dialect yields the same verdict as its Vitest spelling; `assert.ok` is refused **by name**; and `assert` used as an import, a parameter or a reference produces **no** assertion site (the guard on widening the entry point). |
| **What it does not fix** | ~99% of the readable sites in both repositories are still judged non-discriminating, and the reader says why: *"ties the result to its input, but no non-empty value reaches the assertion"* and *"has an operand that could not be read"*. These suites assert against state built by helper factories (`tests/helpers/rig.js`), which a lexical reader cannot trace to a fixture. That is an honest fail-closed limit, not a defect to patch: the correct answer for a change whose evidence cannot be traced is `INSUFFICIENT_EVIDENCE`. |
| **Target / revisit phase** | Phase 08 (external qualification). Re-open only if a real external change with genuinely self-contained evidence is refused. |
| **Last reviewed SHA** | `a9f788a29d2d042062a6d70f31f3e673924e610f` |

## PF-DEBT-016 — the real-host qualification cannot be transported while the repository is public

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-016` |
| **Title** | Phase B2/B3: a self-hosted qualification runner cannot be attached to this repository, because it is PUBLIC |
| **Discovered phase** | Stabilization Phase 01 (Root Trust Authority Lockdown / Real Host Qualification, Part B) |
| **Status** | `FIXED` — transport resolved by an independent PRIVATE control plane (Owner decision 1, OPTION 2). See the resolution note below. |
| **Severity** | `HIGH` for the qualification goal (the platform cannot be qualified while it stands), `NONE` for the product — nothing is bypassed and nothing is faked |
| **Affected capability** | `runtime` (platform qualification) |
| **Evidence / source** | `node scripts/verify-authority-separation.cjs --platform`: `visibility=public`, and the verdict `selfHostedRunnerSafe: false` with findings `PUBLIC_REPOSITORY_CANNOT_HOST_A_SELF_HOSTED_RUNNER` and `REQUIRED_CHECK_NOT_PRODUCED:validate`. Measured corpus on the real host: **71 380 files / 550.0 MiB** (`.codex-boss` 7, `artifacts` 69 165, `runtime-data` 2 118, `history` 90), commitment digest `e2eaba810e659f90dfb120a766260ed0fd4ea721168bcf907d2dbbc3d865c29c`; a GitHub-hosted runner sees a handful of files against the Phase 04 invariant of over 1000. |
| **Why it is blocked rather than deferred** | A self-hosted runner is registered for the WHOLE repository, and no workflow-level guard can bind it to a single workflow. On a public repository, untrusted workflow files can name its labels, which is exactly what Phase B3 forbids ("禁止不受信任代码自动落到此 runner"). With 0 forks and one collaborator the risk today is small; "small" is not the Owner's threshold, and attaching a runner that processes real host data is not a thing to do quietly to keep a task moving. |
| **What is already built and refusing** | The real-host lane exists (`runs-on: [self-hosted, windows, boss-real-soak, boss-qualification]`), fails closed on the wrong ref, the wrong runner class and a HEAD that is not `origin/main`, measures corpus quiescence either side of the Phase 04 gate, uploads only a REDACTED aggregate from `${{ runner.temp }}`, and now runs `--platform --require-self-hosted-safe` as its FIRST step — so it refuses to start on an unsafe platform and would flip by itself if the repository became private. `tests/unit/root-trust-authority-lockdown.test.ts` asserts all of that. |
| **What would close it** | An Owner decision on transport: (1) make the repository private; (2) host the runner in a separate PRIVATE repository that checks this one out read-only; (3) keep qualification as an Owner-run local procedure, which — per the prohibition on substituting local runs for formal workflow attestation — may NOT be presented as `BOSS_PLATFORM_QUALIFIED` evidence. |
| **Pinned by** | The `--platform` guard step in `.github/workflows/platform-qualification.yml`, the four lane guards and the platform verdict assertions in `tests/unit/root-trust-authority-lockdown.test.ts`, and `--platform --require-self-hosted-safe` exiting 1 on a public repository (verified locally with and without `gh` on PATH). |
| **Resolution (Owner decision 1, OPTION 2)** | The public repository stays PUBLIC and holds **no runner** (`Codex-Boss/actions/runners` → 0). The runner is registered to the independent **private** repository `zhiheng-zhang-Mera/Boss-Qualification-Control` (→ 1, `boss-real-soak`, online, labels `self-hosted, Windows, X64, boss-real-soak, boss-qualification`), and the agent's own `.runner` file names that repository — the fact `verify-control-plane.ps1` refuses to proceed without. The qualification workflow lives there, is `workflow_dispatch`-only and main-only, resolves the candidate as a 40-hex SHA that must equal the public `origin/main`, checks it out **detached**, snapshots the real corpus read-only into the workspace, and runs the whole chain. Run [35422731193](https://github.com/zhiheng-zhang-Mera/Boss-Qualification-Control/actions/runs/35422731193) qualified public commit `506e4a9631f0d3d411b77aa4a6e98ef665b0bfa0` with **21 of 21 stages green and none skipped**. |
| **One deviation, recorded** | The run authorisation is repository WRITE ACCESS on the private control repo, not a required-reviewer environment: creating that protection rule on a PRIVATE repository is refused by the Owner's plan (*"Failed to create the environment protection rule. Please ensure the billing plan supports the required reviewers protection rule."*, HTTP 422), and an environment with no protection rule would be a gate that only looks like one. The epoch authorisation keeps its real protected environment in the public repository, where the rule works. Closing the deviation needs a plan that supports environment protection on private repositories. |
| **Last reviewed SHA** | `e4ca3e39593289288b610e27f7c6f235d1b252a7` |

## PF-DEBT-017 — the Phase 05 soak gate's short-run premise depends on runner state

| Field | Value |
| --- | --- |
| **ID** | `PF-DEBT-017` |
| **Title** | `platform-soak-report.test.ts` requires a short soak's trend to EXCEED the long-run allowance, which is a property of the machine rather than of the gate |
| **Discovered phase** | Stabilization Phase 01 (CI work, promoted-main verification) |
| **Status** | `DEFERRED_PENDING_REAL_HOST_EVIDENCE` — Owner decision 3: do not touch the frozen Phase 05 gate, do not advance an epoch for it, and do not bundle it with the qualification work. The complete record is kept. |
| **Severity** | `MEDIUM` — a flaky frozen gate turns `main` red for no real reason, and a red build hides every other signal |
| **Affected capability** | `runtime` (Phase 05 gate 6) |
| **Evidence / source** | `Desktop CI` run 35417327632 (`main`, `test:postbuild`) failed with `AssertionError: expected true to be false` at `tests/acceptance/platform-soak-report.test.ts:111` — `report.bounds.trendWithinLongRunAllowance` expected `false`, observed `true`. The SAME commit was green in run 35415974897 minutes earlier, and green again on re-run (35417327632 → success). Not caused by the CI restructuring, which was green on that commit. |
| **Why it happens** | The test asserts the generator REFUSES to certify a short run, on the stated premise that "a short run is all warmup, so its trend genuinely exceeds the published allowance". That premise is a measurement of the host: on a quieter or faster runner the sampled RSS/heap trend can land inside the allowance, at which point the gate's refusal path is never exercised and the assertion fails although the generator behaved correctly. |
| **Why it is not fixed here** | `tests/acceptance/**` is Root Trust Surface (`PLAN_SECTION_3_ROOT_TRUST_PATHS`), so any change to it is a Class 2/3 change requiring Owner authorisation and an epoch migration. Changing a frozen Phase 05 gate to chase a green run is precisely what the lockdown forbids doing unilaterally. |
| **What would close it** | An Owner choice among: (a) make the premise GUARANTEED rather than observed (run long enough, or induce a measurable load) so the refusal path is always exercised; (b) assert the refusal against a synthetic over-allowance input while keeping a separate, non-flaky assertion that the real measurement path runs; (c) an explicit bounded retry with the flake recorded. (a) and (b) are gate-design changes and must go through the Owner-authorised path in `docs/root-trust-authority-model.md` §4. |
| **Last reviewed SHA** | `e4ca3e39593289288b610e27f7c6f235d1b252a7` |

## Review log

| Reviewed at SHA | Phase | Entries added | Entries closed |
| --- | --- | --- | --- |
| `14fd222aba782f97ec40662b04fc19f391f2653d` | 06 (reconstruction) | `PF-DEBT-001` … `PF-DEBT-008` | none |
| Phase 06 Task B batch 1 | 06 (construction) | `PF-DEBT-005`, `PF-DEBT-006` | `PF-DEBT-005` (B1), `PF-DEBT-006` (B2) |
| Phase 06 Task A batch 2 | 06 (construction) | none | `PF-DEBT-007` (journal layout owner), `PF-DEBT-008` (machine-identity layout owner) |
| Phase 06 Task C batch 3 | 06 (construction) | none | `PF-DEBT-001` (`experience` authoritative suite), `PF-DEBT-002` (`remote` authoritative suite) — capability coverage now **27 of 27** |
| Phase 06 Task D batch 4 | 06 (construction) | `PF-DEBT-009` (environment failure misreported as a code finding), `PF-DEBT-010` (audit cost + aborts on pre-existing failures) | none — D's harness is delivered, its findings are recorded, and neither is fixed yet |
| Phase 06 Task D follow-up batch 5 | 06 (construction) | none | `PF-DEBT-009` (environment findings classified as environment, both directions tested). `PF-DEBT-010` re-classified from `OPEN` to `ARCHITECTURE ISSUE`: the driver is a REPAIR loop and a new-goal objective needs a different one, which cannot be patched without changing self-evolution semantics |
| Phase 06 Task D batch 6 | 06 (construction) | `PF-DEBT-011` (a vacuously-passing test satisfies the host) | `PF-DEBT-010` (resolved by adding the goal-driven loop, not by patching the repair loop). A dogfood run reached `CONVERGED` |
| Phase 07 final | 07 (semantic acceptance) | none | `PF-DEBT-011` — closed by the semantic acceptance path being production, with all four counterexamples run through the real pipeline. `PF-DEBT-003` re-confirmed `ENVIRONMENT-BLOCKED` without lowering the AppContainer requirement; `PF-DEBT-004` remains an evidence-tier note |
| Phase 08 qualification | 08 (production qualification) | `PF-DEBT-012` (the evolution prestart attestation is absent on this workstation — the two certificates are different artifacts), `PF-DEBT-013` (the production path cannot qualify a non-TypeScript repository; fail-closed at `audit`, provider never called), `PF-DEBT-014` (the reader recognised **no** assertion in a Node-`assert` repository; fixed, and the fix exposed that `assert.ok(x)` had been coming out discriminating) | none. `PF-DEBT-003` re-checked: the AppContainer prerequisite is now **present** on this host (`WindowsAppContainerSandbox.probe()` → `available: true`, `containerSid S-1-15-2-…`, job object, network denied), so its `ENVIRONMENT-BLOCKED` wording is stale and is re-stated in the entry rather than silently left claiming a blocker that no longer applies. `PF-DEBT-011` unchanged (`FIXED`, but on Boss/Vitest + real-provider evidence only — see `PF-DEBT-013`) |
| Phase 08 TS qualification | 08 (production qualification, second pair) | none | `PF-DEBT-014` — fixed after two real Owner TS repositories exposed it; `PF-DEBT-013` re-classified from "the Foundation is universally broken" to a **known language-scope limitation**, per the Owner's instruction that the TS workload be qualified on its own terms first |

**How to update an entry.** Change its `Status`, append the closing commit to `What would close it`, and
add a row to the review log. Do not delete an entry when it closes — set `FIXED` and keep the record, so a
later reader can see that the problem was known and what resolved it.
