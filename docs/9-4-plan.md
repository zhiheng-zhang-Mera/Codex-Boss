# 9-4 Stabilization Gate

No v0.6+ milestone can be considered accepted until the normal direct task path reaches a persisted FinalResponse in the Controller without manual intervention.

Sequence: S0 Stabilization → S1 v0.6 Recovery Closure → S2 v0.7 PlanRunner → S3 v0.8 Engineering Integration → S4 v0.9 Semantic/Long-Horizon → S5 v1.0 Hardening. Each stage requires functional validation before commit/push and terminal CI before the next stage.

Acceptance: create chat, rename chat, submit, capture, review PASS, checkpoint COMMITTED, COMPLETE, finalize, present, restart restore.

# Codex-Boss v0.6–v1.0 Revised Execution Plan

> Priority rule: ship the capabilities that most improve real-world completion rate first, while minimizing model/provider usage.  
> Core principle: **Reliability before autonomy, deterministic execution before model calls, lightweight mode before multi-agent escalation.**

---

## 0. Reordered roadmap

| Version | Primary Goal | Practical Value | Expected AI/Quota Cost | Default Complexity |
|---|---|---:|---:|---|
| v0.5 | Close Web-AI loop; auto-release review gate | Very High | Very Low | Low |
| v0.6 | Reliable single-agent execution + generic interruption recovery | Very High | Low | Low |
| v0.7 | Intent compiler + task decomposition + budget-aware Commander | Very High | Low–Medium | Medium |
| v0.8 | Autonomous engineering runtime + bounded parallel workers | Very High | Medium | Medium–High |
| v0.9 | Semantic Computer Use + multi-web-AI + long-horizon optimization | High | Medium–High | High |
| v1.0 | Product hardening, packaging, UX, benchmarks | Very High | Low–Medium incremental | Stable |

The old ordering placed Computer Use too early. The revised ordering treats Computer Use as an execution backend rather than the foundation of the system. A task that survives interruption, resumes correctly, verifies its own state, and avoids unnecessary model calls is more useful than a broader UI agent that frequently loses progress.

---


# v0.5 — Web-AI Closed-Loop Completion & Review-Gate Release

## Current state

v0.5 already supports:

```text
Commander
→ open/connect web AI
→ send prompt
→ receive answer
→ return answer to Boss UI
```

Current blocker:

```text
HOLD_FOR_REVIEW
```

Therefore the transport/response path is already functional. The remaining v0.5 work is to turn `HOLD_FOR_REVIEW` from a default hard stop into a policy-driven review gate.

---

## 1. Replace hard HOLD_FOR_REVIEW with a review-gate state machine

Replace:

```text
WEB_AI_RESPONSE
→ HOLD_FOR_REVIEW
→ manual intervention
```

with:

```text
WEB_AI_RESPONSE
        ↓
REVIEW_GATE
   ┌────┼─────────────┐
   ↓    ↓             ↓
PASS   RETRY      HUMAN_REQUIRED
   ↓      ↓             ↓
CONTINUE redispatch HOLD_FOR_REVIEW
```

`HOLD_FOR_REVIEW` becomes an exception path rather than the normal success path.

---

## 2. Normalized review result

Every worker response should produce a provider-independent result:

```json
{
  "status": "PASS | RETRY | HUMAN_REQUIRED | FAILED",
  "task_id": "...",
  "worker_id": "...",
  "response_id": "...",
  "requirements_met": [],
  "requirements_missing": [],
  "retry_reason": null,
  "human_review_reason": null,
  "next_action": "..."
}
```

Do not require an additional model call for every review.

Deterministic checks come first.

---

## 3. Auto-release rules

For ordinary text-answer tasks, release automatically when:

```text
response exists
AND response is non-empty
AND expected output shape is present when specified
AND response is not a login/quota/error/transport page
AND no mandatory approval policy was triggered
```

Then:

```text
REVIEW_GATE
→ PASS
→ CONTINUE
```

For structured outputs:

