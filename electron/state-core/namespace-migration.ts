import type { DatabaseHandle } from "./database";
import { createStateRepository, type StateRepository } from "./state-repository";

/**
 * Namespace migration state (platform foundation, Phase 02 Task C).
 *
 * Tracks, per migrated namespace, which side is currently authoritative and how the
 * shadow comparison is going. This is the book's required arbitration record: a
 * dual-write window must name its authoritative side, its comparison evidence and the
 * condition for leaving the window. All three live here.
 *
 * ## Where the record itself is stored
 *
 * In the state database, under a namespace owned by the state core. That is deliberate
 * bootstrapping: if the record lived in a JSON file, the file could be lost or corrupted
 * exactly when a store needed to know who was allowed to write — and a store that cannot
 * answer "am I authoritative?" must not write at all. Two alternatives were rejected: a
 * JSON file (same failure mode as the state being migrated) and a column on the state
 * namespace (which would make a migration flip look like a domain change).
 *
 * ## Authority versus shadow
 *
 * Exactly one side is authoritative at a time, and the other is a SHADOW that is written
 * only so the two can be compared. `assertSingleAuthority` exists because the book's rule
 * is that migration must not create a second authoritative owner: a namespace whose
 * record says `both` is refused rather than believed.
 */

export type MigrationAuthority =
  /** Not selected for migration. Only the legacy JSON path writes. */
  | "json"
  /** Authority has been handed to the state core. JSON is read-only compatibility. */
  | "database";

type MigrationPhase =
  /** Only the authoritative side is written; the shadow is not yet exercised. */
  | "shadow-disabled"
  /** Both sides are written and every write is compared. */
  | "shadow-comparing"
  /** The comparison battery has passed; authority could be flipped. */
  | "ready-to-promote"
  /** Authority has moved to the database; the JSON side is retained read-only. */
  | "migrated"
  /** A divergence was observed. Authority stays on JSON until it is resolved. */
  | "diverged";

interface DivergenceRecord {
  at: string;
  /** What the comparison found, in one line. */
  detail: string;
  /** The operation that produced it, e.g. `append dec-1`. */
  operation: string;
  /** How many consecutive clean comparisons preceded it. */
  cleanBefore: number;
}

export interface NamespaceMigrationState {
  namespace: string;
  /** The Phase 01 authoritative owner of this namespace, unchanged by migration. */
  owner: string;
  authority: MigrationAuthority;
  phase: MigrationPhase;
  /** Consecutive comparisons with no divergence. Reset to 0 by any divergence. */
  consecutiveClean: number;
  /** Comparisons required before the phase may become `ready-to-promote`. */
  requiredClean: number;
  comparisons: number;
  updatedAt: string;
  /** When authority last moved to the database. */
  promotedAt?: string;
  /** Why the JSON side is still kept, and when it may be removed. */
  jsonSunset: string;
  /** The most recent divergences, newest first, bounded. */
  divergences: DivergenceRecord[];
}

interface MigrationDeclaration {
  namespace: string;
  owner: string;
  /**
   * Comparisons required before promotion. The battery size the book asks for is a
   * decision, so it is declared per namespace rather than hard-coded here.
   */
  requiredClean: number;
  /** The stated condition under which the JSON compatibility side may be removed. */
  jsonSunset: string;
  /** Start directly at the database (only for a namespace with no legacy data). */
  startAuthoritativeOnDatabase?: boolean;
}

/** How many divergences are retained per namespace. */
const DIVERGENCE_RETENTION = 20;

/** The namespace the state core owns for its own migration bookkeeping. */
const MIGRATION_NAMESPACE = "state-core:migration";

/**
 * A namespace whose recorded authority is not exactly one side.
 *
 * Thrown rather than tolerated: two authoritative writers is the failure Phase 01's
 * ownership registry exists to prevent, and a migration must not reintroduce it.
 */
class AuthorityConflictError extends Error {
  constructor(namespace: string, detail: string) {
    super(`namespace "${namespace}" does not have exactly one authoritative side: ${detail}`);
    this.name = "AuthorityConflictError";
  }
}

