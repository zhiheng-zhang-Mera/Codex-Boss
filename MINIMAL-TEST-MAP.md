# MINIMAL-TEST-MAP — Codex Boss closure（Host-A Phase L）

Retained test = 每个保留测试 → 保护子系统 → 保护 requirement(s) → 为什么必须保留。

裁剪原则（Host-A §14/§15.1）：只保留 GitHub 验证与核心回归真正需要的最低限度；
不得为了缩减数量牺牲关键 acceptance coverage。被裁剪的重型/扩展 suite 仍完整保留在
git 历史中（`git log -- tests/unit/<name>.test.ts`），可随时恢复。

## 1. closure terminal evaluator（终态判定）
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `closure-terminal-logic.test.ts` | 纯终态求值器 / blocker schema / manifest 状态机 | R-1003（+ 全局完成判定） | 唯一决定 COMPLETE / BLOCKED_EXTERNAL / FAILED_TERMINAL / NO_LEGAL_TERMINAL_YET 的逻辑；禁止 `BLOCKED_EXTERNAL_REQUIRED` 伪终态 |

## 2. completion / result validation
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `result-validator.test.ts` | verification seam（MODEL_DONE ≠ COMPLETED） | R-101, L-08 | 缺失/失败门不得 PASS 的核心判定 |
| `gate-runner.test.ts` | 真实 gate 执行（typecheck/build/unit/integration/acceptance/smoke） | R-101 | gate 能力缺失⇒UNAVAILABLE，永不 throw |
| `verification-contract.test.ts` | OWNER_RESULT 默认验证契约 + 失败隔离 | R-101, L-08 | seam v2 端到端（真实执行 + REWORK park） |
| `owner-result-contract.test.ts` | Owner result 契约与不可用语义 | R-101, L-17 | 结果合同层回归 |
| `work-escalation-verdict.test.ts` | Chat→WORK 升级裁决 | L-10 | 升级判定不得静默降级 |

## 3. task state / 持久化
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `task-state-machine.test.ts` | 任务状态机 | L-20 | 状态转移合法性 |
| `task-ledger.test.ts` | 持久 ledger / checkpoint 代际 | L-20, R-901 | 单次 soak 依赖的 durable 语义 |
| `state-waiting.test.ts` | WAITING/PARTIAL 词汇 | L-20 | 阻塞依赖≠全局失败 |

## 4. retry / recovery / 故障隔离
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `recovery-resume-battery.test.ts` | same-job resume after runtime recovery | L-13 | 真实恢复后继续同一 job |
| `recovery-scheduler.test.ts` | durable recovery deadlines | L-13, R-901 | 到点重放与上限 |
| `self-healing-battery.test.ts` | detection / repair lanes / verification gates | L-05 | 修复必须经 verification，不得假修复 |
| `computer-recovery.test.ts` | Computer-Use recovery 分类 | L-06 | 重启/恢复基础路径 |
| `execution-fault-injection.test.ts` | 受控故障注入 | L-11 | 多故障隔离前置 |
| `multi-fault-isolation.test.ts` | 组合故障隔离 | L-11, R-1002 | provider+node+KB+research 同时失败仍可用 |
| `degraded-controller-battery.test.ts` | 模块降级状态机 | L-14 | READY/DEGRADED/FAILED/DISABLED/RECOVERING |
| `human-guidance-gate.test.ts` | 人类指导闸门 durable | L-16 | 单活跃 + fail-closed 恢复 |

## 5. Web-AI readiness / repair
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `action-readiness.test.ts` | 有序 readiness 链 + post-action verify | R-201 | 未就绪不得执行高风险动作 |
| `provider-page-repair.test.ts` | Computer-Use repair 执行器（readiness 默认开） | R-201, R-202 | REPAIRED 计划的真实前置门 |
| `web-recovery-r6.test.ts` | guarded WebRecovery R6 slot | R-202 (L-03 基线) | 恢复槽位接线 |
| `dom-page.test.ts` | DOM tier 后端 | R-201 | DOM 动作路径 |
| `provider-dom-surface.test.ts` | provider DOM 探测面 | R-201 | selector/探测面回归 |

