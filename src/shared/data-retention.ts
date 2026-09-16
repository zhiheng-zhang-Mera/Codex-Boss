/**
 * Data retention classes and garbage collection (platform foundation, Phase 04 Tasks D and E).
 *
 * The five classes the book names, each with its own retention and permissions, and a GC that can
 * only ever delete what a dry-run already listed.
 *
 * ## Why this is a new module rather than a change to `data-lifecycle.ts`
 *
 * `src/shared/data-lifecycle.ts` already exists and is IN USE: it defines an L0–L4 tier vocabulary
 * and a storage budget policy the electron side applies to the real `AppSnapshot` arrays, including
 * a hard rule that Boss never destructively prunes completed-task history without explicit user
 * consent. Rewriting it to the book's five classes would either change that behaviour or leave two
 * half-merged vocabularies, so Phase 04 adds the book's classes alongside it. A later phase can
 * decide whether the two should converge; doing it here would be the "half old structure, half new,
 * no compatibility layer" state the engineering book forbids.
 *
 * ## The parity rule, which is the point of the whole module
 *
 * `planCollection` produces candidates; `applyCollection` deletes. `applyCollection` CALLS
 * `planCollection` rather than re-deriving, so the deletion report cannot disagree with the dry-run
 * — the book requires them to correspond item by item, and the cheapest way to guarantee a
 * correspondence is to not have two implementations that could drift. Every dry-run candidate gets
 * an audit entry, and one that was not deleted says why.
 *
 * ## What can never be deleted
 *
 * Two independent guards, because they protect different things:
 *
 *  - a PROTECTED class (owner, security and audit evidence) is not deletable AT ALL — it is a
 *    property of the vocabulary, so no age rule and no caller can reach it;
 *  - an active record, or one another record still references, is spared by a separate check, so a
 *    record that is not protected by class is still kept while something depends on it.
 *
 * ## What this deliberately does not do
 *
 * It does not touch the filesystem. The caller supplies records and an injected deleter, so the
 * policy is testable without a disk and the actual removal is one auditable call the caller owns.
 */

/** The five classes. */
export const DATA_CLASSES = ["HOT", "WARM", "COLD", "DISPOSABLE", "PROTECTED"] as const;
type DataClass = (typeof DATA_CLASSES)[number];

interface RetentionRule {
  dataClass: DataClass;
  /** Days after which a record becomes collectable. `null` = never by age. */
  retentionDays: number | null;
  compressible: boolean;
  dedupable: boolean;
  archivable: boolean;
  /** Whether the class may be deleted AT ALL. `false` for PROTECTED, as an invariant. */
  deletable: boolean;
  why: string;
}

/**
 * The rules.
 *
 * `PROTECTED.deletable` is `false` and its window is `null`, which together mean no age and no
 * policy can make one collectable. That is the encoding of "deletion must not remove evidence the
 * owner, security or an audit requires" — a property of the vocabulary rather than a check a caller
 * could forget.
 */
export const RETENTION_RULES: Record<DataClass, RetentionRule> = {
  HOT: {
    dataClass: "HOT",
    retentionDays: null,
    compressible: false,
    dedupable: false,
    archivable: false,
    deletable: false,
    why: "the active working set: age says nothing about whether in-flight work is still needed, and deleting it would destroy work in progress"
  },
  WARM: {
    dataClass: "WARM",
    retentionDays: 90,
    compressible: true,
    dedupable: true,
    archivable: true,
    deletable: true,
    why: "recent history, which stays useful while recent and compresses well once it is not"
  },
  COLD: {
    dataClass: "COLD",
    retentionDays: 365,
    compressible: true,
    dedupable: true,
    archivable: true,
    deletable: true,
    why: "archived evidence and artifacts: kept for lineage, so it is archived or compacted long before it is deleted"
  },
  DISPOSABLE: {
    dataClass: "DISPOSABLE",
    retentionDays: 7,
    compressible: false,
    dedupable: true,
    archivable: false,
    deletable: true,
    why: "screenshots, temporary build output, transient logs and caches: the first thing to reclaim, because no lineage depends on it"
  },
  PROTECTED: {
    dataClass: "PROTECTED",
    retentionDays: null,
    compressible: false,
    dedupable: false,
    archivable: true,
    deletable: false,
    why: "owner, security and audit evidence: retention policy must not be able to destroy it, so it is not deletable by any route"
  }
};

