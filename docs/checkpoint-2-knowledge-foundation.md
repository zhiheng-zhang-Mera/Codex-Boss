# checkpoint-1 §5 — Knowledge Foundation (CP2)

Plan of record: `Update-Plan/checkpoint-1.md` §5 (Knowledge Object, provenance,
write gate, conflict handling, task-aware retrieval) and its Phase 1 DoD
("same project second task" reuses the first task's architecture, constraints,
test knowledge, prior decisions and UI-surface knowledge without rescanning all
context).

Status: **implemented, wired into the running app, and accepted by its own
reproducible gate** (`pnpm run acceptance:knowledge`, also a CI step).

---

## 1. What the audit found before this change

A read-only audit of the repository (HEAD `fc86021`) established the starting
point, and it is worth recording because it is the reason this checkpoint builds
a new foundation instead of "finishing" an old one:

- **Four mutually incompatible knowledge record types** already existed:
  `KnowledgeEntry` (`src/shared/knowledge.ts`), a *second, different*
  `KnowledgeEntry` (`src/shared/knowledge-space.ts`), `KnowledgeRecordVNext`
  (`src/shared/tenx/knowledge.ts`) and `KnowledgeItem`
  (`src/shared/workbook-knowledge.ts`). None of the 17 vocabulary values the plan
  requires (`ARCHITECTURE`, `TEST`, `DECISION`, …) existed anywhere.
- **Five persisted file schemas** and **three store classes** (`KnowledgeStore`,
  `KnowledgeGovernanceStore`, `KnowledgeSpaceStore`) plus `TenxKnowledgeSpace`.
- **None of them was reachable from `electron/main.ts`**: the string `knowledge`
  did not appear in that file at all, and `ContextManager.setKnowledgeProvider`
  had zero callers. The prompt path contained no knowledge section.
- `KnowledgeStore.put` **silently deleted** the superseded row from disk
  (`electron/knowledge/knowledge-store.ts`), i.e. the one existing "supersede"
  was destructive.
- "No source ⇒ no knowledge" existed only inside the tenx pipeline
  (`validateCandidate`), and nothing anywhere separated a *producer* from a
  *verifier*, so a model claim could be recorded as if it were established fact.

## 2. What this checkpoint adds

### 2.1 The unified model — `src/shared/knowledge-object.ts` (pure)

`KnowledgeObject` carries exactly the §5.1 fields (`id, type, scope, source,
content, summary, provenance, confidence, authority, freshness, createdAt,
updatedAt`) plus the identity/versioning the plan's later phases need
(`subject`, `key`, `status`, `supersedes`, `conflict_set`, `version`).

- `KNOWLEDGE_TYPES` — all 17 §5.1 values, declared once.
- `KnowledgeObjectProvenance` — §5.2 in full: `source`, `source_hash` (sha256),
  `document_ref`/`task_ref`/`run_ref` (at least one is mandatory),
  `captured_at`, `producer` (`HUMAN` | `VERIFICATION` | `DETERMINISTIC_HOST` |
  `MODEL`), `produced_by`, `verification` (`VERIFIED` | `UNVERIFIED` |
  `CONTRADICTED`) and `verification_evidence`.
- `KnowledgeAuthority` (`OWNER`, `WORKBOOK`, `VERIFIED_HOST`, `HOST`,
  `REVIEWER`, `MODEL`, `INFERRED`) — a rank, deliberately *not* reusing
  `ContractAuthority`/`RootAuthority`/`ContractDeclaration.authority`, which are
  different concepts that already own those names.
- Reuse instead of duplication: `KnowledgeScope` and `TemporalValidity` come from
  `src/shared/tenx/knowledge.ts`, lexical similarity is its existing
  `tokenSimilarity`, and content hashing is `contentHashOf` from
  `src/shared/workbook.ts`. No fifth tokenizer and no fifth sha256 helper.

### 2.2 The write gate — `gateKnowledgeWrite()`

