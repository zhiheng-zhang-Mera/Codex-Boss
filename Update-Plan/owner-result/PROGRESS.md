# Owner-Result Rev.2 工程进度跟踪（契约 Update-Plan/Owner-Result.md，分支 owner-result）

> 运行纪律：§43/§46 —— Engineering Lead + Executor；不确定时 inspect/probe/experiment/test/review；
> 失败时 retry/fallback/repair/re-plan；等待必须异步监督；只有 HB1–HB4 且 Stall-Breaker
> 全失败才允许 HARD_BLOCKER。模型结束输出 ≠ 完成；Acceptance + Evidence PASS 才算完成。
> 基线见 `BASELINE.md`（main @ 3d8233a）。

## Round 1（2026-09-09，P0-1 / P0-2 / P0-3 / P0-4 / P0-5 基础契约 + 台账）
- **P0-1 Owner-Result Contract（§0–§6/§37/§38）**
  - `src/shared/owner-result.ts`：RunMode=ASSISTED|AUTONOMOUS|OWNER_RESULT；高级任务默认
    OWNER_RESULT、chat 默认 ASSISTED；contractForMode（OWNER_RESULT ⇒ checkpointBudget=0、
    hardBlockerOnly、autoEscalateDirection）；HB1–HB4 硬阻塞词表与分类；问题分类
    QUESTION_CANDIDATE → DECIDABLE / HARD_BLOCKER（中英信号词，仅 HB 命中才 HARD_BLOCKER）；
    可决策自动决策策略（continue / pick-option 评分 / strong-steer / route-to-planner，确定性）；
    §19 方向停滞升级梯（AUTO_DECIDE → STRONG_STEER → INDEPENDENT_DECISION → FRESH_EPISODE）；
    owner-result 人工门分类（LOGIN/CAPTCHA/AUTHORIZATION→HB1；BUDGET/付款/EXTERNAL_ACTION→HB2；
    DIRECTION/RESEARCH_SCOPE/TECHNICAL_CHOICE/CONTINUATION→DECIDABLE）。
- **P0-2/P0-3 Autonomy Supervisor（§7–§14）**
  - `src/shared/autonomy-supervisor.ts`：Job 生命周期词汇 QUEUED/DISPATCHING/ACTIVE/QUIET/
    PROBING/RECOVERING/COMPLETED/FAILED；heartbeat 模型（lastAnyActivityAt/
    lastSemanticProgressAt/lastResponseDeltaAt/lastPageStateAt/busy）；observe() 输出
    WORKING/SLOW/STALLED/FAILED + probe 建议（软截止 ACTIVE→QUIET→PROBE，硬停滞→STALLED，
    超硬界→FAILED）；R0–R8 恢复梯（inspect→recapture→re-monitor→re-steer→retry-unsent→
    reopen-session→Computer-Use-repair→alternate-provider→fresh-episode）；straggler 策略
    （quorum + 核心角色已回 ⇒ provisional synthesis；晚到可追加不可无限阻塞）；provider
    replacement（brand-locked 测试例外）。
- **P0-4 Question Interceptor（§18/§19）**
  - 拦截入口 `interceptForMode`：OWNER_RESULT 下 worker 问题先分类；DECIDABLE 自动决策并
    re-steer（不入人工门）；HARD_BLOCKER 才 surface；ASSISTED 保留原人工门。
- **P0-5 Result Validator（§20–§22）**
  - `src/shared/result-validator.ts`：MODEL_DONE ≠ COMPLETED；verification 计划按风险动态选门
    （engineering: typecheck/build/unit/integration/acceptance/runtime-smoke；research:
    protocol/execution/replication/statistics/claim/citation/review/manuscript/final-audit）；
    verdict PASS / REWORK（fail-closed，缺门即 REWORK 并带 missing 证据清单）。
- **§38 Decision Ledger**
  - `src/shared/decision-ledger.ts`（纯模型：问题/候选/选择/证据/结果/是否回滚 + append 规约）
    + `electron/commander/decision-ledger-store.ts`（durable JSON，原子写，幂等，绝不丢记录）。
- **契约 seam**：`contracts.ts` BossTask 增加可选 `runMode?: RunMode`（additive，向后兼容）。
- 测试：`tests/unit/owner-result-contract.test.ts`、`tests/unit/autonomy-supervisor.test.ts`、
  `tests/unit/result-validator.test.ts`、`tests/unit/decision-ledger.test.ts`。
- 验证快照（Round 1）：typecheck PASS；vitest 全量 **34 文件 / 174 测试 PASS**（其中新增 4 文件 / 48 测试）；
  full build PASS（typecheck ×2 + vite + electron tsc）。证据 `Update-Plan/owner-result/evidence/round-1/`。

## Round 2（2026-09-09，P0-1 契约持久化 seam + 决策点启用准备）
- `src/shared/owner-result.ts`：`effectiveRunMode`（显式 runMode 优先，否则按 kind 默认）+
  `runTaskKindFor`（legacy appMode/mode → chat/work 轴）。
- `contracts.ts`：`CreateTaskInput.runMode?`；`BossTask.runMode?`（Round 1 已加）。
- `electron/store.ts`：`setRunMode(taskId, mode)`（校验 isRunMode，持久化 + updatedAt）。
- `electron/commander/main-commander.ts`：`CommanderTaskInput.runMode?`；createTask 创建时落
  `runMode = input.runMode ?? defaultRunModeForTask(runTaskKindFor(appMode, mode))`（work/council → OWNER_RESULT；
  chat → ASSISTED）—— 之后所有决策点（intervention gate / stall ladder / auto steer）直接读 task.runMode。
- `electron/main.ts`：create-task / dispatch-task 两个 handler 透传 `input.runMode`。
- 测试：owner-result-contract +2 helper 用例；plan-microtask-spine（真实 StateStore+MainCommander）回归 PASS。
- 验证快照（Round 2）：typecheck PASS；vitest 全量 **34 文件 / 176 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-2/`。

## 下一优先级（§45 顺序）
1. P0-4/P0-5 运行时接线：main-commander / research supervisor 暂停点接入拦截层与 VERIFYING 门
   （raise 前分类；MODEL_DONE → verify → PASS/REWORK）。
2. P0-6 Computer Use 接入 WebRecovery（provider 页面恢复梯 R6）。
3. P0-7 Qwen Computer-Use Recovery（真实 send 失败 → Computer Use 接管 → repair evidence）。
4. P1-x：Qwen Self-Healing Graduation、generic drift、Boss Self-Healing Battery、Research 泛化、
   fault injection、long soak。
5. P2：Owner Dashboard（GOAL/STATUS/PROGRESS/RESULT/EVIDENCE/HARD_BLOCKER）+ Final Release。
