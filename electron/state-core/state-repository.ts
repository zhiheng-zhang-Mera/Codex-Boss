import type { DatabaseHandle } from "./database";
import { withTransaction, type TransactionContext } from "./transaction";

/**
 * Transactional state repository (platform foundation, Phase 02 Task A/C).
 *
 * A namespaced key/value store inside the state database, replacing "one atomic JSON
 * file per concern" for the migrated domains. The point is not the storage shape; it is
 * that a write here and an append to the event journal can share ONE transaction, which
 * is the cross-store consistency Phase 02 exists to create.
 *
 * ## Ownership
 *
 * Every namespace must be declared with an owner before it can hold a record (the FK
 * enforces it). Phase 01's rule is that a durable namespace has exactly one
 * authoritative writer, so `declareNamespace` REFUSES to change an existing owner — a
 * migration that silently reassigned ownership would be creating a second authoritative
 * owner, which the book forbids. Re-asserting the same owner is idempotent, so a boot
 * path can declare unconditionally.
 *
 * ## Ordering
 *
 * `position` gives append-only namespaces a stable order that does not depend on the
 * record key. It is assigned by the repository, monotonically per namespace, and
 * returned by `list` in ascending order — so a ledger read back from here has the same
 * order it was written in.
 */

type NamespaceKind = "document" | "append-only";

interface NamespaceDeclaration {
  namespace: string;
  /** The capability that authoritatively writes this namespace (Phase 01 owner). */
  owner: string;
  kind: NamespaceKind;
}

interface StateRow {
  namespace: string;
  record_key: string;
  position: number;
  payload: string;
  updated_at: string;
}

interface StateRecord<T> {
  namespace: string;
  key: string;
  position: number;
  updatedAt: string;
  value: T;
}

interface NamespaceInfo {
  namespace: string;
  owner: string;
  kind: NamespaceKind;
  revision: number;
  updatedAt: string;
  records: number;
}

/** Raised when a migration tries to hand a namespace to a different owner. */
export class OwnershipConflictError extends Error {
  constructor(namespace: string, existing: string, requested: string) {
    super(`durable namespace "${namespace}" is owned by "${existing}"; refusing to reassign it to "${requested}" (Phase 01 allows exactly one authoritative owner)`);
    this.name = "OwnershipConflictError";
  }
}

export interface StateRepository {
  declareNamespace(declaration: NamespaceDeclaration): NamespaceInfo;
  namespaceInfo(namespace: string): NamespaceInfo | undefined;
  namespaces(): NamespaceInfo[];
  /** Insert or replace one record. Assigns `position` on first write. */
  put<T>(namespace: string, key: string, value: T, now?: string): StateRecord<T>;
  /** Append one record with a generated key, keeping `position` monotonic. */
  append<T>(namespace: string, key: string, value: T, now?: string): StateRecord<T>;
  get<T>(namespace: string, key: string): StateRecord<T> | undefined;
  list<T>(namespace: string): Array<StateRecord<T>>;
  count(namespace: string): number;
  /** Remove one record. Returns true when a row was actually deleted. */
  remove(namespace: string, key: string): boolean;
  /** Remove every record in a namespace, keeping the declaration. */
  clear(namespace: string): number;
}

