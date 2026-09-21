# Dependency Baseline — Pre-City Freeze

**Purpose:** freeze the measured dependency picture of this checkout *before* any
"Capability City / Kernelization" refactor. This document is **measurement only**.
It proposes nothing, changes nothing, and must be re-measured, not edited, if the
code changes.

**Repository:** `D:\Boss-PreCity-RC` (Codex-Boss), branch `integration/pre-city-baseline`

---

## 1. Method and provenance

### 1.1 Revision

```
$ git rev-parse HEAD
baf4108fe16813533d9879700acc7052f56652ea

$ git rev-parse --abbrev-ref HEAD
integration/pre-city-baseline

$ git log --oneline -3
baf4108 integrate(self-systems): Self Cognition, Self Diagnosis and Self Case Record as one stack
432f859 integrate(runtime-intelligence): the mature RI plane and the RC1 installer, from the alien2 line
4da0ed0 test(promotion): the required-check declaration is checked against the workflow that produces it
```

### 1.2 Raw artifacts (pre-generated; **not** regenerated for this document)

| Artifact | Producing command | SHA-256 (`Get-FileHash -Algorithm SHA256`) |
| --- | --- | --- |
| `artifacts/pre-city/raw/architecture-graph.json` | `node scripts/architecture.cjs graph` | `2071FD942A69E695A42D9276EFE29C926B52A9BD695CDA8B9721E1E4A901C8C0` |
| `artifacts/pre-city/raw/architecture-ownership.json` | `node scripts/architecture.cjs ownership` | `FF07DB0F6D4AC45D7B623F5E64917DCDBB9C4DCEED9C89DE05D3FB09D3B0E2B4` |
| `artifacts/pre-city/raw/architecture-snapshot.json` | `node scripts/architecture.cjs snapshot` | `88271C2568228ED7EAD6F70CC10FE0E3C495642254230E9D30E4AE02BB7993E3` |

**`raw/` is untracked scratch output.** It is not in git and cannot be: the whole
`artifacts/` tree is ignored —

```
$ git check-ignore -v artifacts/pre-city/raw/architecture-graph.json
.gitignore:23:artifacts/	artifacts/pre-city/raw/architecture-graph.json

$ git ls-files artifacts/pre-city
(no output)
```

**Reproduction caveat (important):** each raw file begins with seven lines of a
PowerShell `stderr` preamble (a `NativeCommandError` from the `pnpm` shim) merged
into the captured output, before the JSON object starts, e.g.
`artifacts/pre-city/raw/architecture-graph.json:1-7`:

```
node.exe : $ node scripts/architecture.cjs graph
At D:\Tools\corepack-shims\pnpm.ps1:24 char:5
...
    + FullyQualifiedErrorId : NativeCommandError
```

The hashes above are of the files **including** that preamble. Re-running the
commands and capturing `stdout` cleanly will produce a *different* hash for
byte-identical JSON. The hashes prove "this is the file that was read for this
document", not "this is reproducible byte-for-byte".

An auxiliary, richer generated artifact also exists and was read for this document
(it is likewise untracked, and its own header records the generator):

- `artifacts/platform-foundation/phase-01/architecture-snapshot.json` — written by
  `scripts/architecture.cjs:498-500`; contains the full manifest set, the resolved
  edges, `crossCapabilityImports`, and the boot-module wiring lists.

### 1.3 Definitions actually used (from `scripts/architecture.cjs`)

Everything the three raw artifacts say comes from this one file. The reader should
know exactly what it computes:

| Concept | Definition site | What it means |
| --- | --- | --- |
| Layer (`kind`) | `scripts/architecture.cjs:63` | Only **two** values are legal: `kernel` and `feature` (`if (raw.kind !== "kernel" && raw.kind !== "feature")`). |
| `provides` | `scripts/architecture.cjs:77-81` | `id@major` refs, validated by `REF` at line 32. |
| `requires` / `optional` | `scripts/architecture.cjs:82-98` | Each entry needs a `ref` and a non-empty `reason`. |
| State ownership | `scripts/architecture.cjs:99-104` | `state[].owner` **must** equal the manifest's own `id` — a capability cannot claim another's namespace. |
| Graph edges | `scripts/architecture.cjs:121-137` | Edges come **only** from `provides`/`requires`/`optional`. `modules`, `surface` and `bootModules` contribute **no** edges. |
| Cycles | `scripts/architecture.cjs:142-182` | DFS colouring; a loop is `required` only if every edge on it is `required`. |
| Boot order | `scripts/architecture.cjs:185-198` | Kahn topological sort over **required** edges only. |
| Ownership registry | `scripts/architecture.cjs:234-254` | `ownerOf` / `ownedBy`; a namespace claimed twice is a **conflict** and is excluded from `ownerOf`. |
| Import scan | `scripts/architecture.cjs:269-295` | Walks **only** the files listed in each manifest's `modules:` array, resolves relative specifiers, and keeps an edge only when **both** endpoints are declared modules. |
| Ratchet rules | `scripts/architecture.cjs:401-414` | `kernel-imports-feature`, `feature-imports-undeclared-surface`, unregistered boot module, literal IPC in `main.ts`. |

### 1.4 Measurement performed for this document (read-only)

Because the tool's import scan is scoped to the boot layer (§2.4, §4.2), the
implementation-level numbers below were measured separately, read-only, with no
file written:

- A single-pass static extraction of every `import` / `import type` / `require()` /
  dynamic `import()` statement under `electron/**/*.ts` and `src/shared/**/*.ts`
  (**594 files**, **2 087** import statements), resolving relative specifiers with
  the same algorithm as `scripts/architecture.cjs:259-267`.
- Capability ownership per file taken from `config/capability-modules.json`
  (longest-prefix match, files match exactly, directories match by prefix);
  `exempt` paths excluded.
- Capability- and file-level strongly-connected components (Tarjan), computed
  separately for value imports and type-only imports so the two are never conflated.
- Targeted `Select-String` / direct file reads for every line quoted below.

**Known limitations of that scan** (stated so the numbers are not over-read):

1. The statement pattern requires the `from "…"` clause on one line, exactly like
   the repository's own pattern (`scripts/architecture.cjs:256`), so a multi-line
   `import { … } from "…"` is **not** counted.
2. It counts an import edge per *file*, not per *binding*, and does not evaluate
   re-exports (`export … from "…"`).
3. `config/capability-modules.json` is a **test-impact** mapping, not an
   architecture contract. Using it as the ownership oracle is a choice made here
   for measurement; the architecture tool does not use it.
4. It is a static reading. A specifier that resolves through a path alias or a
   runtime-computed path would be missed. `UNKNOWN` is recorded where this bites.

---

## 2. Declared layer model

### 2.1 There is no `infrastructure` layer

`scripts/architecture.cjs:63` admits exactly two kinds. `artifacts/pre-city/raw/architecture-graph.json:43-73`
declares exactly two groups: `kernel` and `features`.

