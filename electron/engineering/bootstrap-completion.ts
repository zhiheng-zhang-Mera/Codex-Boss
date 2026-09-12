/**
 * Update-Plan/checkpoint-1.md §57/§58 — the host side of the Bootstrap Completion
 * audit: reads the reports every gate in the delivery chain wrote and turns them
 * into one verdict.
 */
import fs from "node:fs";
import path from "node:path";
import { auditBootstrap, GATE_REQUIREMENTS, DESKTOP_BLACK_BOX, type BootstrapAudit, type GateReport } from "../../src/shared/bootstrap-audit";

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
  recordPath: string;
}

export function createBootstrapAuditor(config: BootstrapAuditGate): {
  evaluate(input?: { owner_interventions?: number }): BootstrapAuditOutcome;
} {
  const root = fs.realpathSync(config.root);
  const artifacts = config.artifacts ?? path.join(root, "artifacts", "acceptance");
  const now = config.now ?? (() => new Date());
  const recordPath = path.join(artifacts, BOOTSTRAP_AUDIT_RECORD);

  return {
    evaluate(input = {}) {
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
      const audit = auditBootstrap({ reports, ...(input.owner_interventions !== undefined ? { owner_interventions: input.owner_interventions } : {}) });
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(recordPath, JSON.stringify({ ...audit, audited_at: now().toISOString(), artifacts }, null, 2), "utf8");
      return { audit, reports: listed, recordPath };
    }
  };
}
