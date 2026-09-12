# Codex Boss — 开发日志（Update Log）

> 记录区间：2026-09-01（项目创建）→ 2026-09-09（Owner-Result Rev.2 施工轮 R1–R12 + 续篇 R31–R41，均合入 main）
> 依据：git 全仓库提交史（`git log --all --no-merges`），按提交日期逐日汇总（截至 2026-09-09 共 292+ 条提交）。
> 主开发线按 `main → 9-3 → 9-4 → 9-5 → 9-6 → 9-7(9-7-milestone) → 9-8 → 9-8-overcomplete → owner-result(Rev.2)` 顺序推进；2026-09-09 已按序合并入 `main`（此后随 `owner-result` 分支施工，每轮里程碑合并回 `main`，日期分支保留于云端）。

| 日期 | 提交数 | 阶段主题 |
|---|---|---|
| 2026-09-01 | 7 | 项目创建 / 桌面基础 / 可见网页 AI 分屏 |
| 2026-09-02 | 1 | 原子化多 AI 派发工作流 |
| 2026-09-03 | 4 | Chat/Work 通道 / 会话历史 / 下载归档 / 微信 QQ 远程中继 |
| 2026-09-04 | 11 | 持久化审查门禁 / 执行恢复 / 工程图执行 / 工程提案 |
| 2026-09-05 | 39 | v1.0 硬化发布 / AP01–AP30 架构能力批量落地 |
| 2026-09-06 | 110 | AP 收尾 / 研究管线全链 / 9-7 Phases A–L / milestone live E2E |
| 2026-09-07 | 20 | 9-7 milestone 基线 / U0 审计 / U1–U3 统一收口启动 |
| 2026-09-08 | 47 | U4–U10 面板与收口 / CDP 真机验证 / DOM 真机接线 / 应用内收敛 / 9-8 同步 |
| 2026-09-09 | 58+20 | live 真机验收 / tectonic READY / DETACHED 布局收口 / 全部 9-x 并入 main / **Owner-Result Rev.2 施工轮 R1–R12 + 续篇 R31–R41（owner-result 分支）** |

---

## 2026-09-09（Owner-Result Rev.2 施工轮 R1–R12，分支 `owner-result`）

按 `Update-Plan/Owner-Result.md`（Rev.2，§0–§46）以 Owner-Result 模式自主施工 12 轮并两次合入 `main`。确定性验收门（每轮）：typecheck + vitest + full build PASS，证据 JSON 落 `Update-Plan/owner-result/evidence/round-N/`。要点：

- **R1 P0-1…P0-5 契约**：`owner-result.ts`（ASSISTED/AUTONOMOUS/OWNER_RESULT、HB1–HB4、问题拦截、方向停滞梯）、`autonomy-supervisor.ts`（生命周期/heartbeat/stall/recovery ladder/straggler/replacement）、`result-validator.ts`（MODEL_DONE≠COMPLETED）、`decision-ledger.ts(+store)`；48 新测试。
- **R2 runMode 持久化 seam**：`BossTask.runMode` + `store.setRunMode` + createTask 默认解析（work/council→OWNER_RESULT）。
- **R3 DS-Hns autonomy 模块**（`owner-result-autonomy` @ 8e24b7d）：progress-observer/stall-detector/episode-supervisor/continuation-controller/question-interceptor/result-validator/decision-ledger + scheduler 受控 headless 停滞监督；修复 installer-contract §42 契约（92/92 PASS）。
- **R4/R8 P0-6 Computer-Use**：`computer-recovery.ts`（§24–§29 修复计划 + 权限/事后条件）与 `provider-page-repair.ts`（DOM 层执行器，§25 无盲操作）。
- **R5/R9 P2 §37/§44 Owner Dashboard**：读模型 + `boss:owner-dashboard` bridge + OwnerSummary UI（Electron UI 冒烟 PASS）。
- **R6/R7 P1-5/P1-6**：ExecutionSupervisor 故障注入套件（auth/timeout/quota/malformed）+ Long Soak mini（§36 不变量）。
- **R10 P1-3 §32 Self-Healing Battery**（10 场景目录 + §35 停滞检测）；**R12 P1-4 §33/§34 Research 5 域电池**（正确拒绝=PASS、假 READY=FAIL）。
- **R11 发布门**：受控 Electron 重启 acceptance PASS；`FINAL-ACCEPTANCE.md`（§41/§42/§44 矩阵）。
- **R13–R16 发布/准备**：GitHub CI 全绿（runs 73/75/76/77 success）、portable 打包 + PACKAGED_SMOKE_PASS、README Rev.2 状态、`LIVE-ROUND-PLAN.md`。
- **R17–R24 Qwen live 实证链**：send live-PASS ×N + 页面级回复；登录（HB1，经 Operator 配合）；采集诊断定案（`.qwen-markdown` 完成态可用；27.5 分钟终态 FORMAT_INVALID 诚实、无无限等待）。
- **R25 P0-7 → P1-1 Qwen Graduation ✅LIVE**：修复 `provider-automation` send.enter（Enter 后校验 prompt 可见；不可见 → DOM 级 Enter 有界重试）；干净会话全链路 `completed / SUCCESS / finalPreview QWEN-OK / evidenceDecision PASS`。
- 测试规模：overcomplete 收口 34 文件/176 → **41 文件/216 测试 PASS**；Owner 技术决策次数 = 0、盲等 = 0。

### 续篇 R26–R36（owner-result，2026-09-09 同日）

§44 closeout（R30：36/36 轮 fresh-clone 全链 soak ≈106 min + DS-Hns 92/92）后按 `Update-Plan/9-9-owner.md` 持续推进的运行时接线与验收轮（`Update-Plan/owner-result/evidence/round-{31..36}/`）：

- **R31 §20–§22 Verification Contract seam v1（默认 OFF，additive）**：`BossTask.verification` +
  durable 证据/裁决；runPlan 完成点 fail-closed 验证门（缺门 ⇒ REWORK parked waiting，绝不假完成）；
  TaskFinalizer verificationGate 兜底一切 finalize 入口。测试：真实 MainCommander+ledger 集成 + 对照组。
- **R32 §18 research WAITING_FOR_USER raise 前拦截**：`research-wait-policy.ts`（AUTOPILOT⇒OWNER_RESULT /
  GUIDED⇒ASSISTED）+ supervisor `requestGuidance`（DECIDABLE 自动决策入 durable research ledger、不空停；
  HB 才上浮）。真实 ResearchLedger 集成测试。
- **R33 §18 任务级能力路由拦截（Chat→WORK）**：`workEscalationVerdict`（OWNER_RESULT ⇒ 先入 §38 台账再
  AUTO_APPROVE 并直接执行；ASSISTED/AUTONOMOUS/HB 文本 ⇒ 保留人工门）。Owner Dashboard 台账计数随之上真。
- **R34 §38 Scenario G / §39 多故障隔离 battery**：真实 ExecutionSupervisor + CircuitBreaker + TaskLedger
  三 provider 并行 —— 健康完成、故障方诚实停放、breaker 隔离 + 新任务重路由，Boss 存活。
- **R35 §38 Scenario D research 部分失败 battery**：EXPERIMENT_GENERATION fail-closed ⇒ FAILED 但
  RP/literature/method/协议决策与证据全部保留、跨 reopen 可读。
- **R36 P0-6 guarded R6 slot（WebRecovery）**：RETRY_UNSENT 恢复梯接 §26/§28 Computer-Use 修复位
  （`classifyRepairNeed` 先行；REPAIRED/SKIP ⇒ 原重发；NEEDS_HUMAN/FAILED ⇒ 诚实暂停；无 hook/非 CU ⇒ 旧路径
  逐字节不变）；`FINAL-ACCEPTANCE.md` 矩阵刷新至 R36。
- 测试规模：**47 文件 / 241 测试 PASS**（typecheck + full build 每轮全绿）；每轮证据 JSON +
  PROGRESS.md 追加；owner-result 与 main 同步推送（现 @ 2026-09-09 R36）。

### 续篇 R37–R41（owner-result，2026-09-09 同日）

- **R37 P2 收尾（文档）**：README Status → 47/241；Update-Log 记录区间/汇总表更新；CLOSEOUT-44 追加续篇段。
- **R38 §33/§39 恢复续跑 battery**：真实 supervisor+ledger+RecoveryScheduler —— 技术失败 ⇒ 有界 recovery，
  同一 job（相同 fingerprint）恢复后续跑 COMPLETED（非从零重启）；恒定失败 ⇒ 有界 attempts 耗尽 PAUSED、
  绝不 COMPLETED。
- **R39 §0.4/§11/§29 DegradedController battery**：FULL/REDUCED/LIGHTWEIGHT/DETERMINISTIC/PAUSED 分级状态机
  + worker/context 预算 + policy（幂等、LOW 仍 eligible）。