> **Stated explicitly:** this repository declares **no `infrastructure` layer**.
> Any `kernel -> infrastructure -> capability` shape is a *hypothesis about a
> future refactor*, not a present fact. The two declared layers and their
> members below are the whole model.

### 2.2 Kernel layer — 4 members

Copied verbatim from `artifacts/pre-city/raw/architecture-graph.json:43-48`:

```json
"kernel": [
  "persistence",
  "providers",
  "runtime",
  "state-core"
]
```

`artifacts/platform-foundation/phase-01/architecture-snapshot.json:38-43` shows
these four are *also* exactly the `critical` set:

```json
"critical": [
  "persistence",
  "providers",
  "runtime",
  "state-core"
]
```

Notably, only **one** of the four kernel capabilities declares a dependency at all
(none do — `persistence.yaml:9-10`, `providers.yaml`, `runtime.yaml`,
`state-core.yaml` all have `requires: []` and `optional: []`). The kernel is
dependency-free *in the declared graph*; it is very much not dependency-free in the
code (§3.4, §7).

### 2.3 Features layer — 23 members

Copied verbatim from `artifacts/pre-city/raw/architecture-graph.json:49-73`:

```json
"features": [
  "attachments", "automation", "conversation", "dispatch", "engineering",
  "experience", "host-status", "identity", "knowledge", "learning", "node",
  "project", "promotion", "remote", "research", "security", "settings",
  "status", "task-creation", "tasks", "tenx", "theme", "workspace"
]
```

4 kernel + 23 features = **27 capabilities**
(`architecture-graph.json:9`, `"capabilities": 27`).

### 2.4 The layer model's declared members vs. its real implementation surface

The graph's notion of "module" is *not* the capability's implementation. Each
manifest's `modules:` array is the only thing the import scanner sees, and it
contains **only bootstrap files** (or nothing). Verified across all 28 files in
`config/capabilities/`:

- 9 capabilities declare `modules: []` and therefore contribute **zero** files:
  `experience.yaml:11`, `identity.yaml:11`, `node.yaml:11`, `project.yaml:11`,
  `promotion.yaml:11`, `learning.yaml:11`, `remote.yaml:11`, `security.yaml:11`,
  `tenx.yaml:12`.
- The remaining 18 declare only their own boot factories, 25 files in total —
  e.g. `persistence.yaml:54-55` declares `electron/bootstrap/persistence.ts` and
  nothing else; `research.yaml:22-26` declares its four `electron/bootstrap/research*.ts`
  files and nothing else. `surface:` is `[]` in **every** manifest.

So `tenx` — which owns `electron/commander/` (39 `.ts` files), `electron/runtime-intelligence/`
(9), `electron/tenx/` (17), `electron/fleet/` (1) and 17 `src/shared/*` files per
`config/capability-modules.json:281-306` — declares **no modules at all**.
`learning` (`electron/learning/`, 23 files,
`config/capability-modules.json:75-77`) likewise declares none.

The consequence is measurable and is the key caveat of this whole baseline:

| Measurement | Value | Source |
| --- | --- | --- |
| Files visible to the architecture import scan | **25** | `architecture-snapshot.json:622` `wiredCount: 25`, `registeredCount: 25` |
| Files actually scanned here | **594** | §1.4 |
| `crossCapabilityImports` reported by the tool | **`[]`** | `architecture-snapshot.json:656` |
| Cross-capability edges found here | **187** distinct capability pairs | §4.3 |

Both numbers are correct. They measure different populations.

### 2.5 Durable state namespaces — 32, zero conflicts

`artifacts/pre-city/raw/architecture-ownership.json:9-10`:

```json
"namespaces": 32,
"conflicts": [],
```

Ownership, verbatim from `architecture-ownership.json:11-44`:

```json
"ownerOf": {
  "api-settings": "persistence", "app-state": "persistence", "attachments": "persistence",
  "circuit-breaker": "automation", "decision-ledger": "persistence", "experience": "persistence",
  "external-sessions": "persistence", "history": "persistence", "interventions": "persistence",
  "knowledge-base": "knowledge", "node-registry": "persistence", "permission-manifest": "persistence",
  "project-state": "persistence", "provider-capabilities": "persistence", "recovery": "automation",
  "research-contracts": "research", "research-protocols": "research", "research-reviews": "research",
  "research-runs": "research", "runtime-budget": "persistence", "runtime-resources": "persistence",
  "session-lifecycle": "persistence", "state-core:migration": "state-core", "task-contexts": "persistence",
  "tasks": "persistence", "telemetry": "automation", "theme-packages": "knowledge",
  "theme-registry": "knowledge", "ui-surfaces": "knowledge", "workspace-selection": "persistence",
  "workspaces": "persistence", "world-model": "knowledge"
}
```

Four capabilities own state: `persistence` (19), `knowledge` (5), `research` (4),
`automation` (3), `state-core` (1). **`learning` owns none** — see §6.2.

---

## 3. Vertical dependencies

### 3.1 The sanctioned direction in *this* repository

The declared dependency direction is **capability → kernel**: a feature may depend
on a kernel capability, never the reverse. The kernel is booted first
(`architecture-graph.json:14-42` puts `persistence` before `knowledge`, before
`research`), and the ratchet enforces the direction as a hard rule —
`scripts/architecture.cjs:401-406`:

```js
for (const edge of scan.imports) {
  if (edge.fromCapability === edge.toCapability) continue;
  if (scan.kinds[edge.fromCapability] === "kernel" && scan.kinds[edge.toCapability] === "feature") {
    violations.push({ ratchet: "kernel-imports-feature", file: edge.from, detail: `${edge.from} -> ${edge.to}` });
```

So `kernel -> infrastructure -> capability` in the prompt maps onto the real names
as **`capability (feature) -> kernel`**. There is no intermediate layer to insert;
the only three declared edges in the repository are listed next, and only one of
them is vertical.

### 3.2 The complete declared edge set — 3 edges, all required, 0 optional

`artifacts/pre-city/raw/architecture-graph.json:74-78`:

```json
"edges_detail": [
  "knowledge -> persistence (persistence.store@1, required)",
  "research -> knowledge (knowledge.store@1, required)",
  "theme -> knowledge (theme.registry@1, required)"
]
```

`architecture-graph.json:10-11`: `"edges": 3, "requiredEdges": 3`.
`architecture-snapshot.json:528` adds `"optionalEdges": 0`.

### 3.3 The one vertical edge

**`knowledge -> persistence`** — feature → kernel. Manifest evidence,
`config/capabilities/knowledge.yaml:7-10`:

```yaml
requires:
  - ref: persistence.store@1
    reason: the knowledge base and the theme registry are durable files under the resolved data root, which only the persistence kernel knows how to locate and write atomically.
```

