import {
  TASK_FINGERPRINT_VERSION,
  buildStructuralFingerprint,
  type FingerprintInput,
  type TaskFingerprint
} from "../../src/shared/task-fingerprint";

/**
 * Engine Phase 4 — task fingerprinter (structural always, semantic optional).
 *
 * The Engine book (§4) forbids a hard-coded topic enum as the routing schema;
 * instead every task gets an OPEN fingerprint. An embedding backend is pluggable
 * and OPTIONAL: when it is missing, slow, or returns malformed data, Boss falls
 * back to the deterministic structural fingerprint — learning quality degrades,
 * routing never breaks.
 */

export interface EmbeddingBackend {
  readonly id: string;
  embed(text: string): Promise<number[]> | number[];
}

export interface SemanticVectorStore {
  put(id: string, vector: number[]): string;
  get(id: string): number[] | undefined;
}

/** In-memory vector store used when no persistent backend is wired yet. */
export class MemoryVectorStore implements SemanticVectorStore {
  private readonly vectors = new Map<string, number[]>();

  put(id: string, vector: number[]): string {
    this.vectors.set(id, [...vector]);
    return id;
  }

  get(id: string): number[] | undefined {
    const vector = this.vectors.get(id);
    return vector ? [...vector] : undefined;
  }

  size(): number {
    return this.vectors.size;
  }
}

export interface TaskFingerprinterOptions {
  backend?: EmbeddingBackend;
  store?: SemanticVectorStore;
  timeoutMs?: number;
}

export interface FingerprintBuildResult {
  fingerprint: TaskFingerprint;
  /** Explainability: how the fingerprint was produced. */
  semantic: boolean;
  notes: string[];
}

export class TaskFingerprinter {
  private readonly backend?: EmbeddingBackend;
  private readonly store: SemanticVectorStore;
  private readonly timeoutMs: number;

  constructor(options: TaskFingerprinterOptions = {}) {
    this.backend = options.backend;
    this.store = options.store ?? new MemoryVectorStore();
    this.timeoutMs = options.timeoutMs ?? 1500;
  }

  /**
   * Build a fingerprint. The semantic reference is added only when the backend
   * produced a usable vector within the timeout; otherwise the structural
   * fingerprint is returned unchanged (deterministic, complete).
   */
  async build(input: FingerprintInput): Promise<FingerprintBuildResult> {
    const structural = buildStructuralFingerprint(input);
    const notes: string[] = [];
    if (!this.backend) {
      notes.push("no embedding backend configured — structural fingerprint only");
      return { fingerprint: structural, semantic: false, notes };
    }
    const text = input.goal ?? "";
    if (!text.trim()) {
      notes.push("empty goal — semantic vector skipped");
      return { fingerprint: structural, semantic: false, notes };
    }
    try {
      const vector = await this.withTimeout(Promise.resolve(this.backend.embed(text)));
      if (!this.isUsableVector(vector)) {
        notes.push(`embedding backend ${this.backend.id} returned an unusable vector — structural fallback`);
        return { fingerprint: structural, semantic: false, notes };
      }
      const ref = `vec-${structural.structuralHash}-${this.backend.id}`;
      this.store.put(ref, vector);
      notes.push(`semantic vector stored as ${ref} (${vector.length} dims)`);
      return { fingerprint: { ...structural, semanticVectorRef: ref }, semantic: true, notes };
    } catch (error) {
      notes.push(`embedding backend failed (${String(error)}) — structural fallback`);
      return { fingerprint: structural, semantic: false, notes };
    }
  }

  /** Deterministic-only path (never awaits anything). */
  buildStructural(input: FingerprintInput): TaskFingerprint {
    return buildStructuralFingerprint(input);
  }

  fingerprintVersion(): string {
    return TASK_FINGERPRINT_VERSION;
  }

  private isUsableVector(vector: unknown): vector is number[] {
    return Array.isArray(vector) && vector.length > 0 && vector.every((value) => typeof value === "number" && Number.isFinite(value));
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`embedding timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
