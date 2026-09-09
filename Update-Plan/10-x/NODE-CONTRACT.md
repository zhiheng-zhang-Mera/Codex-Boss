# NODE-CONTRACT (Phase 10B/10C)

Contract id: `node` (schema gen 1) and `inspection` (schema gen 1).
Platform-neutral: this document defines the *data contract*; real probing lives
behind adapters in a later implementation phase.

## 1. Node identity

A node is the smallest independently-running Boss unit. Identity must be stable
across restarts and must never be confused with a session or a run.

```text
nodeId          stable per installation/device (persisted, not random per boot)
hostId          stable per physical/logical host (may host several nodes)
deviceType      desktop | laptop | server | embedded | mobile | unknown
os              platform-neutral label (windows|linux|macos|android|ios|harmonyos|unknown)
arch            cpu architecture label (x64|arm64|...|unknown)
runtimeVersion  Boss runtime version (node/electron/etc label)
bossVersion     10.x Boss version string
```

Rules:

- `nodeId` stable; `sessionId`/`runId` are separate concepts and never stored on
  the identity record.
- Unknown/absent values are represented as `"unknown"`, never fabricated.

## 2. Capability advertisement

Each node advertises capabilities so a scheduler can route work without probing
at assignment time:

```text
cpu             { cores, model? }
memory          { totalMb }
gpu             [ { name, vramMb? } ]          (empty when absent)
storage         { freeMb? }                     (best effort)
network         direct | system-proxy | user-proxy | regional-proxy | provider-proxy
proxyCapable    boolean
providers       [ providerId ]                  configured providers
browser         boolean | { version? }          browser-driven automation
localModel      boolean                          local-model capability
```

Capabilities can be refreshed dynamically; a refresh never removes the node from
service — it updates the advertisement and re-derives node state.

## 3. Node state

```text
available
degraded
offline
busy
lastHeartbeat
```

Derivation rules:

- `available` requires observed facts (see 10C self-inspection); an unobserved
  capability yields DEGRADED/UNKNOWN, never READY.
- `busy` is orthogonal to health (a healthy node can be busy).
- `offline` only via missed heartbeat/self-report; a node may be `offline` while
  `available=false` etc.
- One node's DEGRADED/OFFLINE never changes another node's record (isolation).

## 4. Self-inspection output (NodeCapabilityReport)

Phase 10C: every node produces one report before joining a fleet and on refresh.

```text
NodeCapabilityReport {
  nodeId
  sampledAt
  identity     { hostId, deviceType, os, arch, runtimeVersion, bossVersion }
  hardware     { cpu, memory, gpu, storage }
  runtime      { runtimes present, nativeToolsAvailable }
  network      { routes observed, latencyMs?, providerReachability }
  provider     { configured[], authenticated[], reachable[] }
  proxy        { systemProxy, userProxy, regionalProxy, providerProxy }
  state        available|degraded|offline|busy
  verdicts     [ { capability, status READY|DEGRADED|FAILED|DISABLED|UNKNOWN, detail } ]
  reason
}
```

Invariants:

- A probe failure (e.g. GPU query throws, network probe times out) must be
  captured as a DEGRADED/UNKNOWN verdict and must **never** crash the node or
  prevent the rest of the report from being produced.
- The report is JSON-serializable (platform-neutral).