Provider side, `config/capabilities/persistence.yaml:4-8`:

```yaml
provides:
  - persistence.store@1
  - persistence.history@1
  - persistence.tasks@1
  - persistence.settings@1
```

Cross-checked against the snapshot's resolved edge object
(`architecture-snapshot.json:562-567`):

```json
{ "from": "knowledge", "to": "persistence", "ref": "persistence.store@1", "kind": "required" }
```

### 3.4 The four kernel capabilities' own outgoing implementation edges

The declared graph says the kernel depends on nothing. The code says otherwise.
All 43 kernel→feature implementation edges are catalogued in §4.3; the single most
pointed one is that the kernel's *own declared module*
`electron/bootstrap/persistence.ts` imports a **feature** implementation
(`electron/bootstrap/persistence.ts:24`, full quote in §6.4).

The repository's own gate reports **zero** `kernel-imports-feature` violations
(measured — see §5.2), because the target file is owned by no manifest and is
therefore dropped at `scripts/architecture.cjs:290`:

```js
if (!target || !moduleOwners[target]) continue;
```

---

## 4. Lateral dependencies

A lateral edge is capability → capability. Declared laterals: **2**. Measured
laterals in the implementation: **187** distinct capability pairs (§4.3).

### 4.1 The two declared lateral edges

**`research -> knowledge`** — `config/capabilities/research.yaml:7-9`:

```yaml
requires:
  - ref: knowledge.store@1
    reason: a research run records its evidence and reading list through the shared knowledge base rather than keeping a second, divergent store of its own.
```

**`theme -> knowledge`** — `config/capabilities/theme.yaml:6-8`:

```yaml
requires:
  - ref: theme.registry@1
    reason: the theme channels read and mutate the theme registry, whose durable owner is the knowledge capability; this module is the transport, not the store.
```

Provider side: `knowledge` provides **both** `knowledge.store@1` and
`theme.registry@1` (`config/capabilities/knowledge.yaml:4-6`), which is why both
edges land on `knowledge`:

```yaml
provides:
  - knowledge.store@1
  - theme.registry@1
```

### 4.2 The suggested examples — measured against the source

The prompt named three possible laterals. Measured verdicts, using both the
declared graph and the implementation scan:

| Suggested edge | Declared? | In code? | Verdict |
| --- | --- | --- | --- |
| Research → Learning | no | no | **DOES NOT EXIST** |
| Engineering → Research | no | no | **DOES NOT EXIST** |
| Self-\* → Runtime Intelligence | no | no | **DOES NOT EXIST** |

Explicitly, so nobody re-litigates these:

1. **Research → Learning does not exist.** There is no `requires: learning.*` in
   `research.yaml:7-9`, and no import of `electron/learning/**` anywhere under
   `electron/research/**` or `electron/protocols/**` or `electron/ingestion/**`.
   The reverse direction (Learning → Research) is also absent.
2. **Engineering → Research does not exist.** `engineering.yaml:12-18` declares no
   requirements and no `electron/engineering/**` file imports `electron/research/**`.
3. **Self-\* → Runtime Intelligence does not exist.** Only **two** files in the
   whole tree import `electron/runtime-intelligence/`, and neither is a `self-*`
   module:

   ```
   electron/bootstrap/automation.ts:13: import { attachRuntimeIntelligenceCapture, type RuntimeIntelligenceCapture, type LiveCaptureAttachment } from "../runtime-intelligence/live-capture";
   electron/bootstrap/persistence.ts:24: import { RuntimeIntelligenceCapture, createCaptureObservingLedger } from "../runtime-intelligence/live-capture";
   ```

   `electron/self-evolution/**`, `electron/self-cognition/**`,
   `electron/self-diagnosis/**`, `electron/self-engineering/**` and
   `electron/self-case-record/**` contain **no** import of `runtime-intelligence`,
   `commander` or `platform`. (Also note `runtime-intelligence` is *inside* `tenx`
   — `config/capability-modules.json:284-295` — so a "Self-* → Runtime Intelligence"
   edge would be an intra-`tenx` edge anyway once ownership is applied.)

### 4.3 What the laterals actually are — 187 measured capability pairs

**Total measured:** 187 distinct cross-capability edges (import edges between files
owned by different capabilities), from 2 087 import statements over 594 files.

- 164 have at least one **value** import; 102 have at least one **type-only**
  import; 85 are value-only. All **27** capabilities have at least one outgoing
  cross-capability import.
- Of the 187, **43 are kernel→feature** (the class the ratchet forbids and cannot
  see). Ranked by occurrence count:

```
runtime>tenx(22)      persistence>tasks(16)   providers>status(13)  persistence>tenx(11)
runtime>workspace(10) runtime>research(9)     runtime>tasks(8)      runtime>status(8)
persistence>workspace(6) providers>security(5) providers>tasks(5)   persistence>status(5)
providers>tenx(4)     runtime>engineering(4)  runtime>theme(4)      runtime>attachments(3)
runtime>security(3)   providers>workspace(2)  state-core>tenx(2)    providers>engineering(2)
runtime>automation(2) runtime>knowledge(2)    state-core>knowledge(2)
+ 21 further edges with a single occurrence each
```

The remaining 144 are feature→feature laterals. Representative lines, each
verified by direct read:

**Research → Engineering** (real, and the closest analogue to the suggested
"Engineering → Research", which is backwards):

```
electron/research/default-levelb-executor.ts:4: import { scanRepo } from "../engineering/repo-inspector";
electron/research/levela-planner.ts:3:         import { scanRepo } from "../engineering/repo-inspector";
electron/research/research-conductor.ts:33:    import { scanRepo } from "../engineering/repo-inspector";
```

**Engineering → Learning** (real, and the nearest thing to "Research → Learning"):

```
electron/bootstrap/engineering.ts:4: import { LearningService } from "../learning/learning-service";
```

**tenx (runtime-intelligence) → Learning** (real):

```
electron/runtime-intelligence/outcome-source.ts:25: import { EpisodeStore } from "../learning/episode-store";
```

**host-status → Learning** (real, two files):

```
electron/host/fault-lab.ts:12:                 import { EpisodeStore } from "../learning/episode-store";
electron/host/host-observer-collector.ts:12:   import { LearningService } from "../learning/learning-service";
```

**tenx (commander) → Engineering** — 22 value edges, 17 of them from one file; the
first three:

```
electron/commander/main-commander.ts:10: import { MergeCoordinator } from "../engineering/merge-coordinator";
electron/commander/main-commander.ts:11: import { prepareWorkspace, prepareStepWorkspace } from "../engineering/workspace";
electron/commander/main-commander.ts:12: import { ProposalRunner, type ProposalResult } from "../engineering/proposal-runner";
```

**Engineering → Knowledge** and **Knowledge → Engineering** (both directions):

