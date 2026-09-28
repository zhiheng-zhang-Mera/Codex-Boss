# Codex-Boss：CC-104 论文双锚冻结、城市化续建与仓内预解耦工程书

> **交给 Hns / Codex 的执行指令。**收到本文件后先核验冻结点，再在独立施工分支执行；不要求 Owner 再选方案、审批普通 PR、处理已授权权限门或手动盯测试。按任务逐项推进，直到全部城市化机器条件满足，只剩一次真人最终体验与确认。
>
> **执行方式：**优先原生串行施工，独立工作可并行；具备 `superpowers:executing-plans` 时按该工作流执行，但本文件已给出范围和执行授权，不再增加中途人工设计审批。使用任务复选框记录实际进展。

**目标：**固定已有论文证据，在不损坏 Boss 现有完整功能的前提下，完成既定 Phase 2 城市化结构验收；顺路建立有真实收益的仓内迁移边界，为未来 Digital-City 拆出模块准备条件。

**架构：**保持一个可独立安装、启动和运行的 Boss 产品；采用明确接口、依赖注入、单一状态所有者和局部兼容适配消除反向依赖与循环，不在本轮新增分布式服务或跨仓运行依赖。

**技术栈：**沿用目标仓库锁定的 Electron / TypeScript / React / Vitest / pnpm 与 GitHub Actions；以 `package.json`、锁文件和既有工作流为准，不顺手升级工具链。

**规格来源：**本文件 §1–§9；仓内既有 `PHASE2_ARCHITECTURE_MIGRATION_SPEC.md`、`PHASE2_ARCHITECTURE_MIGRATION_ACCEPTANCE.md`、`capability-city-principles.md`。本文件替代旧工程书的推进顺序和停工约定，不追溯改写旧实验协议或已接受的 CC-103 结论。

**签发日期：**2026-09-28，Australia/Melbourne。机器日志统一 UTC；不能手填推测的运行时间。

---

## 0. 必须保留在每次上下文恢复中的执行契约

```text
REPOSITORY = zhiheng-zhang-Mera/Codex-Boss
MISSION = POST_CC103_STRICT_CITY_CLOSEOUT

PAPER_EXPERIMENT_SHA = bedeb8280f4bdb51e54fbead642775b1a32d16b6
PAPER_EXPERIMENT_TAG = boss-city-cc103-paper-snapshot-v1
VERIFIED_BUNDLE_SHA  = 8df428eaa437a409368401e95194e40266b83080
BUNDLE_FREEZE_TAG    = boss-paper-cc103-bundle-20260928-v1
PRIMARY_WORK_BRANCH = city/phase2-closeout-post-cc103

PAPER_OLD_DATA = IMMUTABLE
POST_FREEZE_DATA = SEPARATE_COHORT
HISTORY_REWRITE = FORBIDDEN
MOVE_EXISTING_EVIDENCE_TAG = FORBIDDEN
INTERMEDIATE_HUMAN_APPROVAL = NOT_REQUIRED_WITHIN_EXISTING_AUTHORITY
OWNER_CREDENTIAL = USE_EXISTING_SECURE_AUTHENTICATED_CLIENT_ONLY

MAIN_PAPER_REFERENCE = FORBIDDEN_AS_A_FLOATING_REF
NEW_CODE_LOCATION = NEW_WORK_BRANCH_FIRST
BOSS_STANDALONE_RUNTIME = MUST_REMAIN_FUNCTIONAL
DIGITAL_CITY_CROSS_REPO_CODE_MOVE = OUT_OF_SCOPE
NEW_RUNTIME_SERVICE = OUT_OF_SCOPE

OLD_MINIMUM_HUMAN_ACCEPTANCE_READY = NOT_THIS_MISSION_COMPLETION
STRICT_STRUCTURAL_TARGETS = UNCHANGED
RAW_STRICT_GATE_UNVERIFIED = NEVER_SILENTLY_PASS
FINAL_HUMAN_ACTION = ONE_BOUNDED_SESSION
TARGET_TERMINAL_STATUS = READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE
```

**本轮不是再做一次 CC-103。**旧 checkpoint 已经接受，但完整城市化仍未完成。本轮必须产生真实结构改进并满足既定严格机器目标；不能再次以“旧最小验收仍 READY”作为收工理由。

**不添加新的大目标。**不建设完整 Digital-City，不启动 Boss/Hns 大迁仓，不把“所有可能的风险都不存在”当作交付条件。

---

## 1. 签发时已核验的事实与证据边界

### 1.1 两个 SHA，各有用途

| 对象 | 已核验值 | 本轮处理 |
|---|---|---|
| CC-103 实验/验收快照 | `bedeb8280f4bdb51e54fbead642775b1a32d16b6` | 原实验数据和旧结论的唯一代码锚点 |
| 已有 annotated tag | `boss-city-cc103-paper-snapshot-v1` → 上述 SHA | 验证并保留，不重新创建或移动 |
| 当前主线/材料承载点 | `8df428eaa437a409368401e95194e40266b83080` | 含后续归档清单、证据提取及引文桥接；新施工的签发参考基线 |
| 材料冻结标签 | `boss-paper-cc103-bundle-20260928-v1` | **本轮待核验/创建的新增标签**，指向 `VERIFIED_BUNDLE_SHA`，不是已执行的事实 |
| 当前主线 CI | run `36371964312` | 签发时 exact-SHA 五项 `completed/success` |
| 旧严格城市化状态 | `NOT_READY` | 不改成已完成 |

当前主线五个已读到的 job：

```text
quality       108770009126  SUCCESS
architecture  108770008986  SUCCESS
unit          108770166851  SUCCESS
acceptance    108772343253  SUCCESS
package       108772343269  SUCCESS
```

PR #141 已完成分支归档和论文提取，PR #142 追加历史分支引文桥接。已有：

```text
docs/history/BRANCH_ARCHIVE_2026-09-28.md
docs/research/PAPER_EVIDENCE_LEDGER.md                 # 已有 §A–§W
docs/research/PAPER_SNAPSHOT_CC103.csv                # PR #141 报告为 39 行 × 12 列
```

PR #141 记载清理前 152 个分支，保留 main，111 个已合并分支删除，40 个未合并 tip 先保全再删除；不要恢复它们为 active 分支，也不要重做这次全库清理。[S1–S5]

### 1.2 已有结构记录，不冒称签发时重新测量

下表来自既有 `MINIMUM_HUMAN_ACCEPTANCE_RECORD.md`；该文明确区分测量 SHA `1faf29a6eda99d8cbf69e9512c52a3e95d10aa80`、记录承载提交和最终 CC-103 提交。此处是**历史记录的启动参考**，任务 2 必须在实际施工基线重新测量一次。[S6]

| 指标 | CC-103 记录值 | 本轮最终机器目标 |
|---|---:|---:|
| kernel → feature 文件依赖边 | 49 | 0 |
| kernel → feature distinct pairs | 16 | 0 |
| mutual capability pairs | 31 | 0 |
| 最大强连通分量（循环依赖组） | 18 / 29 节点 | ≤ 1 |
| `MIGRATION_IN_PROGRESS` | 21 | 0 |
| `UNSAFE_GAP` | 0 | 0 |
| 已确认跨域私有状态访问 | 0 | 0 |
| multi-writer candidates | 0 | 0，保留该检测器原有含义 |
| 从 road 指向功能实现的边 | 0 | 0 |
| 过期临时桥 | 0 | 0 |
| `NOT_GUARDED` 原则 | 0 | 0 |
| `MACHINE_RATCHET` 原则 | 2（15.1、15.7） | 0，必须由真实严格实现和相应检查取代 |

