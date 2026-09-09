# Overcomplete 基线冻结记录（Phase 0 / §5）

> 目的：在 9-8 分支上确认能力基线，避免 Overcomplete 各阶段重构导致稳定能力倒退。
> 冻结时间：2026-09-08（本地执行环境）

## 5.1 工作分支

- 基线分支（冻结）：`9-8` = `origin/9-8` @ `3aefdd8641e6f487fb8d80fd9ef64191297d87d1`
- 开发分支：`9-8-overcomplete`（由 `9-8` 创建，本地）
- 最终推送分支：`<完成日期>-overcomplete`（推送前按完成日期重命名）

## 5.2 基线清单

| 项目 | 值 | 状态 |
|---|---|---|
| 基线 commit SHA | `3aefdd8641e6f487fb8d80fd9ef64191297d87d1`（`docs: clean root, bilingual README...`） | ✅ |
| Node | v24.14.0 | ✅ |
| pnpm | 11.19.0（corepack 激活，Node 内置 corepack 0.34.6） | ✅ |
| Electron | 44.0.0（pnpm install 已拉取二进制） | ✅ |
| TypeScript | 7.0.2 | ✅ |
| Vitest | 4.1.11 | ✅ |
| Vite | 8.2.2 | ✅ |
| Windows | Microsoft Windows NT 10.0.26200.0 | ✅ |
| typecheck | `corepack pnpm run typecheck` → PASS | ✅ |
| 入库测试 | 15 文件 / 70 tests，全部 PASS（14.68s） | ✅ |
| build | `corepack pnpm run build` → 待记录（typecheck + vite build + tsc electron） | ⏳ 记录于下节 |
| 测试分层 | `tests/` 仅含提交子集；无 unit/integration/e2e/live/fixtures 分层 | ⚠️ Phase 12 (§17.1/17.2) 处理 |
| package:portable | `pnpm run package:portable` | ⏳ Phase 12/Release 处理 |
| portable smoke | `scripts/smoke-portable.ps1` | ⏳ Phase 12/Release 处理 |
| CI（云端） | `.github/workflows/ci.yml`：install → install:electron → typecheck → test → build → benchmark → package:portable → smoke | 9-8 云端 CI 全绿（success） |

## 5.3 需保存的 Live E2E acceptance（基线现状记录）

> Live E2E 需要真实网页登录会话与应用内验证通道；本表记录 9-8 已确证状态，供 Overcomplete 轮次防倒退比对。

| 能力 | 9-8 已确证证据 | Overcomplete 轮次内可执行性 |
|---|---|---|
| Chat（延续可见会话） | 真机 CDP E2E PASS（2026-09-08 05:48–07:44，真实 ChatGPT） | 需 GUI + 登录态 |
| Work（fresh conversation → 证据 → final） | 真机 E2E PASS（同上） | 需 GUI + 登录态 |
| Council（proposal → peer review → synthesis） | 结构存在，U3 角色分配引擎 | 需 GUI |
| DOM 真机 surface | `3dce5fc` DOM 真机接线 + microtask spine | 需 GUI |
| Research（human RQ → READY） | E2E-C live acceptance DONE（pdflatex paper.pdf 10/10） | 需 GUI + 引擎 |
| Engineering Goal（clean repo audit → converge） | goal `eng-251ec4b77388` 第 3 迭代 CONVERGED（0 findings，cleanRounds 1/1） | 本机可部分执行（audit/build/test 确定性） |

## 5.4 基线缺口摘要（对应 Overcomplete §30 最优先 TODO）

1. `boss:engineering-goal-run` IPC 不携带 implement/review 生产 worker（函数不可跨 IPC），
   生产路径无 coding editor → 真实 finding 无法自动修复（Overcomplete §6.1/6.4 缺口确认）。
2. 独立 reviewer 与 finding 回流未接入工程循环生产 ops（§6.2/6.3）。
3. Seeded bug E2E（5 类 bug fixture）不存在（§6.5）。
4. Microtask 已有 spine（read/propose/verify 分组），但非“任意语义任务”泛化 DAG、无 planner DAG 验证、
   无真并行 ready-node scheduler（§7）。
5. `/tests/` gitignored、无分层、入库子集仅 15 文件（§17）。
6. `/Update-Plan/` gitignored（证据目录策略需调整，§26）。