## 6. session lifecycle（Provider→Session→Conversation）
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `session-lifecycle.test.ts` | 六态 durable per-provider ledger | R-203 | 单 provider 过期只降级自身 |
| `conversation-policy.test.ts` | TEMPORARY/REUSABLE/PERSISTENT/AUTO_DELETE | R-204 | 任务级会话策略 |
| `login-scan.test.ts` | 登录状态扫描 + 快速引导（MFA/CAPTCHA externalOnly） | R-205 | 外部人工条件必须显式 |

## 7. standalone / fleet
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `standalone-node.test.ts` | 无 Fleet 单节点完整任务 | R-301 | 单设备独立可用 |
| `node-capabilities.test.ts` | NodeCapabilityRegistry（observed-facts-only） | R-302 | 假能力不得当 READY |
| `capability-router.test.ts` | capability-aware dispatch | R-303 | 不得派给无能力节点 |
| `fleet.test.ts` | fleet 核心（dropout/checkpoint transfer/reroute） | R-401, R-403 | 单节点失败=局部失败域 |
| `fleet-two-node.test.ts` | 双节点联队 + B 中途掉线 | R-402 | 联队不崩、无关任务继续 |

## 8. network / proxy
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `network-policy.test.ts` | direct/system/user/regional 探测 + 回退梯度 | R-501, R-502 | direct 优先；proxy 失败不致 Boss 停机 |

## 9. KB fallback / artifact backbone
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `knowledge-phase-f.test.ts` | 共享 KB + local fallback + deferred sync + append-only artifact | R-601…R-604 | KB down ≠ Boss down；partial failure 不丢 artifact |

## 10. research contract / review / publication
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `research-contract.test.ts` | Research Contract + sufficiency gate | R-701, R-702 | 章节不得绕过 contract |
| `research-review.test.ts` | 六角色 cross-review/rebuttal/revision/meta + publication gate + stage archive | R-703, R-704, R-705 | 结构性 objection→response 闭环 |
| `research-battery.test.ts` | 诚实终态（READY veto / null / insufficient） | L-07 | 假 READY 必须被拒 |
| `research-partial-failure.test.ts` | 阶段失败保留已完成证据 | L-12, R-1001 (Scenario D/E) | 不得清空整个 run |
| `research-wait-policy.test.ts` | WAITING_FOR_USER 拦截 | L-09 | 自动裁决先于 raise |

## 11. self-iteration
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `worker-response.test.ts` | worker vocabulary（无 GLOBAL_COMPLETE）+ 自述降级 | R-801, L-15 | worker 无权宣布全局完成 |
| `engineering-goal-rollback.test.ts` | candidate 失败回滚隔离 | L-15, R-801 | candidate 失败不污染 stable |

## 12. UI isolation / 状态显示
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `ui-isolation.test.ts` | 后台任务不依赖 UI + durable 状态重连读取 | R-902, R-903 | UI 崩溃不影响后台任务 |
| `owner-dashboard.test.ts` | Owner read-model | L-17, R-903 | 模块/节点/降级状态可见 |

## 13. multi-fault acceptance scenarios
| retained test | protected subsystem | protected requirement(s) | why required |
|---|---|---|---|
| `phase-j-scenarios.test.ts` | Scenario E（compile 失败保成果）+ Scenario G（组合故障） | R-1001, R-1002 | 终局故障注入验收 |

---

## 裁剪掉的 suite（仍完整保留在 git 历史）
重型/扩展覆盖（`plan-microtask-spine`、`microtask*`、`evaluation-pack`、`experiment-generation`、
`manuscript-domain-neutral`、`host-literature`、`finding-scope-live-ops`、`external-archive-automation`、
`research-statistics-extras`、`research-protocol-provenance`、`semantic-*`、`workspace-layout`、
`permission`、`decision-ledger`、`autonomy-supervisor`、`change-points`、`intent-compiler`、
`engineering-loop-*`、`engineering-runtime`、`adapters-registry`、`provider-view-profile`、
`owner-result-soak`）— 其保护能力在保留集中以更小的确定性用例覆盖，或属于本 closure 未列为
required 的扩张性能力。任何一项可用 `git checkout <pre-curation-sha> -- tests/unit/<file>` 恢复。

## 验证
- 裁剪前：full regression 全绿（见 `evidence/final-regression.json`，68→69 files / 345 tests）。
- 裁剪后：minimal suite PASS + typecheck PASS + build PASS（见 Phase L 小节与
  `evidence/minimal-suite-regression.json`）。