旧记录的严格结果为 `21 PASS / 6 OPEN / 7 UNVERIFIED`；其中缺少 hosted 参数会产生部分 `UNVERIFIED`，不能把这些全部当作需要新造功能的任务。

旧 `CITY-DEBT-006 = ACCEPTED_PERMANENT` 必须保留。CC-103 同 SHA 的 acceptance 首次失败及允许的第二次成功都属于证据，不得只留绿色结果。旧的接受不意味着以后所有 acceptance 失败都自动属于该 flake。[S4、S6]

### 1.3 本文件生成不等于远端已完成新操作

本文件是一份执行工作书。新增材料标签、新施工分支和新一轮城市化修改均须由执行器按任务 1 开始落实。每个声称“已创建/已合并/已通过”的状态，都必须有实际远端或本地验证结果。

---

## 2. 任务范围与完成定义

### 2.1 必做范围

1. 验证旧论文快照并冻结当前材料承载点；保留可追溯历史。
2. 关闭既定 Phase 2 中真实存在的结构缺口；复用已经证明成立的部分，不推倒重来。
3. 把迁移过程中的真实开发/实验数据保存为独立的 post-CC103 阶段。
4. 恢复正常运行时权限边界，交付 exact-SHA 全绿、可直接启动的 Boss，最后仅剩一次真人验收。

### 2.2 可做但不得扩大工期的范围

为直接参与此次修复的模块建立局部接口、状态所有者 API、组合入口、普通工程逻辑与信任逻辑的分界。**非严格验收必需的预解耦试点最多做两个语义边界**；做不了就记入迁移地图，不阻塞主线。

这个“两处”限制不适用于消除现有 kernel 反向依赖与循环所必需的改造，否则会阻碍真正的城市化任务。

### 2.3 明确不做

不新建仓库，不把 Boss 改成必须联网访问 Digital-City/Hns 才能运行，不拆出独立进程/微服务，不做新的通用插件框架，不重写全部 UI，不增加 City Dashboard，不迁移真实用户数据格式，不升级依赖，不追求全仓覆盖率数字，不要求长时间 soak，不为论文数量制造失败、重复提交或虚假实验。

Boss 重命名、Hns provider 中立化、跨设备 City 实时同步、新市政机构服务化，都留在后续路线，不在本工作书中实施。

### 2.4 机器完成与人类确认分开

目标终态必须同时满足：

```text
FROZEN_PAPER_REFS_VERIFIED = true
STRICT_STRUCTURAL_TARGETS_MET = true
CURRENT_BOSS_BEHAVIOUR_PRESERVED = true
HOSTED_REQUIRED_CHECKS_ON_FINAL_MAIN = 5/5 SUCCESS
ROOT_TRUST_ON_FINAL_MAIN = MATCHES
FINAL_TREE_CLEAN_AND_PUSHED = true
NEW_EVIDENCE_PRESERVED = true
TEMPORARY_RUNTIME_PRIVILEGE_EXPANSION = NONE
REMAINING_MACHINE_BLOCKERS = 0
REMAINING_HUMAN_SESSIONS = 1
```

最终可以报告 `READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE`，但在真人确认前不得报告 `CAPABILITY_CITY_CONSTRUCTION_COMPLETE`，也不得把执行器的 Owner 授权操作冒称真人亲测。

---

## 3. 无人工干预的授权与真实边界

### 3.1 延续已有 Owner 施工租约

仅在 **Codex-Boss 仓库及其已授权 CI / ruleset / environment / Root Trust 施工范围**内，允许执行器使用已经可用的安全认证客户端，执行环境批准、工作流重跑/取消/dispatch、epoch ceremony、PR 创建/合并、必要的 Owner bypass 和有记录的门禁修复。普通施工不再等待人工逐步授权。[S7]

优先使用现有机器/App 通道；需要 Owner 权限时切换到现有 Owner 客户端。对这些动作记 `DELEGATED_OWNER_ACTION`，不能计作真人干预，也不能冒称普通机器身份已具备 Owner 权限。

本轮授权不是让 Boss 自己永久取得自我授权能力。保持：

```text
BOSS_CAN_MODIFY_ITSELF != BOSS_CAN_AUTHORIZE_ITSELF
```

### 3.2 不因权限门或红灯全局停工

```text
可修的权限配置 → 直接按授权修复 → 记录 → 继续
已配置的 Owner 批准 → 执行批准 → 继续
CI 排队/运行 → 并行处理独立任务 → 结果回来再集成
真实代码失败 → 最小修复 → 重测受影响部分
可选预拆失败 → 普通 revert → 记录延后 → 继续主线
```

不得停在“请 Owner 点一下”“本轮只做到这里”“建议下一轮继续”这种可由现有权限或执行器自己解决的状态。

### 3.3 不能伪造外部能力

本工程书不能制造本来不存在的登录、联网条件、硬件或平台额度。仅当所有独立工作已经完成、且所有可执行替代路径均已实际失败，才允许输出 `EXTERNAL_BLOCKER_NOT_COMPLETE`，列明真实错误、已尝试路径和已推送 checkpoint；不得伪称 READY。

不得绕过真实平台权限限制，不得读取或打印原始 token，不得复制 Owner 凭据进仓库、运行时数据或新 secrets，不修改账号级安全设置，不影响其他仓库。现场发生数据破坏/凭据泄露风险时停止相关写入，而不是继续损坏以满足“无停工”。

### 3.4 租约收尾

在机器验收就绪时撤回**本轮临时增加及沿用旧施工租约仍未撤回的**运行时权限扩张、临时放宽规则和自动施工权；只处理已识别的施工例外，不重置用户正常权限。保留正常安全登录、正常 Owner 角色和受控执行最终确认的能力。记录 `NO_FURTHER_AUTONOMOUS_MUTATION_PENDING_OWNER_ACCEPTANCE`。不删除用户的凭据，不给 Boss 留常驻 Owner 能力。

---

## 4. 防御性膨胀控制规则

### 4.1 新任务必须满足至少一项

```text
A. 关闭本轮严格验收中的真实不通过项；
B. 修复本轮引入的真实功能回归；
C. 避免正在发生的证据丢失、凭据泄露或数据破坏；
D. 替代已经复现的错误验收判断；
E. 在直接相关模块内，以很小改动形成可迁移边界。
```

不满足者放入既有 issue/backlog 或迁移地图，一句说明即可，不给它新建 blocker，不递归展开新设计。

### 4.2 限制验证成本，而不是降低目标

- 一个真实缺陷用一个最小回归测试钉住；共享原因可由一组参数化测试覆盖，不为同一保证制造多份门禁。
- 每个改造单元只跑受影响测试和必要结构量测；最终集成再完成所需全量与 hosted 证明。
- 不要求连续 N 次全绿，不要求 24h，不要求重新跑全部历史 epoch/旧基线。
- 不为了零 warning、文件短、目录整齐、全量类型抽象或理论上的所有失败排列进行重写。
- 不新建一套“验证验证器的验证器”。若已有 gate 的具体错误影响本轮结论，只修该错误并补对应回归。
- 相同方案连续两次没有减少缺口且没有新定位信息，换切入点，不继续追加同类防御流程。

### 4.3 不得用降低语义标准冒充减负

