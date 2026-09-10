# Closure 施工进度（9-2026-09-09-closure）

## Phase 0 — R43 Baseline Reconciliation（2026-09-09）
- 建分支 `9-2026-09-09-closure`（main @ 825cd1f）；基线门禁复验（typecheck PASS · vitest 51/254 · build PASS）。
- Requirement Manifest（requirement-manifest.json）：20 LOCKED + 23 REQUIRED（R-101…R-1003，含
  LIVE_REQUIRED：R-202 P0-6 live、R-901 >2h soak）。REQUIREMENTS.md / BASELINE-R43.md / evidence 落盘。

## Phase A — R-101 verification seam v2（2026-09-09）
- **PASS**：新增 `electron/engineering/gate-runner.ts`（真实 gate 执行：typecheck=tsc --noEmit、
  build=tsc --build、unit=定向测试、integration=全量扫描、acceptance/smoke=标记文件；能力缺失⇒UNAVAILABLE；
  FAIL/ERROR/UNAVAILABLE 永不 throw）。`result-validator` 增加 unavailable 语义（不可用门不得单独满足计划，
  PASS 至少需一条真实 passed）。`main-commander.runPlan`：OWNER_RESULT 工程计划默认自动附带 verification
  契约（default-on），完成点把每步未覆盖的计划门真实执行并收证据、解析 unavailable、落 durable verdict；
  REWORK park；整个验证块 try/catch 隔离（validator 崩溃不 crash Boss）。finalizer gate 尊重 durable
  unavailable。
- 测试：gate-runner(+3) / result-validator(+3) / verification-contract（seam v2：high PASS+unavailable；
  default-on 自动契约；failing acceptance ⇒ REWORK；legacy 控制）。
- 门禁：typecheck PASS · vitest **52 文件 / 262 测试 PASS** · full build PASS。证据
  `evidence/r101-seam-v2.json`。

## Phase B — R-201 Web-AI action readiness gate（2026-09-09）
- **PASS**：`src/shared/action-readiness.ts`（有序链 NAVIGATION→DOM_READY→TARGET_EXISTS→VISIBLE→ENABLED→
  STABLE→ALLOWED；postActionVerified fail-closed；bounded escalation）。
  `dom-page.ts` DomPageBackend.preflightReadiness：high-risk mutation 前 bounded 探测，未就绪禁止动作。
  `provider-page-repair.ts`：Computer-Use repair 执行器默认启用 readiness。
- 测试：action-readiness(+5)；provider-page-repair（not-ready 阻止动作且无 click；bounded 后就绪继续；
  readiness 先于 mutation；DENIED/UNCERTAIN/failure 路径保留）。
- 门禁：typecheck PASS · vitest **53 文件 / 269 测试 PASS** · full build PASS。证据
  `evidence/r201-action-readiness.json`。

## Phase B — R-203 account/session lifecycle（2026-09-09）
- **PASS**：`src/shared/session-lifecycle.ts`（六态 + 显式转移表 + account-mode 映射）；
  `electron/identity/session-lifecycle-ledger.ts`（durable per-provider/account、隔离、fail-closed）；
  `account-sessions.ts` + `main.ts` 接线（ensure→CHECKING、recordProbe→LOGGED_IN/REAUTH_REQUIRED、
  mount 异常→FAILED）。单 provider 过期不影响其它 provider。
- 测试：session-lifecycle(+6)。门禁：typecheck PASS · vitest **54 文件 / 275 测试 PASS** ·
  full build PASS。证据 `evidence/r203-session-lifecycle.json`。

## Phase B — R-204 conversation policy（2026-09-09）
- **PASS**：`conversation-policy.ts`（TEMPORARY/REUSABLE/PERSISTENT/AUTO_DELETE + 确定性默认）；
  BossTask/CreateTaskInput.conversationPolicy durable；commander createTask 默认（chat PERSISTENT、
  WORK fresh TEMPORARY）与显式选择；IPC 透传。
- 测试：conversation-policy(+2)。门禁：typecheck PASS · vitest **55 文件 / 277 测试 PASS** ·
  full build PASS。证据 `evidence/r204-conversation-policy.json`。

## 下一步
1. R-205 快速登录扫描（登录状态扫描 + 快速引导，MFA/CAPTCHA 外部）；
2. R-302/303 Phase C；R-401/402/403 Phase D；R-501/502 Phase E；
3. R-601…604 Phase F；R-701…705 Phase G；R-801 Phase H；
4. R-902/903 Phase I（UI）；R-901 >2h soak（LIVE）；
5. R-1001/1002 Phase J；R-1003 Acceptance Report。


## Phase D - R-401/R-403 Fleet core + protocol (2026-09-09)
- PASS R-401: shared/fleet.ts (node state machine READY->DEGRADED->OFFLINE, first-fit TaskAssignmentRouter, handleNodeDropout checkpoint transfer/unrelated untouched/unsafe uncheckpointed FAILED) + electron/fleet/federation-coordinator.ts (durable join/heartbeat/refresh/enqueue/checkpoint/mark/reassignAfterDropout, fail-closed).
- PASS R-403: platform-neutral serializable core protocol (no OS/path coupling).
- Tests: fleet(+5). Gates: typecheck PASS, vitest 60 files / 292 tests PASS, full build PASS. Evidence: evidence/r401-fleet-core.json, evidence/r403-fleet-protocol.json.
- Note: requirement-manifest.json rewritten ASCII-safe after historical encoding corruption (validated, 50 entries).

