import path from "node:path";
import { readJson, writeJson } from "../commander/durable-json";
import { retrieveWithinBudget, type KnowledgeEntry, type KnowledgeQuery } from "../../src/shared/knowledge";
import { decideIngestion, placementFor, resolveConflictGroup, type ConflictResolution, type IngestionVerdict, type StorageTier } from "../../src/shared/knowledge-governance";

/**
 * Hybrid storage + knowledge governance (plan AP20). Local-first tiered
 * catalog: LocalHot / LocalWarm / EncryptedCold files under one directory.
 * `put` runs §20 auto-ingestion (reject/supersede/dedupe), then places the
 * entry into the matching tier; `resolveConflict(groupId)` records the winner
 * (losers archived to the cold tier). Reads merge hot + warm (cold stays
 * archive-only). All writes atomic; corrupt tier files fail closed.
 */

export interface GovernanceFile {
  schemaVersion: 1;
  entries: KnowledgeEntry[];
}

const FILES: Record<StorageTier, string> = { LocalHot: "hot.json", LocalWarm: "warm.json", EncryptedCold: "cold.json" };

export class KnowledgeGovernanceStore {
  private readonly tiers: Map<StorageTier, KnowledgeEntry[]>;
  private readonly fileFor: (tier: StorageTier) => string;

  constructor(private readonly directory: string, private readonly sensitive: (entry: KnowledgeEntry) => boolean = () => false) {
    this.fileFor = (tier) => path.join(directory, FILES[tier]);
    this.tiers = new Map();
    for (const tier of Object.keys(FILES) as StorageTier[]) {
      const value = readJson<Partial<GovernanceFile>>(this.fileFor(tier));
      if (value && (value.schemaVersion !== 1 || !Array.isArray(value.entries))) throw new Error(`Invalid knowledge tier ${tier}`);
      this.tiers.set(tier, value?.entries ? [...value.entries] : []);
    }
  }

  /** Auto-ingestion + placement for a candidate entry. Returns the verdict. */
  ingest(candidate: KnowledgeEntry): IngestionVerdict {
    const existing = this.allActive();
    const verdict = decideIngestion(candidate, existing);
    if (verdict.decision === "ADD" || verdict.decision === "SUPERSEDE") {
      if (verdict.supersedes) this.removeById(verdict.supersedes);
      this.putActive(candidate);
    }
    return verdict;
  }

  put(entry: KnowledgeEntry): void {
    this.putActive(entry);
  }

  retrieve(query: KnowledgeQuery): KnowledgeEntry[] {
    return retrieveWithinBudget(this.allActive().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), query);
  }

  list(tier?: StorageTier): KnowledgeEntry[] {
    if (tier) return [...this.tiers.get(tier)!];
    return this.allActive();
  }

  /** Resolves a conflict group; the winner stays active, losers move to cold. */
  resolveConflict(groupId: string): ConflictResolution {
    const members = this.allActive().filter((entry) => entry.conflictGroup === groupId);
    const resolution = resolveConflictGroup(groupId, members);
    if (resolution.winnerId) {
      for (const loser of resolution.loserIds) {
        const entry = members.find((item) => item.id === loser);
        if (entry) { this.removeActive(entry.id); this.tiers.get("EncryptedCold")!.push(entry); }
      }
      this.persistTier("EncryptedCold");
    }
    return resolution;
  }

  private allActive(): KnowledgeEntry[] {
    return [...this.tiers.get("LocalHot")!, ...this.tiers.get("LocalWarm")!];
  }

  private putActive(entry: KnowledgeEntry): void {
    const tier = placementFor(entry, { sensitive: this.sensitive(entry) });
    for (const current of Object.keys(FILES) as StorageTier[]) {
      this.tiers.set(current, this.tiers.get(current)!.filter((item) => item.id !== entry.id));
    }
    const target = this.tiers.get(tier)!;
    target.push(entry);
    // Encrypted-cold is an archive tier: persisted, but not in the active
    // retrieval merge (hot + warm only).
    if (tier === "LocalWarm" || tier === "LocalHot") { this.persistTier("LocalHot"); this.persistTier("LocalWarm"); }
    else this.persistTier("EncryptedCold");
  }

  private removeById(id: string): void {
    this.removeActive(id);
    const cold = this.tiers.get("EncryptedCold")!.filter((item) => item.id !== id);
    this.tiers.set("EncryptedCold", cold);
    this.persistTier("EncryptedCold");
  }

  private removeActive(id: string): void {
    this.tiers.set("LocalHot", this.tiers.get("LocalHot")!.filter((item) => item.id !== id));
    this.tiers.set("LocalWarm", this.tiers.get("LocalWarm")!.filter((item) => item.id !== id));
  }

  private persistTier(tier: StorageTier): void {
    const entries = this.tiers.get(tier)!;
    writeJson(this.fileFor(tier), { schemaVersion: 1, entries });
  }
}
