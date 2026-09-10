import fs from "node:fs";
import path from "node:path";
import type { RootDecision } from "../../src/shared/root-authority/contracts";

/**
 * Runtime data isolation for Stable / Candidate
 * (Update-Plan/Isolation-Finalization.md §8.2, §8.3, §14 RT-04).
 *
 * "Candidate failure must never corrupt or terminate Stable" is only true if the
 * two processes do not share a single writable file. This module defines the
 * per-run layout and the containment predicate that enforces it:
 *
 *     <evolutionRoot>/<runId>/
 *       workspace/       candidate git worktree (its own index + working tree)
 *       runtime-data/    candidate app data root (--boss-data-dir)
 *       temp/            candidate TEMP / TMP / TMPDIR
 *       logs/            candidate logs
 *       evidence/        candidate evidence
 *       journal/         candidate recovery journal + candidate PID lock
 *
 * Nothing below is shared writable with Stable: DB, history, session state,
 * account session, checkpoints, browser partition, PID/lock, temp, artifact
 * working directory, or the candidate recovery journal (§8.3). Sharing a
 * *read-only* source (the git object store, the package store) is allowed and is
 * declared explicitly; sharing a writable one is refused.
 */

/** A run layout. Every path is absolute and unique to the run id. */
export interface EvolutionLayout {
  runId: string;
  baseSha: string;
  candidateBranch: string;
  /** `<evolutionRoot>/<runId>`. */
  root: string;
  workspace: string;
  runtimeData: string;
  temp: string;
  logs: string;
  evidence: string;
  journal: string;
  /** Stable-side label used to attribute processes and env to this run. */
  processNamespace: string;
}

/**
 * Surfaces under the Stable application root that a Candidate may never write.
 * Expressed relative to the Stable data/application root; the enforcement
 * predicate resolves them against the real paths.
 */
export const STABLE_WRITABLE_SURFACES: readonly string[] = [
  "runtime-data",
  "history",
  ".cache/browser-profile",
  ".cache/tmp",
  ".cache/crash-dumps",
  ".boss",
  "artifacts",
  "secrets"
];

/**
 * Sources a Candidate may use read-only (or copy-on-write) without becoming a
 * corruption path back into Stable. Declared so "shared" is never implicit.
 */
export const READ_ONLY_SHARED_SURFACES: readonly string[] = [".git/objects", "node_modules", "dist", "dist-electron"];

const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export class RuntimeIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeIsolationError";
  }
}

/** Deterministic layout for one run. Pure: no filesystem access. */
export function evolutionLayout(evolutionRoot: string, runId: string, baseSha: string): EvolutionLayout {
  if (!RUN_ID.test(runId)) throw new RuntimeIsolationError(`invalid evolution run id: ${runId}`);
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new RuntimeIsolationError(`invalid immutable base SHA: ${baseSha}`);
  const root = path.join(path.resolve(evolutionRoot), runId);
  return {
    runId,
    baseSha,
    candidateBranch: `evolution/${runId}`,
    root,
    workspace: path.join(root, "workspace"),
    runtimeData: path.join(root, "runtime-data"),
    temp: path.join(root, "temp"),
    logs: path.join(root, "logs"),
    evidence: path.join(root, "evidence"),
    journal: path.join(root, "journal"),
    processNamespace: `codex-boss-evolution-${runId}`
  };
}

/** Creates the unique directories for a run. Idempotent per run id. */
export function materializeEvolutionLayout(layout: EvolutionLayout): EvolutionLayout {
  for (const directory of [layout.root, layout.workspace, layout.runtimeData, layout.temp, layout.logs, layout.evidence, layout.journal]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return layout;
}

/** Environment overrides that redirect every writable surface into the run. */
export function evolutionEnvironmentOverrides(layout: EvolutionLayout): Record<string, string> {
  return {
    TEMP: layout.temp,
    TMP: layout.temp,
    TMPDIR: layout.temp,
    CODEX_BOSS_EVOLUTION_RUN: layout.runId,
    CODEX_BOSS_EVOLUTION_NAMESPACE: layout.processNamespace,
    CODEX_BOSS_EVOLUTION_ROOT: layout.root,
    // The Candidate's own app data root; it never points at Stable's.
    CODEX_BOSS_DATA_DIR: layout.runtimeData
  };
}

/** The argv fragment that redirects the app's data root (electron/main.ts). */
export function evolutionDataDirArg(layout: EvolutionLayout): string {
  return `--boss-data-dir=${layout.runtimeData}`;
}

export interface RuntimeIsolationAssessment {
  decision: RootDecision;
  /** Stable writable surface(s) the path would touch. */
  sharedSurfaces: string[];
  /** True when the path resolves outside the Candidate root entirely. */
  escaped: boolean;
  detail: string;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Decides whether a Candidate may write to `target`.
 *
 *   - inside the Candidate root            -> ALLOW
 *   - inside any Stable writable surface   -> DENY (RT-04)
 *   - outside the Candidate root otherwise -> DENY (containment)
 */
export function assessRuntimeWrite(layout: EvolutionLayout, stableRoot: string, target: string): RuntimeIsolationAssessment {
  const resolved = path.resolve(target);
  const insideCandidate = isInside(layout.root, resolved);
  const sharedSurfaces = STABLE_WRITABLE_SURFACES.filter((surface) => isInside(path.join(path.resolve(stableRoot), surface), resolved));
  if (sharedSurfaces.length) {
    return {
      decision: "DENY",
      sharedSurfaces,
      escaped: !insideCandidate,
      detail: `write to Stable surface ${sharedSurfaces.join(", ")} is not permitted for a Candidate`
    };
  }
  if (!insideCandidate) {
    return { decision: "DENY", sharedSurfaces: [], escaped: true, detail: `write target ${resolved} is outside the Candidate root ${layout.root}` };
  }
  return { decision: "ALLOW", sharedSurfaces: [], escaped: false, detail: `write target is inside the Candidate root` };
}

/** Throwing form used immediately before a Candidate-side filesystem write. */
export function assertRuntimeWriteAllowed(layout: EvolutionLayout, stableRoot: string, target: string): void {
  const assessment = assessRuntimeWrite(layout, stableRoot, target);
  if (assessment.decision === "DENY") throw new RuntimeIsolationError(assessment.detail);
}

/**
 * §8.3 verification helper: asserts that none of the Stable writable surfaces
 * resolves inside the Candidate root, and that the Candidate root is not inside
 * Stable. Called once per run and recorded in evidence.
 */
export function verifyRuntimeSeparation(layout: EvolutionLayout, stableRoot: string): { separated: boolean; overlaps: string[] } {
  const overlaps: string[] = [];
  for (const surface of STABLE_WRITABLE_SURFACES) {
    const stablePath = path.join(path.resolve(stableRoot), surface);
    if (path.resolve(stablePath) === path.resolve(layout.root) || isInside(layout.root, stablePath)) overlaps.push(surface);
  }
  if (isInside(stableRoot, layout.root)) overlaps.push("<candidate root inside stable root>");
  return { separated: overlaps.length === 0, overlaps };
}

/**
 * §8.4: a corrupt Candidate runtime-data must be quarantined, not repaired in
 * place, so Stable can start the next Candidate from a known-clean state.
 */
export function quarantineCandidateRuntime(layout: EvolutionLayout, stamp: string): string | undefined {
  if (!fs.existsSync(layout.runtimeData)) return undefined;
  const target = `${layout.runtimeData}.corrupt-${stamp}`;
  fs.renameSync(layout.runtimeData, target);
  fs.mkdirSync(layout.runtimeData, { recursive: true });
  return target;
}
