# ARTIFACT-CONTRACT (Phase 10K)

Contract id: `artifact`.
Platform-neutral: artifact records are plain JSON; blob storage is adapter-bound.

## 1. Artifact taxonomy

Unified artifact types:

```text
run artifact
engineering artifact
research artifact
decision record
failure record
checkpoint
knowledge source artifact
provider interaction artifact
```

## 2. Artifact record

Every artifact carries at least:

```text
artifactId
type
runId
taskId
nodeId
createdAt
sha256
version
source
provenance     how it came to be (event chain / parent artifact / tool)
stage          lifecycle stage (RAW|NORMALIZED|VALIDATED|COMMITTED|...)
status         e.g. ACTIVE|FAILED|SUPERSEDED
```

## 3. Rules

- Append-oriented: later failure never erases earlier successful artifacts.
- Failed runs must be preserved as failure records (never deleted on cleanup).
- Checkpoints can be linked to artifacts (`checkpointRef`).
- Knowledge can be traced back to its source artifact (`artifactRef`).
- sha256 is content integrity evidence, computed over serialized bytes.

## 4. Degraded behavior

An artifact write failure is contained to the artifact module: the run may
FAIL (honest) but Boss must stay alive and unrelated work continues.
