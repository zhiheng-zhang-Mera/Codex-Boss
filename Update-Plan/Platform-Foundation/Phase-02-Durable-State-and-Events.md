# Phase 02 — Durable State & Event Core / 持久状态与事件底座工程书

> **前置分支：** `platform-foundation/01-architecture-contracts`
>
> **本阶段分支：** `platform-foundation/02-durable-state-events`
>
> **阶段原则：** 解决“单个 JSON 很可靠、跨多个 store 却可能逻辑不一致”和“内存事件 crash 后消失”两类未来地雷；不顺便做插件、安全权限、知识治理。

## 1. 目标

在不一次性推翻现有 JSON stores 的前提下，引入可事务化的 durable state 核心与 durable event journal，使关键跨状态变更具备一致性、恢复性、迁移可审计性和 crash replay 能力。

## 2. 绝对约束

- **禁止 Big Bang migration。** 现有 JSON store 必须允许分域渐进迁移。
- **禁止双写无仲裁。** 任何 dual-write 期间必须明确 authoritative side、comparison evidence 和退出条件。
- **禁止 silently repair corrupted state。** 损坏数据必须 quarantine + 记录，不能自动当作空状态覆盖。
- **禁止 event replay 产生重复外部副作用。** 所有可 replay handler 必须幂等或有 idempotency key。
- **禁止让 SQLite 成为新的 service locator。** DB 只是状态/事件底座，不拥有业务决策。
- 数据 schema 版本必须显式，migration 只能向前执行并保留 backup/checkpoint。
- Phase 01 的 state owner 是唯一写权限来源；迁移不得制造第二 authoritative owner。

## 3. 建议结构

```text
electron/state-core/
  database.ts
  transaction.ts
  schema-version.ts
  migration-runner.ts
  state-repository.ts
  event-journal.ts
  event-consumer.ts
  recovery.ts
  quarantine.ts

tests/unit/state-core/
tests/acceptance/state-core/
```

优先使用 SQLite；库选择应满足 Windows portable packaging、transaction、WAL、可备份恢复。不得因为 ORM 便利引入重量级框架。

## 4. 施工顺序

### Task A — Schema 与数据库生命周期

- 建立单一 DB lifecycle owner。
- 启动必须检测 schema version。
- migration 前创建可验证 checkpoint。
- migration 中断后再次启动必须 deterministically resume 或 rollback，不得处于未知状态。

### Task B — Durable event journal

事件记录最少包含：

```text
id
sequence
type
aggregateId
payload
createdAt
schemaVersion
idempotencyKey
producer
```

- append 必须在 transaction 内完成。
- 对要求“状态改变 + 事件发布”的关键路径，两者必须同 transaction commit。
- consumer 保存 durable cursor。
- crash 后从 cursor 恢复。
- malformed event 进入 quarantine，不能阻塞整个 journal 永久前进。

### Task C — 关键域试点迁移

只选择 1–2 个高价值域试点，例如 task lifecycle + decision ledger；禁止本阶段把所有 JSON stores 一次迁完。

每个试点必须经历：

```text
read-old baseline
→ shadow read/compare
→ authoritative DB write
→ restart/replay acceptance
→ remove old authoritative write
```

旧 JSON 可以暂时保留只读兼容，但必须明确 sunset 条件。

### Task D — DomainEventBus 桥接

保留当前 in-process bus 作为低延迟通知层，但关键 durable event 的来源必须是 journal。

原则：

```text
transaction commit
→ durable journal
→ in-process notification
```

不能反过来把 fire-and-forget bus 当作唯一事实来源。

### Task E — Recovery & integrity

必须覆盖：

- process 在 transaction 前 crash。
- transaction commit 后、handler 执行前 crash。
- handler 执行一半 crash。
- 同一 event replay 两次。
- DB 文件损坏/无法打开。
- migration 中途失败。

任何恢复都必须留下 evidence。

## 5. 明确不做

- 不实现 plugin loader。
- 不授予新权限。
- 不改知识可信度模型。
- 不做历史数据 GC。
- 不把所有事件都强制 durable；纯 UI transient event 可以继续内存化，但必须有分类规则。

## 6. 验收门槛

1. Phase 01 全部门槛继续通过。
2. 新 state-core 单测覆盖 transaction rollback、WAL/restart、schema migration、quarantine、consumer cursor、idempotent replay。
3. 至少一个真实业务流程证明“多个逻辑状态 + event”原子提交。
4. 强杀 Electron 后重启，已 commit 的事件不能丢；未 commit 的半状态不能出现。
5. replay 不得重复执行外部 mutation。
6. shadow compare 连续通过指定 acceptance battery 后才能切 authority。
7. 产出 `artifacts/platform-foundation/phase-02/state-migration-report.json`，列出哪些 namespace 已迁移、谁 authoritative、哪些仍为 JSON。

## 7. 回滚规则

- 本阶段失败回到 Phase 01 最终提交。
- schema migration 失败时必须优先保护旧数据，宁可拒绝启动相关能力，也禁止以空库继续。
- 不允许为了 migration 成功删除历史状态。

## 8. 完成定义

完成后 Boss 仍可保留大量 JSON，但核心已经具备一个可以逐域迁移的 transactional state/event substrate；后续规模增长不再依赖“很多原子文件碰巧一起成功”。
