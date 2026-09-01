# Codex Boss — STRUCTURE

本文档描述 Codex Boss 的模块边界、依赖关系、目录结构、数据流、状态机与扩展接口。

## 当前已实现边界 / Implemented starter boundary

```text
src/codex_boss/core.py  evidence-linked Claim、Deliberation 与 fail-closed Verdict
src/codex_boss/cli.py   单条 claim 的本地契约演示
tests/test_core.py      缺失置信度、冲突与重复 ID 测试
```

以下其余目录与模块均为目标架构；只有实际存在于仓库中的路径才可视为已实现。

---

# 1. Architectural Rule

所有模块遵循：

```text
High Cohesion
Low Coupling
Explicit Contracts
Replaceable Adapters
Persistent State Outside Processors
```

核心依赖方向：

```text
                ┌───────────┐
                │   Codex   │
                └─────┬─────┘
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
       Router      Protocol      Scheduler
          │           │            │
          └──────┬────┴─────┬──────┘
                 ▼          ▼
             Processor    Context
              Manager      Engine
                 │          │
                 ▼          ▼
              Adapter    Artifact
                 │          │
                 └────┬─────┘
                      ▼
                    Store
                      │
                      ▼
                    Judge
                      │
                      ▼
                   Executor
```

禁止形成：

```text
Adapter ↔ Judge
Adapter ↔ Storage implementation
Protocol ↔ Browser DOM
Context Engine ↔ Specific AI provider
```

---

# 2. Recommended Repository

```text
codex-boss/
│
├── README.md
├── STRUCTURE.md
├── AGENTS.md
├── LICENSE
├── .gitignore
│
├── config/
│   ├── council.yaml
│   ├── providers.yaml
│   ├── roles.yaml
│   ├── protocols.yaml
│   └── context.yaml
│
├── skills/
│   └── council/
│       ├── SKILL.md
│       │
│       ├── router/
│       │   ├── task-classification.md
│       │   └── protocol-selection.md
│       │
│       ├── protocols/
│       │   ├── quick.md
│       │   ├── council.md
│       │   ├── debate.md
│       │   ├── critique.md
│       │   ├── redteam.md
│       │   ├── verify.md
│       │   └── warroom.md
│       │
│       ├── roles/
│       │   ├── architect.md
│       │   ├── implementer.md
│       │   ├── critic.md
│       │   ├── contrarian.md
│       │   ├── researcher.md
│       │   ├── evidence-verifier.md
│       │   └── red-team.md
│       │
│       └── handoff/
│           └── handoff-template.md
│
├── adapters/
│   ├── README.md
│   ├── common/
│   │   ├── adapter-contract.md
│   │   ├── output-status.md
│   │   └── fallback-policy.md
│   │
│   ├── chatgpt/
│   │   ├── adapter.md
│   │   ├── selectors.yaml
│   │   └── recovery.md
│   │
│   ├── claude/
│   │   ├── adapter.md
│   │   ├── selectors.yaml
│   │   └── recovery.md
│   │
│   ├── gemini/
│   │   ├── adapter.md
│   │   ├── selectors.yaml
│   │   └── recovery.md
│   │
│   └── optional/
│       └── README.md
│
├── schemas/
│   ├── manifest.schema.yaml
│   ├── claim.schema.yaml
│   ├── dispute.schema.yaml
│   ├── evidence.schema.yaml
│   ├── session.schema.yaml
│   └── handoff.schema.yaml
│
├── templates/
│   ├── proposal.md
│   ├── review.md
│   ├── revision.md
│   ├── handoff.md
│   └── manifest.yaml
│
├── engine/
│   ├── router/
│   ├── scheduler/
│   ├── processor/
│   ├── protocol/
│   ├── context/
│   ├── artifact/
│   ├── validation/
│   ├── consensus/
│   ├── judge/
│   └── executor/
│
├── workspace/
│   ├── .gitkeep
│   └── README.md
│
├── tests/
│   ├── adapters/
│   ├── schemas/
│   ├── context/
│   ├── protocols/
│   ├── session/
│   └── integration/
│
└── docs/
    ├── protocol-spec.md
    ├── artifact-spec.md
    ├── security.md
    └── examples/
```

