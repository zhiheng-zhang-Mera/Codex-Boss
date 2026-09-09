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

## Round 8（2026-09-09，P0-6 Computer-Use DOM-tier 修复执行器，owner-result @ 239b33b）
- `electron/computer/provider-page-repair.ts`：`createPageRepairExecutor({surface: DomPageSurface, resolveTarget})`——
  把 §26 修复计划逐步执行到真实页面（复用 DomPageBackend 安全脚本管线）：
  - 每步经 resolver 把 planner 目标（kind+hint）映射为 DOM selector；无法定位 → **UNSUPPORTED 立即停止，
    绝不盲目 mutation（§25）**；
  - DENIED/UNCERTAIN 计划短路返回；动作失败 → FAILED（带 step/selector 信息）；
  - 终验：仅当最终 verify_state（可验证读）成功才 REPAIRED，否则 UNCERTAIN（§25 不声称已修复）；
  - enter_text 携带调用方 payload（context.text），submit 沿用 DomPageBackend。
- 测试：`tests/unit/provider-page-repair.test.ts`（4 用例：READY→REPAIRED 精确步序/图标不可定位→
  UNSUPPORTED 且零点击/DENIED 短路/动作失败→FAILED）。
- 验证快照（Round 8）：typecheck PASS；vitest 全量 **39 文件 / 202 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-8/`。
- 下一步：把 executor 以 guarded 方式接入 WebRecovery / provider-automation 的页面恢复路径
  （需要真实 provider 窗口的 live 验收轮）。

## Round 9（2026-09-09，P2 §37 Owner Dashboard UI 呈现，owner-result @ 0b1cfd0）
- `src/renderer/components/OwnerSummary.tsx`：主壳内自包含、默认折叠的 Owner 摘要条（每 2s
  轮询 `boss.ownerDashboard()`）：
  - 一行总览：任务总数/进行/完成/失败 · 硬阻塞 · 内部自动决策（§44）；
  - 展开卡片列表：GOAL（title）· STATUS+runMode · PROGRESS（progressLabel）·
    EVIDENCE（decision/artifacts/held）· RESULT（source+time）；HARD_BLOCKER 高亮左条并带
    detail（HB1–HB4 或 ASSISTED 下的操作问题）；
  - 内部普通决策不弹窗打扰（§37）。
- `main.tsx` 挂载于 chat-half 头部下；`styles.css` 追加 owner-summary 样式（ASCII 安全追加）。
- 验证：typecheck PASS；vitest 全量 **39 文件 / 202 测试 PASS**；full build PASS；
  **Electron offscreen UI 冒烟 PASS**（rendererLoaded/nativeCompleted/completionVisible，
  artifacts/owner-smoke/smoke-result.json）—— 证明新组件装载后渲染器正常启动、native IPC 与
  completion 渲染完好。
  证据 `Update-Plan/owner-result/evidence/round-9/`。

## Round 10（2026-09-09，P1-3 §32 Self-Healing Battery 核心，owner-result @ 4eded42）
- `src/shared/self-healing-battery.ts`（纯 + 共享）：
  - §32 十类挑战场景目录（SELECTOR_BROKEN / SEND_MECHANISM_CHANGED /
    RESPONSE_PARSER_BROKEN / PROVIDER_TIMEOUT / LOGIN_EXPIRED / STALE_SESSION /
    TEST_REGRESSION / CROSS_MODULE_CONTRACT_BREAK / REVIEWER_REJECTION /
    ELECTRON_RESTART）：detection（中英信号）→ diagnosis → repair lane
    （ADAPTER_PATCH / CODE_PATCH / COMPUTER_USE_PLAN / PROVIDER_RECOVERY /
    RESTART_RECOVERY / REVIEWER_RERUN）→ fail-closed verification gates；
  - `detectScenario`：任意原始信号映射到场景；
  - `planHealing`：LOGIN_EXPIRED 永不自动愈合（HB1 凭据类，NOT_AUTO_HEALED 诚实上报）；
    SEND_MECHANISM_CHANGED 路由 Computer-Use 修复计划（授权缺失 → NEEDS_LIVE_VERIFY，
    绝不假愈合）；其余自动可闭合场景必须先过其验证门才声明 healed（§30）；
  - §35 `stagnated`：重复 diff/错误/提案/reviewer finding 或「无指标改进且无新证据」
    → STAGNATED（触发 rollback/alternate，禁止无限烧 token）。
- 测试：`tests/unit/self-healing-battery.test.ts`（6 用例：目录完备性/信号检测/LOGIN 诚实/
  CU 路由授权门/验证门必先通过/停滞判定）。
- 验证快照（Round 10）：typecheck PASS；vitest 全量 **40 文件 / 208 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-10/`。

