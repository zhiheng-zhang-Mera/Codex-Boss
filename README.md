# Codex Boss Desktop

Codex Boss 是一个本地优先的独立桌面控制平面。它提供类似现代编码代理工作台的任务体验，但**不使用、嵌入或依赖 Codex 桌面端**。应用自己管理任务、状态、审计事件与网页处理器窗口；Codex CLI、OpenAI API 或其他模型能力只会作为后续可替换适配器接入。

> 当前版本：`0.3.0`，Phase 2 visible adapters 与 Phase 3 Council foundation。应用可在受支持页面中可见预填、经用户二次确认后发送、观察并捕获原始回答；不会绕过登录、验证码、平台限制，也不把页面变化或未采集结果伪装成成功。

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
- 创建任务后先打开页面；“预填到网页”只填入输入区，只有再次点击“确认发送到第三方”才点击发送
- 自动观察生成状态并捕获稳定回答为不可信外部原始证据，支持手动采集和重试
- 自定义网页默认保持 `UNSUPPORTED`，避免猜测未知 DOM

## Phase 3 已实现

- Direct / Council 两种任务模式
- Council 三阶段状态机：Independent Proposal → Anonymous Peer Review → Synthesis
- 匿名标签重打包、Evidence > vote、冲突提取与少数意见保留
- 当前轮未收齐全部 artifact 时禁止推进；格式错误的外部输出不会被修补成证据
- 综合轮保留所有原始材料，不自动触发 shell、文件或其他外部执行

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

启动后默认选中 ChatGPT、Gemini、Claude。在左侧可横向浏览更多内置网页 AI，也可以通过“自定义”添加 HTTPS 网页地址；自定义配置只保存在本机。一次最多选择或打开 5 个页面，右侧会按 1–5 个窗口自动分屏。创建任务后，先点击“预填到网页”；检查右侧内容无误后，再点击“确认发送到第三方”。Council 模式会在每一轮收齐原始证据后显示“推进 Council”，不会跳过缺失回答。

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
4. **Phase 4 — Evidence & Verification**：artifact bundle、claim/dispute index、选择性回填、本地测试与外部证据验证。
5. **Phase 5 — Optional Native Runtimes**：Codex CLI/app-server、Responses API 与其他原生适配器；全部可选，不依赖 Codex 桌面端。

详细模块、状态机和验收标准见 [STRUCTURE.md](STRUCTURE.md)。

## 免责声明

本项目是独立社区项目，与 OpenAI、Anthropic 或 Google 无官方隶属关系。用户负责第三方账号、服务条款、数据授权和自动化使用边界。