```
electron/engineering/improvement-loop.ts:23: import { KnowledgeBase } from "../knowledge/knowledge-base";
electron/bootstrap/knowledge.ts:7:           import { WorldModelStore, buildWorldModelWithGraph } from "../engineering/world-model";
electron/bootstrap/knowledge.ts:8:           import { UISurfaceRegistryStore, discoverUISurfaces } from "../engineering/ui-surface-discovery";
```

**Perspective note on a ubiquitous-looking edge:** `electron/commander/durable-json.ts`
is imported from **51 files** across **17 capabilities** — `engineering`,
`experience`, `host-status`, `identity`, `knowledge`, `learning`, `node`,
`persistence`, `project`, `promotion`, `providers`, `research`, `runtime`,
`security`, `status`, `theme`, `workspace` (measured; `tenx` itself excluded as the
owner). It is owned by `tenx` (`config/capability-modules.json:282`). One small
helper is therefore a feature-wide dependency hub — it is the largest single
amplifier of the lateral count.

---

## 5. Cycles

### 5.1 Declared graph: **0 cycles**

Three independent measurements agree.

**(a) The graph output.** `artifacts/pre-city/raw/architecture-graph.json:12`:

```json
"cycles": [],
```

and `architecture-graph.json:13`: `"bootable": true`.
`architecture-snapshot.json:529-531`:

```json
"cycles": [],
"requiredCycleCount": 0,
"bootable": true,
```

**(b) Reading the detector.** `scripts/architecture.cjs:142-182` is a DFS
colouring with an odd-cycle-rotated signature set; three required edges
(`knowledge→persistence`, `research→knowledge`, `theme→knowledge`) form the DAG
`persistence ← knowledge ← {research, theme}`, so a back edge cannot exist. This is
a proof, not just a reading of the output.

**(c) The repository's own gate.** Run read-only for this document:

```
$ node scripts/architecture.cjs ratchet
{
  "pass": true,
  "metrics": { "bootModuleCount": 25, "capabilityCount": 27, "dependencyEdgeCount": 3,
               "requiredEdgeCount": 3, "featureCapabilityCount": 23, "durableNamespaceCount": 32 },
  "baseline": { "updatedAt": "2026-09-16T02:25:17.163Z", ... },
  "violations": []
}
exit=0
```

**Conclusion:** no declared `A -> B -> A` cycle exists. Measured by (a) reading the
`cycles` field of the graph artifact, (b) reading the DFS detector that produces
it, and (c) running `node scripts/architecture.cjs ratchet`, which reports
`required-dependency-cycles` as zero violations.

### 5.2 Implementation graph: **43 capability-level 2-cycles; one SCC of 25 capabilities**

Measured by the §1.4 static scan (value imports only — type-only imports separated
out), with ownership from `config/capability-modules.json`:

- **43 capability pairs `A → B` where `B → A` also exists.** Examples with both
  halves quoted:

  **Engineering ↔ Promotion**

  ```
  electron/bootstrap/engineering.ts:3:  import { createSelfEvolutionHost } from "../self-evolution/self-evolution-host";
  electron/promotion-gate/promotion-controller.ts:1: import { EngineeringLoopDriver } from "../engineering/engineering-loop-driver";   [promotion→engineering, 6 edges]
  ```

  **Persistence ↔ tenx** (the kernel and the commander)

  ```
  electron/bootstrap/persistence.ts:6:        import { TaskLedger } from "../commander/task-ledger";
  electron/commander/decision-ledger-store.ts:3: import { ... } from "../../src/shared/decision-ledger";   [tenx→persistence, 10 edges]
  ```

  **Research ↔ tenx**

  ```
  electron/ingestion/workbook-registry.ts:13:  import { writeJson } from "../commander/durable-json";
  electron/commander/workbook-dispatch.ts:33:  import { ... } from "../ingestion/role-assignment";
  ```

  **Engineering ↔ Knowledge**, **Knowledge ↔ tenx**, **Learning ↔ tenx**,
  **Identity ↔ persistence**, **Persistence ↔ workspace**, **Status ↔ tasks**,
  **Tasks ↔ tenx**, **tenx ↔ theme**, **tenx ↔ workspace**, **automation ↔ providers**,
  **providers ↔ runtime**, **runtime ↔ security**, **runtime ↔ {status, settings,
  task-creation, dispatch, knowledge, host-status, automation, persistence,
  providers, research, engineering, tenx}** … the full list is 43 pairs.

- **One strongly-connected component contains 25 of the 27 capabilities** (value
  imports): everything except `conversation` and `remote`. The **type-only** import
  graph, measured on its own, has its own SCC spanning 15 capabilities
  (`attachments, automation, engineering, experience, knowledge, persistence,
  promotion, providers, research, runtime, security, status, tasks, tenx,
  workspace`) — so type-only coupling is not free either. But the giant component
  is **not** an artefact of type imports: removing every type-only edge leaves it
  intact at 25 nodes.

- **File-level cycles are almost non-existent:** exactly **one** SCC larger than a
  single file across all 594 files, and it is intra-capability:

  ```
  electron/engineering/command-runner.ts:5: import { workspacePath } from "./native-tools";
  electron/engineering/native-tools.ts:2:   import { runAllowedCommand } from "./command-runner";
  ```

  Both files are owned by `engineering` (`config/capability-modules.json:20-45`).

### 5.3 How to read the two answers together

"0 cycles" and "43 two-cycles in a 25-node SCC" describe different graphs:

- **0 cycles** is a fact about the **declared contract graph** — 27 nodes, 3 edges,
  the one the ratchet gates on and the one that decides boot order.
- **43 / SCC(25)** is a fact about the **file-level import graph projected onto
  the `config/capability-modules.json` ownership map**. That projection is what a
  "Capability City" refactor would actually have to untangle.

Neither is wrong; presenting only the first would be misleading for kernelization
planning, and presenting only the second would overstate the declared model's
incoherence. Both must be carried into the refactor.

---

## 6. Cross-module private state access

Ownership basis: `artifacts/pre-city/raw/architecture-ownership.json` `ownerOf` /
`ownedBy` (§2.5). A "cross-module private state access" below is a case where code
owned by capability **X** opens, constructs or mutates a durable store whose
authoritative owner is capability **Y** (Y ≠ X), rather than receiving it through a
declared boundary.

**Count: 7 distinct cases** (CS-1 … CS-6, plus CS-3b), plus 1 supporting
observation (CS-7).

### CS-1 — `tenx` opens `automation`'s telemetry file

`telemetry` is owned by `automation` (`architecture-ownership.json:37`,
`"telemetry": "automation"`). `automation` constructs it at
`electron/bootstrap/automation.ts:75` and `:81`:

```ts
75:  const boss = (...parts: string[]) => path.join(dataRoot, ".boss", ...parts);
...
81:  attachTelemetryRecorder(events, new TelemetryStore(boss("telemetry.json")));
```

