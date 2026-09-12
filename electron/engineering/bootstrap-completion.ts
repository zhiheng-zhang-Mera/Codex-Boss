/**
 * Update-Plan/checkpoint-1.md §57/§58 + checkpoint-2.md §7.5 — the host side of the
 * Bootstrap Completion audit: reads the reports every gate in the delivery chain
 * wrote, reads the acceptance session and the Owner intervention ledger, and turns
 * them into one verdict. It accepts no count from its caller.
 */
import fs from "node:fs";
import path from "node:path";
import { auditBootstrap, GATE_REQUIREMENTS, DESKTOP_BLACK_BOX, type BootstrapAudit, type GateReport } from "../../src/shared/bootstrap-audit";
import { emptyOwnerLedger, type OwnerInterventionLedger } from "../../src/shared/owner-intervention";
import { acceptanceDirectory, inspectSession } from "./acceptance-session";
import { inspectOwnerLedger } from "./owner-intervention-ledger";

/** Report file each gate writes, relative to the artifacts directory. */
export const REPORT_FILES: Readonly<Record<string, string>> = {
  "acceptance-workbook": "workbook-acceptance.json",
  "acceptance-knowledge": "knowledge-foundation.json",
  "acceptance-architecture": "architecture-discovery.json",
  "acceptance-theme": "theme-engine.json",
  "acceptance-requirements": "requirements-graph.json",
  "acceptance-plan": "execution-plan.json",
  "acceptance-verify": "verification-engine.json",
  "acceptance-review": "review-loop.json",
  "acceptance-self-healing": "recovery.json",
  "acceptance-capability-gap": "capability-gap.json",
  "acceptance-candidate": "candidate-guardian.json",
  "acceptance-version-checkpoint": "version-checkpoint.json",
  "acceptance-publish": "publish-release.json",
  "acceptance-ci-repair": "ci-repair.json",
  "acceptance-final": "final-acceptance-gate.json",
  "acceptance-soak": "soak.json",
  [DESKTOP_BLACK_BOX]: "desktop-workbook.json"
};

export const BOOTSTRAP_AUDIT_RECORD = "bootstrap-completion.json";

export interface BootstrapAuditGate {
  root: string;
  artifacts?: string;
  now?: () => Date;
}

export interface BootstrapAuditOutcome {
  audit: BootstrapAudit;
  reports: { gate: string; file: string; present: boolean; unit?: string }[];
  /** §7.5: the ledger the count was derived from, and how it was judged. */
  ownerLedger: { session_id: string; events: number; problems: string[] };
  session_id?: string;
  recordPath: string;
}

export function createBootstrapAuditor(config: BootstrapAuditGate): {
  /** §2.5/§7.5: no parameters. The count comes from the runtime ledger. */
  evaluate(): BootstrapAuditOutcome;
} {
  const root = fs.realpathSync(config.root);
  const artifacts = config.artifacts ?? acceptanceDirectory(root);
  const now = config.now ?? (() => new Date());
  const recordPath = path.join(artifacts, "bootstrap-completion.json");

  return {
    evaluate() {
      const reports: Record<string, GateReport | undefined> = {};
      const listed: BootstrapAuditOutcome["reports"] = [];
      for (const gate of [...Object.keys(GATE_REQUIREMENTS), DESKTOP_BLACK_BOX]) {
        const file = REPORT_FILES[gate] ?? "";
        const target = path.join(artifacts, file);
        let parsed: GateReport | undefined;
        if (fs.existsSync(target)) {
          try { parsed = JSON.parse(fs.readFileSync(target, "utf8")) as GateReport; } catch { parsed = undefined; }
        }
        reports[gate] = parsed;
        listed.push({ gate, file, present: parsed !== undefined, ...(parsed?.unit ? { unit: parsed.unit } : {}) });
      }
      // §7.5: the count is the ledger's own event count, and the ledger must belong
      // to this session and commit. A missing session is missing evidence, not zero.
      const sessionInspection = inspectSession(artifacts);
      const session = sessionInspection.session;
      const ledgerInspection = session
        ? inspectOwnerLedger(session, artifacts)
        : { problems: ["SESSION_MISSING", ...sessionInspection.problems], count: 0 };
      const ownerLedger: OwnerInterventionLedger = session
        ? ledgerInspection.ledger ?? emptyOwnerLedger(session)
        : emptyOwnerLedger({ session_id: "", commit_sha: "" });
      const audit = auditBootstrap({ reports, ownerLedger, ownerLedgerProblems: ledgerInspection.problems });
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(recordPath, JSON.stringify({ ...audit, audited_at: now().toISOString(), artifacts }, null, 2), "utf8");
      return {
        audit,
        reports: listed,
        ownerLedger: { session_id: ownerLedger.session_id, events: ownerLedger.events.length, problems: ledgerInspection.problems },
        ...(session ? { session_id: session.session_id } : {}),
        recordPath
      };
    }
  };
}
