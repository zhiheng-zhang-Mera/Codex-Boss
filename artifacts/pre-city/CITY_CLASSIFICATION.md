# CITY CLASSIFICATION — Pre-City Baseline

**Purpose:** urban-planning survey only. This document **classifies** the systems of the current Boss so the
next phase can begin Capability City / Kernelization with a map. **No migration is performed and none is
proposed as work to do now.** No file was moved, renamed, split or merged to produce this document.

* **Commit:** `baf4108` (`integration/pre-city-baseline`)
* **Base:** `main` = `4da0ed0` (`PRE_CITY_START_MAIN_SHA`)
* **Ground truth:** `config/capability-modules.json`, `config/capabilities/*.yaml` (27 files),
  `config/test-catalogue.json`, `artifacts/pre-city/raw/architecture-{graph,ownership,snapshot}.json`,
  `src/shared/autonomous-evolution-trust.ts` (`ROOT_TRUST_SURFACE_PATHS`), and the source tree itself.
* **Companions:** `CAPABILITY_INVENTORY.md` (per-capability detail), `DEPENDENCY_BASELINE.md` (measured
  coupling), `STRUCTURAL_HEALTH_BASELINE.md` (flatness/defect inventory).

This is *planning surveying*, not formal structural migration. Where a classification is a judgement rather
than a measurement, it says so.

---

## 1. The vocabulary, and what each label asserts

The Owner's framing is used directly: Boss is to become *land, foundation, roads, pipes and municipal
rules*; capabilities are *buildings* on it. "Capability" does **not** mean "smallest possible code unit" — a
capability may be 1×1, 1×2, 2×2, or a large compound building. The unit of classification is therefore the
**minimum stable semantic closure**, not the file and not the class.

| Label | Asserts | The test it must pass |
|---|---|---|
| `KERNEL_CANDIDATE` | Load-bearing ground. Others stand on it; it should not depend on what stands on it. | Would removing all business capabilities leave this meaningful and functional? Does it depend on features? |
| `INFRASTRUCTURE_CANDIDATE` | A road or pipe: shared by many, owned by none of them, no business opinion. | Is it consumed by ≥3 capabilities, and does it carry domain semantics? |
| `ATOMIC_CAPABILITY` | One building, one purpose. Minimal stable semantic closure; cannot be split without breaking an invariant. | Does it own its state, its tests, its docs, and a single responsibility? |
| `COMPOUND_CAPABILITY` | Several capabilities that legitimately collaborate into one deliverable. | Does it present one external surface over ≥2 internal capabilities? |
| `BUNDLE` | A shipped/coordination grouping of several capabilities — a district, not a building. | Is it a grouping rather than a single responsibility? |
| `BRIDGE_OR_SHIM` | A temporary or legacy connector. Legitimate now; must not become foundation. | Does it exist to satisfy a migration, adapter or compatibility need rather than a domain need? |
| `TRUST_DOMAIN` | Adjudicates authority, identity, qualification or self-modification. Highest sensitivity. | Does it define or enforce who may do what? |
| `UNKNOWN` | The source does not settle it, or it is dead/unwired so its closure cannot be observed. | Evidence was insufficient; say so rather than guess. |

Per §15.7, the two rules that govern this map:

> **bridge may exist, but bridge must not become foundation.**
> A shared capability of two buildings belongs in the road, not in one of the buildings.

---

## 2. Classification summary

All **27 declared capabilities** (from `config/capabilities/*.yaml`) are classified, plus the cross-cutting
and not-yet-declared surfaces that the inventory found.

