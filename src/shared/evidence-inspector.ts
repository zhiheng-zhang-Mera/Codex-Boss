/**
 * Host-M P5 — Evidence / Artifact Inspector (pure contract).
 *
 * The inspector is read-only in the strict sense: it opens files, hashes them and
 * reports what it found. It never rewrites an artifact, never "fixes" a name and
 * never repairs a manifest, because an evidence tree that the inspector can edit
 * is no longer evidence.
 *
 * Where it finds a problem it reports the problem:
 *
 * - `orphan`      a file sits in a phase's evidence directory but is not
 *                 referenced by any document that should cite it
 * - `invalid`     a JSON evidence file does not parse
 * - `unexpected`  a file that is neither referenced nor even plausible evidence
 * - `dangling`    a reference in a document points at a file that does not exist
 *
 * `checksum` validation is the one thing the inspector *can* do that a plain
 * listing cannot: it stores a hash per file and compares trees hashes-first, so
 * "same name, different content" cannot pass as unchanged.
 */

export const EVIDENCE_KINDS = [
  "acceptance-evidence",
  "research-artifact",
  "task-artifact",
  "log",
  "checkpoint",
  "episode-record",
  "knowledge-provenance",
  "manifest",
  "report",
  "other"
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_ISSUES = ["orphan", "invalid", "unexpected", "dangling"] as const;
export type EvidenceIssueKind = (typeof EVIDENCE_ISSUES)[number];

export interface EvidenceIssue {
  kind: EvidenceIssueKind;
  path: string;
  detail: string;
}

export interface EvidenceRecord {
  /** Path relative to the inspected root, always with forward slashes. */
  path: string;
  kind: EvidenceKind;
  bytes: number;
  modifiedAt: string;
  /** sha256 of the file contents; the identity the comparison uses. */
  sha256: string;
  /** JSON parse outcome for .json artifacts. */
  jsonValid?: boolean;
  /** Declared status found in the file, when it declares one. */
  declaredStatus?: string;
  /** Phase/program directory this artifact belongs to, when it has one. */
  phase?: string;
  /**
   * Whether a document that should cite this artifact does cite it. `undefined`
   * means the question does not apply (nothing claims to reference it).
   */
  referenced?: boolean;
  /**
   * Paths this artifact itself references (for provenance tracing).
   */
  references?: string[];
}

export interface EvidenceQuery {
  kind?: EvidenceKind;
  /** Substring match against the relative path, case-insensitive. */
  contains?: string;
  /** Files modified at or after this ISO timestamp. */
  modifiedFrom?: string;
  /** Files modified at or before this ISO timestamp. */
  modifiedTo?: string;
  /** Only entries with a declared status. */
  withStatus?: string;
  referenced?: boolean;
  /** Only entries at least this many bytes. */
  minBytes?: number;
}

export interface EvidenceInspection {
  schemaVersion: 1;
  kind: "HOST_EVIDENCE_INSPECTION";
  generatedAt: string;
  root: string;
  /** Every artifact the inspector found, sorted by path. */
  records: EvidenceRecord[];
  issues: EvidenceIssue[];
  summary: {
    files: number;
    bytes: number;
    byKind: Record<string, number>;
    orphans: number;
    invalidJson: number;
    unexpected: number;
    dangling: number;
  };
  /** Whether the inspection itself was degraded, and why. */
  degraded: string[];
}

export function emptyEvidenceInspection(root: string, generatedAt: string): EvidenceInspection {
  return {
    schemaVersion: 1,
    kind: "HOST_EVIDENCE_INSPECTION",
    generatedAt,
    root,
    records: [],
    issues: [],
    summary: { files: 0, bytes: 0, byKind: {}, orphans: 0, invalidJson: 0, unexpected: 0, dangling: 0 },
    degraded: []
  };
}

/** Forward-slashed relative path, so comparisons are host-independent. */
export function normalizeEvidencePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Classifies an artifact from its path and content shape.
 *
 * The rules are explicit rather than clever: a path convention this repository
 * already follows decides most cases, and only when the path says nothing does
 * the content get a say.
 */
export function classifyEvidence(path: string, options: { jsonContent?: unknown } = {}): EvidenceKind {
  const normalized = normalizeEvidencePath(path).toLowerCase();
  const segments = normalized.split("/");

  if (/\.(log|txt)$/.test(normalized) && segments.includes("logs")) return "log";
  if (/(^|\/)(heartbeat|soak|.*-soak.*)\.json$/.test(normalized)) return "report";
  if (/(^|\/)checkpoints?(\/|$)/.test(normalized) || /checkpoints\/\d{8}\.json$/.test(normalized)) return "checkpoint";
  if (/episodes\.jsonl$|revisions\.jsonl$/.test(normalized)) return "episode-record";
  if (/(^|\/)manuscript(\/|$)/.test(normalized)) return "knowledge-provenance";
  // Research evidence is distinguished before the generic evidence rule: a
  // research run's artifact tree lives under an evidence directory too, and
  // calling it "acceptance evidence" would misdescribe what it proves.
  if (/(^|\/)research(\/|$)/.test(normalized)) return "research-artifact";
  if (/(^|\/)evidence(\/|$)/.test(normalized)) return "acceptance-evidence";
  if (/(^|\/)manifest[^/]*\.json$|requirement-manifest\.json$/.test(normalized)) return "manifest";
  if (/\.json$/.test(normalized) && isStatusBearing(options.jsonContent)) return "acceptance-evidence";
  if (/\.(json|jsonl)$/.test(normalized)) return "report";
  if (/\.(log)$/.test(normalized)) return "log";
  return "other";
}

/** An evidence file that declares a status is an acceptance claim. */
export function isStatusBearing(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.status === "string" || typeof record.overall === "string";
}

/** Reads the declared status out of an evidence file, if it declares one. */
export function declaredStatusOf(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.status === "string") return record.status;
  if (typeof record.overall === "string") return record.overall;
  return undefined;
}

