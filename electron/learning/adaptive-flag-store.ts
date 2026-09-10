import fs from "node:fs";
import path from "node:path";
import { writeJson } from "../commander/durable-json";
import {
  ADAPTIVE_FLAG_IDS,
  DEFAULT_ADAPTIVE_FLAGS,
  adaptiveFlagsAllOff,
  enabledAdaptiveFlags,
  resolveAdaptiveFlags,
  type AdaptiveFlagId,
  type AdaptiveFlags
} from "../../src/shared/adaptive-flags";

/**
 * Engine Phase 0: durable adaptive feature-flag store.
 *
 * Loading is fail-open toward the deterministic router: a missing, corrupt or
 * partial file yields "all flags off" rather than enabling anything. Writes are
 * atomic via the shared durable-json writer.
 */

export interface AdaptiveFlagFile {
  schemaVersion: 1;
  flags: Partial<Record<AdaptiveFlagId, boolean>>;
  updatedAt: string;
}

export class AdaptiveFlagStore {
  private flags: AdaptiveFlags = { ...DEFAULT_ADAPTIVE_FLAGS };
  private degradedReason?: string;

  constructor(
    private readonly filePath?: string,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.restore();
  }

  get(): AdaptiveFlags {
    return { ...this.flags };
  }

  isEnabled(id: AdaptiveFlagId): boolean {
    return this.flags[id] === true;
  }

  allOff(): boolean {
    return adaptiveFlagsAllOff(this.flags);
  }

  enabled(): AdaptiveFlagId[] {
    return enabledAdaptiveFlags(this.flags);
  }

  /** Explicit local switch. Only `true` enables; anything else disables. */
  set(id: AdaptiveFlagId, enabled: boolean): AdaptiveFlags {
    if (!ADAPTIVE_FLAG_IDS.includes(id)) return this.get();
    this.flags = { ...this.flags, [id]: enabled === true };
    this.persist();
    return this.get();
  }

  setAll(value: boolean): AdaptiveFlags {
    this.flags = resolveAdaptiveFlags(Object.fromEntries(ADAPTIVE_FLAG_IDS.map((id) => [id, value === true])) as Partial<Record<AdaptiveFlagId, unknown>>);
    this.persist();
    return this.get();
  }

  /** Why the store is running degraded (corrupt/unreadable file), for observability. */
  status(): { flags: AdaptiveFlags; degradedReason?: string; updatedAt: string } {
    return { flags: this.get(), degradedReason: this.degradedReason, updatedAt: this.now() };
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<AdaptiveFlagFile>;
      if (parsed.schemaVersion !== 1 || !parsed.flags || typeof parsed.flags !== "object") throw new Error("Invalid adaptive flag file");
      this.flags = resolveAdaptiveFlags(parsed.flags);
    } catch (error) {
      // Fail-open toward deterministic behaviour: keep everything OFF.
      this.flags = { ...DEFAULT_ADAPTIVE_FLAGS };
      this.degradedReason = `adaptive flags unreadable: ${String(error)}`;
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: AdaptiveFlagFile = { schemaVersion: 1, flags: this.flags, updatedAt: this.now() };
    writeJson(this.filePath, file);
  }
}