```text
parse successfully
AND required fields exist
AND schema validation passes
→ PASS
```

For responses that are inputs to later engineering work:

```text
response captured
→ persist evidence
→ PASS
→ forward to next execution step
```

---

## 4. Human review becomes risk-based

Keep `HOLD_FOR_REVIEW` only for cases such as:

```text
irreversible external side effects
account/security changes
financial actions
publishing/sending externally
destructive operations
ambiguous intent
conflicting critical outputs
low-confidence high-impact verification
explicit user-configured approval points
```

Ordinary answer retrieval must not stop for manual review.

---

## 5. Review policy modes

Support:

```text
STRICT
BALANCED
AUTONOMOUS
```

### STRICT
Most external actions require human review.

### BALANCED
Recommended default.

```text
read-only / local / reversible
→ auto-release

high-impact external
→ human review
```

### AUTONOMOUS
Auto-release unless an explicit hard approval policy applies.

---

## 6. Required state transitions

Main path:

```text
IDLE
→ DISPATCHING
→ WAITING_FOR_RESPONSE
→ RESPONSE_RECEIVED
→ REVIEW_GATE
→ PASS
→ NEXT_STEP
```

Failure/recovery paths:

```text
WAITING_FOR_RESPONSE
→ TIMEOUT
→ RETRY

REVIEW_GATE
→ RETRY
→ DISPATCHING

REVIEW_GATE
→ HUMAN_REQUIRED
→ HOLD_FOR_REVIEW

REVIEW_GATE
→ FAILED
→ TASK_FAILED
```

These states must live in runtime/task state, not only in UI rendering.

---

## 7. UI semantics

Recommended visible states:

```text
RUNNING
WAITING_FOR_AI
REVIEWING
CONTINUING
WAITING_FOR_USER
FAILED
COMPLETED
```

Internal `HOLD_FOR_REVIEW` should map only to:

```text
WAITING_FOR_USER
```

when real human intervention is required.

A normal response should briefly pass through:

```text
REVIEWING
→ CONTINUING
```

without user action.

---

## 8. v0.5 review-gate module boundary

```text
web_worker
    ↓
response_normalizer
    ↓
review_gate
    ↓
continuation_router
    ↓
Commander
```

Provider-specific parsing stays inside adapters.

`review_gate` only receives normalized worker responses.

---

## 9. Deterministic-first review checks

Minimum cheap checks:

```text
response received?
response length above threshold?
known error page?
known login/quota page?
expected marker/schema present?
requested result/attachment present?
worker explicitly reports blocker?
```

Only escalate to model-based review when deterministic checks cannot decide.

This prevents doubling model consumption by reviewing every response with another AI.

---

## 10. Persist before gate release

Before leaving `REVIEW_GATE`, persist:

```text
raw response
normalized response
review result
current task state
next_action
```

Suggested bridge storage:

```text
.boss/
├── responses/
├── reviews/
├── task.json
└── runtime.json
```

This becomes the seed of the v0.6 persistent task ledger.

---

# v0.5 → v0.6 transition contract

v0.5 should freeze a minimal normalized execution contract:

```text
TaskRequest
→ WorkerDispatch
→ WorkerResponse
→ ReviewResult
→ NextAction
```

Core objects:

```text
TaskRequest
WorkerSession
WorkerResponse
ReviewResult
ExecutionState
```

v0.6 extends these rather than replacing them.

## v0.5 owns

```text
web-AI connection
prompt dispatch
response capture
response normalization
review gate
automatic gate release
basic retry
basic continuation
minimal persistence
```

## v0.6 takes over

```text
generic interruption taxonomy
persistent checkpoints
provider-independent session registry
quota/rate-limit recovery
browser/process recovery
provider failover
budget manager
deterministic-first runtime
long-task resume
```

Handoff:

```text
v0.5
Web-AI closed loop runs without manual review for normal tasks
        ↓
v0.6
The same loop becomes interruption-tolerant and provider-agnostic
```

---

## v0.5 acceptance criteria

