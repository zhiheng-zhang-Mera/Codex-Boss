import type { BootModule } from "./boot-module";
import type { DecisionLedgerEntry } from "../../src/shared/decision-ledger";
import type { DecisionLedgerStore } from "../commander/decision-ledger-store";
import { checkIntegrity, CORE_SCHEMA_VERSION, openDatabase, stateDatabasePath, describeDatabase, type DatabaseHandle } from "../state-core/database";
import {
  DECISION_LEDGER_NAMESPACE,
  DECISION_LEDGER_REQUIRED_CLEAN,
  createDecisionLedgerMigration,
  type DecisionLedgerMigration
} from "../state-core/decision-ledger-migration";
import { createNamespaceMigrationRegistry, describeMigration, type NamespaceMigrationRegistry } from "../state-core/namespace-migration";
import { createStateRepository, type StateRepository } from "../state-core/state-repository";
import { createEventJournal, type EventJournal } from "../state-core/event-journal";
import { inspectRecovery, type RecoveryReport } from "../state-core/recovery";
import { createStateQuarantine, type StateQuarantine } from "../state-core/state-quarantine";

/**
 * Durable state core boot module (platform foundation, Phase 02 Task C integration).
 *
 * This is the module that finally puts the state core in the RUNNING application. Until it
 * existed, the substrate, the journal and the migration were a tested subsystem with no
 * production entry point — the report said so in its own fields — and a migration that no
 * boot path performs is a migration that has not happened.
 *
 * ## What it does, in order
 *
 *   1. opens the state database under the resolved data root;
 *   2. inspects recovery and records the evidence (integrity, schema, journal, checkpoints);
 *   3. declares `decision-ledger` with the Phase 01 owner, `persistence`;
 *   4. imports the legacy JSON entries — idempotent, so a restart cannot double the ledger;
 *   5. begins shadow comparison, so every subsequent append is written to both sides and
 *      compared while JSON is still authoritative.
 *
 * ## Why it degrades instead of failing the boot
 *
 * The engineering book is explicit that a module failing must not take Boss down
 * unnecessarily, and the state core is young relative to the stores it is migrating. So a
 * database that cannot be opened, a corrupt file, or a schema from a newer build leaves
 * this module `DEGRADED` with a legible reason and hands back the LEGACY store unchanged —
 * the application keeps its durable ledger and simply does not migrate yet. That is the
 * opposite of the failure mode the book forbids (a capability's absence becoming a global
 * boot failure), and it means the integration is safe to ship before it is trusted.
 *
 * It deliberately does NOT promote. Authority stays on JSON until the comparison battery
 * has passed and an explicit caller promotes, because silent promotion is exactly what the
 * book's gate 6 forbids.
 */

/**
 * The state core's public surface, used by the composition root and by this module's own
 * record. Module-private because `createStateCoreModule` is the only way to obtain one, so
 * exporting the shape would be surface with no consumer.
 */
interface StateCoreService {
  /** The routed ledger: `list`/`append` go through the migration. */
  ledger: {
    list(taskId?: string): DecisionLedgerEntry[];
    append(entry: DecisionLedgerEntry): DecisionLedgerEntry;
    appendAll(entries: readonly DecisionLedgerEntry[]): DecisionLedgerEntry[];
  };
  /** `undefined` when the core could not start; the legacy store is still usable. */
  migration?: DecisionLedgerMigration;
  registry?: NamespaceMigrationRegistry;
  repository?: StateRepository;
  journal?: EventJournal;
  quarantine?: StateQuarantine;
  handle?: DatabaseHandle;
  recovery?: RecoveryReport;
  /** The legacy JSON store, unchanged, for a caller that must fall back. */
  legacy: DecisionLedgerStore;
  /** True when the core opened and the migration is live. */
  active: boolean;
  /** Hand authority to the database. Refused until the battery has passed. */
  promote(): { ok: boolean; detail: string };
  /** A one-line summary for a health line or a diagnostic. */
  summary(): string;
}

interface StateCoreOptions {
  /** The resolved data root — `app.getPath("userData")` in production. */
  dataRoot: string;
  /** The existing JSON ledger. This module never replaces it, only routes around it. */
  legacy: DecisionLedgerStore;
  /** Comparisons required before promotion. Defaults to the pilot's declared battery. */
  requiredClean?: number;
}

interface StateCoreInternal extends StateCoreService {
  /** Set when the core could not start, for the health detail. */
  failure?: string;
}