| # | System | Label | Grounds |
|---|---|---|---|
| 1 | `state-core` | `KERNEL_CANDIDATE` | durable state + event journal substrate; 1 declared edge out to `persistence` only |
| 2 | `persistence` | `KERNEL_CANDIDATE` | 20 of 32 durable namespaces; every feature's store root |
| 3 | `runtime` | `INFRASTRUCTURE_CANDIDATE` | runtime registry + resources; consumed broadly |
| 4 | `providers` | `INFRASTRUCTURE_CANDIDATE` | provider/web runtime; a road, not a business |
| 5 | `conversation` | `ATOMIC_CAPABILITY` | one purpose: the conversation surface |
| 6 | `dispatch` | `ATOMIC_CAPABILITY` | dispatch + role routing |
| 7 | `tasks` | `ATOMIC_CAPABILITY` | task state / task ledger |
| 8 | `task-creation` | `ATOMIC_CAPABILITY` | task intake |
| 9 | `project` | `ATOMIC_CAPABILITY` | project model |
| 10 | `workspace` | `ATOMIC_CAPABILITY` | workspace selection/scoping |
| 11 | `settings` | `ATOMIC_CAPABILITY` | settings surface |
| 12 | `attachments` | `ATOMIC_CAPABILITY` | attachment handling |
| 13 | `theme` | `ATOMIC_CAPABILITY` | theme registry/packages (declared edge to `knowledge`) |
| 14 | `identity` | `TRUST_DOMAIN` | identity |
| 15 | `security` | `TRUST_DOMAIN` | machine identity, credential boundary, GitHub guardian policy |
| 16 | `promotion` | `TRUST_DOMAIN` | promotion gate, self-evolution authority, root authority |
| 17 | Qualification (not declared) | `TRUST_DOMAIN` | epoch 24 `boss-root-trust-24`, surface hash, qualification semantics |
| 18 | `knowledge` | `COMPOUND_CAPABILITY` | knowledge base, world model, theme registry, UI surfaces — 4 namespaces, 1 consumer-facing surface |
| 19 | `research` | `COMPOUND_CAPABILITY` | 4 declared namespaces (runs, protocols, reviews, contracts); plan → execute → review |
| 20 | `engineering` | `COMPOUND_CAPABILITY` | improvement loop + verification + review + self-healing + capability-gap |
| 21 | `status` | `COMPOUND_CAPABILITY` | status + host-status + owner dashboard + acceptance evidence |
| 22 | `host-status` | `COMPOUND_CAPABILITY` | host observation/fault-lab |
| 23 | `learning` | `COMPOUND_CAPABILITY` | adaptive flags, episodes, model snapshots, reranker |
| 24 | `experience` | `COMPOUND_CAPABILITY` | experience/repro surfaces |
| 25 | `automation` | `COMPOUND_CAPABILITY` | automation + telemetry + circuit breaker + recovery |
| 26 | `remote` | `ATOMIC_CAPABILITY` | remote session gateway |
| 27 | `node` | `INFRASTRUCTURE_CANDIDATE` | node capabilities/registry — a road |
| 28 | `tenx` | `BUNDLE` | 10× coordination: commander, fleet, economics, coordination store |
| 29 | `electron/capability/**` (broker, authorization, plugin host) | `UNKNOWN` | **no production consumer**; authorization is dead in shipped wiring |
| 30 | `self-cognition` (not declared) | `ATOMIC_CAPABILITY` | observes anatomy; CLI-only, unregistered |
| 31 | `self-diagnosis` (not declared) | `ATOMIC_CAPABILITY` | reads recorded observations; CLI-only, unregistered |
| 32 | `self-case-record` (not declared) | `ATOMIC_CAPABILITY` | append-only record; CLI-only, unregistered |
| 33 | `runtime-intelligence` (not declared) | `COMPOUND_CAPABILITY` | 38 modules: advisory core, evaluation, prospective window, live capture, installer-facing capture |
| 34 | Installer / Bootstrap (`installer/windows`, `electron/bootstrap`) | `COMPOUND_CAPABILITY` | bootstrap composition + RC1 installer |
| 35 | UI (`src/renderer`) | `ATOMIC_CAPABILITY` | renderer shell + surfaces |
| 36 | `electron/self-engineering/**` | `UNKNOWN` | unwired |
| 37 | `src/shared/self-diagnosis.ts` (AP26 file) | `BRIDGE_OR_SHIM` | legacy failure-clustering lineage still imported by `engineering`/`correction` |
| 38 | `src/shared/compatibility.ts` | `BRIDGE_OR_SHIM` | owned by `persistence` **and** declared `exempt` |
| 39 | future Co-Learning | `UNKNOWN` (reserved) | not implemented; §16 |
| 40 | future Judgment Growth | `UNKNOWN` (reserved) | not implemented; §16 |