- **R40 §17/§38 自迭代隔离 battery**：真实 runEngineeringGoal —— ABORTED 候选（先改坏再报错）⇒ 工作树
  完全回滚（changedFiles=[]、git 干净）；CONVERGED 保留改动。
- **R41 HumanGuidanceGate durable battery**：raise 持久化跨 reopen / 每 task+kind 单一 active / resolve
  append / 损坏存储 fail-closed。
- 测试规模：**51 文件 / 254 测试 PASS**（typecheck + full build 每轮全绿）；每轮证据 JSON + PROGRESS.md
  追加；owner-result 与 main 同步（现 @ 2026-09-09 R41，commit a164f8e）。

---

## 2026-09-01（项目创建日）

首个可用开发骨架与桌面主控雏形落地（`main` 线）。

- `e7c0da6` 可用的开发启动骨架；`7614789` README 排版。
- `e89c452` Codex Boss 桌面基础：Electron 主窗口、本地控制器页面、渲染器桥接。
- `9df6498` 修复黑屏，并把网页 AI 以分屏 WebContentsView 嵌入主窗口（可见、可独立登录）。
- `f4142f2` 扩展 Provider 目录与自定义网页 AI 支持（地址/名称可配）。
- `1fd9d74` 可见适配器与 Council 工作流（提案→评审→综合的基本多 AI 会话）。
- `86e103a` Phase 4 证据校验：任务产出进入可验证的证据化流程。

## 2026-09-02

- `9f4fb7c` 原子化多 AI 派发工作流：一次任务同步派发到所选多个网页 AI，避免并发写竞态。

## 2026-09-03（9-3 线启动）

- `5e3cb70` Chat 与 Work 两种 Provider 传输通道（网页通道 vs 本地通道语义分离）。
- `062a1ca` 本地会话历史工作区（文件夹/会话持久化）。
- `e3409b8` Provider 下载文件按会话历史归档（可回查）。
- `76cef5e` 本地微信与 QQ 指令中继（桌面客户端消息桥接，人工确认入队）。

## 2026-09-04（9-3-remote → v1 执行内核）

- `ee79196` 阶段性检查点提交（Commander 与 web runtime 变更）。
- `24b120b` 普通回答经持久化审查门禁放行（非直接输出，可复查）。
- `45b20ef` 执行恢复持久化 + 轻量任务意图编译（L0–L3 分级雏形）。
- `f0e6d76` 工程执行图验证与受控修复范围（文件作用域约束）。
- `86a2665` 语义化交互优先 + 执行控制面外露。
- `2c3ed78` 自动延续（auto-continuation）集成 + 可验证 runtime 预览打包。
- `941d4c9` 修复干净 CI 上显式安装 Electron 二进制。
- `3c308b3` 修复直接交付与历史对话框可用性。
- `c229e99` 派发期限持久化 + 原 Provider 会话恢复。
- `7a2dfb8` 可持久化的 Commander 任务计划执行（作用域化并发 worker）。
- `a31728e` 作用域化工程提案执行：校验 + 修复 + 工作区隔离。

## 2026-09-05（9-4/9-5：v1.0 发布 + AP 架构能力批量落地）

- `f7fdfbd` 语义化桌面执行（native → DOM → UIA → structured → vision 链）与持久恢复。
- `4219487` v1.0 hardening 收尾；`5792e0a` 稳定 Windows 发布验证（9-4 tip，CI 全绿）。
- 下午集中批量落地 AP 系列（9-5 架构冲刺，约 30 提交）：
  - 可靠性：`885c905` Circuit Breaker 隔离坏 Provider；`315f79b` 命名 Provider 生命周期 WAITING/PAUSED_PROVIDER。
  - 兼容与配置：`b426c01` 通用 schema 迁移框架；`237c3fd` 运行时适配器兼容版本契约；`d3c9f81` 可解释配置分层。
  - 制品/证据：`4f0f7b0` 制品 schema 一致性 + 内容哈希 fail-closed 校验；`95fd7aa` 计划/本地失败自动写可复现快照。
  - 会话与开发平面：`aa9a97c` 会话生命周期类型 + 工作区绑定；`f62ab66` repo 检查器/测试地图/指纹；`f49277a` 语义代码切片 + 依赖感知定向测试。
  - 事件与遥测：`d865ec6` 类型化领域事件总线 + 事件驱动恢复；`9f1e37f` 评估套件核心（golden + 基线库）；`f90f688` 遥测性能库；`3c7d77f` 检查点留存预算剪枝。
  - 知识/缓存：`3eec564` 本地知识核心（预算化检索）；`03d3263` 内容寻址缓存 + 缓存化 repo 扫描；`27bf16e` 软件会话租约注册表。
  - 工作区/权限/安全：`3896025` 权限清单代数 + 每工作区存储；`8ab1799` 一等 Workspace 模型（registry/resolver/任务绑定）；`824a2d3` workspace 持久根布局 + 多 repo schema；`e5a8414`/`1a4b9f9` AP28 Guardian 边界 + 硬件级 Secret Vault。
  - 上下文与规划：`e7c39d6` C0/C1 上下文胶囊编译 + 指纹；`2ae27b1` 最廉价充分执行成本模型；`f40c006` 资源模型（物理背压）；`b994fb9` Microtask DAG 分解模型（read→propose→verify）；`ba4d26e` 工作区项目状态/决策/研究账本。
  - 自省与策略：`eb8d564` 经验分层（任务→工作区→域→全局）；`cfdffbc` 自省代码知识图谱；`26791d7` 自诊断失败聚类 + RFC 草稿；`b968b0c` 统一策略优化器接口；`d3a9a8d` AP29b 策略接入降级选择；`1897dd4` AP18b 秘密扫描器 + 日志消毒 + 污点标记；`e95c6f2` AP26b 人工纠正摄入。
- 晚些补演示文档：`83663da` 可见桌面 demo、`2763e10` 端到端多 Provider 研究 demo。

## 2026-09-06（长冲刺日：AP 收尾 + 研究管线全链 + 9-7 Phases A–L + milestone live）

凌晨（00:19–01:00，9-6 线 AP 收尾）：
- `c9dad41` AP24 感知-行动循环（关键帧保留）；`aa68a1b` AP27 自修改沙箱 + Dual BOSS 管线。
- `500078e` AP06 capability 图接入计划编译与路由；`78d4356` AP09 C2 胶囊 + 必需上下文解析；`43012b1` AP10 域路由 + 确定性重排。
- `33b5174` AP16 worker 贡献指标接入经验观察；`7f34b35` AP12 递归 Microtask runtime 接入步骤执行；`fc0a0af` AP13 自动化/council 延续 waker。
- `7f65aa8` AP15 任务完成写入项目状态 + goal-tree UI；`1e9591e` AP17 state.json 数组生命周期 + L0–L4 TTL 预算；`96c0dcb` AP04 符号索引 + 自动交接 writer。
- `3a1c904` AP30 全系统硬化矩阵；`c197125` AP20 混合存储层级 + 知识治理激活；`e410d25` AP21 通用软件运行时 + Adapter SDK；`4b25c8c` AP22 Blender + AP23 Unreal 结构化适配器（无则优雅降级）。

研究管线（01:08–05:07，research 分支大量 rounds）：
- 历史管理：`52955b5`/`db4ea79`/`32743f5` 归档/删除/复制/导出 IPC + UI、3-AI 横排 + 自动缩放。
- 进度/门禁：`422eb0d` 实时进度模型；`46233ec` autopilot 人工引导门禁 IPC。
- IR/账本：`2911379` ResearchIR + 持久账本 + autopilot supervisor；`246e69e`/`155bb80` 协议冻结与修订守卫。
- 证据与统计：`686e70e` 确定性统计 + 证据图核心；`4db9cc1` 可证伪 RQ 选择 + evidence-over-vote；`fb22003` 引文验证阶梯 + source store。
- 手稿管线：`2fda57c` manuscript 管线核心（sections + 证据检查 + 输出树）；`c834c0b` research 服务门面 + Level-B 确定性管线。
- 控制流：`91e21b5` 研究模式 IPC + Chat/Work/Research 导航；`8099286` supervisor IPC + Level-B 执行器；`dfe49d4` research-wait → 人工介入卡；`6061efe` runs list/resume；`d84d849` 恢复；`832fad4` reviewer-gate 诚实停顿；`8a6230a` resume IPC + GUI 控制。
- 真实验证 rounds 10–33：协议绑定 provenance、stats + 证据裁定、复现审计、claim←证据图、引文审计、离线 artifact-tree E2E、图表嵌入 md/tex、配对置换检验、冻结协议快照、Level-A 计划、reviewer gate、句子←claim←figure 可追溯链、接受度审计脚本等。
- 文档/验收：`9ce8252` live Final Acceptance runbook（A–J）；`58b5074` bridge/IPC 控制面参考。

