import { createHash } from "node:crypto";
import { readJson, writeJson } from "../commander/durable-json";

/**
 * Content-addressed cache (plan §13.4/§13.5). Keys are hash+version+policy so a
 * value only hits when its inputs are identical; an explicit invalidation graph
 * lets one observed change (e.g. a repo edit) drop every dependent entry.
 */

export interface CachePolicy {
  kind: string;         // e.g. "repo-index", "context-capsule"
  version: number;      // schema/algorithm version
  maxAgeMs?: number;    // optional TTL
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
}

interface CacheFile<T> { schemaVersion: 1; entries: CacheEntry<T>[]; }

export class ContentCache<T = unknown> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  /** dependencyScope -> set of keys that depend on it */
  private readonly dependencies = new Map<string, Set<string>>();

  constructor(private readonly file?: string) {
    if (!file) return;
    const value = readJson<Partial<CacheFile<T>>>(file);
    if (!value) return;
    if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error("Invalid cache file");
    for (const entry of value.entries) this.entries.set(entry.key, entry);
  }

  key(scope: string, policy: CachePolicy, input: unknown): string {
    return createHash("sha256").update([scope, policy.kind, policy.version, JSON.stringify(input)].join("|"), "utf8").digest("hex");
  }

  get(cacheKey: string): T | undefined {
    const entry = this.entries.get(cacheKey);
    if (!entry) return undefined;
    return structuredClone(entry.value);
  }

  put(cacheKey: string, value: T, policy: CachePolicy, dependencyScopes: string[] = [], now = Date.now): void {
    this.entries.set(cacheKey, { key: cacheKey, value, createdAt: now() });
    for (const scope of dependencyScopes) {
      let set = this.dependencies.get(scope);
      if (!set) { set = new Set(); this.dependencies.set(scope, set); }
      set.add(cacheKey);
    }
    this.persist();
  }

  /** Invalidate everything that declared a dependency on the given scope. */
  invalidate(dependencyScope: string): void {
    const affected = this.dependencies.get(dependencyScope) ?? new Set<string>();
    for (const key of affected) this.entries.delete(key);
    this.dependencies.delete(dependencyScope);
    this.persist();
  }

  clear(): void { this.entries.clear(); this.dependencies.clear(); this.persist(); }

  size(): number { return this.entries.size; }

  private persist(): void {
    if (!this.file) return;
    const payload: CacheFile<T> = { schemaVersion: 1, entries: [...this.entries.values()] };
    writeJson(this.file, payload);
  }
}
