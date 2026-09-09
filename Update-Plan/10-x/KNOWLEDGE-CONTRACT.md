# KNOWLEDGE-CONTRACT (Phases 10G/10H/10I/10J)

Contract ids: `knowledge`, `pipeline`, `conflict`, `sync`.
Platform-neutral; knowledge records are plain JSON.

## 1. One user knowledge space

All nodes of one user contribute to a single Global Knowledge Space:

```text
User
  ↓
Global Knowledge Space   (one per user; not per node)
  ↑
all nodes contribute
```

Node-local storage is a *cache/fallback*, never a separate long-term
personality. This forbids "node A has its own lifelong knowledge, node B has a
different one".

## 2. Knowledge record

Each knowledge record carries provenance:

```text
knowledgeId
content
source            where it came from (raw event / artifact / provider / manual)
artifactRef       artifact id that backs this knowledge (when applicable)
createdByNode
createdAt
updatedAt
confidence        0..1 (unknown ⇒ 0 with source note)
scope             global | project:<id> | task:<id> | user:<id>
validity          { validFrom?, validUntil? } temporal validity
version           record version (append semantics)
provenance        chain: event→artifact→knowledge + conflict markers
state             ACTIVE|SUPERSEDED|STALE|CONFLICTING
```

Rules:

- Raw events are never knowledge by themselves (pipeline, 10H).
- Knowledge never silently overwrites: versioned, superseded-state records.
- Conflicting knowledge may coexist but must be explicitly marked (10I).

## 3. Pipeline (10H)

```text
Raw Event
  ↓
Artifact
  ↓
Candidate Knowledge
  ↓
Validation / Dedup
  ↓
Knowledge Record
  ↓
Task-local Retrieval
```

- Every stage preserves provenance (artifactRef, nodeId, createdAt).
- Validation failure parks the candidate (explicit) — no global crash.

## 4. Dedup & conflict (10I)

- exact dedup (same normalized content)
- semantic dedup (deterministic similarity over normalized tokens, no magic)
- source-aware merge
- conflict record: claim A / claim B both kept with conflict metadata, never
  silently deleting the old value
- superseded state (version chain) and stale state (validity expired)

## 5. Local fallback + deferred sync (10J)

```text
Global KB reachable   → normal mode
Global KB unreachable → local fallback
network restored      → deferred sync
```

Local fallback rules:

- never blocks main tasks
- records pending contributions with full provenance
- sync dedups and never overwrites newer knowledge (compare updatedAt/version)
