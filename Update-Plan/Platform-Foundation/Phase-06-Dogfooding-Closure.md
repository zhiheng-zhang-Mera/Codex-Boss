# Phase 06 — Dogfooding Closure / 真实工作负载闭环工程书

> **RECONSTRUCTED BOOK — NOT AN ORIGINAL.**
>
> This phase book did **not** exist in the repository. `Update-Plan/Platform-Foundation/` contained
> Phase 01–05 only, and a repository-wide search found no reference to "Phase 06" anywhere in tracked
> files.
>
> It is **recovered**, not invented, from three sources that do exist:
>
> 1. **The Foundation plan's own completion definition** — `Phase-05-…-Soak.md` §7: *"完成后，Boss Platform
>    Foundation 才算结束… 下一阶段才能安全进入 Quant-ultra 等真实项目 dogfooding，并用实际工作负载继续发现
>    平台问题，而不是继续凭想象扩张基础设施。"* The Foundation's stated exit is dogfooding on real
>    workloads, with the explicit instruction that the platform stops expanding on imagination.
> 2. **The Phase 05 施工任务 (scope) boundary** — §4: *"不接管 Quant/Health 等新项目作为本阶段交付物；它们属于之后
>    dogfooding。"* The phase that was deliberately deferred is this one.
> 3. **The evidence the five completed phases actually left behind** — every task below traces to a
>    named, located gap in `docs/9-16-platform-foundation-phase-05-status.md` §11, or to a defect this
>    reconstruction located in the code and verified before recording.
>
> **Provenance rule.** No task in this book introduces a capability the plan did not already call for.
> Where a task closes a gap, the gap is cited by file and line. Where this book is silent, that is
> deliberate: it is not a place to add scope. Anything found during construction that is out of scope
> goes to `docs/platform-foundation-known-issues.md`, not into this book.

> **前置分支：** `platform-foundation/05-scale-verification-soak`
>
> **本阶段分支：** `platform-foundation/06-dogfooding-closure`
>
> **BASE_SHA：** `14fd222aba782f97ec40662b04fc19f391f2653d` (Phase 05 certified FINAL_HEAD)
>
> **阶段原则：** 本阶段不再证明平台“能跑”，而是**用真实工作负载逼出平台缺陷并关闭它们**。Foundation 已在
> Phase 05 认证完成；Phase 06 的产出不是新基础设施，而是：平台被真实工作使用过之后，哪些结论仍然站得住、
> 哪些被发现是假的、以及被发现的假结论是修好了还是被明确记入债务。

## 1. 目标

把已认证的 Foundation 投入使用：让 Boss 自己的工程闭环在真实工作负载上运行，收集由此暴露的平台缺陷，
修复可自动修复的部分，把不能在本阶段关闭的部分写入 durable known-issues log，并在阶段末确认 Phase 01–05
的全部已认证 contract 在真实使用后仍未回归。

## 2. 绝对约束

- **不得扩张基础设施。** Phase 05 §4 已明确：不以“未来可能需要”为理由新增未被 benchmark 证明的抽象层。
  本阶段任何新增抽象都必须由一次真实运行暴露的缺陷来解释。
- **不得重新打开 Phase 05。** Phase 05 已 PASS。其结论是 inherited contract（见 §6），不是待办。
- **不得伪造证据。** dogfooding 的结论必须来自真实运行；失败要记录为失败。禁止用 fixture 替代真实验收，
  禁止把一次未运行的检查写成通过。
- **不得降低 mandatory verification。** Phase 05 的 `MANDATORY_GATE_STAGES` 边界（`intake`/`verify`/`finalize`
  是平台 invariant，不参与 Agent economics）在本阶段不得被放宽，也不得为了让某个 stage “通过” economics
  而把 mandatory gate 改成 optional。
- **不得把已知缺陷静默豁免。** 关闭不了的问题必须进入 known-issues log 并保持可见；禁止通过扩大 selector
  exemption、跳过测试或放宽 acceptance 让问题从报告里消失。
- **不得修改 `main`，不得进入 Phase 07。**

## 3. 施工任务

### Task A — State-ownership closure: 消除重复的 durable-state 构造点

Phase 01 的 `state-ownership` contract 要求每个 durable namespace 有唯一 authoritative owner。Phase 05
结束时仍存在同一 namespace 在多处各自构造的情况，这使 ownership 报告与运行行为可能不一致。

已定位（本工程书撰写前逐一在代码中确认）：

| 文件/状态 | 构造点 | 问题 |
| --- | --- | --- |
| `engineering-loop.json` | `electron/commander/main-commander.ts:775`、`:776`、`:871`；`electron/self-evolution/self-evolution-coordinator.ts:434` | 同一逻辑状态最多三处构造，其中 `:775`/`:776` 在同一函数内对同一路径构造两个 store |
| `secret-vault.json` | `electron/github/bootstrap.ts:39`（标签 `machine-identity`）、`electron/github/github-machine-runtime.ts:47` | 同一文件两处构造，vault 标签来源不一致 |

