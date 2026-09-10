import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  classifyEvidence,
  compareEvidence,
  declaredStatusOf,
  emptyEvidenceInspection,
  findDanglingReferences,
  findOrphans,
  normalizeEvidencePath,
  phaseOf,
  referencesIn,
  resolveReferences,
  siblingPath,
  summarizeEvidence,
  type EvidenceComparisonEntry,
  type EvidenceInspection,
  type EvidenceIssue,
  type EvidenceRecord
} from "../../src/shared/evidence-inspector";

/**
 * Host-M P5 — the evidence/artifact inspector.
 *
 * READ-ONLY. It opens files, hashes them and reads their JSON. There is no code
 * path in this module that writes, renames or repairs anything: an inspector that
 * can edit the evidence it inspects is not an inspector.
 *
 * Scope control matters more than cleverness here. This repository holds a large
 * amount of historical evidence, so scanning is bounded by (a) a maximum file
 * size, (b) a maximum file count, and (c) an explicit skip list of dependency and
 * build directories. When a bound is hit the inspection says so in `degraded`
 * instead of silently reporting a smaller tree as if it were the whole one.
 */

export interface InspectEvidenceOptions {
  root: string;
  /**
   * Repository root, used so a citation to a file that exists outside the
   * inspected tree (a script, a source file) is not reported as dangling.
   */
  repoRoot?: string;
  /** Directories never descended into, relative to the root. */
  skipDirectories?: readonly string[];
  /** Only inspect these subdirectories (relative to the root). */
  include?: readonly string[];
  /** Files larger than this are recorded but not hashed in full. */
  maxFileBytes?: number;
  /** Stop after this many files, recording the truncation as degraded. */
  maxFiles?: number;
  now?: () => string;
  /**
   * When false, an evidence file that no document in the inspected tree cites is
   * not reported as an orphan. This is the honest default for a bounded scan of
   * one program: the documents that cite it may simply be outside the scan.
   */
  reportOrphans?: boolean;
}

const DEFAULT_SKIP = ["node_modules", ".git", "dist", "dist-electron", "coverage", ".cache", "history", "runtime-data", "Session Data"];
const DEFAULT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5_000;

/** Directories whose contents are machine noise rather than evidence. */
function isSkipped(relative: string, skip: readonly string[]): boolean {
  const segments = normalizeEvidencePath(relative).split("/");
  return segments.some((segment) => skip.includes(segment));
}

function walk(root: string, options: { skip: readonly string[]; include?: readonly string[]; maxFiles: number }): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const visit = (directory: string): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      if (files.length >= options.maxFiles) return false;
      const absolute = path.join(directory, entry.name);
      const relative = normalizeEvidencePath(path.relative(root, absolute));
      if (isSkipped(relative, options.skip)) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (options.include?.length) {
          const included = options.include.some((prefix) => relative === prefix || relative.startsWith(`${prefix}/`) || prefix.startsWith(`${relative}/`));
          if (!included) continue;
        }
        if (!visit(absolute)) return false;
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(relative);
    }
    return true;
  };
  const complete = visit(root);
  return { files: files.sort(), truncated: !complete };
}

function hashFile(file: string): { sha256: string; bytes: number; hashed: boolean } {
  try {
    const buffer = fs.readFileSync(file);
    return { sha256: createHash("sha256").update(buffer).digest("hex"), bytes: buffer.length, hashed: true };
  } catch {
    return { sha256: "unreadable", bytes: 0, hashed: false };
  }
}

/**
 * Repository-relative existence check, so a citation to a script, a source file
 * or another program's evidence is not mistaken for a dangling evidence
 * reference. Direct `existsSync` calls rather than a tree walk: enumerating the
 * repository is expensive and, under any file budget, silently incomplete — an
 * earlier version stopped before reaching the directory that the citations
 * actually named and reported them all as dangling.
 */
function makeRepoExists(root: string, repoRoot: string | undefined): ((relativePath: string) => boolean) | undefined {
  if (!repoRoot || path.resolve(repoRoot) === path.resolve(root)) return undefined;
  const base = path.resolve(repoRoot);
  return (relativePath: string) => {
    if (!relativePath || relativePath.includes("\0")) return false;
    const absolute = path.resolve(base, relativePath);
    // Never resolve outside the repository.
    if (absolute !== base && !absolute.startsWith(base + path.sep)) return false;
    try {
      return fs.existsSync(absolute);
    } catch {
      return false;
    }
  };
}

/**
 * Reads an artifact's own claims: its declared status and the paths it cites.
 * Binary and oversized payloads are hashed but not parsed, and that is recorded.
 *
 * A UTF-8 BOM is stripped before parsing. The closure program's own report
 * generator learned this the hard way (`closure-acceptance-report.mjs` strips
 * `\uFEFF`), and 44 evidence files in this repository are written with a BOM —
 * reporting all of them as "invalid JSON" would be a false alarm that buries the
 * genuinely malformed files.
 */