9-7 Phases A–L（11:08–11:46）：
- `6779e51` Phase A 统一 TaskInput/InputObject；`3504e55` Phase B 附件存储 + 上传 UI；`8895ff8` Phase C Provider 能力注册表 + 附件路由。
- `5e7fb36` Phase D 网页 AI 文件上传（DOM 附件校验 fail-closed）；`c513442` Phase E Chat→Work 一次性确认升级。
- `06f05fa` Phase F GitHub URL resolver + repo materialization；`cfb948e` Phase G 上下文优化（manifest/dedup/budget/稳定前缀）。
- `2ee0135` Phase H DeepSeek V4 模型策略 + 缓存友好信封；`faee6bf` Phase I DSH preset 策略；`6c773b6` Phases J/K/L live research executor + autopilot + LaTeX 编译。

Milestone（20:18–23:56，9-7-milestone 线）：
- `6f751ce` 基线审计 + 失败验收 E2E；`282d6c1` ResearchService 单一组合根；`7636f96` 持久 typed 阶段制品。
- `eba9f3e` 阶段门禁 fail-closed + research conductor（真实实验/统计/复现/引文/手稿/LaTeX）；`9b18215` role dispatcher + WAITING_FOR_PROVIDER 自动恢复 + READY 门禁。
- `ba53355` 文献检索闭环核心；`2b80633` §1 human input + provider-call 预算；`6aaabdf` GUI start-once + web-provider role pool。
- 真机联调：`9c49e11` paper.tex 只嵌引擎可读图（SVG 留在 paper.md）；`a2e3946` 真实引擎 E2E（MiKTeX pdflatex → paper.pdf PASS）；`962dc1a` 宽容 JSON 提取 + 顺序 fallback；`aff9062` reviewer-vote claim id 归一化。
- `52edc5a` provider 退避重试 + fresh conversation + 失败降权 + headless 验收 CLI（23:29）。

## 2026-09-07（9-7 milestone 基线 + U0–U3 统一收口启动）

- 00:00–00:26 milestone live 收尾：`ff49435` run 实现经 ELECTRON_RUN_AS_NODE 执行；`ec967c7` busy 拒答兜底（8 次/20s 退避）；`e74c493` host 冻结协议核心（探测 metric、baseline 0.5、mean>baseline）+ evidence-alone 采纳；`6a25bda` ask-count 期望测试；`5328b14` **E2E-C live acceptance DONE**（READY、pdflatex paper.pdf、10/10 checks）。

- 03:00–05:00 补强：`7642b1b` 研究域长度 manuscript writer（真实数字/复现/limitations）+ 导出 `Research/<Topic>`；`d3a0b89` research UI 自适应宽度 + 协议预设 + 历史多选批量删除；`83be891`/`6435e2f` 无时间戳命名 + 导出清理（latex 副产品与 scratch）。
- `da5a20d` **9-7 milestone 基线**：0-touch human-RQ 研究、ResearchService 组合根、live conductor、fail-closed READY 门禁、E2E-C live 验收（tests/live fixtures 按策略不入库）。
- 23:26 起 U0–U3 统一收口：`4b01fc1` U0/U1 功能完备性审计产物 + P0 API 附件 fail-closed + P1 幂等项目状态记录；`085f77c` 深拷贝、§13 删除守卫（主进程确认 + 不自动剪枝）、删除死 runtime 桩。
- `c8aac22` 证据决策由 claim/dispute 派生（§2.3）；`9cd02b4` api:* 与 local:native 上 runtime 控制面；`b1a6261` CODEX_REQUIRED 终稿自动重试（有界、无需用户点击）。
- `8892297` 网页 runtime 健康随账户探测而非窗口开关；`6be60b8` manuscript 绑定全量统计而非复现前快照。
- U3：`190daf2` Work-mode 1|3|5 抽象 + 角色分配引擎 + role-briefed council；`b38113c` 任务持久 Work 池配置；`d6e8d9b` 工程 worker 上限 1–5 可配（§6.4/§35）。

## 2026-09-08（U4–U10 收口 / 面板 / 真机验证 / 收敛 / 9-8 同步）

- U3 收尾：`aba5494` evidence>vote 发布门禁——未决 claims 永不自动发布。
- U4 布局：`c99eb0e` §9.1 全高 1/3/5 分栏 + §9.2 每栏缩放/重载；`4be8035` 栏位 live 状态点（账户/可用性/busy 脉冲）；`7dd376a` MERGED/DETACHED 确定性几何；`2268a87` **DETACHED 双窗口模式在运行中应用 live 验证**。
- U5：`33ca489` API 密钥掩码显示（snapshot 只暴露 keyTail，永不完整密钥）。
- U6：`99b0d5f` 会话任务结束自动归档（从不自动删除）；`9091fda` 外部 web 会话归档账本（pending，从不假归档）；`493ed6b` WORK 新任务开 fresh conversation；`3b0e550` 外部归档自动化重试。
- U7：`cfea2e5` manuscript §18/§19 充分性与反过早完结门禁；`84dcd44` ResearchCapabilityRegistry（按需确定性能力计划）；`7b62849` 确定性结果表 + 定量视觉证据门禁。
- U8–U10：`0db171e` 自主工程循环（goal 契约/边界守卫/迭代机/收敛与停滞检测）；`b0476af` 真实 repo 操作 + runEngineeringGoal 门面（fail-closed editor）；`93c9c94` §38 git checkpoint/rollback；`2834ee3` 持久 goal 状态读模型；`08e8169` goal IPC（status + run start）。
- 审计环境（U11/audit）：`fd55af0` 真实环境 allowed 命令 + 宽时限；`dad5c11` vitest 60s 默认超时（套件同时跑在 live Electron 内）；`897a022` 嵌套 vitest 限 2 worker；`f25853e` 审计子进程 scratch 移至 OS temp。文档：`7d5738b`/`3aba0ad`/`3b68c94` U11 dogfood 收敛、close-out、145/721 全绿。
- CDP 真机验证（05:48–07:44）：`c8888c4` 建立 live GUI 验证通道（CDP 驱动用户实例 + goal IPC 实测）；`0304266`/`5204c0c`/`fd9103f`/`4f4832c` 真实 ChatGPT 任务端到端（派发→回答→artifact、证据门禁 PASS、WORK fresh vs CHAT 同会话对比、§14 账本 ARCHIVE_PENDING）。
- 桌面权限与 DOM tier：`8962d8b` 桌面 mutation 副作用权限门禁（§17/§18 fail-closed）；`88b82c6` 记录文档；`c6a4836` §8.2 DOM mutation/read tier（可见页面执行 click/enter/submit/read/verify）。
- 本轮统一收口（本会话交付）：`3dce5fc` DOM 真机 surface + microtask 入主线 + U10 目标面板 + U5 管理器面板 + 应用内审计对齐（详情见 `docs/9-7-dom-microtask-u10-u5-inapp.md`）；`30ee030` 只读 git 对象树删除硬化（`electron/fs-util.ts removeTree`，Electron 下 fs.rmSync 无法删除 git 只读对象文件的真实缺陷）；`b590b6f` 轮次记录；`444f406` 中间 docs 提交。
- 应用内收敛证据：goal `eng-251ec4b77388` 第 3 迭代 **CONVERGED**（0 findings，cleanRounds 1/1，changedFiles 0）；旧 goal 账本归档保留（`engineering-loop-eng-2b9bec037a7a.json`，4 迭代）。
- 9-8 分支：`03bbc64` 提交 GitHub 验证用测试子集（15 文件 / 70 tests，自包含确定性子集），本地全量套件（150 文件 / 752 tests）保持 gitignored；云端 `9-7` 与 `9-8` 均指向 `03bbc64`，CI 全绿（success）。

---

## 2026-09-08（overcomplete 分支实施，`9-8-overcomplete`）

> 依据 `Update-Plan/Overcomplete.md` 以“Overcomplete（125–140% 工程强度）”方式在 `9-8` 之上推进；同一日期内按 Round 归组，最终以 `<完成日期>-overcomplete` 推送。完整计划进度见 `Update-Plan/overcomplete/PROGRESS.md`，证据见同目录 `evidence/`。

