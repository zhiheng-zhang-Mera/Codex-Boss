import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson, validId } from "../commander/durable-json";
import { sufficiencyAudit, type ResearchContract, type SufficiencyEvidence } from "../../src/shared/research-contract";

/** Durable per-run research contract store (R-701). */
export class ResearchContractStore {
  constructor(private readonly root: string) {}

  save(runId: string, contract: ResearchContract): ResearchContract {
    const dir = path.join(this.root, validId(runId));
    fs.mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, "research-contract.json"), contract);
    return contract;
  }

  load(runId: string): ResearchContract | undefined {
    const value = readJson<Partial<ResearchContract>>(path.join(this.root, validId(runId), "research-contract.json"));
    if (!value || typeof value.researchQuestion !== "string") return undefined;
    return value as ResearchContract;
  }
}

/** Builds SufficiencyEvidence from the durable research ledger decisions. */
export function evidenceFromLedger(decisions: Array<{ stepId: string; evidenceRefs: string[]; decision: string }>): SufficiencyEvidence {
  const evidenceRefs = decisions.flatMap((entry) => entry.evidenceRefs ?? []);
  const executedExperiments = decisions.filter((entry) => entry.stepId === "EXPERIMENT_EXECUTION" && entry.decision === "experiment_execution").length;
  const reviewsCompleted = decisions.filter((entry) => ["CLAIM_REVIEW", "REPRO_AUDIT", "CITATION_AUDIT"].includes(entry.stepId)).length;
  const citationsTraceable = decisions.filter((entry) => entry.stepId === "CITATION_AUDIT" && entry.decision === "citation_audit").length;
  return { evidenceRefs, executedExperiments, reviewsCompleted, citationsTraceable, openCriticism: [] };
}

export function auditRun(contract: ResearchContract | undefined, decisions: Array<{ stepId: string; evidenceRefs: string[]; decision: string }>): { contractPresent: boolean; audit: ReturnType<typeof sufficiencyAudit> } {
  if (!contract) return { contractPresent: false, audit: { sufficient: false, missing: ["research contract not recorded"], notes: [] } };
  return { contractPresent: true, audit: sufficiencyAudit(contract, evidenceFromLedger(decisions)) };
}