function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function readArtifact(file: string, options: { maxFileBytes: number }): { jsonValid?: boolean; declaredStatus?: string; references: string[]; note?: string } {
  const extension = path.extname(file).toLowerCase();
  if (![".json", ".jsonl"].includes(extension)) return { references: [] };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return { references: [], note: "unreadable" };
  }
  if (stat.size > options.maxFileBytes) return { references: [], note: `not parsed: ${stat.size} bytes exceeds the parse budget` };

  if (extension === ".jsonl") {
    // JSONL evidence is read line-wise; a bad line is reported, not thrown.
    const references = new Set<string>();
    try {
      for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          for (const reference of referencesIn(parseJsonText(trimmed))) references.add(reference);
        } catch {
          // a malformed row is reported by the caller through jsonValid=false
          return { jsonValid: false, references: [...references].sort() };
        }
      }
      return { jsonValid: true, references: [...references].sort() };
    } catch {
      return { jsonValid: false, references: [] };
    }
  }

  try {
    const parsed: unknown = parseJsonText(fs.readFileSync(file, "utf8"));
    return { jsonValid: true, declaredStatus: declaredStatusOf(parsed), references: referencesIn(parsed) };
  } catch {
    return { jsonValid: false, references: [] };
  }
}

/**
 * Inspects an evidence root. Never throws for a bad artifact: each file's problem
 * becomes an issue and the rest of the tree is still inspected.
 */
export function inspectEvidence(options: InspectEvidenceOptions): EvidenceInspection {
  const now = options.now ?? (() => new Date().toISOString());
  const skip = options.skipDirectories ?? DEFAULT_SKIP;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const inspection = emptyEvidenceInspection(options.root, now());

  if (!fs.existsSync(options.root)) {
    inspection.degraded.push(`root does not exist: ${options.root}`);
    return inspection;
  }

  const { files, truncated } = walk(options.root, { skip, include: options.include, maxFiles });
  if (truncated) {
    inspection.degraded.push(`scan stopped at the ${maxFiles}-file budget; the tree is larger than this inspection covers`);
  }

  for (const relative of files) {
    const absolute = path.join(options.root, relative);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolute);
    } catch {
      inspection.issues.push({ kind: "invalid", path: relative, detail: "file became unreadable during the scan" });
      continue;
    }
    const hashed = hashFile(absolute);
    if (!hashed.hashed) {
      inspection.issues.push({ kind: "invalid", path: relative, detail: "could not be read for checksumming" });
    }
    const artifact = readArtifact(absolute, { maxFileBytes });
    if (artifact.note) inspection.degraded.push(`${relative}: ${artifact.note}`);
    if (artifact.jsonValid === false) {
      inspection.issues.push({ kind: "invalid", path: relative, detail: "does not parse as JSON" });
    }
    const record: EvidenceRecord = {
      path: relative,
      kind: classifyEvidence(relative, { jsonContent: undefined }),
      bytes: hashed.bytes,
      modifiedAt: stat.mtime.toISOString(),
      sha256: hashed.sha256,
      jsonValid: artifact.jsonValid,
      declaredStatus: artifact.declaredStatus,
      phase: phaseOf(relative),
      references: artifact.references
    };
    inspection.records.push(record);
  }

  inspection.records.sort((left, right) => left.path.localeCompare(right.path));

  // Citation sets: which artifacts are named by another artifact in the tree.
  // A citation may be root-relative, sibling-relative or repository-relative, so
  // all three anchors are offered before anything is called dangling.
  const known = new Set(inspection.records.map((record) => record.path));
  const exists = makeRepoExists(options.root, options.repoRoot);
  const resolved = resolveReferences(inspection.records, { knownPaths: known, exists });
  const cited = resolved.cited;
  for (const record of inspection.records) {
    record.referenced = cited.has(record.path);
  }

  if (options.reportOrphans !== false) {
    inspection.issues.push(...findOrphans(inspection.records, { cited }));
  } else {
    inspection.degraded.push(
      "orphan detection is disabled for this scan: a bounded scan cannot see the documents that cite artifacts outside it"
    );
  }
  inspection.issues.push(...resolved.issues);
  inspection.issues.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
  inspection.summary = summarizeEvidence(inspection.records, inspection.issues);
  return inspection;
}

export interface EvidenceComparison {
  schemaVersion: 1;
  kind: "HOST_EVIDENCE_COMPARISON";
  generatedAt: string;
  baseline: string;
  candidate: string;
  entries: EvidenceComparisonEntry[];
  summary: { unchanged: number; modified: number; added: number; removed: number };
}

/** Baseline → candidate, hashes first. Read-only on both sides. */
export function compareEvidenceRoots(input: {
  baselineRoot: string;
  candidateRoot: string;
  options?: Omit<InspectEvidenceOptions, "root">;
}): EvidenceComparison {
  const options = input.options ?? {};
  const baseline = inspectEvidence({ ...options, root: input.baselineRoot });
  const candidate = inspectEvidence({ ...options, root: input.candidateRoot });
  const entries = compareEvidence(baseline, candidate);
  const summary = { unchanged: 0, modified: 0, added: 0, removed: 0 };
  for (const entry of entries) {
    if (entry.change === "UNCHANGED") summary.unchanged += 1;
    else if (entry.change === "MODIFIED") summary.modified += 1;
    else if (entry.change === "ADDED") summary.added += 1;
    else summary.removed += 1;
  }
  return {
    schemaVersion: 1,
    kind: "HOST_EVIDENCE_COMPARISON",
    generatedAt: new Date().toISOString(),
    baseline: input.baselineRoot,
    candidate: input.candidateRoot,
    entries,
    summary
  };
}

/** Issue counts per kind, for a compact CLI report. */
export function issueCounts(issues: readonly EvidenceIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  return counts;
}
