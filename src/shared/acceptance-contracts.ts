/**
 * Update-Plan/checkpoint-2.md §5.4/§8.1/§14 — the canonical acceptance contracts.
 *
 * The Prestart trust boundary does not trust a report because a file exists. Every
 * report a gate writes is judged against exactly one contract declared here: which
 * requirement ids it must PASS, which report file carries them, which contract
 * version the evidence belongs to, and which ids are explicitly out of Prestart's
 * scope (recorded, never silently dropped).
 *
 * Pure: no fs, no clock, no process.
 */
import {
  DESKTOP_BLACK_BOX_CONTRACT_VERSION,
  DESKTOP_BLACK_BOX_REQUIRED_IDS
} from "./desktop-black-box-contract";

export const ACCEPTANCE_CONTRACT_VERSION = "acceptance-contracts-1" as const;

/**
 * The desktop black-box gate. Unlike the delivery gates it is not a suite report:
 * it is the real Electron product path, so its required ids come from the
 * versioned claim contract (§6.1) rather than from a list kept here.
 */
export const DESKTOP_BLACK_BOX_GATE = "acceptance-desktop-workbook" as const;

/** Report schema versions the strict validator understands (checkpoint-2 §5.4). */
export const ACCEPTANCE_SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];

/** An id the contract places outside Prestart graduation, with its authority. */
export interface AcceptanceOutOfScopeId {
  id: string;
  /** Why this id may legitimately be NOT_RUN instead of PASS. */
  reason: string;
  /** Where that exclusion is authorised. */
  scope_ref: string;
}

export interface AcceptanceGateContract {
  /** The gate name used by the scripts (`acceptance:attest -- <gate>`). */
  gate: string;
  /** The evidence contract version; it must bump when the required ids change. */
  contract_version: string;
  /** The report file, relative to `artifacts/acceptance/`. */
  report_file: string;
  /** Ids that must be present and PASS. */
  required_ids: readonly string[];
  /** Ids that may be NOT_RUN, and only these (§6.4/§21 exclusions). */
  out_of_scope_ids: readonly AcceptanceOutOfScopeId[];
  /**
   * §2.6/§6.3: the producer emits exactly this id set — no extras, nothing missing.
   * Set for the desktop black box and for the trust-boundary suites, whose reports
   * this repository generates itself. The sixteen delivery gates report extra
   * passing checks of their own, so they leave it unset.
   */
  exact_ids?: boolean;
}

/**
 * §2.1's single explicit exclusion: live third-party provider execution is
 * Post-Prestart (§6.4, §21). The id must still be reported as NOT_RUN — it may
 * never simply vanish — and no other id may use this route.
 */
const LIVE_PROVIDER_EXCLUSION: AcceptanceOutOfScopeId = {
  id: "WB-LIVE-PROVIDER",
  reason: "live desktop / browser provider execution is Post-Prestart; the bounded black box proves the product path, not a live AI page",
  scope_ref: "checkpoint-2 §6.4 + §21"
};