`candidate → PROVENANCE → CONSISTENCY → AUTHORITY → VERIFICATION → GATE`, with
the §5.3 vocabulary `ACCEPT | REJECT | QUARANTINE | SUPERSEDE` and a recorded
phase list, so *why* a fact is or is not knowledge is answerable.

Fail-closed rules, each with a unit test:

| Situation | Outcome |
| --- | --- |
| missing source / non-sha256 hash / no document-task-run ref / bad producer | `REJECT` (nothing stored) |
| empty type, subject, summary or content; over-long content; out-of-range confidence | `REJECT` |
| secret-shaped content (`scanSecrets`) | `REJECT` — §50 boundary applies to knowledge too |
| `VERIFIED` with no verification evidence | `REJECT` |
| `CONTRADICTED` | `REJECT` |
| model-produced, model-authority, unverified | `QUARANTINE` (a model cannot certify itself, §5.2) |
| strictly stronger than the active fact (authority → verification → freshness) | `SUPERSEDE` |
| strictly weaker than the active fact | `QUARANTINE` + conflict set |
| equal strength, different content | `QUARANTINE` + conflict set left `UNRESOLVED` |
| byte-identical fact at the same standing | `ACCEPT` (deduplicated, nothing written) |

An explicit `supersedes` request (an AMENDED WorkBook revision replacing its
predecessor) selects its target, but is honoured **only at equal or greater
strength** — otherwise naming a fact would be a way around the authority check.
Self-review found that hole and it is now pinned by a regression test.

### 2.3 Conflict handling — `resolveKnowledgeConflict()` / `decideConflict()`

A conflict records a **conflict set** whose members each carry authority,
freshness, source hash, verification state and the claim text, and then decides
`ACTIVE | SUPERSEDED | UNRESOLVED`. Nothing is ever deleted: a superseded object
stays in the base with `status: "SUPERSEDED"`, and a quarantined claim stays in
the quarantine area with the conflict's decision as its status.
`KnowledgeBase.decideConflict()` is the owner surface for closing an
`UNRESOLVED` set; the loser is marked, never removed, and if the owner picks the
parked challenger it is **promoted into the active set** (exactly one ACTIVE
revision, version 1, linked to the conflict set) instead of being marked active
inside the quarantine area where nothing could read it.

### 2.4 Task-aware retrieval — `selectKnowledgeForTask()` / `renderKnowledgeSection()`

`task → TaskFingerprint → relevant objects → authority → freshness → semantic
relevance → budget`, in exactly that order:

1. `TaskFingerprint` is built with the engine's own
   `buildStructuralFingerprint` (role, capabilities, modality, concepts).
2. Type relevance is a **filter** (`knowledgeTypeWeights`): a UI task is not
   offered the test layout, a coding task is not offered a theme token.
3. Ordering is authority rank → freshness → lexical relevance → id.
4. Hard limits: `characterBudget` and `maxObjects`. Every candidate appears in
   the returned `ranking` with a reason, so a report can show what was dropped
   and why; `not_offered` counts the type-filtered objects.

### 2.5 Extraction — `src/shared/knowledge-extraction.ts` (pure)

Knowledge is *derived from bytes the host already read*, never requested from a
model:

| Type | Source |
| --- | --- |
| `ARCHITECTURE` | the bounded repository model the discovery stage scanned |
| `TEST` | the test map (capped) |
| `UI_SURFACE` | renderer/UI/markup files (capped) |
| `CONSTRAINT` | every compiled contract constraint item (authority `WORKBOOK`) |
| `REQUIREMENT` | goal, deliverables and acceptance criteria items |
| `DECISION` | the durable dispatch outcome, classification and reason |

To make this possible without a second scan, the discovery stage now records a
bounded `RepositoryModelSummary` (`top_level`, `manifests`, `entry_points`,
`test_files`, `ui_surface_files`, `languages`, `truncated`) on the durable
WorkBook record (`src/shared/workbook-dispatch.ts` +
`repositoryModelFrom()` in `electron/engineering/repo-inspector.ts`). Every list
is capped, so one large repository cannot flood a durable record or a prompt.

### 2.6 Durable base and facade

