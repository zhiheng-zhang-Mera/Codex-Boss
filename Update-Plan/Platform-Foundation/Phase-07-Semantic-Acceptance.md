# Phase 07 — Objective Satisfaction / Semantic Acceptance 工程书

> **RECONSTRUCTED BOOK — NOT AN ORIGINAL.**
>
> This phase book did **not** exist in the repository. `Update-Plan/Platform-Foundation/` contained
> Phases 01–06 only, and a repository-wide search for "Phase 07" returned no phase definition — the hits
> were all the unrelated *research* Phase 7.
>
> It is **recovered**, not invented, from the phase that immediately precedes it and from the evidence
> that phase actually produced:
>
> 1. **Phase 06's real dogfooding result.** A goal-driven run reached `CONVERGED` on a generated test whose
>    round-trip case passed an **empty** array. The platform had verified that a check *passes*, not that
>    it *asserts* anything, and said so itself as `PF-DEBT-011` — recorded as an evidence-tier note
>    precisely because the host cannot make that judgement and should not pretend to.
> 2. **Phase 06's known-issues log**, whose `PF-DEBT-011` entry names this phase as its revisit target and
>    names the one mechanism that would close it: a downstream quality gate that reads the change against
>    the objective.
> 3. **Phase 05's economics adjudication**, which is binding here: the optional Agent review stage measured
>    `COST_ONLY` and is therefore **not** in the default pipeline. Closing this gap by adding a reviewer
>    Agent by default would reopen a settled decision, so it is forbidden.
>
> **Provenance rule.** No task below introduces a capability the Foundation plan did not already call for.
> Where a task closes a gap, the gap is cited. Where this book is silent, that is deliberate. Anything
> found during construction that is out of scope goes to `docs/platform-foundation-known-issues.md`.

> **前置分支：** `platform-foundation/06-dogfooding-closure`
>
> **本阶段分支：** `platform-foundation/07-semantic-acceptance`
>
> **BASE_SHA：** `e135f8c54fbe9dcc448c2d8f05611d344d7291a4` (Phase 06 certified FINAL_HEAD)
>
> **阶段原则：** 本阶段不再增加“跑得通”的证明，而是让平台能够区分**有意义的证据**与**空转的绿色**。
> Phase 06 证明了代码能编译、测试能通过、diff 干净；Phase 07 要证明这些绿色**确实覆盖了目标所声称的东西**。

## 1. 目标

为 engineering goal loop 建立 first-class acceptance model：

```text
Objective
  ↓
AcceptanceClaims[]       可验证陈述（不是命令结果）
  ↓
EvidenceObligations[]    什么证据足以支持该 claim
  ↓
ObservedEvidence[]       实际观察到的证据
  ↓
SatisfactionResult       SATISFIED | INSUFFICIENT_EVIDENCE | CONTRADICTED
```

并使 `CONVERGED` 不再仅意味着“检查通过”，而意味着**目标已被证据支持**。

## 2. 绝对约束

- **不得用数量冒充质量。** `tests > 0`、`assertions > 0`、覆盖率百分比、文件存在、`exit 0` **不得**作为
  semantic acceptance。它们可以作为 weak signal 被记录，但结构上不能使任何 mandatory claim 成立。
- **不得重新打开 Phase 05 的 `review = COST_ONLY` 结论。** 不得以“默认增加 reviewer Agent”来关闭本阶段缺口。
  任何新增 Agent stage 继续受既有 economics guard 管理。
- **deterministic-first。** 判定必须来自结构化、可审计的证据。模型可以协助**提取** candidate claims、
  **提议** obligations、**生成** tests，但“是否达到 acceptance”不得由模型“感觉可以”决定。
- **fail closed。** 不确定即 `INSUFFICIENT_EVIDENCE`，不得默认放行。
- **不得弱化既有安全条件。** mutation/scope/root-authority guard 不弱化；mandatory platform gate 不被
  economics 移除；`CONVERGED` 仍必须基于 non-empty applied change。
- **不得修改 `main`，不得进入 Phase 08。**

## 3. 施工任务

### Task A — The acceptance contract

建立 `Objective → AcceptanceClaim → EvidenceObligation → ObservedEvidence → SatisfactionResult`。

- **AcceptanceClaim** 必须是**可验证陈述**，例如 *"the serializer round-trips arbitrary supported
  values"*，而**不是** *"the test command exits 0"*。后者无法表达为该结构，这是刻意的。
- **EvidenceObligation** 声明什么证据足以支持 claim，种类按**证据形状**而非数量划分：non-empty cases、
  boundary cases、error cases、invariant、regression suite、static check、contradiction check。
  形状之间不可互换——需要 non-empty 证据的 claim 不能由 error-case 证据满足。
- **ObservedEvidence** 记录实际获得的东西，其中一个字段是决定性的：`discriminating`——
  **该证据在 claim 为假时是否可能失败**。不能失败的东西不是证据。
- **SatisfactionResult** 三值，且矛盾优先：一条 discriminating 的失败证据使 claim `CONTRADICTED`，
  无论有多少绿色都不能翻盘。

### Task B — Deterministic assertion-shape reading

判定“这个测试是否可能失败”必须**读源码**得出，而不是问模型。要求：

- 读取 assertion sites，把每个操作数归约为形状：`empty-literal` / `empty-collection` /
  `non-empty-literal` / `variable` / `unknown`；
- 解析文件自身的简单赋值（`const interventions = []` 后再传入），因为**空转往往藏在一步之外**；
- 识别 `echoOfInput`：断言把结果与**输入本身**比较（`expect(result).toEqual(input)`）——这是唯一能被
  “丢弃/篡改输入”的实现反驳的形状；而对常量的断言（`expect(result).toEqual({status:"ok"})`）不能被反驳；