`tenx` re-derives the same path and opens the same file itself —
`electron/runtime-intelligence/outcome-source.ts:71-74` and `:135`:

```ts
71: /** The telemetry file the running application writes. */
72: export function telemetryFileOf(dataRoot: string): string {
73:   return path.join(dataRoot, ".boss", "telemetry.json");
74: }
...
135:      const read = new TelemetryStore(telemetryFile).list().map(fromTelemetry);
```

The comment "the telemetry file the running application writes" is the module
narrating that it is reaching into another capability's private durable file. No
`requires:` entry in `tenx.yaml` or `automation.yaml` declares this.

### CS-2 — `tenx` opens `learning`'s episode store, and `learning` declares **no** namespace at all

`electron/learning/episode-store.ts:10` documents its layout:
`<root>/episodes.jsonl`. `learning` is wired with that root at
`electron/bootstrap/engineering.ts:68`:

```ts
68:  if (!learning) learning = new LearningService({ rootDir: path.join(options.userData, ".boss", "learning") });
```

`tenx` builds the identical path and reads the file —
`electron/runtime-intelligence/outcome-source.ts:76-79` and `:152`:

```ts
76: /** The learning episode directory the running application writes. */
77: export function learningRootOf(dataRoot: string): string {
78:   return path.join(dataRoot, ".boss", "learning");
79: }
...
152:      const read = new EpisodeStore(learningRoot).all().map(fromEpisode);
```

This is the sharpest case in the baseline, because `learning` is *not merely
un-consulted, it is unregistered*: `config/capabilities/learning.yaml:8` and `:11`

```yaml
state: []
modules: []
```

So `learning` produces durable state (`episodes.jsonl`, `adaptive-flags.json`,
`model-snapshots.json` — see `electron/learning/learning-service.ts:78-80`) that
appears in **no** `ownerOf` entry. `unregisteredNamespaces()`
(`electron/platform/state-ownership.ts:147-149`) exists precisely to catch this
class, but it needs a runtime observation list this static baseline does not have.

### CS-3 — `host-status` opens `automation`'s telemetry, `learning`'s episodes and `tenx`'s task ledger

`electron/host/host-observer-collector.ts:8-12`:

```ts
 8: import { TaskLedger } from "../commander/task-ledger";            // owner: tenx
 9: import { SessionLifecycleLedger } from "../identity/session-lifecycle-ledger"; // owner: identity
10: import { RecoveryScheduler } from "../commander/recovery-scheduler";           // owner: tenx
11: import { TelemetryStore } from "../telemetry/telemetry-store";                 // owner: automation
12: import { LearningService } from "../learning/learning-service";                // owner: learning
```

and the constructions, with the "use the injected one, otherwise open it myself"
fallback pattern that makes the reach-through structural rather than incidental:

```ts
261:      const ledger = sources.ledger ?? new TaskLedger(ledgerRoot);
406:        const telemetry = sources.telemetry ?? new TelemetryStore(path.join(boss, "telemetry.json"));
423:        const ledger = sources.ledger ?? new TaskLedger(ledgerRoot);
```

`electron/host/fault-lab.ts` does the same for the ledger and the episode store
(`fault-lab.ts:7`, `:12`, with `new TaskLedger(root)` at `:323`, `:452`, `:468`
and `new EpisodeStore(root)` at `:382`, `:415`).

### CS-3b — `host-status` raw-parses `persistence`'s `state.json`, deliberately bypassing the owner's API

`app-state`'s owner is `persistence`, and its file is built at
`electron/bootstrap/persistence.ts:132`:

```ts
132:  const store = open("state", () => new StateStore(path.join(dataRoot, "state.json"), history, tasks));
```

`host-status` reads the same file with a bare `JSON.parse` —
`electron/host/host-observer-collector.ts:126-149`:

```ts
126: /**
127:  * Reads the task rows out of `state.json` WITHOUT constructing a `StateStore`.
128:  *
129:  * This is not an optimisation, it is a correctness requirement: the `StateStore`
130:  * constructor calls `beginStartupSession()`, which persists. Using it here would
131:  * make the observer write to the very file it is observing — the observer would
132:  * have become a controller on the first read.
...
138: export function readTaskRows(dataRoot: string): { tasks: ...; schemaVersion?: number; reason?: string } {
139:   const file = path.join(dataRoot, "state.json");
...
143:     parsed = JSON.parse(fs.readFileSync(file, "utf8"));
```

This is the most explicit private-state read in the baseline: the module documents
that it is reading another capability's durable file, and why it cannot use the
owner's API. The comment is honest and the constraint is real (the `StateStore`
constructor has a write side effect, see `electron/store.ts:36-52`), but the
coupling is a raw-file dependency on an undocumented schema — the reader even
carries compatibility code for older shapes (`:134-136`, `:157`). No declared edge
connects `host-status` to `persistence`.

### CS-4 — `persistence` (kernel) installs `tenx`'s capture inside its own task ledger

`electron/bootstrap/persistence.ts:24` and `:126-131`:

```ts
24: import { RuntimeIntelligenceCapture, createCaptureObservingLedger } from "../runtime-intelligence/live-capture";
...
126:  const capture = new RuntimeIntelligenceCapture({
127:    dataRoot,
128:    openedAt: (taskId) => store.snapshot().tasks.find((task) => task.id === taskId)?.createdAt,
129:    taskStatus: (taskId) => store.snapshot().tasks.find((task) => task.id === taskId)?.status
130:  });
131:  const tasks = open("tasks", () => createCaptureObservingLedger({ root: boss("tasks"), capture }));
```

Two crossings in one file: the kernel constructs a **`tenx`** implementation
(`electron/runtime-intelligence/live-capture.ts`, owner `tenx`) *and* passes it
`store.snapshot()` callbacks that read the `app-state` namespace. The comment at
`:121-125` argues the coupling is safe (observe-only, fails closed), and that
argument may hold — but the *dependency* is still kernel → feature, and it is
invisible to the ratchet (§3.4).

### CS-5 — `state-core` (kernel) migrates `tenx`'s decision-ledger store for a `persistence`-owned namespace

`decision-ledger` is owned by `persistence`
(`architecture-ownership.json:16`, `"decision-ledger": "persistence"`). The store
implementation is `tenx`'s. `state-core` imports it —
`electron/state-core/decision-ledger-migration.ts:1-3`:

```ts
1: import type { DecisionLedgerEntry } from "../../src/shared/decision-ledger";   // owner: persistence
2: import { validateLedgerEntry } from "../../src/shared/decision-ledger";        // owner: persistence
3: import { DecisionLedgerStore } from "../commander/decision-ledger-store";      // owner: tenx
```

The same import appears on the boot side, `electron/bootstrap/state-core.ts:3`:

```ts
3: import type { DecisionLedgerStore } from "../commander/decision-ledger-store";
```

