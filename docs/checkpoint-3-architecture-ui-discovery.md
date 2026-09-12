# checkpoint-1 §6 + §9 — Architecture & UI Surface Discovery (CP3)

Plan of record: `Update-Plan/checkpoint-1.md` §6 (Repository World Model,
dependency graph, existing-capability discovery), §9/§9.1 (UI Surface Registry +
`UISurfaceContract`) and §10 (semantic tokens). §6 preamble states the rule this
checkpoint implements: *"任何工程执行之前，Boss 必须建立 Repository World
Model + UI Surface Model."*

Status: **implemented, wired into the WorkBook discovery path, and accepted by
its own reproducible gate** (`pnpm run acceptance:architecture`, also a CI step).

---

## 1. What was built

### 1.1 Repository World Model — §6.1

`electron/engineering/world-model.ts` reads a workspace once, under hard caps,
and produces the contract in `src/shared/repo-world-model.ts`:

| §6.1 field | How it is observed |
| --- | --- |
| repo root, files, fingerprint | the existing bounded `scanRepo` |
| package managers | lockfiles and manifests actually present |
| languages | per-extension file counts (shared helper, one mapping) |
| entry points | file-name rules (`index.html`, `electron/main.ts`, `main.py`, …) |
| modules | source/test/style/markup files with bytes, exports, imports |
| tests | the scanner's test map, plus per-directory lookup |
| CI | `.github/workflows/*.yml`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci`, `.buildkite` |
| build system | config files (`tsconfig`, `vite.config`, `vitest.config`, `Makefile`, …) and `package.json` scripts |
| runtime | `electron`/`node`/`browser`/`python`/`go`/`rust`/`container`, from manifests and markup |
| git state | `git rev-parse HEAD`, branch and a tracked-file dirty count |
| generated surfaces | the scanner's skip list, with a reason per directory and presence |
| ignored surfaces | which ignore files exist (an observation, not a gitignore evaluation) |
| workspace boundaries | `pnpm-workspace.yaml`, `workspaces`, `lerna.json`, `nx.json`, `turbo.json`, `rush.json`, `go.work` |

Two properties are deliberate and tested:

- **Bounded.** Capped files, bytes per file, total bytes and imports per file;
  `truncated` is set when a cap bites, and the cap never decides *what* the model
  is about — stylesheets, markup, entries and UI components are read first, so a
  truncated model still contains the surfaces §9 needs.
- **Fail-soft per probe.** A missing git binary or an unreadable directory
  degrades one field with a reason instead of failing the model. `detectCi` reads
  only the known provider locations, because a general dot-directory walk hits
  its budget on a large tree long before it reaches `.github` and then reports
  "no CI" — a false claim this checkpoint's first draft actually made.

### 1.2 Dependency graph and impact analysis — §6.2

`buildDependencyGraph` derives `nodes`, relative `edges`, the `reverse`
(downstream) map, `tests_by_module`, `external` packages (platform builtins are
visible in a module's import list but are *not* dependency edges) and
`entries_by_module` by walking each entry point's imports forward.

`impactOf(graph, changed)` answers the plan's three stated uses — impact
analysis, scope inference, repair planning — with `affected_modules`,
`tests`, `runtime_entries`, `external_dependencies`, `untested` and the reasons
for each. Paths that are not modules of the repository are dropped with an
explicit reason instead of widening the scope.

Import extraction strips line and block comments first (so a commented-out
import is not a dependency), and resolves `./helper.js` to `helper.ts` the way
ESM-authored TypeScript actually does.

### 1.3 Existing capability discovery — §6.3

`probeCapability` answers the plan's four-way question with evidence:

| Verdict | Condition |
| --- | --- |
| `EXISTS` | an implementing module matches **and** non-test code imports it (or it is an entry point) |
| `PARTIAL` | matched, but the implementation is orphaned — nothing imports it, or only tests do |
| `RESERVED` | only declarations/types match; there is no implementation |
| `MISSING` | no evidence at all |

Matching is strict on purpose: a module counts only when **one identifier** (a
path segment, the file stem, or a single exported symbol) carries a majority of
the capability's significant terms. Scattered terms are not evidence — without
that rule, "sandbox broker daemon" matched this repository because it has a
sandbox, and `WorkDispatchKnowledge` + `WorkDispatchStore` made
`workbook-production.ts` look like "a knowledge store". Both false positives were
found by this checkpoint's own acceptance and fixed.

On this repository the probe now reports, for example:
`knowledge write gate` → `EXISTS` via `src/shared/knowledge-object.ts#gateKnowledgeWrite`;
`sandbox broker daemon` → `MISSING`; `knowledge catalog store` → `PARTIAL`
("only test code imports it; the product never reaches it") — which is the same
dead-store finding the CP2 audit reached by hand.

### 1.4 UI Surface Registry — §9/§9.1/§10

