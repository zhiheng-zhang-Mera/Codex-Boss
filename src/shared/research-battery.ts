/**
 * Research generalization battery (Owner-Result.md Rev.2 §33–§34). Pure + shareable.
 *
 * Five research domains must terminate honestly:
 * software-engineering / multi-agent / reliability / writing-evaluation /
 * negative-null-result. Allowed terminal statuses: READY / REJECTED /
 * INCONCLUSIVE / INSUFFICIENT_EVIDENCE / REPLICATION_FAILED.
 *
 * Rule (§33): a correct rejection IS a PASS — declaring the hypothesis unsupported
 * with honest statistics + review, or a null result, or insufficient evidence, all
 * count as correct science. A fake READY (missing manuscript/review/citations) is
 * a FAIL and is downgraded to INSUFFICIENT_EVIDENCE. A READY paper additionally
 * needs the full §34 artifact chain.
 */

export type ResearchDomain =
  | "software-engineering"
  | "multi-agent"
  | "reliability"
  | "writing-evaluation"
  | "negative-null-result";

export const RESEARCH_DOMAINS: readonly ResearchDomain[] = [
  "software-engineering",
  "multi-agent",
  "reliability",
  "writing-evaluation",
  "negative-null-result"
];

export type ResearchTerminalStatus = "READY" | "REJECTED" | "INCONCLUSIVE" | "INSUFFICIENT_EVIDENCE" | "REPLICATION_FAILED";

export interface ResearchEvidence {
  protocol: boolean;
  executionEvidence: boolean;
  replication: "REPRODUCED" | "FAILED" | "NOT_ATTEMPTED";
  statistics: boolean;
  claimGraph: boolean;
  citations: boolean;
  review: "APPROVED" | "VETOED" | "NOT_RUN";
  manuscript: boolean;
  finalAudit: boolean;
}

export interface ResearchOutcomeInput {
  domain: ResearchDomain;
  declaredStatus: ResearchTerminalStatus;
  /** Whether the recorded statistics support the original hypothesis. */
  hypothesisSupported: boolean | null;
  evidence: ResearchEvidence;
}

export interface ResearchBatteryVerdict {
  domain: ResearchDomain;
  declaredStatus: ResearchTerminalStatus;
  /** The status the evidence actually supports (authoritative). */
  status: ResearchTerminalStatus;
  /** True = the terminal status honestly reflects the evidence (§33 correct rejection = PASS). */
  pass: boolean;
  reason: string;
  missing: string[];
}

const READY_GATES: Array<keyof ResearchEvidence> = ["protocol", "executionEvidence", "statistics", "claimGraph", "citations", "manuscript", "finalAudit"];