- `electron/knowledge/knowledge-base.ts` — one JSON file
  (`<userData>/.boss/knowledge-base.json`): append-only objects, a quarantine
  area, conflict sets and an append-only gate log. A corrupt file is reported
  through `loadFailure()` and never stops Boss from starting (§2.5).
- `electron/knowledge/knowledge-foundation.ts` — the facade the app talks to:
  `projectScopeFor()`, `recordWorkBookDispatch()`, `sectionForTask()`,
  `retrieve()`, `summary()`, `evidence()`. Every entry point catches its own
  failures: a knowledge write can never fail a task.

### 2.7 Production wiring (the part that did not exist before)

- `electron/main.ts` — one composition-root instance
  (`new KnowledgeFoundation(new KnowledgeBase(...))`), exactly like the decision
  ledger, plus `contextManager.setKnowledgeSectionProvider(...)`, which builds a
  task's section from the durable base.
- `electron/commander/workbook-production.ts` — `runWorkDispatch` records the
  dispatch's facts through the gate on every terminal branch (BLOCKED,
  ANALYSIS_ONLY, NO_AUTO_RUN, DISPATCHED, RECOVERY_WAITING, FAILED), through an
  optional injected dependency, with `onKnowledgeDiagnostic` for failures.
- `electron/commander/context-manager.ts` — `assemble()` appends a
  `PROJECT_KNOWLEDGE:` section, capped at a third of the remaining budget so
  knowledge can never crowd out the objective. With no provider attached the
  assembled string is **byte-for-byte unchanged**, which the
  `tests/unit/context-knowledge-section.test.ts` regression pins.

## 3. Acceptance

`pnpm run acceptance:knowledge` runs `tests/acceptance/knowledge-reuse.test.ts`
and verifies the machine-readable report at
`artifacts/acceptance/knowledge-foundation.json`.

| Item | What it proves | Observations |
| --- | --- | --- |
| K-01 | the production dispatch records architecture/test/UI/constraint/requirement/decision knowledge by itself, all provenance-complete and host-verified | 16/16 |
| K-02 | a second WorkBook task in the same project reuses the *first* task's facts with the project directory deleted and zero repository reads | 17/17 |
| K-03 | a self-certified model claim is quarantined and the verified fact is unchanged | 6/6 |
| K-04 | a fresh process reloads the base and still serves the project's knowledge | 5/5 |

The K-02 proof is deliberately hostile: after the second dispatch the project
directory is removed, so no rescan and no file read can produce the reused facts;
the retrieval reports `repositoryReads === 0`, the reused provenance task refs
are the *first* task's, and the second task's own facts are excluded from its own
context.

Unit coverage: `tests/unit/knowledge-object.test.ts` (28 cases),
`tests/unit/knowledge-foundation.test.ts` (11 cases),
`tests/unit/context-knowledge-section.test.ts` (4 cases).

## 4. Honest limitations (not over-claimed)

- **Live provider execution stays `NOT_RUN`.** Knowledge is host-derived; no
  model input is recorded, and nothing in this checkpoint claims model-assisted
  knowledge.
- **Intake still scans the repository.** Discovery must establish the current
  fingerprint for the task it is compiling; what this checkpoint removes is the
  need to *re-derive knowledge* — the second task's context comes from the base.
  Eliminating the intake scan itself (a content-addressed incremental scan keyed
  by `repoScanSignature`) remains future work and is not claimed here.
- **Lexical relevance, not embeddings.** `tokenSimilarity` is the existing
  deterministic overlap function; `TaskFingerprint.semanticVectorRef` is carried
  but no embedding backend is wired.
- **The older knowledge modules are untouched.** `KnowledgeEntry`,
  `KnowledgeRecordVNext`, `KnowledgeItem`, the three dead stores and the tenx
  pipeline still exist; migrating or retiring them is a later, separate change
  (the plan forbids rewriting modules that already pass their own tests).
- **`UNRESOLVED` is a parking state, not a resolution.** An equal-strength
  contradiction stays visible and needs an owner decision
  (`KnowledgeBase.decideConflict`); nothing picks a winner by coin flip.
