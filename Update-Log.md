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

