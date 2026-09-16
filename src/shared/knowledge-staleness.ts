import type { KnowledgeClaim } from "./knowledge-claim";

/**
 * Staleness engine (platform foundation, Phase 04 Task B).
 *
 * Decides whether a claim still describes the world, and WHY — five reasons the book names, each
 * with its own detection so a stale marker can be explained rather than merely applied.
 *
 * ## Stale is not deleted
 *
 * This module never removes anything and never mutates a claim. It produces a verdict; the claim,
 * its provenance and its lineage stay exactly as they were. That separation is the book's rule and
 * it is also what makes the verdict cheap to recompute: nothing is lost by being called stale, so a
 * false positive costs a lowered ranking rather than a lost record.
 *
 * ## Why the verdict is computed, not stored
 *
 * A stored `stale: true` flag goes wrong the moment its cause is fixed — a reverted commit, a
 * restored artifact, a reopened window. Every reason here is derived from inputs the caller
 * supplies, so the answer is a function of the current world rather than a fossil of a past one.
 * The caller may cache it; this module does not.
 *
 * ## What it deliberately cannot know
 *
 * `time` is reported as stale only against an explicit `expiresAt` the claim declared. The engine
 * has no idea which facts are time-sensitive and will not guess: inventing an expiry for a claim
 * that has a durable source would make ordinary knowledge look stale, which is worse than missing
 * one.
 */

/** Why a claim is stale. A closed set, so a caller can branch on the cause. */
type StaleReason =
  | "code-changed"
  | "capability-version-changed"
  | "owner-invalidated"
  | "source-missing"
  | "source-quarantined"
  | "external-expired"
  | "validity-window-closed";

interface StalenessFinding {
  reason: StaleReason;
  detail: string;
  /** What was compared, so the finding can be re-derived. */
  evidence: string;
}

type StalenessVerdict = "CURRENT" | "STALE";

export interface StalenessResult {
  claimId: string;
  verdict: StalenessVerdict;
  /** Empty when current. A claim can be stale for several reasons at once. */
  findings: StalenessFinding[];
  /** One line an operator can read. */
  detail: string;
}

/** What the caller observed about the world. Anything absent is simply not checked. */
export interface StalenessObservation {
  at: string;
  /** Files touched since the claim was bound, per repo. */
  changedPaths?: ReadonlyArray<{ repo: string; paths: readonly string[]; revision: string }>;
  /** The capability versions currently installed, e.g. `persistence` -> `1.0.0`. */
  capabilityVersions?: Readonly<Record<string, string>>;
  /** Claim ids the owner has explicitly invalidated, with the reason. */
  ownerInvalidations?: Readonly<Record<string, string>>;
  /** Source references that no longer exist. */
  missingSources?: readonly string[];
  /** Source references that were quarantined, with the reason. */
  quarantinedSources?: Readonly<Record<string, string>>;
  /** Declared expiries, per claim id, for time-sensitive external facts. */
  expiries?: Readonly<Record<string, string>>;
}

/**
 * Whether a changed path intersects a claim's binding.
 *
 * Compared segment-wise on the repo-relative POSIX path, and a claim bound to a DIRECTORY covers
 * everything beneath it while a claim bound to a FILE covers only itself. A raw `startsWith` would
 * make `src/app.ts` match a change to `src/app.tsx`, which is the kind of false "stale" that trains
 * a reader to ignore the marker.
 */
export function pathIntersects(bound: string, changed: string): boolean {
  return pathIntersectsClean(normalisePath(bound), normalisePath(changed));
}

/** Repo-relative form: forward slashes, no leading `./`, no trailing slash. */
function normalisePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * `pathIntersects` over paths that are already normalised, for callers comparing many of them.
 *
 * `boundIsDirectory` carries the one thing normalisation discards: a binding written as
 * `src/engine/` says outright that it is a directory, so it also covers the directory itself.
 */
function pathIntersectsClean(left: string, right: string): boolean {
  if (left === right) return true;
  // A directory match is inferred only when the changed path is genuinely beneath it, so
  // `src/app.ts` does not match a change to `src/app.tsx`. A binding written with a trailing slash
  // reaches the same answer, because that path arrives here already normalised.
  return right.startsWith(`${left}/`);
}

