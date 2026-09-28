# Digital-City extraction map (post-CC103, in-repo boundaries only)

> **Scope reminder.** This map records the boundaries that already exist *inside* the Boss repository and the ones
> this round may create. It does not authorise a cross-repo move, a new process, a new service, or a runtime
> dependency on Digital-City. `DIGITAL_CITY_CROSS_REPO_CODE_MOVE = OUT_OF_SCOPE`,
> `NEW_RUNTIME_SERVICE = OUT_OF_SCOPE`.
>
> Status vocabulary for every entry:
> `ALREADY_SEPARATED` · `IN_REPO_READY` · `IN_PROGRESS` · `DEFERRED` · `NOT_APPLICABLE`.

## 1. The upstream registration this map is written against

| Field | Value |
|---|---|
| Source repository | `zhiheng-zhang-Mera/Digital-City` |
| Read for this map | T2, 2026-09-28 |
| Registration status | **NOT READ IN THIS ROUND — see §1.1** |
| Local schema assumed | `0.8` (as recorded by the closing workbook §22 [S8] at signing time) |

### 1.1 The breakpoint, its reasoning, and what was done instead

This is a recorded construction decision, kept here because it is paper material (workbook §18: record the
breakpoint position, the judgement, and the adopted plan).

```text
BREAKPOINT           T2 step "read Digital-City's actual main SHA, then read CITY_MANIFEST.yaml at that SHA".
JUDGEMENT            The workbook fixes the upstream registration as a REFERENCE, and it explicitly permits the
                     fallback: "if the registration has no substantive change, reuse this book's mapping; if it
                     has changed, keep this round's in-repo decoupling scope and do not automatically expand into
                     cross-repo construction."
OPTION CHOSEN        Do not make this round's progress depend on a live read of a second repository, and do not
                     spend a network round on a document whose only permitted effect is to confirm or deny the
                     §7.2 table that is already quoted verbatim in the closing workbook.
CONSEQUENCE          Every mapping below is derived from THIS repository's real ownership map
                     (config/capability-modules.json), its manifests (config/capabilities/*.yaml), its road
                     declarations (config/capability-roads.json) and its own instruments - not from the upstream
                     registration. The `future_city_slot` values are quoted from the closing workbook §7.2, which
                     was itself verified against the registration at signing time.
WHAT WOULD INVALIDATE IT   If Digital-City's registration has renamed or re-scoped a slot, the slot labels here
                     would need re-pointing. That is a documentation change, not a construction change, and it
                     cannot block this round's structural targets, which are measured entirely inside Boss.
```

## 2. The present capability surface (measured, not remembered)

The ownership model is `config/capability-modules.json`, **not** the manifests. Measured at the work-start SHA
`8df428eaa437a409368401e95194e40266b83080` by `scripts/phase2-edge-inventory.cjs`:

```text
owned source files                594
capabilities with a declared kind  27
composition-root files              2   (electron/main.ts, electron/preload.ts)
declared road files                 6
cross-capability file edges       774   over 197 distinct capability pairs
kernel -> feature file edges       49   over 16 pairs          <- target 0
mutual capability pairs            31                          <- target 0
largest strongly connected comp.   18 of 29 nodes              <- target <= 1
edges from composition root       101
edges to roads                     75   (edges leaving a road: 0)
```

The four kernel capabilities are `persistence`, `providers`, `runtime`, `state-core` (115 owned files together).
Everything else is `kind: feature`.

## 3. The boundary this round is actually building

The workbook's §7.1 test for an in-scope pre-decoupling is: a real caller exists; it reduces this round's real
dependency/cycle count *or* clearly shrinks the file set a later move needs; it adds no process, no service and no
cross-repo version dependency; Boss's install path, entry points and behaviour are unchanged; it is provable with
existing tests plus a few targeted ones; and it can be reverted with an ordinary `git revert`.

The strict targets (49 / 31 / 18 -> 0 / 0 / <=1) are themselves the path: removing a kernel→feature inversion or a
capability cycle *is* creating a transferable boundary, so the two efforts are the same work, not two programmes.

### 3.1 Entries

Each entry uses the workbook's fixed schema.

#### B-01 — persistence's durable-store boundary

