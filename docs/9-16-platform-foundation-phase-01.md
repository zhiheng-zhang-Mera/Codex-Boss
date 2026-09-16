# Platform Foundation — Phase 01: Architecture Contracts

**Baseline:** `4b623b985cd9a8630a74382600780671554105d2`
**Branch:** `platform-foundation/01-architecture-contracts`
**Engineering book:** `Update-Plan/Platform-Foundation/Phase-01-Architecture-Contracts.md`
**Owner decision (this round):** work in place at `D:\Codex-Boss`, pinning the working tree to the specified baseline.

This is the phase acceptance record. It states what was built, what the engineering
book required that the repository did not already have, which decisions departed from
the book's letter, and what the phase found that later phases now inherit.

---

## 1. What was already true, and therefore was not rebuilt

The book opens by saying to check the code before assuming the stated defects still
exist. Four of its requirements were **already satisfied and already regression-guarded**
by the existing suite. They were verified by reading the tests, not assumed, and the
phase records them as ratchets rather than re-implementing them:

| Book requirement | Already enforced by | Evidence |
| --- | --- | --- |
| "`main.ts` must not re-add literal IPC registration" | `tests/unit/repository-boundary-guards.test.ts` — asserts a fixed 92-channel list is registered by boot modules and that `main.ts` names **no** channel | measured: 0 literal registrations |
| "BootModule factory + explicit wiring retained" | `repository-boundary-guards.test.ts` — every boot module exposes `service` + `health` + `dispose`; boot modules never import Electron; no boot module does filesystem/git/process work | 24/24 modules satisfy it |
| "One authoritative owner per durable state namespace" | `tests/unit/durable-state-ownership.test.ts` — Phase I established and guarded the invariant, including why two `ProjectStateStore` constructions are safe (the class is stateless) and why a second `ThemeService` would not be | registry: 31 namespaces, 0 conflicts |
| "Do not continue dismantling `main.ts`" | `main.ts` is 1285 lines with all channels already extracted | untouched except where the phase had to |

Consequently the phase added **no** new enforcement of those four; it added the
machine-readable *description* the book asks for (manifests, graph, ownership registry,
snapshot) and left the existing guards exactly as they were. No existing test was
deleted, weakened, skipped, or had an allowlist widened to reach green.

---

## 2. What was delivered

### Electron side — `electron/platform/` (read-only constraint layer)

| File | Responsibility |
| --- | --- |
| `capability-contract.ts` | `CapabilityId`, `CapabilityVersion`, `CapabilityRequirement`, `CapabilityManifest` and the `id@major` parser |
| `capability-manifest.ts` | YAML/JSON manifest parsing and validation (Task A) |
| `dependency-graph.ts` | DAG, cycle classification, `impactRadius`, deterministic boot order (Task B) |
| `state-ownership.ts` | namespace → single authoritative owner; conflicts are refused, not resolved (Task C) |
| `architecture-ratchet.ts` | the seven absolute and two monotone invariants, plus the baseline model (Task D) |
| `repo-scan.ts` | gathers the evidence the ratchet inspects; resolves real import graph |
| `platform-health.ts` | local `DEGRADED` / `ABSENT` semantics and propagation (gate 5) |
| `capability-registry.ts` | binds manifests to the composition root's real boot factories |
| `../../electron/bootstrap/shared/require-provider.ts` | the relocated shared guard (see §3.1) |

**Nothing in `electron/platform/` is constructed in the boot path.** No DI container,
no service locator, no runtime resolution: `electron/main.ts` still calls every factory
explicitly and hands it its dependencies. The layer describes that wiring; it does not
participate in it.

### Configuration — `config/`

- `config/capabilities/*.yaml` — **26 manifests**: 3 `kernel` (`persistence`, `runtime`,
  `providers`), 23 `feature`. They cover **all 24** `electron/bootstrap/*.ts` factories
  exactly once, and declare **31** durable namespaces and **3** required dependency edges.
