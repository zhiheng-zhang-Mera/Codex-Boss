import { readJson, writeJson } from "./durable-json";

/** One applied step of a schema migration, persisted for provenance (plan §5). */
export interface MigrationHistoryEntry { from: number; to: number; at: string; }

/** A deterministic vN → vN+1 migration for one long-lived schema. */
export interface Migration {
  from: number;
  to: number;
  migrate: (payload: unknown) => unknown;
  validate?: (payload: unknown) => void;
}

export interface MigrationOutcome {
  payload: unknown;
  to: number;
  history: MigrationHistoryEntry[];
}

const DEFAULT_CREATED_BY = "codex-boss";

/**
 * Generic schema migration framework (plan §5). A schema registers contiguous
 * vN → vN+1 steps; `migrate` deep-copies the payload, replays each step in
 * order on the copy, validates after every step, and returns the outcome with
 * an append-only history. Unknown versions, version gaps and validation
 * failures fail closed and never mutate the caller's original value.
 */
export class MigrationRegistry {
  private readonly chains = new Map<string, Map<number, Migration>>();

  register(schemaId: string, migration: Migration): void {
    if (!schemaId || !/^[a-z][a-z0-9_-]{1,63}$/.test(schemaId)) throw new Error(`Invalid schema id: ${schemaId}`);
    if (!Number.isInteger(migration.from) || migration.from < 0 || migration.to !== migration.from + 1) throw new Error(`Migration must advance exactly one version: ${migration.from} -> ${migration.to}`);
    let chain = this.chains.get(schemaId);
    if (!chain) { chain = new Map(); this.chains.set(schemaId, chain); }
    if (chain.has(migration.from)) throw new Error(`Duplicate migration from v${migration.from} for ${schemaId}`);
    // Chain keys are `from` versions, so the previous step must already exist.
    if (chain.size > 0 && !chain.has(migration.from - 1)) throw new Error(`Migration chain gap at v${migration.from} for ${schemaId}`);
    chain.set(migration.from, migration);
  }

  latest(schemaId: string): number {
    const chain = this.chains.get(schemaId);
    if (!chain) return 0;
    return Math.max(0, ...[...chain.keys()].map((from) => from + 1));
  }

  /**
   * Migrate a copied payload from `from` (0 = unversioned) to the schema's
   * latest version. Fails closed on a future version or a missing step.
   */
  migrate(schemaId: string, from: number, value: unknown, createdBy = DEFAULT_CREATED_BY, now = Date.now): MigrationOutcome {
    const chain = this.chains.get(schemaId);
    const latest = chain ? this.latest(schemaId) : 0;
    if (!Number.isInteger(from) || from < 0) throw new Error(`Invalid schema version ${from}`);
    if (from > latest) throw new Error(`Unsupported future schema version ${from} for ${schemaId}`);
    let payload = structuredClone(value);
    const history: MigrationHistoryEntry[] = [];
    for (let version = from; version < latest; version++) {
      const step = chain?.get(version);
      if (!step) throw new Error(`Missing migration ${schemaId} v${version} -> v${version + 1}`);
      payload = structuredClone(step.migrate(structuredClone(payload)));
      step.validate?.(payload);
      history.push({ from: version, to: version + 1, at: new Date(now()).toISOString() });
    }
    return { payload, to: latest, history };
  }
}

/** Shared registry for every long-lived data family in this process. */
export const schemaMigrations = new MigrationRegistry();

export interface VersionedEnvelope<T = unknown> {
  schema_id: string;
  schema_version: number;
  created_by: string;
  migration_history: MigrationHistoryEntry[];
  data: T;
}

/** Reads an envelope; unversioned legacy content is reported as version 0. */
export function readEnvelope<T>(raw: unknown): { schema_id: string; version: number; data: T } {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const candidate = raw as Partial<VersionedEnvelope<T>> & { schemaVersion?: number };
    const schemaId = candidate.schema_id ?? "";
    const version = candidate.schema_version ?? candidate.schemaVersion ?? 0;
    if (schemaId && Number.isInteger(version) && version >= 1) {
      if (!("data" in candidate)) throw new Error(`Versioned envelope ${schemaId} is missing data`);
      return { schema_id: schemaId, version, data: candidate.data as T };
    }
    return { schema_id: schemaId, version: 0, data: raw as T };
  }
  return { schema_id: "", version: 0, data: raw as T };
}

/**
 * Atomic read-old → migrate-copy → validate → commit for one JSON file.
 * `readLegacy` maps the unversioned content into payload form (identity by
 * default). A migration failure throws and leaves the original file intact
 * because the migrated copy is only committed through an atomic write.
 */
export function migrateJsonFile(schemaId: string, file: string, createdBy = DEFAULT_CREATED_BY): void {
  const raw = readJson<unknown>(file);
  if (raw === undefined) return;
  const existing = readEnvelope<unknown>(raw);
  const latest = schemaMigrations.latest(schemaId);
  if (existing.schema_id !== schemaId && existing.version > 0) throw new Error(`Schema id mismatch: expected ${schemaId}`);
  if (existing.version > latest) throw new Error(`Unsupported future schema version ${existing.version} for ${schemaId}`);
  if (existing.version === latest) return;
  const outcome = schemaMigrations.migrate(schemaId, existing.version, existing.data, createdBy);
  const envelope: VersionedEnvelope<unknown> = {
    schema_id: schemaId,
    schema_version: outcome.to,
    created_by: createdBy,
    migration_history: existing.version === 0 ? outcome.history : [...existingHistory(raw), ...outcome.history],
    data: outcome.payload
  };
  writeJson(file, envelope);
}

function existingHistory(raw: unknown): MigrationHistoryEntry[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const candidate = raw as Partial<VersionedEnvelope>;
  return Array.isArray(candidate.migration_history) ? candidate.migration_history : [];
}