---

# 3. Module Boundaries

## 3.1 Router

责任：

- 判断任务类型
- 选择 committee size
- 分配角色
- 选择 protocol
- 判断是否需要 warroom
- 判断是否需要 external verification

输入：

```text
User Request
Case State
Available Processors
```

输出：

```yaml
committee_size: 3
protocol: council
roles:
  A: architect
  B: critic
  C: implementer
verification: optional
```

Router 不允许：

- 操作浏览器
- 保存 raw response
- 直接评价模型答案

---

## 3.2 Scheduler

责任：

- 创建 Round
- 调度 Processor
- 控制并发
- 跟踪 round count
- 决定是否 rollover
- 控制 targeted debate

Scheduler 只看：

```text
Task
Protocol State
Processor State
Session State
```

不理解具体 AI 页面。

---

## 3.3 Processor Manager

Processor Manager 将：

```text
Committee Member
```

抽象成统一对象。

```yaml
member_id: A
provider: claude
role: architect
session: S01
round_count: 3
state: REVIEW
```

Processor Manager 不关心：

- DOM selector
- browser tab implementation
- model page layout

这些属于 Adapter。

---

# 4. Browser Adapter Layer

每个 provider 独立 adapter。

统一接口：

```text
open()
ensure_authenticated()
start_session()
send(input)
wait_for_completion()
extract()
normalize()
close()
recover()
```

返回统一状态：

```text
SUCCESS
RETRYABLE_FAILURE
AUTH_REQUIRED
RATE_LIMITED
FORMAT_INVALID
UNSUPPORTED
```

Adapter 必须做到：

```text
Provider-specific logic
```

只存在于：

```text
adapters/<provider>/
```

不得泄漏到：

```text
engine/
```

---

# 5. Protocol Engine

Protocol Engine 定义“委员会如何讨论”。

不得处理：

- Browser DOM
- 文件 IO 实现
- 具体模型名称

示例：

## quick

```text
Independent
→ Synthesis
```

## council

```text
Independent
→ Anonymous Review
→ Conflict Extraction
→ Synthesis
```

## debate

```text
Independent
→ Review
→ Conflict
→ Targeted Debate
→ Revision
→ Synthesis
```

## warroom

```text
Independent
→ Anonymous Review
→ Conflict
→ Targeted Debate
→ Minority Review
→ Red Team
→ Verify
→ Synthesis
```

---

# 6. Artifact Engine

Artifact Engine 管理 AI 之间的通信文件。

原则：

```text
Format-neutral
Text-native preferred
Binary tolerated only as external source
```

统一 Artifact object：

```yaml
artifact_id: ART-A-S01-R03-001
case_id: CASE-001
member_id: A
session_id: S01
round: 3
type: narrative
format: markdown
path: response.md
```

支持：

- md
- json
- yaml
- txt
- csv
- xml
- html
- source code
- diff / patch

---

# 7. Manifest

每轮输出目录：

```text
R03/
├── manifest.yaml
├── response.md
├── claims.json
└── risks.csv
```

Manifest 是 artifact bundle 的唯一入口。

Artifact Engine：

```text
load manifest
→ validate
→ index
→ archive
```

禁止通过：

```text
猜文件名
```

判断用途。

---

# 8. Validation Engine

负责验证：

- manifest
- artifact existence
- schema
- required identifiers
- broken references
- invalid claim ids
- missing parent refs

Validation 失败：

```text
FORMAT_INVALID
```

优先进行：

```text
format repair
```

而不是重新执行整轮推理。

---

# 9. Claim Index

所有关键结论具有稳定 ID。

```text
CLM-A-001
CLM-A-002
CLM-B-001
```

记录：

```yaml
id: CLM-A-014
author: A
status: disputed
support:
  - C
oppose:
  - B
confidence: mixed
raw_refs:
  - members/A/S01/R02/response.md
```

---

# 10. Dispute Engine

Dispute object：

