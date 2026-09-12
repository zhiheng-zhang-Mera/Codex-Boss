/**
 * Update-Plan/checkpoint-1.md §42–§45 + §51/§52 — final acceptance, the
 * Bootstrap Completion definition, and what may block.
 *
 * §42 lists what must be true before ACCEPTED: every mandatory requirement
 * verified, no HIGH/MEDIUM findings, no unresolved secret issue, no unresolved
 * destructive action, the knowledge write complete, the version impact complete, CI
 * green and the candidate matching the Owner's goal — plus four theme items when UI
 * is involved. §43 defines BOOTSTRAP_COMPLETE as reachable only when every critical
 * capability is available. §44 allows exactly four Hard Blocker classes, and §45
 * names the situations that must **not** be escalated to the Owner.
 *
 * The rules that make this honest: an item with no evidence is NOT_VERIFIED and
 * therefore rejects acceptance (silence is not a pass), the benchmark and battery
 * catalogues point at the gates that actually exist rather than at intentions, and
 * §45 is enforced as a refusal — a CI failure or an argument about code structure
 * can never become a question to the Owner.
 *
 * Pure: no fs, no network, no clock.
 */
import { contentHashOf } from "./workbook";

export const FINAL_ACCEPTANCE_VERSION = "final-acceptance-1" as const;

/* ------------------------------------------------------------------ *
 * §42 the checklist
 * ------------------------------------------------------------------ */

export const FINAL_ITEMS = [
  "ALL_REQUIREMENTS_VERIFIED",
  "NO_BLOCKING_FINDINGS",
  "NO_UNRESOLVED_SECRET",
  "NO_UNRESOLVED_DESTRUCTIVE_ACTION",
  "KNOWLEDGE_WRITE_COMPLETE",
  "VERSION_IMPACT_COMPLETE",
  "CI_GREEN",
  "CANDIDATE_MATCHES_OWNER_GOAL"
] as const;

export const THEME_FINAL_ITEMS = [
  "THEME_RUNTIME_VERIFIED",
  "VISUAL_SURFACES_USABLE",
  "FALLBACK_VERIFIED",
  "BUILT_INS_INTACT"
] as const;

export type FinalItemId = (typeof FINAL_ITEMS)[number] | (typeof THEME_FINAL_ITEMS)[number];
export type ItemVerdict = "VERIFIED" | "NOT_VERIFIED" | "FAILED";

/** What the host observed for one item. `undefined` means "not looked at". */
export interface FinalEvidence {
  /** §42 coverage: requirements still owed evidence, and any that failed a gate. */
  requirements?: { required: string[]; verified: string[]; outstanding: string[]; failed?: string[] };
  /** §32/§36: open blocking findings. */
  findings?: { blocking: number; detail?: string };
  /** §36/§50: the secret scan over everything the candidate wrote. */
  secrets?: { scanned_files: string[]; hits: { path: string; shapes: string[] }[] };
  /** §36: removals the Owner has not approved. */
  destructive?: { unapproved: string[] };
  /** §5.3: whether the knowledge produced by this work was accepted. */
  knowledge?: { attempted: number; accepted: number; rejected: number; quarantined: number };
  /** §37: the version impact assessment, decided by the host. */
  version?: { impact: string; decided_by: string; hash?: string; missing?: string[] };
  /** §41: the CI conclusion. */
  ci?: { conclusion?: string; readable: boolean };
  /** §35/§42: whether the candidate serves the Owner's goal. */
  goal?: { goal: string; served_by_requirements: string[] };
  /** §42's UI additions, when the change involves the interface. */
  theme?: {
    runtime_verified: boolean;
    surfaces_usable: boolean;
    fallback_verified: boolean;
    built_ins_intact: boolean;
  };
  /** True when the change involves UI at all, so the theme items are required. */
  touches_ui?: boolean;
}

export interface FinalItemResult {
  item: FinalItemId;
  verdict: ItemVerdict;
  /** What the verdict rests on. */
  inspected: string[];
  reasons: string[];
}

export interface FinalAcceptance {
  schemaVersion: 1;
  version: typeof FINAL_ACCEPTANCE_VERSION;
  decision: "ACCEPTED" | "REJECTED";
  items: FinalItemResult[];
  required_items: FinalItemId[];
  failed: FinalItemId[];
  not_verified: FinalItemId[];
  reasons: string[];
  hash: string;
}