不得提高最终阈值，不得把严格模式改成 shadow，不得删除难测代码，不得将 `UNVERIFIED` 改 PASS，不得仅改所有权标签让循环消失，不得把全部业务归到一个“超大 Core”或一个伪能力里。

“把复测和新设计减到必要程度”与“把没完成说成完成”是两件不同的事。

---

## 5. 文件布局：复用旧记录，新增最小工作面

将本工程书保存在新分支的：

```text
docs/city/POST_CC103_CITY_CLOSEOUT_WORKBOOK.md
```

新增文件限定如下；已有同用途文件就复用并在状态文件记路径，不制造平行系统：

| 文件 | 职责 |
|---|---|
| `docs/research/PAPER_FREEZE_CC103_BUNDLE.md` | 双锚冻结说明；旧测量、当前材料和新增阶段的边界 |
| `docs/city/POST_CC103_CLOSEOUT_STATE.json` | 可覆盖的最新施工 checkpoint；不是历史实验日志 |
| `docs/city/DIGITAL_CITY_EXTRACTION_MAP.md` | 已解耦/待解耦的真实源文件、接口、状态所有者和未来去向 |
| `docs/research/post-cc103/EXPERIMENT_INDEX.csv` | 新阶段实验索引，一行一个实际 run/attempt，不补写虚构实验 |
| `docs/research/post-cc103/evidence/` | 少量可长期保留的原始/规范化 JSON、精简日志、哈希清单 |
| `docs/city/FINAL_ACCEPTANCE_RECORD.md` | 最终机器交付记录与一次真人验收说明；人签字段在真人确认前必须为空/待确认 |

继续使用：

```text
docs/city/OWNER_CONTINUOUS_CONSTRUCTION_LEDGER.md     # 追加关键决策与权限/妥协事件
docs/city/CITY_RENOVATION_DEBT_REGISTER.md           # 真实遗留债务，不创建虚构债务
docs/research/PAPER_EVIDENCE_LEDGER.md               # 原 §A–§W 保留，追加新节
docs/history/BRANCH_ARCHIVE_2026-09-28.md            # 已完成历史，原则上只引用
```

原始完整测试日志写到本轮登记的仓外工作目录或已有 artifact 目录；需要永久保全的部分再明确加入 Git/仓库 release assets，不能把全部调试输出塞进 git。

**注意已知 `.gitignore` 行为：**裸 `history/` 会影响 `docs/history/`。新证据文件先 `git check-ignore -v`、再显式 `git add`、最后 `git ls-files` 验证；仅对确认不含敏感信息的指定文件使用 `git add -f`。不批量 `add -f` 整个临时目录。[S4]

### 恢复状态建议字段

```json
{
  "schema": "boss-post-cc103-closeout/1",
  "status": "IN_PROGRESS",
  "paper_experiment_sha": "bedeb8280f4bdb51e54fbead642775b1a32d16b6",
  "paper_bundle_sha": "8df428eaa437a409368401e95194e40266b83080",
  "branch": "city/phase2-closeout-post-cc103",
  "checkpoint_sha": null,
  "completed_tasks": [],
  "active_task": "T1",
  "next_action": "Verify existing paper tag and establish the material freeze",
  "running_jobs": [],
  "machine_blockers": [],
  "deferred_optional_work": [],
  "human_intervention_count": 0,
  "delegated_owner_action_count": 0
}
```

`null` 表示尚未采集，不是零。恢复时依次读本工程书 §0、状态文件、最近一个相关记录、真实 `git status` 和运行中的 CI；禁止每次把数十万字旧 ledger 全文重新读入上下文。

---

## 6. 冻结与分支策略

### 6.1 双锚冻结

- **F0：旧实验锚点。**原 tag 固定 `bedeb828…`，承载 CC-103 实验及已接受的阶段结论。
- **F1：材料锚点。**新增 bundle tag 固定 `8df428…`，保留 §W、CSV、分支归档和引文桥接。
- **C1：续建阶段。**独立施工分支及 post-CC103 数据；它不能污染或追溯替代 F0。

tag 是本工程约定的不可移动引用，不声称它在 Git 中天然无法被有权限的人改写。保留完整 commit SHA，并从远端核验 annotated tag 的 peeled commit。无现成签名配置时不创建新的人工签名流程。[S10]

### 6.2 主线是否可以继续前进

**冻结靠 F0/F1，不靠永远禁止 main 前进。**所有新代码先在新分支；为复用现有 main-only Root Trust 晋级流程，允许把已验证的完成单元通过 PR 合入 main，再将 main 以保留历史的 merge 同步回施工分支。

这样既满足“在新分支施工”，又不为强行冻结 main 而重写整套认证流程。论文不能再引用浮动 main；新阶段 main 变化不改变 F0/F1。

常规开发禁止直接写 main；如既有治理通道自身损坏，只有现有 Owner 租约授权的最小修复可以走例外，并记录范围、原因和还原操作。运行时/构建已知损坏的代码不晋级到供用户使用的 main。

### 6.3 签发点发生漂移

启动时若 `origin/main != VERIFIED_BUNDLE_SHA`：

1. 原 F0/F1 仍锚定各自既定 SHA，不能悄悄移动。
2. 阅读签发点之后的 diff 与 CI，记录 `ACTUAL_WORK_START_SHA`。
3. 若新增提交已包含合法修复，施工分支从最新健康主线开始，避免丢失他人/其他执行器修改。
4. 若新增提交本身失败，先隔离问题；不得强推旧主线覆盖它。
5. 同名材料 tag 已指向别处时，保留它并选择下一个未占用版本记录冲突，不能强制覆盖。

---

## 7. Digital-City 预重组决策

### 7.1 本轮适合的是仓内边界，不是跨仓拆除

现有严格目标本来就要求去掉基础层反向依赖和能力循环；在这条路径上建立可迁移接口是同一件工作。额外的服务化、远程调用、部署编排和跨仓版本管理不是本轮必要条件。

只实施满足以下条件的预解耦：

```text
存在真实调用方；
能减少本轮实际依赖/循环，或明显缩小后续迁移所需的具体文件集合；
不增加运行进程、真实外部服务或新的跨仓版本依赖；
Boss 当前安装方式、用户入口和主要行为不变；
可用现有测试加少量针对性测试证明；
失败能通过普通 revert 撤回。
```

### 7.2 对齐已登记的未来职责

Digital-City 当前是地图/登记/集成模型，不是 monorepo；其治理和工程提取项仍标为未来任务。[S8]

| 未来归属 | 本轮可准备的内部边界 | 必须留在 Boss/不能做的事 |
|---|---|---|
| `00/01` City Core | 保持运行信任、身份、全局任务所有权、通用持久化原语清楚 | 不把业务实现塞入 Core 来消掉边数；不复制 Root Trust |
| `00/02` Node Fabric | 对现有节点身份、成员关系、存活/资源信息抽出窄接口；只在相关依赖确实涉及它时修改 | 不新增 City 网络、远程发现协议、端口服务或第二份节点数据库 |
| `00/03` Capability Fabric | 分离能力声明/注册/查询接口与具体业务实现 | 注册/发现不是无限权限 service locator；不再造插件平台 |
| `00/04` City Roads | 类型、DTO、稳定语义契约、必要的纯验证函数 | 不做常驻道路服务；不把业务实现和私有状态搬进 shared/roads |
| `00/05` Control Centre | 将已有 UI 读取的展示模型与业务变更接口分开 | 不建设 Dashboard；General-Logic-Engine 不是全城权限源 |
| `01/01` Customs Security | 分离准入声明校验和加载前检查 | 不包含 Root Trust、运行时执法或业务质量判断 |
| `01/02` Runtime Compliance | 将执行时的通用权限决策应用/审计结果与业务逻辑隔离 | 事实由 Core 提供，不建立第二套 Owner/授权真相 |
| `02/01` Hns Project Foreman | 分离普通工程验收、测试选择、恢复/重试、结果验证的纯逻辑及适配接口 | Boss 保留本地实现；本轮不移入 DS-Hns，不要求安装 Hns |