So three capabilities meet over one namespace: `persistence` owns it, `tenx`
implements its store, `state-core` migrates it. No declared edge connects
`state-core` to either.

### CS-6 — `engineering` constructs `knowledge`'s `KnowledgeBase` directly

`knowledge-base` is owned by `knowledge` (`architecture-ownership.json:21`).
`knowledge` builds it at `electron/bootstrap/knowledge.ts:86`:

```ts
86:  const foundation = open("knowledge-base", () => new KnowledgeFoundation(new KnowledgeBase(boss("knowledge-base.json"))));
```

`engineering` builds its own instance of the same class —
`electron/engineering/improvement-loop.ts:23` and `:234`:

```ts
23: import { KnowledgeBase } from "../knowledge/knowledge-base";
...
234:      const knowledgeBase = new KnowledgeBase(knowledgePath, () => at());
```

This is a second writer path to a namespace the ownership registry says has exactly
one. Whether it writes is `UNKNOWN` without tracing `knowledgePath` at runtime; the
construction itself is measured fact.

### CS-7 (supporting) — `persistence`'s `StateStore` reaches back into features, and features import it

`app-state` is owned by `persistence`. `electron/store.ts` is the store. It is not
self-contained — `electron/store.ts:1-17` imports from **four other capabilities**:

```ts
 1: import { currentFinalResponse } from "../src/shared/final-response";      // tasks
 4: import { createHash, randomUUID } from "node:crypto";
12: import { writeJson } from "./commander/durable-json";                    // tenx
13: import { TaskLedger } from "./commander/task-ledger";                    // tenx
15: import { applyStateStorageBudget, type LifecyclePruneReport } from "./commander/state-budget"; // tenx
17: import { defaultReviewPolicy, reviewResponse, type ReviewPolicy } from "../src/shared/execution"; // tasks
```

and is imported back, as a **value**, by non-`persistence` capabilities:

```
electron/account-sessions.ts:3:    import { StateStore } from "./store";   // owner: providers
electron/provider-automation.ts:10: import { StateStore } from "./store";  // owner: automation
```

Both usages are type positions in practice; the import form is a value import.
Distinguishing "type position" from "value position" for these two would require
per-binding analysis this scan does not do — recorded as `UNKNOWN` below.

> **Declared-vs-measured note.** The architecture tool reports
> `moduleOwnershipConflicts: []` and `duplicateOwnerCount: 0`
> (`architecture-snapshot.json:657`, `:584`). Those numbers cover the **32 declared
> namespaces only**. `learning`'s durable files are not among them (§CS-2), so a
> clean ownership registry coexists with CS-2. The registry is correct about what
> it knows and silent about what it does not.

---

## 7. Commander / composition-root coupling

Two files carry almost all of the coupling: `electron/main.ts` (owner: `runtime`,
`config/capability-modules.json:183`) and `electron/commander/main-commander.ts`
(owner: `tenx`, `config/capability-modules.json:282`).

### 7.1 `electron/main.ts` — measured

| Metric | Value |
| --- | --- |
| Top-level `import … from "…"` statements | **95** |
| of which `import type` | 4 |
| of which `node:` / `electron` builtins | 4 |
| of which `./bootstrap/*` boundary factories | 26 |
| of which concrete implementation imports | **65** |
| distinct capabilities imported from | **19 of 27** |

**Read the 65 with §7.3 in hand.** It is a *statement* count: it includes every
value-form import, and most of those are used only in type positions. The number of
imports `main.ts` actually instantiates or calls is **12 sites** (§7.3 group C).
Both numbers are reported because the gap between them *is* the finding: an
import-count-based coupling metric would over-report `main.ts` by roughly 5×.

Concentration: `tenx` (15), `providers` (13), `workspace` (9), `research` (4),
`security` (3), `tasks` (3), then `attachments`/`status`/`engineering`/`theme`/
`persistence` (2 each) and `runtime`/`automation`/`project`/`knowledge`/`identity`/
`node`/`learning`/`remote` (1 each).

### 7.2 The composition root constructs business implementations directly

The largest single statement is `electron/main.ts:910` — one expression that
constructs the commander **and** four of its collaborators inline, mixing four
capabilities (`tenx` classes, `providers` surfaces, `persistence` state,
`engineering` hooks):

```ts
910:  commander = new MainCommander(store, runtimeRegistry, new Scheduler(), new RoleRouter(runtimeRegistry, budgetManager, resourceController), budgetManager, contextManager, new ExecutionGate(), taskLedger, resourceController, recoveryScheduler, { visionSurface: providerVisionSurface(...), domPageSurface: providerDomSurface(...), readBrowser: async (id) => { ... }, permissionForWorkspace: () => permissionManifests.load(workspaces.activeWorkspaceId()) }, circuitBreaker, domainEvents, workspaces, softwareLeases, { isSelfTarget: (workspace) => engineering.service.selfEvolution.isSelfTarget(workspace), runTask: async (input) => engineering.service.selfEvolution.runTask(input) });
```

This is the case the prompt asks about: `MainCommander`, `Scheduler`, `RoleRouter`,
`ExecutionGate`, `RuntimeRegistry`, `BudgetManager` are **implementations owned by
`tenx`**, imported by file path and instantiated here — they are **not** behind a
`createXxxModule` boundary. Compare `electron/main.ts:806`, `:832`, `:854`, `:882`,
`:923`, where `createAutomationModule`, `createResearchModule`,
`createKnowledgeModule`, `createEngineeringModule` and `createRuntimeModule` *are*
used. The commander is the exception.

Other direct constructions of feature implementations in the composition root:

| Line | Statement | Owner of constructed class |
| --- | --- | --- |
| `electron/main.ts:303` | `new WorkbookRegistry(path.join(app.getPath("userData"), ".boss", "workbook-registry.json"))` | `research` |
| `electron/main.ts:344` | `new ProjectStateStore(durableFileFor(...))` | `project` |
| `electron/main.ts:473` | `new WebRecovery(store, attached, () => poolRef.automation()!, provider, recoveryScheduler, budgetManager)` | `tenx` |
| `electron/main.ts:793` | `new AccountSessionManager(store, publish, sessionLifecycleLedger)` | `providers` |
| `electron/main.ts:794` | `new RemoteCommandRelay(...)` | `remote` |
| `electron/main.ts:800` | `new RuntimeRegistry()` | `tenx` |
| `electron/main.ts:841` | `new CodexCliRuntime(path.join(app.getPath("userData"), ".codex-boss"))` | `providers` |
| `electron/main.ts:843` | `new NativeRuntime(app.getAppPath())` | `providers` |
| `electron/main.ts:979` | `runtimeRegistry.register(new ProviderRuntimeAdapter("web:" + item.id, {...}))` | `providers` |

### 7.3 Type-import vs implementation-import (the distinction asked for)

Concretely, in `electron/main.ts` (every line below verified by direct read):