/**
 * Markers that put a record in PROTECTED.
 *
 * Deliberately over-inclusive. A false PROTECTED costs storage; a false DISPOSABLE destroys
 * evidence, and those two mistakes are not equally bad, so the ambiguity resolves toward keeping.
 */
const PROTECTED_MARKERS: readonly string[] = [
  "owner",
  "audit",
  "secret",
  "credential",
  "security",
  "trust-policy",
  "attestation",
  "root-",
  "acceptance-evidence",
  "evidence/",
  // This program's own acceptance artifacts. Their paths carry no generic evidence word, so without
  // naming them explicitly a GC pass would classify the phase reports as ordinary warm history and
  // eventually collect the very records the phases are graded on.
  "platform-foundation"
];

/** Markers that put a record in DISPOSABLE. */
const DISPOSABLE_MARKERS: readonly string[] = ["screenshot", "temp", "tmp", "cache", "thumbnail", "preview", "scratch", ".log", "build-output", "dist/"];

/**
 * One thing that exists and costs storage.
 *
 * Exported because callers build the corpus they hand to `planCollection`, and a test names it.
 */
export interface DataRecord {
  id: string;
  /** What sort of thing it is, e.g. `screenshot`, `task`, `evidence`. */
  kind: string;
  /** Repo- or data-root-relative POSIX path, when the record has one. */
  path?: string;
  bytes: number;
  updatedAt: string;
  /** Whether something is still using it. Active is never collectable. */
  active?: boolean;
  /** Ids of records that reference this one. Referenced is never collectable. */
  referencedBy?: readonly string[];
  /** A caller-supplied class wins over the markers. */
  dataClass?: DataClass;
}

/**
 * Which class a record belongs to. Deterministic, and deliberately coarse.
 *
 * Without a caller-supplied class the answer comes from the markers alone, plus age for the middle
 * band — so the classification is a property of what the record IS rather than of when it was last
 * touched. Age decides between WARM and COLD; it never decides between deletable and protected,
 * because that distinction must not be a function of a clock.
 */
export function classifyData(record: DataRecord, now: string): DataClass {
  if (record.dataClass) return record.dataClass;
  const haystack = `${record.kind} ${record.path ?? ""}`.toLowerCase();
  // PROTECTED first: if a record could be read either way, the safe reading wins.
  if (PROTECTED_MARKERS.some((marker) => haystack.includes(marker))) return "PROTECTED";
  if (record.active) return "HOT";
  if (DISPOSABLE_MARKERS.some((marker) => haystack.includes(marker))) return "DISPOSABLE";
  return ageInDays(record.updatedAt, now) > 90 ? "COLD" : "WARM";
}

function ageInDays(updatedAt: string, now: string): number {
  const updated = Date.parse(updatedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(updated) || !Number.isFinite(current)) return 0;
  return Math.max(0, current - updated) / 86400000;
}

/** One collectable record, with the reason and what it would free. */
interface GcCandidate {
  id: string;
  dataClass: DataClass;
  bytes: number;
  reason: string;
  cause: "age" | "duplicate";
  /** For a duplicate, the id of the copy being kept. */
  keptId?: string;
}

/** A record that was considered and why it was spared. */
interface GcSpared {
  id: string;
  dataClass: DataClass;
  reason: string;
}

interface GcPlan {
  at: string;
  candidates: GcCandidate[];
  spared: GcSpared[];
  /** Bytes the candidates would release. An estimate until the execution runs. */
  reclaimableBytes: number;
  countsByClass: Record<DataClass, number>;
}

interface GcOptions {
  now: string;
  records: readonly DataRecord[];
  /** Collapse exact duplicates within a class, keeping the newest. */
  dedupe?: boolean;
}

/**
 * Build the collection plan.
 *
 * The ONLY place candidacy is decided. `applyCollection` calls this rather than re-deriving, which
 * is what makes the dry-run and the execution correspond by construction.
 */
