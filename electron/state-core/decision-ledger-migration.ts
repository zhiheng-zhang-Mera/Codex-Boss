import type { DecisionLedgerEntry } from "../../src/shared/decision-ledger";
import { validateLedgerEntry } from "../../src/shared/decision-ledger";
import { DecisionLedgerStore } from "../commander/decision-ledger-store";
import type { DatabaseHandle } from "./database";
import { createEventJournal, type EventJournal } from "./event-journal";
import type { NamespaceMigrationRegistry, NamespaceMigrationState, MigrationAuthority } from "./namespace-migration";
import { createStateRepository, type StateRepository } from "./state-repository";
import { createShadowCompare, type ShadowWriteResult } from "./shadow-compare";

/**
 * Decision-ledger pilot migration (platform foundation, Phase 02 Task C).
 *
 * The first of the two domains the book selects, and it is a good pilot precisely because
 * it is an append-only audit ledger: a divergence here is a missing audit record, which is
 * the kind of loss that must be caught during the comparison window rather than after.
 *
 * ## What is migrated
 *
 * The ledger's durable state — `decision-ledger` — moves from
 * `<dataRoot>/.boss/decision-ledger.json` to a `decision-ledger` namespace in the state
 * database. The Phase 01 ownership rule is preserved: `persistence` remains the ONE
 * authoritative owner of that namespace, and only which STORAGE holds it changes. There is
 * no second owner at any point in the sequence.
 *
 * ## The sequence, as the book specifies it
 *
 *   1. **read-old baseline** — `importLegacy()` copies the existing JSON entries in.
 *   2. **shadow read/compare** — every append writes both sides and compares; the JSON
 *      side is authoritative, so a divergence costs nothing.
 *   3. **authoritative DB write** — `promote()` after the comparison battery passes.
 *   4. **restart/replay acceptance** — covered by the journal's idempotency key plus
 *      `reconcile()`, which re-emits any event the ledger holds but the journal is missing.
 *      That is what makes the window crash-safe rather than merely unlikely to break.
 *   5. **remove old authoritative write** — the JSON side is never written again once
 *      authority moves; it is retained read-only, and `jsonSunset` on the record states
 *      when it may go.
 *
 * ## Events
 *
 * Each appended decision also publishes `DECISION_RECORDED` to the durable journal, with
 * the entry id as the idempotency key. A replay therefore cannot double-record it.
 */

/** The durable namespace this pilot migrates. */
export const DECISION_LEDGER_NAMESPACE = "decision-ledger";

/** The journal event type for one recorded decision. */
const DECISION_RECORDED_EVENT = "DECISION_RECORDED";

/**
 * The comparison battery size. Chosen as 10 rather than 1 or 1000: the ledger is written
 * on every automatic decision, so ten representative appends arrive quickly, and each one
 * compares the ENTIRE ledger rather than a single entry — so ten clean comparisons means
 * ten full-document agreements, not ten lucky rows.
 */
export const DECISION_LEDGER_REQUIRED_CLEAN = 10;

interface DecisionLedgerSnapshot {
  entries: DecisionLedgerEntry[];
}

export interface DecisionLedgerMigration {
  /** The side currently allowed to write. */
  authority(): MigrationAuthority | undefined;
  /** The migration record, for a report. */
  state(): NamespaceMigrationState | undefined;
  /** Entries, read from whichever side is authoritative. */
  list(taskId?: string): DecisionLedgerEntry[];
  /** Append one decision through the migration routing, publishing its event. */
  append(entry: DecisionLedgerEntry): ShadowWriteResult<DecisionLedgerSnapshot>;
  /** Append several decisions in one routed write. */
  appendAll(entries: readonly DecisionLedgerEntry[]): ShadowWriteResult<DecisionLedgerSnapshot>;
  /** Copy the legacy JSON entries into the database. Idempotent. */
  importLegacy(): { imported: number; alreadyPresent: number };
  /** Enter the shadow comparison window. */
  beginShadow(): NamespaceMigrationState;
  /** Compare both sides without writing. */
  compare(): ShadowWriteResult<DecisionLedgerSnapshot>;
  /** Hand authority to the database; refuses until the battery has passed. */
  promote(): NamespaceMigrationState;
  /** Return authority to JSON, e.g. after a divergence. */
  demote(reason: string): NamespaceMigrationState;
  /**
   * Re-emit any journal event the ledger holds but the journal is missing.
   *
   * This is the crash-window repair: an append that reached the ledger but died before
   * publishing its event is completed on the next call, and the idempotency key means a
   * re-run is a no-op. Returns how many events it had to add.
   */
  reconcile(): { reEmitted: number; alreadyPresent: number };
  /** The repository and journal, so a diagnostic or the bridge can share them. */
  readonly repository: StateRepository;
  readonly journal: EventJournal;
}