/**
 * What has moved, arranged for lookup rather than for scanning.
 *
 * The observation is shared by every claim in a corpus, so it is flattened once and then queried
 * per binding. The alternative — walking the change list per claim — is quadratic in the corpus
 * size, and at ten thousand claims that turns "is this knowledge still true" into a minute of work.
 */
interface MovedPath {
  repo: string;
  path: string;
  revision: string;
}

interface ChangeIndex {
  /** Exact lookups: the common case, a claim bound to a file that moved. */
  byRepoPath: Map<string, MovedPath>;
  /** The same entries in order, for bindings that name a directory and cover many files. */
  entries: MovedPath[];
}

const CHANGE_INDEX = new WeakMap<object, ChangeIndex>();

function buildChangeIndex(changes: ReadonlyArray<{ repo: string; paths: readonly string[]; revision: string }>): ChangeIndex {
  const byRepoPath = new Map<string, MovedPath>();
  const entries: MovedPath[] = [];
  // Changes arrive oldest-first, so a later entry replaces the same path's earlier revision. The
  // entry object is shared, so the map and the list cannot drift apart.
  for (const change of changes) {
    for (const path of change.paths) {
      const entry: MovedPath = { repo: change.repo, path: normalisePath(path), revision: change.revision };
      const key = `${change.repo}\u0000${entry.path}`;
      const previous = byRepoPath.get(key);
      if (previous) {
        previous.revision = entry.revision;
        continue;
      }
      byRepoPath.set(key, entry);
      entries.push(entry);
    }
  }
  return { byRepoPath, entries };
}

function changeIndexFor(changes: ReadonlyArray<{ repo: string; paths: readonly string[]; revision: string }>): ChangeIndex {
  const cached = CHANGE_INDEX.get(changes as object);
  if (cached) return cached;
  const built = buildChangeIndex(changes);
  CHANGE_INDEX.set(changes as object, built);
  return built;
}

/**
 * Whether any changed path in a repo touches a claim's binding.
 *
 * Answers from an index of the moved paths, so a binding is judged in time proportional to its own
 * size rather than to how much of the repository moved. Every bound path that moved is reported
 * rather than only the first: a binding over two files that both changed has to name both, or the
 * reader is told to look at half the story.
 */
function bindingAffected(binding: { repo: string; revision: string; paths: readonly string[] }, changes: ReadonlyArray<{ repo: string; paths: readonly string[]; revision: string }>): { affected: boolean; matched: string[]; revision: string } | undefined {
  const index = changeIndexFor(changes);
  const matched: string[] = [];
  let revision: string | undefined;
  for (const path of binding.paths) {
    const clean = normalisePath(path);
    const exact = index.byRepoPath.get(`${binding.repo}\u0000${clean}`);
    // A change at the bound revision is not a change AFTER it: the claim was true of that revision.
    if (exact && exact.revision !== binding.revision) {
      matched.push(path);
      revision = exact.revision;
      continue;
    }
    // No exact hit, so the binding may still name a directory that contains what moved.
    const contained = index.entries.find(
      (entry) => entry.repo === binding.repo && entry.revision !== binding.revision && pathIntersectsClean(clean, entry.path)
    );
    if (contained) {
      matched.push(path);
      revision = contained.revision;
    }
  }
  if (revision === undefined) return undefined;
  return { affected: true, matched, revision };
}

