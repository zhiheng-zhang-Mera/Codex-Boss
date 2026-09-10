import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import type { ProviderMatrix, ProviderMatrixRow } from "../../src/shared/tenx/network";

/**
 * 10M: provider reachability matrix (forward, durable).
 *
 * Each node maintains a live per-provider matrix row:
 * provider / reachable / authenticated / latency / regionBlocked / rateLimited /
 * proxyRequired / lastSuccess / lastFailure. The scheduler (10F) consumes this
 * matrix rather than trusting configuration alone. Observations only: a provider
 * is reachable/authenticated only when actually observed. A probe failure
 * updates lastFailure without ever fabricating success.
 */

export interface TenxProviderMatrixFile {
  schemaVersion: 1;
  matrices: ProviderMatrix[];
}

export interface ProviderObservation {
  provider: string;
  reachable?: boolean;
  authenticated?: boolean;
  latencyMs?: number;
  regionBlocked?: boolean;
  rateLimited?: boolean;
  proxyRequired?: boolean;
  error?: string;
}

export class TenxProviderMatrixStore {
  private readonly matrices = new Map<string, ProviderMatrix>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Apply one observation to a node's provider row; keeps history via lastSuccess/lastFailure. */
  observe(nodeId: string, observation: ProviderObservation): ProviderMatrix {
    const current = this.matrices.get(nodeId);
    const existingRow = current?.rows.find((row) => row.provider === observation.provider);
    const at = this.now();
    const row: ProviderMatrixRow = {
      provider: observation.provider,
      reachable: observation.reachable ?? existingRow?.reachable ?? false,
      authenticated: observation.authenticated ?? existingRow?.authenticated ?? false,
      latencyMs: observation.latencyMs ?? existingRow?.latencyMs,
      regionBlocked: observation.regionBlocked ?? existingRow?.regionBlocked ?? false,
      rateLimited: observation.rateLimited ?? existingRow?.rateLimited ?? false,
      proxyRequired: observation.proxyRequired ?? existingRow?.proxyRequired ?? false,
      lastSuccessAt: observation.reachable ? at : existingRow?.lastSuccessAt,
      lastFailureAt: observation.error ? at : existingRow?.lastFailureAt,
      lastFailureReason: observation.error ?? existingRow?.lastFailureReason
    };
    const rows = current ? current.rows.filter((item) => item.provider !== observation.provider) : [];
    const matrix: ProviderMatrix = { nodeId, rows: [...rows, row], sampledAt: at };
    this.matrices.set(nodeId, matrix);
    this.persist();
    return structuredClone(matrix);
  }

  /** Remove a provider row (provider deregistered). */
  forgetProvider(nodeId: string, provider: string): ProviderMatrix | undefined {
    const current = this.matrices.get(nodeId);
    if (!current) return undefined;
    const matrix: ProviderMatrix = { ...current, rows: current.rows.filter((row) => row.provider !== provider), sampledAt: this.now() };
    this.matrices.set(nodeId, matrix);
    this.persist();
    return structuredClone(matrix);
  }

  /** Ready providers: reachable + authenticated + not blocked/limited (scheduler input). */
  readyProviders(nodeId: string): string[] {
    const matrix = this.matrices.get(nodeId);
    if (!matrix) return [];
    return matrix.rows.filter((row) => row.reachable && row.authenticated && !row.regionBlocked && !row.rateLimited).map((row) => row.provider).sort();
  }

  matrix(nodeId: string): ProviderMatrix | undefined {
    const matrix = this.matrices.get(nodeId);
    return matrix ? structuredClone(matrix) : undefined;
  }

  list(): ProviderMatrix[] {
    return [...this.matrices.values()].map((matrix) => structuredClone(matrix)).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<TenxProviderMatrixFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.matrices)) throw new Error("Invalid tenx provider matrix store");
    for (const matrix of parsed.matrices) {
      if (!matrix || typeof matrix.nodeId !== "string") throw new Error("Invalid tenx provider matrix");
      this.matrices.set(matrix.nodeId, matrix);
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: TenxProviderMatrixFile = { schemaVersion: 1, matrices: [...this.matrices.values()] };
    writeJson(this.filePath, file);
  }
}