function item(id: FinalItemId, verdict: ItemVerdict, inspected: string[], reasons: string[]): FinalItemResult {
  return { item: id, verdict, inspected, reasons };
}

/** §42: the items this change must satisfy (the four theme ones only for UI work). */
export function requiredFinalItems(evidence: FinalEvidence): FinalItemId[] {
  return evidence.touches_ui ? [...FINAL_ITEMS, ...THEME_FINAL_ITEMS] : [...FINAL_ITEMS];
}

/**
 * §42 evaluated. Any FAILED or NOT_VERIFIED item rejects acceptance, and the
 * reasons name the artifact each verdict rests on.
 */
export function evaluateFinalAcceptance(evidence: FinalEvidence): FinalAcceptance {
  const items: FinalItemResult[] = [];

  if (!evidence.requirements) items.push(item("ALL_REQUIREMENTS_VERIFIED", "NOT_VERIFIED", [], ["no requirement binding was supplied"]));
  else {
    const outstanding = evidence.requirements.outstanding;
    const verified = evidence.requirements.verified;
    const failedRequirements = evidence.requirements.failed ?? [];
    const missing = evidence.requirements.required.filter((requirement) => !verified.includes(requirement));
    const problems = [
      ...outstanding.map((requirement) => `${requirement} is still owed evidence`),
      ...failedRequirements.map((requirement) => `${requirement} has a failing gate in the §31.3 ledger`),
      ...missing.map((requirement) => `${requirement} is not verified`)
    ];
    items.push(item("ALL_REQUIREMENTS_VERIFIED", problems.length ? "FAILED" : "VERIFIED", [`required:${evidence.requirements.required.length}`, `verified:${verified.length}`], problems.length ? problems : ["every mandatory requirement is verified"]));
  }

  if (!evidence.findings) items.push(item("NO_BLOCKING_FINDINGS", "NOT_VERIFIED", [], ["no review report was supplied"]));
  else items.push(item("NO_BLOCKING_FINDINGS", evidence.findings.blocking > 0 ? "FAILED" : "VERIFIED", [`blocking:${evidence.findings.blocking}`], evidence.findings.blocking > 0 ? [`${evidence.findings.blocking} HIGH/MEDIUM finding(s) are open: ${evidence.findings.detail ?? ""}`] : ["no HIGH/MEDIUM finding is open"]));

  if (!evidence.secrets) items.push(item("NO_UNRESOLVED_SECRET", "NOT_VERIFIED", [], ["nothing was scanned for credentials"]));
  else items.push(item("NO_UNRESOLVED_SECRET", evidence.secrets.hits.length ? "FAILED" : "VERIFIED", [`scanned:${evidence.secrets.scanned_files.length}`], evidence.secrets.hits.length ? evidence.secrets.hits.map((hit) => `${hit.path}: ${hit.shapes.join(", ")}`) : ["no credential shape was found"]));

  if (!evidence.destructive) items.push(item("NO_UNRESOLVED_DESTRUCTIVE_ACTION", "NOT_VERIFIED", [], ["no destructive-change report was supplied"]));
  else items.push(item("NO_UNRESOLVED_DESTRUCTIVE_ACTION", evidence.destructive.unapproved.length ? "FAILED" : "VERIFIED", [`unapproved:${evidence.destructive.unapproved.length}`], evidence.destructive.unapproved.length ? evidence.destructive.unapproved.map((entry) => `${entry} was removed without the Owner's approval`) : ["every removal is Owner-approved"]));

  if (!evidence.knowledge) items.push(item("KNOWLEDGE_WRITE_COMPLETE", "NOT_VERIFIED", [], ["no knowledge write was supplied"]));
  else {
    const problems = [
      ...(evidence.knowledge.rejected > 0 ? [`${evidence.knowledge.rejected} knowledge candidate(s) were rejected`] : []),
      ...(evidence.knowledge.quarantined > 0 ? [`${evidence.knowledge.quarantined} knowledge candidate(s) are quarantined`] : []),
      ...(evidence.knowledge.attempted > 0 && evidence.knowledge.accepted === 0 ? ["nothing was accepted, so the work taught the system nothing"] : [])
    ];
    items.push(item("KNOWLEDGE_WRITE_COMPLETE", problems.length ? "FAILED" : "VERIFIED", [`attempted:${evidence.knowledge.attempted}`, `accepted:${evidence.knowledge.accepted}`], problems.length ? problems : ["the knowledge this work produced was accepted"]));
  }

  if (!evidence.version) items.push(item("VERSION_IMPACT_COMPLETE", "NOT_VERIFIED", [], ["no version impact assessment was supplied"]));
  else {
    const problems = [
      ...(evidence.version.decided_by !== "HOST" ? ["the version impact was not decided by the host (§37)"] : []),
      ...((evidence.version.missing ?? []).length ? [`the assessment could not look at ${(evidence.version.missing ?? []).join(", ")}`] : [])
    ];
    items.push(item("VERSION_IMPACT_COMPLETE", problems.length ? "FAILED" : "VERIFIED", [`impact:${evidence.version.impact}`, `decided_by:${evidence.version.decided_by}`], problems.length ? problems : [`the host assessed the impact as ${evidence.version.impact}`]));
  }

  if (!evidence.ci) items.push(item("CI_GREEN", "NOT_VERIFIED", [], ["no CI result was supplied"]));
  else if (!evidence.ci.readable) items.push(item("CI_GREEN", "FAILED", [], ["CI could not be read, which is not a pass (§41)"]));
  else items.push(item("CI_GREEN", evidence.ci.conclusion === "success" ? "VERIFIED" : "FAILED", [`conclusion:${evidence.ci.conclusion ?? "unknown"}`], evidence.ci.conclusion === "success" ? ["CI concluded success"] : [`CI concluded ${evidence.ci.conclusion ?? "unknown"}`]));

  if (!evidence.goal) items.push(item("CANDIDATE_MATCHES_OWNER_GOAL", "NOT_VERIFIED", [], ["the Owner's goal was not supplied"]));
  else {
    const served = evidence.goal.served_by_requirements;
    items.push(item("CANDIDATE_MATCHES_OWNER_GOAL", served.length && evidence.goal.goal.trim() ? "VERIFIED" : "FAILED", [`goal:${evidence.goal.goal.slice(0, 60)}`, `serving:${served.length}`], served.length ? ["requirements trace to the Owner's goal"] : ["nothing the candidate did traces to the goal"]));
  }

  if (evidence.touches_ui) {
    const theme = evidence.theme;
    const themeItem = (id: FinalItemId, ok: boolean | undefined, reason: string): void => {
      if (ok === undefined) items.push(item(id, "NOT_VERIFIED", [], [reason]));
      else items.push(item(id, ok ? "VERIFIED" : "FAILED", [id], [ok ? `§42: ${reason}` : `§42: ${reason} — not satisfied`]));
    };
    themeItem("THEME_RUNTIME_VERIFIED", theme?.runtime_verified, "the theme was verified in the running application");
    themeItem("VISUAL_SURFACES_USABLE", theme?.surfaces_usable, "the visual surfaces are usable");
    themeItem("FALLBACK_VERIFIED", theme?.fallback_verified, "the fallback to a built-in theme was verified");
    themeItem("BUILT_INS_INTACT", theme?.built_ins_intact, "the built-in themes are intact");
  }

  const required = requiredFinalItems(evidence);
  const forRequired = required.map((id) => items.find((entry) => entry.item === id) ?? item(id, "NOT_VERIFIED", [], [`${id} was never evaluated`]));
  const failed = forRequired.filter((entry) => entry.verdict === "FAILED").map((entry) => entry.item);
  const notVerified = forRequired.filter((entry) => entry.verdict === "NOT_VERIFIED").map((entry) => entry.item);
  const accepted = failed.length === 0 && notVerified.length === 0;
  const assessment: Omit<FinalAcceptance, "hash"> = {
    schemaVersion: 1,
    version: FINAL_ACCEPTANCE_VERSION,
    decision: accepted ? "ACCEPTED" : "REJECTED",
    items: forRequired,
    required_items: required,
    failed,
    not_verified: notVerified,
    reasons: accepted
      ? [`§42: every one of the ${required.length} final items is verified`]
      : [`§42: ${failed.length} item(s) failed and ${notVerified.length} could not be evaluated`, ...forRequired.filter((entry) => entry.verdict !== "VERIFIED").flatMap((entry) => entry.reasons).slice(0, 6)]
  };
  return { ...assessment, hash: contentHashOf(JSON.stringify(assessment)) };
}

