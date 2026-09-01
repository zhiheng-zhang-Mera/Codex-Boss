# Codex Boss

> A lightweight, zero-API-first, browser-driven multi-LLM deliberation framework orchestrated by Codex.

Codex Boss is a local-first development starter for evidence-preserving multi-model deliberation. The current Python package implements trace-linked claims, explicit uncertainty, duplicate protection, and fail-closed verdicts; browser adapters, provider sessions, orchestration, and execution remain roadmap items.

> **Status / 状态：Pre-alpha starter.** The repository does not claim that web providers are available, that browser automation is reliable, or that multiple models necessarily improve answer quality.

## Quick start / 快速开始

```bash
python -m pip install -e .
python -m unittest discover -s tests -v
codex-boss "candidate proposal" --source raw/proposal-a.md --confidence 0.8
```

The CLI evaluates one evidence-linked starter claim. It does not open a browser, contact an AI service, or execute the resulting proposal.

Codex Boss 将 Codex 作为**主发令员、主持人、调度器、裁判和最终执行者**，把多个已登录的网页版 AI 作为可替换的“委员会处理器”。  
项目重点不是再造一个完整的 multi-agent framework，而是尽可能复用 Codex 已有的浏览器、Computer Use、文件系统、终端与代码执行能力，用最少的额外基础设施实现：

- 多 AI 独立提案
- 匿名交叉审查
- 冲突检测
- 定向辩论
- 少数意见保留
- Context Funnel 上下文漏斗
- Selective Rehydration 选择性回填原始证据
- Session 轮换与 Handoff
- 外部验证与本地实测
- 最终综合与执行

---

## 1. Design Goals

### 1.1 Core Goals

1. **Codex-first**
   - Codex 负责 orchestrate，而不是额外构建一个新的中心服务。
   - 浏览器 AI 只作为外部处理器。

2. **Zero-API-first**
   - 默认通过已登录网页版 AI 工作。
   - API 作为可选 adapter，而不是核心依赖。

3. **Processor Statelessness**
   - 网页聊天不是系统状态的唯一来源。
   - Case 状态保存在本地 workspace 中。

4. **Text-Native IPC**
   - AI 之间优先交换文本原生 artifact。
   - 避免 PDF、JPG、PNG 等需要重新解析或 OCR 的格式作为内部通信载体。

5. **Evidence Preservation**
   - 原始回答永久保留。
   - 压缩只作用于 working context，不删除 evidence store。

6. **Decoupled Architecture**
   - Router、Browser Adapter、Protocol、Artifact、Context、Validation、Storage、Judge、Executor 均独立。
   - 任意 AI 服务、协议、存储层都应可替换。

---

## 2. High-Level Architecture

```text
                         USER
                           │
                           ▼
                  ┌────────────────┐
                  │     CODEX      │
                  │ Master Chair   │
                  └───────┬────────┘
                          │
                    Task Router
                          │
                 Protocol Selection
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
      Processor A     Processor B     Processor C
      Web AI          Web AI          Web AI
          │               │               │
          └───────────────┼───────────────┘
                          ▼
                  Raw Artifact Store
                          │
                          ▼
                    Context Funnel
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
           Claims      Consensus    Disputes
              │                       │
              │                 Minority Views
              │                       │
              └───────────┬───────────┘
                          ▼
                    Peer Review
                          │
                    Conflict Gate
                     /          \
                    /            \
                 resolved      unresolved
                    │              │
                    │        Targeted Debate
                    │              │
                    └──────┬───────┘
                           ▼
                      Codex Judge
                           │
                    External Verify
                           │
                Browser / Test / Code
                           │
                           ▼
                    Final Synthesis
```

---

## 3. Committee Model

### Default Committee

```yaml
committee:
  min_members: 3
  default_members: 3
  max_members: 5
```

建议：

- `3 AI`：默认模式
- `5 AI`：复杂设计、研究、重大决策或 warroom
- Codex 不作为普通投票成员
- Codex 是 Chair / Judge / Executor

### Dynamic Roles

模型与角色不永久绑定。

```text
Model != Role
```

示例角色：

- Architect
- Implementer
- Critic
- Contrarian
- Researcher
- Evidence Verifier
- First-Principles Analyst
- Red Team
- Risk Reviewer
- Synthesizer