## Round 11（2026-09-09，发布门 + §41/§42/§44 Acceptance 矩阵）
- **受控 Electron 重启 acceptance 在 owner-result HEAD 重跑 PASS**：独立进程恢复耐久任务，
  attempts=1、无重复副作用、final 可见（CONTROLLED_ELECTRON_RESTART PASS）—— 证明 Rev.2
  台账/bridge 改动未破坏 durable 恢复链。
- `Update-Plan/owner-result/FINAL-ACCEPTANCE.md`：§41/§42/§44 逐项状态矩阵
  （✅DET / ✅LIVE / ⚠️LIVE-TODO / 📋），Owner 视角只显示
  GOAL/STATUS/PROGRESS/RESULT/EVIDENCE/HARD_BLOCKER；本程序 Owner 技术决策次数=0、盲等=0。
- 里程碑合并：`owner-result` → `main`（主干保持最新）。
- 证据 `Update-Plan/owner-result/evidence/round-11/`。

## Round 12（2026-09-09，P1-4 §33/§34 Research 泛化电池，owner-result @ ad77fe1）
- `src/shared/research-battery.ts`（纯 + 共享）：
  - 五域终态裁决器：software-engineering / multi-agent / reliability /
    writing-evaluation / negative-null-result；终态 READY / REJECTED /
    INCONCLUSIVE / INSUFFICIENT_EVIDENCE / REPLICATION_FAILED；
  - 规则（§33）：**正确拒绝 = PASS**（null/negative + reviewer 通过 + 复现记录 = 诚实科学）；
    **假 READY = FAIL**（缺 manuscript/review/citation 等 §34 链 → 降级 INSUFFICIENT_EVIDENCE）；
    hypothesis 声称支持却标记 REJECTED 不放行；REPLICATION_FAILED 有失败记录 = PASS；
  - `buildResearchBattery()`（6 场景覆盖五域 + 诚实否定/不足证据）+ `runResearchBattery()`。
