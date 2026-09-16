import type { MigrationAuthority, NamespaceMigrationRegistry, NamespaceMigrationState } from "./namespace-migration";

/**
 * Shadow comparison (platform foundation, Phase 02 Task C).
 *
 * The mechanism the book asks for during a dual-write window: exactly one side is
 * authoritative, the other is written too, and every write is COMPARED so a divergence is
 * detected while the legacy path is still the one telling the truth.
 *
 * ## The rules this enforces
 *
 *   - **Reads come from the authoritative side, always.** A read that fell back to the
 *     shadow would return data the authoritative side never agreed to.
 *   - **A shadow write failure is a divergence, not an exception.** The authoritative
 *     write has already succeeded, and throwing afterwards would report a failure for an
 *     operation that did happen — the caller would retry and duplicate it.
 *   - **Divergence does not move authority.** It resets the clean run and records the
 *     evidence. Promotion is a separate, gated call.
 *   - **The comparison is on a canonical form**, supplied by the caller, because only the
 *     domain knows what "the same" means for its own state. Comparing raw serialisations
 *     would report a divergence for key order alone.
 *
 * ## What this is not
 *
 * It is not a distributed transaction. If the process dies between the authoritative and
 * shadow writes, the two sides disagree and the next comparison says so. That is the
 * correct behaviour for a migration window: the authoritative side is unharmed, and the
 * divergence is evidence rather than silent corruption.
 */

type ShadowDecision =
  /** Wrote the authoritative side only; the shadow is not being compared yet. */
  | "authoritative-only"
  /** Wrote both and they agree. */
  | "agree"
  /** Wrote both and they disagree; authority did not move. */
  | "diverged"
  /** Wrote the authoritative side; the shadow write threw. */
  | "shadow-failed";

export interface ShadowWriteResult<T> {
  decision: ShadowDecision;
  /** The value the AUTHORITATIVE side now holds. */
  value: T;
  /** Human-readable evidence, present whenever `decision` is not `agree`/`authoritative-only`. */
  detail?: string;
  state: NamespaceMigrationState;
}

interface ShadowCompareOptions<T> {
  namespace: string;
  registry: NamespaceMigrationRegistry;
  /** The side allowed to tell the truth. */
  authoritative: {
    read: () => T;
    write: (value: T) => void;
  };
  /** The mirror. Never read by a caller; only compared. */
  shadow: {
    read: () => T;
    write: (value: T) => void;
  };
  /**
   * Reduce a value to its comparable form. Called on both sides for every comparison, so
   * it must be total and order-independent where order is not meaningful.
   */
  canonical: (value: T) => unknown;
  /** Label for the divergence record, e.g. `append dec-1`. */
  describe?: (value: T) => string;
}

interface ShadowCompare<T> {
  /** The authoritative value. */
  read(): T;
  /** Write through the migration routing and compare. */
  write(value: T): ShadowWriteResult<T>;
  /** Compare the two sides without writing, for a scheduled reconciliation. */
  compare(operation?: string): ShadowWriteResult<T>;
  /** Which side currently writes. */
  authority(): MigrationAuthority | undefined;
  /** The current migration record. */
  state(): NamespaceMigrationState | undefined;
}

/** Structural equality on canonical forms, via a stable JSON rendering. */
export function canonicalEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A short, stable rendering of a canonical form, for a divergence message. */
function render(value: unknown, limit = 400): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function createShadowCompare<T>(options: ShadowCompareOptions<T>): ShadowCompare<T> {
  const { namespace, registry, authoritative, shadow, canonical } = options;
  const label = options.describe ?? (() => namespace);

  function stateNow(): NamespaceMigrationState | undefined {
    return registry.state(namespace);
  }

  function shouldCompare(state: NamespaceMigrationState): boolean {
    return state.phase === "shadow-comparing" || state.phase === "ready-to-promote" || state.phase === "diverged";
  }

  /** Compare both sides and record the outcome. Never throws for a mismatch. */
  function runComparison(operation: string): ShadowWriteResult<T> {
    const state = stateNow();
    if (!state) throw new Error(`namespace "${namespace}" is not declared for migration`);
    const authoritativeValue = authoritative.read();
    let shadowValue: T;
    try {
      shadowValue = shadow.read();
    } catch (error) {
      const detail = `the shadow side could not be read: ${error instanceof Error ? error.message : String(error)}`;
      return { decision: "shadow-failed", value: authoritativeValue, detail, state: registry.recordComparison(namespace, false, operation, detail) };
    }
    if (canonicalEquals(canonical(authoritativeValue), canonical(shadowValue))) {
      return { decision: "agree", value: authoritativeValue, state: registry.recordComparison(namespace, true, operation) };
    }
    const detail = `authoritative=${render(canonical(authoritativeValue))} shadow=${render(canonical(shadowValue))}`;
    return { decision: "diverged", value: authoritativeValue, detail, state: registry.recordComparison(namespace, false, operation, detail) };
  }

  const api: ShadowCompare<T> = {
    read() {
      // Deliberately NOT falling back to the shadow: the authoritative side is the answer
      // even when it is the one that is behind.
      return authoritative.read();
    },

    write(value) {
      const state = stateNow();
      if (!state) throw new Error(`namespace "${namespace}" is not declared for migration`);

      // The authoritative write happens first and its failure propagates: a caller must
      // never be told a write succeeded when the side that owns the data rejected it.
      authoritative.write(value);

      if (!shouldCompare(state)) {
        return { decision: "authoritative-only", value: authoritative.read(), state };
      }

      try {
        shadow.write(value);
      } catch (error) {
        const detail = `the shadow write failed: ${error instanceof Error ? error.message : String(error)}`;
        return { decision: "shadow-failed", value: authoritative.read(), detail, state: registry.recordComparison(namespace, false, label(value), detail) };
      }

      return runComparison(label(value));
    },

    compare(operation = `compare ${namespace}`) {
      return runComparison(operation);
    },

    authority() {
      return registry.authorityOf(namespace);
    },

    state: stateNow
  };

  return api;
}
