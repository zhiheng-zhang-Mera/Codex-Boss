# 00 — Adaptive Provider Intelligence 完整工程设计

## 1. 问题定义

Boss 未来会长期运行不同网页 AI、API 模型、本地模型和可能自动路由的 Provider。简单的：

```text
GPT = 好
Claude = 好
DeepSeek = 好
```

没有实际调度价值。

模型表现至少受到以下变量影响：

```text
Provider
Surface (Web/API/Local)
Selected Model
Observed Backend Model
Mode
Version / Behaviour Epoch
Task semantic context
Role
Context length
Tool availability
Provider policy / supported content
Runtime health
```

因此必须把“模型评价”改造成一个**上下文条件预测系统**：

> 对当前 TaskFingerprint，在当前运行条件下，把某角色交给某 Runtime/Model，最终完整通过验证的概率和成本是多少？

---

# 2. 总体模块

建议新增：

```text
electron/
  learning/
    episode-store.ts
    task-fingerprint.ts
    outcome-evaluator.ts

    concepts/
      concept-registry.ts
      concept-miner.ts
      concept-merge.ts
      concept-split.ts

    providers/
      provider-family.ts
      model-identity.ts
      model-snapshot.ts
      model-observer.ts
      version-resolver.ts
      behaviour-epoch.ts
      change-point-detector.ts
      provider-profile.ts
      behaviour-model.ts

    routing/
      adaptive-scorer.ts
      contextual-bandit.ts
      exploration-policy.ts
      routing-feedback.ts

    evolution/
      policy-candidate.ts
      historical-replay.ts
      shadow-evaluator.ts
      promotion-gate.ts

src/shared/
  adaptive-routing.ts
  learning-episode.ts
  provider-outcome.ts
  task-fingerprint.ts
  model-identity.ts
```

注意：不要求第一阶段一次实现所有高级算法。接口一次设计完整，能力分 Phase 落地。

---

# 3. Canonical Goal 与价值中立主控

新增或明确：

```text
CanonicalGoal
```

它是用户目标的不可变快照。

Planner 可以改变：

- 方法
- 执行顺序
- 工作角色
- 工具
- 并发度
- 重试方案

Planner/Worker 不应自动改变：

- 用户目标本身
- 关键交付物
- 用户显式约束

建议增加 `GoalDriftEvaluator`，其职责不是伦理评估，而是检测“结果是否偏离 Canonical Goal”。

## Main Commander 允许判断

- 能力是否满足
- 资源是否可用
- 权限是否满足
- 是否需要批准不可逆副作用
- 依赖是否满足
- 验收是否通过
- Provider 是否可用
- 路由成本/成功概率

## Main Commander 不负责

- 把 Provider 自身拒绝当成用户目标无效
- 因 Worker 的价值意见自动修改目标
- 把某一 Provider 的限制提升为整个 Boss 的主控判断

Boss 自身显式配置的权限、执行门、部署合规策略仍独立有效。

---

# 4. TaskFingerprint：开放任务空间

禁止无限扩充：

```text
medical
adult
politics
finance
...
```

作为主路由 schema。

取而代之：

```text
TaskFingerprint
├─ semanticVector
├─ role
├─ capabilityRequirements
├─ modality
├─ autonomyLevel
├─ externalEffectLevel
├─ specificity
├─ contextScale
├─ learnedConcepts
└─ fingerprintVersion
```

## 4.1 learned concepts

Concept 不是硬编码 enum。

Boss 可从历史 Episode 中发现：

```text
C-018
prototypeEmbedding = ...
support = 37
humanReadableName = "..."
status = ACTIVE
```

名称只是 UI/解释层。

真正用于相似度和学习的是 prototype / cluster。

## 4.2 Concept 生命周期

```text
CANDIDATE
   ↓
OBSERVING
   ↓
ACTIVE
 ├─ SPLIT
 ├─ MERGED
 └─ DEPRECATED
```

### Split 条件

同一 concept 内部出现稳定、显著不同的 Provider 行为分布。

### Merge 条件

多个 concept 的语义近邻和 Provider outcome 分布长期高度一致。

---

# 5. 两级 Outcome

## 5.1 Runtime Outcome

沿用当前 Runtime 层语义：

```text
SUCCESS
RETRYABLE_FAILURE
PERMANENT_FAILURE
CANCELLED

AUTH_REQUIRED
RATE_LIMITED
PAGE_CHANGED
TIMEOUT
...
```

它回答：

> 调用过程是否成功？

## 5.2 Semantic Outcome

新增：

```text
FULL_COMPLETION
PARTIAL_COMPLETION
GOAL_DRIFT
SOFT_RESTRICTION
HEAVY_SANITIZATION
PARTIAL_REFUSAL
HARD_REFUSAL
BAD_QUALITY
FORMAT_FAILURE
VERIFICATION_FAILURE
UNCLASSIFIED
```