**调度层级保持：**Boss/Core 管全局任务登记、跨域所有权和权限；Hns 未来管工程任务分解、施工监督和验证；provider 只执行分配的子任务。不能在预拆中把这些职责混成多个总调度器。[S8]

### 7.3 首选核对的既有代码表面

以下是现有登记与已知路径，不是“一律搬走”的清单。执行器逐个验证存在性、真实 import 和调用关系，实际文件不相关就跳过，不按记忆批量修改：

```text
electron/bootstrap/persistence.ts
electron/bootstrap/host-status-ipc.ts

electron/security/permission-manifest.ts
electron/capability/plugin-contract.ts
electron/capability/permission-contract.ts
electron/capability/authorization.ts
electron/commander/execution-gate.ts
electron/commander/runtime-policy.ts

electron/engineering/goal-acceptance.ts
electron/engineering/verification-policy.ts
electron/engineering/acceptance-session.ts
electron/engineering/final-acceptance-gate.ts

config/city-replacement-lifecycle.json
src/shared/
```

优先顺序：**直接参与 kernel 反向依赖的组合/状态入口 → 循环组中的工程验收边界 → 准入与执法分界 → 其余可选项。**不得为了预拆把全仓所有功能拆一遍。

### 7.4 接口放置规则

消费者只依赖其真正需要的窄契约，具体实现留在原能力内，由明确的应用组合入口注入。沿用仓库已经存在的共享契约/road 位置，只有没有合理位置时才新建局部文件。

```text
纯契约/DTO          不 import Electron、renderer、具体业务实现或私有存储
业务实现            实现契约，拥有自己的状态
组合入口            绑定契约与实现；真实接线关系仍进入架构测量/登记
UI / 调用方         经契约调用，不绕过所有者读写私有文件
```

不得以 `import type`、动态 import、回调字典或统一 event bus 隐藏真实运行时承重依赖。组合入口可以有真实接线，但必须依原规格显式分类、被测量且无业务逻辑，不能把整个 kernel 标成 composition root。

---

## 8. 数据保存与后续论文使用协议

### 8.1 数据三分，不向旧阶段倒灌新结果

```text
CC103_ORIGINAL             既有实验与失败，锚定 F0
CC103_RETROSPECTIVE_INDEX  在 F1 上抽取/整理的旧数据，明确不是新实验
POST_CC103_CONTINUATION    本轮新增运行、迁移和验证，独立 cohort
```

旧 CSV 和旧 ledger §A–§W 原文保留。纠错以追加记录指向旧项；新阶段数据写新目录。论文正文仍由既有论文仓库/流程维护，本轮不自动修改 Essay-Book 或 DS-Hns-H，不把 Boss 工程数据混入 Hns 已冻结的实验结果。

### 8.2 最小实验索引字段

`EXPERIMENT_INDEX.csv` 每一行表示一个实际运行 attempt；字段固定为：

```text
experiment_id,cohort,stage,task_id,subject_sha,instrument_sha,
input_or_fixture_hash,run_id,run_attempt,job_id,host_alias,
started_at_utc,finished_at_utc,command,outcome,exit_code,
raw_evidence_ref,raw_evidence_sha256,comparison_group,
human_interventions,delegated_owner_actions,claim_scope,notes
```

没有 hosted run 的本地运行将 run/job 字段置空，并写 `LOCAL`。发生权限代行时单独计数；不把代行次数写成真人次数。缺失的耗时/成本/token 不填零，不臆测数值。

每个结构迁移 checkpoint 的 JSON 至少保留：

```text
subject_sha, instrument_sha, schema_version, included_source_count,
capability_node_count, kernel_to_feature_file_edges,
kernel_to_feature_distinct_pairs, mutual_capability_pairs,
largest_scc_size, migration_in_progress, private_state_accesses,
multi_writer_candidates, roads_outgoing_edges,
core_measured_size, core_budget_result, root_epoch, raw_report_refs
```

指标单位与检测器含义不变。`multi_writer_candidates = 0` 不能被写成已经证明所有运行时并发写入都不存在。

### 8.3 每个有论文价值的变更只记录这些内容

在原 paper ledger 新增“Post-CC103 continuation”节或下一个未使用节号：

```text
问题/假设；具体改动；改前证据；改后证据；
失败或反例；是否保持行为；能支持的结论；不能支持的结论；
代码 SHA、instrument SHA、run/attempt、原始数据引用。
```

普通排版修正、重复成功日志和无新信息的小提交，不必单独成为论文 finding。

### 8.4 可复用证据，但不能越权证明

允许记录同一证据对其他阶段的补充作用，例如边界验证同时支持替换生命周期或权限路径诊断。为此在 `notes` 或对应 finding 加：

```text
source_stage / target_claim / reuse_relation
applicability_conditions / invalidation_conditions
relation = SUPPORT | REFUTE | DIAGNOSTIC | NOT_APPLICABLE
```

复用必须说明相同的代码/契约/输入条件；变更触及相关路径时旧证据失效或降为历史支持。**不能用修改后的系统通过测试，倒推历史有缺陷版本也通过。**同一运行支持多个论点不等于新增多个独立样本；同 SHA 重跑不是新的独立实验。

### 8.5 保全什么，不无限备份什么

必须保全 F0/F1 引用、已有关键负对照、CC-103 两个 attempt、各迁移 checkpoint 的原始结构 JSON、真实回归/修复的必要日志、最终 exact-SHA hosted 证明、迁移/回滚的必要运行证据。

Git 标签只保留 Git 对象，不能代替 CI 日志/artifact 备份；Actions 证据受保留期影响。保存筛选后的原始证据到受版本管理的小文件或本仓现有可访问的长期附件位置，附 SHA-256。完整大日志只归档有研究价值的运行，不新建云平台，不下载全历史。[S11]

对敏感日志先产生安全版本并明确记录脱敏范围；不得把 token、登录 cookie、私人聊天、主机用户目录等发布到公开仓。无法安全保留的字段记录原因，而非悄悄改成有利结果。

---

## 9. 测试与 CI 非阻塞策略

### 9.1 三层测试，不每改一行都跑全库

| 层级 | 触发 | 内容 |
|---|---|---|
| L1 受影响验证 | 每个语义改造单元 | 针对性单元/契约/集成测试；相关 TypeScript 检查；受影响结构指标 |
| L2 集成 checkpoint | 完成一个可独立验收的边界或阶段 | 相关跨模块测试、构建、完整结构报告；必要的 test:postbuild/test:slow |
| L3 最终验收 | 最终候选/最终 main | 既定全量 CI，五项 hosted checks；本轮真实运行/替换/恢复证明 |

沿用 `test:impact` 等现有测试选择机制；无法证明筛选完整时，扩大到相关 suite，而不是开发新的选择器。已有 suite 没覆盖的新不变量补一个对应测试。

