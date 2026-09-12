# checkpoint-1 §28 — Requirements Graph (CP6)

Plan of record: `Update-Plan/checkpoint-1.md` §28 — requirement types (§28.1),
the requirement dependency graph (§28.2), the requirement state machine (§28.3)
and acceptance binding (§28.4), continuing §2.2's
`Action → Requirement → Contract Item → WorkBook Section → Source File` chain.

Status: **implemented inside the real WorkBook dispatch and accepted by its own
reproducible gate** (`pnpm run acceptance:requirements`, also a CI step).

---

## 1. What was built

### 1.1 Requirements, types and provenance — §28.1

`src/shared/requirements-graph.ts` (pure) turns the compiled Task Contract into
`RequirementNode`s. Nothing is invented: every node carries the provenance the
contract already established (document, section, heading, declaration kind, item
index) plus the authority (`WORKBOOK` / `USER`) and whether the user may override
it.

Type derivation is a documented table plus text refinement:

| Contract declaration | Requirement type |
| --- | --- |
| GOAL | `GOAL` |
| SCOPE | `FUNCTIONAL` |
| CONSTRAINTS, PERMISSIONS | `CONSTRAINT` |
| INPUTS, DEPENDENCIES | `DEPENDENCY` |
| DELIVERABLES | `DELIVERABLE` |
| ACCEPTANCE_CRITERIA | `ACCEPTANCE` |
| RISK | `PROHIBITION` |
| EXECUTION_STRATEGY | `NON_FUNCTIONAL` |

Refinements, in order: an item marked optional (`(optional)`, `可选`, "nice to
have") becomes `OPTIONAL`; an item phrased as a prohibition (`must not`, `不得`,
`不要`) becomes `PROHIBITION` — which is why a "must not slow checkout" line in a
Constraints section is typed as a prohibition rather than a constraint; otherwise
an appearance item (UI/theme/colour/字体/对比度/CSS/截屏/preview …) becomes
`VISUAL`. Every visual node also carries `visual: true`, so §28.4's visual branch
applies even to a visual acceptance criterion typed `ACCEPTANCE`.

### 1.2 Dependency edges — §28.2

Edges are derived, and **each one states why it exists**:

| Rule | Edge / reason |
| --- | --- |
| every non-goal, non-acceptance requirement serves a goal | `DERIVES` — `"<id>" serves the goal "<goal>"` |
| deliverables/functional items wait for declared inputs and dependencies | `DEPENDS_ON` — `"<id>" cannot be delivered before the declared input/dependency "<dep>"` |
| an acceptance criterion verifies the deliverable it shares its subject with (lexical similarity ≥ 0.25), otherwise all deliverables | `VERIFIES` — similarity, or "no single deliverable matched it" |
| a visual acceptance criterion also verifies the appearance requirement | `VERIFIES` |
| an item that names another requirement id in its own text ("FR-1", "AC-2") | `DEPENDS_ON` — `"<id>" names "<target>" in its own text` |

`depends_on` and `blocks` are kept consistent in both directions, cycles are
detected and reported as a **diagnostic** (never a crash, §2.5), and
`topologicalRequirementOrder` / `readyRequirements` give a dependencies-first
order and the requirements whose dependencies are satisfied.

### 1.3 State machine — §28.3

`REQUIREMENT_TRANSITIONS` encodes the plan's nine states
(`UNSTARTED · READY · RUNNING · BLOCKED · QUARANTINED · IMPLEMENTED · VERIFIED ·
FAILED · SUPERSEDED`) and the legal moves between them; `transitionRequirement`
refuses anything else with the allowed set in the message. `SUPERSEDED` is
terminal, `VERIFIED` may re-open as `RUNNING` when a regression appears, and a
requirement may not jump to `VERIFIED`.

Requirements whose text lives inside a **conflicting section** start
`QUARANTINED`, using the contract-level `isolateRequirements` result the WorkBook
path already computes — so a conflict blocks that requirement only, and the
quarantine reason is the isolation reason.

