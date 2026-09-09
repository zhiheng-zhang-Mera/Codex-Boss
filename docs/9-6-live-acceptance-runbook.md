# 9-6 Research — Final Acceptance Live Runbook (A–J)

Branch `9-6-research`. This runbook executes the research plan's **Final Acceptance** in a GUI
session with real tools. It is the live half of the objective: everything deterministic is
already implemented and green (see `docs/9-6-validation.md`), and per plan item 7 the live items
are **never** replaced by mocks. Run this on a machine with the packaged Electron app, logged-in
web-AI sessions, the Codex-Boss repo as the research workspace, and (for J) a LaTeX toolchain.

For every item below, record **pass / fail + one line of evidence** (screenshot path, file path,
or short log excerpt). Return the filled checklist so each item can be closed.

---

## 0. Environment

- Electron app built from `9-6-research` (run `pnpm run build:renderer` + `pnpm run
  build:electron`, then the app).
- Web AIs logged in: ChatGPT, Gemini, DeepSeek (3 visible provider panes).
- Research workspace: a real checkout of Codex-Boss.
- (J only) `pdflatex`/`xelatex` on PATH.

---

## A. No Regression (existing modes)

Open and exercise each mode; confirm unchanged behavior:

1. **Chat** — send a message to one provider, get a final answer.
2. **Work** — launch a task with workspace + review policy STRICT; it completes end to end.
3. **Direct / Council** — dispatch a direct task and a council task (evidence bundle shown).
4. **Engineering** — run an Engineering task that edits a file and runs its tests.
5. **Recovery** — kill/restart mid-task; recovery resumes without a fresh submit.
6. **Restart** — relaunch the app; conversations/tasks/orders restore.

Evidence: one line per mode.

---

## B. History

1. Right-click a conversation and open `···`: menu shows rename / move / duplicate / export /
   archive / delete (same actions from both).
2. **Archive** → disappears from list; toggle shows it; nothing deleted.
3. **Delete** → confirm; no orphan state/history files remain under `runtime-data/.boss`
   (check `history/` and `tasks/` dirs).
4. **Duplicate** → new conversation with fresh ids; editing original does not affect the copy.
5. **Export** → output dir contains `messages.md` + artifacts/evidence.

Evidence: paths + one screenshot of the context menu.

---

## C. 3-AI UX

1. Open 3 providers → panes are horizontal 1×3, full height, readable.
2. Auto zoom applies per pane (resize window → layout/zoom updates).
3. Reorder providers (`‹ ›`) → order persists across app restart.
4. Drag reorder works (if the drag control is present in this build).

Evidence: one screenshot before/after resize + restart.

---

## D. Progress

1. Run a multi-provider task → waiting animation shows `0/3 → 1/3 → 2/3 → 3/3`; provider pane
   titles move `● Waiting → ✓ Complete`.
2. After all complete, controller immediately shows the next step (no long silence).
3. Progress strip shows operational summaries only — never private chain-of-thought.

Evidence: short screen recording or 2–3 screenshots with timestamps.

---

## E. Autopilot

1. Start a long Work task with AUTONOMOUS review; it must **not** ask meaningless
   Continue/Proceed questions.
2. Induce a normal failure (e.g. provider rate-limit / temporary network drop): auto recovery
   resumes without human input.

Evidence: task log excerpt showing auto-recovery.

---

## F. Human Intervention

1. Craft a task that truly requires a decision (direction/authorization) → app:
   - checkpoints state + artifacts,
   - enters `WAITING_FOR_USER` and shows the attention card (one OS beep / notification),
   - waits for the answer.
2. Answer → the same task resumes from its checkpoint (no re-submit).

Evidence: card screenshot + the resumed task continuing.

---

## G. Level-B (real repo research)

1. In Research view: goal = e.g. “evidence-grounded multi-agent decision vs majority voting”,
   workspace = Codex-Boss checkout, reviewers = the logged-in web AIs, AUTOPILOT.
2. Boss completes: repo inspection → candidate RQ (web-AI) → falsifiable RQ → protocol freeze
   → benchmark/experiment code → **real experiment execution** → statistics → replication →
   evidence.
3. Watch reviewer-gated stages: they park at WAITING_FOR_PROVIDER and resume to the exact stage
   after reviewer input (rounds 8–9 behavior).

Evidence: final `research/<id>/audit/final-audit.json` + experiment log with real commands run.

---

## H. Level-A (goal only)

