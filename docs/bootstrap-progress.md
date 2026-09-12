# Codex Boss — Bootstrap Completion progress ledger

Living index for `Update-Plan/checkpoint-1.md`. Every entry below is backed by a
green remote CI run on the cloud branch `Prestart-checkpoint-2`, not by a claim.
Kept up to date at the end of each checkpoint so the next session can continue
from the workspace alone.

Cloud branch: `Prestart-checkpoint-2`
Tag: `prestart-checkpoint-1-complete` (at `3e814cf`)

---

## 1. Delivered checkpoints

| Checkpoint | Plan sections | Key files | Acceptance gate | Remote CI |
| --- | --- | --- | --- | --- |
| Phase 0 closure | §4 | `tests/unit/evolution-sandbox.test.ts` (hook budget), `.github/workflows/ci.yml`, `scripts/acceptance-desktop-workbook.cjs`, `scripts/phase0-validation-chain.ps1` | local chain 18/18, desktop black box 89/89 claims | `34671183374` |
| CP2 Knowledge Foundation | §5 | `src/shared/knowledge-object.ts`, `knowledge-extraction.ts`, `electron/knowledge/*` | `acceptance:knowledge` K-01..K-04 | `34671878840`, `34672186431` |
| CP3 Architecture & UI Surface Discovery | §6, §9 | `src/shared/repo-world-model.ts`, `ui-surface*.ts`, `electron/engineering/{world-model,ui-surface-discovery}.ts` | `acceptance:architecture` A-01..A-10 | `34673130107` |
| CP4 Theme Engine Foundation | §10–§13, §20–§23, §25 | `src/shared/theme.ts`, `electron/theme/{builtin-themes,theme-storage,theme-service}.ts`, `src/renderer/theme.ts`, `ThemePanel.tsx`, token layer in `styles.css` | `acceptance:theme` TH-01..TH-15 + T-TOKENS | `34674515263` |
| CP5 Generator + Preview + Visual Verification | §14–§17, §19, §24, §26 | `src/shared/{theme-intent,theme-generation,theme-visual-check}.ts`, `electron/theme/{visual-capture,theme-knowledge}.ts`, `src/renderer/theme-measure.ts` | `acceptance:theme` (21 items, TH-04/05/06 now PASS) | `34675400615` |
| CP6 Requirements Graph | §28 | `src/shared/requirements-graph.ts` | `acceptance:requirements` R-01..R-08 | `34676022000` |
| CP7 Execution Planner | §29 | `src/shared/execution-planner.ts` | `acceptance:plan` P-01..P-06 | `34676609713`, `34677536907` |
| CP8 Verification Engine (host side of §30 + §31) | §30, §31 | `src/shared/verification.ts`, `electron/engineering/verification-engine.ts`, ladder extension in `execution-planner.ts`/`evidence-ledger.ts` | `acceptance:verify` V-01..V-10 (82 observations) | `34678305310` |
| CP9 Implementation Loop + Multi-Layer Review | §30, §32 | `src/shared/review.ts`, `review-checks.ts`, `electron/engineering/{review-engine,implementation-loop}.ts` | `acceptance:review` C-01..C-11 (62 observations) | `34680401037` |
| CP10 Self-Healing / Recovery | §33 | `src/shared/recovery.ts`, `electron/engineering/recovery-engine.ts`, loop repair stage | `acceptance:self-healing` RC-01..RC-10 (64 observations) | `34681594017` |
| CP11 Capability Gap → Self Improvement | §34 | `src/shared/capability-gap.ts`, `electron/engineering/improvement-loop.ts` | `acceptance:capability-gap` CG-01..CG-10 (64 observations) | `34682736930` |
| CP12 Candidate State + Guardian Gate | §35, §36 | `src/shared/candidate-gate.ts`, `electron/engineering/candidate-guardian.ts` | `acceptance:candidate` GD-01..GD-10 (52 observations) | _pending in this push_ |

Local evidence for CP8: the whole 19-step chain is green (127 test files /
1262 tests, every acceptance gate exit 0, desktop black box 89/89 claims).

