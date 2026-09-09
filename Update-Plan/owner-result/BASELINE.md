# Owner-Result Rev.2 基线冻结记录（Update-Plan/Owner-Result.md）

> 目的：在 main 主干的既有 Overcomplete 能力之上建立 Rev.2 施工基线，防止
> Owner-Result 阶段的重构导致 130% Overcomplete 已确证能力倒退。
> 冻结时间：2026-09-09（本地执行环境）
> 契约文档：`Update-Plan/Owner-Result.md`（版本 2026-09-09 Rev.2，§0–§46）

## 工作分支

- 基线分支（冻结）：`main` = `3d8233a`（Merge branch '9-8-overcomplete' into main；working tree clean）
- 开发分支：`owner-result`（自 `main` 创建，本轮起用）
- 推送策略：里程碑闭合后合并回 `main` 并按完成日期记录（沿用 9-x 分支惯例）

## 基线清单（Rev.2 §41/§44 相关既有能力快照）

| 项目 | 值 | 状态 |
|---|---|---|
| 基线 commit | `3d8233a`（main，工作树干净） | ✅ |
| Overcomplete 进度锚点 | `Update-Plan/overcomplete/PROGRESS.md`（Round 9+，29 文件 / 122 测试 PASS，full build PASS） | ✅ |
| 实测证据锚点 | `Update-Plan/overcomplete/evidence/live/INDEX.md`（1/3/4/5-AI、council、engineering goal、research READY、layout/window 均留痕） | ✅ |
| 确定性测试入库 | `tests/unit/**` 26 文件（vitest include `tests/**/*.test.ts`，node 环境，60s 超时） | ✅ |
| 运行模式词汇 | `work-mode.ts`（1/3/5 AI + roles） | ✅ |
| 任务数据模型 | `contracts.ts` BossTask / ProviderRun / EvidenceBundle / FinalResponse（schemaVersion 2） | ✅ |
| 执行监督 | `electron/commander/execution-supervisor.ts`、`scheduler.ts`、`web-recovery.ts`、`recovery-scheduler.ts`、`circuit-breaker.ts` | ✅ |
| 人工门 | `electron/commander/human-guidance-gate.ts` + `src/shared/intervention.ts`（decideIntervention AUTO_RECOVER/REQUIRES_USER） | ✅ |
| 证据门 | `electron/evidence-engine.ts`（decision PASS / HOLD_FOR_REVIEW fail-closed） | ✅ |
| Computer Use | `electron/computer/**`（dom / provider-dom-surface / vision / windows-uia / windows-ocr / structured-apps / vscode-cli）+ `semantic-runtime.ts` + 权限 `permission.ts` | ✅（能力在，未全接 Provider Recovery） |
| Qwen 现实缺口 | `evidence/live/live-finding-qwen-*.json`（send 控件未解析；模型无图像输入记录） | ⚠️ Rev.2 P0-7 目标 |
| provider 登录态 | `.cache/browser-profile/Partitions/codex-boss-*`（ChatGPT/Gemini/DeepSeek/Qwen/Claude…） | ✅ 持久登录可用 |

## Rev.2 缺口摘要（本轮施工入口，Owner-Result.md §45 顺序）

1. **P0-1 Owner-Result Contract 不存在**：代码中无 ASSISTED/AUTONOMOUS/OWNER_RESULT 模式词汇、
   HB1–HB4 硬阻塞分类、checkpointBudget=0 语义、问题分类（DECIDABLE / HARD_BLOCKER）与决策台账。
2. **P0-2/P0-3 监督语义缺口**：有 scheduler/supervisor，但缺少统一的 Job 生命周期词汇
   （QUEUED…RECOVERING）、heartbeat 字段模型（lastAnyActivityAt / lastSemanticProgressAt /
   lastResponseDeltaAt / lastPageStateAt）、SLOW vs STALLED vs FAILED 判别、R0–R8 恢复梯、
   straggler provisional quorum、provider replacement。
3. **P0-4 Question Interceptor 不存在**：人工门 raise 前无“问题候选 → 自动决策”拦截层；
   方向性停滞（§19）无逐次升级梯。
4. **P0-5 Result Validator 语义缺口**：任务终态缺少显式 MODEL_DONE → VERIFYING → PASS/REWORK
   判别与验证门清单（工程/研究两条链 §21/§22）。
5. **P0-6/P0-7**：Computer Use 尚未正式接入 web-recovery 的 provider 页面恢复路径；Qwen
   send 失败尚无 Computer Use 接管 + repair evidence 闭环。
6. **§38 Decision Ledger 不存在**：自动决策无持久化台账（问题/候选/选择/证据/结果/是否回滚）。

> 后续轮次按 §45 顺序推进；每轮结束：typecheck + vitest + build PASS、
> 证据 JSON 落 `Update-Plan/owner-result/evidence/<round>/`、PROGRESS.md 更新、git 提交。