export function planCollection(options: GcOptions): GcPlan {
  const { now, records } = options;
  const candidates: GcCandidate[] = [];
  const spared: GcSpared[] = [];
  const countsByClass: Record<DataClass, number> = { HOT: 0, WARM: 0, COLD: 0, DISPOSABLE: 0, PROTECTED: 0 };

  for (const record of records) {
    const dataClass = classifyData(record, now);
    countsByClass[dataClass]++;
    const rule = RETENTION_RULES[dataClass];

    // Guard 1: the class is not deletable at all. Checked first, so no age rule and no duplicate
    // rule can reach a protected record.
    if (!rule.deletable) {
      spared.push({ id: record.id, dataClass, reason: `the ${dataClass} class is not deletable: ${rule.why}` });
      continue;
    }
    // Guard 2: something still depends on it. Separate from the class guard, because being active
    // is about use rather than about kind.
    if (record.active) {
      spared.push({ id: record.id, dataClass, reason: "the record is active" });
      continue;
    }
    if ((record.referencedBy ?? []).length > 0) {
      spared.push({ id: record.id, dataClass, reason: `still referenced by ${(record.referencedBy ?? []).length} record(s)` });
      continue;
    }
    // Guard 3: the retention window. A class with no window keeps everything.
    if (rule.retentionDays === null) {
      spared.push({ id: record.id, dataClass, reason: `the ${dataClass} class has no retention window` });
      continue;
    }
    const age = ageInDays(record.updatedAt, now);
    if (age > rule.retentionDays) {
      candidates.push({
        id: record.id,
        dataClass,
        bytes: record.bytes,
        cause: "age",
        reason: `${age.toFixed(1)} days old, past the ${rule.retentionDays}-day window for ${dataClass}`
      });
    }
  }

  if (options.dedupe) {
    // Duplicates are keyed on class+kind+path+bytes, so "the same file twice" is detectable without
    // reading content. The newest copy is kept and its id recorded, so the decision is legible
    // rather than implicit in a set difference.
    const byKey = new Map<string, DataRecord[]>();
    for (const record of records) {
      const dataClass = classifyData(record, now);
      if (!RETENTION_RULES[dataClass].dedupable) continue;
      if (record.active || (record.referencedBy ?? []).length > 0) continue;
      const key = `${dataClass}|${record.kind}|${record.path ?? record.id}|${record.bytes}`;
      byKey.set(key, [...(byKey.get(key) ?? []), record]);
    }
    const alreadyCandidate = new Set(candidates.map((candidate) => candidate.id));
    for (const group of byKey.values()) {
      if (group.length < 2) continue;
      const ordered = [...group].sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : left.id < right.id ? -1 : 1));
      const keep = ordered[0];
      for (const duplicate of ordered.slice(1)) {
        if (alreadyCandidate.has(duplicate.id)) continue;
        candidates.push({
          id: duplicate.id,
          dataClass: classifyData(duplicate, now),
          bytes: duplicate.bytes,
          cause: "duplicate",
          keptId: keep.id,
          reason: `an exact duplicate of ${keep.id} (same kind, path and size), which is kept`
        });
      }
    }
  }

  return {
    at: now,
    candidates: candidates.sort((left, right) => (left.id < right.id ? -1 : 1)),
    spared: spared.sort((left, right) => (left.id < right.id ? -1 : 1)),
    reclaimableBytes: candidates.reduce((total, candidate) => total + candidate.bytes, 0),
    countsByClass
  };
}

/** One audit entry per candidate, which is what makes the GC reviewable afterwards. */
interface GcAuditEntry {
  at: string;
  recordId: string;
  dataClass: DataClass;
  bytes: number;
  outcome: "DELETED" | "FAILED" | "NOT_SUPPLIED";
  detail: string;
}

interface GcExecutionReport {
  at: string;
  /** The plan this execution followed, so the two can be compared rather than assumed to match. */
  plan: GcPlan;
  audit: GcAuditEntry[];
  deleted: number;
  failed: number;
  reclaimedBytes: number;
}

interface GcApplyOptions extends GcOptions {
  /** Removes one record. Injected, so the policy is testable without a disk. */
  delete: (record: DataRecord) => void;
  /**
   * A plan to execute instead of recomputing one from `records`.
   *
   * Supplied when the plan was reviewed and approved before the execution, which is the whole point
   * of a dry run: the approved plan is what gets executed, and any record it named that is no longer
   * available is reported rather than quietly dropped from the difference.
   */
  plan?: GcPlan;
}

