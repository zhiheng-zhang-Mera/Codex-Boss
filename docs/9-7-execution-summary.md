# Codex-Boss 9-7 DSH-V4 — Phases A–L 执行总览

Branch `9-7`（基于 `9-6`）。逐 Phase 实现，每个 Phase 附带 focused tests、
typecheck、phase handoff（`docs/9-7-phase-*.md`），全局回归于 Phase 收尾与
最终执行。

## 提交与内容

| Commit | Phase | 交付 |
|---|---|---|
| `6779e51` | A — TaskInput/InputObject | 统一输入模型（shared input-object：source/kind/ref/TaskInput、确定性 kind 分类、校验）；`BossTask.inputObjectIds`、`BossConversation.inputObjects` 注册表；store register/remove/bind；旧快照 read 兼容；create/dispatch 透传 |
| `3504e55` | B — Upload UI + Attachment Store | AttachmentStore（`.boss/attachments/<conv>/<id>/` original + metadata.json，sha256，200MB 上限，cascade remove，traversal 防护）；IPC pick/add-bytes/remove/path；delete-conversation 级联删 blob；AttachmentTray（＋按钮/拖拽/Ctrl+V 粘贴/chips）绑定到任务 |
| `8895ff8` | C — Capability Registry + Router | shared ProviderCapabilities + kind→capability needs + baseline（未知 provider 无能力）；override registry（schema v1）；AttachmentRouter（routeInputObjects → ResolutionPlan，multi-file/multipleFiles/size/availability、WORK escalation、routeTextOnly） |
| `5e7fb36` | D — Web AI 上传 + DOM 确认 | Adapter fileInputSelectors/attachmentSelectors/uploadKinds；uploadFilesScript + verifyUploadScript（fail-closed，chip 名称确认）；attachment-upload planner（unsupported/oversized 永不假装上传）；ProviderAutomation.prepareUploads（发送前先上传+DOM 确认） |
| `c513442` | E — Chat→Work 自动升级 | capability-needs detector（纯正则、按 plan §2.2 表格）；InteractionMode/ModeTransition；store stage/approve(一次)/decline；IPC dispatch 提案 + `resolve-mode-proposal` 单次确认并同任务续跑；WORK_PROPOSED 不会被 reconcile/resume 误启动；renderer 确认卡 |
| `06f05fa` | F — GitHub URL Resolver | github-url parser（tree/blob/commit/ssh + ref/subpath + message 内 URL 抽取）；GithubResolver 缓存 clone/checkout/marker reuse/forceFetch（origin 可注入测试）；dispatch 自动把 GitHub URL 物化为 REPOSITORY InputObject 并绑定、以 checkout 为 workspace |
| `cfb948e` | G — Context Optimizer | RepoManifestStore 增量内容哈希（未变文件不重读、changed/removed/unchanged delta）；stable prompt layout（static prefix 先行 + fingerprint）；TokenBudgetManager（按 stage 软上限 + 具体降级路径） |
| `2ee0135` | H — DeepSeek V4 ModelPolicy | 显式 model/thinking/effort/maxOutput 每 stage（flash non-thinking classify、flash low route、pro high 主流、pro max 仅 adjudicate）；policyFor 可解释选择；JSON-only 输出契约；buildV4Prompt 复用 stable prefix；API 默认 deepseek-v4-flash |
| `faee6bf` | I — DSH Presets | boss-dev-standard/ptc/minimal/creator + 默认映射（feature→standard、multi-tool→ptc、patch→minimal、plugin→creator），deterministic presetForWorkType + guard rails |
| `6c773b6` | J/K/L — Research | J: research-roles（stage→role + typed artifact）+ LiveResearchExecutor（每 stage 发 typed artifact、保留 reviewer gate）；K: `runUntilBlocked` autopilot（真实阻塞点/终态/cap）+ IPC + 自动推进按钮；L: manuscript LaTeX 正确分节（不再把全文塞进 abstract）、LatexCompiler（引擎探测、两遍编译、compile.json audit、fail-closed）、`research-compile-pdf` IPC + Research 视图 PDF/TEX/cache 路径与按钮 |

## 验证

- `pnpm run typecheck` — 双 tsconfig 全绿。
- Focused suites：A(input-object 12) B(attachment-store 8) C(provider-capabilities 11)
  D(web-upload 8) E(capability-needs 7) F(github-resolver 7) G(context-optimizer 8)
  H(model-policy 5) I(dsh-presets 5) JKL(research-live-jkl 10 + manuscript)。
- Phase 收尾全量回归多次通过（示例：114 files / 558 tests），最终全量回归见本次执行记录。

## 边界说明（诚实声明）

- 网页 DOM 上传/适配器验证与 LaTeX 引擎编译属于 live 环境能力：脚本逻辑、
  planner、编译器 audit 均以 node:vm / 注入引擎测试覆盖；真实页面与真实
  TeX 引擎需在 GUI/live 会话中确认（与既有 9-6 web adapter、runbook 相同策略）。
- DSH presets 是 Boss 侧选择策略；可挂载的 Cordis 组合仍在 Harness preset root，
  需要时按 docs 复制为用户 preset。
- Update-Plan/ 未纳入版本控制（保持 untracked）。

## 9-7 形态对照

- Chat 为默认入口：`boss:dispatch-task` 内 capability detector 提案 Work。
- 上传即输入：AttachmentTray 全入口（按钮/拖拽/粘贴）→ 附件卡 → 随消息绑定。
- Provider/capability/文件解析由 Boss 决定：Registry + Router + model policy 均
  为确定性 host 工作，AI 只做语义部分。
- 重复任务不再重复发送未变内容：repo manifest + content hash + stable prefix。
- Research 保留 .tex，并可编译 .pdf 并显示最终缓存路径（PDF/TEX/cache）。
