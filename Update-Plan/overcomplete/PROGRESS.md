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

### P1.1 Host-backed literature retrieval（§9.3–§9.5）
- `electron/research/literature/host-retrieval.ts` — 真实检索（OpenAlex/Crossref，注入 fetch 可离线确定性测试）、元数据校验、摘要/文本获取、机械 passage 定位（禁止 AI 自证引用 §3.7）；失败诚实记录、绝不编造。
- `research-conductor` LITERATURE_REVIEW：先跑 host pass，仅 host 无结果时 AI 兜底（AI 文本只是 advisory，不当作外部来源）；`main.ts` 已接 OpenAlex。
- 测试：`tests/unit/host-literature.test.ts`；真实网络冒烟 200 OK。

### P1.2/1.3 Experiment generation coder seam（§9.9）
- `research-conductor` EXPERIMENT_GENERATION：无预置 benchmark 时由 experimentCoder 依据冻结协议 spec 生成 `experiments/bench-*.js`，host dry-run 校验必须真实输出冻结主指标（metric contract fail-closed，毒化文件删除）。
- 测试：`tests/unit/experiment-generation.test.ts`。

### P1.4 Baseline provenance 泛化（§9.8）
- `shared/research-protocol.inferBaselineProvenance`：实现可 `METRICS_META {"baseline","source"}` 声明真实基准；proportion 类指标用命名 random-chance 0.5；其余一律 fail-closed，不再无解释固定 0.5。
- conductor probe 解析声明；`baseline-provenance.json` 落盘。
- 测试：`tests/unit/research-protocol-provenance.test.ts`。

## 验证快照（本工作区）
- typecheck：PASS（双 tsconfig）。
- vitest 全量快速套件：110/110 PASS（24 文件，含 Round 3 新增 6 例）。
- seeded acceptance：A/B/C/D PASS（见 evidence JSON）。
- build（typecheck+vite+tsc electron）：PASS。

## Round 3 追加（2026-09-08）
- **P1.5 域无关 manuscript（§9.15）**：`makeSectionWriter` abstract/intro/methods/discussion/conclusion 全部改为由真实 RQ/假设/指标/baseline/CI/protocol 推导，删除硬编码 “AI 评审 vs majority-vote benchmark” 叙事；标题由问题生成（`headlineFor`）。测试 3 例。
- **P1.5 paper reviewer council（§9.16）**：manuscript 阶段先跑独立 reviewer（fresh turn，method/evidence/writing 视角，对 digest 表决）；真实 veto → 阶段失败关闭；reviewer 缺失/不可解析 → 记录 not-attempted，绝不当作通过；结论持久化 `manuscript-review.json (aiCouncil)`。
- **P1.7 wait read-model（§12.3）**：`renderer/state` 提供 `nextActionLabel` + `waitingLine`；任务行统一显示 `原因 · 等待到 <time> · 下一动作`。测试 3 例。

## 已知限制（诚实记录，§27）
- 生产 implement/review 需可用 runtime（Web 登录会话 / API key / Codex CLI）；本环境无真实 provider 会话，live AI-coder E2E 需 GUI 登录态（live acceptance runner 模式）。
- 外部归档的真实“点击归档+页面验证”需每 provider DOM 适配器；未实现适配器时记录保持 ARCHIVE_PENDING（可见、不假归档）。
- experimentCoder / paper council 需 live provider 注入（确定性 seam + 测试已覆盖；GUI wiring 待做）。
- Bug E、restart-during-loop、5-AI council、Research 三域 READY、multi-hour soak 属后续轮次/需真实会话。

## 下一优先级（按 §23 顺序）
1. P2.1 右侧 rail/panel 收纳 + Research UI 折叠（§15）
2. P2.2 CI tier + restart smoke（§17.3/17.4）+ Phase 5 evaluation registry（§10）
3. 失败注入/soak（§22）
4. Final Acceptance Matrix + 文档/README/Update-Log + 推送分支