### Round 1（P0 工程闭环主线）
- 基线冻结与证据目录：`8cd191b` 建立 `Update-Plan/overcomplete/{baseline.md,evidence/}`（取消 /tests/ 与 /Update-Plan/overcomplete/ 的 gitignore 例外）。
- `3492f1c` EngineeringGoal 接生产 coder/reviewer：新增 `electron/engineering/finding-scope.ts`（§6.1.2 自动作用域推断）、`live-engineering-operations.ts`（§6.1.1 bounded patch + 独立 review）、driver 将 review 置于 build/test 后并回流 reviewer finding（§6.2/6.3）；`runEngineeringGoal` 默认接 role-router worker（§6.4，IPC 暴露 workerRuntimes/disableCoder/disableReviewer）。
- `737f889` Microtask 泛化与并行：语义 kind 全集（§7.1）、read 并行 + write 重叠作用域门（§7.3/7.4）、job startedAt/completedAt（§7.5）。
- `f06c202`/`d172bb6`/`ad41d29` seeded-bug 自主修复验收 runner（§6.5/§17.6）：克隆→离线工具链→注入真实回归→audit/implement/build-test/review→收敛；**Bug A–D（编译/单元/逻辑/跨模块）全部 PASS**（证据 `evidence/engineering/seeded-*.json`）；确定性子套件分层入库（§17.1，取消 `/tests/` 忽略）。
- `fa4d58b` 外部归档生产接线（§11.3/11.4）：fail-closed live attempt + 任务完成调度 recovery 归档 + 手动 IPC。

### Round 2（Research 泛化 P1.1–P1.4）
- `1316785` 真 host 文献检索（§9.3–9.5）：OpenAlex/Crossref 检索 + 元数据校验 + passage 定位；LITERATURE_REVIEW 先 host 后 AI advisory（禁止 AI 自证引用 §3.7）。
- `b50e66e` baseline provenance（§9.8）：METRICS_META 声明优先；proportion→命名 random-chance；其余 fail-closed，废除固定 0.5。
- `1dda043` 实验生成 coder seam（§9.9）：冻结协议 spec → 生成实验 → dry-run metric contract fail-closed。
- `5630e14` 单样本 effect size + sign-permutation p 接入确定性统计（§9.12）。

### Round 3（Research 手稿/审稿 + UI 读模型）
- `5b76e50` manuscript 域无关 writer（§9.15）：abstract/intro/methods/discussion/conclusion 由真实 RQ/指标/CI/协议推导，删除硬编码 benchmark 叙事。
- `d8c41f7` paper reviewer council 真门禁（§9.16）：独立 fresh reviewer veto，缺失记录 not-attempted。
- `48188cb` 等待读模型（§12.3）：`nextActionLabel`/`waitingLine` 统一“原因 · 等待到 · 下一动作”展示。

### Round 4（测试分层 + 评估包）
- `546c797` 15 个根级测试全部迁入 `tests/unit/`（§17.2）；嵌套审计直接跑全量入库套件；迁移后 Bug A 重验 PASS。
- `dad2b56` human-ready blind evaluation pack（§10.4）：匿名 + seed 乱序 + 解码键 + 评分汇总。
- `57260d4` `pnpm run test:seeded`；`a35a95e` 进度文档。

### Round 5（验收/交付文档化）
- `Update-Plan/overcomplete/final-acceptance.md` 最终验收矩阵（DETERMINISTIC-PASS / LIVE-9-8 / NOT-RUN 口径，§27 限制诚实记录）；README 状态与能力条目更新；控制重启冒烟与全量 build 验证见分支收尾记录。

---

## 说明与口径

- 本日志依据 git 提交史撰写，按**提交（作者）日期**归日；同一天内按时间顺序排列主题。
- 部分阶段存在同名/并行提交（如研究 rounds、AP 系列、docs 快照），已合并为主题条目，未逐条展开全部提交。
- 分支约定：确定性测试随仓库提交于 `tests/unit/`（分层布局）；`9-8` 历史提交中的“150/752 本地全量 gitignored”口径自 overcomplete 分支起不再适用（同一套件已入库）。
- 后续每日更新：直接在对应日期追加小节；跨天则新增 `## YYYY-MM-DD` 小节并更新顶部汇总表。

### Live 验收（2026-09-08 夜—09，已登录 provider 实况）
- 基础设施：CDP 驱动运行实例（`scripts/live-cdp.cjs`）、自动化 journal（`runtime-data/.boss/live-automation.log`，纯程序离线诊断）。
- 适配器：DeepSeek `sendMode=enter`、Microsoft Copilot（`#userInput`）显式适配器、内置未覆盖 provider 的通用默认规则（mistral/perplexity/doubao）；Qwen 发送控件未解析（记录缺口）。
- 真机 PASS：1/3/4/5-AI 并行 Work echo（`5AI-OK <brand>`，artifact 全捕获、审查全过、final 合成）；Chat 延续（同会话 URL+上下文记忆）；3-AI Council（proposals→peer_review→synthesis COMPLETE）；Live Engineering Goal CONVERGED（真实 AI coder 修编译 bug，eng-4c193c1599d4）；Live Research 语义链（真实 AI hypothesis/复现/claim + paper reviewer council 真实否决）；外部归档 fail-closed pass。
- 韧性修复：取消即时释放 provider；busy 守卫只认活动任务；采集 monitor 10→25 分钟+超时强制采集；busy 顾问化（stability 采集）；composer 瞬态重导航重试；输入就绪有界等待。
- 证据索引：`Update-Plan/overcomplete/evidence/live/INDEX.md`。

### TeX 引擎与 live READY（2026-09-09）
- D:\tex 安装 tectonic 0.15.0；latex-compiler 支持 tectonic；manuscript prose LaTeX 转义。
- 离线确定性链 READY+paper.pdf（evidence/research/offline-chain-* PASS_READY）。
- Live Research READY+paper.pdf（evidence/live/live-research-ready-*）：真实 web AI 语义阶段，6 真实 run（seeds1-6），真实 reviewer council 通过（先诚实否决 n=2 功效与 0.5-vs-majority 设计），engine tectonic 编译 final audit 通过，成果导出 Research/<topic>/。
- conductor 默认 run 数 3+3。

### 弹窗让位 give-way + UTF-8 修复（2026-09-09）
- >3 个 web AI 打开时强制 DETACHED 第二窗口，主窗口真正“弹窗让位”：`.view-detached` 下 `.browser-half{display:none}`、`.chat-half` 扩展至 grid-column 2/-1（主交互区占满），主窗口 embedCount=0（旧页面不加载 AI 处理页）。
- 回落 <=3 → 自动回 MERGED，browser-half 恢复显示；开/关双向动态监测（onOpen hook + 5s monitor）实机验证 PASS。
- 修复 PowerShell Add-Content 引入的 GBK 字节岛：`src/renderer/styles.css`（曾阻断 vite 构建）与 `Update-Log.md`、`evidence/live/INDEX.md` 全部转严格 UTF-8。
- 实机证据：`evidence/live/live-layout-giveway-2026-09-09-10-03-11.json`（4 AI 开 → DETACHED + 让位；回落 ≤3 → MERGED 复原）。

### 弹窗时主交互窗口保持打开（2026-09-09）
- DETACHED 切换在 `ProviderViews.setWorkspaceView` 内保证主窗口不随弹窗关闭/隐藏：minimized→restore()、不可见→show()。实测：主窗口隐藏启动（visible=false），打开第 4 个 AI 触发弹窗时 host 自动 visible=false→true。
- window B 尺寸/位置按宿主显示器 workArea 收敛，绝不被推到屏外；新增只读 `window.boss.getWindowState()`（host/webWindow 的 visible/minimized/maximized/focused/bounds）。
- 实机证据 `evidence/live/live-window-host-open-2026-09-09-10-12-13.json`：DETACHED 下 host visible/minimized=false、主交互区（chat-half）全宽 2/-1、embedCount=0；回落 ≤3 回 MERGED 仍可见。126 tests + typecheck + full build PASS。

### 分支收口：推送 9-8-overcomplete 并按序合并全部 9-x 分支至 main（2026-09-09）
- 文档修复：上文 "Live 验收" 与 "TeX 引擎" 两小节为 PowerShell Add-Content 写入 GBK、再经不完全转码留下的乱码文本；本会话按 Git 历史中的原始字节（cp936/GB18030 解码）还原为严格 UTF-8 中文，并全文件扫描确认无乱码残留。
- UI 收口：`.execution-options`（审查策略 / 最终答复 / 工作区 选项行）设 `max-width: 700px; margin: 0 auto`，在发送区上方居中显示，窄窗口下与 composer 同宽对齐。
- 推送：`9-8-overcomplete` 连同上述文档与样式更新推送至云端（origin/9-8-overcomplete）。
- 主干合并：按主开发线顺序把 `9-3 → 9-4 → 9-5 → 9-6 → 9-7 → 9-8 → 9-8-overcomplete` 全部合并入 `main`（`9-3-remote` 内容已含于 `9-4` 祖先链，不单独合并）；合并后 `main` 树与 `9-8-overcomplete` 完全一致，成为收口主干。
- 推送 `main` 至云端；GitHub Actions（typecheck / tests / build / benchmark / portable / restart smoke）在 main 上触发。

