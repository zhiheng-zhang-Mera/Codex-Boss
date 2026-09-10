import path from "node:path";
import { SelfTargetResolver, type SelfTargetResolution } from "./self-target-resolver";
import { evolutionRuns, type EvolutionRunContext, type EvolutionRunRegistry } from "./mutation-context";
import { SelfMutationDeniedError } from "./mutation-context";

/**
 * Phase S3.3 — the host-level assertion placed on every production mutating
 * seam (Update-Plan/Alien-Prestart.md §7.3).
 *
 * Seams are guarded, not callers. A future code path that reaches
 * `prepareWorkspace`, `prepareStepWorkspace` or `applyScopedChanges` with the
 * Stable Boss repository as its target fails closed unless a real
 * `EvolutionRunContext` is registered for that tree — which only
 * `SelfEvolutionCoordinator` can create.
 *
 * The guard is deliberately cheap: it resolves the Boss repository once, then
 * answers every later call with a string comparison.
 */

export interface MutationGuardConfig {
  /** Stable installation root. */
  stableRoot: string;
  /** Reviewed repository identity. */
  productRepository: string;
  /** Registry consulted for an active run. */
  registry: EvolutionRunRegistry;
  /** Resolver override (tests). */
  resolver?: SelfTargetResolver;
}

let config: MutationGuardConfig | undefined;
let cachedResolver: SelfTargetResolver | undefined;
let cachedResolution: SelfTargetResolution | undefined;

function repositoryRoot(): string {
  // `electron/self-evolution/mutation-guard.ts` -> repository root.
  return path.resolve(__dirname, "..", "..");
}

/**
 * Installs the production configuration. Called from the Electron composition
 * root with the real Stable root and repository identity; tests call it with
 * fixture roots.
 */
export function configureMutationGuard(next: MutationGuardConfig): void {
  config = next;
  cachedResolver = next.resolver ?? new SelfTargetResolver({ stableRoot: next.stableRoot, productRepository: next.productRepository });
  cachedResolution = undefined;
}

/** Removes the configuration (test teardown). */
export function resetMutationGuard(): void {
  config = undefined;
  cachedResolver = undefined;
  cachedResolution = undefined;
}

export function mutationGuardConfigured(): boolean {
  return Boolean(config);
}

/**
 * The default configuration, derived from where this module lives. Used when
 * nothing has been installed yet, so a production path added later is guarded
 * without anyone remembering to configure it.
 */
function effectiveConfig(): MutationGuardConfig {
  if (config) return config;
  const stableRoot = repositoryRoot();
  return { stableRoot, productRepository: "zhiheng-zhang-Mera/Codex-Boss", registry: evolutionRuns };
}

function effectiveResolver(): SelfTargetResolver {
  if (cachedResolver) return cachedResolver;
  const current = effectiveConfig();
  cachedResolver = new SelfTargetResolver({ stableRoot: current.stableRoot, productRepository: current.productRepository });
  return cachedResolver;
}

function effectiveResolution(): SelfTargetResolution {
  if (!cachedResolution) cachedResolution = effectiveResolver().resolve(repositoryRoot());
  return cachedResolution;
}

/** True when `target` lies inside the Boss repository (or is its worktree). */
export function targetsBossRepository(target: string): boolean {
  const resolution = effectiveResolution();
  if (!resolution.isSelf) return false;
  const identity = effectiveResolver().resolve(target);
  return identity.isSelf;
}

export interface MutationGuardVerdict {
  allowed: boolean;
  selfTarget: boolean;
  context?: EvolutionRunContext;
  reason: string;
}

/**
 * The single decision function. Returns a verdict rather than throwing so the
 * acceptance evidence can record both grants and refusals; `assertMutationAllowed`
 * turns a refusal into the thrown error production seams use.
 */
export function assessMutation(target: string, registry?: EvolutionRunRegistry): MutationGuardVerdict {
  const current = effectiveConfig();
  const resolution = effectiveResolver().resolve(target);
  if (!resolution.isSelf) {
    return { allowed: true, selfTarget: false, reason: "target is not the Boss repository" };
  }
  const runRegistry = registry ?? current.registry;
  const context = runRegistry.forWorkspace(target);
  if (!context) {
    return {
      allowed: false,
      selfTarget: true,
      reason: "target is the Boss repository but no EvolutionRunContext covers it; route the task through SelfEvolutionCoordinator"
    };
  }
  return { allowed: true, selfTarget: true, context, reason: `covered by evolution run ${context.runId}` };
}

/**
 * Throws `SelfMutationDeniedError` when a mutating seam is about to write into
 * the Stable Boss repository without a legitimate run context.
 */
export function assertMutationAllowed(target: string, registry?: EvolutionRunRegistry): EvolutionRunContext | undefined {
  const verdict = assessMutation(target, registry);
  if (verdict.allowed) return verdict.context;
  throw new SelfMutationDeniedError(
    `refusing to mutate ${target}: ${verdict.reason}`,
    { workspace: target, selfTarget: true, stableRoot: effectiveConfig().stableRoot }
  );
}