1. Give only a project goal (no RQ/data/code). Boss autonomously: inspection → candidate RQ →
   novelty/feasibility → RQ selection → hypothesis → protocol → benchmark → implementation →
   execution → replication → claims → manuscript → audit.
2. Requires **0 manual continuation clicks** except genuine user decisions/authorizations.

Evidence: run id + step timeline showing zero manual continuations.

---

## G/H Control Surface Reference (bridge/IPC)

The Research view uses `window.boss.*` (contracts in `src/shared/contracts.ts`); for a manual
GUI drive of G/H these are the exact calls:

- **Start**: `researchStart({ goal, workspace, reviewers, autonomy })` → returns ledger record.
- **Step**: `researchStep(id)` — executes the current stage; reviewer-gated stages park the run
  at `WAITING_FOR_PROVIDER` with a `paused:<stage>` decision (rounds 8–9). Stepping a paused
  run is a no-op.
- **Status**: `researchStatus(id)` → `{ ir: { state, protocolHash, pendingStage } }`.
- **Resume**: `researchResume(id)` — returns true and moves the run to its recorded pending
  stage; a live executor then runs that stage with web-AI reviewers (round 9 wiring).
- **Freeze protocol** (before experiments; run must exist): `researchProtocolFreeze(id,
  protocol)` where `protocol` is a `ResearchProtocol`:

  ```json
  {
    "schemaVersion": 1,
    "hypothesis": "H: evidence-grounded review beats majority voting",
    "primaryMetric": "accuracy",
    "baseline": "0.8",
    "sampleDefinition": "tasks 1..50 on the Codex-Boss repo",
    "evaluationCriterion": "mean >= baseline",
    "createdAt": "2025-…"
  }
  ```

  The handler mirrors `ResearchService.freeze`: it records `ir.protocolHash` and moves the run
  to `PROTOCOL_FROZEN` (round 16). Freezing twice throws.
- **Wait/intervention**: `researchWait({ id, kind, question, options, blockingStepId,
  contextSummary })` — parks at `WAITING_FOR_USER` and raises an intervention card;
  `resolveIntervention(taskId, kind, answer)` records the answer and resumes the run (rounds
  6–7).

Note: the offline Research view currently exposes Start / Step / Resume / status. For G/H the
live session additionally drives protocol freeze and the reviewer-gated stages via the above
bridge calls (or the app's live executor wiring, which replaces `DefaultLevelBExecutor`).

---

## I. Research Integrity (verify on the Level-B/Level-A run)

- protocol frozen (`research/<id>/protocol.json` + `ir.protocolHash` match);
- real experiments (run records with git commit/dirty/command/env/seed/hashes — recorder, round
  10);
- deterministic statistics (round 11 analysis);
- primary results replicated (round 12 reproducibility audit = REPRODUCED);
- claims traceable to evidence (round 13 graph claims; round 31 full chain; round 28 paper
  sentences);
- citations audited (round 14/18) + only verified citations in `references.bib` (round 20);
- reproducibility audit PASS in `audit/reproducibility.json`.

Evidence: copy the run's `audit/` + `evidence/` JSONs.

> Deterministic I/J verdict: after the run, execute
> `node scripts/acceptance-research-audit.cjs <researchRoot> <researchId>` — it asserts the
> snapshot/hash binding, final-audit pass, reproducibility REPRODUCED, citations ok, claim +
> paper graph nodes, and paper.md/tex/bib + embedded figures (exit 0 = PASS). Return its JSON
> report as part of the evidence.

---

## J. Artifact

Verify `research/<id>/` contains:

- `research-ir.json` + `protocol.json` (round 24 snapshots)
- `manuscript/paper.md`, `paper.tex`, `references.bib` (figures embedded — round 29)
- `manuscript/figures/*.svg` (rounds 21–22, traceable to runs)
- `audit/citations.json`, `audit/reproducibility.json`, `audit/final-audit.json`
- **`paper.pdf`** — run `pdflatex paper.tex` in `manuscript/` (needs LaTeX; report any compile
  errors verbatim).

Evidence: `ls -R research/<id>` + the PDF path.

---

## Return format

```text
A: pass/fail — <evidence>
B: pass/fail — <evidence>
…J: pass/fail — <evidence>
```

Failures: include the exact error/log so it can be fixed in-repo and re-run.

## Checkpoint

This runbook is deterministic documentation; the live results (per item) will be recorded back
against this list to close Final Acceptance.
