import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { tempDir } from "./root-fixtures";
import { cleanGateReport, desktopBlackBoxReport } from "./acceptance-report";
import {
  ACCEPTANCE_GATE_CONTRACTS,
  DESKTOP_BLACK_BOX_CONTRACT,
  type AcceptanceGateContract
} from "../../src/shared/acceptance-contracts";
import {
  buildGateAttestation,
  canonicalJson,
  validateDesktopBlackBoxReport,
  validateGateReport,
  type AcceptanceSession
} from "../../src/shared/acceptance-evidence";
import {
  emptyOwnerLedger,
  appendOwnerIntervention,
  type OwnerInterventionLedger
} from "../../src/shared/owner-intervention";
import {
  acceptanceDirectory,
  attestationPath,
  readJsonFile,
  startAcceptanceSession
} from "../../electron/engineering/acceptance-session";
import { ownerLedgerPath, writeOwnerLedger } from "../../electron/engineering/owner-intervention-ledger";
import { createBootstrapAuditor } from "../../electron/engineering/bootstrap-completion";
import type { TrustedBootstrapAudit } from "../../src/shared/bootstrap-audit";

/**
 * checkpoint-2 §8.7/§9.3 — a complete trusted evidence set built the way the real
 * chain builds it: real report files, real SHA-256 hashes, real attestations, a real
 * session and a real ledger, all under a temporary artifacts directory. The mutation
 * suites change these artifacts on disk and then ask the real host auditor, so no
 * test can mock the decision.
 */
export interface TrustedFixture {
  root: string;
  artifacts: string;
  session: AcceptanceSession;
  gateContracts: readonly AcceptanceGateContract[];
  reportFile(gate: string): string;
  attestationFile(gate: string): string;
  readReport(gate: string): unknown;
  writeReport(gate: string, report: unknown): void;
  /** Re-attests the current bytes of a report, so only its content is under test. */
  attest(gate: string): void;
  removeReport(gate: string): void;
  removeAttestation(gate: string): void;
  writeLedger(ledger: OwnerInterventionLedger): void;
  recordIntervention(reason: string, blockerClass?: string): void;
  /** Rewrites the session manifest (e.g. to a different commit or session id). */
  rebindSession(partial: Partial<AcceptanceSession>): AcceptanceSession;
  evaluate(): TrustedBootstrapAudit;
}

export function cleanDesktopReport(): ReturnType<typeof desktopBlackBoxReport> {
  return desktopBlackBoxReport();
}

/**
 * The frozen instant every fixture report and session uses, so two fixtures built
 * from the same evidence really are byte-identical and must hash identically.
 */
export const FIXTURE_INSTANT = "2026-01-01T00:00:00.000Z";

/** §6: the deterministic tree the fixture sessions certify (their roots are not git repos). */
export const FIXTURE_TREE = "e".repeat(40);

/** Pins a fixture report's timestamp so the evidence is reproducible. */
function pinInstant<T extends { generatedAt?: string }>(report: T): T {
  if (typeof report.generatedAt === "string") report.generatedAt = FIXTURE_INSTANT;
  return report;
}

function validateFor(gate: string, contract: AcceptanceGateContract, report: unknown) {
  return gate === DESKTOP_BLACK_BOX_CONTRACT.gate
    ? validateDesktopBlackBoxReport({ contract, report })
    : validateGateReport({ gate, contract, report });
}

export function trustedFixture(options: { sessionId?: string; commit?: string; tree?: string } = {}): TrustedFixture {
  const root = tempDir("boss-trusted-");
  const artifacts = acceptanceDirectory(root);
  const outcome = startAcceptanceSession({
    root,
    artifacts,
    certify: true,
    clean: true,
    sessionId: options.sessionId ?? "session-trusted",
    commit: options.commit ?? "c".repeat(40),
    tree: options.tree ?? FIXTURE_TREE,
    workingTreeStatus: "",
    now: () => new Date(FIXTURE_INSTANT)
  });
  if (!outcome.ok || !outcome.session) throw new Error(`trusted fixture session failed: ${outcome.reason}`);
  const session = outcome.session;

  const reportFile = (gate: string): string => {
    const contract = gate === DESKTOP_BLACK_BOX_CONTRACT.gate ? DESKTOP_BLACK_BOX_CONTRACT : ACCEPTANCE_GATE_CONTRACTS.find((entry) => entry.gate === gate)!;
    return path.join(artifacts, contract.report_file);
  };
  const contractOf = (gate: string): AcceptanceGateContract =>
    gate === DESKTOP_BLACK_BOX_CONTRACT.gate ? DESKTOP_BLACK_BOX_CONTRACT : ACCEPTANCE_GATE_CONTRACTS.find((entry) => entry.gate === gate)!;

  const writeReport = (gate: string, report: unknown): void => {
    const target = reportFile(gate);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  };
  const attest = (gate: string): void => {
    const contract = contractOf(gate);
    const report = readJsonFile(reportFile(gate));
    const validation = validateFor(gate, contract, report);
    const attestation = buildGateAttestation({
      gate,
      contract,
      session,
      source_sha256: sha256OfFile(reportFile(gate)),
      validation,
      attested_at: new Date(0).toISOString()
    });
    const target = attestationPath(artifacts, gate);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${canonicalJson(attestation)}\n`, "utf8");
  };

  // Every delivery gate, then the desktop black box, then an empty ledger.
  for (const contract of ACCEPTANCE_GATE_CONTRACTS) {
    writeReport(contract.gate, pinInstant(cleanGateReport(contract)));
    attest(contract.gate);
  }
  writeReport(DESKTOP_BLACK_BOX_CONTRACT.gate, pinInstant(cleanDesktopReport()));
  attest(DESKTOP_BLACK_BOX_CONTRACT.gate);
  writeLedger(emptyOwnerLedger(session));

  function writeLedger(ledger: OwnerInterventionLedger): void {
    writeOwnerLedger(artifacts, ledger);
  }

  return {
    root,
    artifacts,
    session,
    gateContracts: ACCEPTANCE_GATE_CONTRACTS,
    reportFile,
    attestationFile: (gate) => attestationPath(artifacts, gate),
    readReport: (gate) => readJsonFile(reportFile(gate)),
    writeReport,
    attest,
    removeReport: (gate) => fs.rmSync(reportFile(gate), { force: true }),
    removeAttestation: (gate) => fs.rmSync(attestationPath(artifacts, gate), { force: true }),
    writeLedger,
    recordIntervention: (reason, blockerClass) => {
      const current = readJsonFile(ownerLedgerPath(artifacts)) as OwnerInterventionLedger | undefined;
      writeLedger(appendOwnerIntervention(current ?? emptyOwnerLedger(session), {
        source: "acceptance-run",
        at: new Date(0).toISOString(),
        reason,
        ...(blockerClass !== undefined ? { blocker_class: blockerClass } : {})
      }));
    },
    rebindSession: (partial) => {
      const next: AcceptanceSession = { ...session, ...partial };
      fs.writeFileSync(path.join(artifacts, "session.json"), `${canonicalJson(next)}\n`, "utf8");
      return next;
    },
    evaluate: () => createBootstrapAuditor({ root, artifacts }).evaluate().audit
  };
}

function sha256OfFile(file: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return "";
  }
}