v0.5 is complete when:

- web AI can be opened and prompted;
- a valid answer is captured;
- the answer is persisted;
- ordinary valid responses automatically pass `REVIEW_GATE`;
- `HOLD_FOR_REVIEW` occurs only when policy truly requires human input;
- invalid/error responses enter retry/failure paths;
- `PASS` triggers the next task step automatically;
- task/review state survives at least a Boss UI refresh/restart;
- v0.5 response/session/review objects are reusable directly by v0.6.

Target closed loop:

```text
prompt
→ web AI
→ response
→ review
→ automatic release
→ next action
```

---

## Immediate v0.5 implementation order

```text
1. locate every emitter/consumer of HOLD_FOR_REVIEW
2. separate REVIEW_GATE from HUMAN_REQUIRED
3. implement deterministic PASS/RETRY rules
4. persist WorkerResponse + ReviewResult
5. implement PASS → NEXT_STEP
6. add STRICT/BALANCED/AUTONOMOUS policy config
7. test valid / invalid / timeout / human-required paths
8. freeze normalized response/review/session interfaces
9. start v0.6 on those interfaces
```

The practical v0.5 milestone is:

> Boss can send one normal task to one web AI, receive its answer, determine that no human review is needed, and continue automatically.


# v0.6 — Reliable Execution Core

## Goal

Build a **provider-agnostic execution supervisor** capable of running one worker or one web AI reliably for long tasks.

This version must already be useful as a lightweight Codex-Boss.

## 1. Persistent Task Ledger

Create a persistent machine-readable task state rather than relying on conversation context.

Suggested structure:

```text
.boss/
├── task.json
├── plan.json
├── checkpoints/
├── sessions/
├── evidence/
└── runtime.json
```

Minimum task state:

```text
objective
constraints
completed_steps
current_step
pending_steps
modified_files
verification_state
failure_history
active_provider
session_id
next_action
```

Every meaningful state transition writes a checkpoint.

Mandatory checkpoint boundaries:

- task compiled
- plan created
- step started
- step completed
- files changed
- test/build finished
- external side effect performed
- worker interrupted
- recovery attempted
- task completed

---

## 2. Generic Interruption / Recovery Layer

Do **not** model this as an OpenAI-specific quota handler.

Normalize provider/runtime failures into a common interruption taxonomy:

```text
RATE_LIMIT
QUOTA_EXHAUSTED
CREDIT_EXHAUSTED
SESSION_EXPIRED
AUTH_EXPIRED
NETWORK_FAILURE
PROVIDER_5XX
TOOL_TIMEOUT
BROWSER_CRASH
PROCESS_CRASH
RESOURCE_EXHAUSTED
DEPENDENCY_FAILURE
HUMAN_APPROVAL_REQUIRED
UNKNOWN_INTERRUPTION
```

Each interruption maps to a recovery policy.

Example:

```text
RATE_LIMIT
    -> preserve checkpoint
    -> read reset/retry metadata if available
    -> sleep/backoff
    -> probe provider
    -> resume same session

SESSION_EXPIRED
    -> reconstruct context from task ledger
    -> create replacement session
    -> continue from NEXT_ACTION

PROVIDER_5XX
    -> bounded retry
    -> health penalty
    -> optional provider failover

QUOTA_EXHAUSTED
    -> wait for reset OR
    -> switch compatible provider OR
    -> enter lightweight/degraded mode

BROWSER_CRASH
    -> restart browser
    -> restore target page
    -> verify previous side effect
    -> continue
```

The supervisor must distinguish:

```text
retryable
waitable
switchable
recoverable-from-checkpoint
requires-human
fatal
```

---

## 3. Provider Session Registry

Every worker receives an explicit session identity.

Never depend on `--last`-style implicit recovery in the core architecture.

```text
Worker
├── provider
├── model/backend
├── session_id
├── task_id
├── last_checkpoint
├── health
└── resume_strategy
```

Adapters may include:

```text
OpenAI Codex
OpenAI API
Claude/API
Gemini/API
web AI
local model
future providers
```