它回答：

> 输出是否按照目标真正完成？

### 典型组合

```text
Runtime SUCCESS + Semantic FULL_COMPLETION
Runtime SUCCESS + Semantic HARD_REFUSAL
Runtime SUCCESS + Semantic GOAL_DRIFT
Runtime TIMEOUT + Semantic UNCLASSIFIED
```

严禁把 `AUTH_REQUIRED / TIMEOUT / PAGE_CHANGED` 直接统计成“模型能力差/限制高”。

---

# 6. Behaviour Axes

Semantic Outcome 最终映射成连续行为轴，避免只做二元判断。

建议：

```text
completion          0..1
goalFidelity        0..1
restrictionImpact   0..1
sanitizationImpact  0..1
quality             0..1 | null
verificationScore   0..1 | null
pipelineBlocking    0..1
```

例如：

```text
FULL_COMPLETION:
completion = 1.0

SOFT_RESTRICTION:
restrictionImpact ~= 0.2

HEAVY_SANITIZATION:
restrictionImpact ~= 0.5
sanitizationImpact ~= 0.7

PARTIAL_REFUSAL:
restrictionImpact ~= 0.75

HARD_REFUSAL:
restrictionImpact = 1.0
completion ~= 0
```

实际数值必须通过测试配置，不硬编码为唯一真理。

---

# 7. ModelExecutionIdentity：网页版真实模型身份

每次调用必须有独立的模型身份快照引用。

分开记录：

```text
provider
surface
selectedModel
declaredModel
observedModelId
mode
versionSource
confidence
observedAt
behaviourEpoch
```

## 7.1 证据可信度顺序

优先：

1. Provider 正常暴露的结构化请求/响应 model identifier
2. 页面正常暴露的结构化 metadata
3. UI model selector / badge
4. Provider 官方声明
5. 行为变化推断
6. UNKNOWN

“询问模型自己是什么版本”的文本回答不得作为高置信度来源。

## 7.2 Web Auto 模式

禁止假设：

```text
conversation == one model
```

必须允许：

```text
Turn 1 -> ModelSnapshot A
Turn 2 -> Unknown/Auto
Turn 3 -> ModelSnapshot B
```

模型身份属于 Invocation/Episode，而不是 Conversation。

---

# 8. ModelSnapshot 去重

连续多次调用身份相同，不重复写大对象。

```text
ModelSnapshot MS-001
```

Episode 只保存：

```text
modelSnapshotId = MS-001
```

模型状态变化时生成 MS-002。

Snapshot hash 可由以下稳定字段构成：

```text
provider
surface
selectedModel
declaredModel
observedModelId
mode
versionSource
```

时间字段不参与 hash。

---

# 9. Behaviour Epoch

网页 Provider 可能不公开实际后端版本。

因此新增行为变点检测：

```text
Provider Web / Selected Model / Observed Model?
   ├─ Epoch 17
   └─ Epoch 18
```

如果以下多个统计发生持续突变：

- completion
- refusal/restriction
- quality
- latency
- format compliance
- tool usage behavior

则创建新 Epoch。

规则：

- 单次异常不得创建 Epoch
- 必须有最小样本量
- 需要变化持续存在
- 新 Epoch 继承旧 Epoch 作为低权重 prior
- 不删除旧历史

---

# 10. Learning Episode

Episode 是长期学习的最小事实单位。

至少保存：

```text
episodeId
taskId
jobId
timestamp

taskFingerprint
canonicalGoalHash

runtimeId
role
modelSnapshotId

runtimeOutcome
semanticOutcome
behaviourAxes

verificationEvidenceRefs
artifactRefs

latency
resourceCost

evaluatorVersion
fingerprintVersion
profilePolicyVersion
```

如果评价结果后续被更高级 evaluator 修正：

- 不覆盖原始 Response/Artifact
- 可以新增 evaluator revision
- 保留审计链

---

# 11. Provider / Model Behaviour Model

不要维护巨大固定表：

```text
provider × every_possible_tag
```

建议画像：

```text
ProviderBehaviourModel
├─ globalBaseline
├─ roleBaselines
├─ latentBehaviourVector
├─ meaningfulConceptOverrides
├─ recentEvidence
├─ sampleCount
└─ uncertainty
```

只持久化具有统计意义的 concept deviation。

例如：

```text
Global completion       .88
Global restriction      .12

C018 restriction        +.61
C041 completion         -.44
C077 quality            +.15
```

---

# 12. Adaptive Routing

现有 RoleRouter 继续负责硬过滤：

- required capability
- runtime availability
- explicit pin/exclude
- budget eligibility
- deterministic fallback

Adaptive Scorer 负责软排序。

建议：