/** Evaluate one claim against the observed world. */
export function assessStaleness(claim: KnowledgeClaim, observation: StalenessObservation): StalenessResult {
  const findings: StalenessFinding[] = [];

  // 1. The code a claim is about moved.
  if (claim.code && observation.changedPaths) {
    const affected = bindingAffected(claim.code, observation.changedPaths);
    if (affected) {
      findings.push({
        reason: "code-changed",
        detail: `the claim was bound to ${claim.code.repo}@${claim.code.revision} and ${affected.matched.join(", ")} changed at ${affected.revision}`,
        evidence: `code:${claim.code.repo}@${affected.revision}`
      });
    }
  }

  // 2. A capability the claim depends on changed generation.
  if (claim.scope.capability && observation.capabilityVersions) {
    const [name, version] = claim.scope.capability.split("@");
    const installed = name ? observation.capabilityVersions[name] : undefined;
    if (name && version && installed && installed !== version) {
      findings.push({
        reason: "capability-version-changed",
        detail: `the claim depends on ${name}@${version} and ${installed} is installed`,
        evidence: `capability:${name}@${installed}`
      });
    }
  }

  // 3. The owner invalidated it. This wins over everything: an explicit invalidation is a decision,
  //    not an inference, so it is reported first.
  const ownerReason = observation.ownerInvalidations?.[claim.id];
  if (ownerReason) {
    findings.unshift({ reason: "owner-invalidated", detail: `the owner invalidated this claim: ${ownerReason}`, evidence: `owner:${claim.id}` });
  }

  // 4. The evidence is gone, or was quarantined.
  if (observation.missingSources?.includes(claim.provenance.sourceRef)) {
    findings.push({
      reason: "source-missing",
      detail: `the source ${claim.provenance.sourceRef} no longer exists, so the claim cannot be re-derived`,
      evidence: `source:${claim.provenance.sourceRef}`
    });
  }
  const quarantined = observation.quarantinedSources?.[claim.provenance.sourceRef];
  if (quarantined) {
    findings.push({
      reason: "source-quarantined",
      detail: `the source ${claim.provenance.sourceRef} was quarantined: ${quarantined}`,
      evidence: `quarantine:${claim.provenance.sourceRef}`
    });
  }

  // 5. A declared window closed, or has passed.
  const expiry = observation.expiries?.[claim.id] ?? (claim.validity.validUntil ?? undefined);
  if (expiry && expiry <= observation.at) {
    findings.push({
      reason: claim.validity.validUntil ? "validity-window-closed" : "external-expired",
      detail: `the claim was valid until ${expiry} and it is now ${observation.at}`,
      evidence: `validity:${expiry}`
    });
  }

  return {
    claimId: claim.id,
    verdict: findings.length > 0 ? "STALE" : "CURRENT",
    findings,
    detail: findings.length === 0
      ? "current: no binding changed, no source went missing and no window closed"
      : `stale: ${findings.map((finding) => finding.reason).join(", ")}`
  };
}

/** Assess many claims, returning a verdict per claim in the input order. */
function assessAll(claims: readonly KnowledgeClaim[], observation: StalenessObservation): StalenessResult[] {
  return claims.map((claim) => assessStaleness(claim, observation));
}

/** The claims a verdict set marks stale, for a report. */
export function staleClaims(results: readonly StalenessResult[]): StalenessResult[] {
  return results.filter((result) => result.verdict === "STALE");
}

/** How many claims each reason accounts for, so a report can show the mix. */
export function reasonHistogram(results: readonly StalenessResult[]): Record<StaleReason, number> {
  const histogram = {
    "code-changed": 0,
    "capability-version-changed": 0,
    "owner-invalidated": 0,
    "source-missing": 0,
    "source-quarantined": 0,
    "external-expired": 0,
    "validity-window-closed": 0
  } satisfies Record<StaleReason, number>;
  for (const result of results) for (const finding of result.findings) histogram[finding.reason]++;
  return histogram;
}

/**
 * Whether a claim should be offered as CURRENT FACT.
 *
 * Distinct from `isCurrent` in the claim contract: that answers "is this claim's own window open",
 * while this also answers "does the world still agree". Retrieval uses this one, which is why the
 * two are named differently — a claim can be undisputed, un-superseded and still stale.
 */
function isRetrievableAsFact(claim: KnowledgeClaim, observation: StalenessObservation): boolean {
  if (claim.supersededBy) return false;
  if (claim.confidence.level === "disputed") return false;
  if (!claim.claim.trim()) return false;
  return assessStaleness(claim, observation).verdict === "CURRENT";
}
