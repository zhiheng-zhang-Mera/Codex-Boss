# Codex-Boss 统一收口 — Round-3 handoff (U6–U11: fresh conversation, tables/gates, §38 rollback, audit env, E2E dogfood)

Branch `9-7`. Supersedes `docs/9-7-unification-u4-u10-round2.md` for the items below.

## U6 remainder — fresh external web conversation per task (§12.1/§51)

`493ed6b` — WORK tasks now open a **fresh** external conversation by default:

- `BossTask.freshWebConversation` defaults **true** when a task is created in
  `appMode: work`; `approveModeTransition` to work also flips the task's flag.
- Top-level WORK runs without a restored `sessionUrl` navigate the provider to
  the adapter's `newConversationUrl` (registry gained `newConversationUrl` per
  adapter) instead of reusing the visible conversation. CHAT keeps its visible
  conversation; repairs/`resumeAt` restores keep the prior session.
- Council `rework`/independent-review runs keep their task's session semantics.
- Delivery-integration tests updated and green.

## U7 remainder — result tables + quantitative visual-evidence gate (§21.2)

`7b62849`:

- `src/shared/research-manuscript.ts`: deterministic `ResultTable` model +
  `resultTableToLatex`/`resultTableToMarkdown`; `quantitativeVisualEvidenceVerdict`
  emits `MANUSCRIPT_VISUAL_EVIDENCE_INSUFFICIENT` when a quantitative manuscript
  has no table/figure, alongside the existing §18/§19 gates.
- `ManuscriptOptions.tables?: ResultTable[]` threaded through the assembler;
  `paper.tex` gets a LaTeX `tabular` block, `paper.md` a Result Tables section.
- `research-service` readiness now **requires** `\begin{table}` or
  `\includegraphics` in `paper.tex` for quantitative runs.
- New `tests/research-tables.test.ts` + research suites green.
- Figures/PDF *embedding* remains live-GUI/pipeline dependent (rendering an
  image binary into a document needs the real research pipeline run).

## U10 remainder — checkpoint/rollback for change sets (§38)

`93c9c94`:

- `electron/engineering/change-points.ts` — pure git checkpoint/rollback.
  `checkpointRecord` snapshots HEAD, tracked dirt (with exact checkpoint
  worktree content), and pre-existing untracked files; `rollbackToCheckpoint`
  reverts change-dirtied tracked files to HEAD, restores pre-existing user
  edits from their snapshot, removes only post-checkpoint untracked files, and
  **fails closed** if the repository HEAD advanced past the checkpoint.
- `MainCommander.runEngineeringGoal` checkpoints the workspace before freezing
  the goal and rolls the tree back when the loop terminates **without
  converging** (`ABORTED`/`STAGNANT`) — a failed autonomous goal never leaves
  the repo modified (`summary.changedFiles` resets to `[]`). CONVERGED and
  OPTIONAL_IMPROVEMENTS keep their build/test-verified changes. Non-git
  workspaces proceed without rollback capability (no fabricated safety).
- New `tests/change-points.test.ts` (5 deterministic git-repo unit tests,
  `core.autocrlf=false` for byte-exact assertions; the outside-git case uses a
  bogus `.git` marker so it stays deterministic even when `os.tmpdir()` sits
  inside a git worktree) and two real-git facade integration tests in
  `tests/engineering-facade.test.ts`: ABORT rolls back a crashed editor's
  change; STAGNANT rolls back recurring-failure rounds.

## U11 — E2E dogfood: audit-env fixes the dogfood surfaced

Running the autonomous goal against this repo surfaced two real faults in
`runAllowedCommand` (the audit's evidence seam), fixed in `fd55af0`:

- **Real environment**: child commands no longer get `TEMP` redirected into the
  workspace `.boss/tmp`. The redirected temp made the nested full-suite audit
  run with `os.tmpdir()` inside the repo, breaking three repo tests that assert
  non-git-workspace semantics — audit evidence must match a human's own
  `pnpm test`, so commands now inherit the developer's environment.
- **Generous caps**: the 120 s timeout + 1 MB buffer killed the nested full
  suite mid-run (~141 s), faking a test failure every round. Raised to
  15 min / 32 MB.

The repo's own process/git-heavy tests also received explicit timeouts so the
full suite stays green under parallel load (the same class of flake already
fixed for github-resolver and cli-process-recovery).

## U11 — E2E dogfood result (headless, against this repo)

`tests/u11-dogfood.test.ts` (gitignored; runs only with `BOSS_DOGFOOD=1`, and
no-ops inside the nested audit via the `ELECTRON_RUN_AS_NODE` guard so a goal
run never recurses into itself) drives `MainCommander.runEngineeringGoal`
against the Codex-Boss repo itself:

- **Result: PASS.** `ENGINEERING_CONVERGED`, iterations 1, findings `[]`,
  changedFiles `[]` — the loop audited the real repo with the real typecheck +
  full 145-file/721-test suite (two full passes: audit then verify), converged,
  and left the working tree untouched. Runtime ~9.7 min.
- This is honest E2E evidence for the loop's audit/convergence machinery on a
  non-toy repo. A coder-backed `implement`/`review` requires a live provider
  session and remains the one loop stage not exercised headlessly.

## Verification

- Electron typecheck: green after every commit.
- Full suite under the audit environment (`ELECTRON_RUN_AS_NODE=1`):
  **145 files / 721 tests green** — the exact environment the autonomous loop
  audits with now matches a normal developer run.
- Full suite at round end (normal env): **145 files / 721 tests green**.

## Remaining (rounds 4+)

- U4 DETACHED two-window mode: live Electron GUI validation (needs a running
  app with a provider profile; not reproducible headlessly).
- U5: Web AI Manager / Profile-Account Manager UI (masked-key security done).
  SecretVault adoption decision recorded: **not adopted** — vault rotation
  requires a guardian ceremony token that would break ordinary API-key updates
  (product-behavior decision, per plan boundaries).
- U6 §14: retryable external-archive *automation* (RecoveryScheduler) + council
  fresh-context navigation seam — live-GUI behavior surfaces.
- U10: live coder-backed implement/reviewer operations (requires a provider
  session) + UI start surface for goals.
- Final wrap-up: completion-matrix refresh + report close-out.

Backlog + per-domain evidence: `Update-Plan/audit/U0/completion-report.md`.
