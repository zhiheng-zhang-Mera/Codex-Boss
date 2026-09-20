/**
 * Runtime Intelligence Plane — the temporal leakage guard.
 *
 * A replay is only evidence if the advice could have been given at the time. The failure
 * this guards against is the easiest one to make by accident: let a case carry the final
 * outcome, let the advisor see the whole case, and watch it "predict" success every time.
 *
 * The guard works on the corpus's own input/target split. `atDecisionTime` is the INPUT and
 * `afterDecision` is the TARGET, so there are three concrete checks:
 *
 *   1. **Key leakage.** No field named in `AFTER_DECISION_ONLY_FIELDS` may appear in the
 *      input section, at any depth.
 *   2. **Reference leakage.** The two sections may not share an object. A builder that
 *      assigns the same object to both sections would pass a naive key check while handing
 *      the advisor the target by reference.
 *   3. **Declaration.** A case must say which fields its advice was derived from, and that
 *      declaration is checked against the same forbidden set. This is what extends the guard
 *      from the corpus to the benchmarks: a case that declares it used `finalOutcome` is
 *      `INVALID_REPLAY_CASE`, whatever the object graph looks like.
 *
 * An invalid case is never scored. It is not `SUPPORTED`, and it is excluded from every rate,
 * because a leaked case inflates whatever it is counted in.
 */

import { AFTER_DECISION_ONLY_FIELDS, type ReplayCorpusRecord } from "./replay-corpus";

export const TEMPORAL_VERDICTS = ["NO_FUTURE_INFORMATION", "INVALID_REPLAY_CASE"] as const;
export type TemporalVerdict = (typeof TEMPORAL_VERDICTS)[number];

export interface TemporalCheck {
  verdict: TemporalVerdict;
  /** Field names that only exist after the decision and were found in the input. */
  leakedFields: string[];
  reasons: string[];
}

const CLEAN: TemporalCheck = { verdict: "NO_FUTURE_INFORMATION", leakedFields: [], reasons: [] };

/** How deep the recursive key scan goes. A corpus record is shallow by construction. */
const MAX_SCAN_DEPTH = 6;

function collectKeys(value: unknown, depth = 0, into: Set<string> = new Set()): Set<string> {
  if (depth > MAX_SCAN_DEPTH || value === null || typeof value !== "object") return into;
  if (Array.isArray(value)) {
    for (const entry of value) collectKeys(entry, depth + 1, into);
    return into;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    into.add(key);
    collectKeys(entry, depth + 1, into);
  }
  return into;
}

function leakedFrom(keys: Iterable<string>): string[] {
  return [...new Set(keys)].filter((key) => AFTER_DECISION_ONLY_FIELDS.includes(key)).sort();
}

/** True when the two values share an object reference anywhere within the scan depth. */
function sharesReference(left: unknown, right: unknown): boolean {
  const seen = new Set<object>();
  const collect = (value: unknown, depth = 0): object[] => {
    if (depth > MAX_SCAN_DEPTH || value === null || typeof value !== "object") return [];
    const objects: object[] = [value as object];
    if (seen.has(value as object)) return objects;
    seen.add(value as object);
    for (const entry of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) objects.push(...collect(entry, depth + 1));
    return objects;
  };
  const rightObjects = new Set(collect(right));
  return collect(left).some((object) => rightObjects.has(object));
}

/**
 * Checks one input value for post-decision information.
 *
 * Use this on anything an advisor is given. It scans keys rather than reading values, so it
 * cannot be defeated by renaming a value or by wrapping the target in an array.
 */
export function checkInputForFutureInformation(input: unknown, options: { label?: string } = {}): TemporalCheck {
  const label = options.label ?? "input";
  const leakedFields = leakedFrom(collectKeys(input));
  if (leakedFields.length === 0) return CLEAN;
  return {
    verdict: "INVALID_REPLAY_CASE",
    leakedFields,
    reasons: [`${label} carries post-decision field(s): ${leakedFields.join(", ")}; a case that can see the outcome cannot predict it`]
  };
}

/** A declaration of what an advice was derived from, so the guard can check it. */
export interface ReplayInputDeclaration {
  /** Field names the advice was allowed to see. */
  fields: readonly string[];
  /** Optionally the actual object, which is scanned recursively as well. */
  sample?: unknown;
  label?: string;
}

export function checkReplayInput(declaration: ReplayInputDeclaration | undefined): TemporalCheck {
  if (declaration === undefined) {
    // No declaration is not a pass: without it there is no evidence the advice was made at
    // decision time, and "unproven" must not read as "clean".
    return {
      verdict: "INVALID_REPLAY_CASE",
      leakedFields: [],
      reasons: ["the case does not declare which fields its advice was derived from, so its inputs cannot be shown to be at-decision-time"]
    };
  }
  const reasons: string[] = [];
  const leakedFields = leakedFrom([...declaration.fields, ...collectKeys(declaration.sample)]);
  if (leakedFields.length > 0) {
    reasons.push(`${declaration.label ?? "the advice"} declared or carried post-decision field(s): ${leakedFields.join(", ")}`);
  }
  if (leakedFields.length === 0) return CLEAN;
  return { verdict: "INVALID_REPLAY_CASE", leakedFields, reasons };
}

/**
 * Checks a whole corpus record: key leakage inside the input section, and reference leakage
 * between the two sections.
 */
export function checkCorpusRecord(record: ReplayCorpusRecord): TemporalCheck {
  const reasons: string[] = [];
  const leakedFields = leakedFrom(collectKeys(record.atDecisionTime));
  if (leakedFields.length > 0) {
    reasons.push(`atDecisionTime carries post-decision field(s): ${leakedFields.join(", ")}`);
  }
  if (sharesReference(record.atDecisionTime, record.afterDecision)) {
    reasons.push("atDecisionTime and afterDecision share an object, so the input reaches the target by reference");
  }
  // The record id and task identity are known at decision time; the outcome sections are not.
  if (leakedFields.length === 0 && reasons.length === 0) return CLEAN;
  return { verdict: "INVALID_REPLAY_CASE", leakedFields, reasons };
}

/** Checks every record, so one bad export cannot silently poison a benchmark. */
export function checkCorpus(records: readonly ReplayCorpusRecord[]): { valid: ReplayCorpusRecord[]; invalid: Array<{ recordId: string; check: TemporalCheck }> } {
  const valid: ReplayCorpusRecord[] = [];
  const invalid: Array<{ recordId: string; check: TemporalCheck }> = [];
  for (const record of records) {
    const check = checkCorpusRecord(record);
    if (check.verdict === "NO_FUTURE_INFORMATION") valid.push(record);
    else invalid.push({ recordId: record.recordId, check });
  }
  return { valid, invalid };
}

/** Throws on a leak. For a builder that must not emit a tainted record at all. */
export function assertNoFutureInformation(input: unknown, label?: string): void {
  const check = checkInputForFutureInformation(input, label === undefined ? {} : { label });
  if (check.verdict === "INVALID_REPLAY_CASE") throw new Error(`temporal leakage: ${check.reasons.join("; ")}`);
}