export interface NamespaceMigrationRegistry {
  /** The record for a namespace, or undefined when it was never declared. */
  state(namespace: string): NamespaceMigrationState | undefined;
  /** Every declared namespace, sorted by name. */
  states(): NamespaceMigrationState[];
  /** Declare a namespace, or return its existing record unchanged. */
  declare(declaration: MigrationDeclaration): NamespaceMigrationState;
  /** Which side may write. `undefined` means the namespace is not being migrated. */
  authorityOf(namespace: string): MigrationAuthority | undefined;
  /** True when the namespace has been handed to the state core. */
  isMigrated(namespace: string): boolean;
  /** Move a namespace into shadow comparison. */
  beginShadow(namespace: string): NamespaceMigrationState;
  /** Record a comparison outcome, advancing or resetting the clean run. */
  recordComparison(namespace: string, clean: boolean, operation: string, detail?: string): NamespaceMigrationState;
  /**
   * Hand authority to the database. REFUSED unless the comparison battery has passed,
   * which is the book's gate 6: no promotion without consecutive clean comparisons.
   */
  promote(namespace: string): NamespaceMigrationState;
  /** Return authority to the JSON side, e.g. after a divergence. */
  demote(namespace: string, reason: string): NamespaceMigrationState;
  /** The repository backing the records, for a diagnostic that wants raw rows. */
  readonly repository: StateRepository;
}

