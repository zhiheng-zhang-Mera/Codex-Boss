# Codex Boss Desktop — Architecture

## 1. 产品修正

旧设计把 Codex 桌面端自身视为调度器，同时把“浏览器操作”留给宿主环境。这使项目无法独立运行，也无法定义窗口、权限、状态和故障恢复的真实所有者。

新设计将 Codex Boss 定义为独立桌面控制平面：

```text
User
  ↓
Codex Boss Desktop
  ├─ Task control plane
  ├─ Evidence / audit store
  ├─ Window supervisor
  ├─ Protocol engine (later phase)
  └─ Runtime adapters
       ├─ Visible web window adapters
       ├─ Codex CLI or app-server (optional)
       └─ Model APIs (optional)
```

“Codex”表示可选的编程代理能力与项目品牌来源，不表示必须运行 Codex 桌面端。桌面 shell、任务状态和处理器窗口都由本应用所有。

## 2. 技术选择

| 关注点 | 选择 | 原因 |
|---|---|---|
| 桌面 shell | Electron | 顶层 Chromium 窗口、持久 session partition、Windows/macOS 成熟支持 |
| UI | React + TypeScript + Vite | 强类型 IPC、快速工作台迭代、生产构建简单 |
| 网页处理器 | 主窗口内原生 `WebContentsView` | 不受 iframe 限制；在右半屏真实渲染并可由用户接管 |
| 页面布局 | renderer 测量 + allowlisted IPC | 1–5 页自适应；3 页为双列加跨列，4 页为 2×2，5 页为上三下二 |
| 登录态 | `persist:codex-boss-<provider>` | 不复制 Cookie，不向主 renderer 暴露凭据 |
| 状态 | 本地 JSON，原子 rename + Windows copy-replace 回退 | Phase 1 依赖少；后续可替换 SQLite event store |
| 权限边界 | sandboxed renderer + allowlisted IPC | 远端网页与 Node/文件系统隔离 |
| 自动化 | Phase 2 provider adapter | 页面 selector 与调度器解耦，失败必须显式分类 |

不采用 Python GUI：它会额外引入浏览器运行时/调试协议，难以获得一致的页面与 session 生命周期。不采用 iframe：主流 AI 网站可能禁止嵌入。`WebContentsView` 是 Electron 管理的真实 webContents，不是 iframe。不把 Playwright headless 当核心：产品要求用户能看到并接管实际页面。

## 3. 当前目录

```text
electron/
  main.ts               app lifecycle + allowlisted IPC
  preload.ts            narrow renderer bridge
  provider-views.ts     embedded provider view supervisor
  provider-automation.ts visible prepare/send/observe/capture controller
  evidence-engine.ts    manifest, claims, disputes and selective rehydration
  codex-controller.ts   optional current-account Codex CLI evidence review
  adapters/             versioned selector registry and isolated page scripts
  store.ts              local task/event persistence
src/
  shared/contracts.ts   cross-process contracts
  shared/council-engine.ts anonymous review and evidence-first synthesis prompts
  renderer/
    main.tsx             desktop workbench
    state.ts             pure view helpers
    styles.css           visual system
tests/
  state.test.ts
scripts/
  start-codex-boss.ps1  production launcher + visible error reporting
Start-Codex-Boss.cmd    double-click entrypoint
.github/workflows/ci.yml
```

## 4. 信任边界

```text
TRUSTED: Electron main process
  ↓ allowlisted IPC with runtime validation
LIMITED: local renderer
  ↓ explicit window action
UNTRUSTED: remote provider webContents
```

Provider 窗口配置：

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- 每个 provider 独立持久 partition
- 新窗口请求仅允许 HTTPS 并交给系统浏览器
- 不从远端网页直接调用主进程 IPC

后续 adapter 捕获的任何内容都必须先写入 raw artifact，再经过 normalize、validate、judge，不能直接触发 shell 或文件动作。

## 5. 任务与窗口状态

任务状态：

```text
QUEUED → RUNNING → WAITING → COMPLETED
                   └────────→ FAILED
```

Phase 1 的 `RUNNING` 只表示任务对应的可见窗口已经被调度，绝不表示提示词已提交或回答已经完成。

窗口状态独立于任务状态：关闭窗口不会伪造任务失败或完成；应用只追加 `window.closed` 审计事件。再次运行会恢复相同 provider partition 的登录态并聚焦已有窗口。

## 6. Phase 1 验收标准

