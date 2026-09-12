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
| CP12 Candidate State + Guardian Gate | §35, §36 | `src/shared/candidate-gate.ts`, `electron/engineering/candidate-guardian.ts` | `acceptance:candidate` GD-01..GD-10 (52 observations) | `34683821940` |
| CP13 Version Impact + Git Checkpoint | §37, §38 | `src/shared/{version-impact,git-checkpoint}.ts`, `electron/engineering/git-checkpoint.ts` | `acceptance:version-checkpoint` VC-01..VC-08 (50 observations) | `34684778075` |
| CP14 GitHub App Execution + PR Automation | §39, §40 | `src/shared/publish-plan.ts`, `electron/engineering/release-runner.ts` | `acceptance:publish` PB-01..PB-10 (62 observations) | `34685821961` |
| CP15 CI Repair Loop | §41 | `src/shared/ci-repair.ts`, `electron/engineering/ci-repair-loop.ts` | `acceptance:ci-repair` CR-01..CR-08 (44 observations) | `34686925547` |
| CP16 Final Acceptance + §43–§45/§51/§52 | §42–§45, §51, §52 | `src/shared/final-acceptance.ts`, `electron/engineering/final-acceptance-gate.ts` | `acceptance:final` FS-01..FS-08 (55 observations) | `34687917864` |

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

Local evidence for CP12: the 23-step chain is green (135 test files / 1380 tests,
`acceptance:candidate` GD-01..GD-10 PASS with 52 observations; the Guardian decides
over the real §31.3 ledger, the real secret scanner, git's deletions and real theme
packages, and the jump `RUNNING → ACCEPTED` is refused by the lifecycle).

Local evidence for CP13: the 24-step chain is green (137 test files / 1403 tests,
`acceptance:version-checkpoint` VC-01..VC-08 PASS with 50 observations; the impact is
computed from `git show HEAD:<path>` against the disk, the checkpoint carries the
real HEAD/branch/diff, and a rollback really restores the tree — including deleting
a path that never existed at the recorded HEAD).

Local evidence for CP14: the 25-step chain is green (138 test files / 1413 tests,
`acceptance:publish` PB-01..PB-10 PASS with 62 observations, **no network** — a real
bare remote receives the pushed `boss/t-14/...` branch whose commit keeps its
trailers, and the real `GitHubGateway` over a recording transport performs
`POST /app/installations/…/access_tokens` then `POST /repos/owner/name/pulls` with
the §40 body).

Local evidence for CP15: the 26-step chain is green (139 test files / 1421 tests,
`acceptance:ci-repair` CR-01..CR-08 PASS with 44 observations, offline — a real
`tsc`/`node --test` log is parsed and classified, the repair is applied through the
host, the local typecheck passes, the fix is pushed to a bare remote and the re-read
is green; a failed CI read and a non-converging repair both end at a Hard Blocker).

Local evidence for CP16: the 27-step chain is green (140 test files / 1429 tests,
`acceptance:final` FS-01..FS-08 PASS with 55 observations — the §42 checklist is
evaluated over the other checkpoints' real artifacts, an empty artifact set is
rejected with five items NOT_VERIFIED, and §43/§44/§45 plus the §51/§52 catalogues
are pinned).

**Known CP9 boundary**: the loop, the verification engine and the review engine are
exported host modules exercised by their gates; the live WorkBook/commander task
path still runs the older `verifyAndRepair` seam unchanged. Wiring the loop into
the live path (with its iterations recorded on the durable task) is deliberately
left to a later checkpoint rather than half-done.

**In flight — CP17 next**: §53's soak test (repeated fresh clone → bootstrap →
task rounds) and a one-shot benchmark runner that walks all eighteen §51 scenarios,
followed by CP18's Bootstrap Completion black box (§57).

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
  → version impact + local Git checkpoint (precondition for §39/§40) §37/§38
  → publish: policy branch → commit trailers → push → PR body   §39/§40
  → CI repair loop (parse → classify → repair → verify → push)   §41
  → final acceptance (§42 checklist over the artifacts above)     §42–§45/§51/§52
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
acceptance:capability-gap → acceptance:candidate →
acceptance:version-checkpoint → acceptance:publish → acceptance:ci-repair →
acceptance:final → acceptance:github-machine → benchmark → package:portable →
portable smoke → restart acceptance → acceptance:desktop-workbook`

Local equivalent (same order, prints exit codes): `scripts/phase0-validation-chain.ps1`.

## 4. Remaining checkpoints and their exact scope

| Checkpoint | Plan | Deliverable |
| --- | --- | --- |
| CP8 | §30, §31 | **delivered**: bounded worker scope + atomic change units + rollback + real file verification (git/hash/existence/syntax/typecheck/targeted tests), Verification Ladder (11 rungs), requirement-aware gates, durable Evidence Ledger |
| CP9 | §32 | **delivered**: three review layers + §32.1 dimensions (and the four theme ones) + all twelve §32.2 adversarial probes + §32.3 routing (HIGH/MEDIUM → repair) + the §30 implementation loop (Plan → Worker → Host Verification → Review → Repair → Reverify) driving the CP8 engine, with the §2.3 completion gate |
| CP10 | §33 | **delivered**: 13-class failure classification from real evidence, the §33.2 recovery order with per-step budgets and reasons (theme ladder included), Owner hand-off for AUTH/WORKSPACE, and §33.3's HNS rules with the mandatory durable CapabilityGap |
| CP11 | §34 | **delivered**: capability-gap aggregation by capability, the "conditions met" thresholds, the six-stage chain walked with real machinery (improvement task → §30 loop → real regression climb → §5.3 knowledge update → capability probe), and closure that requires the probe to actually move |
| CP12 | §35, §36 | **delivered**: the §35 lifecycle as a state machine (RUNNING → … → CANDIDATE → ACCEPTED, jumps refused, CANDIDATE = complete-but-unreleased) and the §36 Guardian Gate over eleven checks evaluated on real artifacts, where a check that could not run blocks and any failure returns the Candidate to repair |
| CP13 | §37, §38 | **delivered**: the host-decided version impact (NONE/PATCH/MINOR/MAJOR from API/schema/behaviour/compatibility/migration/user-facing evidence, with a worker's conflicting claim rejected) and the local Git checkpoint (real HEAD/branch/diff/task/candidate/evidence, a remote-write guard, and a rollback that needs the Owner before discarding commits) |
| CP14 | §39, §40 | **delivered**: the branch policy (`boss/<task-id>/<slug>`), the §39.2 commit trailers, the §40 PR sections and a release sequence where §38 is a precondition — executed for real against a bare remote and the real `GitHubGateway` (recording transport, in-memory App key, no network) |
| CP15 | §41 | **delivered**: the CI repair loop — a real CI log parsed into step/diagnostics/tests/exit code, classified in §33's vocabulary, repaired through the §30 loop, verified on the gates the class demands, pushed through §39/§40 and re-read, bounded, with a failed CI read never counted as a pass |
| CP16 | §42–§45, §51, §52 | **delivered**: the final-acceptance checklist evaluated over the other checkpoints' artifacts (a missing artifact is NOT_VERIFIED, never a pass), §43's BOOTSTRAP_COMPLETE definition, §44/§45's blocker rules as a refusal, and the §51/§52 catalogues pointing at gates that really run |
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