### 9.2 不干等，也不在测试过程中修改被测树

启动耗时任务前记录 `subject_sha`、工作目录、命令、进程/CI run ID、日志位置。测试使用固定提交的隔离 worktree 或冻结副本。测试期间继续另一独立 worktree 中的代码、迁移地图、证据整理；不能让后台测试读取不断变化的当前目录。

同一工作树不允许两个写入型施工者。默认最多一个重型全量测试/打包进程；其他工作可轻量并行，按主机实际负载调整，不为并行堆满内存。

没有独立工作时允许合理等待正在推进的测试，不制造“为了不等而新增工作”的任务。只有日志、进程、输出等均显示停止进展时才按实际卡死处理；不能因单纯耗时长就杀掉正常测试。

### 9.3 红灯处理

| 分类 | 处理 | 最终可否带入 |
|---|---|---|
| 预先声明的负对照 | 记录实际失败为负对照证据；不改实验让它绿 | 可保留证据，不能冒充产品测试成功 |
| 已知且指纹吻合的 flake | 保留首次失败；同 SHA 至多一次有依据重跑；仍失败则定位修复/换真实可比验证路径 | 最终五项仍须成功；旧失败保留 |
| 本轮真实代码回归 | 先最小复现再修复；并行继续无依赖事项 | 不可留下未解决回归 |
| gate/治理缺陷 | 保留前后语义，最小修复；必要时用已授权 Owner 过渡操作 | 临时放宽必须撤回 |
| 未解释失败 | 记录 UNKNOWN，隔离受影响单元，不把它叫 flake | 不可认证对应保证 |

不得在同 SHA 上不断点击重跑直到绿。GitHub 的重跑仍使用原事件的 SHA/ref，索引必须记录 attempt；若改了源码，这是新的 subject SHA。[S12]

### 9.4 中途允许未达到严格目标，不允许伪造最终达标

S2/S3/S4 等在逐步迁移期间可保持 OPEN。它们不是“看到红灯就停止”的理由。用当前 ratchet 防倒退，同时持续降低真实耦合；最终仍必须到严格目标。

可以阶段性调整真实变小后的受控 baseline，但不能只按总数抵扣一条新坏边，也不能为绿色 CI 无声扩大祖父条款。信任表面变化则依现有正规 ceremony 前进，不手写旧 epoch 值。

---

# 10. 任务 1（T1）：冻结 F0/F1，建立施工分支

**涉及文件：**新增冻结说明、本工程书、状态文件。**不得修改：**任何旧实验代码、旧 tag、旧证据行。

- [ ] 核验远端仓库身份、当前 main、已有 tag 的 peeled commit、当前工作树；读取现有 `AGENTS.md` / 工程命令约定。
- [ ] 原实验 tag 必须解析到 `bedeb828…`。若不匹配，保留实际值与冲突，不覆盖 tag；通过真实 commit 和现有归档定位原对象。
- [ ] 核验 `8df428…` 存在，并阅读签发点后的实际改动（如有）。
- [ ] 创建或核验 `boss-paper-cc103-bundle-20260928-v1` → `8df428…`；annotation 明确是材料承载点，不是新实验验收。
- [ ] 推送新增 tag，使用 `git ls-remote` 验证 peeled commit；本地创建成功不等于远端已冻结。
- [ ] 从实际健康施工基线建立/恢复 `city/phase2-closeout-post-cc103`；保留现有未提交工作，不执行 reset/clean 清除它。
- [ ] 提交冻结说明、工程书和初始状态；推送新分支。普通初始化不跑全部历史测试。

**核心只读核验命令（PowerShell 示例）：**

```powershell
git fetch origin --prune --tags
git status --short
git rev-parse origin/main
git rev-parse 'boss-city-cc103-paper-snapshot-v1^{commit}'
git cat-file -t 8df428eaa437a409368401e95194e40266b83080
git ls-remote --tags origin 'refs/tags/boss-city-cc103-paper-snapshot-v1*'
git ls-remote --tags origin 'refs/tags/boss-paper-cc103-bundle-20260928-v1*'
```

每条外部命令检查实际 exit code；fetch 失败时不使用旧缓存冒称最新远端。

仅在目标名确实不存在且没有冲突时执行：

```powershell
git tag -a boss-paper-cc103-bundle-20260928-v1 8df428eaa437a409368401e95194e40266b83080 -m 'CC-103 paper material carrier freeze; experiment remains bedeb828; strict full city NOT_READY; no new experimental acceptance.'
git push origin refs/tags/boss-paper-cc103-bundle-20260928-v1
git ls-remote --tags origin 'refs/tags/boss-paper-cc103-bundle-20260928-v1*'
```

这里验证的是 tag 解析和远端对象，不是对 unsigned tag 执行要求签名的 `git tag -v`。[S10]

**完成产物：**F0/F1 可远端解析；施工分支已推送；冻结说明列出旧 code SHA、材料 SHA、真正 start SHA 与旧/新数据边界。

---

# 11. 任务 2（T2）：只测一次启动基线，列出剩余工作

**输入：**T1 的实际施工基线。**输出：**可检查的初始结构 JSON、明确的剩余目标、真实代码路径和调用边清单。

- [ ] 阅读严格验收器及本次真正用到的检测器；不要从 README 的旧测试数推断当前状态。
- [ ] 在固定且干净的基线上运行一次结构测量，归档原始输出和测量器版本。
- [ ] 将 `OPEN` 分成“真实结构改造”“缺少 hosted 查询”“最终记录/人工证明”三类，不把后两类变成新架构工程。
- [ ] 列出每一条仍在的 kernel → feature 边、循环组和实际 state owner，按语义闭包组织任务，不按文件大小拆。
- [ ] 对比 F0 记录与实际起点；只有确有变化才解释差异。记录模型/扫描范围，避免混口径。
- [ ] 读取 Digital-City 的实际 main SHA，再按该 SHA 读取 `CITY_MANIFEST.yaml`；在迁移地图记录源 commit 与 schema。若登记没有实质变化，沿用本书映射；如有变化，保持本轮仓内解耦范围，不自动扩成跨仓施工。
- [ ] 建立受影响测试映射、现有主要用户入口清单和迁移地图初稿。

**已核验存在的命令：**

```powershell
node scripts/p2b-kernel-feature-ratchet.cjs --json
node scripts/phase2-private-state.cjs --json
node scripts/capability-roads-validator.cjs --json
node scripts/city-flatness-validator.cjs --json
node scripts/principle-enforcement-validator.cjs --json
node scripts/bridge-expiry-validator.cjs --json
node scripts/capability-closure-validator.cjs --json
node scripts/core-budget-validator.cjs --json
node scripts/city-ledger-provenance.cjs --json
node scripts/acceptance-evolution-bless.cjs --check
node scripts/city-final-acceptance.cjs --json
```

正式执行时用命令封装捕获 stdout、stderr、exit code，避免在文档中粘贴重定向把错误覆盖成 JSON。输出写入本轮登记的仓外目录，以免 final tree 因日志变脏。

`city-final-acceptance.cjs` 的 report 模式即使 NOT_READY 也可以 exit 0；判断读 JSON 中 `ready/items`，不能拿进程零退出当验收通过。[S9]

**完成条件：**每项后续必做工作都对应一个真实不通过项或已复现回归；没有“也许以后会有问题”的新增 blocker。

---

# 12. 任务 3（T3）：消除 kernel → feature 反向依赖

