# Codex Boss Desktop

Codex Boss 是一个本地优先的独立桌面控制平面。它提供类似现代编码代理工作台的任务体验，但**不使用、嵌入或依赖 Codex 桌面端**。应用自己管理任务、状态、审计事件与网页处理器窗口；Codex CLI、OpenAI API 或其他模型能力只会作为后续可替换适配器接入。

> 当前版本：`0.5.0`，新增 Chat / Work 双工作方式、逐 AI 网页/API 通道、加密 API 设置，以及按文件夹组织的本地多对话历史。主控输入一次提交到当前整组 AI，随后按固定顺序收集回答；不会绕过登录、验证码、平台限制，也不把部分成功或未采集结果伪装成整组成功。

## Chat / Work 与任务通道

- **Chat**：3 或 5 个 AI 全部使用可见网页版，保持直接对话体验。
- **Work**：在主任务输入前，可为每个已打开 AI 单独选择 `web` 或 `api`；开始输入后，AI 集合和各自通道一起锁定，清空输入后才能切换。
- API 设置位于主控右上角“设置”，支持 OpenAI-compatible、Anthropic 和 Gemini 协议，可分别配置启用状态、HTTPS Base URL、模型和 API Key。
- API Key 使用 Electron `safeStorage` 调用 Windows 安全存储加密，只在 `%LOCALAPPDATA%\CodexBoss\api-settings.json` 保存密文；renderer、状态快照、`history/` 和 Git 中均不保存明文。
- Work 可以混用网页和 API，但仍执行同一个 3/5 全员成功检查点；任一通道失败都不会解锁下一阶段。

## 多对话与本地历史

- 左侧历史栏支持新建、切换和延续旧对话；新任务始终追加到当前对话。
- 对话可以放入不同文件夹、移动归类，并可动态重命名文件夹或对话。
- 本地结构为 `history/<文件夹名>/<对话名>/`，包含 `conversation.json`、`messages.md`、`artifacts/` 和 `evidence/`。
- 名称变更或移动时，系统同步移动实际目录；Windows 非法/保留名称会安全规范化，重名会附加序号。
- `history/` 默认被 Git 忽略，仅保留在当前项目根目录，不随源代码推送。

## Phase 1 已实现

- Electron + React + TypeScript 独立桌面应用
- 类 Codex 工作台的任务列表、详情、状态和事件时间线
- 左半屏 Codex 风格聊天/任务输入，右半屏嵌入式网页工作区
- 默认选择 ChatGPT、Gemini、Claude 3 个页面；可同时打开 1–5 个原生 `WebContentsView` 并自动平铺
- 内置 ChatGPT、Gemini、Claude、DeepSeek、Qwen、Kimi、Grok、Perplexity、Microsoft Copilot、Mistral、豆包
- 可添加和移除自定义 HTTPS 网页 AI；可选目录不设为 5 个，但同时选中和运行上限均为 5 个
- 每个处理器独立的持久化 Electron session partition
- 显式打开、聚焦和关闭窗口，不使用隐藏后台浏览器
- 本地 JSON 状态存储与原子写入
- `contextIsolation + sandbox + no nodeIntegration` 安全边界
- 仅暴露白名单 IPC，不把网页输出当作系统指令
- Windows CI：类型检查、测试和 production build

## Phase 2 已实现

- ChatGPT、Gemini、Claude、DeepSeek、Qwen、Kimi 的版本化可见页面 adapter
- `AUTH_REQUIRED`、`RATE_LIMITED`、`PAGE_CHANGED`、`USER_ACTION_REQUIRED`、`UNSUPPORTED` 等失败封闭状态
- 在主控页选中 AI 会立即打开对应页面，取消选中或关闭页面会同步更新同一状态
- 主控提交动作先预检整组页面，再一次提交到全部 3 或 5 个 AI，随后按 provider 顺序逐个等待和捕获回答
- 任一页面预填失败时不发送并回退本地记录；部分页面可能已经发送时进入人工核对门禁，避免盲目重复提交
- 自定义网页默认保持 `UNSUPPORTED`，避免猜测未知 DOM

## Phase 3 已实现

- Direct / Council 两种任务模式
- Council 三阶段状态机：Independent Proposal → Anonymous Peer Review → Synthesis
- 匿名标签重打包、Evidence > vote、冲突提取与少数意见保留
- 当前轮未收齐全部 artifact 时禁止推进；格式错误的外部输出不会被修补成证据
- 综合轮保留所有原始材料，不自动触发 shell、文件或其他外部执行

## Phase 4 已实现（基础版）

- 为每个任务生成带 SHA-256 manifest 与整体 integrity root 的本地证据包
- 从综合轮的结构化 claims 建立 claim index，并区分未验证引用、争议和证据不足
- 保留 dispute index、缺失 provider 清单，并默认给出 `HOLD_FOR_REVIEW`
- 只把争议或证据不足 claim 及其引用 artifact 放入选择性回填轮次
- 可选 Codex CLI 控制端复用当前 ChatGPT 账户登录状态进行独立审查；不复制 Cookie、token 或网页登录态
- Codex 审查只能评价已有 dossier，不是额外投票，也不能把缺失证据自动升级为已验证