/**
 * Execute a plan.
 *
 * Per item: every candidate gets an audit entry whether it succeeded or not, and a candidate that
 * was not deleted carries the reason. Nothing outside the plan is ever handed to the deleter, which
 * is what makes "the dry-run and the execution correspond item by item" a property of the code
 * rather than a promise in a comment.
 */
export function applyCollection(options: GcApplyOptions): GcExecutionReport {
  const plan = options.plan ?? planCollection({ now: options.now, records: options.records, ...(options.dedupe === undefined ? {} : { dedupe: options.dedupe }) });
  const byId = new Map(options.records.map((record) => [record.id, record]));
  const audit: GcAuditEntry[] = [];
  let deleted = 0;
  let failed = 0;
  let reclaimedBytes = 0;

  for (const candidate of plan.candidates) {
    const record = byId.get(candidate.id);
    if (!record) {
      // The plan named a record the caller did not supply. Reported rather than skipped silently:
      // an execution that deleted less than its dry-run promised has to say so.
      audit.push({ at: options.now, recordId: candidate.id, dataClass: candidate.dataClass, bytes: candidate.bytes, outcome: "NOT_SUPPLIED", detail: "the record was not supplied to the execution, so it could not be deleted" });
      continue;
    }
    try {
      options.delete(record);
      deleted++;
      reclaimedBytes += candidate.bytes;
      audit.push({ at: options.now, recordId: candidate.id, dataClass: candidate.dataClass, bytes: candidate.bytes, outcome: "DELETED", detail: candidate.reason });
    } catch (error) {
      failed++;
      audit.push({
        at: options.now,
        recordId: candidate.id,
        dataClass: candidate.dataClass,
        bytes: candidate.bytes,
        outcome: "FAILED",
        detail: `the deleter threw: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  return { at: options.now, plan, audit, deleted, failed, reclaimedBytes };
}

/**
 * Whether a dry-run and an execution correspond item by item.
 *
 * Exported so a test can assert the property directly over an adversarial corpus, and so a caller
 * can verify a persisted pair of reports rather than trusting that two runs agreed.
 */
export function plansCorrespond(report: GcExecutionReport): { correspond: boolean; problems: string[] } {
  const problems: string[] = [];
  const planIds = report.plan.candidates.map((candidate) => candidate.id).sort();
  const auditedIds = report.audit.map((entry) => entry.recordId).sort();
  if (planIds.join(",") !== auditedIds.join(",")) {
    problems.push(`the plan named ${planIds.length} candidate(s) and the audit covers ${auditedIds.length}`);
  }
  const audited = new Set(report.audit.map((entry) => entry.recordId));
  for (const id of planIds) if (!audited.has(id)) problems.push(`${id} was a candidate but has no audit entry`);
  for (const entry of report.audit) if (!planIds.includes(entry.recordId)) problems.push(`${entry.recordId} was audited but was not a candidate`);
  return { correspond: problems.length === 0, problems };
}

/**
 * A compaction summary.
 *
 * Produces an INDEX over a set of claims and never touches the claims themselves, which is the
 * book's rule: compaction may summarise and must not destroy the evidence it summarises.
 * `sourceIds` is what makes that checkable — a summary that could not name its sources would be a
 * replacement rather than an index.
 */
export interface CompactionSummary {
  id: string;
  subject: string;
  /** The claim ids it covers. Never empty. */
  sourceIds: string[];
  text: string;
  createdAt: string;
}

export function buildCompactionSummary(input: { id: string; subject: string; claims: ReadonlyArray<{ id: string; claim: string }>; at: string }): CompactionSummary {
  if (input.claims.length === 0) {
    throw new Error("a compaction summary needs at least one source claim; summarising nothing would create an unsourced claim");
  }
  return {
    id: input.id,
    subject: input.subject,
    sourceIds: input.claims.map((claim) => claim.id),
    // A concatenation rather than a model call: the summary must be reproducible from its sources,
    // and a generated one could not be.
    text: input.claims.map((claim) => `- ${claim.claim}`).join("\n"),
    createdAt: input.at
  };
}
