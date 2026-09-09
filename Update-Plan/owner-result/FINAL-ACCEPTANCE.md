# Owner-Result Rev.2 — Final Acceptance Matrix（§41/§42/§44，refresh @ R41 2026-09-09）

> 契约：`Update-Plan/Owner-Result.md`（Rev.2）。口径：`MODEL_DONE ≠ COMPLETED`；
> 只有确定性测试 + 证据门 PASS 才算完成；live 项需真实 provider 会话。
> 状态：✅DET = 确定性验收通过；✅LIVE = 实况证据通过；⚠️LIVE-TODO = 需 live 轮；📋 = 文档/矩阵承载。
> 本矩阵在 R11 基础上随 R12–R41 刷新（research battery、36 轮 soak、Qwen graduation、R31–R41 运行时接缝与电池）。

## §41 Boss Final Acceptance 映射（产品侧，owner-result / main 同步至 R41）

| 项 | 状态 | 证据 |
|---|---|---|
| 1 AI / 3 AI / 5 AI 并行 | ✅LIVE | evidence/live/live-{1,3,5}ai-*（overcomplete） |
| Chat continuation / Work fresh | ✅LIVE | live-chat-vs-work / live-chat-continuation |
| non-blocking waiting（不占调度/不盲等） | ✅DET + live 基础 | R2 runMode、R3 DSH continuation-controller、R7 soak、R30 36/36 soak |
| provider recovery | ✅DET + live 基础 | R6 fault injection；web-recovery live |
| Computer Use fallback（§24–§29） | ✅DET 核心 + ✅LIVE 链路 | R4 planner、R8 DOM executor、R10 healing、R25 send 加固、**R36 WebRecovery R6 guarded slot（✅DET；live DOM executor 待专属会话）** |
| Qwen repair（P0-7）→ graduation | ✅LIVE（R25 全链路 PASS） | round-25 live-qwen-clean-capture-2（completed/SUCCESS/finalPreview QWEN-OK） |
| engineering loop | ✅DET/LIVE | overcomplete seeded A–E；live-engineering-goal |
| self-repair（Boss 自愈） | ✅DET 核心 | R10 battery；R31–R33 runtime seams |
| restart recovery | ✅DET + live | round-11 restart；evidence/restart/* |
| multi-domain research | ✅DET（§33 5 域 battery）+ ⚠️多域 live 论文 | R12 research-battery（正确拒绝=PASS、假 READY=FAIL）；overcomplete offline-chain / live-research-ready |
| READY PDF / veto / null / insufficient | ✅LIVE 单域 + ✅DET 电池 | live-research-ready / veto；R12 |
| §20 MODEL_DONE≠COMPLETED 运行时验证门 | ✅DET（R31 seam v1，契约默认 OFF）+ ⚠️ seam v2 默认开 | verification-contract.test.ts（fail-closed REWORK 无假完成） |
| §18 raise 前拦截（research WAITING_FOR_USER / Chat→WORK / escalation） | ✅DET（R32/R33 seams） | research-wait-policy.test.ts；work-escalation-verdict.test.ts |
| §38 Scenario G / §39 多故障隔离 | ✅DET（R34） | multi-fault-isolation.test.ts（真实 supervisor+breaker+ledger） |
| §38 Scenario D research 部分失败保留 | ✅DET（R35） | research-partial-failure.test.ts |
| §33/§39 恢复续跑（checkpoint/resume 不重启） | ✅DET（R38） | recovery-resume-battery.test.ts（同一 job 恢复后续跑；有界耗尽 PAUSED） |
| §0.4/§11/§29 能力降级状态机 | ✅DET（R39） | degraded-controller-battery.test.ts（FULL…PAUSED + policy caps） |
| §17/§38 自迭代隔离（rollback） | ✅DET（R40） | engineering-goal-rollback.test.ts（ABORTED 全量回滚、CONVERGED 保留） |
| 人工决策门（raise/resolve/durable） | ✅DET（R41） | human-guidance-gate.test.ts（single-active、fail-closed restore） |
| long soak | ✅DET mini + ✅36 轮全链（~106 min） | R7 soak；R30 36/36（6,386,634 ms） |
| CI / portable / restart smoke | ✅（CI runs 73–81 success；portable smoke PASS） | .github/workflows/ci.yml；round-14/19/26 |
| Owner dashboard（§37/§38/§44） | ✅DET + UI smoke | R5 read-model、R9 UI、R33 真实台账（escalation auto-approve 入账） |

## §42 DS-Hns Final Acceptance 映射（harness 侧，分支 owner-result-autonomy @ 8e24b7d 合入 main）

| 项 | 状态 | 证据 |
|---|---|---|
| Pure Alien regression | ✅（92/92） | DS-Hns tests/unit |
| official renderer untouched | ✅ | installer-contract.test.js |
| OWNER_RESULT / question interception / auto decision | ✅DET | autonomy/*.js + tests |
| non-blocking episode supervision / stall detection / auto steer-retry-continuation | ✅DET | autonomy/{progress-observer,stall-detector,episode-supervisor,continuation-controller}.js |
| result verification / automatic rework / decision ledger | ✅DET | result-validator.js、decision-ledger.js |
| restart recovery / headless / official session | ✅ | scheduler（autonomy 默认 OFF 受控集成） |

## §44 终态呈现（Owner 视角）
- read-model：`src/shared/owner-dashboard.ts`；UI：OwnerSummary strip（R9）；内部决策计数来自 durable
  decision-ledger（R1/R5/R33 escalation 台账真实落账）。
- Owner 技术决策次数：本程序全部轮次 = 0；盲等 = 0。

## 收口待办（R31–R41 后）
1. P0-6 live：真实 provider 窗口里把 R36 R6 guarded slot 接上 DOM-tier Computer-Use 执行器
   （planner→executor 已备：R4/R8），产出 REPAIRED live 证据；无 session 时保持 NEEDS_HUMAN 诚实记录。
2. P0-5 seam v2：OWNER_RESULT 工程任务默认带 verification 契约 + requiredEngineeringChecks 补齐真实
   build/integration/acceptance 门执行后再默认开（当前契约默认 OFF 兼容 51 文件/254 测试全回归）。
3. 长期实证项（非验收缺口）：§34 多域 live READY 论文、>2h 单次连续 soak、UI 视觉/多语言微调。