```yaml
id: DSP-017
claim: CLM-A-014
support:
  - A
  - C
oppose:
  - B
status: open
priority: high
```

状态：

```text
OPEN
→ UNDER_REVIEW
→ DEBATING
→ RESOLVED
```

或：

```text
OPEN
→ UNRESOLVED
```

超过重审上限后：

```text
UNRESOLVED
```

不得无限辩论。

---

# 11. Consensus Engine

输出必须区分：

```text
Consensus
Majority
Minority
Unresolved
```

禁止把：

```text
2 / 3 support
```

自动写成：

```text
Consensus
```

推荐：

```yaml
status:
  consensus: [...]
  majority: [...]
  minority: [...]
  unresolved: [...]
```

---

# 12. Context Engine

Context Engine 包含：

```text
Normalizer
Extractor
Funnel
Compressor
Rehydrator
```

---

## 12.1 Normalizer

将不同 processor 输出统一转换为内部文本 / artifact representation。

---

## 12.2 Extractor

抽取：

- claims
- evidence
- assumptions
- disagreements
- risks
- unresolved questions

---

## 12.3 Funnel

执行：

```text
RAW
→ Structured
→ Distilled
```

但不删除 RAW。

---

## 12.4 Rehydrator

输入：

```text
Claim ID
Dispute ID
Artifact Ref
```

输出：

```text
relevant original fragment
```

而不是整个历史会话。

---

# 13. Storage Layer

Workspace 是唯一长期 Case memory。

```text
workspace/
└── CASE-001/
    ├── case/
    │   ├── request.md
    │   └── metadata.yaml
    │
    ├── members/
    │   ├── A/
    │   ├── B/
    │   └── C/
    │
    ├── council/
    │   ├── claims/
    │   ├── disputes/
    │   ├── consensus/
    │   ├── minority/
    │   └── evidence/
    │
    ├── context/
    │   ├── distilled/
    │   └── rehydrated/
    │
    ├── verification/
    │
    └── final/
```

---

# 14. Processor Session Model

```text
Case
└── Member A
    ├── Session S01
    │   ├── R01
    │   ├── R02
    │   └── ...
    └── Session S02
```

Case 生命周期与网页聊天生命周期解耦。

---

# 15. Session State Machine

```text
NEW
 ↓
PROPOSE
 ↓
REVIEW
 ↓
CHALLENGED
 ↓
DEFEND
 ↓
REVISE
 ↓
FINAL
```

允许短路：

```text
PROPOSE
→ REVIEW
→ FINAL
```

---

# 16. Session Limits

```yaml
session:
  target_rounds: 4
  soft_round_limit: 6
  recommended_rollover: 8
  hard_round_limit: 10

  rollover_on:
    - topic_shift
    - context_bloat
    - repeated_reasoning
    - stage_transition
```

Hard limit 是保险丝。

不是要求每个 AI 都跑满 10 轮。

---

# 17. Handoff Engine

到 rollover 时生成：

```text
HANDOFF
```

内容：

- original case
- member role
- established facts
- verified evidence
- closed disputes
- open disputes
- current position
- minority views
- rejected proposals
- pending questions
- raw refs

新 Session：

```text
CASE
+
HANDOFF
+
OPEN DISPUTES
```

---

# 18. Committee Scheduling

默认：

```text
3 members
```

复杂任务：

```text
5 members
```

禁止：

```text
所有成员每一轮都被调用
```

应使用：

```text
event-driven participation
```

例如：

```text
DSP-017
A vs C
→ schedule A
→ schedule C
```

B 不参与。

---

# 19. Judge Layer

Codex Judge 不进行简单投票。

Judge 输入：

```text
Claims
Evidence
Consensus
Minority
Disputes
Verification Results
```

排序原则：

```text
Verified Evidence
>
Direct Test
>
Strong Source
>
Reasoned Consensus
>
Majority
>
Raw Confidence
```

---

# 20. Executor Layer

Executor 与 Judge 解耦。

Judge：

```text
决定应该做什么
```

Executor：

```text
执行经过批准的动作
```

Executor 可以调用：