要求：

- 每个 namespace 收敛到一个解析点（一个函数/一个 owner），调用方从它取，而不是各自 `path.join`；
- ownership 报告读取的 owner 必须就是运行时实际构造它的那一处；
- 收敛后必须证明行为不变：现有 Phase 02/03/05 相关测试仍通过，且 ownership 报告仍 0 duplicate；
- 若某处构造确属不同 namespace（例如不同 root），必须**证明**其不同并写入注释与报告，不得为了“看起来
  干净”而错误合并。

### Task B — Failure-surface correctness: 让内部状态真的被读到

平台的可诊断性依赖内部状态被正确读取。本工程书撰写前已确认两个真实缺陷：

**B1 — `interventions.json` 读写键不一致（已确认）。** `electron/commander/human-guidance-gate.ts:14-17`
定义 `InterventionFile { schemaVersion: 1; interventions: HumanInterventionRequest[] }`，并在 `:78` 以
`interventions` 写入；`electron/host/host-observer-collector.ts:441-446` 读取同一文件时按 `{ items?: [...] }`
解析，且期望字段名为 `question`。结果：**未解决的人工干预永远不会被观测面收集到**，因为读取端永远拿到空
数组，而 `try/catch` 让这件事完全静默。这是“缺陷假装成没有缺陷”。

要求：

- 写入端与读取端的键与字段必须一致，且由同一个类型/常量约束，而不是两处手写字符串；
- 必须有一个测试**双向**证明：写入一条未解决干预后，观测面确实收集到它；写入一条已解决干预后，观测面
  确实不收集它；
- 读取失败不得再静默返回空：无法解析必须与“没有干预”区分开，并按平台既有的 degradation 方式上报。

**B2 — `BudgetManager.eligible()` 是查询却产生副作用（已确认）。** `electron/commander/budget-manager.ts:52-56`
在 `eligible()` 内调用 `this.update(...)`，而 `update()` 在 `:42` 会 `writeJson` 落盘。`eligible()` 是被
scheduler/supervisor 高频调用的**谓词**，于是每次调用都可能触发一次磁盘写入，且写失败会从谓词里抛出。

要求：

- 谓词的到期判定与持久化副作用分离；判定保持纯粹（可重复调用、无 I/O、不抛 I/O 错误）；
- `resetAt` 到期后的状态转换必须仍然发生，且仍然持久化——修复的是“在谓词里写盘”，不是“不再写盘”；
- 需要一个测试证明：反复调用谓词不产生额外写入，且到期后的状态确实被修正。

### Task C — Evidence-gap closure: `experience` 与 `remote` 的 authoritative suite

Phase 05 §11 记录：`electron/experience/`、`src/shared/experience.ts` 与 `remote-relay.ts` 被列为
capability 的 owned 文件，但**没有任何 authoritative suite**；`remote-relay.ts` 仅被
`tests/unit/process-gateway.test.ts` 按 import 边界提及，不检查行为。

要求：

- 为两个 capability 各建立 authoritative suite，测其**契约与行为**，不是重复 import 边界；
- 不得把相邻测试改名充数；suite 必须与 capability 声明的 invariant 对齐；
- 完成后 `test-impact` 报告里这两个 capability 必须有 authoritative obligation，且在 catalogue 中可见；
- 如果某 capability 的契约在实现中并不存在（即无法写出有意义的 authoritative suite），必须把它作为
  **architecture issue** 记录，而不是写一个空洞的测试让它看起来被覆盖。

### Task D — Dogfooding harness: 让真实工作负载可在隔离环境中重复运行

Phase 05 指出 Foundation 的出口是真实工作负载。本仓库内可被真实 dogfood 的“真实项目”是 Codex-Boss 自身
checkout：它有真实构建、真实测试、真实失败模式，且 `runAutonomousEngineering` / `runImplementationLoop`
本来就是生产路径。

要求：

- 提供一个可重复的入口，让 Boss 自己的工程闭环针对一个**隔离的**真实 workspace 运行一次真实任务，
  并落盘结构化证据（输入、stage trace、成本、验收结果、失败原因）；
- 必须有隔离保证：dogfood 运行不得污染被 dogfood 的 checkout，不得改动 `main`；
- 必须真实执行其验收检查，不得只写一个“已运行”的记录；
- 运行暴露的每一个平台缺陷必须被分类：本阶段修复，或写入 known-issues log（附复现证据）。

### Task E — Inherited regression under real use