Provider-specific behaviour stays inside adapters.

Commander only sees the normalized interface.

---

## 4. Minimal Budget Manager

v0.6 does not need exact monetary billing.

Track operational consumption:

```text
model_calls
estimated_input_tokens
estimated_output_tokens
context_size
tool_calls
browser_actions
retry_count
worker_runtime
provider_wait_time
```

Task-level budgets:

```text
planning_budget
execution_budget
verification_budget
retry_budget
```

If a budget is exceeded:

```text
normal mode
   ↓
lightweight mode
   ↓
deterministic-only attempt
   ↓
checkpoint + defer/fail
```

---

## 5. Deterministic-First Execution

Before asking an AI worker:

```text
Can shell/filesystem/git/test/parser solve it?
        ↓ yes
use deterministic tool
        ↓ no
use model
```

This should be a system-wide rule.

Do not spend a model call to:

- read a known file if a parser can read it;
- check git status;
- run tests;
- search exact text;
- copy/move files;
- inspect structured logs;
- perform deterministic validation.

---

## 6. Lightweight Single-Web-AI Mode

Keep the previously planned lightweight mode.

Minimum pipeline:

```text
Commander
→ one web AI / one model worker
→ deterministic tools
→ verification
→ checkpoint
```

No committee.
No mandatory critic.
No parallel debate.

This is the default for simple and medium tasks.

### v0.6 acceptance targets

- interrupted task state survives process restart: ≥99%
- known retryable failures recover automatically: ≥95%
- completed steps are not unnecessarily repeated: ≥95%
- deterministic operations avoid model calls where possible
- single-provider and single-web-AI modes work end-to-end
- provider-specific failures do not leak into Commander logic

---

# v0.7 — Intent Compiler + Cost-Aware Commander

## Goal

Turn a user request into the **smallest execution graph required to finish it**.

The planner must not behave like a defensive bureaucracy.

---

## 1. Intent Compiler

Compile natural-language requests into Task IR.

```text
User Request
    ↓
Intent Compiler
    ↓
Task IR
```

Task IR should contain:

```text
goal
deliverables
constraints
success_conditions
risk_level
required_capabilities
dependencies
estimated_complexity
budget_class
```

---

## 2. Progressive Task Decomposition

Do not fully decompose every request.

Use four levels:

### L0 — Deterministic

Examples:

```text
rename files
run test
format code
git status
simple conversion
```

No planner worker.

### L1 — Lightweight

```text
Commander
→ one worker
→ verify
```

Default for ordinary coding or single-web-AI tasks.

### L2 — Planned

```text
planner
→ task graph
→ worker
→ verifier
```

Use only when dependencies or multi-step implementation justify it.

### L3 — Parallel

```text
planner
→ 2–3 bounded workers
→ merge
→ targeted verification
```

Use for genuinely separable work.

Do not start with 3–5 agents merely because they are available.

---

## 3. Replan Triggers

Replanning is allowed only when:

- dependency assumptions become invalid;
- the same step fails twice;
- verification disproves the current plan;
- a real blocker appears;
- required capability becomes unavailable.

Do not replan after every worker response.

---

## 4. Cost-Aware Routing

Commander selects the cheapest sufficient path.

Example:

```text
deterministic tool
    ↓ insufficient
local/light model
    ↓ insufficient
single strong model
    ↓ insufficient
parallel workers
    ↓ unresolved
critic/debate
```

Multi-agent discussion becomes an escalation mechanism rather than the default architecture.

---

## 5. Context Minimization

Workers receive:

```text
task slice
required files
constraints
relevant evidence
expected output schema
```

They do not automatically receive the entire conversation or entire repository context.

Long-term state belongs in artifacts/checkpoints, not repeated prompts.

### v0.7 acceptance targets

- ≥90% of simple tasks remain L0/L1
- Commander produces executable Task IR for normal requests
- ≥3 worker types can be routed
- unnecessary replanning rate is low
- planner/critic calls are skipped when no measurable benefit exists
- simple task model usage is materially lower than a fixed multi-agent pipeline

