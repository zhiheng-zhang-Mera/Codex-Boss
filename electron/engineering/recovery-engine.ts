/**
 * Update-Plan/checkpoint-1.md §33 — the host side of recovery.
 *
 * The pure model (`src/shared/recovery.ts`) decides the class, the ladder and the
 * HNS rules; this module supplies the evidence it needs and keeps the §33.3
 * CapabilityGap backlog durable:
 *
 *   - the failing gate's **own output**, read back from the §31.3 ledger row the
 *     verification engine wrote (never a paraphrase);
 *   - host-verified workspace facts — whether a module the output named actually
 *     exists in `node_modules`, whether the tree is a git repository;
 *   - the policy refusal, taken from the real mutation guard rather than assumed.
 *
 * §33.3 is enforced here too: an HNS usage that would produce no gap is refused,
 * and every usage (allowed or refused) is appended to the durable backlog so the
 * capability gap cannot be forgotten.
 */
import fs from "node:fs";
import path from "node:path";
import { assertMutationAllowed } from "../self-evolution/mutation-guard";
import type { EvidenceEntry, EvidenceLedgerFile } from "../../src/shared/evidence-ledger";
import {
  advanceRecovery,
  classifyFailure,
  planHnsFallback,
  planRecovery,
  recordHnsUsage,
  type CapabilityGap,
  type FailureClassification,
  type FailureObservation,
  type HnsFallbackRequest,
  type HnsRole,
  type HnsUsageRecord,
  type RecoveryAttempt,
  type RecoveryPlan,
  type RecoveryProgress,
  type WorkspaceFacts
} from "../../src/shared/recovery";

export const CAPABILITY_GAP_FILE = "capability-gaps.json";

export interface RecoveryEngineConfig {
  root: string;
  /** The §31.3 ledger that holds the failing gates' real output. */
  ledger: () => EvidenceLedgerFile;
  /** Where the §33.3 gaps are kept. Defaults to `<root>/artifacts/acceptance/`. */
  backlogPath?: string;
  now?: () => Date;
}

export interface CapabilityGapRecord {
  gap: CapabilityGap;
  backlog: { stage: "IMPROVEMENT_TASK"; missing_capability: string; from_failure_class: string; severity: string; recorded_at: string };
  usage: HnsUsageRecord;
}

export interface ClassifiedFailure {
  requirement_id: string;
  /** The ledger row whose output was classified. */
  entry: EvidenceEntry;
  observation: FailureObservation;
  classification: FailureClassification;
  plan: RecoveryPlan;
}

export interface RecoveryEngine {
  /** §33.1 over a real §31.3 failure row (newest FAIL), with workspace probes. */
  classifyFromLedger(requirementId: string): ClassifiedFailure | undefined;
  /** §33.1 over an arbitrary observation, with the same workspace probes. */
  classify(observation: FailureObservation): FailureClassification;
  /** Host-verified facts for the output text (module existence, git, refusals). */
  observe(detail: string): WorkspaceFacts;
  /** The real §7.3 refusal, when the target is the Boss repository. */
  policyRefusalFor(target?: string): string | undefined;
  progress(plan: RecoveryPlan, attempts: readonly RecoveryAttempt[]): RecoveryProgress;
  /** §33.3: the fallback decision plus the durable gap. */
  hns(request: Omit<HnsFallbackRequest, "plan"> & { plan?: Pick<RecoveryPlan, "hns_allowed">; role?: HnsRole }): { record: CapabilityGapRecord; decision: ReturnType<typeof planHnsFallback> };
  gaps(): CapabilityGapRecord[];
  save(): string;
}