由 Router 根据任务动态分配。

---

## 4. Deliberation Protocol

### Phase 0 — Route

Codex 判断：

- 任务类型
- 所需 AI 数量
- 所需角色
- 讨论协议
- 是否需要外部搜索或本地测试

### Phase 1 — Independent Proposal

所有委员**独立回答**，不读取其他委员输出。

目的：

- 减少 anchoring
- 减少从众
- 获取真正不同的初始方案

### Phase 2 — Anonymous Peer Review

Codex 将输出匿名化：

```text
Candidate A
Candidate B
Candidate C
```

而不是暴露模型品牌。

委员审查：

- Agreements
- Disagreements
- Missing Issues
- Invalid Assumptions
- Risks
- Improvements

### Phase 3 — Conflict Extraction

Codex 生成：

- Consensus
- Majority
- Minority
- Open Disputes
- Uncertain Claims
- Missing Evidence

### Phase 4 — Targeted Debate

仅让与冲突相关的委员参与。

避免：

```text
5 AI × 每轮全部重答
```

改为：

```text
Conflict D-17
A vs C
→ 只调用 A 和 C
```

### Phase 5 — Synthesis

Codex 综合：

```text
Evidence > Consensus
Test > Vote
Verified fact > Model confidence
Minority evidence may override majority
```

### Phase 6 — Verify

必要时：

- 查官方资料
- 运行代码
- 编译
- 测试
- benchmark
- Red Team
- Browser verification

---

## 5. Context Funnel

Codex Boss 不直接把所有历史全文反复喂给所有模型。

```text
RAW
 │
 ▼
Normalize
 │
 ▼
Extract
 ├── Claims
 ├── Agreements
 ├── Disagreements
 ├── Evidence
 ├── Assumptions
 ├── Risks
 └── Minority Opinions
 │
 ▼
Working Context
```

### Compression Policy

#### T0 — Never Compress

- User requirements
- Hard constraints
- Exact numbers
- Code
- URLs
- Test results
- Evidence
- Explicit disagreement
- Minority reports
- Safety constraints

#### T1 — Lossless Structure

- Claims
- Decisions
- Assumptions
- Dependencies
- References

#### T2 — Semantic Compression

- Long explanations
- Repeated rationale
- Examples

#### T3 — Drop

- Greetings
- Boilerplate
- Repeated conclusions
- Empty agreement language

---

## 6. Selective Rehydration

压缩结果不能替代原始证据。

```text
Large RAW
   ↓
Context Funnel
   ↓
Small Working Context
   ↓
Dispute / Question
   ↓
Selective Rehydration
   ↓
Relevant RAW fragment
```

原则：

> Context window is cache, workspace is memory.

---

## 7. Artifact Protocol

内部通信不强制使用 Markdown。

允许任何**文本原生、可检索、可引用、无需 OCR**的格式。

### Recommended

| Format | Primary Use |
|---|---|
| `.md` | 长篇分析、方案、评审 |
| `.json` | claims、状态、结构化 metadata |
| `.yaml` | 配置、handoff、manifest |
| `.txt` | 原始文本 / fallback |
| `.csv` | 评分、对比矩阵 |
| `.xml` | 严格交换格式 |
| `.html` | 保留结构的文本页面 |
| `.py/.ts/.sql/...` | 代码与实现 |
| `.diff/.patch` | 修改建议 |

### Discouraged for Internal IPC

- PDF
- JPG
- PNG
- scanned documents
- screenshots

这些格式可以作为：

```text
External Evidence
```

但不应作为默认：

```text
Inter-Agent Communication
```

### Artifact Bundle

一轮可以返回一个或多个 artifact：

```text
R03/
├── response.md
├── claims.json
├── risks.csv
└── patch.diff
```

---

## 8. Manifest

每轮可以使用轻量 manifest：

```yaml
protocol: codex-boss/v1
case: CASE-001
member: A
session: S01
round: 3
role: critic

artifacts:
  - path: response.md
    type: narrative

  - path: claims.json
    type: claims

  - path: risks.csv
    type: risk_matrix
```

Manifest 与正文解耦：

- metadata 由机器读取
- narrative 由 AI / 人读取

