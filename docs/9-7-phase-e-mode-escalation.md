# 9-7 Phase E — Chat → Work 自动升级（一次性确认）

Compact handoff for Codex-Boss-9-7-DSH-V4-Plan §35 Phase E. Branch `9-7`.

## Why

The app still makes Chat vs Work a *pre-submit user choice* (top toggle + Work
view), which is exactly the decision Boss must own. Phase E adds the
deterministic capability-need detector + a one-time escalation gate so a Chat
request that actually needs repo tools is proposed once, then continues on the
same task — no second prompt, no lost attachments/context (plan §2).

## What was added

- **Detector (`src/shared/capability-needs.ts`)**
  - `CapabilityNeeds` (plan §2.2: workspace / file mutation / execution / shell /
    git / multi-step / durable artifacts / repo materialization), `InteractionMode`
    (CHAT | WORK_PROPOSED | WORK), `ModeTransition`.
  - `detectCapabilityNeeds({message, inputKinds})` — deterministic host markers
    (repo mention, mutation/execution verbs, tasks.md plans, benchmarks); pure
    Q&A and uploaded-file analysis stay CHAT.
  - `decideEscalation(needs)` → explainable reason + capability tokens
    (`repo_read`, `code_edit`, `run_test`, …) for the router.
- **State (`src/shared/contracts.ts` + `electron/store.ts`)**
  - `BossTask.interactionMode?` / `BossTask.modeTransition?` (§2.4) — optional
    additive fields, legacy tasks unaffected.
  - `stageModeTransition` (queued, WORK_PROPOSED, nothing dispatched),
    `approveModeTransition` (once-only, flips appMode to work),
    `declineModeTransition` (returns to CHAT). Startup reconcile never flips a
    WORK_PROPOSED task to running.
- **Commander / IPC (`main.ts`, `preload.ts`, contracts)**
  - `boss:dispatch-task`: Chat requests whose detector decision escalates are
    staged instead of firing web providers; everything else runs exactly as before.
  - `boss:resolve-mode-proposal(taskId, approveWork)` — the **only** user action:
    approve runs the existing Work cascade (deterministic → plan → provider) and
    auto-continues; decline keeps Chat. Message/attachments/conversation are
    inherited because it is the same task.
  - `MainCommander.canResumeTask` treats PROPOSE_WORK as held.
- **Renderer**
  - WORK_PROPOSED tasks show an escalation card with reason + required
    capabilities and two buttons: 继续到 Work / 保持 Chat.
  - Presentation label "等待你决定是否进入 Work" for proposed tasks.

## Acceptance (Phase E)

- Detector table (§2.2): 解释错误/总结 PDF/分析 CSV/解释 repo 架构 → Chat;
  修改 repo / 按 tasks.md 实现并测试 / 跑 benchmark / 完成实验 → WORK.
- Stage → approve once → task runs to completion on the same task id;
  stage → decline → plain Chat dispatch.
- Verified by `tests/capability-needs.test.ts` (7 tests) incl. transition
  persistence (stage/approve once/decline idempotent + restart).

## Verification

- `pnpm run typecheck` — green.
- Focused suites (A–E): 7 files / 56 tests passed.

## Next

Phase F — GitHub URL Resolver: detect `https://github.com/…`, parse
owner/repo/ref/path, clone into the repo cache, register a workspace, then the
CapabilityNeedDetector can escalate "检查实现" of a pasted URL into a real
materialized repo.