- 测试：`tests/unit/research-battery.test.ts`（8 用例）。
- 验证快照（Round 12）：typecheck PASS；vitest 全量 **41 文件 / 216 测试 PASS**；full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-12/`。

## Round 13（2026-09-09，发布准备与主干同步）
- CI-equivalent benchmark PASS（`pnpm run benchmark`）。
- `Update-Log.md`：2026-09-09 Owner-Result Rev.2 施工段（R1–R12，24 提交）摘要与总表更新。
- `FINAL-ACCEPTANCE.md` 已含 §33 research 电池行（✅DET）。
- 再次同步：`owner-result` → `main`。
- 证据 `Update-Plan/owner-result/evidence/round-13/`。

## Round 14（2026-09-09，portable 发布门 §41）
- `pnpm run package:portable` PASS → `artifacts/Codex-Boss-1.0.0-*`（Rev.2 head 打包成功）。
- 打包产物离屏冒烟 **PACKAGED_SMOKE_PASS**（rendererLoaded / nativeCompleted / completionVisible，
  `artifacts/smoke-83561f5e…/smoke-result.json`）—— §41 portable 行在当前 HEAD 变绿。
- 证据 `Update-Plan/owner-result/evidence/round-14/`。

## Round 15（2026-09-09，确定性阶段收口：合并发布门复核）
- 在当前 Rev.2 HEAD 复核整套门：typecheck PASS · vitest **41 文件 / 216 测试 PASS** ·
  full build PASS · benchmark PASS；本会话另有受控 Electron 重启 PASS（R11）、
  portable 打包 + PACKAGED_SMOKE_PASS（R14）、DS-Hns 92/92 PASS。
- Owner-Result Rev.2 确定性阶段收口：P0-1…P0-5 契约与 seam、P0-6 核心+执行器、P1-3/4/5/6
  电池与注入/soak、P2 读模型+UI、DS-Hns autonomy 全套；Owner 技术决策次数=0、盲等=0。
- 剩余 live 项（P0-6 guarded 接线 / P0-7 Qwen Computer-Use Recovery / P1-1 graduation）需
  真实 provider 窗口的专属 live 会话；README 最终行与主干再合并随 live 后收尾。
- 证据 `Update-Plan/owner-result/evidence/round-15/`。

## Round 16（2026-09-09，P0-7 live 轮准备 + 状态文档）
- `README.md` Status 段刷新：Rev.2 能力摘要 + **41 文件 / 216 测试全绿**（含 typecheck/build/benchmark）。
- `Update-Plan/owner-result/LIVE-ROUND-PLAN.md`：把 P0-7 Qwen Computer-Use Recovery 变成机械可执行
  （DOM probe → 真实失败基线 → CU 接管（§25/§28/§29 守卫）→ adapter 固化复验 → graduation），
  含诚实失败验收（INCONCLUSIVE+证据=PASS）与"为何现在不做 live"的纪律说明。
- 决策台账 + planner/executor 等代码资产齐备；live 轮无需新增运行时接口。
- 证据 `Update-Plan/owner-result/evidence/round-16/`。

## Round 17（2026-09-09，P0-7 Qwen live 有界探测轮）
- `scripts/live-qwen-probe.cjs`：有界 CDP 驱动（真实分区启动 → 开 Qwen → 只读 DOM probe →
  单次 1-AI echo → 耐久状态轮询 → 诚实证据 + 清理退出）。
- live 发现（3 次独立运行一致）：
  - Qwen composer 可解析：`textarea.message-input-textarea`（占位“询问 Qwen”）；
  - 生产自动化在 Qwen **发送成功 ×3**（“已一次提交；等待独立并发采集回答”）——
    早前 “Qwen 发送控件未解析” 缺口在当前 live 页面已消失（P0-7 send 段 live-PASS）；
  - 响应采集在 5–8 分钟探测窗内未完成（应用采集 monitor 为 25 分钟上界 → 未证伪，
    留待 ≥25 分钟单次运行确认）；状态按 INCONCLUSIVE_WITH_EVIDENCE 诚实记录。
- composer selector 已固化证据 → 后续如需 adapter 硬化补丁可复用（patch+live 复验）。
- 证据 `Update-Plan/owner-result/evidence/round-17/`（3 个 probe JSON + 汇总）。

## Round 18（2026-09-09，Qwen 长时采集运行 → HB1 登录过期，诚实记录）
- `live-qwen-probe.cjs` LONG 模式：页面级助手回复侦测 + ≤27.5 分钟采集窗。
- 长时运行证据：Qwen 会话过期 → `/auth` 全程驻留；dispatch 停在 queued（“等待可见预填”），
  未发送、未伪造 → §32 LOGIN_EXPIRED / **HB1**（无可用凭据，可能含 CAPTCHA）；
  stall-breaker 已尽（今日 4 次冷启动 + 90s 认证等待）。
- 当日 P0-7 send live-PASS ×3 保持；capture graduation 现被 HB1（需 Operator 重登 Qwen 分区）
  阻塞；按 HB1 允许上浮，不宣称假完成。
- 证据 `Update-Plan/owner-result/evidence/round-18/`。

## Round 19（2026-09-09，GitHub CI 复核绿）
- GitHub Actions Desktop CI：**run 73/75/76/77 全部 success**（main @ e65a276/6d37437、
  owner-result @ 6d37437）—— typecheck/test/build/benchmark/portable/restart smoke 云端全绿。
- 本会话本地门（typecheck / vitest 41-216 / build / benchmark / 受控重启 / portable+冒烟）亦全绿；
  DS-Hns Pure Alien 92/92。
- Owner-Result Rev.2 确定性 + 发布阶段收口；剩余仅 P0-7 live 尾部（HB1 Qwen 登录，证据 round-18）
  与随后 P1-1 graduation / 最终发布文书。
- 证据 `Update-Plan/owner-result/evidence/round-19/`。

## Round 20（2026-09-09，P0-7 Qwen live：登录（HB1 解除）+ 发送与页面级回复 live-PASS）
- Operator 完成 Qwen 重登（登录走 GitHub/Google OAuth）；probe 增加 interactive-login 等待 +
  页面稳定复检（ready 后 30s 再确认）+ 加宽陈旧任务清理 + long capture 模式。
- 页面级端到端 PASS：prompt 发出 → “已经完成思考” → 助手精确回答 **“QWEN-OK”**
  （evidence graduation-3：`hasReply:true` + pageTail 含 QWEN-OK）。
- 发送确认 ≥4 次 live（已一次提交）；app 级采集自动收口在探测窗内未观察到
  （monitor 25 分钟上界 + 交互式桌面使用干扰同一 pane）——诚实记录为 OPEN，
  不宣称 capture 自动完成。
- 证据 `Update-Plan/owner-result/evidence/round-20/`。

## Round 21（2026-09-09，Qwen 响应区域只读普查（INCONCLUSIVE，诚实记录））
- `live-qwen-probe.cjs` 新增 `LIVE_QWEN_PROBE_ONLY` 只读模式（启动→读 DOM→退出，零副作用）。
- 空会话页普查仅见 composer 容器（message-input / -container / -right-button-send）——
  响应/对话容器仅在有内容时渲染，故本普查 INCONCLUSIVE；
  采集侧硬化的真实依据是 graduation-3 的页面级可见回复（innerText 含 QWEN-OK）。
- 唯一 OPEN live 项维持：一次不受干扰 ≥25 分钟采集（工具就绪），或对**含内容的会话**做
  响应区域定向普查。
- 证据 `Update-Plan/owner-result/evidence/round-21/`。

## Round 22（2026-09-09，采集诊断假设 + 含内容普查尝试（INCONCLUSIVE，诚实））
- **代码级诊断假设**：Qwen adapter `responseSelectors = ['.qwen-markdown', common]` 可能与真实
  回答容器不匹配 → `probe.latestResponse` 恒空 → 采集 monitor 等到 25 分钟强制采集上界。
- probe-only 模式扩展为尝试打开最近会话做含内容普查；本轮点击落到品牌/导航节点（空内容），
  真实回答容器 class 仍未取得 —— INCONCLUSIVE。
- 两条确定路径仍就绪：① 不受干扰 ≥25 分钟采集；② 定向打开“Reply with exactly: QWEN-OK.”
  会话做内容普查 → 据实修 adapter responseSelectors → 短时 live 复验采集自动收口。
- 证据 `Update-Plan/owner-result/evidence/round-22/`。

## Round 23–24（2026-09-09，Qwen 采集诊断定案：selector 可用 + 终态诚实）
- **RAW-SEND 模式**（不经 app 任务系统直发）两次复现：主对话区完成态下 `.qwen-markdown`
  命中且内容为 `QWEN-OK.`（早前 count=0 是流式中途采样）→ adapter responseSelectors 可用，
  假设（selector 不匹配）被**证伪**。
- **全时长采集（~27.5 分钟）终态**：app 端诚实终止——`outcome FORMAT_INVALID` /
  “尚未发现可验证的新回答，可稍后重试或手动完成”；**不会无限等待**。
- 失败根因（空页面运行）= 测试环境争用：历史 waiting 任务 + fresh-work 会话复用争抢单一
  Qwen pane → 发送未落在被监视页面；非产品采集 bug（页面含回复时 send→reply 通路已证）。
- 证据：`evidence/round-23/`（raw-send census ×3）、`evidence/round-24/`（full-capture 终态 + 汇总）。

## Round 25（2026-09-09，P0-7 → P1-1 Qwen Graduation **live PASS**）
- **根因定案并修复**：`provider-automation.ts` send.enter 只发原生 Enter 且只校验“输入框已清空”
  → Qwen 焦点丢失时误报“已一次提交”。加固：Enter 后校验 prompt 是否可见；不可见则用
  **DOM 级 Enter（多次实证有效）有界重试一次**再校验；仍不可见才 blocked（enter-did-not-submit）。
- **干净会话 live 全链路 PASS**：send → 生成 → 采集 → 确定性审查 PASS → finalResponse
  `QWEN-OK`（status completed / outcomes SUCCESS / evidenceDecision PASS /
  message 回答已通过确定性审查）。
- FINAL-ACCEPTANCE：Qwen repair（P0-7）→ ✅LIVE；Computer Use fallback 行补 ✅LIVE 加固链路。
- 验证：typecheck PASS · vitest **41/216 PASS** · full build PASS。
- 证据 `Update-Plan/owner-result/evidence/round-25/`。

## Round 26（2026-09-09，Final CI 复核全绿）
- GitHub Actions Desktop CI：**runs 78–81 全部 success**（main/owner-result @ 707d23b 含 Qwen
  send 加固、@ b586e7f 发布文书）。
- 12 轮 seeded soak 运行中（artifacts/rev2-soak-r25.json，下轮采集）。
- 证据 `Update-Plan/owner-result/evidence/round-26/`。

## Round 27（2026-09-09，12 轮全链 soak PASS）
- 顺序 12 轮 seeded 工程修复验收（Bug A，fresh clone 全链 audit→implement→build/test→review→
  converge）**12/12 PASS**，总时长 ~35 min（2111351 ms）；无回归、无重复副作用。
- 每轮确定性证据：`overcomplete/evidence/engineering/seeded-A-2026-09-09-06:59..07:31-*.json`（12 份）。
- 证据 `Update-Plan/owner-result/evidence/round-27/`。

## Round 28（2026-09-09，DS-Hns main 收口 + soak batch-2 启动）
- DS-Hns：`owner-result-autonomy` 合入其 `main` @ `8e24b7d`；`npm run check` PASS；
  `npm test` **92/92 PASS**；推送 origin main（§42 trunk 收口，双仓库主干均含 Rev.2 成果）。
- 第二批 soak 启动：24 轮 seeded 全链（artifacts/rev2-soak-batch2.json，跨轮累计 §36 soak）。
- 证据 `Update-Plan/owner-result/evidence/round-28/`。

## 下一优先级（§45 顺序，R31–R32 已推进）
1. ~~P0-4/P0-5 运行时接线~~：R31 落地 §20–§22 verification 门 seam v1（默认 OFF）；
   R32 落地 §18 research WAITING_FOR_USER raise 前拦截（AUTOPILOT 可决策问题自动决策、HB 才上浮）。
   剩余：seam v2 —— OWNER_RESULT 工程任务默认带契约 + requiredEngineeringChecks 补齐真实
   build/integration/acceptance 门执行后再默认开。
2. P0-6 Computer Use 接入 WebRecovery（provider 页面恢复梯 R6）。
3. P0-7 Qwen Computer-Use Recovery（真实 send 失败 → Computer Use 接管 → repair evidence；live，需专属会话）。
4. P1-x：Qwen Self-Healing Graduation、generic drift、Boss Self-Healing Battery、Research 泛化、
   fault injection、long soak。
5. P2：Owner Dashboard（GOAL/STATUS/PROGRESS/RESULT/EVIDENCE/HARD_BLOCKER）+ Final Release。

## Round 29（2026-09-09，soak batch-2 运行中）
- batch-2 24 轮 seeded 全链 soak：6/24 PASS（interim）；后台继续，完成即采集（预计 +12/24、~36 全链轮 ≈105+ min 累计 §36 soak）。
- 证据 Update-Plan/owner-result/evidence/round-29/。

## Round 30（2026-09-09，累计 36 轮 soak 全 PASS）
- batch-2 **24/24 PASS**（4,275,283 ms，~71 min）；与 batch-1 累计 **36 轮全链 / 6,386,634 ms
  （~106 min）全部 PASS**；36 份 seeded-A fresh-clone 确定性证据（06:59–08:46）。
- §36 long soak：累计 ~1h46m 真实全链 + R7 确定性 soak（不变量）齐备；无回归/无重复副作用。
- 证据 `Update-Plan/owner-result/evidence/round-30/`。

## Round 31（2026-09-09，P0-5 §20–§22 运行时验证门 seam v1，owner-result @ 5eab9d5）
- **背景**：`result-validator.ts` 的 §20–§22 裁决此前只存在于纯函数与单测，未接真实完成点；
  §45 下一优先级第 1 条（P0-5 运行时接线）尚未落地。
- **§20–§22 Verification Contract（默认 OFF，additive）**：
  - `src/shared/result-validator.ts`：`VerificationContract {domain,risk}` + `isVerificationContract`。
  - `contracts.ts`：`BossTask`/`CreateTaskInput` 增加可选 `verification` / `verificationEvidence` /
    `verificationVerdict`（durable）。
  - `electron/store.ts`：`setVerificationContract` + `recordVerification`（校验 + 原子持久化）。
  - `electron/commander/verification-collector.ts`（新）：把计划实际执行的 host 检查
    （typecheck/test/build…）映射为 §21 标准门证据；diff/syntax 等**绝不冒充已过门**。
  - `electron/commander/main-commander.ts`：createTask 持久化契约；**runPlan 完成点运行验证门**：
    携带契约时 MODEL_DONE 只能进 VERIFYING —— 门证据不足 → 裁决 REWORK → ledger
    `verificationState=FAILED`/`nextAction=REPAIR_OR_REPLAN` + 任务 parked waiting + 记录缺门 +
    不 capture 完成产物、不 finalize（无假完成）；finalizeTask 向 TaskFinalizer 注入
    verificationGate（synthesis recovery / 显式 finalize 等一切入口都再次 fail-closed 复核）。
  - `electron/commander/task-finalizer.ts`：新增可选 verificationGate 钩子，REWORK 时保持 waiting
    并写明缺门（MODEL_DONE ≠ COMPLETED）。
- 测试：`tests/unit/verification-contract.test.ts`（+4：证据映射只认标准门 / 裁决 fail-closed /
  **真实 MainCommander+TaskLedger+git 工作区集成**：high-risk 工程契约仅过 unit 门 ⇒ 无 final、
  waiting、缺 typecheck/build/integration、REWORK 记录齐全；**对照组无契约 ⇒ 同路径照常 final**）。
- 验证快照（Round 31）：typecheck PASS · vitest **42 文件 / 220 测试 PASS** · full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-31/`。
- 说明：契约默认 OFF（兼容既有 42 文件/220 测试全部回归）；把 OWNER_RESULT 工程任务默认带上契约
  需与 requiredEngineeringChecks 补齐 build/integration/acceptance 等真实门执行一起落地（seam v2）。