**(A) `import type` syntax — 4 statements.** Contract-only, no runtime dependency:

```ts
 10: import type { InputObjectRef } from "../src/shared/input-object";
 16: import type { AppSnapshot, CreateConversationInput, ... } from "../src/shared/contracts";
 17: import type { RuntimeAvailability } from "./runtimes/runtime";
 82: import type { HumanDefinedResearchInput } from "../src/shared/research-input";
```

(Line 57, `import { createRuntimeModule, type RuntimeService } from "./bootstrap/runtime";`,
is a **value** import of a boundary factory with an inline type specifier — recorded
here so it is not miscounted as contract-only.)

**(B) Value imports used only in a type position — the largest group.** A raw
import count badly overstates coupling here, because TypeScript allows `import { X }`
for a type-only usage. Verified one by one: each of these appears in `main.ts`
*only* as a `let` declaration or parameter annotation, never constructed or called:

```ts
112: let store: StateStore;                       // :95  import { StateStore } from "./store";
113: let providerViews: ProviderViews;             // :94  import { ProviderViews } from "./provider-views";
117: let recoveryScheduler: RecoveryScheduler;     // :3   tenx
118: let budgetManager: BudgetManager;             // :26  tenx
120: let apiSettings: ApiSettingsStore;            // :96  providers
121: let providerApi: ProviderApiClient;           // :97  providers
122: let historyRepository: HistoryRepository;     // :98  persistence
124: let domainEventBus: DomainEventBus | undefined; // :34 tenx
128: let decisionLedger: DecisionLedgerStore | undefined; // :86 tenx
129: let sessionLifecycleLedger: SessionLifecycleLedger | undefined; // :87 identity
130: let nodeRegistry: NodeCapabilityRegistry | undefined; // :88 node
134: function learningService(): LearningService { // :89  learning — return type only
139:   return engineeringRef.learning();            // the instance comes from the boundary
141: let research: ResearchService | undefined;    // :80  research
142: let attachmentStore: AttachmentStore | undefined; // :5 attachments
143: let capabilityRegistry: ProviderCapabilityRegistry | undefined; // :6 providers
144: let githubResolver: GithubResolver | undefined; // :7 providers
146: let externalSessions: ExternalSessionLedger | undefined; // :90 workspace
154: let workspaceSelection: WorkspaceSelectionStore; // :66 workspace
```

`LearningService` is the cleanest illustration: the import is a **value** import
(`electron/main.ts:89`) but the only use is a return type, and the instance is
produced by the engineering boundary — so `main.ts` has **no** runtime dependency
on `electron/learning/learning-service.ts` despite the import.

**(C) Value imports genuinely constructed or called in `main.ts` — 12 sites,** one
of which (`:910`) constructs four collaborators inside a single expression. This
is the real composition-root coupling:

```ts
303:  return new WorkbookRegistry(path.join(app.getPath("userData"), ".boss", "workbook-registry.json"));            // research
344:  return new ProjectStateStore(durableFileFor(app.getPath("userData"), workspaceId, ...));                       // project
473:  recoveryRef = new WebRecovery(store, attached, () => poolRef.automation()!, provider, recoveryScheduler, budgetManager); // tenx
793:  accountSessions = new AccountSessionManager(store, publish, sessionLifecycleLedger);                           // providers
794:  remoteRelay = new RemoteCommandRelay(path.join(app.getAppPath(), "scripts", "pc-chat-relay.ps1"), ...);        // remote
800:  const runtimeRegistry = new RuntimeRegistry();                                                                // tenx
841:  codexRuntime = new CodexCliRuntime(path.join(app.getPath("userData"), ".codex-boss"));                         // providers
843:  runtimeRegistry.register(new NativeRuntime(app.getAppPath()));                                               // providers
897:  engineeringSessionId(session.goalId, session.findingId, role),                                              // engineering (call)
910:  commander = new MainCommander(store, runtimeRegistry, new Scheduler(), new RoleRouter(...), ..., new ExecutionGate(), ...); // tenx
979:  for (const item of store.snapshot().providers) runtimeRegistry.register(new ProviderRuntimeAdapter(...));      // providers
885:  rootOwner: SHIPPED_ROOT_OWNER,                                                                                // security (value)
```

(Line 897 is quoted as `engineeringSessionId(...)` at its call site, and 885 uses
`SHIPPED_ROOT_OWNER` as a value.)

**(D) Two value imports with no value use at all** — worth flagging because a
kernelization pass will trip over them:

```ts
 33: import { CircuitBreaker } from "./commander/circuit-breaker";
 81: import { DefaultLevelBExecutor } from "./research/default-levelb-executor";
```

Neither identifier appears anywhere else in `electron/main.ts`; `CircuitBreaker`
is not even used as a type there (the instance comes from
`automationModule.service.circuitBreaker` at `:824`), and `DefaultLevelBExecutor`
is constructed inside the research boundary instead. Whether these are genuinely
dead or reachable through an indirection a textual scan cannot see is `UNKNOWN`
without a compiler pass (U3).

### 7.4 `electron/commander/main-commander.ts` — the second composition root

| Metric | Value |
| --- | --- |
| Top-level import statements | **59** |
| of which `import type` | 9 |
| of which `./bootstrap/*` | **0** |
| of which concrete implementation imports | **57** |
| distinct capabilities imported from | **8** |

`tenx` (21, itself — internal), `engineering` (**17**), `providers` (6),
`tasks` (6), `status` (3), `workspace` (2), `persistence` (1), `security` (1).

It bypasses the boot boundary entirely: **zero** `./bootstrap/*` imports. Its
engineering coupling, first lines:

```ts
10: import { MergeCoordinator } from "../engineering/merge-coordinator";
11: import { prepareWorkspace, prepareStepWorkspace } from "../engineering/workspace";
12: import { ProposalRunner, type ProposalResult } from "../engineering/proposal-runner";
13: import { requiredEngineeringChecks } from "../engineering/verification-policy";
14: import { digest, runCheck } from "../engineering/verification";
```

This is the single densest feature→feature coupling in the repository, and it is
also one half of the `engineering ↔ tenx` 2-cycle (§5.2) and of the 17-edge
`tenx > engineering` lateral (§4.3).

### 7.5 `bootModuleCount` is not a coupling measure

`architecture-snapshot.json:622-652` reports `wiredCount: 25`,
`registeredCount: 25`, `unregistered: []`, `registeredNotWired: []`, and
`literalIpcRegistrationsInMain: 0`. That wiring discipline is real and verified. It
says nothing about §7.2, because the checks are:
"is every wired factory named by some manifest" (`scripts/architecture.cjs:411-412`)
and "does `main.ts` register IPC literals" (`:413`). Constructing implementations
inline passes both.

---

## 8. Summary

### 8.1 Counts