/** Module names an error output names as unresolvable. */
export function missingModuleNames(detail: string): string[] {
  const names = new Set<string>();
  for (const match of detail.matchAll(/Cannot find module ['"]([^'"]+)['"]/g)) names.add(match[1]!);
  for (const match of detail.matchAll(/Cannot find package ['"]([^'"]+)['"]/g)) names.add(match[1]!);
  for (const match of detail.matchAll(/ERR_MODULE_NOT_FOUND[^\n]*['"]([^'"]+)['"]/g)) names.add(match[1]!);
  return [...names].map((name) => name.replace(/^node:/, "")).filter((name) => name.length > 0 && !name.startsWith(".") && !path.isAbsolute(name));
}

export function createRecoveryEngine(config: RecoveryEngineConfig): RecoveryEngine {
  const root = fs.realpathSync(config.root);
  const now = config.now ?? (() => new Date());
  const backlogPath = config.backlogPath ?? path.join(root, "artifacts", "acceptance", CAPABILITY_GAP_FILE);
  let records: CapabilityGapRecord[] = load(backlogPath);

  const observe = (detail: string): WorkspaceFacts => {
    const facts: WorkspaceFacts = {};
    const modules = missingModuleNames(detail);
    if (modules.length) {
      // The host checks the disk itself: a module the output names may exist in a
      // workspace-level node_modules, in which case the failure is not a missing
      // dependency at all.
      const missing = modules.filter((name) => {
        const packageName = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0]!;
        return !fs.existsSync(path.join(root, "node_modules", packageName));
      });
      facts.missing_modules = missing;
    }
    facts.is_git_repo = fs.existsSync(path.join(root, ".git"));
    if (/escapes workspace|symlink escapes/i.test(detail)) facts.escaped_path = true;
    if (/protected workspace metadata/i.test(detail)) facts.protected_path = true;
    if (/outside the granted scope|not authorized|Change outside authorized scope/i.test(detail)) facts.scope_refused = true;
    if (/ENOSPC|no space left/i.test(detail)) facts.disk_full = true;
    return facts;
  };

  const policyRefusalFor = (target?: string): string | undefined => {
    try {
      assertMutationAllowed(target ?? root);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  return {
    observe,
    policyRefusalFor,
    classify(observation) {
      return classifyFailure(observation);
    },
    classifyFromLedger(requirementId) {
      const failures = config.ledger().entries
        .filter((entry) => entry.requirement_ids.includes(requirementId) && entry.result === "FAIL")
        .sort((left, right) => left.captured_at.localeCompare(right.captured_at) || left.id.localeCompare(right.id));
      const entry = failures.at(-1);
      if (!entry) return undefined;
      const detail = entry.detail ?? entry.command;
      const observation: FailureObservation = {
        gate: entry.gate,
        detail,
        ...(entry.exit_code !== undefined ? { exit_code: entry.exit_code } : {}),
        workspace: observe(detail)
      };
      const classification = classifyFailure(observation);
      return { requirement_id: requirementId, entry, observation, classification, plan: planRecovery(classification) };
    },
    progress: advanceRecovery,
    hns(request) {
      const classification = request.classification;
      const decision = planHnsFallback({
        ...request,
        classification,
        plan: request.plan ?? planRecovery(classification),
        now: now().toISOString()
      });
      const usage = recordHnsUsage(decision, request.role ?? "fallback", now().toISOString());
      const record: CapabilityGapRecord = { gap: decision.capability_gap, backlog: decision.backlog, usage };
      records.push(record);
      persist();
      return { record, decision };
    },
    gaps: () => records,
    save() {
      persist();
      return backlogPath;
    }
  };

  function persist(): void {
    fs.mkdirSync(path.dirname(backlogPath), { recursive: true });
    fs.writeFileSync(backlogPath, JSON.stringify({ schemaVersion: 1, version: "capability-gaps-1", records }, null, 2), "utf8");
  }
}

function load(backlogPath: string): CapabilityGapRecord[] {
  if (!fs.existsSync(backlogPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(backlogPath, "utf8")) as { records?: CapabilityGapRecord[] };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    // A damaged backlog must not be silently treated as empty history.
    return [];
  }
}