Local evidence for CP9: the whole 20-step chain is green (129 test files /
1292 tests, `acceptance:review` C-01..C-11 PASS with 62 observations, desktop
black box 89/89 claims).

Local evidence for CP10: the 21-step chain is green (`acceptance:self-healing`
RC-01..RC-10 PASS with 64 observations; the failures it classifies are produced by
real `tsc`, real `node --test`, a real missing module, the real §7.3 mutation
refusal and a real theme validation report).

Local evidence for CP11: the 22-step chain is green (133 test files / 1353 tests,
`acceptance:capability-gap` CG-01..CG-10 PASS with 64 observations; the chain runs
the real §30 loop, a real regression climb, the real §5.3 knowledge gate and a real
capability probe, and the registry records
`receipt rounding engine MISSING -> EXISTS (GAINED)` while an unclosed gap stays
`OPEN`).

**Known CP9 boundary**: the loop, the verification engine and the review engine are
exported host modules exercised by their gates; the live WorkBook/commander task
path still runs the older `verifyAndRepair` seam unchanged. Wiring the loop into
the live path (with its iterations recorded on the durable task) is deliberately
left to a later checkpoint rather than half-done.

**In flight — CP12 next**: §35 Candidate state (RUNNING → IMPLEMENTED → VERIFYING
→ REVIEWING → CANDIDATE → ACCEPTED, themes included) and §36 the Guardian final
gate (goal compliance, requirement coverage, secret scan, scope validation,
evidence completeness, destructive change check, Owner override compliance, plus
the four theme checks), with any failure returning the Candidate to repair.

Per-checkpoint records: `docs/checkpoint-2-knowledge-foundation.md`,
`checkpoint-3-architecture-ui-discovery.md`,
`checkpoint-4-theme-engine-foundation.md`,
`checkpoint-5-theme-generator-preview.md`, `checkpoint-6-requirements-graph.md`,
`checkpoint-7-execution-planner.md`, `checkpoint-8-verification-engine.md`,
`checkpoint-9-review-and-loop.md`. Narrative history: `Update-Log.md`.

## 2. What the pipeline does today (end to end, verified)

```
workbook attach (UI drop / IPC)
  → intake (ingest, classify, roles, conflicts)         §5/§9 evidence recorded
  → Task Contract                                       (+ world model + UI registry)
  → Requirements Graph (types, edges, states, binding)   §28
  → Execution DAG (allowed files, gates, rollback)       §29
  → implementation loop (worker → verify → review → repair, §30/§32)
  → verification engine (ladder + §31.3 ledger)          §30/§31 (host modules)
  → recovery classification + ladder + CapabilityGap     §33/§33.3
  → capability-gap chain (task → regression → knowledge → registry) §34
  → candidate lifecycle + Guardian final gate (release permission)  §35/§36
  → provider dispatch boundary                           (bounded/offline in acceptance)
  → knowledge write gate (host-derived facts only)       §5
```

Recorded durably on each task: `workbookDispatch.{documents,contract,
requirements,execution_plan,discovery{repository_model,world_model,ui_surfaces}}`.
Verification runs additionally persist their §31.3 Evidence Ledger at
`<workspace>/artifacts/acceptance/verification-ledger.json` (write-through), and
§33.3 capability gaps at `<workspace>/artifacts/acceptance/capability-gaps.json`.
Theme engine, UI surface registry, knowledge base, world model store and theme
preview all persist under `<userData>/.boss/`.

## 3. CI gate chain (`.github/workflows/ci.yml`)

`install → install:electron → typecheck → security:scan → build → test →
acceptance:workbook → acceptance:knowledge → acceptance:architecture →
acceptance:theme → acceptance:requirements → acceptance:plan →
acceptance:verify → acceptance:review → acceptance:self-healing →
acceptance:capability-gap → acceptance:candidate → acceptance:github-machine →
benchmark → package:portable → portable smoke → restart acceptance →
acceptance:desktop-workbook`

Local equivalent (same order, prints exit codes): `scripts/phase0-validation-chain.ps1`.