## Next
1. R-402 two-node run (independent processes; B drops mid-run; unrelated continues; checkpoint transfer/reroute);
2. R-501/502 Phase E; R-601-604 Phase F;
3. R-701-705 Phase G; R-801 Phase H;
4. R-902/903 Phase I; R-901 >2h soak (LIVE);
5. R-1001/1002 Phase J; R-1003 Acceptance Report.

---

# Host-A Final Acceptance Execution（branch 9-10-A）

执行依据：`Update-Plan/Host-A.md`。基线 = `8b0675f`（closure baseline；并发 actor 于 09:44–09:45
推送到 `9-2026-09-09-closure` 的两笔提交 `3d35eb3`/`fe8c766` 与 Host-A §2/§6 冲突，已由 Owner 确认
接管纠正，未并入本分支）。

## Phase A — 恢复完整回归面（2026-09-10）
- 从裁剪前 HEAD `ef0cb32^` 恢复 34 个被移除的 unit suite（tracked 34 → 68 文件）。
- 清出 135 个非 tracked 的 stale root-level `tests/*.test.ts`（历史目录结构遗留，vitest
  `tests/**` glob 会误收）到 `.cache/quarantine-root-tests/`（未提交）。
- 门禁：typecheck PASS · vitest **68 files / 312 tests PASS** · full build PASS。
- commit `2a8b064`。

## Phase B/C — terminal evaluator 纯逻辑 + evidence-aware validation
- `scripts/closure-terminal-logic.mjs`（纯逻辑，无 IO）：`evaluateTerminal` 实现 Host-A §4 四种
  合法终态（COMPLETE / BLOCKED_EXTERNAL / FAILED_TERMINAL / NO_LEGAL_TERMINAL_YET）；
  禁止 `BLOCKED_EXTERNAL_REQUIRED` 伪终态；§5 结构化 blocker evidence schema 校验；
  PASS evidence integrity（evidence 非空 + 文件存在）；R-901/R-202 专用 validator；
  manifest 状态机（显式 transition 表 + schema 校验）。
- `scripts/closure-acceptance-report.mjs` 重构为消费纯逻辑，并输出 evidenceProblems。
- commit `ef3d8cb`（18 tests）。

## Phase D — 硬化 R-901 soak harness
- `scripts/r901-soak.cjs`：真实 ExecutionSupervisor + TaskLedger + RecoveryScheduler +
  CircuitBreaker 上的单次连续 run；fail-closed `MIN_ACCEPTANCE_SECONDS=7200`（短跑必须显式
  `--validate-only`，且不得写正式 evidence、不得 PASS）；唯一 run identity（runId/pid/gitHead/
  startedAt/hostId/nodeVersion/harnessVersion）；确定性 10 阶段 fault schedule
  （NORMAL→SLOWDOWN→RETRY→CHECKPOINT_WRITE→CONSECUTIVE_FAILURE→BREAKER_OPEN/DEGRADED→
  FALLBACK_CONTINUATION→CHECKPOINT_RESUME→PROVIDER_RECOVERY→CONTINUED_NORMAL）；计数门限；
  JSONL heartbeat + 连续性证明（wall span / heartbeat gap / task gap）。
  evidence = `r901-<runId>.json` + `r901-<runId>.heartbeat.jsonl`。
- `scripts/start-r901-soak.ps1`：detached durable runner（preflight / duplicate-run lock / PID
  file / runId / stdout+stderr log / -Status / -Stop）。
- validate-only 实测：10 阶段全覆盖、fatalFailed=0、全计数 ≥1。
- commit `e2d62c6`、`30a1658`（CDP fix）、`552ce86`（cooldown 等待修正）、`c119663`（cooldown 心跳分片）。

## Phase E/F — R-202 live harness + manifest single-writer
- `scripts/live-r202-provider-repair.cjs`：真实窗口 bounded 尝试；E1 readiness gate（host /
  非 auth 路径 / composer / authenticated——login CTA 可见即视为未认证，fail-closed）；
  未认证 ⇒ 写 Host-A §5 结构化 BLOCKED_EXTERNAL candidate evidence；已认证 ⇒ 走真实
  automation 路径发送一次 echo 并记录 E4 字段。
- `scripts/closure-set-status.mjs`：唯一 manifest 写入口（read → schema → transition → evidence
  → atomic write → 重生成报告 → re-read → parse verify → change log），支持 `--refresh` 只换证据。
- commit `f10a7a8`、`dc6a471`（含 R-202 证据 refresh）。

## Phase G — full regression
- typecheck PASS · vitest **69 files / 345 tests PASS** · full build PASS。

## Phase H — R-202 live 执行
- 真实运行：renderer ready、provider opened、Qwen 页面加载、preflight 观测到 login CTA
  ⇒ `authenticated=false`（外部 OAuth/MFA 人工登录）。
- 产出 `evidence/r202-live-provider-repair.json`（Host-A §5 schema 完整）；经 single-writer
  refresh 进 manifest；report `evidenceProblems` 为空。
- 终态判定：`NO_LEGAL_TERMINAL_YET`（仅剩 R-901 LIVE_REQUIRED）。

## Phase I — hardened R-901 正式 run（进行中）
- 经 durable runner 启动：runId `2026-09-10T00-33-51Z-2daa9e6e`，pid 30832，gitHead `c119663`，
  target 7200s（formal，cooldown 60s，failureThreshold 5）。agent 只读 evidence/status。

## Phase K — final regression runner
- `scripts/closure-final-regression.mjs`：typecheck ×2 + full unit + full build + manifest/R-202/
  R-901/acceptance-report validators，写 `evidence/final-regression.json`（gitHead、test files/
  count、build 结果、evidence sha256、manifest hash）。commit `78cac05`。
- 待 R-901 完成后执行正式 final regression。