/* ------------------------------------------------------------------ *
 * §43 BOOTSTRAP_COMPLETE
 * ------------------------------------------------------------------ */

export const CRITICAL_CAPABILITIES = [
  "knowledge foundation",
  "architecture and UI discovery",
  "theme engine",
  "requirements graph",
  "execution planner",
  "verification engine",
  "review layers",
  "self-healing",
  "capability gap loop",
  "candidate and Guardian gate",
  "version impact and Git checkpoint",
  "GitHub publishing",
  "CI repair loop"
] as const;

export interface BootstrapCompletionVerdict {
  complete: boolean;
  missing: string[];
  reason: string;
}

/** §43: BOOTSTRAP_COMPLETE only when every critical capability is available. */
export function bootstrapCompletion(available: readonly string[]): BootstrapCompletionVerdict {
  const have = available.map((entry) => entry.trim().toLocaleLowerCase());
  const missing = CRITICAL_CAPABILITIES.filter((capability) => !have.includes(capability.toLocaleLowerCase()));
  return {
    complete: missing.length === 0,
    missing: [...missing],
    reason: missing.length
      ? `§43: BOOTSTRAP_COMPLETE is not reachable; ${missing.length} capability(ies) are unavailable: ${missing.join(", ")}`
      : `§43: every one of the ${CRITICAL_CAPABILITIES.length} critical capabilities is available`
  };
}