---

## 2026-09-12（Prestart Checkpoint 1 收口 → Checkpoint 2 Knowledge Foundation，分支 `Prestart-checkpoint-2`）

依据 `Update-Plan/checkpoint-1.md`，本轮不新增业务功能，只按工程书顺序收口与补缺。

### Phase 0（§4）— Prestart Checkpoint 1 正式收口

- **§4.1 远端 CI 失败根因**：`tests/unit/evolution-sandbox.test.ts` 的 `beforeAll` 是真实的沙箱引导（用 `csc.exe` 编译宿主 launcher + 创建 AppContainer 配置 + Job Object 探针），却继承了 vitest 默认 10s `hookTimeout`。GitHub run `34669938246` 因此在任何攻击用例执行前就以 `Hook timed out in 10000ms` 中止。现在该 hook 带显式 180s 预算（与同文件 SB-04/SB-05 的单测预算一致），**没有 skip / retry / 删测试 / 改断言 / 降覆盖**。
- **§4.2 远端验证链**：`acceptance:workbook` 成为独立 CI 门禁（重跑 WB-01..WB-10 并校验其机器可读报告，任何降级为 NOT_RUN 都不得变绿）；`scripts/phase0-validation-chain.ps1` 本地依次真实执行 install → install:electron → typecheck → security:scan → build → test → acceptance:workbook → acceptance:github-machine → benchmark → package:portable → portable smoke → restart acceptance → desktop WorkBook smoke。
- **§4.3 桌面黑盒冒烟（新）**：`scripts/acceptance-desktop-workbook.cjs` 启动真实 Electron（独立 `--boss-data-dir` + `--remote-debugging-port`），**只**通过 CDP 驱动真实渲染层：点 Work → 填工作区 → 经 composer 自定义 AI 表单开通一个 provider → 用真实 `DragEvent(drop)` 拖入可执行工作书 → 点提交；随后从主进程写下的 `state.json` / `.boss/workbook-registry.json` / `.boss/knowledge-base.json` 独立取证（分类、已编译 Task Contract、intake 阶段梯、dispatch checkpoint 与回退原因、知识写入），因此 **UI → IPC → main process → WorkBook production path** 是被证明贯通的，而不是只调函数。provider 面板以 `--boss-offline-providers` 打开且从不导航，使用无适配器的自定义 provider，全程不触网、不向真实 AI 发送任何消息；live provider execution 诚实记为 `NOT_RUN`。
- **DoD**：本地链全绿（test 110 files / 1034 tests）+ 桌面冒烟 48/48 claims；云端 `Prestart-checkpoint-2` run `34671183374` **success**（含新增的 acceptance:workbook 与桌面黑盒门禁）。tag `prestart-checkpoint-1-complete` 已推送。

### Phase 1（§5）— Knowledge Foundation（CP2）

先做只读审计，结论记录在 `docs/checkpoint-2-knowledge-foundation.md`：仓内已有 **4 种互不兼容的知识记录类型**、5 种持久化 schema、3 个 store 类，且**没有一个能从 `electron/main.ts` 到达**（该文件此前完全不出现 `knowledge`；`ContextManager.setKnowledgeProvider` 零调用者），旧 `KnowledgeStore.put` 还会直接删掉被取代的记录。

- `src/shared/knowledge-object.ts`（纯）：统一 `KnowledgeObject`（§5.1 全部字段 + 17 个类型值）、完整 provenance（source / sha256 / document-task-run / captured_at / producer / verification + evidence）、§5.3 写入门禁 `ACCEPT|REJECT|QUARANTINE|SUPERSEDE`（五阶段留痕；无来源、非 sha256、无 doc/task/run 引用、含密钥形状、声称已验证却无证据、被反驳 → REJECT；模型自证 → QUARANTINE；更强 → SUPERSEDE；更弱或同强冲突 → QUARANTINE）、§5.4 冲突集（记录 authority/freshness/source hash/verification 后判 `ACTIVE|SUPERSEDED|UNRESOLVED`，**永不删除**）、§5.5 取用（TaskFingerprint → 类型相关性过滤 → authority → freshness → 词面相关度 → 字符预算 + 对象上限，逐条记录入选/丢弃原因）。复用既有 `KnowledgeScope`/`TemporalValidity`/`tokenSimilarity`（tenx）与 `contentHashOf`（workbook），不新增第 4 个分词器/哈希器。
- `src/shared/knowledge-extraction.ts`（纯）：从宿主已读过的字节**派生**知识（ARCHITECTURE/TEST/UI_SURFACE/CONSTRAINT/REQUIREMENT/DECISION），绝不向模型索要事实；为支持“不重扫”，discovery 阶段把有界 `RepositoryModelSummary` 记入 WorkBook 记录（`repo-inspector.repositoryModelFrom`）。
- `electron/knowledge/knowledge-base.ts`：单文件持久库（只追加 + 隔离区 + 冲突集 + 门禁审计日志），损坏文件经 `loadFailure()` 上报而不阻止启动。`electron/knowledge/knowledge-foundation.ts`：组合根唯一的 facade，写入/读取/取证都不抛错（知识失败永不拖垮任务，§2.5）。
- **生产接线**：`main.ts` 组合根实例化并把 `setKnowledgeSectionProvider` 接进 `ContextManager`；`runWorkDispatch` 在每条终态分支经门禁记录本次 dispatch 的事实；`ContextManager.assemble` 在任务自身指令之后追加有界 `PROJECT_KNOWLEDGE:` 段落（未接 provider 时输出与改动前**逐字节一致**，有回归测试钉住）。
- **验收**：`pnpm run acceptance:knowledge`（也是 CI 门禁）跑 K-01..K-04 共 44 项观测全 PASS——K-01 真实 dispatch 自行写入六类知识且 provenance 完整；K-02 同项目第二个任务在**删除整个工程目录后**仍复用第一个任务的 architecture / test layout / UI surface / 约束 / 决策事实，`repositoryReads=0`，且引用的是第一个任务的 provenance；K-03 模型自证声明被隔离且已验证事实逐字节不变；K-04 重启后库与复用仍成立。桌面黑盒同时新增 6 项断言，证明这套知识写入在**真实 Electron 应用**里同样发生。
- 回归：全量 114 files / 1081 tests PASS（原 110/1034，新增 47 项自身用例，无回归），typecheck/build 全绿。

### Phase 2（§6 + §9）— Architecture & UI Surface Discovery（CP3）

