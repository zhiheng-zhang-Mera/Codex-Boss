/**
 * Update-Plan/checkpoint-1.md §57/§58 + checkpoint-2.md §8 — the host side of the
 * Bootstrap Completion audit.
 *
 * It reads what is really on disk (the session manifest, the sixteen gate reports,
 * their attestations, the desktop black box and the Owner intervention ledger),
 * hashes it, and hands it to the trusted pure audit. It takes no parameters: there
 * is nothing a caller can assert about the result.
 */
import fs from "node:fs";
import path from "node:path";
import {
  DESKTOP_BLACK_BOX,
  evaluateTrustedBootstrap,
  GATE_REQUIREMENTS,
  type GateEvidence,
  type TrustedBootstrapAudit
} from "../../src/shared/bootstrap-audit";
import { REPORT_FILES } from "../../src/shared/acceptance-contracts";
import {
  acceptanceDirectory,
  attestationPath,
  reportPath,
  sha256File,
  readJsonFile,
  sessionPath,
  inspectSession,
  SESSION_FILE
} from "./acceptance-session";
import { OWNER_LEDGER_FILE, ownerLedgerPath, readOwnerLedger } from "./owner-intervention-ledger";
import { writeFileAtomicSync } from "./atomic-file";

/** The record the Bootstrap Completion audit writes. */
export const BOOTSTRAP_AUDIT_RECORD = "bootstrap-completion.json";

/** Kept for readers that still import the per-gate report map. */
export { REPORT_FILES };

export interface BootstrapAuditGate {
  root: string;
  artifacts?: string;
  now?: () => Date;
  /**
   * §2.8/§8.5: when false the auditor is read-only. The graduation command uses this
   * so it can compare its recomputation against the record an earlier step wrote —
   * an auditor that rewrites the record it is verifying can never fail that check.
   */
  write?: boolean;
}

export interface BootstrapAuditOutcome {
  audit: TrustedBootstrapAudit;
  reports: { gate: string; file: string; present: boolean; unit?: string }[];
  recordPath: string;
}

function readEvidence(artifacts: string, gate: string): GateEvidence {
  const reportFile = REPORT_FILES[gate] ?? "";
  const report = reportPath(artifacts, reportFile);
  const attestation = attestationPath(artifacts, gate);
  return {
    gate,
    report_file: reportFile,
    report: readJsonFile(report),
    report_sha256: sha256File(report),
    attestation_file: path.posix.join("attestations", `${gate}.json`),
    attestation: readJsonFile(attestation),
    attestation_sha256: sha256File(attestation)
  };
}

export function createBootstrapAuditor(config: BootstrapAuditGate): {
  /** §2.5/§7.5/§8.1: no parameters — the evidence is read, never asserted. */
  evaluate(): BootstrapAuditOutcome;
} {
  const root = fs.realpathSync(config.root);
  const artifacts = config.artifacts ?? acceptanceDirectory(root);
  const now = config.now ?? (() => new Date());
  const recordPath = path.join(artifacts, BOOTSTRAP_AUDIT_RECORD);

  return {
    evaluate() {
      const sessionInspection = inspectSession(artifacts);
      const gates = Object.keys(GATE_REQUIREMENTS).map((gate) => readEvidence(artifacts, gate));
      const desktop = readEvidence(artifacts, DESKTOP_BLACK_BOX);
      const ledger = readOwnerLedger(artifacts);
      const audit = evaluateTrustedBootstrap({
        ...(sessionInspection.session ? { session: sessionInspection.session } : {}),
        session_sha256: sha256File(sessionPath(artifacts)),
        session_file: SESSION_FILE,
        gates,
        desktop,
        ...(ledger ? { ownerLedger: ledger } : {}),
        ownerLedgerSha256: sha256File(ownerLedgerPath(artifacts)),
        ownerLedgerFile: OWNER_LEDGER_FILE
      });
      const reports = [...gates, desktop].map((evidence) => {
        const parsed = evidence.report as { unit?: unknown } | undefined;
        return {
          gate: evidence.gate,
          file: evidence.report_file,
          present: evidence.report !== undefined,
          ...(typeof parsed?.unit === "string" ? { unit: parsed.unit } : {})
        };
      });
      const record = { ...audit, audited_at: now().toISOString(), artifacts, session_problems: sessionInspection.problems };
      if (config.write !== false) {
        fs.mkdirSync(artifacts, { recursive: true });
        writeFileAtomicSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
      }
      return { audit, reports, recordPath };
    }
  };
}