/* ------------------------------------------------------------------ *
 * §44/§45 what may and may not block
 * ------------------------------------------------------------------ */

/** §44's four classes, and only these. */
export const HARD_BLOCKER_CLASSES = [
  "HB1_AUTHORITY",
  "HB2_IRREVERSIBLE_OWNER_DECISION",
  "HB3_MISSING_EXTERNAL_RESOURCE",
  "HB4_ROOT_POLICY"
] as const;
export type HardBlockerClass = (typeof HARD_BLOCKER_CLASSES)[number];

/** §45: these must never be escalated to the Owner. */
export const AUTONOMOUS_SITUATIONS = [
  "library choice", "code organisation", "how to write a test", "how to fix an error",
  "provider failure", "ci failure", "file naming", "branch naming",
  "conflicting reviewer opinions", "where theme files live", "theme token mapping",
  "theme registration", "theme preview implementation"
] as const;

export interface BlockerRequest {
  situation: string;
  /** Which §44 class the caller believes applies. */
  claimed?: HardBlockerClass;
  /** Evidence for the claim: an authority need, an irreversible decision, a missing resource, a policy. */
  authority_needed?: boolean;
  irreversible?: boolean;
  missing_resource?: boolean;
  policy_denied?: boolean;
}

export interface BlockerVerdict {
  allowed: boolean;
  blocker_class?: HardBlockerClass;
  reason: string;
}

/**
 * §44/§45: is asking the Owner legitimate?
 *
 * A situation §45 lists is refused even when the caller dresses it as a blocker,
 * and a §44 class is only granted when its own evidence is present — "it felt like
 * a policy" is not a Root Policy denial.
 */
export function assessBlocker(request: BlockerRequest): BlockerVerdict {
  const situation = request.situation.trim().toLocaleLowerCase();
  const forbidden = AUTONOMOUS_SITUATIONS.find((entry) => situation.includes(entry));
  if (forbidden) {
    return { allowed: false, reason: `§45: "${request.situation}" is Boss's own decision (${forbidden}); asking the Owner is not an acceptable Hard Blocker` };
  }
  if (request.policy_denied) return { allowed: true, blocker_class: "HB4_ROOT_POLICY", reason: "§44 HB4: the Guardian/policy denied the action" };
  if (request.authority_needed) return { allowed: true, blocker_class: "HB1_AUTHORITY", reason: "§44 HB1: the step needs authority only the Owner has (MFA, consent, legal approval)" };
  if (request.irreversible && request.claimed === "HB2_IRREVERSIBLE_OWNER_DECISION") {
    return { allowed: true, blocker_class: "HB2_IRREVERSIBLE_OWNER_DECISION", reason: "§44 HB2: the decision is irreversible and the Owner has expressed no preference" };
  }
  if (request.missing_resource) return { allowed: true, blocker_class: "HB3_MISSING_EXTERNAL_RESOURCE", reason: "§44 HB3: the goal depends on a resource that does not exist" };
  return { allowed: false, reason: `§44: none of the four Hard Blocker classes applies to "${request.situation}", so Boss must decide it itself` };
}

/* ------------------------------------------------------------------ *
 * §51 benchmark catalogue and §52 seeded battery
 * ------------------------------------------------------------------ */