- **§6.1 Repository World Model**：`electron/engineering/world-model.ts` 一次有界读取工作区，产出 `src/shared/repo-world-model.ts` 的模型契约：仓库根/文件数/指纹、包管理器（lockfile+manifest）、语言分布、entry points、模块（字节/导出/导入）、测试、CI（`.github/workflows` 等）、构建体系（配置文件 + `package.json` scripts）、运行时（electron/node/browser/…）、git 状态（HEAD/branch/dirty）、生成目录（带原因与存在性）、ignore 文件、workspace 边界（monorepo 标记）。截断诚实上报，且上限不决定模型内容——样式/标记/入口/UI 组件优先读取，因此截断后 §9 仍然拿得到全部界面文件。
- **§6.2 依赖图与影响面**：`buildDependencyGraph` 产出 nodes/相对边/reverse（下游）/tests_by_module/external（平台内置在模块导入表中可见但不算依赖边）/entries_by_module（从 entry 正向遍历）；`impactOf` 给出受影响模块、测试、运行时入口、外部依赖、未被测试覆盖的模块与理由。导入抽取先剥离注释（注释掉的 import 不算依赖），并把 `./helper.js` 解析到 `helper.ts`。
- **§6.3 既有能力发现**：`probeCapability` 给出 EXISTS / PARTIAL / RESERVED / MISSING 并附证据。匹配规则刻意严格：**必须由同一个标识符**（路径段、文件名干或单个导出符号）命中多数关键词，散落的词不算证据。该规则是 CP3 自己的验收抓出来的——初版把“sandbox broker daemon”判成 EXISTS（因为仓库有 sandbox），也把 `WorkDispatchKnowledge`+`WorkDispatchStore` 当成“knowledge store”。本仓库实测：`knowledge write gate` → EXISTS（`src/shared/knowledge-object.ts#gateKnowledgeWrite`）、`sandbox broker daemon` → MISSING、`knowledge catalog store` → PARTIAL（“只有测试引用，产品到不了”）——与 CP2 审计手工发现的死代码结论一致。
- **§9/§9.1/§10 UI Surface Registry**：`src/shared/ui-surface-ids.ts` 唯一定义 23 个语义界面；`src/shared/ui-surface.ts` 定义类别、§10 token 分组、每个界面的锁定默认契约（allowedProperties/defaultTokens/fallback）与 fail-closed 校验；`electron/engineering/ui-surface-discovery.ts` **只填观测到的绑定**：样式表按选择器位置抽类名、代码文件只认 `className` 字面量（否则 `document.body` 会变成假类 `.body`）、元素/伪元素记成 `css-selector` 而不伪装成类；没有绑定的界面进入 `unbound`（如实上报，绝不臆造），自相矛盾的 registry 校验失败并被 store 拒收。`validateSurfaceOverride` 实现 §9.1+§20：UNKNOWN_SURFACE / UNKNOWN_PROPERTY / UNKNOWN_TOKEN / UNSAFE_VALUE（`javascript:`、`expression(`、`@import`、外链 `url(...)`）/ EMPTY_VALUE / LOCKED_SURFACE。
- **生产接线**：`main.ts` 组合根为任务工作区构建并持久化模型与 registry（`.boss/world-model/<id>.json`、`.boss/ui-surfaces.json`），经 `runWorkDispatch` 传入 intake；`workbook-dispatch.ts` 把 `discovery.world_model` / `discovery.ui_surfaces` 记入持久 WorkBook 记录，降级时写 `world_model_error` 而不是让任务失败（§2.5）。
- **验收**：`pnpm run acceptance:architecture`（亦为 CI 门禁）A-01..A-10 全 PASS（87 项观测）：fixture monorepo 的 §6.1 全字段、**本仓库自身**的 §6.1、依赖图、影响面、能力三态判决、23 界面契约、真实绑定（含 SCROLLBAR 无样式这一诚实缺口）、override 全量拒绝、真实 dispatch 记录并持久化两份产物、重启后模型仍可读且同树两次构建一致。桌面黑盒新增 7 项断言（61/61）证明真实 Electron 应用在真实 UI 派发中同样建立模型与 registry。
- 诚实边界（已写入 `docs/checkpoint-3-architecture-ui-discovery.md`）：`--boss-*` token 层尚不存在（`tokens_applied=false`、`tokens_declared=0`，颜色仍是硬编码字面量，迁移属 CP4/CP5）；SCROLLBAR 无样式可绑定；导入扫描仅覆盖 TS/JS 风格导入；能力发现是词面而非语义；模型是按次快照（尚未接入 `repoScanSignature` 增量校验）；图受同一模块上限约束并如实标注 truncated。

### Phase 2B（§10–§13、§20–§23、§25）— Theme Engine Foundation（CP4）

- **§11 主题包契约**（`src/shared/theme.ts`，纯）：主题 = 自足包（manifest/tokens/overrides/css/metadata），**没有 extends、没有导入、没有运行期引用**，因此删除一个主题永不影响另一个；`derivedFrom`/`metadata.basedOn` 只作来源记录，复制内置主题会 materialize 出完整副本。同时定义 §13 生命周期状态机与 §23 `ThemeRecord`，以及宿主必须照做的两份计划：`planActivation`（§21：无效/隔离/停用/哈希过期/不存在 → 一律回退内置，并给出 code 与原因）与 `planThemeDeletion`（§22 固定步骤序 `VERIFY_NOT_BUILT_IN → (SWITCH_FALLBACK|KEEP_ACTIVE) → UNREGISTER → DELETE_PACKAGE → VALIDATE_REMAINING`，内置拒绝）。
- **§20 校验器**：SCHEMA、REQUIRED_TOKENS、UNKNOWN_TOKEN、UNSUPPORTED_PROPERTY、LAYOUT_OVERFLOW、BROKEN_REFERENCE、TOKEN_CYCLE、INVALID_CSS、UNSAFE_URL、EXTERNAL_IMPORT、FILESYSTEM_ESCAPE、SCRIPT_INJECTION、CRITICAL_CONTRAST（WCAG 对比度，低于 3:1 记 ERROR，其余按配对要求记 WARN）、STARTUP_STABILITY、BUILT_IN_INTEGRITY，全部产出机器可读诊断；样式表、override 值与 **token 值**都过脚本注入扫描（三者最终都会进入文档）；报告带通过时的内容哈希，可证明“通过的是什么”。
- **§8 存储 + 管理器 + 注册表**（`electron/theme/*`）：一主题一目录（`theme.json`/`tokens.json`/`overrides.json`/`metadata.json`/可选 `overrides.css`），拒绝任何逃出主题根的 id，损坏或超限的包按校验失败处理而不是崩溃；`bootstrap()` 落地并校验两个内置主题、再证明持久化的活动主题仍可用（不可用即回退）；`install()` 走过门禁，失败包以 `QUARANTINED` 注册保持可见；`activate()` 每次先从磁盘重新校验；`update()` 每次编辑都重新校验，改坏则保留上一版；`disable`/`rename`/`duplicate` 实现 §13；`delete()` 严格按 §22 计划执行。
- **§12 内置 Light/Dark**：作为完整包内置，`BUILT_IN`/`builtIn`/`deletable:false`，与用户主题走同一套 §20 规则（无豁免）。**Dark 的 token 值就是应用当前已渲染的值**，因此启用 Dark 视觉上等同无变化（仅两条发丝线在原字面量与共享 `--boss-border` token 间相差 ≤2/255）。
- **§10 token 层落地**：`src/renderer/styles.css` 现消费 8 个 §10 token（bg-root/bg-surface/text-primary/border/font-family/scrollbar-thumb/scrollbar-track/radius-sm），全部保留原字面量作为 `var()` 回退，并补上滚动条规则（同时关闭 CP3 的 SCROLLBAR 缺口）；值差异会明显改变外观的声明（composer 背景、附件按钮、代码面板）**刻意不迁移**，诚实状态是“token 层已驱动画布/表面/文字/边线/滚动条”，而不是“所有表面已主题化”。渲染层经单一 `<style>` 元素应用活动主题（`src/renderer/theme.ts`，自带可执行内容兜底拒绝），设置面板新增 `ThemePanel`（列出/激活/复制/删除/恢复默认 + 引擎诊断日志）。
- **生产接线**：`main.ts` 组合根构建主题服务并在窗口可用前 `bootstrap()`，IPC 暴露 §8 接口（snapshot/activate/duplicate/delete/restore-default/validate）；主题校验与渲染所依赖的 UI surface registry 改为从**应用自身源码**发现（`ensureUiSurfaces()`）——修正 CP3 里用任务工作区构建该 registry 的错误；任务路径改为读取已持久化的 registry，不再在 dispatch 内重建模型。§56 主题事件（THEME_INSTALLED/ACTIVATED/FALLBACK 等）加入领域事件词表。
- **验收**：`pnpm run acceptance:theme`（亦为 CI 门禁）TH-01..TH-15 + T-TOKENS：TH-01/02/03/07/08/09/10/11/12/13/14/15 与 T-TOKENS 全 PASS（69 项观测），TH-04/05/06（prompt 生成 / 预览沙箱 / 反馈修订）显式 `NOT_RUN`——属 CP5，未在此声称。桌面黑盒新增第二阶段：在**重启后的真实 Electron 应用**里验证主题引擎（注册表跨重启恢复、画布 token 为恢复主题的值、经真实面板启用 Light 后计算样式变为 `#f4f6f2` 且外壳颜色随之变化、Dark 复原、无布局溢出），77/77 claims。
- 诚实边界（写入 `docs/checkpoint-4-theme-engine-foundation.md`）：TH-04/05/06 属 CP5；仅画布/表面/文字/边线/滚动条 token 化；`--boss-shadow`/`--boss-blur`/`--boss-spacing-density` 等已声明但样式表尚未消费；对比度按 token 配对而非真实像素测量；黑盒观察到“回退后的 provider dispatch 约 2 秒后 renderer 调试端点消失而进程仍在”的现象，未归因，故主题阶段改为同数据目录二次启动（顺带证明 §48 重启持久化），并让 harness 在调试会话丢失时响亮失败而非静默退出。

### Phase 2B 续（§14–§17、§19、§24、§26）— Theme Generator + Preview + Visual Verification（CP5）

