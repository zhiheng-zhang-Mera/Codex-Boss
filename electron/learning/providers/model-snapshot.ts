import fs from "node:fs";
import path from "node:path";
import { modelIdentityFingerprint, type ModelExecutionIdentity, type ModelSnapshot } from "../../../src/shared/model-identity";

/**
 * Engine Phase 3 — model snapshot registry (dedup by identity fingerprint).
 *
 * Book §8: repeated calls with the same identity must not store a big object
 * again — episodes reference `modelSnapshotId`. Time fields are excluded from the
 * fingerprint, so the same model observed a hundred times yields ONE snapshot
 * whose lastObservedAt advances.
 *
 * A new observed model id therefore creates a NEW snapshot and can never pollute
 * the history of the previous one (A18).
 */

export interface ModelSnapshotFile {
  schemaVersion: 1;
  snapshots: ModelSnapshot[];
}

export class ModelSnapshotRegistry {
  private readonly snapshots = new Map<string, ModelSnapshot>();
  private readonly byFingerprint = new Map<string, string>();
  private sequence = 0;
  private degraded?: string;

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  /** Record an identity; returns the existing snapshot when the identity repeats. */
  record(identity: ModelExecutionIdentity): ModelSnapshot {
    const fingerprint = modelIdentityFingerprint(identity);
    const existingId = this.byFingerprint.get(fingerprint);
    if (existingId) {
      const existing = this.snapshots.get(existingId)!;
      const updated: ModelSnapshot = { ...existing, identity: { ...existing.identity, behaviourEpochId: identity.behaviourEpochId, confidence: identity.confidence }, lastObservedAt: identity.observedAt ?? this.now() };
      this.snapshots.set(existingId, updated);
      this.persist();
      return structuredClone(updated);
    }
    this.sequence += 1;
    const snapshot: ModelSnapshot = {
      schemaVersion: 1,
      id: `MS-${String(this.sequence).padStart(3, "0")}`,
      identity: { ...identity },
      fingerprint,
      firstObservedAt: identity.observedAt ?? this.now(),
      lastObservedAt: identity.observedAt ?? this.now()
    };
    this.snapshots.set(snapshot.id, snapshot);
    this.byFingerprint.set(fingerprint, snapshot.id);
    this.persist();
    return structuredClone(snapshot);
  }

  get(id: string): ModelSnapshot | undefined {
    const snapshot = this.snapshots.get(id);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  findByFingerprint(fingerprint: string): ModelSnapshot | undefined {
    const id = this.byFingerprint.get(fingerprint);
    return id ? this.get(id) : undefined;
  }

  list(): ModelSnapshot[] {
    return [...this.snapshots.values()].map((snapshot) => structuredClone(snapshot)).sort((a, b) => a.id.localeCompare(b.id));
  }

  count(): number {
    return this.snapshots.size;
  }

  /** Derived data: dropping snapshots must never touch episodes (Engine §5). */
  clear(): void {
    this.snapshots.clear();
    this.byFingerprint.clear();
    this.sequence = 0;
    this.persist();
  }

  status(): { count: number; degradedReason?: string } {
    return { count: this.snapshots.size, degradedReason: this.degraded };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<ModelSnapshotFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) throw new Error("Invalid model snapshot file");
      for (const snapshot of parsed.snapshots) {
        if (!snapshot || typeof snapshot.id !== "string" || !snapshot.identity || typeof snapshot.fingerprint !== "string") throw new Error("Invalid model snapshot row");
        this.snapshots.set(snapshot.id, snapshot);
        this.byFingerprint.set(snapshot.fingerprint, snapshot.id);
        const numeric = Number(/^MS-(\d+)$/.exec(snapshot.id)?.[1] ?? 0);
        if (Number.isFinite(numeric)) this.sequence = Math.max(this.sequence, numeric);
      }
    } catch (error) {
      this.snapshots.clear();
      this.byFingerprint.clear();
      this.sequence = 0;
      this.degraded = `model snapshots unreadable: ${String(error)}`; // learning degrades, tasks continue
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const file: ModelSnapshotFile = { schemaVersion: 1, snapshots: [...this.snapshots.values()] };
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
      fs.renameSync(temporary, this.filePath);
    } catch (error) {
      this.degraded = `model snapshot persist failed: ${String(error)}`;
    }
  }
}
