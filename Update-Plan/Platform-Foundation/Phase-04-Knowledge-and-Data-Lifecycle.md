# Phase 04 — Knowledge Provenance & Data Lifecycle / 知识可信度与数据生命周期工程书

> **前置分支：** `platform-foundation/03-capability-security-plugins`
>
> **本阶段分支：** `platform-foundation/04-knowledge-data-lifecycle`
>
> **阶段原则：** 防止 Boss 长期运行后出现“错误知识自我强化”和“历史数据无限增长”。知识不是无来源事实，历史也不是永久保留的理由。

## 1. 目标

建立统一的 knowledge provenance、staleness、supersession 和 retention 规则；让 Boss 能区分“当前事实、历史事实、推断、经验、过期知识”，并让 task/artifact/log/screenshot/evidence/knowledge 等数据按生命周期自动分层，而不是无限堆积。

## 2. 绝对约束

- **任何进入 durable knowledge 的 claim 必须有 provenance。** 无来源文本只能是 note/draft，不能标为 verified knowledge。
- **禁止 confidence 自我增长。** 被更多 Agent 重复引用不能自动提高事实置信度。
- **代码相关知识必须绑定 repo + commit/range。** Repo HEAD 越过相关变更后必须允许判 stale。
- **superseded knowledge 不物理覆盖旧记录。** 保留 lineage，但默认检索不能把旧版本当现行事实。
- **删除策略不能删除法律/安全/Owner 明确保留的 evidence。** retention 必须分级。
- **GC 必须可预演（dry-run）和可审计。** 禁止静默批量删除。
- **不得把所有历史都 embedding。** 检索索引与原始归档分离。
- Phase 02 的 transactional state/event 为权威状态底座；Phase 03 的权限模型控制谁能读取、写入和删除哪些知识/数据。

## 3. Knowledge Record 最小模型

```yaml
id: knowledge-...
claim: "Module X must not call Y"
kind: fact | decision | hypothesis | lesson | constraint
scope:
  project: Codex-Boss
  repo: zhiheng-zhang-Mera/Codex-Boss
provenance:
  sourceType: commit | test | artifact | owner | external
  sourceRef: <immutable reference>
validity:
  validFrom: <time/commit>
  validUntil: null
confidence:
  level: verified | supported | tentative | disputed
supersededBy: null
createdAt: ...
```

## 4. 施工任务

### Task A — Provenance contract

- 为 fact/decision/hypothesis/lesson/constraint 定义不同最低证据要求。
- `verified` 必须能追溯 immutable evidence。
- Agent summary 只能生成新 knowledge candidate，不得直接改写旧事实。

### Task B — Staleness engine

至少支持：

- repo commit/path dependency changed。
- manifest/capability version changed。
- owner explicitly invalidated。
- source artifact deleted/quarantined。
- time-sensitive external fact expired。

stale 不是 deleted；检索默认降权或排除，但 lineage 可查。

### Task C — Supersession / contradiction

- 新 claim 与旧 claim 冲突时先 `DISPUTED`，不能直接覆盖。
- Owner 或明确 evidence adjudication 后建立 `supersededBy`。
- 任何结论必须可回溯“为什么当前版本胜出”。

### Task D — Data classes & retention

定义至少：

```text
HOT: active task/project working set
WARM: compressed recent history
COLD: archived evidence/artifacts
DISPOSABLE: screenshots/temp/transient logs/cache
PROTECTED: owner/security/audit evidence
```

每类声明 retention、compression、dedup、archive、delete 权限。

### Task E — GC / compaction

- dry-run 先列出 candidate、原因、预计释放空间。
- 删除必须 event/audit 记录。
- active/referenced/protected 数据不可删除。
- screenshot、重复下载、临时构建产物优先回收。
- Knowledge compaction 只能生成摘要索引，不能把原 evidence 消灭。

### Task F — Retrieval quality guard

建立小型固定 benchmark：

- 当前知识应排名高于 superseded/stale 版本。
- disputed claim 不得被输出成确定事实。
- project A 的知识不能污染 project B。
- source missing 时必须降级可信度。

## 5. 明确不做

- 不做通用向量数据库大迁移。
- 不追求“记住一切”。
- 不允许模型自行永久删除 protected evidence。
- 不把网络事实核验扩展成新的 research 项目。

## 6. 验收门槛

1. Phase 01–03 全部门槛继续通过。
2. durable knowledge 中不存在无 provenance 的 verified claim。
3. 修改一个被 knowledge 依赖的代码路径后，对应知识能被 deterministic 标记 stale。
4. 冲突 claim 保留双方 evidence，直到 adjudication。
5. GC dry-run 与执行结果可逐项对应；PROTECTED/active reference 零误删。
6. 构造 10k+ 混合历史记录后，当前知识检索不被大量 stale history 淹没。
7. 生成 `artifacts/platform-foundation/phase-04/data-lifecycle-report.json`：容量、各层数量、stale/disputed/superseded 数量、GC evidence。

## 7. 回滚规则

- 失败回到 Phase 03。
- 任何不可逆删除前必须存在可恢复备份/checkpoint。
- 如果新 knowledge index 质量低于旧检索，则保留旧读取路径并停止 authority 切换，不允许靠修改 benchmark 降低标准。

## 8. 完成定义

Boss 可以长期积累知识和证据而不把“旧、错、重复、无来源”的内容逐渐变成系统事实；同时数据量增长有明确冷热分层、保留、压缩和清理路径。