Phase 06 每个重要里程碑与最终 head 至少确认：

- Phase 05 certificate/contracts 未回归；
- mandatory verification 仍不可被 optional economics 移除；
- real provider usage provenance 未退化；
- durable executed-stage trace 未退化成 inference-only；
- economics fail-closed 性质保持；
- provider model declaration single-source 保持；
- security scan / typecheck / 相关 unit 与 integration / architecture ratchet。

最终验收运行完整 inherited regression（exact head）。

## 4. 明确不做

- **不新增业务大功能。**
- **不接管 Quant/Health 等外部项目。** 它们需要不在本仓库内的输入与凭证；本阶段的 dogfooding 对象是本仓库
  自身，这与 Phase 05 §4 把外部项目留给“之后 dogfooding”并不矛盾——本阶段建立的是 dogfooding 这个**能力**，
  而不是那些项目本身。
- **不引入分布式基础设施。** 单机 SQLite/本地控制面足够则禁止 Kafka/Kubernetes 等。
- **不为了让指标好看而删除或弱化既有测试与安全约束。**
- **不在本阶段解决全部 known issues。** 关闭不了的必须留在 log 里可见，而不是从范围里消失。

## 5. 验收门槛

1. Phase 01–05 全部门槛继续通过（exact head 重跑）。
2. Task A：每个 durable namespace 的构造点收敛到唯一 owner；ownership 报告 0 duplicate，且运行时构造点与
   报告一致；收敛未改变行为。
3. Task B1：`interventions.json` 的读写契约一致，并有双向测试证明“未解决被收集 / 已解决不被收集”。
4. Task B2：预算谓词无持久化副作用，到期转换仍然发生并持久化，有测试证明两者。
5. Task C：`experience` 与 `remote` 各有 authoritative suite，且 `test-impact` 报告认可；或在 known-issues log
   中以 architecture issue 形式记录并保持可见——两者必有其一，不允许静默。
6. Task D：dogfooding 入口在隔离真实 workspace 上真实运行一次并落盘结构化证据；其暴露的缺陷全部有归属
   （已修 或 已记入 log）。
7. Task E：inherited regression 全绿；Phase 05 certificate 的 COMPLETE/PARTIAL 仍由真实 section 状态推导。
8. 输出 `artifacts/platform-foundation/phase-06/` 下的阶段证据（dogfood 证据 + 阶段状态报告 + 继承回归记录）。
9. known-issues log 存在，字段完整，且每条 `last reviewed SHA` 指向真实 commit。

## 6. Inherited contracts（Phase 05 封存，Phase 06 不得破坏）

以下为 Phase 05 认证结论，视为 inherited platform contracts：

1. mandatory platform gate 与 optional Agent stage 分离；
2. `verify` 是 mandatory contract gate，不参与 Agent economics；
3. optional Agent stage 受 economics guard 管理；
4. `executedStages` 是新 ledger 的 authoritative stage provenance；
5. pre-trace ledger 才允许 inference fallback；
6. real-provider economics provenance 不得用 fixtures 替代；
7. provider token usage 与 heuristic token estimate 必须分离；
8. task-grain 与 stage-grain measurement 必须分离；
9. `COST_ONLY` 是合法完成 verdict；
10. mandatory gate 不得被 economics adjudicate 掉；
11. platform certificate 的 COMPLETE/PARTIAL 必须从真实 section 状态推导，不得硬编码。

**冲突处理规则：** 若 Phase 06 的任何改动与上述 contract 冲突，**优先保持已认证 contract**，并把冲突作为
architecture issue 记录与上报，而不是静默改写 Phase 05 结论。

## 7. 回滚规则

- 失败回到 Phase 05 FINAL_HEAD `14fd222`。
- Task A 的任何收敛只要有一条 Phase 02/03/05 测试因此失败，立即回退该收敛，而不是放宽测试。
- Task B 的修复若使观测面从“漏报”变成“误报”，优先 fail closed 并记录，不得为了报告干净而重新静默。
- Task D 的 dogfooding 若污染了被 dogfood 的 checkout，该运行结论作废，必须修复隔离后重跑；不得手工清理后
  当作通过。
- 任何 inherited contract 被本阶段破坏时，本阶段判 FAIL，而不是把 Phase 05 的结论改成与新行为一致。

## 8. 完成定义

Phase 06 完成时，平台不仅被认证过，而且**被真实使用过**：dogfooding 暴露的缺陷有了归属，重复的状态构造点
收敛到唯一 owner，内部状态确实被诊断面读到，Phase 05 留下的证据缺口被关闭或被明确记录，并且 Phase 01–05 的
全部已认证 contract 在真实使用之后仍然成立。只有到这一步，Foundation 才真正从“被证明”变成“被依赖”。
