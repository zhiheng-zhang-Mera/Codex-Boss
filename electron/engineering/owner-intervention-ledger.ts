/**
 * Update-Plan/checkpoint-2.md §7.1/§7.4/§7.5 — the single Owner intervention writer.
 *
 * `recordOwnerIntervention` is the only function in this repository that writes
 * `artifacts/acceptance/owner-interventions.json`, and the only way an intervention
 * becomes a number the root audit reads. Everything else (the promotion gate's
 * durable Owner wait, the acceptance run's own driver) calls it.
 *
 * When no acceptance session is active the call is an honest no-op: there is no run
 * to account for, so nothing is written and no count is manufactured.
 */
import fs from "node:fs";
import path from "node:path";
import {
  appendOwnerIntervention,
  emptyOwnerLedger,
  verifyOwnerLedger,
  type OwnerInterventionEvent,
  type OwnerInterventionLedger
} from "../../src/shared/owner-intervention";
import { canonicalJson, type AcceptanceSession } from "../../src/shared/acceptance-evidence";
import {
  ACCEPTANCE_RELATIVE,
  HISTORY_DIRECTORY,
  acceptanceDirectory,
  readJsonFile,
  readSession
} from "./acceptance-session";

/** §7.1: the ledger file this module owns exclusively. */
export const OWNER_LEDGER_FILE = "owner-interventions.json";

export function ownerLedgerPath(artifacts: string): string {
  return path.join(artifacts, OWNER_LEDGER_FILE);
}

export function readOwnerLedger(artifacts: string): OwnerInterventionLedger | undefined {
  const parsed = readJsonFile(ownerLedgerPath(artifacts));
  return parsed === undefined || parsed === null || typeof parsed !== "object" ? undefined : parsed as OwnerInterventionLedger;
}

export function writeOwnerLedger(artifacts: string, ledger: OwnerInterventionLedger): string {
  const target = ownerLedgerPath(artifacts);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${canonicalJson(ledger)}\n`, "utf8");
  return target;
}

/** §7.1: a certification run starts from an empty, session-bound ledger. */
export function initializeOwnerLedger(session: AcceptanceSession, artifacts: string): OwnerInterventionLedger {
  const ledger = emptyOwnerLedger(session);
  writeOwnerLedger(artifacts, ledger);
  return ledger;
}

export interface RecordOwnerInterventionOptions {
  /** Defaults to `<cwd>/artifacts/acceptance`. */
  artifacts?: string;
  root?: string;
  /** Test seam; the default reads the session manifest from disk. */
  session?: AcceptanceSession;
  now?: () => Date;
}

export interface OwnerInterventionRequestInput {
  source: string;
  reason: string;
  blocker_class?: string;
  requested_action?: string;
  outcome?: string;
}

/**
 * §7.4: the one entry point. Returns the recorded event, or undefined when no
 * certification session is active (so a development run cannot invent an
 * intervention, and a production run does not error when nothing is being
 * certified).
 */
export function recordOwnerIntervention(
  request: OwnerInterventionRequestInput,
  options: RecordOwnerInterventionOptions = {}
): OwnerInterventionEvent | undefined {
  const artifacts = options.artifacts ?? acceptanceDirectory(options.root ?? process.cwd());
  const session = options.session ?? readSession(artifacts);
  if (!session) return undefined;
  const now = options.now ?? (() => new Date());

  let ledger = readOwnerLedger(artifacts);
  if (ledger && ledger.session_id !== session.session_id) {
    // §2.3/§5.2.4: a ledger from another session is quarantined rather than merged,
    // and the fresh ledger for this session still records the event.
    const target = path.join(artifacts, HISTORY_DIRECTORY, String(ledger.session_id));
    fs.mkdirSync(target, { recursive: true });
    try { fs.renameSync(ownerLedgerPath(artifacts), path.join(target, OWNER_LEDGER_FILE)); } catch { /* best effort */ }
    ledger = undefined;
  }
  const base = ledger ?? emptyOwnerLedger(session);
  const next = appendOwnerIntervention(base, {
    source: request.source,
    reason: request.reason,
    at: now().toISOString(),
    ...(request.blocker_class !== undefined ? { blocker_class: request.blocker_class } : {}),
    ...(request.requested_action !== undefined ? { requested_action: request.requested_action } : {}),
    ...(request.outcome !== undefined ? { outcome: request.outcome } : {})
  });
  writeOwnerLedger(artifacts, next);
  return next.events[next.events.length - 1];
}

export interface OwnerLedgerInspection {
  ledger?: OwnerInterventionLedger;
  problems: string[];
  /** §7.5: the derived count — the ledger's own event count, never an input. */
  count: number;
}

/** Reads and verifies the ledger for a session; the root audit uses exactly this. */
export function inspectOwnerLedger(session: AcceptanceSession, artifacts: string): OwnerLedgerInspection {
  const ledger = readOwnerLedger(artifacts);
  if (!ledger) return { problems: ["OWNER_LEDGER_MISSING"], count: 0 };
  const problems = verifyOwnerLedger({ ledger, session });
  return { ledger, problems, count: ledger.events.length };
}

/** Exposed for diagnostics: where a certification run's ledger lives. */
export const OWNER_LEDGER_RELATIVE = path.join(ACCEPTANCE_RELATIVE, OWNER_LEDGER_FILE);