```text
module                  persistence (kernel)
future_city_slot        00/01 City Core - "keep runtime trust, identity, global task ownership and the generic
                        persistence primitives clearly separated"
present_owner           persistence; implementation in electron/store.ts, electron/history-repository.ts,
                        electron/bootstrap/persistence.ts
status                  IN_PROGRESS
concrete_source_files   electron/store.ts, electron/bootstrap/persistence.ts, electron/history-repository.ts
public_symbols          TaskStore and its read/write surface (measured during T3)
state_owned             the app snapshot, conversations, conversations' folders, history records, session state
state_not_owned         task classification/DTO vocabulary, the review policy, the optional-review projection,
                        the state-storage budget rule, the coordination ledger
external_dependencies   node:fs / node:path; src/shared/hash.ts (its own)
host_adapter_or_comp_root  electron/bootstrap/persistence.ts is the boot module; electron/main.ts wires it
present_consumers       every capability that reads or writes persisted state (measured: 17 importers of the
                        tenx road, plus the status projections)
existing_tests          tests/unit/** persistence suites; the store's own characterisation tests
preservation_evidence   to be filled by the T3 cluster checkpoint
future_move_steps       the kernel keeps the storage mechanism; the DTO vocabulary it currently borrows from
                        features either moves to the consumer that owns the domain or is reached through a
                        narrow port the kernel owns
explicit_non_goals      no change to the on-disk format, no new store, no rewrite of electron/store.ts
unresolved_dependencies the 13 kernel->feature edges leaving electron/store.ts and electron/bootstrap/persistence.ts
```

#### B-02 — runtime's platform/coordination boundary

```text
module                  runtime (kernel)
future_city_slot        00/01 City Core (platform) / 01/02 Runtime Compliance - "separate the execution-time
                        application and auditing of a general permission decision from business logic"
present_owner           runtime; implementation in electron/platform/**, electron/capability/**
status                  IN_PROGRESS
concrete_source_files   electron/platform/coordination-recorder.ts, electron/platform/coordination-store.ts,
                        electron/platform/external-compatibility.ts,
                        electron/capability/integration/execution-authorization.ts, src/shared/bootstrap-audit.ts
public_symbols          the coordination record/derive surface; the execution-authorization context and outcome
state_owned             coordination records, the platform's own audit trail
state_not_owned         the task ledger, the coordination economics derivation, the circuit-breaker and
                        runtime-registry implementations, the bootstrap-audit verdict vocabulary
external_dependencies   src/shared/coordination-economics.ts, src/shared/coordination-ledger.ts,
                        electron/commander/task-ledger.ts (all currently borrowed from tenx)
host_adapter_or_comp_root  electron/bootstrap/runtime.ts; electron/main.ts wires it
present_consumers       the command/task execution path; the acceptance suites that read coordination records
existing_tests          tests/unit/city/** platform suites; acceptance-architecture
preservation_evidence   to be filled by the T4 checkpoint
future_move_steps       the kernel keeps the platform mechanism; the ledger/economics derivation moves to its
                        domain owner or is injected as a narrow port
explicit_non_goals      no second scheduler, no new ledger, no change to the permission decision itself
unresolved_dependencies the tenx edges from all four runtime files
```

#### B-03 — providers' machine-identity and computer boundary

```text
module                  providers (kernel)
future_city_slot        00/02 Node Fabric (narrow node identity/membership/liveness interface) and 00/03
                        Capability Fabric (separate declaration/registration/query from implementation)
present_owner           providers; implementation in electron/runtimes/**, electron/computer/**,
                        electron/software/**, electron/bootstrap/providers.ts, electron/bootstrap/provider-pool.ts
status                  IN_PROGRESS
concrete_source_files   electron/runtimes/runtime.ts, electron/runtimes/codex/codex-cli-runtime.ts,
                        electron/runtimes/native-api-runtime.ts, electron/computer/computer-service.ts,
                        electron/computer/backends/dom-page.ts, electron/computer/backends/structured-apps.ts,
                        electron/software/software-runtime.ts, electron/provider-views.ts,
                        electron/account-sessions.ts, electron/bootstrap/providers.ts,
                        electron/bootstrap/provider-pool.ts, src/shared/provider-contracts.ts
public_symbols          the runtime/adapter contract, the provider view projection
state_owned             provider profiles and sessions, runtime availability, computer/software session state
state_not_owned         permission manifests (security), the native-tool execution implementation
                        (engineering), the GitHub machine runtime (security), the session-lifecycle ledger
                        (identity), the action-readiness derivation (tasks), the task IR (tasks), the
                        workspace layout view (workspace), the provider automation loop (automation)
external_dependencies   node:fs / node:path / node:child_process through adapters
host_adapter_or_comp_root  electron/bootstrap/providers.ts and provider-pool.ts; electron/main.ts wires them
present_consumers       the task dispatch path, the provider views IPC surface, the acceptance suites
existing_tests          tests/unit/** provider/runtime suites; the desktop black-box contract
preservation_evidence   to be filled by the T3 provider checkpoint
future_move_steps       a kernel provider pool must not import a feature's implementation: the feature registers
                        with the pool, or the shared contract moves to the pool's own foundation surface
explicit_non_goals      no second capability registry, no plugin platform, no provider behaviour change
unresolved_dependencies 13 kernel->feature edges with `providers` as the source
```