## Round 32（2026-09-09，P0-4 §18 raise 前分类接线：research WAITING_FOR_USER 拦截 seam，owner-result @ 4acf042）
- **背景**：§18 拦截逻辑此前只有纯函数 + 单测；research supervisor 的 WAITING_FOR_USER 暂停点是运行时唯一
  会把问题真正上浮给用户的 raise 接缝，但未接入拦截——任何 guidance 一律停放上浮，AUTOPILOT(=OWNER_RESULT)
  也会因 DECIDABLE 问题空停。
- **electron/research/research-wait-policy.ts（新）**：`researchWaitInterception()` —— AUTOPILOT⇒OWNER_RESULT、
  GUIDED⇒ASSISTED；InterventionKind→QuestionKind 映射（LOGIN/CAPTCHA/AUTHORIZATION→AUTHORIZATION、
  BUDGET/EXTERNAL_ACTION→EXTERNAL_ACTION、RESEARCH_SCOPE、DIRECTION）；复用 shared classify/interceptForMode：
  真 HB1–HB4 任何模式一律上浮；OWNER_RESULT 下 DECIDABLE 自动决策；ASSISTED/GUIDED 保留人工门。
- **research-supervisor.ts**：`SupervisorOptions.interceptWait?` 钩子 + 新方法 `requestGuidance({id,kind,question,options})`
  —— 单一 raise 接缝：拦截命中 ⇒ durable 决策写入 research ledger（`decision=auto-decide:<action>`，
  reason=rationale+steer），**不停放、不伪造人工答复**；未拦截（HB / GUIDED / 无钩子）⇒ setState
  WAITING_FOR_USER，与原 wait() 一致。
