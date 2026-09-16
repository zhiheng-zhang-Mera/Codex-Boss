# Phase 05 — Scale Verification, Compatibility & Soak / 规模化验证与长期运行工程书

> **前置分支：** `platform-foundation/04-knowledge-data-lifecycle`
>
> **本阶段分支：** `platform-foundation/05-scale-verification-soak`
>
> **阶段原则：** 本阶段不再扩张核心能力，而是证明前四阶段形成的平台在模块数、测试数、数据量、外部依赖漂移和长时间无人值守条件下仍可维护、可诊断、可快速迭代。

## 1. 目标

建立 impact-based verification、contract compatibility、provider degradation、coordination-cost telemetry 和长期 soak certification，使 Boss 的迭代成本不随代码/测试/Agent 数量失控增长。

## 2. 绝对约束

- **Impact-based tests 只能减少快速反馈等待，不能取消 merge 前/full scheduled regression。**
- **禁止测试选择器自证安全。** selector 自身必须有反向验证：随机抽样 full run、mutation/changed-edge tests。
- **禁止通过降低 timeout、删除 flaky case 或放宽 acceptance 来提高“稳定率”。**
- **外部 provider 失败必须局部降级。** 单 provider/API/UI 变化不得把 Boss core 判 FAILED。
- **Agent 数量不是质量指标。** 新增 reviewer/judge 必须证明减少 defect/rework，不能只证明“多了一层审查”。
- **所有性能/成本 benchmark 必须记录 hardware、model/runtime、dataset 和 commit。**
- **长期 soak 不允许依赖人工定时清理。** 恢复、GC、provider fallback、journal replay 必须自动发生。

## 3. 施工任务

### Task A — Impact-based test selection

利用 Phase 01 dependency graph 建立：

```text
changed files
→ owning capability
→ reverse dependency / impact radius
→ required test tiers
```

规则：

- unit: 每次相关改动。
- contract/integration: impact radius 内必跑。
- acceptance: capability 风险级别触发。
- full suite: merge gate、scheduled run、自我进化 promotion 前仍保留。

selector 输出必须包含 `whySelected` / `whySkipped`，禁止黑盒跳过。

### Task B — Test ownership & single-authority assertions

- 每个 capability 声明 authoritative unit/contract/acceptance suites。
- 同一 invariant 应有一个权威 contract 测试；其他测试引用 contract，不复制硬编码事实。
- 建立重复断言扫描/报告，优先减少维护重复，不追求机械去重。

### Task C — External compatibility registry

为 provider/runtime/tool 建立：

```text
contractVersion
lastKnownGood
healthProbe
failureClass
degradedFallback
observedAt
```

必须证明：ChatGPT/Claude/Gemini/GitHub/Computer backend 任一单点退化时，registry、scheduler 和 UI 都能准确显示局部 DEGRADED，并在存在合法替代时 reroute。

### Task D — Agent coordination economics

记录每个复杂任务：

```text
model calls
tokens/input-output
wall time
coordination time
coding/execution time
review findings
rework avoided
final diff size
defects escaped
```

建立 guard：加入额外 Agent stage 后，如果长期只增加 token/wall-time 且不改善 defect/rework，不得成为默认 pipeline。

### Task E — Scale synthetic tests

至少构造：

- capability manifests 10× 当前规模。
- dependency edges 10× 当前规模。
- durable events 100k+。
- knowledge/history 10k–100k 级。
- 多项目并存。
- 多 provider 局部失败。

关注正确性优先，其次才是性能。

### Task F — Long soak

建立受控 24h/72h 可重复 soak（CI 可用缩短版，真实环境跑完整版），持续执行：

```text
task create/run/recover
provider health transitions
state transactions
event replay
knowledge write/read/stale
GC dry-run/execute
capability degrade/recover
controlled restart
```

记录内存、磁盘增长、handle/process 数、queue lag、DB size、event backlog、失败恢复次数。

### Task G — Platform certification

生成机器可读 certificate，至少包括：

- architecture graph valid。
- state ownership unique。
- migrations current。
- event journal healthy。
- permission surface no wildcard escalation。
- knowledge provenance/staleness healthy。
- retention/GC healthy。
- targeted + full verification evidence。
- provider degraded-mode evidence。
- soak resource trend。

Self-evolution promotion 必须能消费 certificate，但 certificate 不得绕过 Root/Owner gate。

## 4. 明确不做

- 不新增业务大功能。
- 不接管 Quant/Health 等新项目作为本阶段交付物；它们属于之后 dogfooding。
- 不建立复杂分布式基础设施；单机 SQLite/本地控制面足够则禁止引入 Kafka、Kubernetes 等。
- 不以“未来可能需要”为理由新增未被 benchmark 证明的抽象层。

## 5. 验收门槛

1. Phase 01–04 全部门槛继续通过。
2. 任意典型小改动的快速验证只运行受影响测试，但同一 commit 的 full gate 结果一致。
3. selector 故意漏掉受影响 capability 的测试必须被 meta-test 检出。
4. 单 provider/adapter 破坏只导致局部 DEGRADED，并有准确 fallback/拒绝行为。
5. 100k event 与大规模 knowledge/history 测试无一致性错误、无跨项目污染。
6. 真实长 soak 中无持续无界内存/磁盘/handle/process 增长；允许增长项必须能由 retention policy 解释。
7. restart/recovery 后无 committed work 丢失、无重复外部副作用。
8. 多 Agent 默认 pipeline 的每一额外 stage 都有成本收益 evidence。
9. 输出 `artifacts/platform-foundation/phase-05/platform-certificate.json` 与 soak report。

## 6. 回滚规则

- 失败回到 Phase 04。
- impact selector 有任何漏测证据时，立即退化为 full suite，不允许带风险继续加速。
- compatibility/fallback 有误路由时，优先 fail closed，不得为了可用性把任务送到权限/能力不匹配的 provider。
- soak 发现资源泄漏时必须先定位 owner，再修复；禁止仅靠定时重启掩盖可复现泄漏。主动重启仍可作为产品策略，但不能替代缺陷修复。

## 7. 完成定义

完成后，Boss Platform Foundation 才算结束：系统不仅“现在能跑”，而且拥有可计算架构、事务状态、持久事件、最小权限、知识可信度、数据生命周期、影响测试和长期运行证据。下一阶段才能安全进入 Quant-ultra 等真实项目 dogfooding，并用实际工作负载继续发现平台问题，而不是继续凭想象扩张基础设施。