### 1.4 Acceptance binding — §28.4

`bindAcceptance({ graph, evidence })` attaches `RequirementEvidence` entries
(`IMPLEMENTATION`, `TEST`, `REVIEW`, `PREVIEW`, `SCREENSHOT`,
`VISUAL_VERIFICATION`, `COMMAND`, each with `PASS`/`FAIL`/`MISSING`/`NOT_RUN`,
source, detail, timestamp, optional command/artifact/hash) and decides what may be
called verified:

| Requirement | required evidence |
| --- | --- |
| `ACCEPTANCE` | implementation + test + review (plus visual verification when visual) |
| `VISUAL` or visual flag | implementation + preview + screenshot + visual verification |
| `DELIVERABLE` / `FUNCTIONAL` | implementation + test |
| `GOAL` / `CONSTRAINT` / `PROHIBITION` / `DEPENDENCY` / `NON_FUNCTIONAL` / `OPTIONAL` | implementation |

A missing, `NOT_RUN` or `FAIL` entry leaves the requirement unverified; only
implementation evidence promotes it as far as `IMPLEMENTED`, and `VERIFIED`
requires every required kind to be `PASS`. Quarantined and superseded
requirements are reported but never verified. The report carries `bindings`,
`visual`, `totals` and the explicit `unverified` list.

### 1.5 Production wiring

`electron/commander/workbook-dispatch.ts` builds the graph right after the
contract is compiled and records it on the durable WorkBook record
(`task.workbookDispatch.requirements`), so every later stage (planner, worker
verification, review, Guardian) can cite a requirement id instead of prose.

## 2. Acceptance

`pnpm run acceptance:requirements` runs `tests/acceptance/requirements-graph.test.ts`
(which drives the REAL `runWorkDispatch` with the real ingestion pipeline, a
conflicting two-spec WorkBook and a theme WorkBook) and verifies
`artifacts/acceptance/requirements-graph.json`:

| Item | What it proves | Observations |
| --- | --- | --- |
| R-01 | the durable task carries a typed, provenance-complete graph | 9/9 |
| R-02 | every edge explains itself, the graph is acyclic, orderable, and `depends_on`/`blocks` agree | 8/8 |
| R-03 | the conflicting requirement starts `QUARANTINED` with a reason while the rest stay executable | 5/5 |
| R-04 | the state machine refuses illegal jumps and allows the legal ladder | 9/9 |
| R-05 | an acceptance criterion needs implementation + test + review | 5/5 |
| R-06 | a visual requirement demands preview + screenshot + visual verification | 5/5 |
| R-07 | a claim is not evidence: no evidence verifies nothing, a failing test keeps the requirement open, and only the quarantined ones stay open with complete evidence | 8/8 |
| R-08 | the binding report is versioned, machine-readable and every entry explains itself | 5/5 |

Unit coverage: `tests/unit/requirements-graph.test.ts` (19 cases).

## 3. Honest limitations (not over-claimed)

- **The graph is derived from the contract, not from the code.** A requirement
  is not yet bound to the *files* that implement it — that mapping is CP7's
  execution DAG and CP8's evidence ledger work.
- **Edges are lexical/heuristic where they are not declared.** Acceptance-to-
  deliverable links use token similarity with a recorded threshold; a mismatched
  pair is visible through the edge reason rather than hidden.
- **`VISUAL` typing is keyword-based.** An appearance requirement phrased without
  any visual vocabulary will be typed by its declaration kind instead, and will
  not demand the visual evidence branch.
- **Nothing yet produces the evidence automatically.** `bindAcceptance` decides
  correctly, but the evidence entries in CP6's acceptance are produced by the
  harness, not by the running pipeline; wiring real command/test/review evidence
  into the ledger is CP8/CP9.
- **BLOCKED/FAILED are reachable but not yet driven.** The recovery ladder that
  moves requirements through those states is CP10.