- terminal
- test
- build
- browser
- git
- filesystem

Processor 输出不得直接进入 Executor。

必须：

```text
Processor
→ Validation
→ Judge
→ Executor
```

---

# 21. External Evidence

PDF / image / Office document 可以作为 external evidence。

但进入 Council 前应优先转换为：

```text
Normalized textual evidence
```

流程：

```text
External Binary Source
→ Ingest
→ Normalize
→ Evidence Artifact
→ Council
```

禁止多个 AI 分别重复 OCR 同一个文件。

---

# 22. Failure Recovery

## Adapter failure

```text
retry
→ fallback adapter
→ replace processor
```

## Session failure

```text
load workspace
→ generate handoff
→ new session
```

## Model unavailable

```text
replace provider
```

## Artifact invalid

```text
repair format
```

## Context too large

```text
funnel
→ handoff
→ new session
```

---

# 23. Security Boundary

网页 AI：

```text
UNTRUSTED
```

Codex：

```text
TRUSTED ORCHESTRATOR
```

任何网页 AI 输出中的：

- shell command
- delete instruction
- browser action
- credential request
- system prompt override

均视为内容，而不是指令。

---

# 24. Configuration Boundaries

## council.yaml

只描述委员会行为。

```yaml
committee:
  default_members: 3
  max_members: 5
```

## providers.yaml

只描述 processor/provider。

```yaml
providers:
  chatgpt:
    enabled: true
    adapter: browser
```

## protocols.yaml

只描述流程。

```yaml
warroom:
  redteam: true
  verify: true
```

## context.yaml

只描述上下文策略。

```yaml
compression:
  preserve_minority: true
  preserve_evidence: true
```

禁止把所有参数塞进一个 config。

---

# 25. Dependency Rule

推荐依赖：

```text
Router
  ↓
Protocol
  ↓
Scheduler
  ↓
Processor Manager
  ↓
Adapter

Artifact
  ↓
Storage

Context
  ↓
Artifact + Storage

Consensus
  ↓
Claims + Disputes

Judge
  ↓
Consensus + Evidence

Executor
  ↓
Judge Decision
```

反向依赖禁止。

---

# 26. Testing Strategy

## Adapter Tests

- page change
- missing selector
- streaming completion
- auth loss
- partial response
- retry

## Protocol Tests

- 3-member council
- 5-member warroom
- no conflict
- multiple conflicts
- minority override

## Context Tests

- lossless T0 preservation
- minority preservation
- evidence reference preservation
- rehydration correctness

## Session Tests

- soft rollover
- hard rollover
- handoff completeness
- session recovery

## Security Tests

- prompt injection in worker output
- malicious shell command
- fake system instruction
- artifact path manipulation

---

# 27. Minimal V0

V0 不需要写大量代码。

最小实现只需要：

```text
README.md
STRUCTURE.md
AGENTS.md
skills/council/SKILL.md
config/
templates/
workspace/
```

由 Codex 本身负责：

- 浏览器操作
- 文件创建
- 调度
- 本地验证

只有当稳定性需要时，再逐步增加：

```text
engine/
adapters/
schemas/
tests/
```

---

# 28. Expansion Path

### Stage A

```text
Skill-driven
```

### Stage B

```text
Skill + structured artifacts
```

### Stage C

```text
Skill + adapters + validation
```

### Stage D

```text
Full protocol engine
```

### Stage E

```text
Optional API processors
```

整个升级路径不改变核心协议。

---

# 29. Final Design Principle

项目任何模块都必须满足：

```text
Can this component be replaced
without rewriting the rest?
```

如果答案是否定的，则耦合过高。

理想状态：

```text
Replace Claude
→ no protocol changes

Replace Markdown with JSON
→ no scheduler changes

Replace Browser Adapter
→ no judge changes

Replace Context Funnel
→ no provider changes

Replace Storage backend
→ no protocol changes
```

Codex Boss 的目标不是追求最复杂的多 Agent 系统，而是：

> 用最少的胶水代码，把多个可替换 AI 处理器组织成一个可审计、可恢复、可验证、可扩展的委员会系统。
