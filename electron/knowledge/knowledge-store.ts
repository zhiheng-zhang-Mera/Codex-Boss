import { readJson, writeJson } from "../commander/durable-json";
import type { KnowledgeEntry, KnowledgeQuery } from "../../src/shared/knowledge";
import { retrieveWithinBudget, taxonomyOf } from "../../src/shared/knowledge";

/**
 * Local knowledge backend (plan AP10). A catalog of KnowledgeEntry records
 * organized by workspace shelf + domain taxonomy, with deterministic retrieval
 * under a character budget. Trust/freshness/conflict fields are reserved now so
 * v3 governance never needs a knowledge schema migration.
 */
export interface KnowledgeFile {
  schemaVersion: 1;
  entries: KnowledgeEntry[];
}

export class KnowledgeStore {
  constructor(private readonly file: string) {}

  put(entry: KnowledgeEntry): void {
    const file = this.read();
    // A superseding entry replaces the one it supersedes (single resolution).
    let entries = file.entries.filter((item) => item.id !== entry.id && item.id !== entry.supersedes);
    entries = [...entries, entry];
    writeJson(this.file, { schemaVersion: 1, entries });
  }

  list(shelf?: string): KnowledgeEntry[] {
    const entries = this.read().entries;
    return shelf ? entries.filter((entry) => entry.shelf === shelf) : entries;
  }

  taxonomy(shelf?: string) { return taxonomyOf(this.list(shelf)); }

  retrieve(query: KnowledgeQuery): KnowledgeEntry[] {
    return retrieveWithinBudget(this.list(), query);
  }

  private read(): KnowledgeFile {
    const value = readJson<Partial<KnowledgeFile>>(this.file);
    if (!value) return { schemaVersion: 1, entries: [] };
    if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error("Invalid knowledge store");
    return { schemaVersion: 1, entries: value.entries };
  }
}
