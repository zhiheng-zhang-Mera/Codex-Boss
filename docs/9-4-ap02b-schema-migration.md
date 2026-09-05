# AP02b — Generic Schema Migration Framework (schema_id / migration_history / vN→vN+1)

Compact handoff for Acceptance Pack **AP02b** (plan §5 Schema Versioning/Migration; Batch A
foundation). Branch `9-4`.

## Why

Every long-lived store previously carried only a bare integer version (`schemaVersion`,
`version`, `schema_version`) with one-off hand-written migration code in `StateStore.read()`
(v1→v2) and `runtime-paths.ts` (legacy data copy). There was no shared machinery, no
`migration_history`, no schema-id contract, no read-old → migrate-copy → validate → commit →
rollback loop. This pack adds the framework (plan: "禁止 v3 才补版本兼容") and demonstrates it
on a real formerly-unversioned store.

## What was added

- **`electron/commander/schema-migration.ts`** (new)
  - `MigrationRegistry` — register contiguous `vN → vN+1` steps per `schema_id`
    (`register` rejects invalid ids, non-+1 steps, duplicates and chain gaps).
  - `migrate(schemaId, from, value, createdBy?, now?)` — deep-copies the payload, replays steps
    on the copy, runs each step's `validate`, appends `{from,to,at}` history, never mutates the
    caller's original. Fails closed on future versions, missing steps, validation failures.
  - `schemaMigrations` — process-wide shared registry.
  - `VersionedEnvelope { schema_id, schema_version, created_by, migration_history, data }`.
  - `readEnvelope(raw)` — recognizes envelopes; reports legacy unversioned content as v0.
  - `migrateJsonFile(schemaId, file, createdBy?)` — atomic read-old → migrate-copy →
    validate → commit for one JSON file (via durable atomic write); a failed migration leaves
    the original file untouched; future declared versions fail closed.
- **`electron/commander/context-manager.ts`** (adoption)
  - `task-contexts.json` was an unversioned array; it now persists the v1 envelope
    (`schema_id: "task-contexts"`) and `restore()` runs `migrateJsonFile` first so any legacy
    array file is upgraded once with an explicit `migration_history` entry. Read/write of new
    files is the envelope; corrupt files are still tolerated (optional cache, never replaces
    canonical task state).
- **`tests/schema-migration.test.ts`** (new, 10 tests) — registry validation, chain replay with
  copy semantics + history, future/gapped fail-closed, step-validation failure propagation,
  legacy-file upgrade idempotency, original-file preservation on failure, future-version
  fail-closed in `migrateJsonFile`, `readEnvelope`, and ContextManager envelope round-trip +
  legacy upgrade.

## Verification

- Targeted: `schema-migration` (10) + `context-manager` (3) PASS.
- Electron + renderer `tsc --noEmit` PASS.
- Full vitest suite running; expected all green (ContextManager is the only adopted consumer and
  keeps its public API unchanged).

## Boundary notes

- Adoption deliberately scoped to ONE real store in this pack. Remaining unversioned stores
  (`.boss/runtime-budget.json`, `.boss/recovery.json`, `.boss/runtime-resources.json`,
  `.boss/memory/*`, `api-settings.json`) keep their current on-disk shapes; the framework is
  ready for them, and SCHEMA_REGISTRY.json is the tracking point for the next migrations.
- `StateStore.read()` v1→v2 stays as-is (working legacy path); it can be re-expressed through
  the registry in a later pack without behavior change.
- `created_by` currently records `"codex-boss"` (or the caller-supplied creator) for provenance.

## Checkpoint

Commit with: `electron/commander/schema-migration.ts`, `electron/commander/context-manager.ts`,
`tests/schema-migration.test.ts`.