- `config/architecture-baseline.json` — the monotone-metric baseline, written only by
  the explicit update command.

The feature tier is generated from one table by
`scripts/generate-capability-manifests.cjs` (idempotent; verified byte-identical on a
second run) so two manifest files cannot disagree about a boot module path. The kernel
manifests and the two with a considered dependency edge are hand-written with their
rationale.

### Commands — Task E

```text
pnpm run architecture:graph        # capabilities, edges, cycles, boot order, kernel/feature split
pnpm run architecture:impact -- <capability-id|provided-contract>
pnpm run architecture:ownership    # namespace -> owner, plus conflicts
pnpm run architecture:ratchet      # every invariant, its expectation and its measurement
pnpm run architecture:snapshot     # writes the phase artifact
pnpm run architecture:baseline:update --reason "..."
pnpm run architecture:manifests:generate
```

All emit JSON with meaningful exit codes (`0` clean, `1` violated, `2` unusable
invocation). Verified as real processes, not by unit-calling the functions.

### Tests

| File | Tier | Tests |
| --- | --- | --- |
| `tests/unit/platform/capability-manifest.test.ts` | unit | 23 |
| `tests/unit/platform/dependency-graph.test.ts` | unit | 16 |
| `tests/unit/platform/state-ownership.test.ts` | unit | 9 |
| `tests/unit/platform/architecture-ratchet.test.ts` | unit | 23 |
| `tests/unit/platform/platform-health.test.ts` | unit | 8 |
| `tests/acceptance/platform-architecture-diagnostics.test.ts` | acceptance (integration) | 11 |

**Total 90** new tests. The CLI suite lives under `tests/acceptance/` because it imports
`node:child_process`; `vitest.tiers.mjs` defines the `integration` layer *by that import*,
and `tests/unit/test-layers.test.ts` computes the classification in both directions.

---

## 3. Decisions, and where they depart from the book

### 3.1 The book's "no feature→feature import" rule was already violated — and was fixed

`electron/bootstrap/settings-ipc.ts` exported `requireProvider`, and **both**
`dispatch-ipc.ts` and `task-creation-ipc.ts` imported it from there. That is a capability
importing another capability's implementation module, which the book forbids.

It was **fixed rather than baselined**: the guard moved to
`electron/bootstrap/shared/require-provider.ts`, a module no manifest claims, so importing
it is never a capability edge. Behaviour is byte-for-byte the same error message from the
same one place. Baselining it would have started the ratchet at a non-zero violation,
which is the "expand the allowlist" move the book prohibits. The change is one commit and
reverts cleanly on its own.

### 3.2 Capabilities are the composition root's units, not the book's example domains

The book's manifest example is `research.autopilot` — a product capability. The 24 boot
modules do **not** decompose that way: `persistence` builds twenty unrelated stores,
`knowledge` builds the theme service, `main.ts` still constructs durable writers itself.
Splitting along product lines would have required moving code, which the book forbids.

So the Phase 01 capability boundary is **the boot module**, grouped where the composition
root already groups them (`providers` = `providers` + `provider-pool` + `provider-ipc`;
`research` = its four factories). This satisfies the acceptance gate the book actually
states — *"all existing boot modules map to a manifest or are explicitly marked
kernel composition-only"* — and it makes the no-cross-import rule **meaningful at this
stage**, because the modules are genuinely independent today. Product-level capabilities
are the correct Phase 02/03 exercise, once dependency injection through contracts exists
to make them real.

### 3.3 `bootModules`, `modules` and `surface` are three distinct declarations

The book's minimum field list does not mention module ownership. Without it, "feature
implementations must not couple" is unenforceable — there is nothing to compare an import
against. Three fields were added:

- `bootModules` — the `electron/bootstrap/*.ts` factories the composition root wires.
  Asserted as a **bijection** against the 24 on disk.
- `modules` — the files the capability is made of (currently the boot modules).
- `surface` — the modules a capability *publishes*; importing any other module of another
  capability is the violation. Every manifest declares `surface: []`, so today every
  cross-capability import is a violation and the rule holds at zero.

