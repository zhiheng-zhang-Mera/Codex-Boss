# P0-7 Qwen Computer-Use Recovery — Live 轮执行计划

> 目的：把 Round-15 确定性阶段之后剩余的 live 项做成**机械可执行**，
> 使一次专属 live 会话能产出 Qwen repair 的确定性证据。
> 背景事实（诚实记录）：Qwen 账户已登录（分区 `codex-boss-qwen`）；发送控件未被
> 现有 adapter 解析（evidence/live/live-finding-qwen-*）；模型无图像输入（vision 不可用，
> 因此走 **DOM 层**而非视觉层）。

## 前置
- Boss 源码在 `owner-result`（已与 `main` 同步），DS-Hns 不动。
- 本仓库本地执行环境保留真实会话缓存：
  - Provider 分区：`.cache/browser-profile/Partitions/codex-boss-qwen`（+ chatgpt/gemini/deepseek…）
  - 启动数据目录：既有 live 轮用相同 `runtime-data`（保留持久登录）；必要时
    `--boss-data-dir=<dir>` 隔离。
- 已有代码资产（无需重写，live 直接调用）：
  - `src/shared/computer-recovery.ts` —— §26 分类 + 修复计划 + §29 权限门 + §25 事后条件；
  - `electron/computer/provider-page-repair.ts` —— DOM 层执行器（resolver 需按 Qwen 页面提供映射）；
  - `src/shared/self-healing-battery.ts` —— SEND_MECHANISM_CHANGED → CU 计划路由；
  - `src/shared/decision-ledger.ts` + store —— repair 决策留痕；
  - `electron/provider-automation.ts` / adapters（qwen）—— send 失败点（PAGE_CHANGED/
    enter-did-not-submit/未可靠定位发送按钮）。

## 步骤（live 会话内执行，每步落证据 JSON）
1. **启动**：用保留会话目录启动 Boss（窗口可见便于观察；如本环境不允许弹窗则
   `show:false` + 仅 Qwen 单窗）。
2. **探测基线（read-only，先行）**：打开 qwen 页，执行只读 DOM probe：
   - `document` 结构快照；查找 composer（role=textbox / contenteditable / textarea / 占位含
     "Ask" 或“向 AI 提问”）；
   - 发送按钮候选（composer 附近 button/aria-label 含 send/发送，或 icon svg）；
   - 记录候选 selector/角色树 → 证据 `round-16/live-qwen-dom-probe.json`。
3. **真实失败基线**：经 renderer bridge `dispatchTask` 1-AI(Qwen) echo；
   预期因 send 控件未解析而 blocked（记录 outcome/message）→ 证据
   `live-qwen-send-failure.json`（若居然成功 → P0-7 已毕业，改记录 repair 固化）。
4. **Computer-Use 接管**：用 step-2 的 probe 结果构造 `resolveTarget` 映射，
   调 `createPageRepairExecutor({surface: providerDomSurface(qwen), resolveTarget})` 执行
   `buildRepairPlan("SEND_AFFORDANCE_MISSING", now, grants)`：
   - grants 来源：工作区 PermissionManifest 的 `computer:<action>`（无授权 → DENIED 记录，
     按 §29 不得执行）；
   - 动作后 `verify_state` 检查用户消息/生成开始 → REPAIRED / UNCERTAIN（§25 不重复）。
   - 证据 `live-qwen-cu-repair.json`（steps/selectors/outcome/post-condition）。
5. **固化（若稳定）**：把稳定 selector/动作固化为 qwen adapter 的 send 实现 → 单测 →
   typecheck/build → 再跑一次 step-3（live 复验 PASS）→ 证据 `live-qwen-adapter-patch.json`。
6. **P1-1 graduation 收口**：更新 FINAL-ACCEPTANCE.md（§41 Qwen repair 行、§31 循环 PASS 记录）、
   证据 INDEX、owner-result 合 main、推送。

## 验收（本轮 READY 定义）
- `live-qwen-send-failure.json`（真实失败基线）存在且内容诚实；
- `live-qwen-cu-repair.json` outcome ∈ {REPAIRED(有 verify 证据), UNCERTAIN(附原因), DENIED(附 §29 原因)}；
- 若 REPAIRED 且稳定 → `live-qwen-adapter-patch.json` + 复验 PASS；
- 以上均记录决策台账 + evidence/round-16/。
- 诚实失败也接受：若 probe 证明 Qwen 页面机制彻底变化且 DOM 层无法满足 §25/§28 守卫，
  则以 INCONCLUSIVE + 证据记录收尾（正确拒绝=PASS），不硬凑 REPAIRED。

## 为什么现在不做（Round-14/15 判断）
- 当前无运行中的 Boss 实例；真实会话分区与窗口自动化需在**本机可见会话**中由专门 live 轮驱动；
- 避免在本轮盲目弹窗/操作真实 Qwen 页面造成不可控副作用（§25/§26 纪律同样适用于我们自身）。
