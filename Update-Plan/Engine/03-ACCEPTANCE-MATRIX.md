# 03 — Acceptance Matrix

本文件是工程是否完成的最终标准。

| ID | 验收项 | 必须结果 |
|---|---|---|
| A01 | 所有 adaptive flag 关闭 | 行为与原 stable Router 一致 |
| A02 | Runtime SUCCESS + 正常完成 | Semantic = FULL_COMPLETION |
| A03 | Runtime SUCCESS + 明确拒绝 | Semantic = HARD_REFUSAL，不记 runtime failure |
| A04 | Runtime SUCCESS + 只完成部分 | PARTIAL_COMPLETION / PARTIAL_REFUSAL 可区分 |
| A05 | Runtime TIMEOUT | 不增加 restriction penalty |
| A06 | AUTH_REQUIRED | 不增加 capability/restriction penalty |
| A07 | PAGE_CHANGED | 不增加 semantic negative evidence |
| A08 | Goal 被 Worker 明显改写 | GOAL_DRIFT 被记录 |
| A09 | Episode 写入 | 可按 task/job/runtime 查询 |
| A10 | Episode store 重启 | 数据不丢失 |
| A11 | Profile 删除 | 能从 Episode 全量 rebuild |
| A12 | Rebuild | 结果可重复且版本可审计 |
| A13 | UI 显示 explicit model | selectedModel 正确记录 |
| A14 | Web Auto | selectedModel=Auto；不得伪造 backend ID |
| A15 | backend ID 不可观测 | observedModelId=undefined/UNKNOWN |
| A16 | 同一 conversation 不同 turn | 可绑定不同 ModelSnapshot |
| A17 | ModelSnapshot 相同 | 去重引用而非重复存储 |
| A18 | 新模型 ID 出现 | 新 snapshot/epoch，不污染旧版本 |
| A19 | 持续行为突变 | 达阈值后可创建新 Behaviour Epoch |
| A20 | 单次异常 | 不创建 Behaviour Epoch |
| A21 | 新语义聚类 | 不改 enum 即可生成 Concept |
| A22 | Concept display name 改名 | 不影响 Concept ID/历史 |
| A23 | Adaptive score 存在 | 只重排 hard-eligible candidates |
| A24 | Runtime 被 excluded | Adaptive 不得恢复 |
| A25 | Runtime capability 不满足 | Adaptive 不得恢复 |
| A26 | 用户 pinned runtime | 在满足硬条件时保持显式优先 |
| A27 | Adaptive service 抛异常 | 自动回退现有 RoleRouter |
| A28 | Profile DB 损坏 | Boss 基础任务仍可运行 |
| A29 | Concept miner 损坏 | 继续使用旧 concept/基础路由 |
| A30 | Epoch detector 损坏 | 不影响任务执行 |
| A31 | Provider 历史低完成 + 高置信度 | 合理降权 |
| A32 | Provider 历史未知 + 潜力高 | exploration policy 可有限探索 |
| A33 | 新模型版本 | 继承旧信息的低权重 prior，而非完全混合 |
| A34 | 旧模型历史 | 始终可单独查询 |
| A35 | 路由日志 | 能解释选 B 不选 A 的主要因素 |
| A36 | Learning disabled | 仍可运行任务 |
| A37 | Adaptive routing disabled | 可继续记录 Episode |
| A38 | Permission 不满足 | Adaptive 不能绕过 |
| A39 | Execution approval 不满足 | Adaptive 不能绕过 |
| A40 | Provider refusal | 不自动修改 Canonical Goal |
| A41 | Worker 异议 | 不能成为修改用户目标的唯一依据 |
| A42 | Candidate self-evolution policy | 必须先 historical replay |
| A43 | Candidate replay regression | 不得 promotion |
| A44 | Shadow mode 失败 | 不得替换 stable policy |
| A45 | Stable policy promotion | 有版本号和 rollback pointer |
| A46 | rollback | 能恢复上一个 stable routing policy |
| A47 | 多设备 Episode | 可汇总到统一用户经验库 |
| A48 | device health | 不和 provider behaviour profile 混存 |
| A49 | 旧 RuntimeAdapter | 在未提供模型观察字段时仍兼容 |
| A50 | 全量回归测试 | Commander/StateMachine/ExecutionGate 原行为无破坏 |

## 必须的故障注入测试

至少人工/自动注入：

```text
episode DB unavailable
profile builder exception
model observer returns malformed metadata
concept miner timeout
adaptive scorer throws
change-point detector corrupt state
```

预期全部：

```text
学习功能降级
≠
Boss 整体崩溃
```

## 必须的统计污染测试

构造 100 次：

```text
TIMEOUT
AUTH_REQUIRED
PAGE_CHANGED
```

确认 provider 的：

```text
restrictionImpact
goalFidelity
semantic completion
```

不会因为运行层故障被错误大幅下降。

## 必须的版本隔离测试

模拟：

```text
Model A epoch 1
50 episodes: completion 0.5

Model A epoch 2
50 episodes: completion 0.95
```

要求：

- epoch 2 的当前预测快速靠近新版表现
- epoch 1 仍能单独查询
- provider-family aggregate 可展示，但不能覆盖 version-aware routing