export interface BenchmarkScenario {
  id: string;
  title: string;
  /** The gate or artifact that proves this scenario, in this repository. */
  proof: string;
}

/** §51's eighteen scenarios, each pointed at what actually proves it today. */
export const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = [
  { id: "B01", title: "simple repo edit", proof: "acceptance:verify V-01..V-05 (bounded change unit + real gates)" },
  { id: "B02", title: "multi-file feature", proof: "acceptance:verify V-02/V-05 (atomic multi-file unit) + acceptance:plan" },
  { id: "B03", title: "conflicting spec", proof: "acceptance:requirements R-03 (QUARANTINED conflict)" },
  { id: "B04", title: "failing unit tests", proof: "acceptance:verify V-05 + acceptance:ci-repair CR-02" },
  { id: "B05", title: "failing integration", proof: "acceptance:verify V-05 (integration targets)" },
  { id: "B06", title: "restart during work", proof: "acceptance-restart + acceptance:desktop-workbook phase 2" },
  { id: "B07", title: "provider outage", proof: "benchmark (offline provider paths) + acceptance:self-healing RC-01" },
  { id: "B08", title: "corrupt artifact", proof: "acceptance:knowledge K-02 (damaged store reported, not fatal)" },
  { id: "B09", title: "review catches hidden bug", proof: "acceptance:review C-02/C-05 (findings → repair)" },
  { id: "B10", title: "CI-only failure", proof: "acceptance:ci-repair CR-01/CR-07 (log-only failure)" },
  { id: "B11", title: "knowledge reuse", proof: "acceptance:knowledge K-01/K-02" },
  { id: "B12", title: "capability gap", proof: "acceptance:capability-gap CG-01..CG-10" },
  { id: "B13", title: "Git rollback", proof: "acceptance:version-checkpoint VC-06/VC-07" },
  { id: "B14", title: "partial provider failure", proof: "acceptance:self-healing RC-06 (partial state) + benchmark" },
  { id: "B15", title: "WorkBook revision", proof: "acceptance:workbook (revision plan) + acceptance:theme TH-06" },
  { id: "B16", title: "create custom theme from prompt", proof: "acceptance:theme TH-04" },
  { id: "B17", title: "invalid theme fallback", proof: "acceptance:theme TH-05/TH-08 + acceptance:candidate GD-09" },
  { id: "B18", title: "delete active theme safely", proof: "acceptance:theme TH-09/TH-13 (§22 plan)" }
];

/** §52's thirteen injected failures, each pointed at what detects and repairs it. */
export const SEEDED_FAILURES: readonly BenchmarkScenario[] = [
  { id: "S01", title: "compile bug", proof: "acceptance:verify V-05 + acceptance:ci-repair CR-01" },
  { id: "S02", title: "logic bug", proof: "acceptance:review C-05 (failed gate → correctness finding)" },
  { id: "S03", title: "race", proof: "acceptance:review C-10 (RACE probe requires a reviewer record)" },
  { id: "S04", title: "bad import", proof: "acceptance:self-healing RC-02 (host-verified DEPENDENCY)" },
  { id: "S05", title: "broken test", proof: "acceptance:ci-repair CR-02/CR-03 (TEST class + UNIT gate)" },
  { id: "S06", title: "wrong configuration", proof: "acceptance:verify V-04 (syntax/ladder fail-fast)" },
  { id: "S07", title: "missing file", proof: "acceptance:verify V-03 (claim without a file is refused)" },
  { id: "S08", title: "bad API assumption", proof: "acceptance:verify V-05 (real tsc diagnostic)" },
  { id: "S09", title: "partial persistence", proof: "acceptance-restart + acceptance:self-healing RC-05" },
  { id: "S10", title: "provider failure", proof: "benchmark (offline provider) + acceptance:self-healing RC-01" },
  { id: "S11", title: "broken theme", proof: "acceptance:theme TH-08 + acceptance:candidate GD-09" },
  { id: "S12", title: "theme registry corruption", proof: "acceptance:theme TH-13 + acceptance:candidate GD-09" },
  { id: "S13", title: "invalid visual token", proof: "acceptance:theme T-TOKENS + acceptance:theme TH-14" }
];

export function scenarioById(id: string): BenchmarkScenario | undefined {
  return [...BENCHMARK_SCENARIOS, ...SEEDED_FAILURES].find((scenario) => scenario.id === id);
}
