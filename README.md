# Codex Boss Desktop

Codex Boss 是本地优先的 Electron 桌面控制器。`9-4` 分支已按 [执行计划](docs/9-4-plan.md) 完成稳定 **1.0.0** 的有界本机验收。真实网页、桌面、恢复、迁移和资源证据及其外推边界见 [V1.0 验收记录](docs/9-4-v1-hardening.md)。

## 当前可用路径

- 默认一个 ChatGPT 页面；可选择 1–5 个网页/API 通道。普通回答经过确定性审查自动完成，无强制规划或评审模型调用。
- `STRICT / BALANCED / AUTONOMOUS` 审查策略，原始回答、归一化结果、重试状态和后续动作持久化。通过的是回答交付检查，不代表事实正确或授权执行其中的指令。
- 已发送但尚无回复的任务在重启后保留；已记录具体会话地址时恢复原页面继续采集。发送结果不确定时保留核对边界，避免重复发送。
- 输入 `git status`、`read file README.md`、`list files` 或相应中文命令，可以不打开 AI 页面，直接在本地执行。Work 模式可以指定项目目录。
- Task IR、任务检查点、显式会话注册、通用中断分类、有限恢复和预算降级；原生/API/Codex 运行时可按能力路由。
- 工程执行 API 支持依赖图、最多三个不重叠范围的 worker、证据验证、文件哈希前置检查及最多两轮修复。复杂自然语言需求当前默认交给单 worker；任意仓库自动重构尚未通过完整验收。
- 网页读取优先 DOM 语义接口；Council 在每轮全部通过审查后自动继续；保留 API 加密设置、历史归档和本机微信/QQ 待确认指令。

## 本地运行与验证

```powershell
pnpm install --frozen-lockfile
pnpm run install:electron
pnpm run build
pnpm test
pnpm run benchmark
pnpm run start
```

运行 `pnpm run package:portable` 会将现有 Electron 分发与编译产物打包到新的 `artifacts/Codex-Boss-*` 目录，其中包含 `Codex Boss.exe` 和 SHA-256 文件清单。只复制白名单产物，不复制历史、账号设置、浏览器资料或开发缓存。该包没有代码签名。

独立冒烟验证使用隔离数据目录：

```powershell
.\node_modules\electron\dist\electron.exe . --codex-boss-smoke-test --boss-data-dir=D:\temporary-boss-smoke
```

成功条件包括 renderer/IPC 加载及一次真实本地任务完成，结果和截图保存在指定目录；不是仅等待固定时间后返回成功。

## 状态与隐私

用户状态默认保存在 `%LOCALAPPDATA%\CodexBoss`；`.boss/tasks/<task-id>/checkpoints/` 保存任务检查点。网页使用各自隔离的持久 session partition；API Key 经 Electron `safeStorage` 加密保存。项目内 `history/`、`.cache/`、运行产物和凭据均不纳入源码。

模型回答始终作为不可信数据。审查门不会为回答中的命令授予执行权限。外部发送、不可逆操作和账户操作保留明确授权边界。网页验证码和登录由用户在可见页面处理。

## 待验收

真实供应商额度恢复、机器断电恢复、通用 UIA/视觉应用适配、任意复杂任务自动分解与代码合并，以及计划书中的完成率/资源节省率，目前均没有足够实测证据。受控测试结果与这些产品指标分开记录，不能互相替代。