export function createNamespaceMigrationRegistry(handle: DatabaseHandle, repository: StateRepository = createStateRepository(handle)): NamespaceMigrationRegistry {
  // The bookkeeping namespace is declared idempotently, so opening the registry twice is
  // safe and a boot path does not need to know whether this is the first run.
  repository.declareNamespace({ namespace: MIGRATION_NAMESPACE, owner: "state-core", kind: "document" });
  const nowIso = (): string => new Date().toISOString();

  function read(namespace: string): NamespaceMigrationState | undefined {
    const record = repository.get<NamespaceMigrationState>(MIGRATION_NAMESPACE, namespace);
    if (!record) return undefined;
    assertSingleAuthority(record.value);
    return record.value;
  }

  function write(state: NamespaceMigrationState): NamespaceMigrationState {
    assertSingleAuthority(state);
    repository.put(MIGRATION_NAMESPACE, state.namespace, state);
    return state;
  }

  function assertSingleAuthority(state: NamespaceMigrationState): void {
    if (state.authority !== "json" && state.authority !== "database") {
      throw new AuthorityConflictError(state.namespace, `authority is ${JSON.stringify(state.authority)}`);
    }
    if (state.phase === "migrated" && state.authority !== "database") {
      throw new AuthorityConflictError(state.namespace, `phase is migrated but authority is ${state.authority}`);
    }
    if (state.phase !== "migrated" && state.phase !== "ready-to-promote" && state.authority === "database") {
      throw new AuthorityConflictError(state.namespace, `authority is the database but phase is ${state.phase}`);
    }
  }

  const registry: NamespaceMigrationRegistry = {
    state: read,

    states() {
      return repository
        .list<NamespaceMigrationState>(MIGRATION_NAMESPACE)
        .map((record) => record.value)
        .sort((left, right) => (left.namespace < right.namespace ? -1 : 1));
    },

    declare(declaration) {
      const existing = read(declaration.namespace);
      if (existing) {
        // Re-declaring with a different owner would make the Phase 01 ownership claim
        // disagree with the migration record, so it is refused rather than overwritten.
        if (existing.owner !== declaration.owner) {
          throw new AuthorityConflictError(declaration.namespace, `recorded owner is "${existing.owner}", declaration says "${declaration.owner}"`);
        }
        return existing;
      }
      if (!Number.isInteger(declaration.requiredClean) || declaration.requiredClean < 0) {
        throw new Error(`requiredClean must be a non-negative integer, got ${declaration.requiredClean}`);
      }
      if (typeof declaration.jsonSunset !== "string" || declaration.jsonSunset.trim() === "") {
        throw new Error(`namespace "${declaration.namespace}" needs a stated jsonSunset condition; the book requires a defined exit from the compatibility window`);
      }
      const onDatabase = declaration.startAuthoritativeOnDatabase === true;
      return write({
        namespace: declaration.namespace,
        owner: declaration.owner,
        authority: onDatabase ? "database" : "json",
        phase: onDatabase ? "migrated" : "shadow-disabled",
        consecutiveClean: 0,
        requiredClean: declaration.requiredClean,
        comparisons: 0,
        updatedAt: nowIso(),
        jsonSunset: declaration.jsonSunset,
        divergences: [],
        ...(onDatabase ? { promotedAt: nowIso() } : {})
      });
    },

    authorityOf(namespace) {
      return read(namespace)?.authority;
    },

    isMigrated(namespace) {
      return read(namespace)?.phase === "migrated";
    },

    beginShadow(namespace) {
      const state = read(namespace);
      if (!state) throw new Error(`namespace "${namespace}" is not declared for migration`);
      if (state.phase === "migrated") throw new Error(`namespace "${namespace}" is already migrated; shadow comparison is over`);
      return write({ ...state, phase: state.phase === "diverged" ? "shadow-comparing" : "shadow-comparing", updatedAt: nowIso() });
    },

    recordComparison(namespace, clean, operation, detail) {
      const state = read(namespace);
      if (!state) throw new Error(`namespace "${namespace}" is not declared for migration`);
      const at = nowIso();
      const comparisons = state.comparisons + 1;
      if (clean) {
        const consecutiveClean = state.consecutiveClean + 1;
        // `ready-to-promote` is reached only by the clean run itself, so a caller cannot
        // declare readiness by editing the phase.
        const phase: MigrationPhase = state.phase === "ready-to-promote" || state.phase === "migrated"
          ? state.phase
          : consecutiveClean >= state.requiredClean ? "ready-to-promote" : "shadow-comparing";
        return write({ ...state, phase, consecutiveClean, comparisons, updatedAt: at });
      }
      const divergence: DivergenceRecord = {
        at,
        operation,
        detail: detail ?? "the two sides disagree",
        cleanBefore: state.consecutiveClean
      };
      return write({
        ...state,
        // Authority stays where it was. A divergence during the shadow window is exactly
        // the signal that promotion would be premature.
        phase: "diverged",
        consecutiveClean: 0,
        comparisons,
        updatedAt: at,
        divergences: [divergence, ...state.divergences].slice(0, DIVERGENCE_RETENTION)
      });
    },

    promote(namespace) {
      const state = read(namespace);
      if (!state) throw new Error(`namespace "${namespace}" is not declared for migration`);
      if (state.phase === "migrated") return state;
      if (state.phase !== "ready-to-promote") {
        throw new Error(
          `refusing to promote "${namespace}": the comparison battery has not passed (phase ${state.phase}, ${state.consecutiveClean}/${state.requiredClean} consecutive clean)`
        );
      }
      return write({ ...state, authority: "database", phase: "migrated", updatedAt: nowIso(), promotedAt: nowIso() });
    },

    demote(namespace, reason) {
      const state = read(namespace);
      if (!state) throw new Error(`namespace "${namespace}" is not declared for migration`);
      const at = nowIso();
      return write({
        ...state,
        authority: "json",
        phase: "diverged",
        consecutiveClean: 0,
        updatedAt: at,
        divergences: [{ at, operation: "demote", detail: reason, cleanBefore: state.consecutiveClean }, ...state.divergences].slice(0, DIVERGENCE_RETENTION)
      });
    },

    repository
  };

  return registry;
}

/** One line per namespace for a migration report or a boot health line. */
function describeMigration(state: NamespaceMigrationState): string {
  return `${state.namespace}: authority=${state.authority} phase=${state.phase} clean=${state.consecutiveClean}/${state.requiredClean} divergences=${state.divergences.length}`;
}