- **失败模式必须是 `unknown`，而不是错误的“强”。** 读不出的断言一律按非 discriminating 处理，因此永远不能
  被计为证据。

### Task C — `CONVERGED` semantics

```text
CONVERGED =
  valid change
  + checks green
  + scope valid
  + mandatory platform verification PASS
  + objective acceptance SATISFIED
```

- 现有四条**一条都不能少**；
- 新增的第五条要求所有 mandatory claims 均有足够 evidence；
- 若 objective acceptance 为 `INSUFFICIENT_EVIDENCE` 或 `CONTRADICTED`，则 goal loop 的结果**不是**
  `CONVERGED`，并必须报告具体缺口；
- advisory claims 只报告、不阻塞。

### Task D — Counterexample dogfooding（本阶段的核心验收）

只证明好路径不算完成。必须建立四类**真实或代表性**案例：

| 案例 | 构造 | 期望 |
| --- | --- | --- |
| **A** vacuous green | 测试绿，但只覆盖空输入 | `INSUFFICIENT_EVIDENCE` |
| **B** meaningful evidence | 覆盖目标要求的正常输入、非空输入与关键 invariant | `SATISFIED` |
| **C** explicit contradiction | 测试或检查证明目标未达到 | `CONTRADICTED` |
| **D** no evidence | 代码变了，但没有能支持 acceptance claim 的证据 | `INSUFFICIENT_EVIDENCE` |

**A / C / D 是本阶段的核心，不是 B。** 一个只会对好证据说 SATISFIED 的实现没有解决 PF-DEBT-011。

### Task E — Inherited regression

继承并持续验证 Phase 01–06 的全部 contract（见 §6），在最终 head 运行完整 inherited regression。

## 4. 明确不做

- **不新增业务大功能。**
- **不引入第二个 LLM 作为默认 judge。** 模型只做提取/提议/生成，不做最终判定。
- **不以“多一层审查”替代语义判定。** Phase 05 已判定 review `COST_ONLY`。
- **不建立覆盖率门槛。** 覆盖率是 proxy，本阶段明确禁止其作为 acceptance。
- **不弱化任何既有测试或安全约束。**

## 5. 验收门槛

1. Phase 01–06 全部门槛继续通过（exact head 重跑）。
2. acceptance contract 存在且 deterministic：同一组 evidence 重复判定得到同一结果。
3. **A 案例**：只覆盖 `roundTrip([])` 的绿色测试产出 `INSUFFICIENT_EVIDENCE`，**不是** `CONVERGED`。
4. **C 案例**：一条 discriminating 的失败证据产出 `CONTRADICTED`，且不被任何数量的绿色翻盘。
5. **D 案例**：有变更但无支持证据产出 `INSUFFICIENT_EVIDENCE`。
6. **B 案例**：覆盖非空输入与 invariant 的证据产出 `SATISFIED`。
7. `CONVERGED` 的语义已更新，且 §3 Task C 的五条全部为必要条件；Phase 06 的四条安全条件未被弱化。
8. proxy（tests>0 / assertions>0 / coverage / 文件存在 / exit 0）**结构上**不能使 mandatory claim 成立。
9. 反例 A/B/C/D 有真实运行证据，落盘可审计。
10. 输出 `artifacts/platform-foundation/phase-07/` 下的阶段证据与状态记录。

## 6. Inherited contracts（Phase 01–06 封存，Phase 07 不得破坏）

1. mandatory platform gate 与 optional Agent stage 分离；
2. `verify` 是 mandatory contract gate，不参与 Agent economics；
3. optional Agent stage 受 economics guard 管理；
4. `executedStages` 是新 ledger 的 authoritative stage provenance；
5. pre-trace ledger 才允许 inference fallback；
6. real-provider economics provenance 不得用 fixtures 替代；
7. provider token usage 与 heuristic token estimate 必须分离；
8. task-grain 与 stage-grain measurement 必须分离；
9. `COST_ONLY` 是合法完成 verdict；
10. mandatory gate 不得被 economics adjudicate 掉；
11. platform certificate 的 COMPLETE/PARTIAL 必须从真实 section 状态推导，不得硬编码；
12. capability coverage 27/27 不得回退；
13. engineering goal loop 不得追逐 pre-existing failures；
14. mutation / scope / root-authority guard 不得弱化；
15. `CONVERGED` 必须基于 non-empty applied change；
16. local evidence 不得冒充 remote CI。

**冲突处理规则：** 若 Phase 07 的任何改动与上述 contract 冲突，**优先保持已认证 contract**，并把冲突作为
architecture issue 记录与上报，而不是静默改写既有结论。

## 7. 回滚规则

- 失败回到 Phase 06 FINAL_HEAD `e135f8c`。
- 若 semantic acceptance 使**真实、有意义的**工作被判 `INSUFFICIENT_EVIDENCE`，必须先确认是判定过严还是证据
  确实不足；**不得通过放宽判定来让案例通过**。判定过严要修判定并留下反例测试。
- 若为了通过 B 案例而弱化 A/C/D 案例，本阶段判 FAIL。
- 若任何 inherited contract 被破坏，本阶段判 FAIL，而不是把 Phase 06 的结论改成与新行为一致。

## 8. 完成定义

Phase 07 完成时，平台不再只能说“检查通过了”，而能说：**这些检查确实覆盖了目标所声称的东西**——并且当它们
没有覆盖时，平台会明确说 `INSUFFICIENT_EVIDENCE` 或 `CONTRADICTED`，而不是给出一个绿色的 `CONVERGED`。
