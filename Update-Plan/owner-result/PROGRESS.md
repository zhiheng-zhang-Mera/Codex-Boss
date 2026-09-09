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

## Round 3（2026-09-09，DS-Hns 侧 §15/§16/§18/§20/§42 autonomy 模块，分支 owner-result-autonomy @ 8e24b7d）
- `app/extensions/mega/autonomy/progress-observer.js` — §16/§9–§11：heartbeat 模型 + observe() 输出
  WORKING/SLOW/STALLED/FAILED（可注入时钟，确定性）；busy 标志陈旧不可掩盖硬停滞。
- `app/extensions/mega/autonomy/stall-detector.js` — §10/§11：每 episode 累计 no-progress/probe/
  stalled 计数；软截止 → shouldProbe；硬停滞 → isStalled；probe 无果推向硬界。
- `app/extensions/mega/autonomy/episode-supervisor.js` — §7/§8/§12–§14：episode 生命周期
  QUEUED→…→COMPLETED/FAILED + 合法转移守卫；R0–R8 恢复梯；§13 straggler provisional quorum；
  §14 brand-locked 不可替代。
- `app/extensions/mega/autonomy/continuation-controller.js` — §17/§13/§40：KEEP_RUNNING / PROBE /
  PARK_AWAITING_RETRY（释放 slot）/ REWORK / COMPLETE / FAIL；backoff 指数封顶；hard deadline 终止；
  MODEL_DONE 未验证 ⇒ REWORK。
- `app/extensions/mega/autonomy/question-interceptor.js` — §18/§19：HB1–HB4 分类（仅真 HB 上浮）；
  DECIDABLE 自动决策 + steer；方向停滞梯四段。
- `app/extensions/mega/autonomy/result-validator.js` — §20–§22：delivery 模式验证门；model-done-only
  ⇒ VERIFYING/REWORK；缺门 ⇒ REWORK。
- `app/extensions/mega/autonomy/decision-ledger.js` — §38：durable 台账（原子写、id-dedupe、fail-closed）。
- `app/extensions/mega/scheduler/scheduler.js` — 受控集成（默认 OFF：`autonomyEnabled=false`）：
  tick 内 headless log 增长监测 → 停滞检测 → bounded 自动重试（backoff、attempts 封顶、parent 链接）
  或 FAIL（带 ledger 记录）；`updateConfig({autonomyEnabled})` 热切换；describe() 暴露状态。
  official-session 维持现有 RPC 监测（§16：绝不注入官方 renderer）。
- 修复既有回归测试：`tests/unit/installer-contract.test.js` 断言过时（Mega dock 集成后官方视图与
  Mega 视图的 preload 归属已分离）→ 改为“官方视图无 preload，仅 Mega dock 允许 preload”的 §42 契约。
- 测试：`tests/unit/autonomy-*.test.js` ×7（node:test 确定性套件）。
- 验证快照（Round 3，DS-Hns）：`npm run check` PASS；`npm test` **92/92 PASS**（含既有 12 文件全部回归）；
  scheduler 加载/开关冒烟 PASS（无状态写入）。

## Round 4（2026-09-09，P0-6 Computer-Use Provider Recovery 决策核心，owner-result @ 2c76a62）
- `src/shared/computer-recovery.ts`（纯 + 共享）：
  - §26 失败分类 `classifyRepairNeed`：send-button-not-found / enter-did-not-submit /
    input-not-found / response-selector-drift / 找不到发送按钮（中英）→ CU_REPAIR + need；
    login/CAPTCHA → HUMAN_REQUIRED；未知结构失败 → NOT_REPAIRABLE（绝不猜成 mutation）。
  - §24/§28 分级修复计划 `buildRepairPlan`：read_page →（enter_text/click_control/submit）→
    verify_state 的可验证链；TEXT/ROLE/ACCESSIBILITY/REGION/ICON/POINT 目标分层；ICON/POINT
    必须带 frameRevisionAt + boundedRegion，否则计划 UNCERTAIN（§28 禁裸坐标）。
  - §29 权限：`grantedComputerActions`（computer:<action> 令牌）；mutation 无授权 → 计划
    DENIED（fallback 到既有人工/失败路径，绝不绕过）；读动作恒允许（对齐 desktopMutationGate）。
  - §25 post-condition 纪律：`verdictForOutcome` 仅 post-condition 被观测才 VERIFIED，否则
    UNCERTAIN —— 禁止 UNCERTAIN 下重复 mutation。