**主要文件：**T2 输出中确实存在的反向依赖源文件及对应能力实现；优先核对 `electron/bootstrap/`。同步修改实际受影响的 manifest/所有权/road 声明，不能使用第二套映射。

**接口契约：**每个迁移单元在迁移地图写出真实符号名、参数/返回值、异步/错误语义、状态所有者、注入位置；没有真实调用方的接口不创建。

每个语义单元依次完成：

- [ ] 写出当前行为及最小测试：初始化顺序、查询返回、实际状态变更、异常传播，选择本边界真实涉及的项目，不强制每单元重测全套。
- [ ] 对已有缺陷先证明测试在旧实现失败；纯重构先记录旧实现通过的 characterization test。
- [ ] 将所需契约放到合理的既有 shared/road 边界，将实现留在所属能力；通过明确组合入口注入。
- [ ] 消除真实反向 import/私有路径访问，不用隐藏调用代替显式依赖。
- [ ] 运行相关测试、类型检查和 p2b/closure 量测；结果与前一 checkpoint 比较。
- [ ] 提交“一个可独立验收的边界”，记录前后依赖和行为证据，推送后继续下个单元。

**必须覆盖的典型风险：**组合入口重新分类后不执行业务逻辑；启动缺少可选 provider 时不会拖垮 Boss；只读 read-model 不悄悄成为第二个写入者。现有测试已覆盖就引用，不重复造测试。

**完成条件：**kernel → feature 文件边与 distinct pairs 都到 0；扫描完整，真实接线仍有记录；相关用户路径功能不减；Core 没被塞入业务实现来“清零”。

---

# 13. 任务 4（T4）：打断真实能力循环，并完成工程边界预解耦

**主要文件：**T2 中最大循环组内、实际承担双向引用的文件。优先处理同时影响普通工程验收和全局状态/权限的边界。

- [ ] 按互相引用的语义原因分组：类型共享、状态越界、调用逆向、回调/生命周期接线、错误能力划分。
- [ ] 先处理一条改动可打断多个循环且能独立验证的边；不要对整个 SCC 一次性重写。
- [ ] 选最小办法：纯 DTO/契约、单向调用、窄 query/command 端口、已有事件、明确的组合绑定。
- [ ] 若涉及 `goal-acceptance.ts` / `verification-policy.ts` 等，只抽出普通工程逻辑；Root Trust、全城任务权属和正式 qualification 留原所有者。
- [ ] Boss 的默认本地实现继续接入新接口，不引入 Hns 网络/API/安装依赖。
- [ ] 每个单元跑受影响行为测试和完整能力图；归档 mutual pairs、SCC 大小、节点数、扫描文件数。
- [ ] 临时兼容层写具体退出条件；完成迁移后清除非必要双路径，不能让兼容层成为永久绕路。
- [ ] 普通提交、推送；必要时走既有受控晋级，再回到施工分支继续。

**不能作为成功：**只消掉 2-cycle 而仍有 3 个以上节点的循环；只减少节点数；把业务功能合并进 shared；用动态加载逃过静态图。

**完成条件：**mutual pairs = 0，最大 SCC ≤ 1，原调用行为仍成立，能力所有权真实。迁移地图至少说明工程逻辑中已分开的部分；没有必要的可选部分标 `DEFERRED` 即可。

---

# 14. 任务 5（T5）：收口状态、生命周期与剩余严格原则

T3/T4 已完成的保证不重复施工；本任务只处理仍缺少的具体证据和残留状态。

- [ ] 对每个 `MIGRATION_IN_PROGRESS` 读取来源/目标/退出条件；实际完成并验证后改为其真实稳定状态，不能只改字符串。
- [ ] 确认跨域私有状态访问、多写者候选、road 反向依赖、unsafe gap、过期 bridge 维持 0。
- [ ] 补齐替换生命周期所需的真实受控运行/真实主机 replay 证据；已有等价证据仍覆盖未改路径时直接引用并说明范围。
- [ ] 本轮边界实际改变时，选择一个真实调用路径完成“旧实现 → 新实现 → 有效使用 → 回滚 → 恢复新实现”的有界验证；使用独立测试数据，不动真实用户工作任务。
- [ ] 验证关闭并重启应用后关键任务/状态可读取；不把程序重启证明写成主机重启、断电恢复或 24h 稳定性证明。
- [ ] 当 S2/S3/S4 达到目标，更新原则矩阵相应证据与 guard 身份；不得仅把 `MACHINE_RATCHET` 文本改名。
- [ ] 遇到 Root Trust Surface 改动，按现有 exact-SHA ceremony 完成新 epoch；不手改 accepted baseline 使其掩盖新债。
- [ ] 检查旧债务和本轮新增债务；旧已接受的非阻塞事项不无故重开。必须满足严格结构目标的新失败不许用 `ACCEPTED_PERMANENT` 消掉。

**验收测试必须覆盖：**实际迁移与可执行回滚；状态读写所有权；重新启动后的既有状态可读；15.1/15.7 的真实严格行为。复用现有 lifecycle/恢复测试，不扩展成每个模块×每个故障的笛卡尔积。

---

# 15. 任务 6（T6）：完成两个以内的可选预拆，并写迁移地图

本任务的默认动作是**总结 T3–T5 已经得到的边界**。仅当仍有明显低成本收益，才实施额外试点。

- [ ] 对照 Digital-City 00/01/02 的现有登记，记录每个候选的状态：`ALREADY_SEPARATED` / `IN_REPO_READY` / `DEFERRED` / `NOT_APPLICABLE`。
- [ ] 至多选择两个额外语义边界；优先纯准入校验与运行时执法分离，或可单独测的工程验收逻辑。没有合适候选就做零个。
- [ ] 先验证 Boss 的现有默认路径，再做窄接口分离；不改用户使用方式、不依赖新服务。
- [ ] 额外试点连续出现两次无进展回归/需要扩展成跨域重写时，普通 revert 该可选改造，保留失败证据，状态写 DEFERRED。
- [ ] 将最终源文件和契约清单写到迁移地图，不把“接口已分开”写成“独立服务已落地”。

每个模块地图条目使用：

```text
module / future_city_slot / present_owner
status / concrete_source_files / public_symbols
state_owned / state_not_owned / external_dependencies
host_adapter_or_composition_root / present_consumers
existing_tests / preservation_evidence
future_move_steps / explicit_non_goals / unresolved_dependencies
```

**完成条件：**后续迁移者能知道“搬哪些文件、依赖什么、状态归谁、Boss 怎样继续本地调用、需要哪些测试”。不要求独立发布、独立安装、独立部署或实际改动 Digital-City 仓库。

---

# 16. 任务 7（T7）：集成、最终 exact-SHA 机器验收

### 16.1 先收代码和记录，再固定最终被测提交

- [ ] 完成必须的运行时/结构改动、回归测试、迁移地图和冻结说明。
- [ ] `FINAL_ACCEPTANCE_RECORD.md` 先写机器交付模板；清楚标 `OWNER_ACCEPTANCE = PENDING`，放入最后一次源码/文档提交。
- [ ] 模板引用“待建立的最终机器验收 tag”，不要试图把包含它自身的 commit SHA 预写进同一 commit。
- [ ] 所有已完成单元通过保留历史的 PR/merge 集成；Trust ceremony 若为 main-only，使用既有授权链完成，不另造 branch 认证体系。
- [ ] 获取最终 main SHA，在独立干净 checkout/worktree 执行验证；同一时刻不能继续改这个被测树。