- **§14 Theme Intent Parser**（`src/shared/theme-intent.ts`，纯）：把自然语言风格请求解析成**每个信号都带原句证据**的结构化 intent——参考风格（macOS/Win11/VS Code/终端/赛博/纸张/Notion/Linear/玻璃/粗野/复古）、冷暖、明暗、半透明（含“再透明一些/不要那么透明”这类**增量修订**）、密度、圆角、字体、对比度偏好、命名色（hex 字面使用）与色调方向、以及“保持不变”。带 `previous` 解析即为修订：未提及轴继承，仅动的轴变化。
- **§19 生成边界**：请求若涉及移动/删除/新增/重排界面元素，或触碰 IPC/快捷键/拖拽/重写，则**升级为界面工程任务**而非主题，并给出触发短语与理由（“去掉半透明”属样式，“去掉设置按钮”不属——模式要求出现界面元素）。
- **§15 Theme Generator**（`src/shared/theme-generation.ts`，纯）：**没有当前 token 与 §9 契约表就直接抛错**——不允许只凭一句话写 CSS。确定性推导并逐 token 记录决策：明暗重排中性色阶、色温/色调/命名色 → accent/on-accent/表面着色、半透明 → 分层 alpha（画布最不透明）+ blur/opacity、密度 → spacing/行高、圆角 → 三档、字体栈、对比度偏好 + 有界**可读性修复**（对每个背景把文本对比度抬到 4.5:1 以上并如实上报修复项）；override 只发往契约表中存在且允许该属性的表面；输出是完整自足包（§11）。
- **§17 预览沙箱**：`startPreview` 校验后写入 `<theme-root>/.preview/`（package.json + 渲染好的 preview.css）与持久 `preview.json`，记录 intent/决策数/取证摘要/修订计数，**注册表与活动主题完全不动**；同 id 再次预览即修订（计数递增且跨重启保留，§47）；`acceptPreview` 重新读回草稿字节走正常门禁并（默认）激活，校验不通过则拒绝；`cancelPreview` 丢弃草稿且活动主题不受影响。渲染层在**独立** `<style>` 中应用预览，取消后无残留。
- **§16/§16.1 视觉取证**：设计前先截取当前界面（主窗口 + 各已打开 AI 面板），截取前先注入**脱敏模式**（消息正文、输入值、下拉与媒体视觉移除），截完即撤；帧与 `captures.json` 索引（surface/文件/字节/sha256/尺寸）写入 `.boss/theme-captures/<ts>/`；关闭的面板如实进 `skipped`，绝不静默丢弃，也不因此让请求失败。
- **§26 视觉回归**：渲染层**测量**（各表面盒模型/可见性/计算色/滚动指标/控件状态），纯模块**判定**：MAJOR_SURFACE_VISIBLE、TEXT_READABLE（实测对比度，<3:1 记 ERROR）、CONTROLS_VISIBLE、MODAL_USABLE、SIDEBAR_USABLE、INPUT_USABLE、SCROLLING_USABLE、NO_CATASTROPHIC_OVERFLOW、NO_TRANSPARENT_ON_TRANSPARENT；结论落到 `.boss/theme-visual-check.json`。
- **§24 主题↔知识**：intent、推导出的 tokens/overrides、用户反馈原文与校验结论（含被拒的 `/surface.property` 组合）经 **CP2 写入门禁**记为宿主可验证的 `THEME`/`THEME_VALIDATION`/`USER_OVERRIDE`；**不写任何图像**——只有取证*摘要*进入知识，脱敏帧留在自己的目录。
- **接线与 UI**：7 个 IPC（generate/preview/preview-revise/preview-accept/preview-cancel/capture/visual-check）、§56 事件 THEME_DRAFT_CREATED/THEME_PREVIEWED，设置面板新增生成器面板（提示词、草稿卡：参考风格/取证摘要/决策/可读性修复/校验错误与警告、预览动作：接受并激活/仅安装/取消、修改意见输入、视觉检查与脱敏取证按钮）。
- **验收**：`pnpm run acceptance:theme` 现为 **21 项全 PASS、0 FAIL、0 NOT_RUN**：TH-04（提示词→完整可解释包→安装激活）、TH-05（预览不注册不动活动主题、取消即弃、预览与活动主题不同）、TH-06（后续消息修订并继承未提及轴、修订计数递增且持久）+ T-GEN（确定性：同意图同包哈希 / 完整性 / 逐条解释 / override 受约束）、T-BOUNDARY（4 类布局/行为请求全部升级且不产出包）、T-CAPTURE（脱敏进出、真实 PNG + 带哈希索引、关闭面板如实 skipped）、T-VISUAL（健康通过、不可读/塌陷/溢出按规则失败）、T-KNOWLEDGE（intent/反馈/校验入知识，图像不入）。桌面黑盒第二阶段在**重启后的真实应用**中跑通全链（提示词→草稿→预览层（活动主题不动）→自然语言修订→视觉检查→接受并激活→恢复默认），**89/89 claims**。
- 诚实边界（写入 `docs/checkpoint-5-theme-generator-preview.md`）：意图解析是词面而非语义（超出词表即诚实报“无可用风格信号”）；生成器是从活动主题做确定性推导，取证图像只作设计证据、无视觉模型读取；无观测绑定的表面会被生成器跳过；视觉检查基于浏览器计算布局而非像素；取证脱敏是视觉层而非取证级；解析失败尚未接入 CP11 的能力缺口闭环。

### Phase 3（§28）— Requirements Graph（CP6）

- **§28.1 需求类型与来源**（`src/shared/requirements-graph.ts`，纯）：把已编译 Task Contract 变成 `RequirementNode`，每个节点都带契约已建立的 provenance（文档/小节/标题/声明类型/条目序号）+ authority + 是否可被用户覆盖。类型映射表：GOAL→GOAL、SCOPE→FUNCTIONAL、CONSTRAINTS/PERMISSIONS→CONSTRAINT、INPUTS/DEPENDENCIES→DEPENDENCY、DELIVERABLES→DELIVERABLE、ACCEPTANCE_CRITERIA→ACCEPTANCE、RISK→PROHIBITION、EXECUTION_STRATEGY→NON_FUNCTIONAL；再按文本细化：标注可选（`(optional)`/`可选`）→OPTIONAL，含禁止语气（must not/不得/不要）→PROHIBITION（因此“must not slow checkout”这类约束条目会被判为禁止项），外观类条目（UI/主题/配色/字体/对比度/CSS/截屏/preview…）→VISUAL，且所有视觉节点都带 `visual: true`，使 §28.4 的视觉分支对视觉验收项同样生效。
- **§28.2 依赖边**：每条边都写明理由——非目标/非验收项服务目标（DERIVES）、交付物依赖声明输入（DEPENDS_ON）、验收项按词面相似度（≥0.25）验证对应交付物（VERIFIES，无匹配则验证全部交付物并如实写明）、视觉验收项额外验证外观项、条目文本里点名其它需求 id（FR-1/AC-2）时建立 DEPENDS_ON。`depends_on`/`blocks` 双向一致，环检测作为**诊断**上报而非崩溃，并提供依赖优先排序与“依赖已满足”的 ready 集合。
- **§28.3 状态机**：九态（UNSTARTED/READY/RUNNING/BLOCKED/QUARANTINED/IMPLEMENTED/VERIFIED/FAILED/SUPERSEDED）与合法迁移表；非法跳转被拒绝并回显允许集合；SUPERSEDED 终态；VERIFIED 因回归可重开为 RUNNING；不允许直接跳到 VERIFIED。位于**冲突小节**内的需求直接以 `QUARANTINED` 起始（复用契约级 `isolateRequirements` 结果），只阻塞该需求并保留隔离理由。
- **§28.4 验收绑定**：`RequirementEvidence`（IMPLEMENTATION/TEST/REVIEW/PREVIEW/SCREENSHOT/VISUAL_VERIFICATION/COMMAND × PASS/FAIL/MISSING/NOT_RUN + source/detail/时间/命令/产物/哈希）→ 各类型所需证据（ACCEPTANCE：实现+测试+审查；VISUAL：实现+预览+截图+视觉核验；DELIVERABLE/FUNCTIONAL：实现+测试；其余：实现）；缺失、NOT_RUN 或 FAIL 一律保持未验证，只有实现证据可推进到 IMPLEMENTED，`VERIFIED` 要求每种所需证据都 PASS；隔离/被取代需求只上报、永不验证；报告含 bindings/visual/totals/未验证清单。
- **生产接线**：`workbook-dispatch.ts` 在编译契约后立即构建需求图并写入持久 WorkBook 记录（`task.workbookDispatch.requirements`），后续阶段（规划、worker 验证、审查、Guardian）都可以引用需求 id 而非散文。
- **验收**：`pnpm run acceptance:requirements`（亦为 CI 门禁）用**真实 runWorkDispatch**（真摄取 + 冲突双 spec 工作书 + 主题工作书）跑 R-01..R-08 全 PASS（54 项观测）：R-01 持久记录带类型与完整 provenance；R-02 每条边有理由、无环、可拓扑排序、双向一致；R-03 冲突需求 QUARANTINED 且其余可执行；R-04 状态机拒绝非法跳转；R-05 验收项需实现+测试+审查；R-06 视觉需求走视觉分支；R-07 **声称不等于证据**（无证据零验证、测试 FAIL 保持未验证、完整证据下仅隔离项仍开放）；R-08 报告版本化、机器可读且逐条自解释。
- 诚实边界（写入 `docs/checkpoint-6-requirements-graph.md`）：需求尚未绑定到实现它的*文件*（属 CP7 执行 DAG 与 CP8 证据账本）；非声明式边为词面启发式（相似度阈值与理由都可见）；VISUAL 判定基于关键词；证据目前由验收 harness 产生而非流水线自动产生（CP8/CP9 接线）；BLOCKED/FAILED 已可达但尚无恢复阶梯驱动（CP10）。

