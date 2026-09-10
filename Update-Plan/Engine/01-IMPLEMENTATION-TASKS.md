# 01 — Implementation Tasks

原则：每一 Phase 必须可单独上线；后续 Phase 失败不得破坏前一 Phase。

# Phase 0 — Baseline / Compatibility

- [ ] 为现有 `RuntimeResult`、`RoleRouter`、`TaskIR` 建 baseline tests
- [ ] 记录当前 deterministic route 行为，作为回归 oracle
- [ ] 建 feature flag：
  - `adaptiveProviderLearning`
  - `semanticOutcomeEvaluation`
  - `modelIdentityObservation`
  - `adaptiveRouting`
  - `behaviourEpochDetection`
- [ ] 所有 flag 默认可独立关闭

验收：所有 flag=false 时行为与当前 stable 分支一致。

---

# Phase 1 — Semantic Outcome Foundation

新增：

- [ ] `src/shared/provider-outcome.ts`
- [ ] `electron/learning/outcome-evaluator.ts`

实现：

- [ ] RuntimeOutcome / SemanticOutcome 解耦
- [ ] 行为连续轴
- [ ] evaluator versioning
- [ ] 无法判断时必须 `UNCLASSIFIED`
- [ ] 不允许把 timeout/auth/page failure 推断为 semantic refusal

新增测试：

- [ ] runtime success + hard refusal
- [ ] runtime success + partial completion
- [ ] timeout -> semantic unclassified
- [ ] auth required -> no semantic penalty
- [ ] goal drift detection
- [ ] format failure 与 provider restriction 区分

---

# Phase 2 — Episode Store

新增：

- [ ] `src/shared/learning-episode.ts`
- [ ] `electron/learning/episode-store.ts`

要求：

- [ ] append-only 原始 Episode
- [ ] schema version
- [ ] evaluator revision
- [ ] task/job/runtime/model snapshot refs
- [ ] evidence/artifact refs
- [ ] 查询：
  - by provider
  - by model snapshot
  - by behaviour epoch
  - by time
  - by task fingerprint/concept
- [ ] profile rebuild 能从 Episode 重放

---

# Phase 3 — Model Identity Observation

新增：

- [ ] `src/shared/model-identity.ts`
- [ ] `providers/model-observer.ts`
- [ ] `providers/model-snapshot.ts`
- [ ] `providers/version-resolver.ts`

实现：

- [ ] provider
- [ ] surface
- [ ] selectedModel
- [ ] declaredModel
- [ ] observedModelId
- [ ] mode
- [ ] source
- [ ] confidence
- [ ] observedAt

Web adapter 仅采集网页正常暴露、Boss 可合法读取的 UI/metadata/请求响应字段；不增加绕过 Provider 控制的机制。

验收：

- [ ] UI explicit model 能记录
- [ ] Auto 能记录为 Auto
- [ ] 无 model ID 时 `observedModelId=undefined`
- [ ] 不使用 guessed exact model id
- [ ] 一次会话多个调用允许不同 snapshot

---

# Phase 4 — Task Fingerprint

新增：

- [ ] `src/shared/task-fingerprint.ts`
- [ ] `electron/learning/task-fingerprint.ts`

MVP：

- [ ] role
- [ ] required capabilities
- [ ] modality
- [ ] specificity
- [ ] autonomy
- [ ] context scale
- [ ] semantic representation abstraction

第一阶段 embedding backend 可插拔。
即使 embedding 不可用，也必须退化到 deterministic structural fingerprint。

---

# Phase 5 — Provider Behaviour Profile

新增：

- [ ] `providers/provider-profile.ts`
- [ ] `providers/behaviour-model.ts`
- [ ] confidence estimator

先实现：

```text
global baseline
role baseline
recent rolling metrics
uncertainty
sample count
```

再实现 concept override。

严禁把 brand stereotype 写死进默认配置。

---

# Phase 6 — Adaptive Scorer

新增：

- [ ] `routing/adaptive-scorer.ts`
- [ ] `routing/routing-feedback.ts`

修改：

- [ ] `RoleRouter` 增加 optional adaptive scoring dependency
- [ ] hard eligibility 仍由现有 Router / Registry / Budget 决定
- [ ] adaptive score 只能重排 eligible candidate
- [ ] pinned runtime 保持显式用户控制优先级
- [ ] adaptive service exception -> static route

验收：

- [ ] profile 不存在 -> 原排序
- [ ] profile DB error -> 原排序
- [ ] history 明显支持 B 时，可把 B 排到 A 前
- [ ] hard excluded runtime 永远不能被 adaptive 恢复

---

# Phase 7 — Concept Discovery

新增：

- [ ] `concept-registry.ts`
- [ ] `concept-miner.ts`
- [ ] support threshold
- [ ] concept activation lifecycle

后续：

- [ ] merge
- [ ] split
- [ ] deprecation

要求：

- [ ] Concept ID 稳定
- [ ] display name 可变
- [ ] display name 不是路由唯一依据
- [ ] 新 concept 不需要 schema migration

---

# Phase 8 — Behaviour Epoch

新增：

- [ ] `change-point-detector.ts`
- [ ] `behaviour-epoch.ts`

输入：

- completion
- goal fidelity
- restriction
- quality
- latency
- format compliance

要求：

- [ ] min samples
- [ ] sustained change
- [ ] confidence threshold
- [ ] previous epoch preserved
- [ ] new epoch inherits decayed prior

---

# Phase 9 — Contextual Exploration

新增：

- [ ] `exploration-policy.ts`
- [ ] uncertainty-aware exploration

MVP：
- conservative uncertainty bonus

成熟：
- Thompson/UCB/contextual bandit

要求：

- [ ] 高置信度低表现不强行探索
- [ ] 高不确定度且潜在竞争者可少量探索
- [ ] 用户 pin 永远可覆盖 soft score
- [ ] 不越过 permissions/execution gate

---

# Phase 10 — Policy Evolution

新增：

- [ ] policy candidate format
- [ ] historical replay
- [ ] shadow evaluator
- [ ] promotion gate
- [ ] rollback metadata

升级只有在：

```text
candidate
→ replay pass
→ regression pass
→ shadow pass
→ controlled trial pass
```

后才能成为 stable。

---

# Phase 11 — UI / Observability

- [ ] Provider intelligence panel
- [ ] Model snapshot timeline
- [ ] Behaviour epoch timeline
- [ ] Routing explanation
- [ ] Episode drill-down
- [ ] Reset derived profile
- [ ] Rebuild profile from episodes
- [ ] Disable adaptive routing while retaining learning
- [ ] Disable learning while retaining current cached profile（可选）

---

# Phase 12 — Documentation

更新：

- [ ] `STRUCTURE.md`
- [ ] architecture docs
- [ ] runtime adapter contract
- [ ] routing contract
- [ ] failure taxonomy
- [ ] profile schema
- [ ] migration guide
- [ ] troubleshooting

---

# 建议施工优先级

必须先完成：

```text
P1 Semantic outcome
P2 Episode store
P3 Model identity
P4 Task fingerprint
P5 Profile
P6 Adaptive routing
```

这是最小闭环。

然后：

```text
P7 Concepts
P8 Epoch
P9 Exploration
P10 Self-evolution
```

属于增强闭环。

禁止先做“自修改 Router”再补 Episode / Replay，因为那样无法审计也无法可靠回滚。