---

# v0.8 — Autonomous Engineering Runtime

## Goal

Make Boss genuinely useful for software development without continuous supervision.

---

## 1. Native Engineering Tools First

Primary execution paths:

```text
filesystem
shell
git
tests
build
lint
static analysis
structured logs
```

Browser/vision should not be used when native interfaces exist.

---

## 2. Safe Workspace Strategy

Select execution environment based on risk:

```text
low risk
→ current workspace

medium risk
→ new branch

high / parallel risk
→ worktree / isolated workspace
```

---

## 3. Bounded Parallel Workers

Default maximum:

```text
2–3 active workers
```

Increase only when the task graph demonstrates genuine parallelism.

Each worker owns:

```text
subtask
workspace scope
budget
checkpoint
provider session
expected evidence
```

---

## 4. Autonomous Verify / Repair Loop

A worker saying “done” is not completion.

```text
implementation
→ scoped tests
→ failure analysis
→ targeted repair
→ broader tests
→ diff review
→ final verification
```

Use escalating verification.

Do not run the entire expensive test suite after every tiny edit unless necessary.

---

## 5. Provider Failover

Failover must operate on capabilities, not brand names.

Example capability classes:

```text
code_reasoning
general_reasoning
vision
web_interaction
long_context
cheap_worker
critic
```

If provider A becomes unavailable:

```text
checkpoint
→ find compatible healthy backend
→ reconstruct minimal context
→ continue
```

Do not blindly switch providers if semantic continuity cannot be preserved.

### v0.8 acceptance targets

- ≥3 concurrent workers supported
- parallel tasks retain isolated task/session/checkpoint state
- ordinary engineering failures are automatically repaired when feasible
- task survives worker/provider process loss
- final completion requires evidence, not worker self-report
- unnecessary full-context and full-test reruns are minimized

---

# v0.9 — Semantic Computer Runtime + Long-Horizon Operation

## Goal

Add broad real-world interaction only after the reliable planning/execution core exists.

---

## 1. Semantic Computer Use

Priority order:

```text
direct program/API interface
    ↓
CDP / DOM / accessibility tree
    ↓
Windows UI Automation
    ↓
structured application state
    ↓
vision + mouse fallback
```

Vision is the last resort.

The runtime exposes semantic actions such as:

```text
open_app
focus_window
find_control
click_control
enter_text
read_page
submit
wait_for_state
verify_state
```

instead of only raw pixel actions.

---

## 2. Web-AI Runtime

Support:

```text
single-web-AI lightweight mode
multi-web-AI mode
parallel prompt dispatch
structured response capture
session continuity
page recovery
provider health
```

Multi-AI discussion is conditional.

Trigger it only for:

```text
high uncertainty
material disagreement
independent solution search
high-risk verification
```

---

## 3. Long-Horizon Memory

Separate:

```text
User Memory
Project Memory
Task Memory
Runtime State
```

Task execution must not depend on huge chat histories.

---

## 4. Adaptive Resource Controller

Use observed execution data to learn:

```text
which tasks need planning
which worker is cheapest/sufficient
how many workers improve throughput
when critic calls actually help
which retry strategy works
which UI backend is most reliable
```

The goal is not exact billing optimization.

The goal is:

> maximum verified task completion per unit of model/provider usage.

---

## 5. Degraded Modes

Boss should remain useful even when capabilities disappear.

Example:

```text
Full Mode
→ Multi-worker

Reduced Mode
→ Single strong worker

Lightweight Mode
→ Single web AI / cheap worker

Deterministic Mode
→ shell/files/git/tests only

Paused Recoverable Mode
→ checkpoint and wait
```

### v0.9 acceptance targets

- semantic UI path succeeds on supported applications ≥80%
- raw vision fallback becomes necessary in <10% of supported normal flows
- web-AI interruption can restore/reconstruct sessions
- long tasks survive machine/application/provider interruptions
- adaptive routing reduces unnecessary model calls compared with fixed routing

