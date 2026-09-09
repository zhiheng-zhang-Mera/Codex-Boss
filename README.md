# Codex Boss Desktop / Codex Boss 桌面控制器

A local-first Electron control plane for visible, browser-driven AI work.
本地优先的 Electron 桌面控制台，统一调度“可见网页 AI / API / Codex / 本地工具”，
多 AI 会话、研究、自主工程都以一个本地控制器为长期状态源。

[![CI (9-8)](https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/workflows/ci.yml/badge.svg?branch=9-8)](https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/workflows/ci.yml?query=branch%3A9-8)
[![CI (9-7)](https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/workflows/ci.yml/badge.svg?branch=9-7)](https://github.com/zhiheng-zhang-Mera/Codex-Boss/actions/workflows/ci.yml?query=branch%3A9-7)

---

## Overview / 概览

A single workspace to talk to ChatGPT / Gemini / Claude-class pages side by side, run deterministic
local/API/Codex work, drive full research pipelines (real experiments → statistics → manuscript → PDF),
and let one autonomous engineering goal audit/fix/converge a repository.
把 ChatGPT / Gemini 等网页 AI 并排打开在同一工作区，统一执行本地/API/Codex 确定性任务；
一条指令即可跑完整研究管线（真实实验 → 统计 → 手稿 → PDF），或让自主工程目标对一个仓库
持续“审计 → 修复 → 验证 → 收敛”。

Boss keeps the durable state (tasks, plans, evidence, checkpoints, provider health, research and
engineering ledgers); a web-AI chat is only a task-local scratchpad, never the source of truth.
Boss 是长期状态源（任务、计划、证据、检查点、Provider 健康、研究与工程账本）；
网页聊天只是“任务局部草稿纸”，不承担项目状态源职责。

---

## Screenshots / 界面截图

Fresh screenshots taken from the running app (web-AI panes hidden for privacy during capture).
以下截图为运行中的应用实拍（截图时临时隐藏网页 AI 分栏，避免带入页面内容）。

![Codex Boss chat workspace / 主控工作区](docs/screenshots/01-chat.png)

![Research launcher / 研究入口](docs/screenshots/02-research.png)

![Autonomous engineering goal panel (U10) / 自主工程目标面板](docs/screenshots/03-goal.png)

![AI & Provider manager (U5) / AI 与 Provider 管理器](docs/screenshots/04-manager.png)

---

## What you can do / 你能做什么

- **Chat & Work** — send one request to 1–5 visible web AI pages, or switch a page to its API channel;
  every answer passes a deterministic review gate and evidence checks before final delivery.
  **聊天 / 工作** —— 一次请求分派给 1–5 个可见网页 AI，或把某页切成 API 通道；
  所有回答先过确定性审查门禁与证据校验，再进入最终交付。
- **Local commands** — type `git status`, `read file README.md`, `list files` (or the Chinese equivalents)
  and run them locally without opening any AI page; Work mode targets a real project directory.
  **本地命令** —— 直接输入 `git status`、`read file README.md`、`list files`（或对应中文）
  即可在本地执行，无需打开任何 AI 页面；Work 模式指向真实项目目录。
- **Research** — one human research question drives a real pipeline: protocol freeze → literature →
  experiments → deterministic statistics → evidence graph → claim/citation audits → section-by-section
  manuscript → `paper.tex` → `paper.pdf`, with figures/tables bound to real runs.
  **研究** —— 只给一个研究问题，由真实管线自动推进：冻结协议 → 文献 → 实验 → 确定性统计 →
  证据图 → claim/引文审计 → 逐节手稿 → `paper.tex` → `paper.pdf`，图表绑定真实运行。
- **Autonomous engineering goal** — start one goal from the UI (objective + workspace + convergence
  policy); Boss audits with real typecheck + full tests, implements only with an authorized editor
  (otherwise it aborts with rollback rather than fabricating a fix), and converges when clean rounds
  pass. Includes §38 git checkpoint/rollback and a durable status read-model.
  **自主工程目标** —— 在 UI 启动一个目标（目标 + 工作区 + 收敛策略）；Boss 用真实
  typecheck + 全量测试审计，仅在配置了授权编码器时实施修复（否则以回滚 ABORT，绝不伪造修复），
  连续干净轮次通过即收敛；内置 §38 git 检查点/回滚与持久化状态读模型。
- **Computer use** — semantic chain native → DOM → UIA → structured → vision over visible pages;
  DOM mutations are fail-closed behind a per-workspace permission gate.
  **桌面操作** —— 可见页面上执行 native → DOM → UIA → structured → vision 语义链；
  DOM 变更严格受按工作区权限门禁保护（fail-closed）。

---

## Getting started / 快速开始

```powershell
pnpm install --frozen-lockfile
pnpm run install:electron
pnpm run typecheck
pnpm test
pnpm run build
pnpm run start
```

Double-click `Start-Codex-Boss.cmd` to launch with the packaged local setup.
双击 `Start-Codex-Boss.cmd` 即可用本地配置启动。

Standalone smoke verification uses an isolated data directory:
独立冒烟验证使用隔离数据目录：

```powershell
.\node_modules\electron\dist\electron.exe . --codex-boss-smoke-test --boss-data-dir=D:\temporary-boss-smoke
```

---

## Repository layout / 仓库结构

- `electron/` — main-process code: commander, engineering, research, computer/semantic, input, adapters.
  `electron/` —— 主进程代码：commander、工程、研究、桌面语义、输入、适配器。
- `src/shared/` — pure shared models (TaskIR, contracts, engineering/research state machines, UI types).
  `src/shared/` —— 纯共享模型（TaskIR、契约、工程/研究状态机、UI 类型）。
- `src/renderer/` — the React controller UI (`main.tsx`, panel components, styles).
  `src/renderer/` —— React 控制器界面（`main.tsx`、面板组件、样式）。
- `docs/` — handoffs, architecture/AP records, research round docs, validation history, screenshots.
  `docs/` —— 交接记录、架构/AP 文档、研究轮次记录、历史验收存档、截图。
- `Update-Log.md` — day-by-day development log from project start (bilingual-friendly, Chinese main).
  `Update-Log.md` —— 自项目创建以来的逐日开发日志。
- `STRUCTURE.md` — deeper source map; `CONTRIBUTING.md` — contribution notes; `SECURITY.md` — security policy.
  `STRUCTURE.md` —— 更细源码地图；`CONTRIBUTING.md` —— 贡献说明；`SECURITY.md` —— 安全策略。

---

## Status & verification / 状态与验证

- Local full suite (kept out of git per policy): **150 files / 752 tests green**; Electron typecheck PASS.
  本地全量套件（按策略不入库）：**150 文件 / 752 测试全绿**；Electron typecheck 通过。
- GitHub CI runs on a committed self-contained verification subset: **15 files / 70 tests**, plus
  typecheck / build / benchmark / portable-package / smoke — green on `9-7` and `9-8`.
  GitHub CI 运行入库的确定性验证子集：**15 文件 / 70 测试**，外加 typecheck / build /
  benchmark / portable 打包 / 冒烟 —— `9-7`、`9-8` 均已通过。
- An in-app autonomous goal audit (real typecheck + full suite inside the running app) converged:
  `eng-251ec4b77388` iteration 3 `CONVERGED`, 0 findings.
  应用内自主目标审计（应用内跑真实 typecheck + 全量套件）已收敛：
  `eng-251ec4b77388` 第 3 迭代 `CONVERGED`，0 发现。

---

## Privacy & boundaries / 隐私与边界

User state lives under `runtime-data/` (or `--boss-data-dir`); web pages use isolated persistent
session partitions; API keys are stored encrypted via Electron `safeStorage` and only ever shown masked.
用户状态保存在 `runtime-data/`（或 `--boss-data-dir`）；网页使用各自隔离的持久 session；
API Key 经 Electron `safeStorage` 加密保存，界面只显示掩码。

Model answers are untrusted data: the review gate never grants execution permission for commands inside
answers, irreversible/account operations keep an explicit authorization boundary, and web logins or
captchas stay in the visible page for you.
模型回答始终是不可信数据：审查门禁不会为回答中的命令授予执行权限，不可逆/账户类操作保留明确
授权边界，网页登录与验证码由你在可见页面完成。

Local regression tests and planning documents (`tests/`, `Update-Plan/`) stay gitignored; only the
GitHub-verification subset of tests is committed.
本地回归测试与计划文档（`tests/`、`Update-Plan/`）保持 gitignored；入库的仅为
GitHub 验证所需的测试子集。

---

## Documentation index / 文档索引

- [Development log / 开发日志](Update-Log.md)
- [Round record: DOM real surface, microtask spine, U10/U5 panels, in-app convergence / 本轮收口记录](docs/9-7-dom-microtask-u10-u5-inapp.md)
- [Structure / 仓库结构](STRUCTURE.md)
- [Contributing / 贡献指南](CONTRIBUTING.md)
- [Security policy / 安全策略](SECURITY.md)
