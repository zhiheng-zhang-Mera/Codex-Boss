/**
 * Update-Plan/checkpoint-2.md §7 — the Owner Intervention Truth Ledger.
 *
 * "0 Owner interventions" may not be a number a caller wrote down (§2.5/§7.5): it
 * has to be the length of a ledger the run itself appended to. This module is the
 * pure half — the event and ledger shape, the single append path, the verification
 * and the route registry that says which escalation surfaces exist and how each one
 * is accounted for.
 *
 * Pure: no fs, no clock, no process. The single writer is
 * `electron/engineering/owner-intervention-ledger.ts`.
 */
import { canonicalSha256, type AcceptanceSession } from "./acceptance-evidence";
import { trustProblem, type TrustProblem } from "./trust-problems";

export const OWNER_LEDGER_SCHEMA_VERSION = 1 as const;

/** §44: the ledger's machine codes. */
export const OWNER_LEDGER_CODES = {
  LEDGER_NOT_OBJECT: "LEDGER_NOT_OBJECT",
  LEDGER_MISSING: "OWNER_LEDGER_MISSING",
  LEDGER_SCHEMA_UNSUPPORTED: "LEDGER_SCHEMA_UNSUPPORTED",
  LEDGER_SESSION_MISMATCH: "LEDGER_SESSION_MISMATCH",
  LEDGER_COMMIT_MISMATCH: "LEDGER_COMMIT_MISMATCH",
  LEDGER_EVENTS_NOT_ARRAY: "LEDGER_EVENTS_NOT_ARRAY",
  LEDGER_EVENT_INVALID: "LEDGER_EVENT_INVALID",
  LEDGER_EVENT_FIELD_MISSING: "LEDGER_EVENT_FIELD_MISSING",
  LEDGER_EVENT_AT_INVALID: "LEDGER_EVENT_AT_INVALID",
  LEDGER_EVENT_ID_DUPLICATE: "LEDGER_EVENT_ID_DUPLICATE",
  LEDGER_COUNT_MISSING: "LEDGER_COUNT_MISSING",
  LEDGER_COUNT_MISMATCH: "LEDGER_COUNT_MISMATCH",
  LEDGER_HASH_MISMATCH: "LEDGER_HASH_MISMATCH"
} as const;

/** §7.3: one recorded request for the Owner to decide or act. */
export interface OwnerInterventionEvent {
  id: string;
  at: string;
  /** The route or module that asked. */
  source: string;
  /** A §44 Hard Blocker class, or ENGINEERING_REQUEST when no class applies. */
  blocker_class: string;
  reason: string;
  requested_action: string;
  outcome: string;
}

export interface OwnerInterventionLedger {
  schemaVersion: 1;
  session_id: string;
  commit_sha: string;
  events: OwnerInterventionEvent[];
  count: number;
  ledger_hash: string;
}

/** The digest of everything but the digest itself. */
export function ownerLedgerHashOf(body: Omit<OwnerInterventionLedger, "ledger_hash">): string {
  return canonicalSha256(body);
}

export function emptyOwnerLedger(session: Pick<AcceptanceSession, "session_id" | "commit_sha">): OwnerInterventionLedger {
  const body: Omit<OwnerInterventionLedger, "ledger_hash"> = {
    schemaVersion: OWNER_LEDGER_SCHEMA_VERSION,
    session_id: session.session_id,
    commit_sha: session.commit_sha,
    events: [],
    count: 0
  };
  return { ...body, ledger_hash: ownerLedgerHashOf(body) };
}

export interface OwnerInterventionRequest {
  source: string;
  reason: string;
  /** The instant the intervention happened; the caller owns the clock. */
  at: string;
  blocker_class?: string;
  requested_action?: string;
  outcome?: string;
}

/** The only way an event enters a ledger: ids, count and digest are derived here. */
export function appendOwnerIntervention(ledger: OwnerInterventionLedger, request: OwnerInterventionRequest): OwnerInterventionLedger {
  const event: OwnerInterventionEvent = {
    id: `OI-${String(ledger.events.length + 1).padStart(4, "0")}`,
    at: request.at,
    source: request.source,
    blocker_class: request.blocker_class ?? "ENGINEERING_REQUEST",
    reason: request.reason,
    requested_action: request.requested_action ?? "decide how the engineering run should proceed",
    outcome: request.outcome ?? "RECORDED"
  };
  // The digest must cover only the body it belongs to, so the previous digest is
  // dropped before recomputing.
  const { ledger_hash: _previous, ...base } = ledger;
  const body: Omit<OwnerInterventionLedger, "ledger_hash"> = {
    ...base,
    events: [...ledger.events, event],
    count: ledger.events.length + 1
  };
  return { ...body, ledger_hash: ownerLedgerHashOf(body) };
}

/** §7.5: the count is the ledger's own event count, never an input. */
export function deriveOwnerInterventions(ledger: OwnerInterventionLedger): number {
  return ledger.events.length;
}

/**
 * §7.5: the ledger must belong to this session and this commit, its count must be
 * its event count, every event must be complete and the digest must hold.
 * §44: the result is structured; the caller branches on codes, never on prose.
 */