**Future reservations** (§16): `future Co-Learning` and `future Judgment Growth` are reserved in this map
only. **DO NOT IMPLEMENT** in this round. No Decision Ledger v2, no judgment model, no Owner model.

---

## 3. The ground: kernel candidates

### 3.1 `state-core` — `KERNEL_CANDIDATE`

Durable state and event journal substrate, Phase 02. It is the most foundation-like thing in the tree: it
owns exactly one namespace (`state-core:migration`) and its only declared outward dependency is
`persistence`. The ratchet's own record says it joined the composition root *"as the durable state and event
substrate"* (24 → 25 boot modules) with **no change to `decision-ledger` ownership**.

*Why it is kernel and not infrastructure:* everything above it would have to be rebuilt without it, and it
has no business opinion. `pnpm run state:probe` exists precisely because the runtime must keep providing
the SQLite features it depends on (WAL, savepoints, `user_version`, durability across reopen, a loud
refusal on a corrupt file) — a kernel's substrate requirements being *measured* is the right shape.
*Caveat:* it migrates `tenx`'s store on behalf of `persistence`'s `decision-ledger` (see
`STRUCTURAL_HEALTH_BASELINE.md` `CROSS_DOMAIN_STATE_ACCESS` CS-5). That is one of the few places the
foundation knows a building's name.

### 3.2 `persistence` — `KERNEL_CANDIDATE`

Owns **20 of the 32** declared durable namespaces — `tasks`, `history`, `experience`, `project-state`,
`runtime-resources`, `runtime-budget`, `decision-ledger`, `attachments`, `interventions`,
`node-registry`, `permission-manifest`, `provider-capabilities`, `session-lifecycle`, `task-contexts`,
`workspaces`, `workspace-selection`, `api-settings`, `app-state`, `external-sessions` and more. Zero
ownership conflicts are reported, which is a genuinely strong result for a foundation layer.

*Why it is kernel:* it is the land. Removing it removes every building's store.
*Caveats, and they matter:* `persistence` is a kernel module that **imports `tenx`'s
`runtime-intelligence/live-capture`** (`electron/bootstrap/persistence.ts:24`), and it installs `tenx`'s
capture into its own task ledger. So the foundation currently reaches up into a district. It also declares
`src/shared/compatibility.ts` while the same path is declared `exempt` — a foundation holding a
compatibility shim.

### 3.3 Kernel boundary note

The declared layer model has exactly two layers: `kernel` (4: `persistence`, `providers`, `runtime`,
`state-core`) and `feature` (23). **No `infrastructure` layer exists** (`scripts/architecture.cjs:63`).

That is itself a finding. The Owner's target model is `kernel → infrastructure → capability`, but the
current tree has no middle tier, so "infrastructure candidate" below is a *proposal for a tier that does not
yet exist* — it is not a claim that those systems are already separated. Per §15.9, creating that tier is
city work, not pre-city work.

---

## 4. The roads and pipes: infrastructure candidates

These are shared by several buildings, carry no business opinion, and are the natural first occupants of a
future infrastructure tier.

| System | Why it is a road, not a building | Evidence |
|---|---|---|
| `providers` | The provider/web runtime is a utility every business capability reaches for. It has no product semantics of its own. | consumes `providers`; `provider-capabilities` namespace owned by `persistence` |
| `runtime` | Runtime registry + resource model + tiering. Pure substrate for scheduling and admission. | `runtime-resources`, `runtime-budget` namespaces |
| `node` | Node capability profiler and registry — read by scheduling/advisory paths, owns no business flow. | `node-registry` namespace; `node-profile.ts`, `node-profiler.ts` |
| `src/shared/measurement.ts` (inside `runtime-intelligence`) | Fail-closed measurement and the unified observation schema is a *pipe* that the RI buildings share. | `src/shared/runtime-intelligence/measurement.ts` |

