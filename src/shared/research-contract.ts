/**
 * R43 Phase G (R-701/R-702): research proposal / research contract (pure).
 *
 * The Research Proposal (RP) is a formal intermediate product; a Research
 * Contract derives from it and is the ONLY anchor for paper expansion — a
 * section writer may not regenerate the research goal freely. The sufficiency
 * gate audits the run's durable decisions/evidence against the contract before
 * a final paper may be declared: claims need evidence, experiments must be
 * executed, citations must be traceable, reviews must be done, criticism must
 * be closed or explicitly retained.
 */

export interface ResearchContract {
  researchQuestion: string;
  hypotheses: string[];
  claims: Array<{ id: string; statement: string; evidenceRequirement: string }>;
  experimentPlan: { runsPerHypothesis: number; metric: string; baseline: string };
  evaluationCriterion: string;
  citationPolicy: "strict-verbatim" | "strict-summary" | "manual";
  sections: string[];
  acceptanceGates: string[];
  frozenAt: string;
}

export interface SectionSpec {
  section: string;
  /** Writer prompt derived strictly from the contract (never a free rewrite). */
  prompt: string;
  requiredClaimIds: string[];
}

export function expandSectionPromptsFromContract(contract: ResearchContract): SectionSpec[] {
  return contract.sections.map((section) => {
    const relevantClaims = contract.claims.filter((claim) => claim.statement.toLowerCase().includes(section.toLowerCase()) || section.toLowerCase().includes("method"));
    return {
      section,
      prompt: `Write the "${section}" section for the frozen research contract below. Anchor every statement in the given hypotheses/claims/metrics; you may NOT change the research question, hypotheses, metric, baseline or evaluation criterion. Research question: ${contract.researchQuestion}. Hypotheses: ${contract.hypotheses.join("; ")}. Primary metric: ${contract.experimentPlan.metric}; baseline: ${contract.experimentPlan.baseline}; decision rule: ${contract.evaluationCriterion}. Citation policy: ${contract.citationPolicy}.`,
      requiredClaimIds: relevantClaims.map((claim) => claim.id)
    };
  });
}

/** A prompt that would rewrite the goal is rejected (section expansion is contract-bound). */
export function violatesContract(sectionSpec: SectionSpec, proposedText: string, contract: ResearchContract): string | undefined {
  if (proposedText.length < 1) return "empty section";
  const rewritesGoal = /new research question|i propose studying|let us investigate whether the following new|change the hypothesis/i.test(proposedText);
  if (rewritesGoal) return "section must not rewrite the frozen research goal";
  return undefined;
}

export interface SufficiencyEvidence {
  /** Evidence refs recorded in the durable run ledger (per-stage). */
  evidenceRefs: string[];
  executedExperiments: number;
  reviewsCompleted: number;
  citationsTraceable: number;
  openCriticism: string[];
}

export interface SufficiencyAudit {
  sufficient: boolean;
  missing: string[];
  notes: string[];
}

export function sufficiencyAudit(contract: ResearchContract, evidence: SufficiencyEvidence): SufficiencyAudit {
  const missing: string[] = [];
  const notes: string[] = [];
  for (const claim of contract.claims) {
    if (!evidence.evidenceRefs.some((ref) => ref.includes(claim.id) || ref.includes(claim.evidenceRequirement.slice(0, 24)))) {
      missing.push(`claim ${claim.id} has no supporting evidence`);
    }
  }
  if (evidence.executedExperiments < contract.experimentPlan.runsPerHypothesis * Math.max(1, contract.hypotheses.length)) {
    missing.push(`experiments executed (${evidence.executedExperiments}) < required (${contract.experimentPlan.runsPerHypothesis * contract.hypotheses.length})`);
  }
  if (evidence.citationsTraceable < 1 && contract.citationPolicy !== "manual") missing.push("no traceable citations");
  if (evidence.reviewsCompleted < 1) missing.push("no review completed");
  if (evidence.openCriticism.length) notes.push(`unresolved criticism retained explicitly: ${evidence.openCriticism.join("; ")}`);
  return { sufficient: missing.length === 0, missing, notes };
}
