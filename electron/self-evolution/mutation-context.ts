import fs from "node:fs";
import path from "node:path";

/**
 * Phase S3.3 — the mandatory self-mutation assertion
 * (Update-Plan/Alien-Prestart.md §7.3).
 *
 * Every production mutating seam calls `assertSelfMutationContext`. It answers
 * one question: "this code path is about to write into `workspace` — is that
 * write either (a) not about Boss at all, or (b) inside a Candidate that a real
 * `EvolutionRunContext` created?"
 *
 * The assertion exists so that a *future* code path which forgets to route
 * through the coordinator fails closed instead of quietly editing Stable.
 */

export class SelfMutationDeniedError extends Error {
  constructor(
    message: string,
    readonly detail: {
      workspace: string;
      selfTarget: boolean;
      candidateWorkspace?: string;
      stableRoot?: string;
      runId?: string;
    }
  ) {
    super(message);
    this.name = "SelfMutationDeniedError";
  }
}

export interface EvolutionRunContext {
  runId: string;
  /** The Candidate run directory (parent of `workspace`). */
  candidateRoot: string;
  /** The Candidate git worktree. The only writable Boss tree during a run. */
  candidateWorkspace: string;
  /** The Stable installation. Read-only for the whole run. */
  stableRoot: string;
  /** Frozen base commit. */
  baseSha: string;
  /** Root audit ledger, outside the Candidate. */
  ledgerFile: string;
  /** Durable evidence directory for this run. */
  evidenceDirectory: string;
  /** When set, the run's Candidate control object. */
  candidateId?: string;
}

export interface MutationAssertionInput {
  /** The path the mutating code path intends to write into. */
  workspace: string;
  /** True when the workspace is the Boss repository itself. */
  selfTarget: boolean;
  /** The active evolution run, when one exists. */
  evolutionContext?: EvolutionRunContext;
  /** Stable root reported by the resolver, for the error detail. */
  stableRoot?: string;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Throws when a mutating path targets the Stable Boss repository without a
 * legitimate `EvolutionRunContext` pointing at a Candidate inside it.
 *
 * Returns the context when the write is legitimate, so callers can keep using
 * the validated context rather than a second lookup.
 */
export function assertSelfMutationContext(input: MutationAssertionInput): EvolutionRunContext | undefined {
  if (!input.selfTarget) return input.evolutionContext;
  if (!input.evolutionContext) {
    throw new SelfMutationDeniedError(
      `refusing to mutate the Stable Boss workspace ${input.workspace}: the target is the Boss repository but no EvolutionRunContext is active, so this path bypassed SelfEvolutionCoordinator`,
      { workspace: input.workspace, selfTarget: true, stableRoot: input.stableRoot }
    );
  }
  const context = input.evolutionContext;
  if (!isInside(context.candidateRoot, input.workspace)) {
    throw new SelfMutationDeniedError(
      `refusing to mutate ${input.workspace} during run ${context.runId}: the target is outside the Candidate run directory ${context.candidateRoot}`,
      { workspace: input.workspace, selfTarget: true, candidateWorkspace: context.candidateWorkspace, stableRoot: context.stableRoot, runId: context.runId }
    );
  }
  if (isInside(context.stableRoot, input.workspace) && !isInside(context.candidateRoot, input.workspace)) {
    throw new SelfMutationDeniedError(
      `refusing to mutate Stable ${input.workspace} during run ${context.runId}`,
      { workspace: input.workspace, selfTarget: true, candidateWorkspace: context.candidateWorkspace, stableRoot: context.stableRoot, runId: context.runId }
    );
  }
  return context;
}

/**
 * Process-wide registry of active runs. The commander, the engineering loop and
 * any future seam can look up "is there a legitimate run for this workspace?"
 * without threading the context through every signature.
 *
 * The registry is deliberately in-memory only: a run that is not currently
 * executing has no authority, so a restarted process cannot inherit one.
 */
export class EvolutionRunRegistry {
  private readonly runs = new Map<string, EvolutionRunContext>();
  private readonly byWorkspace: Array<{ workspace: string; runId: string }> = [];

  register(context: EvolutionRunContext): EvolutionRunContext {
    this.runs.set(context.runId, context);
    this.byWorkspace.push({ workspace: path.resolve(context.candidateRoot), runId: context.runId });
    return context;
  }

  release(runId: string): void {
    this.runs.delete(runId);
    for (let index = this.byWorkspace.length - 1; index >= 0; index -= 1) {
      if (this.byWorkspace[index].runId === runId) this.byWorkspace.splice(index, 1);
    }
  }

  get(runId: string): EvolutionRunContext | undefined {
    return this.runs.get(runId);
  }

  active(): EvolutionRunContext[] {
    return [...this.runs.values()];
  }

  /** The run whose Candidate run directory contains `workspace`, if any. */
  forWorkspace(workspace: string): EvolutionRunContext | undefined {
    const resolved = path.resolve(workspace);
    for (const entry of this.byWorkspace) {
      if (isInside(entry.workspace, resolved)) return this.runs.get(entry.runId);
    }
    return undefined;
  }
}

/** The registry the production coordinator uses. */
export const evolutionRuns = new EvolutionRunRegistry();

/**
 * Convenience used by mutating seams: resolve the target and assert in one step.
 * `resolveIsSelf` is injected so this module does not need the git-backed
 * resolver (and stays synchronous and cheap at the seam).
 */
export function guardSelfMutation(
  workspace: string,
  resolveIsSelf: (workspace: string) => { isSelf: boolean; stableRoot?: string },
  registry: EvolutionRunRegistry = evolutionRuns
): EvolutionRunContext | undefined {
  const resolution = resolveIsSelf(workspace);
  const context = registry.forWorkspace(workspace);
  return assertSelfMutationContext({
    workspace,
    selfTarget: resolution.isSelf,
    evolutionContext: context,
    stableRoot: resolution.stableRoot
  });
}

/** True when the directory exists and is a directory. */
export function directoryExists(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}
