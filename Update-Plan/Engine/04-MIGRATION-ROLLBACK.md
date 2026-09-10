# 04 — Migration / Rollback / Operational Rules

# 1. 不做 Big Bang 重构

现有链：

```text
MainCommander -> RoleRouter -> Runtime -> RuntimeResult
```

继续工作。

逐步增加：

```text
TaskFingerprint
Adaptive score
ModelSnapshot
SemanticEvaluation
Episode
```

---

# 2. `TaskIR.riskLevel`

当前 `TaskIR` 中 `riskLevel` 实际更接近“执行/副作用风险”。

建议未来迁移为：

```text
executionRiskLevel
```

但不要和本工程第一阶段强绑定，避免扩大变更面。

兼容期：

```ts
riskLevel // deprecated alias
executionRiskLevel // new
```

读取顺序：

```text
executionRiskLevel ?? riskLevel
```

确认所有持久化任务迁移后再移除 alias。

这样防止“risk”以后被误用成内容价值/道德风险字段。

---

# 3. RuntimeResult 向后兼容

避免要求所有 adapter 立即实现 ModelIdentity。

允许：

```text
modelSnapshot = absent
```

Episode 中：

```text
modelSnapshotId = undefined
```

路由则退化到：

```text
runtime-level profile
```

未来有模型身份后再升级为：

```text
runtime + model + epoch profile
```

---

# 4. 数据 schema version

所有长期数据必须：

```text
schemaVersion
```

包括：

- Episode
- ModelSnapshot
- ProviderProfile
- Concept
- BehaviourEpoch
- RoutingPolicy

Migration 必须幂等。

---

# 5. Derived state 与 source-of-truth

Source of truth：

```text
Raw Artifact
Runtime Result
Learning Episode
```

Derived：

```text
Provider Profile
Concept Cluster
Behaviour Epoch statistics
Routing cache
```

Derived 数据损坏：

```text
delete/rebuild
```

不得要求删除 Episode。

---

# 6. Profile rebuild

CLI/dev command 建议：

```text
boss learning rebuild-profiles
boss learning rebuild-concepts
boss learning replay --policy <version>
boss learning inspect-model <snapshot>
```

UI 后续提供等价操作。

---

# 7. Rollback

Routing policy 每次 promotion 保存：

```text
policyVersion
parentVersion
promotedAt
evaluationSummary
rollbackPointer
```

出现异常：

```text
Adaptive Router
↓
rollback stable policy
↓
if still broken
disable adaptive routing
↓
existing RoleRouter
```

---

# 8. 数据量控制

不要保存每种 tag × provider 的稠密矩阵。

只保存：

- Episode
- global/role aggregate
- statistically meaningful concept overrides
- model snapshot
- epoch

旧 Episode 可做冷热分层，但必须保持可重放能力或保留聚合所需的审计快照。

---

# 9. 多设备

统一经验：

```text
User-level learning store
```

设备局部：

```text
Device health
network node
proxy state
GPU/CPU/RAM
local runtime availability
```

模型画像：

```text
Provider/model-level
```

不能把：

```text
Laptop network timeout
```

统计成：

```text
Provider reliability poor
```

必须保留因果来源字段。

---

# 10. Provider Surface

Web/API 必须分开统计。

例如：

```text
ProviderFamily: X
├─ Web
│  └─ Auto / Epoch 4
└─ API
   └─ ExplicitModel-2026xx
```

禁止因为 API 表现好就自动认为 Web 一样。

---

# 11. 版本冷启动

检测到新模型/新 Epoch：

```text
new model prior =
provider-family prior
+ previous-version prior * decay
```

随着新证据积累，旧 prior 权重下降。

绝不：

- 全清零
- 全继承

---

# 12. 用户控制

用户必须可以：

```text
pin Provider
exclude Provider
disable learning
disable adaptive routing
clear derived profile
rebuild derived profile
inspect evidence
```

清 derived profile 不应删除原始 Episode，除非用户明确执行历史删除功能。

---

# 13. 安全边界

Adaptive Provider Intelligence 只能影响：

```text
eligible candidate ordering
fallback preference
role assignment
exploration choice
```

不能影响：

```text
permission allow/deny
execution approval
secret access
filesystem scope
network scope
irreversible action gate
```

也不得实现自动 jailbreak / 安全机制绕过策略。

---

# 14. 建议合并策略

建议分多个小 PR：

```text
PR1 outcome contracts + tests
PR2 episode store
PR3 model identity
PR4 fingerprint/profile
PR5 adaptive scoring integration
PR6 concept discovery
PR7 behaviour epoch
PR8 exploration
PR9 policy evolution
PR10 UI
```

每个 PR 独立：

- build
- lint
- typecheck
- unit tests
- integration tests
- rollback proof

避免一个超大 PR 把 Commander 主链一起改坏。