---

## 9. Session Lifecycle

单个网页聊天不应无限增长。

推荐：

```yaml
session:
  target_rounds: 4-6
  soft_round_limit: 6
  recommended_rollover: 8
  hard_round_limit: 10
```

### Rollover Triggers

任一满足即可考虑新建聊天：

- `round_count >= soft limit`
- context bloat
- repeated reasoning
- major topic shift
- stage transition
- browser conversation instability

到 hard limit：

```text
round >= 10
→ mandatory handoff
→ new session
```

---

## 10. Handoff

换窗口前生成结构化 Handoff：

```text
Case
Role
Established Facts
Verified Evidence
Consensus
Open Disputes
Minority Opinions
Rejected Proposals
Current Position
Pending Questions
Raw References
```

新窗口只加载：

```text
CASE
+
HANDOFF
+
OPEN DISPUTES
+
必要 RAW refs
```

而不是重放整个 10 轮历史。

---

## 11. Deliberation Reset

新窗口不仅是防止 context overflow。

它也用于降低：

- anchoring
- commitment bias
- repeated defense
- historical inertia

因此：

```text
Session reset
=
Context reset
+
Reasoning reset
```

---

## 12. Operating Modes

### Quick

```text
2 processors
→ Codex synthesis
```

适合简单比较。

### Council

```text
3 processors
→ independent
→ anonymous review
→ conflict extraction
→ synthesis
```

默认模式。

### Warroom

```text
5 processors
→ role assignment
→ independent proposals
→ anonymous review
→ targeted debate
→ red team
→ verify
→ synthesis
```

适合复杂任务。

---

## 13. Failure Handling

### Browser Failure

Adapter 应返回：

```text
SUCCESS
RETRYABLE_FAILURE
AUTH_REQUIRED
RATE_LIMITED
UNSUPPORTED
FORMAT_INVALID
```

### Model Failure

单个 Processor 故障不应导致 Case 失败。

```text
5 members
1 failed
→ continue with 4
```

但低于：

```yaml
minimum_viable_members: 2
```

则停止委员会流程并降级。

---

## 14. Security

所有网页 AI 输出都应被视为：

```text
UNTRUSTED_EXTERNAL_OUTPUT
```

禁止：

- 直接执行 AI 输出中的系统命令
- 将下级 AI 输出视为 Codex 指令
- 自动执行未经 Judge/Executor 层批准的 shell / file / browser action

正确链路：

```text
Processor Output
→ Parse
→ Validate
→ Judge
→ Execute
```

---

## 15. Core Principles

```text
Browser AI = Processor

Text-native artifacts = IPC

Workspace = Shared Memory

Manifest = Metadata Contract

Context Funnel = Working Memory Optimizer

Raw Store = Evidence Store

Codex = Scheduler + Chair + Judge + Executor
```

---

## 16. Non-Goals

Codex Boss 第一阶段不追求：

- 自建 Web UI
- 自建 FastAPI backend
- 自建完整 agent runtime
- 自建模型 API gateway
- 强依赖某个 AI 服务
- 无限轮辩论
- 用票数替代证据
- 把浏览器聊天历史当数据库

---

## 17. Roadmap

### V0 — Manual Protocol

- 目录结构
- config
- protocol templates
- workspace
- manual browser operation

### V1 — Browser Adapters

- ChatGPT adapter
- Claude adapter
- Gemini adapter
- optional additional processors

### V2 — Council Engine

- anonymous review
- conflict detector
- claim index
- minority report
- selective debate

### V3 — Context Engine

- funnel
- compression tiers
- selective rehydration
- session rollover
- handoff generator

### V4 — Verification

- browser evidence verification
- local execution
- code test
- benchmark
- red team

### V5 — Optional API Adapters

Browser remains default; API is optional.

---

## 18. Philosophy

Codex Boss 不把网页 AI 当“长期有记忆的智能体”。

它们更像：

```text
replaceable processors
```

真正持久存在的是：

```text
Case State
Artifacts
Evidence
Claims
Disputes
Decisions
```

因此一个网页聊天可以：

- 崩溃
- 换窗口
- 换模型
- 被替代
- 被暂停

而不破坏整个 Case。

这也是项目最核心的解耦思想。