### 16.2 必需最终验证

以实际 CI 工作流为主，下面的本地调用序列是可用命令，不要求已由同 SHA、同输入、同环境充分覆盖的工作无条件重复一遍：

```powershell
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run build
pnpm run test:postbuild
pnpm run test:slow
pnpm run security:scan
pnpm run architecture:ratchet
pnpm run architecture:enforce
node scripts/acceptance-evolution-bless.cjs --check
```

另执行 T2 列出的结构验证器和 T5 实际运行证明。平台/打包测试沿用现有 CI 的真实命令，不凭空使用不存在的 `lint`、`test:city` 或新命令。

最终 remote 必须在该 main SHA 上产生：

```text
quality       completed/success
unit          completed/success
acceptance    completed/success
package       completed/success
architecture  completed/success
```

核验 check name、`head_sha`、run ID、attempt、事件类型、完成状态以及实际 checkout SHA（工作流可提供时）。不要拿 PR merge-ref 的成功冒充最终 main 的成功；也不要把任意旧 attempt 的五个绿灯随意拼成一份不存在的最终通过运行。

对“仅失败 job 重跑”可以继承同一 workflow run、同一 SHA 的未变成功 job，但必须保存每个 job 的实际 attempt/来源，并完整展示失败→重跑的轨迹。最终 main 若又有修复提交，使用新 SHA 重验相关部分与最终 hosted 五项。

### 16.3 复用现有严格 gate，但不提前使用 `--attest`

```powershell
$FinalSha = (git rev-parse HEAD).Trim()
node scripts/city-final-acceptance.cjs --json --hosted "--main-sha=$FinalSha"
node scripts/city-final-acceptance.cjs --seal --hosted "--main-sha=$FinalSha"
```

验收前先检查 `$FinalSha == origin/main`，并确认真实 tree clean。第二条 `--seal` 在仅剩真人证明时可以非零；记录实际结果，不把它修成假绿。

**机器就绪判定：**

```text
所有 GOVERNANCE、STRUCTURE、FINAL_MAIN 项：PASS
E2、E3、E5：PASS
E1、E4：允许保持 UNVERIFIED，但只能是完整性/历史保全的真人证明边界
其余 OPEN 或 UNVERIFIED：0
```

`E5` 的存在性通过不代表已签字。最终记录必须显式写“机器结果已准备、真人未确认”。E1/E4 先由执行器完成本轮可验证的日志对账、tag/归档可达性、旧证据前缀/对象核验，列出范围与例外，不声称机器能证明绝对完整性。

**特别禁止：**当前 `--attest` 逻辑会在最终记录存在时放行 UNVERIFIED。不能在真人验收前使用它掩盖未读取 ruleset、无 hosted evidence、SHA 不明或未经确认的 E1/E4。不要为绕过此边界修改 strict gate。[S9]

报告双状态：

```text
CITY_MACHINE_ACCEPTANCE = READY
STRICT_STRUCTURAL_TARGETS = MET
STRICT_GATE_RAW_STATUS = 真实结果（通常仅 E1/E4 导致 NOT_READY）
OWNER_ACCEPTANCE = PENDING
FINAL_STATUS = READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE
```

这不是新的宽松 CC-103 profile：所有原严格结构条件都必须已满足，只保留真实的人类证明边界。

### 16.4 不增加自指提交循环

验证完成后，用新增 annotated tag 固定最终 main，例如 `boss-city-machine-ready-post-cc103-v1`；同名冲突则递增，不移动旧 tag。

最终 SHA、run/attempt、artifact/hash 写到绑定该 tag 的外部交付清单、PR comment 或现有 release 附件；不要为了把“最终 SHA”写进同一文件而无限新增文档提交，再重跑全部 CI。

仓内最终记录可以在提交时引用该稳定 tag 名；创建 tag 后验证它解析到真正受测 SHA。若提交后又改了功能代码，旧 tag 仍保留，产生新的候选与真实验证，不能移动它。

---

# 17. 任务 8（T8）：清理本轮施工面，交付一次真人验收

- [ ] 验证 F0/F1 的远端 peeled SHA 未变，旧论文 ledger §A–§W 保留；新内容独立追加。
- [ ] 验证新阶段索引引用的关键证据真正可访问且 hash 匹配；不接受只有本地临时路径的论文核心证据。
- [ ] 归还本轮临时 governance 例外和运行时权限；记录本次自动施工租约已停止自动变更。
- [ ] 归档/删除本轮已经完成的短期分支；未合并且含独有有价值提交的 tip 先保全，再清理；保留 main 和仍有实际用途的分支。
- [ ] 不重新扫描或恢复全部旧分支；引用已有归档表。不能删尚有 open PR/其他执行者使用的分支。
- [ ] 删除仅由本任务创建且已经不需要的临时文件/工作树；以登记清单为界，不能执行全盘清理、删除用户缓存/真实工作数据或 `git clean -xfd`。
- [ ] 生成最终交付报告，只留下以下单次真人流程。

## 一次真人验收脚本

**执行器提前准备：**已构建/打包的程序、专用演示 workspace、无私密数据的测试任务、明确入口、已测的新旧行为对照、最终机器证据和剩余限制。不能让 Owner 先安装环境、解决权限或复制长命令。

**Owner 仅做同一会话内三项观察：**

1. 打开交付的 Boss，确认主界面和现有主要入口正常、没有权限提示循环或明显卡死。
2. 执行一条本地、无费用、可重复的工程演示任务；查看任务状态、结果与证据。需要重新启动演示时，由已准备的流程完成，不要求真人重做所有自动恢复实验。
3. 阅读机器验收摘要和明确限制，提交一次“接受”或一次具体不符合项。

此体验检查不声称覆盖所有真实 provider、网络或多设备情况。此前没有被本轮改变且已有有效证明的部分，不重新要求真人一项项点击。

真人确认前只能：

```text
READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE
```

真人确认后才能记录准确的确认时间、确认对象 SHA/tag 与原话/链接，再按原契约办理最终正式 seal。未发生的动作保持 `PENDING`，不能预填 `ACCEPTED`。

---

## 18. 施工循环：持续推进，但不虚构无限执行能力

```text
读取固定契约 + 最新状态 + 真实 Git/运行中 job
    ↓
选择一个能关闭真实缺口的最小语义单元
    ↓
最小复现/特征测试 → 最小修改 → 受影响测试/结构量测
    ↓
记录结果、普通 commit、push
    ↓
耗时 CI 在固定 SHA 运行；同时做独立工作
    ↓
处理真实失败或受控权限动作，不等待新的 Owner 指示
    ↓
达到全部机器终态后立即收口，不继续挖可选工作
```

上下文压缩/会话续接前更新状态和可恢复 checkpoint：进行到哪、真实 SHA、哪些任务完成、哪些 job 还在跑、失败原文引用、下一条具体动作。能继续运行的执行环境就继续；环境实际强制终止时推送可恢复 checkpoint，不能声称已经到达终态，也不能承诺平台并不具备的后台续跑能力。

旧 `256 rounds`、聊天篇幅或“这一轮完成了几个 PR”都不是成功条件；真正的外部执行限制也不能被文本指令消除。

---

## 19. 必须在本轮覆盖、但不扩展成新项目的五个风险点

