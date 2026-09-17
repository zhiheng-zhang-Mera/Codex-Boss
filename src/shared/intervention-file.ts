/**
 * The on-disk contract for the human-intervention store — one declaration, two consumers.
 *
 * ## The defect this exists to prevent
 *
 * The store was written by `electron/commander/human-guidance-gate.ts` as
 * `{ schemaVersion: 1, interventions: HumanInterventionRequest[] }` and read by
 * `electron/host/host-observer-collector.ts` as `{ items?: [{ taskId, kind, question, resolvedAt }] }`.
 * Two hand-written key strings, two hand-written element shapes. The reader found no `items`, so it
 * iterated an empty array; the read sat inside a `try/catch` that reported every failure as
 * "interventions.json absent". The result was a diagnostic surface that reported **zero** unresolved
 * human interventions, always, and reported that zero as good news.
 *
 * The fix is not "correct the key in the reader" — that repairs one symptom and leaves the next
 * divergence to be discovered the same way. It is one exported contract that the writer *produces* and
 * the reader *parses*, so a future change to either side that breaks the other fails a type check or a
 * test instead of quietly emptying a report.
 *
 * ## Failure is not absence
 *
 * `readInterventions` distinguishes three states that were previously one:
 *
 *  - **missing** — the file is not there. Not a problem; a fresh install has no interventions.
 *  - **unreadable** — the file is there but cannot be understood. This is a **degradation** and is
 *    reported as one, because "I could not read the pauses" and "there are no pauses" are opposite
 *    facts and only one of them is safe to assume.
 *  - **ok** — the file parsed and validated.
 *
 * A caller that wants the old silent behaviour has to ask for it explicitly, which is the point.
 */

import { validateInterventionRequest, type HumanInterventionRequest } from "./intervention";

/** Bumped only when the persisted shape changes incompatibly. */
export const INTERVENTION_SCHEMA_VERSION = 1;

/** The document the guidance gate writes and the observation surface reads. */
export interface InterventionFile {
  schemaVersion: typeof INTERVENTION_SCHEMA_VERSION;
  interventions: HumanInterventionRequest[];
}

/** One unresolved pause, in the flat shape an observation surface reports. */
interface UnresolvedIntervention {
  id: string;
  taskId: string;
  kind: HumanInterventionRequest["kind"];
  /** The question the task is waiting on. Same field name as the stored request, on purpose. */
  question: string;
  blockingStepId: string;
  createdAt: string;
}

/** The three states a read can be in. Not exported: callers narrow on `.status` instead. */
type InterventionReadResult =
  | { status: "ok"; interventions: HumanInterventionRequest[] }
  | { status: "missing" }
  | { status: "unreadable"; reason: string };

/** The document for a set of requests. The one place the shape is constructed. */
export function interventionFileDocument(requests: readonly HumanInterventionRequest[]): InterventionFile {
  return { schemaVersion: INTERVENTION_SCHEMA_VERSION, interventions: [...requests] };
}

/**
 * Parse a persisted intervention document.
 *
 * Validates every entry rather than trusting the array, because a pause that cannot be understood is a
 * task that cannot be resumed and must not be dropped on the floor.
 */
export function parseInterventionFile(raw: string): InterventionReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: "unreadable", reason: `interventions.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const document = parsed as Partial<InterventionFile> | null;
  if (!document || typeof document !== "object") return { status: "unreadable", reason: "interventions.json is not an object" };
  if (document.schemaVersion !== INTERVENTION_SCHEMA_VERSION) {
    return { status: "unreadable", reason: `unsupported interventions schemaVersion ${String(document.schemaVersion)}` };
  }
  if (!Array.isArray(document.interventions)) {
    return { status: "unreadable", reason: "interventions.json carries no interventions array" };
  }
  const interventions: HumanInterventionRequest[] = [];
  for (const entry of document.interventions) {
    const request = entry as HumanInterventionRequest;
    try {
      validateInterventionRequest(request);
    } catch (error) {
      return { status: "unreadable", reason: `invalid intervention entry: ${error instanceof Error ? error.message : String(error)}` };
    }
    interventions.push(request);
  }
  return { status: "ok", interventions };
}

/**
 * The unresolved pauses, in the flat shape an observation surface reports.
 *
 * Read from the parsed document rather than re-parsing keys, so this function cannot drift from the
 * writer the way the previous reader did.
 */
export function unresolvedInterventions(result: InterventionReadResult): UnresolvedIntervention[] {
  if (result.status !== "ok") return [];
  return result.interventions
    .filter((request) => !request.resolvedAt)
    .map((request) => ({
      id: request.id,
      taskId: request.taskId,
      kind: request.kind,
      question: request.question,
      blockingStepId: request.blockingStepId,
      createdAt: request.createdAt
    }));
}