export function createStateRepository(handle: DatabaseHandle): StateRepository {
  const nowIso = (): string => new Date().toISOString();

  function requireDeclaration(namespace: string): NamespaceInfo {
    const info = namespaceInfo(namespace);
    if (!info) throw new Error(`durable namespace "${namespace}" is not declared; call declareNamespace before writing it`);
    return info;
  }

  function namespaceInfo(namespace: string): NamespaceInfo | undefined {
    const row = handle.raw
      .prepare(
        `SELECT n.namespace, n.owner, n.kind, n.revision, n.updated_at,
                (SELECT COUNT(*) FROM state_record r WHERE r.namespace = n.namespace) AS records
           FROM state_namespace n WHERE n.namespace = ?`
      )
      .get(namespace);
    if (!row) return undefined;
    return {
      namespace: String(row.namespace),
      owner: String(row.owner),
      kind: String(row.kind) as NamespaceKind,
      revision: Number(row.revision),
      updatedAt: String(row.updated_at),
      records: Number(row.records)
    };
  }

  function bump(namespace: string, at: string): number {
    // Revision is what a shadow-compare can use to tell "unchanged" from "changed and
    // changed back", which a value comparison alone cannot.
    handle.raw.prepare("UPDATE state_namespace SET revision = revision + 1, updated_at = ? WHERE namespace = ?").run(at, namespace);
    const row = handle.raw.prepare("SELECT revision FROM state_namespace WHERE namespace = ?").get(namespace);
    return Number(row?.revision ?? 0);
  }

  function decode<T>(row: StateRow): StateRecord<T> {
    return {
      namespace: row.namespace,
      key: row.record_key,
      position: row.position,
      updatedAt: row.updated_at,
      value: JSON.parse(row.payload) as T
    };
  }

  const repository: StateRepository = {
    declareNamespace(declaration) {
      const existing = namespaceInfo(declaration.namespace);
      if (existing && existing.owner !== declaration.owner) {
        throw new OwnershipConflictError(declaration.namespace, existing.owner, declaration.owner);
      }
      if (existing && existing.kind !== declaration.kind) {
        throw new Error(`durable namespace "${declaration.namespace}" is declared as ${existing.kind}; refusing to redeclare it as ${declaration.kind}`);
      }
      const at = nowIso();
      handle.raw
        .prepare(
          `INSERT INTO state_namespace(namespace, owner, kind, updated_at, revision) VALUES (?, ?, ?, ?, 0)
           ON CONFLICT(namespace) DO UPDATE SET updated_at = excluded.updated_at`
        )
        .run(declaration.namespace, declaration.owner, declaration.kind, at);
      return namespaceInfo(declaration.namespace) as NamespaceInfo;
    },

    namespaceInfo,

    namespaces() {
      return (handle.raw.prepare("SELECT namespace FROM state_namespace ORDER BY namespace").all() as Array<{ namespace: string }>)
        .map((row) => namespaceInfo(row.namespace) as NamespaceInfo);
    },

    put<T>(namespace: string, key: string, value: T, now = nowIso()): StateRecord<T> {
      requireDeclaration(namespace);
      return withTransaction(handle, (_context: TransactionContext) => {
        const existing = handle.raw.prepare("SELECT position FROM state_record WHERE namespace = ? AND record_key = ?").get(namespace, key);
        const position = existing
          ? Number(existing.position)
          : Number((handle.raw.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM state_record WHERE namespace = ?").get(namespace) as { next: number }).next);
        handle.raw
          .prepare(
            `INSERT INTO state_record(namespace, record_key, position, payload, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(namespace, record_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
          )
          .run(namespace, key, position, JSON.stringify(value), now);
        bump(namespace, now);
        return { namespace, key, position, updatedAt: now, value };
      }, { label: `put ${namespace}/${key}` });
    },

    append<T>(namespace: string, key: string, value: T, now = nowIso()): StateRecord<T> {
      requireDeclaration(namespace);
      return withTransaction(handle, () => {
        const next = Number((handle.raw.prepare("SELECT COALESCE(MAX(position), 0) + 1 AS next FROM state_record WHERE namespace = ?").get(namespace) as { next: number }).next);
        handle.raw
          .prepare("INSERT INTO state_record(namespace, record_key, position, payload, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(namespace, key, next, JSON.stringify(value), now);
        bump(namespace, now);
        return { namespace, key, position: next, updatedAt: now, value };
      }, { label: `append ${namespace}/${key}` });
    },

    get<T>(namespace: string, key: string): StateRecord<T> | undefined {
      const row = handle.raw.prepare("SELECT * FROM state_record WHERE namespace = ? AND record_key = ?").get(namespace, key);
      return row ? decode<T>(row as unknown as StateRow) : undefined;
    },

    list<T>(namespace: string): Array<StateRecord<T>> {
      const rows = handle.raw.prepare("SELECT * FROM state_record WHERE namespace = ? ORDER BY position ASC, record_key ASC").all(namespace);
      return (rows as unknown as StateRow[]).map((row) => decode<T>(row));
    },

    count(namespace: string): number {
      const row = handle.raw.prepare("SELECT COUNT(*) AS c FROM state_record WHERE namespace = ?").get(namespace);
      return Number(row?.c ?? 0);
    },

    remove(namespace: string, key: string): boolean {
      requireDeclaration(namespace);
      return withTransaction(handle, () => {
        const result = handle.raw.prepare("DELETE FROM state_record WHERE namespace = ? AND record_key = ?").run(namespace, key);
        const changed = Number(result.changes) > 0;
        if (changed) bump(namespace, nowIso());
        return changed;
      }, { label: `remove ${namespace}/${key}` });
    },

    clear(namespace: string): number {
      requireDeclaration(namespace);
      return withTransaction(handle, () => {
        const result = handle.raw.prepare("DELETE FROM state_record WHERE namespace = ?").run(namespace);
        const removed = Number(result.changes);
        if (removed > 0) bump(namespace, nowIso());
        return removed;
      }, { label: `clear ${namespace}` });
    }
  };

  return repository;
}