#### B-04 — state-core's migration and soak boundary

```text
module                  state-core (kernel)
future_city_slot        00/01 City Core - "global task ownership and the generic persistence primitives"
present_owner           state-core; implementation in electron/state-core/**
status                  IN_PROGRESS
concrete_source_files   electron/state-core/decision-ledger-migration.ts, electron/state-core/platform-soak.ts,
                        electron/bootstrap/state-core.ts
public_symbols          the state migration surface; the platform soak harness entry
state_owned             the state schema migration record, the platform soak run state
state_not_owned         the decision-ledger store implementation (tenx), the retention rules (knowledge), the
                        soak bounds and sample shapes (status)
external_dependencies   node:fs / node:path
host_adapter_or_comp_root  electron/bootstrap/state-core.ts
present_consumers       the boot path; the soak acceptance suites
existing_tests          tests/unit/city/state-core suites; tests/slow soak suites
preservation_evidence   to be filled by the T3 state-core checkpoint
future_move_steps       the soak harness is a test instrument, not Core behaviour: it belongs with the acceptance
                        surface that owns the bounds, and the migration should read the ledger store through a
                        port rather than constructing it
explicit_non_goals      no change to the migration's on-disk effect, no new soak framework
unresolved_dependencies 5 kernel->feature edges (1 to tenx, 3 to knowledge, 1 to status)
```

#### B-05 — the decision-ledger / task-ledger private-store boundary (tenx side)

```text
module                  tenx (feature)
future_city_slot        00/01 City Core - "do not put business implementation into Core to remove edges; do not
                        duplicate Root Trust"
present_owner           tenx; implementation in electron/commander/**
status                  IN_PROGRESS
concrete_source_files   electron/commander/task-ledger.ts, electron/commander/decision-ledger-store.ts,
                        electron/commander/state-budget.ts, electron/commander/circuit-breaker.ts,
                        electron/commander/runtime-registry.ts, electron/commander/execution-gate.ts,
                        electron/commander/durable-json.ts (already a declared road)
public_symbols          TaskLedger, DecisionLedgerStore, applyStateStorageBudget, CircuitBreaker, RuntimeRegistry,
                        the execution-authorization context/outcome types
state_owned             the task ledger and the decision ledger
state_not_owned         the storage mechanism (Core's), the permission decision (security/Core's)
external_dependencies   src/shared/coordination-economics.ts, src/shared/coordination-ledger.ts,
                        src/shared/optional-review.ts, src/shared/tenx/**
host_adapter_or_comp_root  electron/bootstrap/* wiring in electron/main.ts
present_consumers       persistence, runtime, state-core (three kernels) and the acceptance suites
existing_tests          tests/unit/** commander/tenx suites
preservation_evidence   to be filled by the T3 checkpoint
future_move_steps       the three kernels must stop constructing tenx's store classes; either the store
                        implementation moves behind a Core-owned port or the kernels' need is re-pointed at the
                        generic durable primitive
explicit_non_goals      no move of the ledger into Core, no second ledger, no change to the ledger's contract
unresolved_dependencies the three kernel sources above plus the mutual pairs tenx<->{tasks, engineering, status,
                        promotion, knowledge, research, theme, automation, persistence, runtime, providers}
```

#### B-06 — the shared DTO surface (`src/shared/**`)

```text
module                  the repository-wide shared vocabulary in src/shared/**
future_city_slot        00/04 City Roads - "types, DTOs, stable semantic contracts and necessary pure validation
                        functions"
present_owner           individually assigned to feature capabilities by config/capability-modules.json, which is
                        the cross-cutting problem this round has to answer
status                  IN_PROGRESS
concrete_source_files   the 34 distinct kernel->feature TARGET files listed in
                        docs/research/post-cc103/evidence/  (T3 audit)
public_symbols          per file; the T3 audit classifies each as PURE-CONTRACT / CONST-TABLE / BEHAVIOUR
state_owned             none (a pure contract holds no state) where the file is genuinely a contract
state_not_owned         any file that decides a domain outcome belongs to its capability, not to the road class
external_dependencies   measured per file; a true road may import no capability at all (ledger CC-030)
host_adapter_or_comp_root  n/a
present_consumers       kernels and features alike
existing_tests          per capability
preservation_evidence   the T3 audit output (34 targets, classified)
future_move_steps       a contract file that several capabilities need must not belong to one of them; the move
                        is either an ownership correction to the consumer that owns the vocabulary, or an
                        extraction to a foundation location that owns no building (the roads config's own
                        `exitCondition` formula)
explicit_non_goals      relabelling a load-bearing implementation as a road (CC-030 refusal); deleting an import
                        to lower a count; `import type` used to hide a runtime dependency
unresolved_dependencies the audit's BEHAVIOUR half
```

