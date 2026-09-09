# NETWORK-CONTRACT (Phases 10L/10M/10Q)

Contract ids: `network`, `provider`, `platform`.
Platform-neutral; network state is a per-node report, not a global assumption.

## 1. Per-node network state

Each node maintains its own network state from the route set:

```text
DIRECT
SYSTEM_PROXY
USER_PROXY
REGIONAL_PROXY
PROVIDER_PROXY
OFFLINE
```

Routing principle:

```text
DIRECT first
  ↓
only fallback when necessary
```

Different nodes may choose different routes at the same moment:

```text
Node A → DIRECT
Node B → PROXY
Node C → OFFLINE-CAPABLE TASK
```

No global proxy enforcement is allowed.

## 2. Provider reachability matrix (10M)

Each node maintains a per-provider matrix used by the scheduler:

```text
provider
reachable
authenticated
latency
regionBlocked
rateLimited
proxyRequired
lastSuccess
lastFailure
```

- Scheduler must use the live matrix, not merely "provider configured".
- A provider that is reachable but requires proxy gets proxy-required tasks
  only, etc.
- Unreachable/blocked providers must never fake success.

## 3. Degraded operation

Network probe failure → node reports OFFLINE/DEGRADED for that route; other
routes and tasks are unaffected. If every route fails, the node is
offline-capable and queues deferred work (see knowledge sync + artifact
contracts).

## 4. Platform adapter layer (10Q)

- Shared protocols never embed OS APIs (no Windows registry, no
  macOS-specific keys, no Linux-only calls in `src/shared/tenx`).
- Real probing (system proxy detection, regional routing) is delegated to
  host-specific adapters behind the platform-neutral contract.
- Target desktop: Windows/Linux/macOS. Future/mobile: Android/iOS/HarmonyOS —
  none of which change the shared schema.