## 本地运行

需要 Node.js 22+ 与 pnpm：

```powershell
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
pnpm run dev
```

### 像普通桌面应用一样启动

完成一次 `pnpm install` 和 `pnpm run build` 后，直接双击仓库根目录的：

```text
Start-Codex-Boss.cmd
```

启动器不会开启 Vite 开发服务器或终端工作流，而是直接加载 production build。重复双击不会创建第二套控制平面，而会恢复并聚焦已经运行的 Codex Boss 主窗口。启动器未来也会自动优先选择 `release/Codex Boss.exe` 打包版本。

启动记录保存在本地 `.codex-boss/launcher.log`，Electron 标准输出和错误分别保存在同目录的 `electron.stdout.log` 与 `electron.stderr.log`。网页登录态和 Chromium session/cache 存放在 `%LOCALAPPDATA%\CodexBoss`，避免漫游目录权限影响页面加载。这些运行数据均不会提交 Git。

启动后直接打开 ChatGPT、Gemini、Claude。网页选择状态与窗口打开状态完全一致，可从主控选择器或各网页标题栏关闭；主任务一旦已有输入，这些选择会锁定。3 个网页在右半屏按上、中、下等高排列；选择 5 个网页时，整个工作区切换为 2×3 六宫格，Codex Boss 主控位于上排中间，5 个网页占据其余单元。主控只在打开数量为 3 或 5 时允许一次提交；整组回答全部捕获并提交检查点后，Council 下一轮和 Phase 4 操作才会解锁。

### 账户与游客模式边界

- Codex 控制端只读取本机 `codex login status`，状态栏显示 `CHATGPT`、`NOT_AUTHENTICATED` 或 `UNAVAILABLE`；不会从 Codex 桌面端读取或复制账户数据。
- 每个网页版 AI 都使用本应用自己的隔离浏览器 session。若网站允许游客使用即可游客运行；要求登录、验证码或风控时会保持 `AUTH_REQUIRED` / `USER_ACTION_REQUIRED`，不会尝试绕过。
- `AccountSessionManager` 单独管理 `persist:codex-boss-<provider>` 会话分区；关闭窗口或重启应用不会主动清除网页登录记忆，主控只显示可观察到的 `GUEST_READY`、`READY`、`AUTH_REQUIRED` 或 `UNKNOWN`。
- 游客能力和页面 DOM 会随服务端变化。production build、selector 单测或“页面已打开”都不能证明某个游客任务已成功发送或回答已采集。

## 核心边界

```text
Desktop Shell (trusted)
  ├─ Renderer workbench (unprivileged)
  ├─ Task / audit store (local)
  ├─ Window supervisor
  └─ Provider WebContentsViews (untrusted web content)
       ├─ persist:codex-boss-chatgpt
       ├─ persist:codex-boss-gemini
       ├─ persist:codex-boss-claude
       └─ persist:codex-boss-<provider-id>
```

- 网页窗口是可替换的处理器，不是系统状态数据库。
- 网页回答一律是 `UNTRUSTED_EXTERNAL_OUTPUT`。
- 页面操作不允许绕过登录、验证码、风控或服务条款。
- 任何 shell、文件、Git 或外部发送动作必须经过独立权限和审批层。
- “窗口已打开”不等于“任务已完成”；完成状态必须来自验证或用户确认。

## 路线图

1. **Phase 1 — Desktop Foundation（本版本）**：独立主窗口、左右分屏、多页面自适应布局、任务状态与本地审计。
2. **Phase 2 — Visible Adapters（本版本）**：版本化页面适配器、登录状态检测、可见输入、完成检测、原始输出捕获、失败恢复。
3. **Phase 3 — Council Engine（本版本基础版）**：独立提案、匿名评审、冲突提取、少数意见与综合轮。
4. **Phase 4 — Evidence & Verification（本版本基础版）**：artifact bundle、claim/dispute index、选择性回填和当前账户 Codex 审查；真实游客网页验证需逐次记录。
5. **Phase 5 — Optional Native Runtimes**：Codex CLI/app-server、Responses API 与其他原生适配器；全部可选，不依赖 Codex 桌面端。

详细模块、状态机和验收标准见 [STRUCTURE.md](STRUCTURE.md)；本轮 Phase 2–4 的现场结果与 `NOT_RUN` 边界见 [PHASE4_VALIDATION.md](PHASE4_VALIDATION.md)。

## 免责声明

本项目是独立社区项目，与 OpenAI、Anthropic 或 Google 无官方隶属关系。用户负责第三方账号、服务条款、数据授权和自动化使用边界。
