# AP18a — Workspace Permission Manifest + Classification

Compact handoff for Acceptance Pack **AP18a** (plan §17 permission scope + §18 manifest /
classification; audit item 5). Branch `9-4`.

## Why

The repo had approval analogues (ReviewPolicy approvals, ExecutionGate, allowlisted commands,
safeStorage API keys) but no permission-manifest algebra and no first-class classification
vocabulary beyond the raw artifact `classification` field. This pack freezes the permission
schema/algebra and the PUBLIC..GUARDIAN vocabulary so later packs (AP01 workspace, AP19
adapters) can enforce task ≤ workspace without migrating data shapes.

## What was added

- **`src/shared/permission.ts`** (new, pure)
  - `PermissionKind = filesystem|repo|network|secret|side-effect`;
    `PermissionManifest = Record<kind, { allow: string[], deny: string[] }>`;
    `EMPTY_MANIFEST` (deny-all default — fail closed).
  - `manifestAllows(manifest, kind, value)` — deny beats allow; empty allow denies all.
  - `manifestNarrow(workspace, task)` — returns violations, i.e. task permissions may never
    exceed workspace permissions (plan rule 18).
  - `SecurityClass = PUBLIC|INTERNAL|SECRET|GUARDIAN` (reuses ArtifactClassification naming).
- **`electron/security/permission-manifest.ts`** (new)
  - `PermissionManifestStore` — schemaVersion-1 persisted per-workspace manifest
    (`load/save/grant`); unknown workspace ⇒ deny-all `EMPTY_MANIFEST`; fail-closed corrupt.
- **`tests/permission.test.ts`** (new, 4 tests) — default-deny + deny-beats-allow, task≤workspace
  narrowing violations, per-workspace grant persistence + isolation, corrupt fail-closed.

## Verification

- Targeted: `permission` (4) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite: running; expected green.

## Boundary notes

- Enforcement wiring is deliberately **not** added to execution gates yet: the plan's boundary
  rule ("Workspace 是默认隔离边界", task ≤ workspace) needs the real Workspace object from
  AP01. This pack delivers the manifest schema + algebra + per-workspace store so AP01/AP19
  adoption is purely additive. The existing `ExecutionGate`/allowlist gates keep working as-is.
- Classification vocabulary is defined; only RawArtifact currently carries
  `classification = "INTERNAL"`. Applying classes to prompts/logs + secret scanning is the
  remaining AP18 half.

## Checkpoint

Commit with: `src/shared/permission.ts`, `electron/security/permission-manifest.ts`,
`tests/permission.test.ts`.