`surface` is empty on purpose, and that is a real limitation: it means the ratchet cannot
yet distinguish "reaches into an implementation" from "uses a published contract", because
nothing is published yet. It is recorded as debt in §6.

### 3.4 The snapshot is regenerable derived data under a gitignored path

The book requires `artifacts/platform-foundation/phase-01/architecture-snapshot.json`.
`artifacts/` is gitignored at this baseline (`.gitignore:23`, the repository's own
convention). The file is therefore **written, verified and reproducible, but not
committed** — that is the repository's rule, not a shortcut. `pnpm run
architecture:snapshot` regenerates it byte-identically apart from `generatedAt`, and
`tests/acceptance/platform-architecture-diagnostics.test.ts` asserts both that it exists
and that it is reproducible. The baseline, the manifests and the invariants it describes
*are* committed, so a fresh checkout can reproduce the artifact from the tracked sources
alone.

### 3.5 The durable-state inventory is domain-level; the file-level one is larger

The registry declares **31** namespaces. A full file-level sweep of the repository found
**86** namespaces with **208** writer sites. The 31 are the ones the book names
explicitly (task, conversation, history, research, engineering, knowledge, decision,
session, identity, runtime, evolution) and the ones with a single unambiguous owner. The
remaining 55 are **not** smuggled into the registry under a guessed owner; the hazards
among them are recorded in §4 as Phase 02 input.

---

## 4. Findings the phase inherited — Phase 02 input

The inventory below is **not** Phase 01 scope: the book forbids persistence migration
here, and none was attempted. These are recorded because Phase 02 ("durable state &
events") is exactly where they land, and because each was verified first-hand rather
than inferred.

**Ownership is unambiguous but the surface is not** — the registry records a single
authoritative writer and these are separate defects:

1. **`interventions.json` reader/writer shape mismatch — silent wrong answer.**
   `commander/human-guidance-gate.ts:78` writes `{schemaVersion, interventions: [...]}`;
   `host/host-observer-collector.ts:442` reads `{items: [...]}`. The observer's loop
   therefore always iterates an empty array and reports **zero** unresolved
   interventions. Verified by reading both sites. Making the writer satisfy the reader
   would make `HumanGuidanceGate.restore()` throw at boot, so neither side is a
   one-line fix.
2. **`credentials.secret-vault` — two owners over one file.**
   `security/secret-vault-store.ts` caches the whole document and rewrites it wholesale;
   it is constructed over the same path with the same vault name by
   `github/bootstrap.ts:38-43` and `github/github-machine-runtime.ts:47`. Two live
   instances are two owners (last writer wins, the other's cache is stale).
3. **`runtime-budget.json` — a "read" that writes.** `BudgetManager.eligible()` calls
   `update()` → `writeJson` when a `resetAt` has elapsed
   (`commander/budget-manager.ts:54`). `host/host-observer-collector.ts:291` builds its
   own `BudgetManager` over the same file, so running `scripts/host-observe.cjs` against
   a live data root creates an out-of-process second writer.
4. **`project.state` — two `ProjectStateStore` instances**, one of them never consumed
   (`bootstrap/persistence.ts:147` vs the live per-call instance at `main.ts:323`). Safe
   only because the class is stateless; `tests/unit/durable-state-ownership.test.ts`
   already guards that property.
5. **`research.artifacts` (`audit/compile.json`) — two independent producers**,
   `research/research-conductor.ts:751` and `manuscript/latex-compiler.ts:99`. The file is
   read by the fail-closed READY gate at `research-service.ts:160`.
6. **`.boss` root spelled independently in ≥10 modules**, two of which derive it from a
   different base (`provider-automation.ts:41` uses `process.cwd()`,
   `host/sentinel-capture.ts:314` uses the repo root) and agree only by coincidence of
   the default layout.

Also found and relevant to Phase 02's "no auto-overwrite of corrupted data" rule: the
`state.json` owner is simultaneously a writer of the task ledger and the history
repository (`store.ts:1110/1116/1131`), and the ledger's revision guard can make the
state write fail. A per-file ownership table under-reports that.

**Verification caveat, recorded honestly:** the composition roots, the
persistence-owned stores, the commander stores and the governance family were read
line-by-line. The remaining ~26 directories were swept by delegated full-directory
reads whose key claims were re-verified by targeted grep; line numbers in those groups
are at one remove from first-hand reading. Three items could not be settled from code
alone and are listed as open questions rather than findings: whether two unbounded caches
(`.boss/vision`, `.boss/theme-captures`) have a janitor outside `electron/`; whether
`ModelSnapshotRegistry`/`BehaviourEpochLedger` fully rebuild after `clear()`; and whether
every alternate entry point reaches the runtime-path re-point before the capture path is
built.

---

## 5. Acceptance results

| Gate | Result |
| --- | --- |
| 1. `typecheck` / `security:scan` / `build` / unit / slow / postbuild / full CI | see §5.1 |
| 2. All boot modules mapped to a manifest or marked kernel composition-only | **PASS** — 24/24, bijection asserted in both directions |
| 3. Required dependency graph has no cycles | **PASS** — `requiredCycleCount = 0`, `bootable = true` |
| 4. State ownership has no duplicate owner | **PASS** — 31 namespaces, 0 conflicts |
| 5. Removing any non-critical optional manifest ⇒ bootable + local `DEGRADED` | **PASS** — evaluated for every one of the 23 non-critical manifests |
| 6. Deliberate cycle / duplicate owner / feature→feature import ⇒ test fails | **PASS** — each is driven against a synthetic broken repository |
| 7. `architecture-snapshot.json` records counts, kernel/feature lists, ownership, baseline | **PASS** — and asserted reproducible |

### 5.1 Command results

```text
typecheck        tsc --noEmit × 3 projects            PASS
security:scan    TRACKED_SECRET_SCAN=PASS files=1036  PASS
build            tsc ×2 + vite build + tsc emit        PASS
test (unit)      2022 tests across 188 files           PASS
test:postbuild   62 tests across 3 files               PASS
test:slow        review-loop 11/11 PASS; evolution-sandbox 3/14 — see §5.1.1
architecture:ratchet                                    PASS (0 violations)
```

Model counts recorded by the snapshot: **26 capabilities**, **3 dependency edges**,
**24 boot modules**, **31 durable namespaces**, **0 required cycles**, **0 duplicate
owners**, **0 literal IPC registrations in `main.ts`**, **0 module-ownership conflicts**.

#### 5.1.1 The one non-green tier, and why it is not this phase's regression

`tests/unit/evolution-sandbox.test.ts` fails **11 of 14** tests on this machine —
including its own declared positive CONTROL (`CONTROL: candidate code really runs and can
use its own workspace`), and `SB-04` … `SB-10`, which are not capability-specific. The
whole sandbox fails to start children.

This is **proven pre-existing, not caused by this phase**, by direct measurement rather
than assertion:

- no commit on this branch touches any sandbox, `self-evolution`, or AppContainer file
  (`git diff --name-only 4b623b9..HEAD` matches none);
- a clean `git worktree` of the **unmodified baseline `4b623b9`**, run with the same
  command, fails **the identical 11 tests with the identical names**;
- the documented stale-profile cause does not apply — zero
  `codexbossevolution-rt-sandbox*` profiles exist on this machine — and the CONTROL
  failing means the mechanism is unavailable here, not that containment regressed.

The failure mode is environmental (this session cannot create the AppContainer sandbox).
`vitest.tiers.mjs` describes the suite as an OS-sandbox tier for exactly this reason. It
is reported as **not green on this machine**, with the baseline comparison as evidence,
rather than being counted as a pass or quietly excluded. On a runner where AppContainer
is available this suite is expected to behave as documented; that expectation is **not**
claimed as verified here.

### 5.2 Negative tests (gate 6)

Each of these is a real assertion against a deliberately broken input, not a claim:

- required cycle → `required-dependency-cycles` fails; **optional** cycle is reported but
  is **not** a boot blocker (the positive control that the check is not merely "any cycle").
- duplicate state owner → `duplicate-state-owners` fails, and the contested namespace is
  deliberately excluded from `ownerOf` rather than resolved by a coin flip.
- kernel → feature import → fails.
- feature → undeclared foreign surface → fails, **and** the same import against a
  *declared* surface passes (positive control).
- wired boot module named by no manifest → fails.
- literal `ipcMain.handle("...")` in `main.ts` → fails, with a positive control on the
  counter itself.
- monotheistic baseline: a metric at its recorded value passes; one above it fails.

---

## 6. Known debt and deferred-by-design

**Deferred by design (the book's "explicitly do not do" list), not started:**

- no SQLite migration; no durable event journal; no plugin loader; no permission grant;
  no data GC; no impact-based test skipping (only the impact graph); no further
  dismantling of `main.ts`.

**Known debt, carried forward deliberately:**

1. `surface: []` on every manifest — cross-capability imports are checked, but nothing is
   published yet, so the rule is stricter than it needs to be and cannot distinguish a
   contract from an implementation. Tightening this needs Phase 03's capability model.
2. The 55 file-level namespaces beyond the 31 in the registry are inventoried (§4) but
   not declared; declaring them belongs with the migration that gives them contracts.
3. `dependencyEdgeCount = 3` is a **floor, not a measurement**. Phase 01's manifests
   declare only edges that genuinely resolve; the real coupling between the boot modules
   is far denser and is expressed today by `electron/main.ts` hand-wiring them in order.
   Recording the rest requires either extraction or explicit contracts, both out of scope.
4. `checkpoint-1`-era acceptance harnesses (`electron/engineering/**`) and the whole
   `electron/tenx/**` persistence stack have no production caller. They are unwired, so
   they are not in the registry; whether they should be deleted is a product decision
   this phase does not make.

**Blocked / external:** none. No credential, account, human identity or protected-surface
approval was required, and no item is `BLOCKED_EXTERNAL` or `WAITING_FOR_OWNER`.

---

## 7. Corrections to the phase's own assumptions

Recorded because the book asks for "old description errors" to be written down:

1. **The repository has no `Update-Plan/Platform-Foundation/` at the baseline.**
   `Update-Plan/` does not exist in baseline commit `4b623b9` at all — the whole tree was
   reorganised into `docs/` before that commit. The Phase 01 workbook is added *by this
   branch* (commit `d142c5f`) from the phase branch that carried it. An earlier working
   assumption in this session that the baseline contained the book was wrong; it was
   corrected by reading `git ls-tree`.
2. **"24 BootModules" in the book is exact, and the first measurement said 23.** The
   undercount was a real bug in this phase's scanner: `runtime.ts` exports
   `createRuntimeModule<W extends RuntimeWindow>(` and the pattern only matched
   `name(`. A module the constraint layer does not see is a module it does not protect,
   so the pattern now permits a type-argument list, and the count is asserted as 24.
3. **`artifacts/` is gitignored**, so "generate `artifacts/...`" cannot also mean "commit
   it". See §3.4.
4. **The `requireProvider` coupling was still present**, despite the repository's own
   documentation describing `settings-ipc` as the guard's home "so a caller is never told
   'unknown provider' by one path and something vaguer by another". The shared-guard
   intent was right; the location made it a cross-capability import.

---

## 8. Reproducing this phase

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm run typecheck
corepack pnpm run security:scan
corepack pnpm run build
corepack pnpm test
corepack pnpm run test:postbuild
corepack pnpm run test:slow
corepack pnpm run architecture:ratchet
corepack pnpm run architecture:snapshot
```

`architecture:snapshot` writes `artifacts/platform-foundation/phase-01/architecture-snapshot.json`.
The ratchet baseline changes **only** through
`corepack pnpm run architecture:baseline:update --reason "<why>"`.
