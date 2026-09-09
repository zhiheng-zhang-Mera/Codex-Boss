# FLEET-CONTRACT (Phases 10D/10E/10F/10P)

Contract ids: `fleet`, `lease`, `scheduler`.
Platform-neutral: fleet messages ride the `TenxEnvelope`; no host API is assumed.

## 1. Fleet control plane (10D)

A minimal Fleet Controller is a *coordinator*, never a hard dependency:

Responsibilities:

```text
node registration
node deregistration
heartbeat
health state
capability inventory
task lease
task ownership
task transfer
checkpoint awareness
node dropout detection
```

Controller rules:

- Single node must operate with no controller (controller absent ⇒ everything
  the node can do locally still works).
- Controller restart must restore durable task state (registration/heartbeat
  records and leases are persisted; nothing is reconstructed from memory).
- Controller failure: already-leased tasks keep running; leases expire by time
  (no liveness dependency on a message round trip).
- Node offline must not fail unrelated tasks: dropout handling only touches
  work owned by the dropped node.

## 2. Task lease & ownership (10E)

```text
Task {
  taskId
  ownerNode          node currently holding the lease
  leaseId
  leaseExpiresAt     monotonic deadline
  checkpoint         last durable checkpoint (opaque JSON blob + ref)
  takeoverAllowed    boolean
  replaySafety       replaySafe | replayUnsafe | unknown
  state              QUEUED|LEASED|RUNNING|CHECKPOINTED|COMPLETED|FAILED|TRANSFERRED
}
```

Rules:

- Exactly one valid owner per task at any time. A lease is valid only while
  `now < leaseExpiresAt`.
- Lease expiry → takeover eligibility; takeover must restore from the most
  recent durable checkpoint.
- Replay-unsafe tasks must never be blindly re-run: without a checkpoint they
  fail honestly instead of duplicating side effects.
- A node that recovers must NOT reclaim a task that was legally transferred
  while it was offline.

## 3. Dynamic scheduler (10F)

Scheduler extends runtime/provider selection with a full decision pipeline:

```text
task requirement
  → node capability
  → network state
  → provider availability
  → load
  → data locality
  → proxy requirement
  → risk
  → allocation
```

Supported allocation policies (minimum):

```text
local-preferred        prefer the requesting/self node
provider-preferred     prefer the node whose provider is best
low-latency            minimize network/queue latency
GPU-required           only nodes advertising gpu
memory-heavy           only nodes with sufficient free memory
browser-required       only nodes with browser capability
direct-network-required  only nodes with DIRECT route
proxy-required         only nodes with a working proxy route
offline-capable        may run on an offline-capable node
```

- Allocation failure must return an explainable reason (which constraint was
  not satisfiable), never a silent no-op.
- Scheduler consumes the realtime provider reachability matrix (10M), not only
  "is the provider configured".

## 4. Failure isolation scenarios (10P)

Target scenarios to prove with automated tests (not requiring live external
services; injectable fakes permitted):

1. node A offline → node B/C continue
2. provider A unavailable → unrelated provider task continues
3. global KB offline → local fallback
4. proxy node failure → direct-capable node unaffected
5. fleet controller restart → durable task state restored
6. node dropout mid-task → checkpoint takeover
7. multiple simultaneous faults (node offline + provider failed + KB offline +
   proxy failed) → unrelated executable work still continues
