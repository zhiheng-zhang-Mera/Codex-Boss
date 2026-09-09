import { readJson, writeJson } from "../commander/durable-json";
import type { ExperienceContribution, ExperienceEntry, ExperienceLevel, ExperienceObservation } from "../../src/shared/experience";
import { decidePromotion } from "../../src/shared/experience";

/**
 * Experience store (plan §16 / §14). Records observations per claim and
 * promotes a claim up the task → workspace → domain → global hierarchy only
 * when the promotion rules are met. Task-local insights never leak to global
 * on a single observation.
 */
export interface ExperienceFile {
  schemaVersion: 1;
  entries: ExperienceEntry[];
}

export class ExperienceStore {
  constructor(private readonly file: string) {}

  observe(claim: string, domain: string, observation: Omit<ExperienceObservation, "level" | "at"> & { level?: ExperienceLevel; contribution?: ExperienceContribution }, now = Date.now): { entry: ExperienceEntry; promotion: ExperienceLevel | null } {
    const file = this.read();
    let entry = file.entries.find((item) => item.id === claim);
    if (!entry) {
      entry = { id: claim, claim, domain, level: "task", observations: [], createdAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
      file.entries.push(entry);
    }
    entry.observations = [...entry.observations, { level: observation.level ?? "task", source: observation.source, at: new Date(now()).toISOString(), ...(observation.contribution ? { contribution: observation.contribution } : {}) }].slice(-200);
    const decision = decidePromotion(entry);
    let promotion: ExperienceLevel | null = null;
    if (decision.nextLevel) {
      entry.level = decision.nextLevel;
      entry.promotedFrom = entry.promotedFrom ?? "task";
      promotion = decision.nextLevel;
    }
    entry.updatedAt = new Date(now()).toISOString();
    writeJson(this.file, file);
    return { entry: structuredClone(entry), promotion };
  }

  list(): ExperienceEntry[] { return this.read().entries; }

  private read(): ExperienceFile {
    const value = readJson<Partial<ExperienceFile>>(this.file);
    if (!value) return { schemaVersion: 1, entries: [] };
    if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) throw new Error("Invalid experience store");
    return { schemaVersion: 1, entries: value.entries };
  }
}