`src/shared/ui-surface-ids.ts` holds the plan's 23 surface ids exactly once;
`src/shared/ui-surface.ts` holds the category vocabulary, the §10 token groups,
the locked default contract per surface (`allowedProperties`, `defaultTokens`,
`fallback`) and the fail-closed validation.

`electron/engineering/ui-surface-discovery.ts` fills `componentBindings` with
**observed** evidence only:

- stylesheet classes are read in selector position, and code files contribute
  only `className` literals — a CSS-style dot scan over `.tsx` turns
  `document.body` into a fake class `.body`, which the first draft did;
- element/pseudo selectors (`body`, `:root`, `::-webkit-scrollbar`) are recorded
  as `css-selector` bindings, never disguised as classes;
- a surface with nothing observed goes into `unbound` — reported, never invented,
  and a registry that contradicts itself (bound but listed unbound, unknown
  token, missing contract) fails validation and is refused by the store.

`validateSurfaceOverride` implements §9.1 + §20 at the contract level:
`UNKNOWN_SURFACE`, `UNKNOWN_PROPERTY`, `UNKNOWN_TOKEN`, `UNSAFE_VALUE`
(`javascript:`, `expression(`, `@import`, external `url(...)`), `EMPTY_VALUE`,
`LOCKED_SURFACE`.

### 1.5 Production wiring

- `electron/main.ts` (composition root) builds the model and the registry for a
  task's workspace, persists them (`<userData>/.boss/world-model/<id>.json`,
  `<userData>/.boss/ui-surfaces.json`) and passes the builder into
  `runWorkDispatch`.
- `electron/commander/workbook-production.ts` threads it into intake, and
  `workbook-dispatch.ts` records `discovery.world_model` /
  `discovery.ui_surfaces` on the durable WorkBook record — with a
  `world_model_error` diagnostic instead of a task failure when it degrades.

## 2. Acceptance

`pnpm run acceptance:architecture` runs `tests/acceptance/architecture-discovery.test.ts`
and verifies `artifacts/acceptance/architecture-discovery.json`.

| Item | What it proves | Observations |
| --- | --- | --- |
| A-01 | §6.1 on a fixture monorepo: managers, build tools, runtimes, CI, tests, generated trees excluded, workspace boundary with evidence | 9/9 |
| A-02 | §6.1 on **this** repository: pnpm, tsc/vite/vitest, its own CI workflow, electron/node runtimes, `electron/main.ts` as an entry point, git head/branch | 11/11 |
| A-03 | §6.2 graph: relative edges, downstream map, externals without builtins, entry reachability | 7/7 |
| A-04 | §6.2 impact analysis on the fixture and on this repository | 6/6 |
| A-05 | §6.3 exists / partial / missing verdicts with cited evidence on this repository | 8/8 |
| A-06 | §9/§9.1 all 23 surfaces with contracts, §10 tokens and fallbacks | 8/8 |
| A-07 | §9 bindings are observed in the real renderer (incl. the honest SCROLLBAR gap) | 10/10 |
| A-08 | §9.1/§20 overrides fail closed with machine-readable codes | 5/5 |
| A-09 | the real `runWorkDispatch` records both summaries and persists both artifacts | 11/11 |
| A-10 | the persisted model survives a restart and two builds of one tree agree | 6/6 |

The desktop WorkBook black box (`scripts/acceptance-desktop-workbook.cjs`) gained
7 claims proving the same establishment happens inside the real Electron app for
a UI-driven dispatch (61/61 claims).

Unit coverage: `tests/unit/repo-world-model.test.ts` (16),
`tests/unit/ui-surface.test.ts` (14), `tests/unit/world-model-builder.test.ts` (14).

## 3. Honest limitations (not over-claimed)

- **The `--boss-*` token layer does not exist yet, and the registry says so.**
  `tokens_applied: false`, `tokens_declared: 0`: this repository's colours are
  hardcoded literals today. Migrating them into §10 tokens and locked built-in
  themes is CP4/CP5, not this checkpoint.
- **`SCROLLBAR` is unbound.** The stylesheet only sets `scrollbar-width: thin`;
  there is no scrollbar rule to bind to. The registry reports it as unbound and
  the candidate selector is ready for CP4 to pick up.
- **Import scanning covers TS/JS-style imports** (`import`, `export from`,
  `require`, dynamic `import`). Other languages are listed as modules with
  language, exports and bytes, but their imports are not parsed yet.
- **Capability discovery is lexical, not semantic.** It is deliberately strict
  and evidence-citing, but a capability whose name shares no vocabulary with its
  implementation will read as `MISSING`; that is a recall limit, not a claim of
  correctness.
- **The model is a snapshot.** It is not yet re-validated before every task by a
  cheap signature check (`repoScanSignature`), so a task in a workspace whose tree
  changed after the model was built reuses the earlier fingerprint; today the
  model is rebuilt per WorkBook dispatch.
- **The graph is bounded by the same module cap as the model.** A truncated model
  yields a truncated graph, and `truncated` says so.