/** A stable, order-independent projection used for comparison. */
export function canonicalLedger(entries: readonly DecisionLedgerEntry[]): Array<Record<string, unknown>> {
  // Sorted by id: the store's own `list()` orders by `createdAt` descending, and two
  // entries can share a timestamp, so a raw array comparison is not stable. Sorting by
  // the identity field compares the same SET on both sides without inventing an order.
  return [...entries]
    .map((entry) => ({
      id: entry.id,
      taskId: entry.taskId,
      createdAt: entry.createdAt,
      question: entry.question,
      candidates: [...entry.candidates],
      chosen: entry.chosen,
      evidence: [...entry.evidence],
      outcome: entry.outcome,
      rollback: entry.rollback ?? null,
      policy: entry.policy ?? null,
      source: entry.source,
      stallOccurrence: entry.stallOccurrence ?? null
    }))
    .sort((left, right) => (String(left.id) < String(right.id) ? -1 : 1));
}

interface DecisionLedgerMigrationOptions {
  handle: DatabaseHandle;
  registry: NamespaceMigrationRegistry;
  /** The legacy JSON store. Its path is what the pilot retires; the class is untouched. */
  legacy: DecisionLedgerStore;
  repository?: StateRepository;
  journal?: EventJournal;
}

export function createDecisionLedgerMigration(options: DecisionLedgerMigrationOptions): DecisionLedgerMigration {
  const { handle, registry, legacy } = options;
  const repository = options.repository ?? createStateRepository(handle);
  const journal = options.journal ?? createEventJournal(handle);

  repository.declareNamespace({ namespace: DECISION_LEDGER_NAMESPACE, owner: "persistence", kind: "append-only" });

  const eventIdFor = (entryId: string): string => `${DECISION_LEDGER_NAMESPACE}:${entryId}`;

  /** The database side's whole-ledger read, in the same shape the JSON side returns. */
  function readDatabase(): DecisionLedgerSnapshot {
    return {
      entries: repository.list<DecisionLedgerEntry>(DECISION_LEDGER_NAMESPACE).map((record) => record.value)
    };
  }

  function readLegacy(): DecisionLedgerSnapshot {
    return { entries: legacy.list() };
  }

  /** Store one entry in the database, keyed by id so a re-import cannot duplicate it. */
  function putDatabase(entry: DecisionLedgerEntry): void {
    repository.put(DECISION_LEDGER_NAMESPACE, entry.id, entry, entry.createdAt);
  }

  /** Publish the durable event for one entry. Idempotent on the entry id. */
  function publish(entry: DecisionLedgerEntry): void {
    journal.append({
      type: DECISION_RECORDED_EVENT,
      aggregateId: entry.taskId || entry.id,
      producer: "persistence",
      idempotencyKey: entry.id,
      createdAt: entry.createdAt,
      id: eventIdFor(entry.id),
      payload: {
        entryId: entry.id,
        taskId: entry.taskId,
        outcome: entry.outcome,
        source: entry.source,
        chosen: entry.chosen
      }
    });
  }

  const comparison = createShadowCompare<DecisionLedgerSnapshot>({
    namespace: DECISION_LEDGER_NAMESPACE,
    registry,
    // Both directions are the same two closures; which one is authoritative is decided by
    // the registry on every call, so a promotion takes effect without rebuilding anything.
    authoritative: { read: () => (registry.authorityOf(DECISION_LEDGER_NAMESPACE) === "database" ? readDatabase() : readLegacy()), write: () => {} },
    shadow: { read: () => (registry.authorityOf(DECISION_LEDGER_NAMESPACE) === "database" ? readLegacy() : readDatabase()), write: () => {} },
    canonical: (snapshot) => canonicalLedger(snapshot.entries),
    describe: (snapshot) => `ledger(${snapshot.entries.length})`
  });

  function applySnapshot(snapshot: DecisionLedgerSnapshot, side: "database" | "json", onlyMissing: boolean): void {
    if (side === "database") {
      for (const entry of snapshot.entries) {
        if (onlyMissing && repository.get(DECISION_LEDGER_NAMESPACE, entry.id)) continue;
        validateLedgerEntry(entry);
        putDatabase(entry);
      }
      return;
    }
    // The JSON side is authoritative here, so it is written through the legacy store —
    // which keeps its own atomic-write and fail-closed-restore behaviour.
    if (onlyMissing) {
      const existing = new Set(legacy.list().map((entry) => entry.id));
      const additions = snapshot.entries.filter((entry) => !existing.has(entry.id));
      if (additions.length > 0) legacy.appendAll(additions);
      return;
    }
    legacy.appendAll(snapshot.entries);
  }

  /** Write both sides in the order the current authority demands, then compare. */
  function routedWrite(entries: readonly DecisionLedgerEntry[]): ShadowWriteResult<DecisionLedgerSnapshot> {
    for (const entry of entries) validateLedgerEntry(entry);
    const authority = registry.authorityOf(DECISION_LEDGER_NAMESPACE);
    const state = registry.state(DECISION_LEDGER_NAMESPACE);
    if (!state) throw new Error(`namespace "${DECISION_LEDGER_NAMESPACE}" is not declared for migration`);
    const comparing = state.phase === "shadow-comparing" || state.phase === "ready-to-promote" || state.phase === "diverged";

    if (authority === "database") {
      // Authoritative first: its failure must propagate to the caller.
      applySnapshot({ entries: [...entries] }, "database", false);
      for (const entry of entries) publish(entry);
      if (!comparing) return { decision: "authoritative-only", value: readDatabase(), state };
      try {
        applySnapshot({ entries: [...entries] }, "json", false);
      } catch (error) {
        const detail = `the JSON shadow write failed: ${error instanceof Error ? error.message : String(error)}`;
        return { decision: "shadow-failed", value: readDatabase(), detail, state: registry.recordComparison(DECISION_LEDGER_NAMESPACE, false, "appendAll", detail) };
      }
      return comparison.compare(`appendAll(${entries.length})`);
    }

    // JSON is still authoritative (or the namespace is not yet shadowing).
    applySnapshot({ entries: [...entries] }, "json", false);
    if (!comparing) {
      // Not yet comparing: the database side is not being written, so the pilot changes
      // nothing about production behaviour during this phase.
      for (const entry of entries) publish(entry);
      return { decision: "authoritative-only", value: readLegacy(), state };
    }
    try {
      applySnapshot({ entries: [...entries] }, "database", false);
      for (const entry of entries) publish(entry);
    } catch (error) {
      const detail = `the database shadow write failed: ${error instanceof Error ? error.message : String(error)}`;
      return { decision: "shadow-failed", value: readLegacy(), detail, state: registry.recordComparison(DECISION_LEDGER_NAMESPACE, false, "appendAll", detail) };
    }
    return comparison.compare(`appendAll(${entries.length})`);
  }

  return {
    authority: () => registry.authorityOf(DECISION_LEDGER_NAMESPACE),
    state: () => registry.state(DECISION_LEDGER_NAMESPACE),

    list(taskId) {
      const entries = comparison.read().entries;
      return entries
        .filter((entry) => !taskId || entry.taskId === taskId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((entry) => structuredClone(entry));
    },

    append(entry) {
      return routedWrite([entry]);
    },

    appendAll(entries) {
      if (entries.length === 0) return { decision: "authoritative-only", value: comparison.read(), state: registry.state(DECISION_LEDGER_NAMESPACE) as NamespaceMigrationState };
      return routedWrite(entries);
    },

    importLegacy() {
      const existing = new Set(repository.list<DecisionLedgerEntry>(DECISION_LEDGER_NAMESPACE).map((record) => record.key));
      const legacyEntries = legacy.list();
      let imported = 0;
      let alreadyPresent = 0;
      for (const entry of legacyEntries) {
        if (existing.has(entry.id)) { alreadyPresent++; continue; }
        validateLedgerEntry(entry);
        putDatabase(entry);
        imported++;
      }
      return { imported, alreadyPresent };
    },

    beginShadow: () => registry.beginShadow(DECISION_LEDGER_NAMESPACE),
    compare: () => comparison.compare(),
    promote: () => registry.promote(DECISION_LEDGER_NAMESPACE),
    demote: (reason) => registry.demote(DECISION_LEDGER_NAMESPACE, reason),

    reconcile() {
      // Only meaningful once the database is authoritative: before that the JSON side is
      // the record of truth and the database is a mirror, so re-emitting from it would
      // publish events for data that has not been promoted.
      const state = registry.state(DECISION_LEDGER_NAMESPACE);
      if (registry.authorityOf(DECISION_LEDGER_NAMESPACE) !== "database" || !state) return { reEmitted: 0, alreadyPresent: 0 };
      let reEmitted = 0;
      let alreadyPresent = 0;
      for (const record of repository.list<DecisionLedgerEntry>(DECISION_LEDGER_NAMESPACE)) {
        const entry = record.value;
        // Entries that predate promotion were imported from the legacy baseline, which
        // never published events. Re-emitting them would announce history rather than
        // repair a lost commit, so the boundary is the promotion instant: everything
        // written at or after it was supposed to publish, and anything missing there is a
        // genuine crash-window loss.
        if (state.promotedAt && entry.createdAt < state.promotedAt) continue;
        if (journal.hasIdempotencyKey("persistence", entry.id)) { alreadyPresent++; continue; }
        publish(entry);
        reEmitted++;
      }
      return { reEmitted, alreadyPresent };
    },

    repository,
    journal
  };
}