/**
 * Strings inside a JSON document that look like repo-relative artifact paths.
 * Used for provenance tracing: which evidence cites which other evidence.
 */
export function referencesIn(value: unknown, options: { maxDepth?: number } = {}): string[] {
  const found = new Set<string>();
  const maxDepth = options.maxDepth ?? 12;
  const visit = (node: unknown, depth: number): void => {
    if (depth > maxDepth || node === null || node === undefined) return;
    if (typeof node === "string") {
      if (looksLikeArtifactPath(node)) found.add(normalizeEvidencePath(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const entry of Object.values(node as Record<string, unknown>)) visit(entry, depth + 1);
    }
  };
  visit(value, 0);
  return [...found].sort();
}

function looksLikeArtifactPath(value: string): boolean {
  if (value.length > 400 || value.includes("\n")) return false;
  if (/^[a-z]+:\/\//i.test(value)) return false;
  // A path has no whitespace inside any one segment. Without this, a sentence
  // that happens to contain an extension ("… node scripts/host-acceptance.cjs
  // completed the whole surface …") is read as a citation, and the inspector then
  // reports a dangling reference to prose.
  const normalized = normalizeEvidencePath(value);
  if (!normalized.includes("/")) return false;
  if (/[\s]/.test(normalized)) return false;
  return /\.(json|jsonl|md|cjs|mjs|ts|log|png|txt|exe|bin|zip)$/i.test(normalized);
}

/**
 * Phase directories are derived from the path itself, so the inspector does not
 * need a hard-coded map of every plan: a directory named like a phase (`P1`,
 * `10A`, `round-6`, `r901`) or sitting under `evidence/` is one.
 */
export function phaseOf(path: string): string | undefined {
  const normalized = normalizeEvidencePath(path);
  const segments = normalized.split("/");
  const index = segments.findIndex((segment) => /^(evidence|artifacts?)$/i.test(segment));
  if (index === -1) {
    const phase = segments.slice(0, -1).find((segment) => /^(P\d{1,2}|10[A-Z]|round-\d+|[a-z]\d{3})$/i.test(segment));
    return phase;
  }
  return segments[index + 1];
}

export function matchesQuery(record: EvidenceRecord, query: EvidenceQuery): boolean {
  if (query.kind && record.kind !== query.kind) return false;
  if (query.contains && !record.path.toLowerCase().includes(query.contains.toLowerCase())) return false;
  if (query.modifiedFrom && record.modifiedAt < query.modifiedFrom) return false;
  if (query.modifiedTo && record.modifiedAt > query.modifiedTo) return false;
  if (query.withStatus && record.declaredStatus !== query.withStatus) return false;
  if (query.referenced !== undefined && record.referenced !== query.referenced) return false;
  if (query.minBytes !== undefined && record.bytes < query.minBytes) return false;
  return true;
}

export function queryEvidence(records: readonly EvidenceRecord[], query: EvidenceQuery = {}): EvidenceRecord[] {
  return records.filter((record) => matchesQuery(record, query));
}

export function summarizeEvidence(records: readonly EvidenceRecord[], issues: readonly EvidenceIssue[]): EvidenceInspection["summary"] {
  const byKind: Record<string, number> = {};
  let bytes = 0;
  for (const record of records) {
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    bytes += record.bytes;
  }
  return {
    files: records.length,
    bytes,
    byKind,
    orphans: issues.filter((issue) => issue.kind === "orphan").length,
    invalidJson: issues.filter((issue) => issue.kind === "invalid").length,
    unexpected: issues.filter((issue) => issue.kind === "unexpected").length,
    dangling: issues.filter((issue) => issue.kind === "dangling").length
  };
}

/**
 * The anchors a citation may be written against. Evidence documents in this
 * repository legitimately use all of them, so all are tried before a reference is
 * called dangling.
 */
export interface ReferenceAnchors {
  /** Paths that exist inside the inspected tree. */
  knownPaths: ReadonlySet<string>;
  /**
   * Confirms whether a repository-relative path exists. Used for citations that
   * point outside the inspected tree (a script, a source file, another program's
   * evidence). A predicate rather than a set because enumerating a whole
   * repository is both expensive and easy to get wrong — an earlier version
   * walked the tree under a file budget and silently stopped before reaching the
   * directory the citations actually named.
   */
  exists?: (relativePath: string) => boolean;
  /** Prefixes whose references are not judged at all. */
  exemptPrefixes?: readonly string[];
}

export interface ResolvedReferences {
  /** Inspected-tree paths that something cites. */
  cited: ReadonlySet<string>;
  issues: EvidenceIssue[];
}

const DEFAULT_EXEMPT_PREFIXES = ["node_modules/", "artifacts/", "runtime-data/"];

/**
 * Resolves every reference: against the inspected root, against the citing
 * document's own directory, and against the wider repository. Anything left
 * unresolved is a dangling reference.
 */
export function resolveReferences(records: readonly EvidenceRecord[], anchors: ReferenceAnchors): ResolvedReferences {
  const exempt = anchors.exemptPrefixes ?? DEFAULT_EXEMPT_PREFIXES;
  const cited = new Set<string>();
  const issues: EvidenceIssue[] = [];
  for (const record of records) {
    for (const reference of record.references ?? []) {
      if (exempt.some((prefix) => reference.startsWith(prefix))) continue;
      const candidates = [reference, siblingPath(record.path, reference)].filter((value): value is string => Boolean(value));
      const matched = candidates.find((candidate) => anchors.knownPaths.has(candidate));
      if (matched) {
        cited.add(matched);
        continue;
      }
      if (anchors.exists && candidates.some((candidate) => anchors.exists!(candidate))) continue;
      issues.push({
        kind: "dangling",
        path: record.path,
        detail: `references ${reference}, which resolves against neither the inspected root, its own directory, nor the repository`
      });
    }
  }
  return { cited, issues };
}

export function findDanglingReferences(records: readonly EvidenceRecord[], anchors: ReferenceAnchors): EvidenceIssue[] {
  return resolveReferences(records, anchors).issues;
}

/**
 * A reference resolved relative to the citing document's directory, or undefined
 * when the reference escapes that directory.
 */
export function siblingPath(fromPath: string, reference: string): string | undefined {
  const from = normalizeEvidencePath(fromPath).split("/").slice(0, -1);
  const segments = reference.split("/");
  const resolved: string[] = [...from];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (!resolved.length) return undefined;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}

/**
 * Orphans: an evidence file that is not cited by any document that should cite
 * it. A record the inspection already found cited is never reported as an orphan,
 * so the caller's citation set and the per-record finding cannot disagree.
 */
export function findOrphans(
  records: readonly EvidenceRecord[],
  options: { cited: ReadonlySet<string>; onlyKinds?: readonly EvidenceKind[] } = { cited: new Set() }
): EvidenceIssue[] {
  const kinds = new Set(options.onlyKinds ?? ["acceptance-evidence", "report", "research-artifact", "task-artifact", "manifest"]);
  return records
    .filter((record) => kinds.has(record.kind))
    .filter((record) => record.referenced !== true)
    .filter((record) => !options.cited.has(record.path))
    .map((record) => ({ kind: "orphan" as const, path: record.path, detail: `no document in the inspected root cites ${record.path}` }));
}

/** Two records have the same identity only when the bytes match. */
export function sameArtifact(left: EvidenceRecord, right: EvidenceRecord): boolean {
  return left.sha256 === right.sha256 && left.bytes === right.bytes;
}

export interface EvidenceComparisonEntry {
  path: string;
  change: "UNCHANGED" | "MODIFIED" | "ADDED" | "REMOVED";
  detail: string;
}

/**
 * Compares two inspections hashes-first. A same-named file with different bytes
 * is MODIFIED, which a name-and-size listing would have called unchanged.
 */
export function compareEvidence(baseline: EvidenceInspection, candidate: EvidenceInspection): EvidenceComparisonEntry[] {
  const before = new Map(baseline.records.map((record) => [record.path, record]));
  const after = new Map(candidate.records.map((record) => [record.path, record]));
  const entries: EvidenceComparisonEntry[] = [];
  for (const [path, record] of before) {
    const now = after.get(path);
    if (!now) {
      entries.push({ path, change: "REMOVED", detail: `was ${record.bytes} bytes (${record.kind})` });
      continue;
    }
    if (record.sha256 !== now.sha256) {
      entries.push({ path, change: "MODIFIED", detail: `${record.sha256.slice(0, 12)}… -> ${now.sha256.slice(0, 12)}…` });
      continue;
    }
    entries.push({ path, change: "UNCHANGED", detail: `${now.bytes} bytes` });
  }
  for (const [path, record] of after) {
    if (!before.has(path)) entries.push({ path, change: "ADDED", detail: `${record.bytes} bytes (${record.kind})` });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function renderEvidenceInspection(inspection: EvidenceInspection): string {
  const lines = [
    `Host-M evidence inspector — ${inspection.summary.files} file(s), ${(inspection.summary.bytes / 1024).toFixed(1)} KiB`,
    `root: ${inspection.root}`,
    `kinds: ${Object.entries(inspection.summary.byKind).map(([kind, count]) => `${kind}=${count}`).join(", ") || "none"}`,
    `issues: ${inspection.issues.length} (orphan ${inspection.summary.orphans}, invalid ${inspection.summary.invalidJson}, unexpected ${inspection.summary.unexpected}, dangling ${inspection.summary.dangling})`
  ];
  for (const issue of inspection.issues) lines.push(`  ${issue.kind.toUpperCase().padEnd(11)} ${issue.path}  ${issue.detail}`);
  for (const entry of inspection.degraded) lines.push(`  DEGRADED    ${entry}`);
  return lines.join("\n");
}