/** §8.1: the sixteen delivery-chain gates and the ids each must have passed. */
export const ACCEPTANCE_GATE_CONTRACTS: readonly AcceptanceGateContract[] = [
  {
    gate: "acceptance-workbook",
    contract_version: "workbook-acceptance-1",
    report_file: "workbook-acceptance.json",
    required_ids: ["WB-01", "WB-02", "WB-03", "WB-04", "WB-05", "WB-06", "WB-07", "WB-08", "WB-09", "WB-10"],
    out_of_scope_ids: [LIVE_PROVIDER_EXCLUSION]
  },
  {
    gate: "acceptance-knowledge",
    contract_version: "knowledge-foundation-1",
    report_file: "knowledge-foundation.json",
    required_ids: ["K-01", "K-02", "K-03", "K-04"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-architecture",
    contract_version: "architecture-discovery-1",
    report_file: "architecture-discovery.json",
    required_ids: ["A-01", "A-02", "A-03", "A-04", "A-05", "A-06", "A-07", "A-08", "A-09", "A-10"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-theme",
    contract_version: "theme-engine-1",
    report_file: "theme-engine.json",
    required_ids: ["TH-01", "TH-02", "TH-03", "TH-04", "TH-05", "TH-06", "TH-07", "TH-08", "TH-09", "TH-10", "TH-11", "TH-12", "TH-13", "TH-14", "TH-15", "T-TOKENS"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-requirements",
    contract_version: "requirements-graph-1",
    report_file: "requirements-graph.json",
    required_ids: ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06", "R-07", "R-08"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-plan",
    contract_version: "execution-plan-1",
    report_file: "execution-plan.json",
    required_ids: ["P-01", "P-02", "P-03", "P-04", "P-05", "P-06"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-verify",
    contract_version: "verification-engine-1",
    report_file: "verification-engine.json",
    required_ids: ["V-01", "V-02", "V-03", "V-04", "V-05", "V-06", "V-07", "V-08", "V-09", "V-10"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-review",
    contract_version: "review-loop-1",
    report_file: "review-loop.json",
    required_ids: ["C-01", "C-02", "C-03", "C-04", "C-05", "C-06", "C-07", "C-08", "C-09", "C-10", "C-11"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-self-healing",
    contract_version: "self-healing-1",
    report_file: "recovery.json",
    required_ids: ["RC-01", "RC-02", "RC-03", "RC-04", "RC-05", "RC-06", "RC-07", "RC-08", "RC-09", "RC-10"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-capability-gap",
    contract_version: "capability-gap-1",
    report_file: "capability-gap.json",
    required_ids: ["CG-01", "CG-02", "CG-03", "CG-04", "CG-05", "CG-06", "CG-07", "CG-08", "CG-09", "CG-10"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-candidate",
    contract_version: "candidate-guardian-1",
    report_file: "candidate-guardian.json",
    required_ids: ["GD-01", "GD-02", "GD-03", "GD-04", "GD-05", "GD-06", "GD-07", "GD-08", "GD-09", "GD-10"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-version-checkpoint",
    contract_version: "version-checkpoint-1",
    report_file: "version-checkpoint.json",
    required_ids: ["VC-01", "VC-02", "VC-03", "VC-04", "VC-05", "VC-06", "VC-07", "VC-08"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-publish",
    contract_version: "publish-release-1",
    report_file: "publish-release.json",
    required_ids: ["PB-01", "PB-02", "PB-03", "PB-04", "PB-05", "PB-06", "PB-07", "PB-08", "PB-09", "PB-10"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-ci-repair",
    contract_version: "ci-repair-1",
    report_file: "ci-repair.json",
    required_ids: ["CR-01", "CR-02", "CR-03", "CR-04", "CR-05", "CR-06", "CR-07", "CR-08"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-final",
    contract_version: "final-acceptance-1",
    report_file: "final-acceptance-gate.json",
    required_ids: ["FS-01", "FS-02", "FS-03", "FS-04", "FS-05", "FS-06", "FS-07", "FS-08"],
    out_of_scope_ids: []
  },
  {
    gate: "acceptance-soak",
    contract_version: "soak-1",
    report_file: "soak.json",
    required_ids: ["SK-01", "SK-02", "SK-03", "SK-04", "SK-05", "SK-06"],
    out_of_scope_ids: []
  }
];

/**
 * §6.1–§6.3: the real-application black box. Its required ids are the contract's
 * own claim ids, and the count comes from the contract, never from a literal.
 */
export const DESKTOP_BLACK_BOX_CONTRACT: AcceptanceGateContract = {
  gate: DESKTOP_BLACK_BOX_GATE,
  contract_version: DESKTOP_BLACK_BOX_CONTRACT_VERSION,
  report_file: "desktop-workbook.json",
  required_ids: [...DESKTOP_BLACK_BOX_REQUIRED_IDS],
  out_of_scope_ids: [],
  exact_ids: true
};

/**
 * §5.6/§6.5/§7.6/§8.7/§9 — the acceptance suites that harden the trust boundary
 * itself. They are attested exactly like the delivery gates so the final
 * certificate carries their evidence instead of a prose claim.
 */
export const ACCEPTANCE_SUPPORTING_CONTRACTS: readonly AcceptanceGateContract[] = [
  {
    gate: "acceptance-evidence-integrity",
    contract_version: "evidence-integrity-1",
    report_file: "evidence-integrity.json",
    required_ids: ["EI-01", "EI-02", "EI-03", "EI-04", "EI-05", "EI-06", "EI-07", "EI-08", "EI-09", "EI-10", "EI-11", "EI-12"],
    out_of_scope_ids: [],
    exact_ids: true
  },
  {
    gate: "acceptance-desktop-contract",
    contract_version: "desktop-contract-1",
    report_file: "desktop-contract.json",
    required_ids: ["DB-01", "DB-02", "DB-03", "DB-04", "DB-05", "DB-06", "DB-07", "DB-08", "DB-09", "DB-10", "DB-11", "DB-12"],
    out_of_scope_ids: [],
    exact_ids: true
  },
  {
    gate: "acceptance-owner-ledger",
    contract_version: "owner-ledger-1",
    report_file: "owner-ledger.json",
    required_ids: ["OI-01", "OI-02", "OI-03", "OI-04", "OI-05", "OI-06", "OI-07", "OI-08", "OI-09", "OI-10"],
    out_of_scope_ids: [],
    exact_ids: true
  },
  {
    gate: "acceptance-root-hardening",
    contract_version: "root-hardening-1",
    report_file: "bootstrap-root-hardening.json",
    required_ids: ["RA-01", "RA-02", "RA-03", "RA-04", "RA-05", "RA-06", "RA-07", "RA-08", "RA-09", "RA-10", "RA-11", "RA-12"],
    out_of_scope_ids: [],
    exact_ids: true
  },
  {
    gate: "acceptance-adversarial",
    contract_version: "prestart-adversarial-1",
    report_file: "prestart-adversarial.json",
    required_ids: [
      "AD-01", "AD-02", "AD-03", "AD-04", "AD-05", "AD-06", "AD-07", "AD-08", "AD-09", "AD-10",
      "AD-11", "AD-12", "AD-13", "AD-14", "AD-15", "AD-16", "AD-17", "AD-18", "AD-19", "AD-20",
      "AD-POSITIVE"
    ],
    out_of_scope_ids: [],
    exact_ids: true
  }
];

/** Every contract the trust boundary knows: the sixteen gates, the black box, the suites. */
export const ALL_ACCEPTANCE_CONTRACTS: readonly AcceptanceGateContract[] = [
  ...ACCEPTANCE_GATE_CONTRACTS,
  DESKTOP_BLACK_BOX_CONTRACT,
  ...ACCEPTANCE_SUPPORTING_CONTRACTS
];

/** §43: which gate's trusted evidence establishes which critical capability. */
export const CAPABILITY_GATES: Readonly<Record<string, readonly string[]>> = {
  "knowledge foundation": ["acceptance-knowledge", "acceptance-final"],
  "architecture and UI discovery": ["acceptance-architecture"],
  "theme engine": ["acceptance-theme", DESKTOP_BLACK_BOX_GATE],
  "requirements graph": ["acceptance-requirements"],
  "execution planner": ["acceptance-plan"],
  "verification engine": ["acceptance-verify"],
  "review layers": ["acceptance-review"],
  "self-healing": ["acceptance-self-healing"],
  "capability gap loop": ["acceptance-capability-gap"],
  "candidate and Guardian gate": ["acceptance-candidate"],
  "version impact and Git checkpoint": ["acceptance-version-checkpoint"],
  "GitHub publishing": ["acceptance-publish"],
  "CI repair loop": ["acceptance-ci-repair"]
};

const BY_NAME: ReadonlyMap<string, AcceptanceGateContract> = new Map(
  ALL_ACCEPTANCE_CONTRACTS.map((contract) => [contract.gate, contract])
);

/** The contract for a gate, or undefined when the gate is not a known contract. */
export function gateContract(gate: string): AcceptanceGateContract | undefined {
  return BY_NAME.get(gate);
}

/** Every gate name that has a declared contract (delivery gates, black box, suites). */
export function contractedGates(): string[] {
  return ALL_ACCEPTANCE_CONTRACTS.map((contract) => contract.gate);
}

/** §8.1 back-compat shape: gate name → the ids that must PASS. */
export const GATE_REQUIREMENTS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  ACCEPTANCE_GATE_CONTRACTS.map((contract) => [contract.gate, contract.required_ids])
);

/** Report file each gate writes, relative to `artifacts/acceptance/`. */
export const REPORT_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  ALL_ACCEPTANCE_CONTRACTS.map((contract) => [contract.gate, contract.report_file])
);