- 测试：`tests/unit/computer-recovery.test.ts`（10 用例：分类/计划/几何守卫/权限/事后条件/分级）。
- 验证快照（Round 4）：typecheck PASS；vitest 全量 **35 文件 / 186 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-4/`。
- 说明：执行器（DomPageSurface/VisionSurface 之上的真实动作链）与 WebRecovery/provider-automation
  的 live 接线属需 GUI/真实 provider 会话的 live-acceptance 轮次；本核心为确定性决策底座。

## Round 5（2026-09-09，P2 前置 §37/§38/§44 Owner Dashboard 读模型 + bridge，owner-result @ d3c63ce）
- `src/shared/owner-dashboard.ts`（纯 + 共享）：
  - Owner 卡片只含 GOAL（goal）/ STATUS / PROGRESS（progressLabel：nextAction+executionPhase+
    recoveryAt）/ RESULT（finalResponse source/finalizedAt/preview）/ EVIDENCE（最新 evidence
    decision + artifact/claim 计数 + 争议留存）/ HARD_BLOCKER（HB1–HB4 或 ASSISTED 下的
    OPERATOR_QUESTION）；内部普通决策只进决策台账，不弹 Owner（§37）。
  - `blockerForIntervention`：LOGIN/CAPTCHA/AUTHORIZATION→HB1；BUDGET/EXTERNAL_ACTION→HB2。
  - `internalAutoDecisions` 计数（§44）：question-interceptor/direction-stall/… 等内部决策源。
- 接线：`contracts.ts` BossBridge.ownerDashboard()；`electron/main.ts` handler（快照 + interventions +
  durable decision-ledger.json 实例）；`electron/preload.ts` bridge 暴露 `boss:owner-dashboard`。
- 测试：`tests/unit/owner-dashboard.test.ts`（4 用例：读模型字段/HB 映射/内部决策计数/chat-ASSISTED 默认+进度标签）。
- 验证快照（Round 5）：typecheck PASS；vitest 全量 **36 文件 / 190 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-5/`。

## Round 6（2026-09-09，P1-5 故障注入 §22/§32 确定性套件，owner-result @ cf0995d）
- `tests/unit/execution-fault-injection.test.ts`：在**真实 ExecutionSupervisor + 持久 TaskLedger** 上，
  用脚本化假 RuntimeAdapter 复现 Rev.2 故障类并断言耐久状态：
  - AUTH_REQUIRED → job WAITING + nextAction HUMAN_REQUIRED + mode PAUSED（绝不假完成）；
  - provider TIMEOUT → 有界重试（attempts≤3），终态仍 RETRYABLE_FAILURE、不伪造 COMPLETED；
  - BUDGET_EXHAUSTED(quota) / UNSUPPORTED(dependency) → nextAction DEFER + PAUSED；
  - SUCCESS 但内容为空（malformed output）→ 不被当作完成（completedSteps 不含该 job）；
  - 对照：真实非空 SUCCESS → job COMPLETED + step 计入。
- 验证快照（Round 6）：typecheck PASS；vitest 全量 **37 文件 / 196 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-6/`。

## Round 7（2026-09-09，P1-6 Long Soak mini，owner-result @ a284488）
- `tests/unit/owner-result-soak.test.ts`：把 Rev.2 决策模块（autonomy-supervisor observeJob /
  owner-result interceptForMode / result-validator verifyResult / durable DecisionLedgerStore）
  组合进 **合成事件循环 fleet**（24 任务 × 脚本时钟 600 步），注入静默/软截止/硬停滞/模型完成等事件：
  - 0 fake PASS：每完成都过 verifyResult 全部计划门；model-done 无证据必走 REWORK（reworks>0）；
  - 诚实失败：预算/重试耗尽 → FAILED（>0）；
  - §36 不变量：completedPassed+failed=tasks、horizon 内无无限等待（hard horizon 终止）、
    **无重复 send**（每 attempt 至多一次，重试才重置）、决策台账 id 无重复、reopen 完整；
  - 确定性：同 seed 两次运行统计完全一致。
- 验证快照（Round 7）：typecheck PASS；vitest 全量 **38 文件 / 198 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-7/`。

## 下一优先级（§45 顺序）
1. P0-4/P0-5 运行时接线：main-commander / research supervisor 暂停点接入拦截层与 VERIFYING 门
   （raise 前分类；MODEL_DONE → verify → PASS/REWORK）。
2. P0-6 Computer Use 接入 WebRecovery（provider 页面恢复梯 R6）。
3. P0-7 Qwen Computer-Use Recovery（真实 send 失败 → Computer Use 接管 → repair evidence）。
4. P1-x：Qwen Self-Healing Graduation、generic drift、Boss Self-Healing Battery、Research 泛化、
   fault injection、long soak。
5. P2：Owner Dashboard（GOAL/STATUS/PROGRESS/RESULT/EVIDENCE/HARD_BLOCKER）+ Final Release。