### Phase 4（§29）— Execution Planner（CP7）

- **§29.1 Execution DAG**（`src/shared/execution-planner.ts`，纯）：从 §28 需求图派生节点——功能/交付物需求→IMPLEMENT，禁止/约束/验收/视觉需求→VERIFY，可选需求→永不阻塞的独立节点；每个节点带齐九项字段（objective / requirements / inputs / scope / **allowed_files** / expected_outputs / **verification**（闸门+真实宿主命令+§28.4 证据种类）/ dependencies / **rollback**（点名可触碰文件））。
- **作用域 fail-closed**：`resolveAllowedFiles` 只在宿主**实际观测**到的文件里匹配需求 scope；匹配为空则 `allowed_files` 为空、标记 `unbounded_scope` 并留诊断——worker 得到的是**没有写权限**，而不是整个仓库。
- **§29.2 并行/顺序**：wave = 节点 DAG 最长路径分层；`plan_parallelism` 与 `scheduleExecution({completed, running})` 都受自适应上限约束；同一 wave 内绝不出现互相依赖的节点。
- **§29.3 动态并发**：`decideConcurrency` 由 CPU 核数、空闲内存、GPU、可用/限流 provider、在飞任务、负载均值、电源受限推导 1..8，并随决策返回**输入快照与理由**；调度路径中不存在常量。
- **生产接线**：CP3 的世界模型额外产出 `PlanContext`（真实文件/测试文件/入口/构建工具/宿主命令 + `main.ts` 用 `os` 与 provider/account/run 状态生成的实时资源快照）；`workbook-dispatch` 在需求图之后立即规划，DAG 记入持久记录 `task.workbookDispatch.execution_plan`。
- **验收**：`pnpm run acceptance:plan`（亦为 CI 门禁）用**真实 runWorkDispatch**（真实工作区 + 真实工作书）跑 P-01..P-06 全 PASS（52 项观测）：持久且带版本的计划、九字段齐备（含真实 `src/gateway.ts` 作用域、无节点被授予整仓）、验证依赖实现且绝不同 wave、wave 内无相互依赖、**资源派生并发**（大而空闲的主机 > 受限主机；1 个可用 provider 即封顶；恒 1..8；理由自解释）、不可解析作用域被拒而非放宽。实测：2 节点 / 2 wave / 并发 3（8 核 8192MiB ⇒ 7；3 provider ⇒ 3）。
- 诚实边界（写入 `docs/checkpoint-7-execution-planner.md`）：节点尚未绑定到真实证据（属 CP8）；wave 已排序但并行执行器未建（属 CP8）；`gpu_available` 目前恒为 false（无 GPU 探针）；作用域匹配为词面（不匹配即 unbounded 并可见）；rollback 只被表达未被演练（依赖 CP13 的 Git checkpoint）；CP7 的代码/测试/门禁与本文档不在同一提交（本文档于次轮补齐，已在文档中如实记录）。

### Phase 5 + Phase 6（§30 + §31）— Verification Engine / 实现回路的宿主侧（CP8）

- **§31.1 阶梯**（`src/shared/verification.ts`，纯）：把计划书的十一级阶梯写成 `VERIFICATION_LADDER`（syntax → typecheck → target unit → module → integration → full → build → **benchmark** → runtime smoke → **desktop black-box** → visual runtime），并为 `VERIFICATION_GATES`/`GATE_RANK` 增补 `BENCHMARK`/`BLACKBOX`——不再用九级阶梯近似计划书。`orderByLadder` 只做最便宜优先排序，不臆造闸门。
- **§31.2 需求感知**（同文件）：`selectGates` 由需求类型 + §28.4 所需证据 + 需求原文信号（中英双语）决定要爬哪些闸门，并逐条给出理由：性能→BENCHMARK、持久化→RUNTIME（重启）、失败恢复→INTEGRATION（故障注入）、主题→预览 VISUAL + 回退 UNIT + BUILD、桌面 UI→BLACKBOX。**宿主没有的闸门进 `unavailable` 并附原因，绝不记为通过**；引擎自己产不出的证据种类（REVIEW/PREVIEW/SCREENSHOT）进 `external_evidence`，需求因此保持未验证直到 §32 审查层或 §17 取证层交付。`boundedScopeFor` 实现 §30.1 的 worker 作用域（无文件即无写权限）。
- **§30.2/§30.3 纯判定**：`verifyChangeClaims`（文件存在 + git 报告已修改 + 哈希一致，三者缺一即拒——worker 谎报不会被记功）与 `changeUnitProblems`（空单元、重复、越界、`.git`/`.codex`/`.agents`/`AGENTS.md` 保护路径、1MB 预算）。`ladderOutcome` 让**最便宜的失败闸门说话**，其上方闸门记 `SKIPPED` 并写明原因；只有真正通过的闸门才能被称作最强；跑不动的闸门记 `NOT_RUN` 而非 PASS。
- **§30/§31 宿主执行器**（`electron/engineering/verification-engine.ts`）：`applyChangeUnit` 先整体预检再整体落盘（临时文件 + rename，写失败回滚已写部分），并**照旧经过 §7.3 `assertMutationAllowed`**，因此验证引擎的写入不会成为进入 Stable 仓库的第二条无守卫通道；`rollback()` 按记录的 `before_sha256` 还原**逐字节**内容或删除新文件；`verifyClaims` 用真实 `git status --porcelain --untracked-files=all` + 真实哈希取证，git 无法回答时**拒绝**该声明而不是默认相信；`verifyRequirement` 最便宜优先爬梯并在**第一个失败处停止**，SYNTAX 走真实 `node --check`（若只授予 TypeScript 文件则如实说明该闸门无法解析 TS、由 TYPECHECK 覆盖），typecheck/build/test 走白名单 `runAllowedCommand`（宿主自算 argv，模型无法注入命令），benchmark/runtime/blackbox/visual 只能由**真实取证报告**满足（`ingestReport` 记录产物 sha256，逃出工作区的路径被拒）；ledger 在**每次验证与每次取证后写穿**（§47）。
- **§31.3 证据账本接线**：引擎在构造时读入 `<root>/artifacts/acceptance/verification-ledger.json`，验证结果按 (命令, 结果, 需求) 去重后追加（重跑同一闸门不会重复计数），并可经既有 `evidenceForRequirements` / `outstandingEvidence` 直接进入 §28.4 验收绑定。
- **验收**：`pnpm run acceptance:verify`（亦为 CI 门禁与本地链一步）在**真实 git 仓库 + 真实 TypeScript 工具链**的 fixture 上跑 V-01..V-10 全 PASS（82 项观测）：作用域外写入被拒（且文件未产生）、混合变更单元整体拒绝/整体应用、谎报声明被 git+哈希驳回、语法失败后 typecheck **可证未执行**、真实 `tsc --noEmit` 带真实退出码与真实 `TS2322` 诊断、修复后真实 `node --test` 通过、仅凭 harness 的闸门不被伪造而真实 benchmark 报告可满足、账本持久且重跑不重复计数、回滚后逐字节一致且 git 状态干净、引擎不产 SCREENSHOT/REVIEW/PREVIEW 也不给任何未运行的视觉闸门记通过、账本→§28.4 绑定与缺口清单正确。另有 `tests/unit/verification-ladder.test.ts` 19 例钉住阶梯顺序、§31.2 各类需求路由、不可运行闸门的拒绝与 §30 三条规则。
- 诚实边界（写入 `docs/checkpoint-8-verification-engine.md`）：**消费本引擎的 §30 实现回路属 CP9**——§30 的完整循环（Plan → Worker → Host Verification → Review → Repair → Reverify）需要 §32 的审查层，CP8 交付的是其中 **Host Verification** 这一级的完整模块与真实 API；既有接缝（`verification.ts` 的 `verifyAndRepair`、`proposal-runner`、`main-commander`）保持原样未改，故无回归。runtime/blackbox/visual 闸门**只**接受已产出的 harness 报告（桌面黑盒仍是自己的 CI 门禁，89/89 claims），引擎不假装自己驱动 Electron；不制造截图/预览/审查；`gpu_available` 仍恒为 false；§31.2 的信号识别是词面而非语义（无信号即走阶梯基线，属刻意 fail-closed）。



