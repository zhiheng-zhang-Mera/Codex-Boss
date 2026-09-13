# Workspace / output / runtime path ownership

> Update-Plan/cleaning.md §5 (Task 3) — inventory first, then remove only the
> duplicates that really are the same thing.

The point of this file is not to collapse every path into one variable. It is to
state, for every path Boss handles, **who owns it, where it lives, and what may
write it** — so `workspace`, generated output, runtime scratch and checkpoint
state never get confused for one another again.

Single rule behind the whole table:

> One concept has exactly one canonical source of truth. The renderer, the IPC
> handlers and the engineering drivers read that source; none of them re-derive it.

## The concepts

| Concept | Canonical field / function | Owner module | Lives at | Written by |
| --- | --- | --- | --- | --- |
| **User workspace** (`workspacePath`) | `CreateTaskInput.workspacePath`, `BossTask.workspacePath`, `EngineeringGoalContract.workspace`, `ResearchIR.scope.workspace` | `electron/workspace/path-utils.ts` (normalize/validate/resolve), `electron/workspace/task-workspace.ts` (`workspaceForRequest`) | any absolute Windows directory the Owner picked or typed | never written by Boss state; it is the *subject* of work |
| **Materialized repository** | `InputObjectRef.localPath` | `electron/input/github-resolver.ts` | `<userData>/.cache/repos/...` | a clone performed for one GitHub input object |
| **User-visible generated output** | `researchDeliverablesPath(workspace, question)` | `electron/research/research-output.ts` | `<workspace>/Research/<topic>/` | `ResearchService.exportDeliverables` when a run reaches READY |
| **Conversation exports** | `HistoryRepository` | `electron/history-repository.ts` | `<userData>/exports/...`, `<userData>/history/` | `boss:export-conversation`, task finalization |
| **App runtime data** (`runtimeDataPath`) | `app.getPath("userData")` (`dataRoot`) | `electron/runtime-paths.ts`, `electron/main.ts` | `<checkout>/runtime-data` in development, the packaged app's userData otherwise | `state.json`, `.boss/**` (ledger, knowledge, themes, research cache, attachments), `Session Data` |
| **Runtime scratch / temp** | `cacheRoot` | `electron/runtime-paths.ts`, `electron/main.ts` | `<checkout>/.cache` (`browser-profile`, `tmp`, `crash-dumps`) | Chromium profile + the app's redirected `TEMP`/`TMP` |
| **Child-process scratch** | `scratchRootFor(cwd)` | `electron/engineering/command-runner.ts` | the system temp directory, or `%LOCALAPPDATA%\Temp` when `os.tmpdir()` resolves inside the audited workspace | every audited `test`/`typecheck`/`build`/`lint` child |
| **Task working copies** | `.boss/worktrees/<taskId>` | `electron/engineering/workspace.ts` | inside the workspace | isolated engineering worktrees (only when the workspace is this checkout) |
| **Recovery checkpoint** (in-memory) | `CheckpointSnapshot` | `electron/engineering/change-points.ts` | git state of the workspace + captured worktree contents | `runEngineeringGoal` before any autonomous mutation |
| **Durable engineering ledger** | `EngineeringLoopFile` | `electron/engineering/engineering-loop-store.ts` | `<userData>/.boss/engineering-loop.json` | the autonomous engineering loop |
| **Trust boundary state** | `trust-policy/**` | `src/shared/autonomous-evolution-trust.ts` | the repository, **tracked** | explicit trust-epoch migration only |
| **Acceptance evidence** | `acceptanceDirectory(root)` | `electron/engineering/acceptance-session.ts` | `<checkout>/artifacts/acceptance/` | the gate scripts |
| **Per-run evolution isolation** | `evolutionLayout(root, runId, sha)` | `electron/stable-candidate/workspace-manager.ts` | `<checkout>/evolution/<runId>/…` | Self-Evolution runs (own workspace, runtime data, logs, recovery) |

## What Task 3 changed

1. **Inventory** — the table above is derived from the code, not from intent.
2. **Duplicate removal (only true duplicates).**
   - `githubInput?.localPath ?? (input.workspacePath ? fs.realpathSync(input.workspacePath) : app.getAppPath())`
     was written out three times in `electron/main.ts`; all three now call
     `workspaceForRequest(...)`.
   - `task.workspacePath && fs.existsSync(...) ? fs.realpathSync(...) : fallback`
     was written twice (`electron/main.ts`, `workbook-production.ts#resumeWorkspaceFor`);
     both now call `availableWorkspace(...)`.
   - The `<workspace>/Research/<topic>` destination and its slug helper were inline
     at the one call site; both now live in `electron/research/research-output.ts`.
   - The runtime root literals (`runtime-data`, `.cache`, `history`) are now named
     constants in `electron/runtime-paths.ts` instead of repeated string literals.
3. **Default output location.** There is no user-configurable output directory in
   the product, and this round does not add one (no new product features). The one
   place Boss writes user-visible generated output into a workspace is the research
   export, and its default is now deterministic and named:
   `<workspace>/Research/<topic>/`, with no timestamps in the path.
4. **No source pollution.** `RUNTIME_OWNED_PATHS` declares every path Boss may
   create inside the directory it runs from; `tests/unit/workspace-path-ownership.test.ts`
   asserts each one is git-ignored **and** holds no tracked file.

## Kept separate on purpose

These are *not* aliases and were deliberately not merged:

- `workspacePath` ≠ `outputPath`: the user's project is not an output directory.
- `outputPath` ≠ `runtimeDataPath`: generated deliverables are the user's;
  `runtime-data/` is the application's own state.
- `runtimeDataPath` ≠ `checkpointPath`: the checkpoint is recovery-only data owned
  by one run and is discarded when the run converges.
- `cwd` of a child process ≠ workspace: audited commands run *in* the workspace but
  with their scratch redirected outside it.