**Shared Capability Sink rule (§15.8) applies here.** Where two buildings both need something, it should
sink into the road rather than one building importing the other. The measured counter-examples —
`research → engineering`, `engineering → learning`, `host-status → learning`,
`tenx → learning` — are exactly the `Research → Quant → Statistics` anti-pattern named in §15.8 and are
recorded as `DIRECT_LATERAL_DEPENDENCY` in `STRUCTURAL_HEALTH_BASELINE.md`.

---

## 5. The buildings: atomic capabilities

Each owns one purpose, its own state, its own tests. These are the closest things to a genuine 1×1 plot in
the current tree.

### 5.1 Domain-flow atoms

| Capability | Single responsibility | State |
|---|---|---|
| `tasks` | Task state / task ledger | `tasks` |
| `task-creation` | Task intake | (via `tasks`) |
| `dispatch` | Dispatch + role routing (Scheduler, Role Router, Execution Gate live here) | — |
| `conversation` | Conversation surface | — |
| `project` | Project model | `project-state` |
| `workspace` | Workspace selection and scoping | `workspaces`, `workspace-selection` |
| `remote` | External/remote session gateway | `external-sessions` |
| `settings` | Settings surface | `api-settings` |
| `attachments` | Attachment handling | `attachments` |
| `theme` | Theme registry and packages | `theme-registry`, `theme-packages` (owned by `knowledge`) |
| `self-cognition` | Observes the anatomy and reports drift | none (observational) |
| `self-diagnosis` | Reads recorded observations, ranks candidate causes, proposes advisory treatments | none (advisory) |
| `self-case-record` | Append-only timeline of what happened / thought / done | `case-record.jsonl` (undeclared) |
| UI (`src/renderer`) | The desktop shell and surfaces | — |

**Note on `theme`.** It is an atom *by responsibility* but is not an atom *by ownership*: its durable
namespaces `theme-registry` and `theme-packages` are owned by `knowledge`, and `theme` has a declared
required edge `theme -> knowledge`. That is a shared-sink case that has already been *resolved in the wrong
direction* — the namespaces sank into `knowledge`, which is a capability, rather than into the foundation.
Recorded as `MISSING_SURFACE` in the structural baseline.

**Note on the self-\* atoms.** All three are properly atomic, properly bounded (verified by their boundary
suites) and **properly inert** — they observe and advise but cannot change anything. They are also currently
**CLI-only and unregistered in `package.json`**, so they are atoms with no door onto the street yet. That is
an `MISSING_SURFACE` finding, not a classification problem.

### 5.2 `remote` and `identity` adjacency

`remote` is an atom; `identity` is a trust domain. They must not be merged during city work simply because
they are adjacent in the config — one is a gateway, the other adjudicates authority.

---

## 6. The compounds: compound capabilities

| System | Internal capabilities it composes | One external surface? |
|---|---|---|
| `knowledge` | knowledge base, world model, UI surface registry, theme registry | yes — recall/serve |
| `research` | runs, protocols, reviews, contracts (4 namespaces) | yes — plan → execute → review |
| `engineering` | improvement loop, verification engine, review, self-healing, capability-gap | yes — the engineering loop |
| `status` | status, host-status, owner dashboard, acceptance evidence, owner intervention | yes — status reporting |
| `host-status` | host observation, fault-lab, capability matrix | yes — host truth |
| `learning` | adaptive flags, episodes, model snapshots, reranker | yes — adaptation |
| `experience` | experience store + repro snapshots | partial |
| `automation` | automation, telemetry, circuit breaker, recovery | partial |
| `runtime-intelligence` | advisory core, offline evaluation, prospective window + policy freeze, live shadow capture, node telemetry | yes — the advisory report |
| Installer / Bootstrap | `electron/bootstrap/*` composition root, `installer/windows/Installer.cs`, `scripts/package-installer.cjs` | yes — install/upgrade/uninstall |