export function verifyOwnerLedger(input: { ledger: unknown; session: AcceptanceSession }): TrustProblem[] {
  const problems: TrustProblem[] = [];
  const value = input.ledger;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [trustProblem(OWNER_LEDGER_CODES.LEDGER_NOT_OBJECT)];
  const ledger = value as Partial<OwnerInterventionLedger>;
  if (ledger.schemaVersion !== OWNER_LEDGER_SCHEMA_VERSION) problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_SCHEMA_UNSUPPORTED, String(ledger.schemaVersion)));
  if (ledger.session_id !== input.session.session_id) problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_SESSION_MISMATCH, `${String(ledger.session_id)}!=${input.session.session_id}`));
  if (ledger.commit_sha !== input.session.commit_sha) problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_COMMIT_MISMATCH, `${String(ledger.commit_sha)}!=${input.session.commit_sha}`));
  const events = ledger.events;
  if (!Array.isArray(events)) {
    problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_EVENTS_NOT_ARRAY));
    return problems;
  }
  const ids = new Set<string>();
  events.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_EVENT_INVALID, String(index)));
      return;
    }
    const event = entry as Partial<OwnerInterventionEvent>;
    for (const field of ["id", "at", "source", "blocker_class", "reason", "requested_action", "outcome"] as const) {
      if (typeof event[field] !== "string" || String(event[field]).trim() === "") problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_EVENT_FIELD_MISSING, `${index}.${field}`));
    }
    if (typeof event.at === "string" && Number.isNaN(Date.parse(event.at))) problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_EVENT_AT_INVALID, String(index)));
    if (typeof event.id === "string") {
      if (ids.has(event.id)) problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_EVENT_ID_DUPLICATE, event.id));
      ids.add(event.id);
    }
  });
  if (typeof ledger.count !== "number") problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_COUNT_MISSING));
  else if (ledger.count !== events.length) problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_COUNT_MISMATCH, `${ledger.count}!=${events.length}`));
  const { ledger_hash: _ignored, ...body } = ledger as OwnerInterventionLedger;
  if (typeof ledger.ledger_hash !== "string" || ledger.ledger_hash !== ownerLedgerHashOf(body)) problems.push(trustProblem(OWNER_LEDGER_CODES.LEDGER_HASH_MISMATCH));
  return problems;
}

/* ------------------------------------------------------------------ *
 * §7.4 the escalation route registry
 * ------------------------------------------------------------------ */

export type OwnerInterventionDisposition =
  /** The route asks the Owner and records the event through the central ledger. */
  | "LEDGERED"
  /** The shipped app's designed hand-off to its own operator (a product feature). */
  | "PRODUCT_HITL"
  /** The module classifies and stops; asking the Owner is the caller's decision. */
  | "STOPS_WITHOUT_ASKING"
  /** Explicitly Post-Prestart (§21), so outside this certification's scope. */
  | "POST_PRESTART";

export interface OwnerInterventionRoute {
  id: string;
  /** Repository-relative path, forward slashes. */
  file: string;
  /** Text the file must still contain, so the registry cannot rot silently. */
  marker: string;
  disposition: OwnerInterventionDisposition;
  note: string;
}

/**
 * Every escalation surface this repository has, and how it is accounted for. A new
 * escalation path that is not registered here fails OI-10 — which is the point:
 * there may not be a second, unaccounted way to ask the Owner for something.
 */
export const OWNER_INTERVENTION_ROUTES: readonly OwnerInterventionRoute[] = [
  {
    id: "promotion-requires-root-owner",
    file: "electron/promotion-gate/promotion-controller.ts",
    marker: "recordOwnerIntervention",
    disposition: "LEDGERED",
    note: "a promotion that touches the Root Surface parks in WAITING_FOR_ROOT_OWNER; that durable wait is recorded as an Owner intervention"
  },
  {
    id: "acceptance-run-declares-an-intervention",
    file: "scripts/acceptance-intervention.cjs",
    marker: "recordOwnerIntervention",
    disposition: "LEDGERED",
    note: "the authoritative acceptance run's own entry point for declaring that it needed the Owner"
  },
  {
    id: "app-operator-work-handoff",
    file: "electron/main.ts",
    marker: "workEscalationVerdict",
    disposition: "PRODUCT_HITL",
    note: "the shipped app asking its own operator whether a request should become Work — designed product behaviour, not the Prestart engineering run"
  },
  {
    id: "capability-needs-escalation",
    file: "src/shared/capability-needs.ts",
    marker: "decideEscalation",
    disposition: "PRODUCT_HITL",
    note: "the same hand-off decided from required capabilities"
  },
  {
    id: "research-supervisor-park",
    file: "electron/research/research-supervisor.ts",
    marker: "HARD_BLOCKER",
    disposition: "POST_PRESTART",
    note: "§21: the research pipeline is Post-Prestart and is not part of this certification"
  },
  {
    id: "ci-repair-hard-blocker",
    file: "electron/engineering/ci-repair-loop.ts",
    marker: "HARD_BLOCKER",
    disposition: "STOPS_WITHOUT_ASKING",
    note: "the loop stops and reports; it never contacts the Owner itself, so the caller that decides to ask must use assessBlocker + the ledger"
  },
  {
    id: "implementation-loop-hard-blocker",
    file: "electron/engineering/implementation-loop.ts",
    marker: "hard_blocker",
    disposition: "STOPS_WITHOUT_ASKING",
    note: "returns the hard-blocker verdict to its caller instead of escalating"
  }
];

/** The routes that are expected to write the central ledger. */
export function ledgeredRoutes(): OwnerInterventionRoute[] {
  return OWNER_INTERVENTION_ROUTES.filter((route) => route.disposition === "LEDGERED");
}