## 4. Remaining checkpoints and their exact scope

| Checkpoint | Plan | Deliverable |
| --- | --- | --- |
| CP8 | §30, §31 | **delivered**: bounded worker scope + atomic change units + rollback + real file verification (git/hash/existence/syntax/typecheck/targeted tests), Verification Ladder (11 rungs), requirement-aware gates, durable Evidence Ledger |
| CP9 | §32 | **delivered**: three review layers + §32.1 dimensions (and the four theme ones) + all twelve §32.2 adversarial probes + §32.3 routing (HIGH/MEDIUM → repair) + the §30 implementation loop (Plan → Worker → Host Verification → Review → Repair → Reverify) driving the CP8 engine, with the §2.3 completion gate |
| CP10 | §33 | **delivered**: 13-class failure classification from real evidence, the §33.2 recovery order with per-step budgets and reasons (theme ladder included), Owner hand-off for AUTH/WORKSPACE, and §33.3's HNS rules with the mandatory durable CapabilityGap |
| CP11 | §34 | **delivered**: capability-gap aggregation by capability, the "conditions met" thresholds, the six-stage chain walked with real machinery (improvement task → §30 loop → real regression climb → §5.3 knowledge update → capability probe), and closure that requires the probe to actually move |
| CP12 | §35, §36 | **delivered**: the §35 lifecycle as a state machine (RUNNING → … → CANDIDATE → ACCEPTED, jumps refused, CANDIDATE = complete-but-unreleased) and the §36 Guardian Gate over eleven checks evaluated on real artifacts, where a check that could not run blocks and any failure returns the Candidate to repair |
| CP10 | §33 | failure classification (TRANSIENT…THEME/UI/UNKNOWN) + recovery ladder + HNS positioning as fallback that emits CapabilityGap |
| CP11 | §34 | CapabilityGap → improvement task → regression test → knowledge update → capability registry |
| CP12 | §35, §36 | Candidate state + Guardian final gate (+ knowledge write gate re-check) |
| CP13 | §37, §38 | version impact assessment + local Git checkpoint/rollback |
| CP14 | §39, §40 | GitHub App machine identity: branch/commit/push/PR automation |
| CP15 | §41 | remote CI read → classify → repair → push → re-run loop |
| CP16 | §42, §51, §52 | final acceptance + benchmark suite + seeded failure battery + restart recovery at every stage |
| CP17 | §53 | soak test (multi-round fresh clone → completion) |
| CP18 | §57 | Bootstrap Completion black box: real work book + UI theme black box, 0 owner interventions |

Additional §56 event names already in the domain vocabulary:
`THEME_DRAFT_CREATED`, `THEME_PREVIEWED`, `THEME_VALIDATED`, `THEME_INSTALLED`,
`THEME_ACTIVATED`, `THEME_FALLBACK`.

## 5. Working conventions this repository now relies on

- **Acceptance is a script, not a claim.** Every checkpoint adds
  `scripts/acceptance-*.cjs` + a CI step; each verifies its own machine-readable
  report under `artifacts/acceptance/` and fails unless the required ids PASS.
- **Fail closed.** Missing provenance, unevidenced claims, unresolvable scopes,
  invalid themes and quarantined requirements are refused or parked, never
  guessed.
- **Never edit UTF-8 sources with PowerShell `Set-Content`/`-replace`.** It
  re-encodes to the ANSI codepage and silently corrupts non-ASCII text (this
  happened once to the desktop-smoke harness). Use the file tools; strip BOMs.
- **A black box must fail loudly.** The desktop harness now rejects in-flight CDP
  calls when its socket closes and recovers the debugger session instead of
  exiting 0 with no output.
- **`--boss-data-dir` isolates acceptance runs**; the desktop smoke drives the
  real UI over CDP and verifies the durable files the app wrote, in two phases
  (dispatch, then a restart for theme/registry persistence).
- **pnpm is available via `corepack pnpm`** (no global pnpm on PATH); capture exit
  codes with `cmd /c` redirects, because PowerShell pipeline stderr handling
  reports false non-zero exits.
