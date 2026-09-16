import { randomUUID } from "node:crypto";
import type { DatabaseHandle } from "./database";
import { withTransaction } from "./transaction";
import type { StateRepository } from "./state-repository";

/**
 * State quarantine (platform foundation, Phase 02 Task E).
 *
 * The book's rule is unambiguous: **never silently repair corrupted state** — corrupted
 * data must be quarantined and recorded, not overwritten as if it were empty. This module
 * is the only sanctioned way to remove an undecodable row, and it moves the row to
 * `state_quarantine` rather than deleting it.
 *
 * The distinction that matters, and that this module is built around:
 *
 *   - a row that does not PARSE is damaged, and quarantining it is the truthful response;
 *   - a namespace with no rows is EMPTY, which is a legitimate state and must never be
 *     produced as a side effect of something failing to read.
 *
 * Conflating those two is exactly the bug the book is guarding against — a store that
 * fails to read its file and then persists an empty document over it destroys the data it
 * could not understand. So nothing here runs automatically inside a read path: a caller
 * has to ask for a quarantine, which makes it a decision with an author.
 */

interface StateQuarantineEntry {
  id: string;
  namespace: string;
  key: string;
  position: number;
  payload: string;
  reason: string;
  quarantinedAt: string;
}

interface QuarantineReport {
  inspected: number;
  healthy: number;
  quarantined: StateQuarantineEntry[];
}

interface RecordRow {
  namespace: string;
  record_key: string;
  position: number;
  payload: string;
}

export interface StateQuarantine {
  /** Every quarantined state row, oldest first. */
  entries(namespace?: string): StateQuarantineEntry[];
  /**
   * Move one row aside because it cannot be decoded. Returns the recorded entry.
   * Throws when the row does not exist — a quarantine must name a real row.
   */
  quarantine(namespace: string, key: string, reason: string): StateQuarantineEntry;
  /**
   * Scan a namespace, decode every row, and quarantine the ones that fail.
   *
   * `decode` is supplied by the caller because only the owning domain knows what its
   * payload means — this module deliberately has no opinion about task or decision
   * shapes, which is what keeps the state core out of the business-decision path.
   */
  scan<T>(namespace: string, decode: (payload: unknown) => T): QuarantineReport;
  /** Put a quarantined row back, for the case where the "corruption" was a bad reader. */
  restore(id: string): boolean;
}

export function createStateQuarantine(handle: DatabaseHandle, repository: StateRepository): StateQuarantine {
  const nowIso = (): string => new Date().toISOString();

  function record(row: RecordRow, reason: string): StateQuarantineEntry {
    const entry: StateQuarantineEntry = {
      id: randomUUID(),
      namespace: row.namespace,
      key: row.record_key,
      position: Number(row.position),
      payload: row.payload,
      reason,
      quarantinedAt: nowIso()
    };
    handle.raw
      .prepare("INSERT INTO state_quarantine(id, namespace, record_key, position, payload, reason, quarantined_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(entry.id, entry.namespace, entry.key, entry.position, entry.payload, entry.reason, entry.quarantinedAt);
    return entry;
  }

  const quarantine: StateQuarantine = {
    entries(namespace) {
      const rows = namespace
        ? handle.raw.prepare("SELECT * FROM state_quarantine WHERE namespace = ? ORDER BY quarantined_at ASC, id ASC").all(namespace)
        : handle.raw.prepare("SELECT * FROM state_quarantine ORDER BY quarantined_at ASC, id ASC").all();
      return rows.map((row) => ({
        id: String(row.id),
        namespace: String(row.namespace),
        key: String(row.record_key),
        position: Number(row.position),
        payload: String(row.payload),
        reason: String(row.reason),
        quarantinedAt: String(row.quarantined_at)
      }));
    },

    quarantine(namespace, key, reason) {
      if (typeof reason !== "string" || reason.trim() === "") {
        throw new Error("quarantining a row requires a stated reason; an unexplained quarantine is indistinguishable from a deletion");
      }
      // A quarantine may only touch a namespace the registry knows about, so a typo in a
      // recovery script cannot quietly move rows out of an undeclared namespace.
      if (!repository.namespaceInfo(namespace)) throw new Error(`cannot quarantine ${namespace}/${key}: the namespace is not declared`);
      return withTransaction(handle, () => {
        const row = handle.raw.prepare("SELECT * FROM state_record WHERE namespace = ? AND record_key = ?").get(namespace, key) as unknown as RecordRow | undefined;
        if (!row) throw new Error(`cannot quarantine ${namespace}/${key}: no such record`);
        const entry = record(row, reason);
        // Moved, not copied-and-forgotten: the live row must go, or the next read hits
        // the same undecodable payload again.
        handle.raw.prepare("DELETE FROM state_record WHERE namespace = ? AND record_key = ?").run(namespace, key);
        return entry;
      }, { label: `quarantine ${namespace}/${key}` });
    },

    scan<T>(namespace: string, decode: (payload: unknown) => T): QuarantineReport {
      const rows = handle.raw.prepare("SELECT * FROM state_record WHERE namespace = ? ORDER BY position ASC, record_key ASC").all(namespace) as unknown as RecordRow[];
      const quarantined: StateQuarantineEntry[] = [];
      let healthy = 0;
      for (const row of rows) {
        let payload: unknown;
        try {
          payload = JSON.parse(row.payload);
        } catch (error) {
          quarantined.push(quarantine.quarantine(row.namespace, row.record_key, `payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`));
          continue;
        }
        try {
          decode(payload);
          healthy++;
        } catch (error) {
          quarantined.push(quarantine.quarantine(row.namespace, row.record_key, `payload failed validation: ${error instanceof Error ? error.message : String(error)}`));
        }
      }
      return { inspected: rows.length, healthy, quarantined };
    },

    restore(id) {
      return withTransaction(handle, () => {
        const row = handle.raw.prepare("SELECT * FROM state_quarantine WHERE id = ?").get(id) as unknown as (Record<string, unknown> | undefined);
        if (!row) return false;
        const exists = handle.raw.prepare("SELECT 1 AS present FROM state_record WHERE namespace = ? AND record_key = ?").get(String(row.namespace), String(row.record_key));
        if (exists) throw new Error(`cannot restore ${row.namespace}/${row.record_key}: a live record already occupies that key`);
        handle.raw
          .prepare("INSERT INTO state_record(namespace, record_key, position, payload, updated_at) VALUES (?, ?, ?, ?, ?)")
          .run(String(row.namespace), String(row.record_key), Number(row.position), String(row.payload), nowIso());
        handle.raw.prepare("DELETE FROM state_quarantine WHERE id = ?").run(id);
        return true;
      }, { label: `restore quarantine ${id}` });
    }
  };

  return quarantine;
}