## 4. The migration plan the measurements imply

This plan is written from measurements taken at the work-start SHA, not from an estimate. Four experiments are
recorded in `docs/research/post-cc103/evidence/`: the corrected binding classification, the re-homing leverage, the
SCC removal cost, and the ownership hypothesis that was tested and refused by the gate. What they jointly say:

```text
the 49 kernel -> feature edges are 30 RUNTIME couplings and 18 import-position ones
no single file re-homing reduces the largest SCC by even one node
the strongest available capability-pair removal is worth ONE node (18 -> 17)
removing the whole 216-file src/shared surface from the capability graph is worth ONE node
337 file edges across 60 pairs reached only SCC 10
```

**Therefore the migration is dependency removal inside `electron/**`, and it has to be sequenced by capability, not
by metric.** The four phases below are ordered so that each one leaves the product working and is independently
verifiable.

### Phase A — the kernel-owned foundation surface (19 edges, 8 pairs)

The 25 `src/shared/**` files a kernel reaches. Two honest routes exist, and the choice between them is a decision the
measurements do not settle:

```text
A1  give the contract a home the kernel owns (a `src/foundation/**` surface, or the consuming kernel itself), so
    the import is internal rather than an inversion. Requires a new ownership class or a deliberate widening of the
    kernel file set, because the ratchet floors `files_owned` and would refuse a move into `exempt`.
A2  leave the file where it is and REMOVE the kernel's need for it: the kernel stops validating/policy-deciding and
    the capability that owns the policy does it. This is the larger but cleaner change, because `electron/store.ts`
    currently decides `isConversationPolicy`, `isVerificationContract`, `isRunMode` and `reviewResponse` -- task and
    status policy that a store has no business deciding.

DECISION REQUIRED BEFORE STARTING: A1 or A2 or a mix. A1 is mechanical and reverses the ratchet's `files_owned`
intent unless the class is added deliberately; A2 is the architecturally correct answer and touches validation
semantics in a 1125-line module.
```

### Phase B — the ledger ports (10 edges, 3 pairs)

```text
electron/bootstrap/persistence.ts and electron/store.ts construct TaskLedger, DecisionLedgerStore and
RuntimeIntelligenceCapture (all tenx). electron/state-core/* constructs DecisionLedgerStore as well.

The genuine fix is to move the ledger's durable implementation out of `electron/commander/**` into the persistence
kernel and leave the commander as an in-memory consumer -- the reverse of a port shim, which would move the import
without moving the dependency and would be a relabelling, not a repair.
```

### Phase C — the workspace stores (3 edges, 1 pair)

```text
electron/bootstrap/persistence.ts constructs WorkspaceRegistry and reads durableFileFor;
electron/store.ts canonicalizes through workspace/path-utils.
`canonicalRealPathOrNormalized` carries NO workspace policy (it is a generic path canonicalizer), so it belongs with
the kernel primitives outright; the registry and durable roots are workspace state and need an injection boundary
rather than a move.
```

### Phase D — the bootstrap fan-out (17 edges, 4 pairs)

```text
providers -> identity, automation, engineering, security, tasks, workspace
state-core -> knowledge, status (the soak harness drives knowledge retention and the soak bounds)
runtime    -> status (bootstrap-audit drives the acceptance vocabulary)
```

`state-core/platform-soak.ts` is the clearest single case in the whole set: **a soak test instrument lives inside a
kernel capability and drives two features' policy.** It belongs with the acceptance surface that owns the bounds, and
moving it removes three edges without touching any production path.

### What each phase must preserve

```text
Boss starts and runs standalone after every phase          (no new service, no new process, no cross-repo runtime dep)
the on-disk format does not change                         (a migration of code, not of user data)
electron/main.ts stays the only composition root           (and is not widened to absorb the problem)
the four kernels keep their `kind` and their real work      (no kernel is emptied to make a count fall)
```

## 5. What this map explicitly does NOT promise

```text
new_services                          = 0
cross_repo_runtime_dependencies_added = 0
boss_default_runtime_changed          = false   (the user entry point and install path are untouched)
digital_city_repo_modified            = false
```

An entry marked `IN_REPO_READY` means *the files, contracts, state ownership and tests a later mover needs are
identified*. It does **not** mean an independent service exists, and this document must never be quoted as if it
did.