```text
ExpectedUtility =
  P(fullCompletion | task, model)
  * ExpectedVerifiedQuality
  * GoalFidelity
  - RestrictionImpact
  - PipelineBlockingRisk
  - LatencyCost
  - ResourceCost
```

不要把某个 Provider 永久写死为“高/低道德”。

Boss 只学习：

> 某模型在某类语义条件和角色下，完成当前目标的实际概率如何。

---

# 13. Contextual Exploration

纯 exploitation 会把旧结论永久固化。

因此需要受控探索：

```text
Primary = high expected utility + high confidence
Explorer = uncertain but potentially competitive
Avoid = low utility + high confidence
```

第一阶段可用简单 uncertainty-aware epsilon。
成熟阶段切换 Thompson Sampling / UCB / contextual bandit。

不得为了探索牺牲明确的高风险/不可逆执行边界。

---

# 14. 三层学习循环

## Loop A — Execution Adaptation

单任务内：

```text
Provider A semantic failure
↓
record
↓
fallback Provider B
↓
continue task
```

## Loop B — Behaviour Learning

跨任务：

```text
Episodes
↓
profiles
↓
concepts
↓
routing update
```

## Loop C — System Evolution

Boss 修改自己的学习/路由策略：

```text
candidate policy
↓
historical replay
↓
shadow evaluation
↓
controlled live trial
↓
promotion gate
```

禁止：

```text
AI says new formula is better
→ immediately replace stable router
```

---

# 15. 可学习区与硬内核

## Hard invariants

不可由自学习模块自动改写：

- Canonical Goal ownership
- Permission boundaries
- Execution Gate
- Audit/Evidence integrity
- State machine validity
- Rollback requirements
- Explicit user override
- Explicit deployment/system policy

## Evolvable

允许学习：

- provider ranking
- role allocation
- fallback sequence
- agent count
- prompt strategy
- context budget
- retry policy
- concept discovery
- routing weights
- verification depth（在硬下限以上）

---

# 16. Fail-Open / Fail-Closed 边界

## 学习增强层：Fail-Open to deterministic routing

```text
profile DB unavailable
→ static RoleRouter

concept miner failed
→ old concepts

epoch detector failed
→ keep previous epoch

adaptive scorer failed
→ deterministic route
```

## 权限和副作用层：继续 Fail-Closed

```text
permission missing
→ deny side effect

required approval missing
→ no execution
```

绝对不能因为“学习模块 fail-open”而绕过 ExecutionGate/PermissionManifest。

---

# 17. 数据保存和知识库关系

建议分层：

```text
Evidence / Artifact Store
        │
        ├── Learning Episode Store
        │        └── immutable observation history
        │
        ├── Provider Behaviour Store
        │        └── derived/rebuildable
        │
        └── Concept Registry
                 └── derived/rebuildable
```

Provider 画像不是用户知识库本体；它属于 Boss 的系统经验层。

在联队/多设备模式下：

- Episode 写入用户级统一经验库
- Runtime/device 局部 health 单独保存
- Provider/model 行为画像全设备共享
- 设备能力画像不能和 Provider 能力画像混合

---

# 18. UI 最小需求

Provider 面板增加：

```text
Provider / Surface
Observed model
Confidence
Behaviour epoch
Sample count

Completion
Goal fidelity
Verification pass
Restriction impact
Runtime reliability
Latency

Strong learned signals
Recent changes
```

必须明确区分：

- `Provider declared`
- `Observed`
- `Inferred`
- `Unknown`

不得给推断结果伪造“精确版本号”。

---

# 19. 日志与可解释性

每次 Adaptive Routing 记录：

```text
routingDecisionId
candidate runtime/model
hard eligibility
expected utility
confidence
major positive signals
major negative signals
exploration reason
selected candidate
fallback candidates
```

用户查看时应能回答：

> 为什么这次选了 B，而不是 A？

而不是只展示一个不可解释总分。

---

# 20. 完成定义

本工程完成不是“文件存在”。

至少满足：

1. Runtime / Semantic Outcome 已解耦
2. Episode 可持久化、查询、重放
3. ModelSnapshot 可记录 Web 模型身份及置信度
4. Unknown 模型不会被伪造为已知
5. RoleRouter 可消费 adaptive score
6. Adaptive 层故障自动退回原 RoleRouter
7. Provider semantic refusal 不会被误记为 runtime crash
8. AUTH/TIMEOUT 不污染语义画像
9. 新 concept 可在不改 enum 的情况下出现
10. profile 可从 Episode 全量 rebuild
11. behaviour epoch 支持版本变化隔离
12. 自进化策略不能绕过权限/ExecutionGate
13. 有单元测试、集成测试、历史 replay 测试
14. 旧任务和旧 RuntimeAdapter 无需一次性重写即可继续运行
