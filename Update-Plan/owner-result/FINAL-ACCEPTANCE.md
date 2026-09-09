# Owner-Result Rev.2 — Final Acceptance Matrix（§41/§42/§44 映射）

> 分支 owner-result（自 main @ 3d8233a）；每项标注：状态 + 收敛方式/证据位置。
> 口径：`MODEL_DONE ≠ COMPLETED`；只有确定性测试 + 证据门 PASS 才算完成；
> live 项需真实 provider 会话（既有分区 `.cache/browser-profile/Partitions/codex-boss-*`）。
> 状态：✅DET = 确定性验收通过；✅LIVE = 实况证据通过；⚠️LIVE-TODO = 需 live 轮；📋 = 文档/矩阵承载。

## §41 Boss Final Acceptance 映射（产品侧）

| 项 | 状态 | 证据 |
|---|---|---|
| 1 AI / 3 AI / 5 AI 并行 | ✅LIVE（overcomplete） | evidence/live/live-{1,3,5}ai-* |
| Chat continuation / Work fresh | ✅LIVE | live-chat-vs-work / live-chat-continuation |
| non-blocking waiting（不占调度/不盲等） | ✅DET + live 基础 | R2 runMode、R3 DSH continuation-controller、R7 soak（§17 slot 释放、hard horizon） |
| provider recovery | ✅DET + live 基础 | R6 fault injection（auth/timeout/quota/defer）、既有 web-recovery live |
| Computer Use fallback（§24–§29） | ✅DET 核心 + ⚠️LIVE-TODO 接线 | R4 planner、R8 DOM 执行器、R10 healing battery |
| Qwen repair（P0-7） | ⚠️LIVE-TODO | R10 场景；live evidence/live/live-finding-qwen-*（缺口基线） |
| engineering loop | ✅DET/LIVE | overcomplete seeded A–E / live-engineering-goal |
| self-repair（Boss 自愈） | ✅DET 核心 + ⚠️接线 | R10 battery |
| restart recovery | ✅DET（本轮 acceptance-restart）+ 既有 live | round-11 restart 证据；evidence/restart/* |
| multi-domain research | ⚠️部分 live + 确定性链 | overcomplete offline-chain / live-research-ready |
| READY PDF / veto / null / insufficient | ✅LIVE（overcomplete 单域） / ⚠️多域电池 | live-research-ready / veto 记录；P1-4 battery TODO |
| long soak | ✅DET mini + ⚠️长时 live | R7 soak（§36 不变量） |
| CI / portable / restart smoke | ✅（本仓库 CI 绿；本轮 restart smoke） | .github/workflows/ci.yml；round-11 |
| Owner dashboard（§37/§38/§44） | ✅DET + UI smoke | R5 read-model、R9 UI + electron smoke |

## §42 DS-Hns Final Acceptance 映射（harness 侧，分支 owner-result-autonomy @ 8e24b7d）

| 项 | 状态 | 证据 |
|---|---|---|
| Pure Alien regression | ✅（本轮修复后 92/92） | DS-Hns tests/unit（installer-contract §42 契约修复） |
| official renderer untouched | ✅（修复后契约） | installer-contract.test.js（官方视图无 preload） |
| OWNER_RESULT / question interception / auto decision | ✅DET（autonomy 模块） | autonomy/question-interceptor.js + tests |
| non-blocking episode supervision | ✅DET | autonomy/{progress-observer,stall-detector,episode-supervisor}.js |
| progress / stall detection | ✅DET | 同上 + tests |
| auto steer / auto retry / automatic continuation | ✅DET | continuation-controller.js（bounded/backoff/deadline） |
| result verification / automatic rework | ✅DET | result-validator.js + continuation REWORK |
| restart recovery / headless / official session | ✅ 既有 alien | scheduler（headless/official-session）；autonomy 受控集成默认 OFF |
| decision ledger | ✅DET | autonomy/decision-ledger.js（durable、fail-closed） |

## §44 终态呈现（Owner 视角）
默认只显示 GOAL/STATUS/PROGRESS/RESULT/EVIDENCE/HARD_BLOCKER：
- read-model：`src/shared/owner-dashboard.ts`（R5）
- UI：OwnerSummary strip（R9）；内部决策计数来自 durable decision ledger（R1/R5）
- Owner 技术决策次数：本程序全部轮次 = 0；盲等 = 0（无 HARD_BLOCKER 上报）

## 收口待办（后续轮）
1. P0-6 guarded 接线 + live（真实 provider 窗口）修复证据（Qwen send 接管 = P0-7）。
2. P1-4 research 5 域电池确定性状态机（REJECTED/INCONCLUSIVE/INSUFFICIENT_EVIDENCE/REPLICATION_FAILED 正确拒绝=PASS；假 READY=FAIL）。
3. P2 收尾：README/Update-Log 增补、portable 打包 smoke、CI 复核、owner-result 合 main。