**`runtime-intelligence` is the largest single arrival in this RC** — 38 files across
`src/shared/runtime-intelligence/` (29) and `electron/runtime-intelligence/` (9), 607 of its own tests, and a
1177-line design doc. It classifies as `COMPOUND_CAPABILITY`, but it is **registered under `tenx`** in
`config/capability-modules.json`, not as its own capability. That mismatch is recorded as
`OVERLARGE_CAPABILITY` / `HIDDEN_COUPLING` and was deliberately not "fixed" during integration (see
`RUNTIME_INTELLIGENCE_INTEGRATION_REPORT.md` §8.4).

`runtime-intelligence` is also, correctly, **advisory only**: its `authority-boundary.test.ts` asserts it
"declares no export that could change or authorize anything". For a pre-city baseline that is exactly the
right posture — it is a building that observes the city and cannot command it.

---

## 7. Districts: bundles

| System | Why a bundle, not a building |
|---|---|
| `tenx` | "10× coordination" groups `electron/commander`, `electron/fleet`, coordination economics, `resource-model`, `node-capabilities`, `optional-review`, `autonomy-supervisor`, `coordination-store`, and now the entire `runtime-intelligence` plane. That is a district of unrelated responsibilities sharing a name. |

`tenx` is the most significant `BUNDLE` finding. It mixes:
* the **Commander** (a central orchestration surface),
* the **Fleet** (a distinct capability),
* coordination economics (a modelling concern),
* resource and node models (infrastructure candidates),
* and, since this RC, the whole Runtime Intelligence plane.

Per §15.9 (*Core Growth Ban*) and §15.3 (*minimum stable closure*), the city phase should expect `tenx` to
dissolve into several plots rather than become one large building. **Not split in this round.**

---

## 8. Trust domains

Highest sensitivity. §8 of the task: default-high, do not touch without proof of a real compatibility
conflict and a restoration (not a change) of semantics.

| System | What it adjudicates | Root Trust relevance |
|---|---|---|
| `promotion` | promotion gate, self-evolution authority, `src/shared/root-authority/`, `trust-policy/` surface generation | **yes** — Root Trust Surface producer |
| `security` | machine identity, `credential-boundary/`, GitHub guardian policy | **yes** — the credential boundary |
| `identity` | identity | yes — adjacent to the credential boundary |
| Qualification (not declared) | reads `trust-policy/trust-epoch.json` — epoch **24**, `boss-root-trust-24`, surface hash `6eaf71e9…` | **yes** — the qualification gate itself |
| `engineering` + `status` (partially) | via `acceptance-contracts.ts`, `acceptance-evidence.ts`, `bootstrap-audit.ts`, `owner-intervention-ledger.ts` | **yes** — these are Root Trust Surface members |

**Required-check declaration** lives at `src/shared/promotion-checks.ts:35` =
`["quality","unit","acceptance","package"]`, enforced against `.github/workflows/ci.yml` by
`tests/unit/promotion-gate.test.ts`. It is a trust-domain artefact and was **not modified** in this RC.