- **research-service.ts**：构造 supervisor 时注入默认策略（生产接线）。
- **electron/main.ts**：`boss:research-wait` 改走 requestGuidance —— intercepted ⇒ 返回
  `{intercepted, decision}`（不 raise humanGuidance、不停放）；否则照旧 humanGuidance.raise。
- 测试：`tests/unit/research-wait-policy.test.ts`（+8：AUTOPILOT continuation→auto CONTINUE / RESEARCH_SCOPE
  选项→确定性 PICK_OPTION 最稳项 / LOGIN·CAPTCHA→HB1·BUDGET→HB2 一律上浮 / GUIDED 即使 DECIDABLE 也保留
  人工门；真实 ResearchLedger 集成：DECIDABLE⇒不 parked + decisions 尾=auto-decide:CONTINUE、真 HB⇒parked
  WAITING_FOR_USER、GUIDED⇒parked、未知 run⇒fail-closed）。
- 验证快照（Round 32）：typecheck PASS · vitest **43 文件 / 228 测试 PASS** · full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-32/`。

## Round 33（2026-09-09，P0-4 §18 任务级能力路由拦截：Chat→WORK 升级 seam，owner-result @ ee17c40）
- **背景**：Chat→WORK 能力升级是第二个真实 raise 接缝：任何 chat 任务检测到需要代码/仓库能力时一律
  stage PROPOSE_WORK 等人批准；对 OWNER_RESULT（checkpointBudget=0）这属例行 DECIDABLE 能力路由，不该空停。
- **src/shared/owner-result.ts**：`workEscalationVerdict(mode, reason, capability?)` —— 纯决策：reason/能力文本
  先过 HB 信号（付款/凭据等 HARD_BLOCKER 任何模式一律 PAUSE）；OWNER_RESULT ⇒ AUTO_APPROVE + 确定性
  AutoDecision（policy `owner-result:escalate-work:v1`）；ASSISTED/AUTONOMOUS ⇒ PAUSE（保留人工门）。
- **electron/main.ts boss:dispatch-task**：escalate 分支按任务 runMode 裁决 —— AUTO_APPROVE 且 durable
  decision-ledger 可用 ⇒ **先 append §38 台账**（source=question-interceptor、outcome=APPLIED）再
  approveModeTransition + 启动执行（executeDeterministic/executePlan/automation + continueIfReady），不停放；
  否则照旧 stageModeTransition PROPOSE_WORK（默认 chat=ASSISTED 逐字节不变；台账不可用/HB ⇒ fail-closed 走人工门）。
- Owner Dashboard 既有 `buildOwnerDashboard(ledgerEntries)` 自动把新台账计入 internalAutoDecisions，无需改动。
- 测试：`tests/unit/work-escalation-verdict.test.ts`（+4：OWNER_RESULT+普通理由⇒AUTO_APPROVE /
  ASSISTED⇒PAUSE / AUTONOMOUS⇒PAUSE / OWNER_RESULT 但 HB 文本(付款/登录授权)⇒PAUSE）。
- 验证快照（Round 33）：typecheck PASS · vitest **44 文件 / 232 测试 PASS** · full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-33/`。