- `npm run typecheck` 同时验证 renderer、main、preload 和 shared contracts。
- `npm test` 验证任务状态汇总与持久时间显示的纯逻辑。
- `pnpm run build` 生成 `dist/` 与 `dist-electron/`。
- 主窗口在没有 Codex 桌面端时可独立启动。
- 双击 `Start-Codex-Boss.cmd` 会直接加载 production 页面；重复启动只聚焦现有实例。
- CMD 同步托管隐藏 PowerShell，直到应用退出，避免异步启动链在父进程结束后丢失 Electron。
- PowerShell 启动脚本保持纯 ASCII，兼容 Windows PowerShell 5 的无 BOM 脚本解码；启动证据写入 `.codex-boss/launcher.log`。
- Electron 的 `userData` 与 `sessionData` 固定在 `%LOCALAPPDATA%\CodexBoss`，避免漫游 AppData 的跨卷 rename 与 Chromium cache 权限问题。
- 创建任务会持久化 task 与 `task.created` 事件。
- 运行任务会在右半屏加载所有选中网页，按数量自动平铺，设置 `RUNNING` 并追加事件。
- 默认选中 ChatGPT、Gemini、Claude；内置目录超过 5 个 provider，同时选择与运行均由 renderer 和主进程限制为最多 5 个。
- 内置与自定义 provider 均使用独立持久 session partition；自定义入口只接受 HTTPS URL，并保存在本机状态文件。
- renderer 与 provider 页面均不能访问 Node API。

未在 Phase 1 验收范围：第三方登录成功、DOM selector 稳定性、自动输入、回答捕获、多模型质量、跨平台安装包签名。它们保持 `NOT_RUN`，不得由 build 成功替代。

## 7. Phase 2 落地方式

每个 provider 实现统一 adapter：

```text
detectAuth()
prepareTask(task)
showBeforeSend()
sendWithUserVisibleAction()
observeCompletion()
captureRawArtifact()
recover()
```

统一返回：

```text
SUCCESS | RETRYABLE_FAILURE | AUTH_REQUIRED | RATE_LIMITED |
PAGE_CHANGED | FORMAT_INVALID | USER_ACTION_REQUIRED | UNSUPPORTED
```

Selector 必须按 provider/version 保存，带 fixture 与页面变化回归测试。自动化过程必须在可见窗口运行；验证码、安全检查和高风险确认一律停在 `USER_ACTION_REQUIRED`。

当前实现把 `prepareTask` 与 `sendTask` 拆成两个独立 IPC。前者只在可见输入区预填并高亮；后者只能由 renderer 中明确的确认按钮触发。采集器以发送前的最后回答为 baseline，只有检测到新回答且连续稳定，或用户显式要求采集时，才写入带 `untrusted: true` 的 raw artifact。自定义网页和未版本化 provider 默认 `UNSUPPORTED`。

## 8. 保留的委员会框架

旧设计中有价值的部分继续保留为 Phase 3/4 协议，而不再冒充已实现功能：

- Independent Proposal
- Anonymous Peer Review
- Conflict / Minority preservation
- Context Funnel / Selective Rehydration
- Session rollover / Handoff
- Evidence > vote
- Processor output → validate → judge → execute

这些协议建立在可靠 adapter、artifact store 与状态机之上，不能反向耦合具体 DOM 或 provider 品牌。

Phase 3 当前实现为三个强制阶段：`proposals → peer_review → synthesis → completed`。每轮必须为全部参与 provider 捕获 artifact 后才能推进；匿名评审 prompt 不包含 provider 名称，并要求返回结构化冲突与少数意见。解析失败保持缺失，不用推测值替代。综合阶段明确禁止按票数决策，并要求区分证据、推断和未解决分歧。

## 9. Phase 4 证据与验证

Phase 4 把“已有回答”与“可采信结论”分开：

```text
raw artifacts
  → SHA-256 manifest + integrity root
  → claim / dispute / missing-provider index
  → optional Codex dossier review
  → selective rehydration for unresolved claims
  → HOLD_FOR_REVIEW
```

- 综合 prompt 必须输出 `{"claims":[{"text":"...","evidenceLabels":["Proposal A"]}]}`；缺失或格式错误时 claim 标为 `INSUFFICIENT`。
- 引用了 artifact 只表示 `REFERENCED_NOT_VERIFIED`，不等于事实验证。仍存在 conflict 时标为 `DISPUTED`。
- 选择性回填只携带争议/不足 claim 所引用的 artifact；不把整段历史重新广播给所有页面。
- Codex 控制端通过本机 Codex CLI 复用当前 ChatGPT 登录状态，并在独立空目录、只读 sandbox、ephemeral session 中审查 dossier。artifact 始终按不可信引用数据处理。
- 当前阶段不包含互联网事实核验器、自动执行器或 `READY_FOR_USER_REVIEW` 自动升级，因此 evidence decision 保持 `HOLD_FOR_REVIEW`。

Phase 4 基础验收：类型检查、证据引擎单测、production build、启动器 smoke test、控制端账户状态检测。第三方游客页的可用性、真实发送和回答采集必须分别保留现场结果；没有执行的项为 `NOT_RUN`。
