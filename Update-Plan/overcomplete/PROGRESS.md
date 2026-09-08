# Overcomplete 工程进度跟踪（分支 9-8-overcomplete）

> 本文件随每个开发轮次更新；最终以分支 `<完成日期>-overcomplete` 推送。
> 基准：`9-8` @ `3aefdd8`。基线记录见 `baseline.md`。

## 完成单位（每项含确定性证据）

### P0.1 工程生产 coder 接线（§6.1 / §6.4）
- `electron/engineering/finding-scope.ts` — 自动作用域推断（§6.1.2）：仅从失败行提取候选路径 + import 依赖闭包 + 受影响测试；空作用域 fail-closed（绝不整仓编辑）。
- `electron/engineering/live-engineering-operations.ts`（§6.1.1）— 生产 implement（bounded ProposalRunner patch + host 校验）与独立 review（diff + acceptance 证据 + reviewer JSON 信封）。
- `engineering-loop-driver.ts` — review 移到 build/test 之后并携带验收证据；HIGH / significant-MEDIUM reviewer finding 回流为 carried finding 进入下一轮 triage（§6.3）；停滞 / ABORT 纪律保持。
- `main-commander.runEngineeringGoal` — 默认接生产 role-router worker（coder/reviewer 用不同合成 taskId，保证 fresh session 与指纹去重）；IPC/契约增加 workerRuntimes + disableCoder/disableReviewer（§6.4）。
- 测试：`tests/unit/engineering-review-reflow.test.ts`、`tests/unit/finding-scope-live-ops.test.ts`。

### P0.2 Seeded bug 自动修复 E2E（§6.5 / §17.6）
- `scripts/acceptance-seeded-engineering.cjs` — clone 仓库 → 离线装工具链 → 注入真实回归 → 生产链路 audit→implement→build/test→review→converge，证据落 `evidence/engineering/seeded-*.json`。
- 结果：Bug A（TS 编译错）PASS、Bug B（单元回归）PASS、Bug C（逻辑断言错）PASS、Bug D（跨模块契约）PASS；Bug E（reviewer 打回二次修复）由确定性单测覆盖（`engineering-review-reflow`）。
- 证据目录：`Update-Plan/overcomplete/evidence/engineering/`。

### P0.3/0.4 Microtask DAG 泛化与并行（§7）
- `src/shared/microtask.ts` — kind 词表扩为语义全集；读写分类 + 文件作用域重叠判定。
- `microtask-runtime.ts` — ready 批调度：read 类并行（上限并发）、write 类经重叠作用域门串行（绝不 silent race）；语义 DAG 可执行；job 记录 startedAt/completedAt（§7.5）。
- `engineering-runtime.ts` — 微任务并发取 plan.maxWorkers（1/3/5）。
- 测试：`tests/unit/microtask-parallel.test.ts`（并行 read、重叠 write 串行、通用语义 DAG、时间证据）。

### P1.6 外部归档生产接线（§11.3/§11.4）
- `electron/workspace/live-external-archive.ts` — fail-closed live attempt（窗口/账户门 + 可选验证适配器；绝不假归档）。
- `main.ts` — 任务完成触发 ARCHIVE_PENDING → 调度 bounded archive recovery wake；recovery handler 跑 automatePendingExternalArchives 并在仍有 pending 时延长重试；手动 IPC `boss:external-archive-run`。
- 测试：`tests/unit/external-archive-automation.test.ts`。

### P2.2 测试分层入库（§17.1/§17.2）
- 取消 `/tests/` gitignore；确定性子套件分层入库（`tests/unit/**`）；CI 现跑 89+ 用例。

## 验证快照（本工作区）
- typecheck：PASS（双 tsconfig）。
- vitest 全量快速套件：89/89 PASS（`--exclude tests/e2e/**`；tests/e2e 目录保留为占位）。
- seeded acceptance：A/B/C/D PASS（见 evidence JSON）。
- build（typecheck+vite+tsc electron）：PASS。

## 已知限制（诚实记录，§27）
- 生产 implement/review 需可用 runtime（Web 登录会话 / API key / Codex CLI）；本环境无真实 provider 会话，live AI-coder E2E 需 GUI 登录态（live acceptance runner 模式）。
- 外部归档的真实“点击归档+页面验证”需每 provider DOM 适配器；未实现适配器时记录保持 ARCHIVE_PENDING（可见、不假归档）。
- Bug E、restart-during-loop、5-AI council、Research 三域 E2E、multi-hour soak 属后续轮次/需真实会话。

## 下一优先级（按 §23 顺序）
1. P1.1 Research host-backed literature retrieval（§9.3–9.5）
2. P1.2/1.3 experiment designer + coder 生成（§9.9）
3. P1.4 统计（effect size/permutation）+ baseline provenance（§9.8）
4. P1.5 research reviewer council + 域无关 manuscript（§9.15/9.16）
5. P1.7 timer/suspend UI 读模型（§12.3）
6. P2.1 右侧 rail/panel 收纳 + Research UI 折叠（§15）
7. Final Acceptance Matrix + 文档/README/Update-Log + 推送分支
