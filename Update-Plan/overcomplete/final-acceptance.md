# Overcomplete — Final Acceptance Matrix（最终验收矩阵）

> 分支：`9-8-overcomplete`（推送名 `<完成日期>-overcomplete`）
> 依据 §20 统一最终验收。状态口径：
> - ✅ **DETERMINISTIC-PASS**：本环境可复现验证通过（typecheck/测试/真实命令/seeded E2E）。
> - 🟢 **LIVE-9-8**：9-8 分支真机/GUI 会话已验证（本轮工作区无 provider 会话，未在本分支重跑，代码路径未改动或已由确定性测试覆盖）。
> - ⚪ **NOT-RUN（本环境）**：依赖真实网页登录/GUI/TeX/长时间 soak，记录为 §27 Known Limitations，绝不虚标。

## 20.1 Basic Product

| 项 | 状态 | 证据 |
|---|---|---|
| App launches / portable launches / profile / history 持久 | 🟢 LIVE-9-8（9-8 CI package+portable smoke 全绿；分支改动不涉及启动壳） | .github/workflows/ci.yml |
| Chat（延续可见会话） | 🟢 LIVE-9-8（真机 CDP E2E） | Update-Log 2026-09-08 |
| Work / Council / attachment / GitHub input | 🟢 LIVE-9-8 | Update-Log 2026-09-08 |
| 1 / 3 / 5 AI 泛化 | ✅ DETERMINISTIC-PASS（微任务并发 1..maxWorkers、Work 池 agentCount 1\|3\|5、无硬编码 3） | tests/unit/microtask-parallel.test.ts、engineering-loop goal agentCount |

## 20.2 Autonomous Engineering

| 项 | 状态 | 证据 |
|---|---|---|
| clean repo audit → converge | ✅（确定性 audit=真实 typecheck+全量测试） | 前 9-8 eng-251ec… CONVERGED + driver 单测 |
| seeded compile bug 修复 | ✅ Bug A PASS | evidence/engineering/seeded-A-*.json |
| seeded test bug 修复 | ✅ Bug B PASS | evidence/engineering/seeded-B-*.json |
| logic bug 修复 | ✅ Bug C PASS | evidence/engineering/seeded-C-*.json |
| multi-file/cross-module 修复 | ✅ Bug D PASS | evidence/engineering/seeded-D-*.json |
| reviewer 打回 → 二次修复 | ✅ DETERMINISTIC-PASS（driver reflow 单测；live AI reviewer 需会话） | tests/unit/engineering-review-reflow.test.ts |
| restart during repair / rollback | ⚪ NOT-RUN（需 live provider 会话 + GUI；回滚由 change-points 测试覆盖） | tests/unit/change-points.test.ts |
| 收敛基于真实证据、无需人工“继续” | ✅（A–D 全程无人干预；12–20 min/类 自动闭环） | evidence/engineering/seeded-*.json |

## 20.3 Microtask

| 项 | 状态 | 证据 |
|---|---|---|
| 语义 DAG / dependencies / retry / replan / restart 不重复副作用 | ✅ DETERMINISTIC-PASS | tests/unit/microtask*.test.ts、plan-microtask-spine.test.ts、engineering-runtime.test.ts |
| 并行执行 + 写冲突检测 | ✅（read 并行、重叠 write 串行、绝无 silent race） | tests/unit/microtask-parallel.test.ts |
| 1/3/5 worker scaling | ✅ | engineering-runtime worker cap 1..5 |

## 20.4 Research

| 项 | 状态 | 证据 |
|---|---|---|
| Human RQ immutable | ✅（SCOPING 锚定 + 冻结哈希守卫） | research-conductor.scoping / protocol-manager |
| 真 source retrieval / metadata verify | ✅（OpenAlex/Crossref host pass；AI 自证引用被隔离） | tests/unit/host-literature.test.ts；evidence 实时冒烟 200 |
| protocol 生成 + methodology review + baseline provenance | ✅（METRICS_META 声明优先；proportion→random-chance 0.5；其余 fail-closed） | tests/unit/research-protocol-provenance.test.ts |
| 实验自动生成 + 编译/测试（无预置 bench） | ✅（experimentCoder seam + dry-run metric contract） | tests/unit/experiment-generation.test.ts |
| 真实 primary run + replication + 确定性统计 + effect size/permutation | ✅（宿主确定性；真实子进程执行） | run-analysis + tests/unit/research-statistics-extras.test.ts |
| claim graph / citation audit / manuscript（域无关 writer + 独立 reviewer veto） | ✅ | evidence-graph、citation audit、manuscript-domain-neutral + reviewer council（tests/unit/manuscript-domain-neutral.test.ts） |
| paper.tex/paper.pdf/final audit PASS | ⚪ NOT-RUN（需 TeX 引擎 + 真实运行链；9-8 曾 E2E-C PASS） | Update-Log 2026-09-07 |
| 三域（SE / orchestration / writing）README | ⚪ NOT-RUN（需 live provider 会话） | — |

## 20.5 History / 20.6 Recovery

| 项 | 状态 | 证据 |
|---|---|---|
| 本地历史持久 / remote URL 记录 | 🟢 LIVE-9-8（历史/会话台账） | Update-Log |
| Work fresh / Chat 延续 / 外部归档自动+retry+verify | ✅（生产接线：任务完成→ARCHIVE_PENDING→recovery 调度→验证才 ARCHIVED；适配器缺失时保持 pending 可见） | tests/unit/external-archive-automation.test.ts + main.ts wiring |
| delete manual-only | ✅（删除需显式确认路径） | 既有 §13 守卫 |
| Provider timeout/auth/rate-limit/timer wake/Electron restart | ✅/🟢（RecoveryScheduler durable + wake；restart smoke 见 20.7） | recovery-scheduler + main.ts smoke |
| interrupted coder/experiment/archive、stale task | ⚪/部分（durable ledger+revalidate 已覆盖；跨重启 RUNNING 协商需 GUI） | task-ledger/engineering-runtime |

## 20.7 Release Gate（§27）

| Gate | 状态 |
|---|---|
| typecheck PASS | ✅ |
| full deterministic tests PASS | ✅ 113/113（tests/unit/*，含 git/嵌套重型用例） |
| build PASS（vite + tsc electron） | ✅ |
| seeded regression（§17.6） | ✅ A–D PASS |
| portable + smoke / restart smoke | ✅ 本分支已重验：`package:portable` 成功 + `smoke-portable.ps1` **PACKAGED_SMOKE_PASS**；`scripts/acceptance-restart.cjs` **CONTROLLED_ELECTRON_RESTART PASS**（独立进程、attempts 1、final 可见）；应用启动冒烟 PASS | evidence/restart/*.json、evidence/release/*.json |
| Zero critical known defects | ✅（无 P0 类静默数据丢失/假完成路径；归档与 citation 均 fail-closed） |
| Known limitations | ⚪ 见下节（live provider、per-provider DOM 归档、TeX、soak、多域 READY） |

## Known Limitations（§27，诚实记录）
1. Live AI-coder/council E2E、外部网页“点击归档”自动化、paper.pdf 编译、多域 Research READY、multi-hour soak 需要真实登录的 provider 会话与 GUI 环境；本工作区仅能确定性验证其 seam 与状态机（均已测试）。
2. 无 GUI 环境的 restart/portable smoke 按环境记录；9-8 云端 CI 已绿。