| Quantity | Declared / gated | Measured in implementation | How measured |
| --- | --- | --- | --- |
| **Modules — capabilities** | **27** (4 kernel + 23 feature) | 27 | `raw/architecture-graph.json:9,43-73` |
| **Modules — boot modules wired** | **25** (25 registered, 0 unregistered) | 25 | `architecture-snapshot.json:622-652` |
| **Modules — files in scan scope** | **25** | **594** | §2.4 vs §1.4 |
| **Declared edges** | **3** (3 required, 0 optional) | — | `raw/architecture-graph.json:10-11,74-78` |
| **Vertical edges** | **1** (`knowledge → persistence`) | **43** kernel→feature edges | §3.3 vs §4.3 |
| **Lateral edges (capability→capability)** | **2** (`research → knowledge`, `theme → knowledge`) | **187** distinct pairs (164 with a value import, 102 with a type-only import) | §4.1 vs §4.3 |
| **Cycles — declared graph** | **0** | — | §5.1, three methods |
| **Cycles — 2-cycles at capability level** | not gated | **43** | §5.2 |
| **Cycles — largest SCC** | 27 nodes, 0 edges | **25 of 27** capabilities in one SCC | §5.2 |
| **Cycles — file-level SCCs > 1** | not gated | **1** (`command-runner.ts ↔ native-tools.ts`, intra-`engineering`) | §5.2 |
| **Cross-domain state accesses** | 0 conflicts, 32 namespaces, 0 duplicate owners | **7** distinct cross-owner store accesses | §6 |
| **Durable state namespaces** | **32**, 0 conflicts | 32 declared; `learning`'s files undeclared | §2.5, §CS-2 |
| **Import statements scanned** | — | **2 087** | §1.4 |

### 8.2 Highest-risk couplings

Ranked by how much they obstruct a kernelization refactor, not by line count.

1. **The scan-scope gap is the meta-risk.** The ratchet passes (`pass: true`,
   0 violations) while 43 kernel→feature implementation edges exist, because
   `scripts/architecture.cjs:290` drops any edge whose *target* is not a declared
   module, and 9 manifests declare `modules: []`. Any kernelization plan that
   treats a green ratchet as "the dependency picture is clean" is reading the
   wrong graph. Fix the *measurement* before trusting the *metric*.
2. **`tenx` is a hidden mega-capability.** It owns `electron/commander/` (**39**
   `.ts` files), `electron/runtime-intelligence/` (9), `electron/tenx/` (17),
   `electron/fleet/` (1) and 17 `src/shared/*` files
   (`config/capability-modules.json:281-306`) — and declares `modules: []`
   (`tenx.yaml:12`), so it is invisible to the tool. It is simultaneously the
   kernel's dependency (`persistence → tenx`, 11 edges), the composition root's
   main collaborator (`electron/main.ts`: 15 import statements from `tenx`, of
   which 4 statements account for 6 constructions — `:473`, `:800`, `:910` ×4) and
   the densest lateral hub. Splitting `commander` from `runtime-intelligence` is
   probably the first real decision a City refactor faces.
3. **`electron/commander/main-commander.ts`** — 57 implementation imports from 8
   capabilities (its owner `tenx` included), 17 of them `engineering`, zero
   bootstrap imports. A second composition root with no boundary. Cited in §7.4.
4. **`persistence → tenx` inside `bootstrap/persistence.ts`** (CS-4). The one place
   where the violation is not hypothetical: a *declared kernel module* on the
   forbidden side of the ratchet's own rule, one line (`:24`) away from being
   caught if the rule covered targets.
5. **CS-1/CS-2/CS-3/CS-3b: private durable files opened by non-owners.**
   `automation`'s `telemetry.json` and `learning`'s `episodes.jsonl` are read by
   `tenx` and by `host-status` through self-derived paths and `?? new Store(...)`
   fallbacks, with the paths hard-coded in three places
   (`bootstrap/automation.ts:75`, `bootstrap/engineering.ts:68`,
   `runtime-intelligence/outcome-source.ts:72-79`); and `host-status` raw-parses
   `persistence`'s `state.json` because it cannot use the owner's constructor
   (§CS-3b). `learning` declaring `state: []` (`learning.yaml:8`) means the
   ownership registry cannot even see the conflict it should report.
6. **`electron/commander/durable-json.ts`** — one small helper owned by `tenx`,
   imported from 51 files across 17 other capabilities (§4.3). It inflates every
   lateral count and gives `tenx` a lever into nearly every module. Cheap to
   relocate, high leverage.
7. **The 25-node SCC** (§5.2). Not actionable on its own, but it means "which
   capability can I change in isolation?" currently has the answer "none".
8. **`electron/main.ts:910`** — one single (very long, ~1 100-character) physical
   line that constructs the commander and four collaborators inline, with
   `engineering.service.*` callbacks and `providers` surfaces passed as object
   literals (§7.2). Everything else in the boot block goes through a
   `createXxxModule` factory; this does not.

### 8.3 `UNKNOWN` — what could not be determined, and what it would take

| # | Unknown | What would resolve it |
| --- | --- | --- |
| U1 | Whether the 6 cross-module state accesses are *writes* or read-only. Only construction sites were verified; write paths were not traced. | Per-call-site tracing of each mutating method, or the `unregisteredNamespaces()` runtime observation (`electron/platform/state-ownership.ts:147`). |
| U2 | Whether `electron/account-sessions.ts:3` and `electron/provider-automation.ts:10` use `StateStore` as a type or a value — the import form is a value import in both. | Per-binding analysis or a compiler/type-check pass. |
| U3 | Whether `electron/main.ts:81`'s `DefaultLevelBExecutor` import is genuinely dead. | A compiler pass with `noUnusedLocals`, or a bundler report. |
| U4 | Whether `engineering`'s `new KnowledgeBase(knowledgePath, …)` (`improvement-loop.ts:234`) ever writes the `knowledge-base` namespace, making CS-6 a real second writer. | Tracing `knowledgePath` and the called methods at runtime. |
| U5 | Whether any of the 187 measured edges are false positives from a specifier that resolves through an alias or a computed path. | A resolver-aware scan (tsconfig `paths`, bundler config). |
| U6 | The complete runtime set of durable namespaces actually opened (declared = 32; `learning` alone implies ≥ 3 more). | A live run calling `unregisteredNamespaces()`. |
| U7 | Whether the two raw artifacts' PowerShell preamble changes any consumer's parse. The JSON payload itself is well-formed; the files are not pure JSON. | Re-capture with `2>$null` or clean `stdout` separation. |

### 8.4 What this baseline does **not** claim

- It does not claim the repository is in violation of anything. The ratchet passes
  on its own definition, and the definition is narrow (§2.4).
- It does not claim the 187 implementation edges are all defects. Many are
  `src/shared/*` type and pure-function imports — which is exactly why the
  value/type split is reported separately.
- It proposes no change. Every number here is a measurement with a cited source
  and a stated method; re-measure, do not edit.
