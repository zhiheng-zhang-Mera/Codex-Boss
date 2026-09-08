import fs from "node:fs";
import path from "node:path";
import type { EngineeringFinding } from "../../src/shared/engineering-loop";
import { scanRepo } from "./repo-inspector";
import { affectedTests, dependencyClosure } from "./semantic-slice";

/**
 * Automatic scope inference for one engineering finding (plan §6.1.2).
 *
 * Maps a finding (area + description + evidence such as a tsc/vitest
 * transcript or reviewer summary) to a bounded `candidateFiles` set that a
 * production coder is allowed to edit. The rule is fail-closed: when no
 * real file can be tied to the finding, the set is empty and the caller must
 * ABORT (never fall back to editing the whole repo).
 */

const CODE_PATH_TOKEN =
  /(?<![A-Za-z0-9])([A-Za-z]:[\\/][^\s"':`())\]]+|[^\s"':`())\]]+\.(?:[cm]?[jt]sx?|mjs|cjs|json|css|html|vue|svelte))\b/g;

function stripLocator(token: string): string {
  // tsc/vitest transcripts append :line:col or (row,col) after the path.
  return token.replace(/(:\d+){1,2}$/, "").replace(/\(\d+,\d+\)$/, "");
}

function normalizeToken(token: string): string {
  return token.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Relative-to-root existence check tolerant of Windows drive + slash forms. */
function resolveCandidate(root: string, token: string): string | undefined {
  const cleaned = normalizeToken(stripLocator(token)).trim();
  if (!cleaned) return undefined;
  const absolute = path.isAbsolute(cleaned) ? cleaned : path.join(root, cleaned);
  const real = fs.realpathSync(root);
  try {
    const target = fs.realpathSync(absolute);
    const relative = path.relative(real, target).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    return fs.statSync(target).isFile() ? relative : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Candidate files deterministically tied to the finding. Order:
 * 1. Paths named in the finding evidence/description that exist in the repo.
 * 2. Tests affected by those files (import edges) when the finding is about
 *    code; the failing test file itself when the finding is a test failure.
 * 3. Dependency closure of the named files, capped (context, never permission).
 *
 * `extraContextPaths` lets callers seed scope from files the reviewer actually
 * changed (reviewer-reflow findings carry no compiler transcript).
 */
export function candidateFilesForFinding(
  root: string,
  finding: EngineeringFinding,
  options: { extraContextPaths?: string[]; maxFiles?: number } = {}
): string[] {
  const maxFiles = Math.max(1, options.maxFiles ?? 40);
  const text = `${finding.area}\n${finding.description}\n${finding.evidence ?? ""}\n${(options.extraContextPaths ?? []).join("\n")}`;
  const tokens = new Set<string>();
  for (const match of text.matchAll(CODE_PATH_TOKEN)) {
    const candidate = resolveCandidate(root, match[1] ?? "");
    if (candidate) tokens.add(candidate);
  }
  const named = [...tokens].sort((a, b) => a.localeCompare(b));
  if (!named.length) return [];

  const snapshot = scanRepo(root);
  const isTest = (file: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
  const sources = named.filter((file) => !isTest(file));

  // A compile diagnostic can point at a generated/derived file; keep the
  // direct name. The dependency closure of EVERY named file (tests included)
  // is part of the reasoning scope so a failing test can reach the module
  // that actually carries the bug; affected tests of sources are the
  // regression surface.
  const candidates = new Set<string>(named);
  if (named.length) {
    dependencyClosure(snapshot, named, maxFiles).forEach((file) => candidates.add(file));
    affectedTests(snapshot, sources).forEach((file) => candidates.add(file));
  }
  const ordered = [...candidates].sort((a, b) => a.localeCompare(b));
  return ordered.length > maxFiles ? ordered.slice(0, maxFiles) : ordered;
}

/** Test files covered by the candidate set (regression surface). */
export function regressionTestsFor(root: string, candidateFiles: string[]): string[] {
  const snapshot = scanRepo(root);
  const isTest = (file: string) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
  const sources = candidateFiles.filter((file) => !isTest(file));
  const ownTests = candidateFiles.filter(isTest);
  return [...new Set([...ownTests, ...affectedTests(snapshot, sources)])].sort((a, b) => a.localeCompare(b));
}