## Round 34（2026-09-09，P1-5 §38 Scenario G / §39 多故障隔离 battery，owner-result）
- **背景**：§38 Scenario G（Qwen FAILED + KB DEGRADED + Node offline + Proxy unavailable 同时发生，其余能力
  继续处理）与 §39「多故障同时发生测试」需要多故障同时注入证据；既有确定性覆盖以单故障类为主（R6/R7），
  且 circuit-breaker 行为无 tracked 测试。
- **tests/unit/multi-fault-isolation.test.ts（新，真实模块 battery）**：
  - **Scenario G**：web:a（技术失败⇒breaker OPEN）、web:b（SESSION_EXPIRED 诚实恢复）、web:c（健康）
    三任务并行 —— 健康任务 COMPLETED；两故障任务 WAITING 绝不 COMPLETED；仅 web:a breaker OPEN（b/c
    CLOSED）；随后新任务 pool=[broken, healthy] 被**重路由到健康方完成**（Boss 在部分节点宕机下存活，
    隔离保持）。
  - **Scenario A**：单故障 provider 与健康 provider 同 supervisor 并行 —— 故障隔离、健康任务完成、
    仅故障方 breaker OPEN。
  - 复用 R6 手法（scripted RuntimeAdapter + 真实 supervisor/ledger/scheduler）+ 真实 CircuitBreaker
    （failureThreshold=1、注入时钟），全部以 durable 台账断言。
- 验证快照（Round 34）：typecheck PASS · vitest **45 文件 / 234 测试 PASS** · full build PASS。
  证据 `Update-Plan/owner-result/evidence/round-34/`。