export function adjudicateResearchOutcome(input: ResearchOutcomeInput): ResearchBatteryVerdict {
  const { domain, declaredStatus, hypothesisSupported, evidence } = input;
  const missing: string[] = [];

  // Evidence chain accounting.
  if (!evidence.protocol) missing.push("protocol");
  if (!evidence.executionEvidence) missing.push("execution-evidence");
  if (!evidence.statistics) missing.push("statistics");
  if (!evidence.claimGraph) missing.push("claim-graph");
  if (!evidence.citations) missing.push("citation");
  if (!evidence.manuscript) missing.push("manuscript");
  if (!evidence.finalAudit) missing.push("final-audit");
  const reviewOk = evidence.review !== "VETOED";
  if (evidence.review === "NOT_RUN") missing.push("review");
  if (evidence.review === "VETOED") missing.push("review-pass");
  const replicationRecorded = evidence.replication !== "NOT_ATTEMPTED";

  // 1) Fake READY is always caught: a READY claim needs every §34 gate.
  if (declaredStatus === "READY") {
    if (missing.length === 0 && reviewOk) {
      return { domain, declaredStatus, status: "READY", pass: true, reason: "full §34 artifact chain + review approved", missing };
    }
    return {
      domain,
      declaredStatus,
      status: missing.some((item) => item.includes("replication")) ? "REPLICATION_FAILED" : "INSUFFICIENT_EVIDENCE",
      pass: false,
      reason: `fake READY caught — missing: ${missing.join(", ")}`,
      missing
    };
  }

  // 2) Honest terminal states:
  //    - null/negative result with review pass + replication = PASS (REJECTED)
  //    - hypothesis-supported experiment that failed replication → REPLICATION_FAILED is PASS when recorded.
  if (declaredStatus === "REJECTED") {
    const honest = hypothesisSupported === false || domain === "negative-null-result";
    const complete = missing.length === 0 && reviewOk && replicationRecorded;
    return {
      domain,
      declaredStatus,
      status: "REJECTED",
      pass: honest && complete,
      reason: complete ? (honest ? "correct rejection with full evidence — PASS" : "rejection recorded but hypothesis evidence says supported — verify") : `insufficient evidence for a rejection — missing: ${missing.join(", ")}`,
      missing
    };
  }
  if (declaredStatus === "REPLICATION_FAILED") {
    const complete = missing.length === 0 && evidence.replication === "FAILED" && replicationRecorded;
    return {
      domain,
      declaredStatus,
      status: "REPLICATION_FAILED",
      pass: complete,
      reason: complete ? "replication failed and honestly recorded — PASS (no fake READY)" : `replication-failure claim incomplete — missing: ${missing.join(", ")}`,
      missing
    };
  }
  if (declaredStatus === "INCONCLUSIVE") {
    const complete = evidence.executionEvidence && evidence.statistics;
    return {
      domain,
      declaredStatus,
      status: "INCONCLUSIVE",
      pass: complete,
      reason: complete ? "inconclusive result honestly reported — PASS" : "inconclusive claim without statistics/execution evidence",
      missing
    };
  }
  if (declaredStatus === "INSUFFICIENT_EVIDENCE") {
    const complete = evidence.protocol && evidence.executionEvidence;
    return {
      domain,
      declaredStatus,
      status: "INSUFFICIENT_EVIDENCE",
      pass: complete,
      reason: complete ? "insufficient-evidence call honestly recorded — PASS" : "insufficient-evidence claim without a protocol/execution trail",
      missing
    };
  }
  // Unknown declared status.
  return { domain, declaredStatus, status: "INSUFFICIENT_EVIDENCE", pass: false, reason: `unknown declared status ${declaredStatus}`, missing };
}

export interface BatteryScenario {
  input: ResearchOutcomeInput;
  expectPass: boolean;
  label: string;
}

/** §33 five-domain battery: one scenario per domain incl. honest negative/null result. */
export function buildResearchBattery(): BatteryScenario[] {
  const full = (over: Partial<ResearchEvidence> = {}): ResearchEvidence => ({
    protocol: true,
    executionEvidence: true,
    replication: "REPRODUCED",
    statistics: true,
    claimGraph: true,
    citations: true,
    review: "APPROVED",
    manuscript: true,
    finalAudit: true,
    ...over
  });
  return [
    { label: "SE READY", input: { domain: "software-engineering", declaredStatus: "READY", hypothesisSupported: true, evidence: full() }, expectPass: true },
    { label: "SE fake READY", input: { domain: "software-engineering", declaredStatus: "READY", hypothesisSupported: true, evidence: full({ manuscript: false, finalAudit: false }) }, expectPass: false },
    { label: "Multi-Agent null result (correct rejection)", input: { domain: "multi-agent", declaredStatus: "REJECTED", hypothesisSupported: false, evidence: full() }, expectPass: true },
    { label: "Reliability replication failed (honest)", input: { domain: "reliability", declaredStatus: "REPLICATION_FAILED", hypothesisSupported: null, evidence: full({ replication: "FAILED" }) }, expectPass: true },
    { label: "Writing-evaluation inconclusive (honest)", input: { domain: "writing-evaluation", declaredStatus: "INCONCLUSIVE", hypothesisSupported: null, evidence: full({ claimGraph: false, manuscript: false, finalAudit: false, citations: false }) }, expectPass: true },
    { label: "Negative/Null insufficient evidence (honest)", input: { domain: "negative-null-result", declaredStatus: "INSUFFICIENT_EVIDENCE", hypothesisSupported: null, evidence: full({ statistics: false, replication: "NOT_ATTEMPTED", manuscript: false }) }, expectPass: true }
  ];
}

export function runResearchBattery(): { scenarios: Array<ResearchBatteryVerdict & { label: string; expected: boolean }>; passed: number; total: number } {
  const scenarios = buildResearchBattery().map((scenario) => {
    const verdict = adjudicateResearchOutcome(scenario.input);
    return { ...verdict, label: scenario.label, expected: scenario.expectPass };
  });
  return { scenarios, passed: scenarios.filter((item) => item.pass === item.expected).length, total: scenarios.length };
}