---

# v1.0 — Stable Autonomous Boss

## Goal

Do not add another major architecture layer.

v1.0 is the integration and reliability release.

---

## User experience

The user should be able to issue:

```text
"Refactor this project according to tasks.md and make sure it works."
```

Boss should autonomously:

```text
understand
→ estimate complexity/budget
→ compile task
→ choose cheapest sufficient execution mode
→ checkpoint
→ execute
→ recover from interruption
→ verify
→ repair
→ finish
→ report evidence
```

The user should not need to know which provider performed each step.

---

## Final architecture

```text
User
 ↓
Intent Compiler
 ↓
Task IR
 ↓
Complexity + Risk + Budget Router
 ↓
Main Commander
 ├─────────────┬──────────────┐
 ↓             ↓              ↓
Deterministic  AI Workers     Web/Computer Workers
Tools          1..N           1..N
 │             │              │
 └──────┬──────┴───────┬──────┘
        ↓              ↓
 Evidence / Verification
        ↓
 Checkpoint / Task Ledger
        ↓
 Execution Supervisor
 ├─ interruption classifier
 ├─ provider health
 ├─ quota/credit state
 ├─ retry/backoff
 ├─ failover
 ├─ session recovery
 └─ degraded-mode controller
        ↓
 Completed / Waiting / Human Blocker
```

---

# Quota-consumption rules for v1.0

## Rule 1 — No AI call without a reason

Every model call should correspond to one of:

```text
reasoning
generation
ambiguity resolution
semantic interpretation
verification that deterministic tools cannot provide
```

---

## Rule 2 — No mandatory committee

Default:

```text
1 Commander + 1 worker
```

Escalate only when useful.

---

## Rule 3 — Verification is risk-based

```text
low-risk deterministic change
→ deterministic verification

normal coding
→ tests + optional targeted model review

high-risk / ambiguous
→ independent verifier

critical disagreement
→ multi-agent review
```

---

## Rule 4 — Persist state instead of replaying context

Never spend tokens repeatedly explaining already completed work when structured state can reconstruct it.

---

## Rule 5 — Retry has a budget

A failed worker must not consume unlimited quota.

Example:

```text
attempt 1
→ targeted retry

attempt 2
→ diagnose/replan

attempt 3
→ switch backend or checkpoint/block
```

---

## Rule 6 — Parallelism must pay for itself

Parallel execution is allowed when expected latency reduction or independent evidence outweighs additional provider usage.

---

# Final v1.0 success metrics

## Reliability

- recoverable interruption recovery ≥95%
- task state persistence ≥99%
- accidental repetition of completed work <5%
- provider-specific failure does not crash global task state

## Completion

Target benchmark completion rates:

- simple ≥95%
- medium ≥85%
- complex ≥70%
- long-horizon ≥60%

## Resource efficiency

Compare against a naive always-plan + always-multi-agent baseline:

- simple tasks: ≥60% fewer model calls
- medium tasks: ≥30% fewer model calls
- retries are bounded
- context is reconstructed from task state instead of full replay
- deterministic paths are preferred whenever equivalent

## Computer Use

- supported semantic UI flows ≥80%
- raw image-based interaction avoided ≥90% where semantic interfaces exist

---

# Recommended implementation order inside each release

For every version:

```text
data model
→ deterministic runtime
→ recovery
→ tests
→ minimal UI
→ model integration
→ optional advanced intelligence
```

Do not implement the impressive AI layer first.

The architecture should always remain usable one layer below the newest intelligence feature.

---

# Positioning of v1.0

v1.0 does not need to be a research system.

Its product definition is:

> **A provider-agnostic autonomous engineering and computer-execution controller that can decompose tasks, select the cheapest sufficient execution path, survive interruptions, resume from persistent state, verify its own work, and complete long-running tasks with minimal supervision.**

The research-oriented features can begin after v1.0, using the stable runtime as the experimental platform.
