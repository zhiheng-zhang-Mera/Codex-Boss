# Codex Boss — R43+ 闭环 Requirement Manifest（2026-09-09 closure）

执行依据：`Update-Plan/R43-Closure-Construction-Plan.md`（§0–§19）。本目录为施工台账，
**requirement-manifest.json 是唯一全局完成依据**（Completion Gate = 无 required 项处于
REQUIRED_PENDING/IN_PROGRESS/REWORK/LIVE_REQUIRED；BLOCKED_EXTERNAL 仅当其余全部 PASS）。

## 结构

- `requirement-manifest.json` — 机器可审计清单（状态机见 plan §2）。
- `BASELINE-R43.md` — 施工起点基线快照（分支/HEAD/门禁/锁定项）。
- `PROGRESS.md` — 逐轮施工日志（每项更新先于提交）。
- `ACCEPTANCE-MATRIX.md` — 从 manifest 生成的验收矩阵（终态前再生成）。
- `FINAL-ACCEPTANCE.md` — 终态 Acceptance Report（终态时从 manifest 生成）。
- `evidence/` — 本轮施工证据（每项含 implementation diff / deterministic test /
  runtime/integration evidence / failure injection / regression）。

## 状态词典（仅允许）

`LOCKED_PASS`（基线锁定，只回归）· `PASS`（本轮真实完成）·
`REQUIRED_PENDING`（未完成）· `IN_PROGRESS` · `REWORK` · `LIVE_REQUIRED`（需 live 证据）·
`BLOCKED_EXTERNAL`（真实不可绕过外部条件，≠PASS）。

## 清单速览

- LOCKED（L-01…L-20）：R31–R43 与更早验收成果锁定，只回归。
- Phase A（R-101）：verification seam v2（真实 gates + 默认启用 + 故障隔离）。
- Phase B（R-201…R-205）：Web-AI readiness gate、P0-6 live 接线、session 生命周期、
  temporary conversation、快速登录扫描。
- Phase C（R-301…R-303）：单节点独立运行、Device self-inspection、capability-aware 调度。
- Phase D（R-401…R-403）：Fleet 核心、双节点联队、异构协议。
- Phase E（R-501…R-502）：网络探测、proxy 路由与失败回退。
- Phase F（R-601…R-604）：共享 KB、本地回退、deferred sync、artifact 骨架。
- Phase G（R-701…R-705）：RP/Research Contract、sufficiency gate、cross-review/rebuttal/
  revision/meta-review、publication mode、archive。
- Phase H（R-801）：self-iteration 生命周期集成。
- Phase I（R-901…R-903）：>2h soak、UI 隔离、UI 状态显示。
- Phase J（R-1001…R-1002 + Scenario A–G 重跑）：故障注入与最终验收；R-1003 验收报告。