**`trust-policy/requirement-retirements.json` is `[]`** — no requirement is retired. Nothing in this RC
lowered a threshold, and no trust-epoch advance was performed (verified: no Root Trust Surface file appears
in either integration merge's diff).

**Future rule (§15):** a trust domain is land-use-zoned. Nothing may be built inside it by a capability
migration; changes there are their own authorised act.

---

## 9. Bridges and shims

Legitimate now; must not become foundation.

| System | Bridge role | Risk if it becomes foundation |
|---|---|---|
| `src/shared/self-diagnosis.ts` (AP26 file) | Legacy pure failure-clustering lineage. Still imported by `electron/self-engineering/diagnosis.ts:2-3` and `src/shared/correction.ts:10`. Now shares its module specifier with the new `src/shared/self-diagnosis/` directory. | Two lineages behind one name; readers cannot tell which diagnosis they are getting. The `MODULE_SPECIFIER_COLLISION` finding. |
| `src/shared/compatibility.ts` | Declared **both** owned by `persistence` and `exempt`. | A foundation that is also an exemption is neither. |
| `electron/self-engineering/**` | Unwired legacy engineering path. | Dead weight mistaken for a live surface. |
| `src/shared/self-diagnosis.ts` | see above | — |
| `host-maturity-flags.ts` | Defines flags that **no code reads**. | A control surface that controls nothing. |
| `electron/tenx/host-adapter.ts` | A non-exported, unimplemented "port". | An interface believed to exist that does not. |

> **bridge may exist, but bridge must not become foundation.**

---

## 10. Unknowns

`UNKNOWN` is used honestly, never as a placeholder for "I did not look".

| System | Why `UNKNOWN` | What would settle it |
|---|---|---|
| `electron/capability/**` (broker, authorization, plugin host, credential references) | The entire layer has **no production consumer**. `electron/main.ts:910` constructs `new ExecutionGate()` **with no authorizer**, so capability authorization is dead in the shipped wiring. Its minimum stable closure cannot be observed because nothing observes it. | Deciding whether it is (a) an unimplemented intended kernel, (b) a bridge to be retired, or (c) a dead branch. This is a genuine city-phase question. |
| `electron/self-engineering/**` | Unwired. | Same decision. |
| Adaptive reranker | Present but not wired into the live decision path. | Whether deliberate. |
| Per-capability disable paths | Only `adaptive-flags.ts` (5 flags, default OFF) and `EvolutionKillSwitch` are real. All 27 manifests declare `permissions: []` and `surface: []`, so nothing is derivable from declarations. | A declared, enforced disable surface per capability. |
| `future Co-Learning` | **Reserved only. Not implemented, by instruction (§16).** | Nothing this round. Explicitly out of scope. |
| `future Judgment Growth` | **Reserved only. Not implemented, by instruction (§16).** | Nothing this round. Explicitly out of scope. |

**Explicit non-goals recorded here so the next phase cannot mistake them for oversights:**

```
DO NOT IMPLEMENT  Co-Learning
DO NOT IMPLEMENT  Judgment Growth
DO NOT BUILD      Decision Ledger v2
DO NOT BEGIN      judgment model
DO NOT BEGIN      Owner model
DO NOT CONNECT    Quant
DO NOT ADD        PhD-specific capability
DO NOT BEGIN      Capability City / Kernelization construction
```

---

## 11. What this map implies for the city phase (no work authorised here)

Stated as *findings of the survey*, not as a work order:

1. **A middle tier does not exist.** The Owner's `kernel → infrastructure → capability` target has no
   infrastructure layer today (§3.3). Creating it is the first structural act of the city phase.
2. **`tenx` should be expected to dissolve** into Commander, Fleet, coordination-economics and the Runtime
   Intelligence plane (§7).
3. **The declared dependency graph is not the real one.** 3 declared edges vs **187 measured**
   file-level cross-capability import edges. Any city plan built on the declared graph alone would be
   planning a city that does not exist. The measurement gap itself is a finding
   (`DEPENDENCY_BASELINE.md`; the ratchet scans only 25 declared bootstrap files and is blind to the rest).
4. **The foundation currently reaches upward.** `persistence` (kernel) imports `tenx` (bundle). Per §15.7
   this is the forbidden direction and should be inverted by sinking the shared concern into the road.
5. **Root trust is concentrated, not spread** — `promotion`, `security`, `identity`, Qualification, plus
   `engineering`/`status` acceptance surfaces. The blast radius of city work is bounded and knowable.
6. **Replaceability (§15.4) is not yet supported anywhere.** No system in the tree has a real
   shadow / dual-validate / traffic-switch / drain path. `EvolutionKillSwitch` and `adaptive-flags.ts` are
   the only disable surfaces that exist. The city phase should treat this as absent, not partial.