export function createStateCoreModule(options: StateCoreOptions): BootModule<StateCoreInternal> {
  const { dataRoot, legacy } = options;
  const requiredClean = options.requiredClean ?? DECISION_LEDGER_REQUIRED_CLEAN;
  let handle: DatabaseHandle | undefined;
  let service: StateCoreInternal;
  let disposed = false;

  try {
    handle = openDatabase(stateDatabasePath(dataRoot));
    const registry = createNamespaceMigrationRegistry(handle);
    const repository = createStateRepository(handle);
    const journal = createEventJournal(handle);
    const quarantine = createStateQuarantine(handle, repository);
    const recovery = inspectRecovery({ handle, journal, quarantine, consumers: [], root: dataRoot, supportedVersion: CORE_SCHEMA_VERSION });

    // Refuse to write into a database this build does not understand. The book's rule for a
    // bad migration is to protect the old data and refuse the capability, not to continue
    // and hope — so a schema from the future leaves the module degraded and the JSON ledger
    // authoritative.
    if (recovery.schema.relation === "ahead") {
      throw new Error(`state database schema v${recovery.schema.current} is newer than this build supports (v${recovery.schema.expected})`);
    }
    const integrity = checkIntegrity(handle);
    if (!integrity.ok) throw new Error(`state database failed integrity_check: ${integrity.detail}`);

    registry.declare({
      namespace: DECISION_LEDGER_NAMESPACE,
      owner: "persistence",
      requiredClean,
      jsonSunset: "removed once the database has been authoritative across two releases and the decision-ledger compatibility read has no callers"
    });

    const migration = createDecisionLedgerMigration({ handle, registry, legacy, repository, journal });
    // 4. read-old baseline, then 5. shadow read/compare. Both are idempotent.
    const imported = migration.importLegacy();
    if (!migration.state()?.phase || migration.state()?.phase === "shadow-disabled") migration.beginShadow();

    service = {
      ledger: {
        list: (taskId) => migration.list(taskId),
        append: (entry) => {
          migration.append(entry);
          // The routed append returns the durable write result; the ledger API is
          // value-returning, so the entry is what the caller gets back — matching the
          // legacy store's own contract.
          return structuredClone(entry);
        },
        appendAll: (entries) => {
          if (entries.length > 0) migration.appendAll(entries);
          return entries.map((entry) => structuredClone(entry));
        }
      },
      migration,
      registry,
      repository,
      journal,
      quarantine,
      handle,
      recovery,
      legacy,
      active: true,
      promote() {
        try {
          const state = migration.promote();
          return { ok: true, detail: `authority=${state.authority} phase=${state.phase} at ${state.promotedAt}` };
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : String(error) };
        }
      },
      summary() {
        const state = migration.state();
        return `decision-ledger ${state ? describeMigration(state) : "undeclared"}; imported ${imported.imported} legacy entr${imported.imported === 1 ? "y" : "ies"}; ${describeDatabase((handle as DatabaseHandle).info())}`;
      }
    };
  } catch (error) {
    // DEGRADED, not a boot failure: the legacy store is untouched and still authoritative.
    const failure = error instanceof Error ? error.message : String(error);
    try { handle?.close(); } catch { /* already closed */ }
    handle = undefined;
    service = {
      ledger: {
        list: (taskId) => legacy.list(taskId),
        append: (entry) => legacy.append(entry),
        appendAll: (entries) => legacy.appendAll(entries)
      },
      legacy,
      active: false,
      failure,
      promote: () => ({ ok: false, detail: `the state core is not active: ${failure}` }),
      summary: () => `state core DEGRADED, falling back to the JSON ledger: ${failure}`
    };
  }

  const built = service;
  /**
   * The summary is captured ONCE, at build time.
   *
   * Reading it live would query the database, and `health()` is called during shutdown after
   * `dispose()` has closed the handle — which threw "database is not open". A health line
   * that cannot be printed for a disposed module is worse than a slightly stale one, and the
   * migration state at boot is what an operator needs to see anyway.
   */
  const summaryAtBuild = built.summary();
  return {
    service: built,
    health: () => ({
      module: "state-core",
      status: built.active ? "READY" : "DEGRADED",
      detail: disposed ? `${summaryAtBuild}; disposed` : summaryAtBuild
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try { handle?.close(); } catch { /* best effort */ }
    }
  };
}
