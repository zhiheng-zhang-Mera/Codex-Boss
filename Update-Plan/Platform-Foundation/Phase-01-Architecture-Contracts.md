# Phase 01 — Architecture Contracts / 架构约束层工程书

> **基线：** `4b623b985cd9a8630a74382600780671554105d2`
>
> **分支：** `platform-foundation/01-architecture-contracts`
>
> **阶段原则：** 本阶段只建立“未来系统如何增长”的机器可读约束，不迁移持久化底座、不开放插件执行、不重写现有 BootModule，不借机继续拆 `main.ts`。

## 1. 目标

把当前“高度模块化单体”提升为可长期扩展的平台骨架，让未来新增几十到数百个能力模块时，依赖、状态归属、兼容性、影响范围和架构边界都能被机器检查，而不是靠人或 Agent 记忆。

必须交付四类一等公民：

1. Capability Manifest：模块提供什么、依赖什么、可选依赖什么、版本是什么。
2. Dependency Graph：启动前可解析依赖、检测循环、生成影响半径。
3. State Ownership Registry：每类 durable state 只有一个 authoritative owner。
4. Architecture Ratchets：核心边界只能保持或改善，不能静默退化。

## 2. 绝对约束

- **禁止引入 DI container / service locator。** 保留显式 factory wiring；manifest 只能描述和验证，不能把依赖解析变成运行时魔法注入。
- **禁止改写现有 24 个 BootModule 的业务逻辑。** 只允许增加适配元数据和验证入口。
- **禁止把 Feature 实现重新塞回 Kernel。** 新能力只能通过 contract 暴露。
- **禁止出现 capability implementation 直接互相 import。** 跨能力依赖必须指向稳定 contract / interface。
- **禁止把 optional capability 缺失升级成全局启动失败。** 非关键能力只能 `DEGRADED`。
- **禁止删除当前验收或放宽现有安全断言以换取通过。**
- 本阶段任何迁移必须可在一个 commit 内回退，不允许“一半旧结构、一半新结构但没有兼容层”的中间态进入阶段最终提交。

## 3. 目录与接口边界

建议新增：

```text
electron/platform/
  capability-contract.ts
  capability-manifest.ts
  capability-registry.ts
  dependency-graph.ts
  state-ownership.ts
  architecture-ratchet.ts
  platform-health.ts

config/capabilities/
  core/*.yaml|json
  features/*.yaml|json

tests/unit/platform/
  capability-manifest.test.ts
  dependency-graph.test.ts
  state-ownership.test.ts
  architecture-ratchet.test.ts
```

### Manifest 最小字段

```yaml
id: research.autopilot
version: 1.0.0
kind: feature
provides:
  - research.plan@1
  - research.execute@1
requires:
  - artifact.store@1
  - engineering.workspace@2
optional:
  - browser.search@1
state:
  - namespace: research.run
    owner: research.autopilot
health:
  critical: false
```

本阶段 **不加入权限字段的执行语义**；权限将在 Phase 03 落地。本阶段允许先保留 `permissions` schema 字段，但不得据此授予任何真实能力。

## 4. 分阶段施工任务

### Task A — Capability contract

- 定义 `CapabilityId`、`CapabilityVersion`、`CapabilityRequirement`、`CapabilityManifest`。
- parser 必须拒绝：空 ID、重复 provide、非法 semver、同一 capability 同时 required+optional。
- manifest 文件必须可以被纯 Node 单测加载，不依赖 Electron。

### Task B — Dependency graph

- 输入全部 manifest，输出 DAG。
- 必须检测并拒绝 required dependency cycle。
- optional cycle 不得成为 required boot blocker，但必须报告。
- 提供 `impactRadius(capabilityId)`，返回所有直接和传递依赖方。
- 图结果必须 deterministic；同一组 manifest 不受文件遍历顺序影响。

### Task C — State ownership registry

- 为现有 durable state 建立 inventory：task、conversation、history、research、engineering、knowledge、decision、session、identity、runtime、evolution 等。
- 每个 namespace 只允许一个 authoritative owner。
- 多个读者允许；多个 owner 必须直接测试失败。
- registry 先作为约束与文档来源，不迁移现有 JSON 写路径。

### Task D — Architecture ratchets

至少建立以下自动断言：

- capability dependency cycle = 0。
- Kernel 不 import feature implementation。
- manifest 未登记的新 feature module 不允许进入 boot graph。
- `main.ts` 不重新增加 literal IPC registration。
- composition root 允许增长 wiring，但必须记录 boot module 数量与依赖边数；依赖密度异常增长时失败或显式 baseline bump。
- architecture baseline 只能通过独立、可审计的 baseline update command 修改，禁止测试自动重写 baseline。

### Task E — 可视化与诊断

提供非 GUI 的只读诊断命令，例如：

```text
pnpm run architecture:graph
pnpm run architecture:impact -- knowledge.core
pnpm run architecture:ownership
```

输出必须适合 Agent 读取，优先 JSON + 简短文本摘要。

## 5. 明确不做

- 不切 SQLite。
- 不做 durable event journal。
- 不做 plugin loader。
- 不做权限授予。
- 不做数据清理/GC。
- 不做 impact-based test skipping，只提供 impact graph。
- 不继续大拆 `main.ts`。

发现这些需求时，只记录到下一阶段输入，不得顺手实现。

## 6. 验收门槛

阶段结束必须同时满足：

1. 现有 `typecheck` / `security:scan` / `build` / unit / slow / postbuild / 完整 CI 全绿。
2. 所有现有 boot module 都能映射到 manifest 或被明确标记为 kernel composition-only。
3. Required dependency graph 无循环。
4. State ownership 无重复 owner。
5. 删除任意一个非 critical optional manifest 后，Boss 可启动并把相关能力报告为 `DEGRADED`，不得整体崩溃。
6. 故意制造 cycle、重复 state owner、feature→feature implementation import，测试必须失败。
7. 生成 `artifacts/platform-foundation/phase-01/architecture-snapshot.json`，记录 manifest 数量、edge 数量、kernel/feature 列表、state ownership、ratchet baseline。

## 7. 回滚规则

- Phase 01 失败：直接回到 `4b623b9`。
- 不允许通过删除失败测试或扩大 allowlist 来“修复”架构违规。
- 若 manifest 层导致运行时逻辑复杂化，宁可保留为离线验证器，也不得牺牲现有 explicit wiring。

## 8. 完成定义

本阶段不是“平台化完成”，而是完成一层不会主动接管业务逻辑的架构控制面。完成后，未来任何新增大能力都必须先拥有 manifest、明确 owner 和可计算依赖，再进入后续实现。