| 输入/情形 | 用户应得到的行为 | 负责任务 |
|---|---|---|
| 启动时 main 已前进、tag 已存在 | 不覆盖历史、不丢新提交；保留正确双锚并从真实基线续建 | T1 |
| composition/接口改动导致启动顺序或可选能力缺失 | Boss 仍可独立启动，错误清晰，不把整个产品拖垮 | T3 |
| 循环经动态调用“消失”，实际承重依赖还在 | 真实调用与声明一致；不是 scanner 数字游戏 | T4 |
| 迁移后旧状态或回滚路径失效 | 单一写入所有者，真实有界迁移、回滚、重启证明 | T5 |
| 缺失 CI/Owner 证据被 `--attest` 放行 | 缺证据仍缺证据；先全部机器条件满足，再留一次真人确认 | T7 |

不要为这张表建立第六套监督服务。把对应断言加入负责任务的现有测试/核验步骤即可。

---

## 20. 最终汇报模板

所有字段填真实值；未发生用 `NOT_PERFORMED`，缺失用 `UNVERIFIED`。以下模板中的说明必须替换为结果，不能原样当验收报告。

```text
FINAL_STATUS = READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE

PAPER
  experiment_tag / experiment_sha
  bundle_tag / bundle_sha
  old_records_unchanged
  original_failure_and_retry_preserved
  post_freeze_cohort_location

GIT
  work_start_sha
  final_main_sha
  final_machine_ready_tag
  merged_prs
  active_branches_remaining
  archived_unique_tips

STRUCTURE
  kernel_to_feature_file_edges = measured value (target 0)
  kernel_to_feature_pairs = measured value (target 0)
  mutual_capability_pairs = measured value (target 0)
  largest_scc_size = measured value (target <= 1)
  migration_in_progress = measured value (target 0)
  private_state_accesses / multi_writer_candidates / road_outgoing
  unsafe_gaps / expired_bridges
  machine_ratchet_principles / not_guarded_principles
  core_budget_result

VERIFICATION
  local_targeted_results
  real_runtime_and_replacement_evidence
  root_trust_epoch / MATCHES
  final_hosted_run_id
  per_job_name / job_id / subject_sha / attempt / conclusion
  strict_gate_raw_status
  remaining_unverified_ids_and_reasons

PRE_EXTRACTION
  completed_in_repo_boundaries
  unchanged_boss_default_runtime
  deferred_optional_boundaries_and_reasons
  extraction_map_path
  new_services = 0
  cross_repo_runtime_dependencies_added = 0

EVIDENCE_AND_AUTHORITY
  experiment_index_path
  durable_raw_evidence_locations
  preserved_failures / corrections / reverts
  human_intervention_count_during_construction
  delegated_owner_action_count
  temporary_governance_changes_restored
  autonomous_mutation_lease_closed_pending_owner_acceptance

OWNER
  remaining_session = one
  exact_program_entry
  exact_demo_workspace_and_task
  acceptance_target_sha_or_tag
  acceptance = PENDING
```

没有全部满足机器条件时，不使用上面的成功终态。汇报真实未完成原因和可恢复状态，不能拿“工程书允许不停工”解释虚假通过。

---

## 21. 收工优先级

```text
第一：已有论文证据不被污染，历史和真实失败不丢。
第二：Boss 完整可运行，既定严格城市化机器条件达标。
第三：本轮开发/实验数据可追溯并可供后续论文使用。
第四：在前面三项不受损的前提下，为 Digital-City 留好内部接口。
第五：外观、全仓整洁、全面抽象、跨仓服务化全部后置。
```

达到第三项并完成必要的迁移地图后，不因第四/第五项有更多可做的事情延迟交付。**本轮最优结果不是更多门禁或更多代码，而是严格目标真的满足、Boss 仍好用、证据留住，最后只让 Owner 看一次。**

---

## 22. 核验来源与参考

以下仓库事实是在签发时通过 GitHub 读取的；执行时仍须核验真实远端。链接使用固定 SHA，除标明的 Digital-City 登记和官方文档外，不使用浮动 main 作为论文证据。

- **[S1] Boss 签发主线：** `https://api.github.com/repos/zhiheng-zhang-Mera/Codex-Boss/branches/main`；签发读取值 `8df428eaa437a409368401e95194e40266b83080`。
- **[S2] 当前主线五项 check：** `https://api.github.com/repos/zhiheng-zhang-Mera/Codex-Boss/commits/8df428eaa437a409368401e95194e40266b83080/check-runs`；run `36371964312`。
- **[S3] 已有论文 tag：** `https://api.github.com/repos/zhiheng-zhang-Mera/Codex-Boss/git/ref/tags/boss-city-cc103-paper-snapshot-v1`；annotated tag 对象 `f0973b59a3b298b68c0b652785719aa71917b9b4`，peeled commit `bedeb8280f4bdb51e54fbead642775b1a32d16b6`。
- **[S4] 历史归档与论文冻结 PR #141：** `https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/141`；已合并，merge `9156f17f909b254984697c5be355ddf6a3e06e65`。
- **[S5] 引文桥接 PR #142：** `https://github.com/zhiheng-zhang-Mera/Codex-Boss/pull/142`；已合并，merge `8df428eaa437a409368401e95194e40266b83080`。
- **[S6] 旧最小验收记录：** `https://github.com/zhiheng-zhang-Mera/Codex-Boss/blob/8df428eaa437a409368401e95194e40266b83080/docs/city/MINIMUM_HUMAN_ACCEPTANCE_RECORD.md`。
- **[S7] 既有 Owner 施工授权及 Phase 2 标准：** `https://github.com/zhiheng-zhang-Mera/Codex-Boss/blob/8df428eaa437a409368401e95194e40266b83080/docs/city/OWNER_CONTINUOUS_CONSTRUCTION_WORKBOOK.md`；`https://github.com/zhiheng-zhang-Mera/Codex-Boss/blob/8df428eaa437a409368401e95194e40266b83080/docs/city/PHASE2_ARCHITECTURE_MIGRATION_ACCEPTANCE.md`。
- **[S8] Digital-City 当前登记：** `https://github.com/zhiheng-zhang-Mera/Digital-City/blob/main/CITY_MANIFEST.yaml`，签发读取 schema `0.8`；本轮 T2 应记录实际读取 commit，后续引用固定该 SHA，不把未来登记变化倒灌本轮。
- **[S9] 严格/最小验收器和真实命令：** `https://github.com/zhiheng-zhang-Mera/Codex-Boss/blob/8df428eaa437a409368401e95194e40266b83080/scripts/city-final-acceptance.cjs`；同提交 `scripts/city-minimum-human-acceptance.cjs` 与 `package.json`。
- **[S10] Git annotated tag / re-tag 文档：** `https://git-scm.com/docs/git-tag`。
- **[S11] GitHub Actions 证据下载和保留说明：** `https://docs.github.com/en/actions/how-tos/manage-workflow-runs`；`https://docs.github.com/en/organizations/managing-organization-settings/configuring-the-retention-period-for-github-actions-artifacts-and-logs-in-your-organization`。具体仓库保留策略以实际设置为准，不假设所有日志永久存在。
- **[S12] GitHub 重跑规则：** `https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs`；重跑的 SHA/ref 与初始事件一致，不能把 retries 当作独立新版本实验。

---

**执行到 `READY_FOR_SINGLE_OWNER_CITY_ACCEPTANCE` 为止。此前不因已授权的权限门、CI 排队、可修复红灯或可选预拆延期而要求人工介入；此后不继续追加施工项目。**
