import path from "node:path";
import type { BootModule } from "./boot-module";
import { createSelfEvolutionHost } from "../self-evolution/self-evolution-host";
import { LearningService } from "../learning/learning-service";

/**
 * The engineering side of the composition root (convergence book, Phase F).
 *
 * Two things that belong to the engineering loop rather than to any IPC surface:
 *
 *  - **the §7.2 Self-Evolution host** — the mandatory route for a task that targets
 *    Boss itself. It is installed here, in the composition root's own module, so a
 *    self-target edit can never reach the ordinary engineering path: `MainCommander`
 *    hands such a task to the coordinator and the mutation guard refuses any seam
 *    that bypasses it. What this module does NOT own is how a coder/reviewer turn is
 *    routed — that dispatches through the commander, which is built after this
 *    module, so the turn is injected as `ask`. The policy that turn must obey is
 *    stated at the injection site in the composition root (§19: pinned to the codex
 *    runtime, per goal + finding + role session ids, fail closed when codex is
 *    unavailable);
 *  - **the learning layer** (adaptive provider intelligence), created on first use
 *    because nothing needs it until a dispatch asks for it.
 *
 * The health line has **no DEGRADED branch, deliberately**: the host either builds
 * or throws, and this module has no half-configured state to report. A status that
 * can never be false is decoration, so the line reports what is actually known
 * instead — the roots the route will use, and whether anything has run through it.
 */

type HostOptions = Parameters<typeof createSelfEvolutionHost>[0];
type HostHandle = ReturnType<typeof createSelfEvolutionHost>;

export interface EngineeringOptions {
  /** Root the app was launched from (`app.getAppPath()`). */
  appPath: string;
  /** Electron `app.getPath("userData")`. */
  userData: string;
  /** Owner login from the Root policy. */
  rootOwner: HostOptions["rootOwner"];
  /**
   * The coder/reviewer turn. Supplied by the composition root because it dispatches
   * through the commander, which this module must not own.
   */
  ask: ReturnType<HostOptions["worker"]>["ask"];
  /** Explicit evolution roots. Omitted in production, where the host's own defaults apply. */
  evolution?: Pick<HostOptions, "stableRoot" | "evolutionRoot" | "governanceRoot">;
}

export interface EngineeringService {
  /** The §7.2 mandatory Self-Evolution route. */
  selfEvolution: HostHandle;
  /** The adaptive provider intelligence facade, created on first use. */
  learning(): LearningService;
}

export function createEngineeringModule(options: EngineeringOptions): BootModule<EngineeringService> {
  const selfEvolution = createSelfEvolutionHost({
    appPath: options.appPath,
    userData: options.userData,
    rootOwner: options.rootOwner,
    ...(options.evolution ?? {}),
    // Lazy: the worker needs the commander instance, which does not exist yet.
    worker: () => ({ ask: options.ask })
  });

  let learning: LearningService | undefined;
  const learningFor = (): LearningService => {
    if (!learning) learning = new LearningService({ rootDir: path.join(options.userData, ".boss", "learning") });
    return learning;
  };

  return {
    service: { selfEvolution, learning: learningFor },
    health: () => {
      const last = selfEvolution.lastRun();
      return {
        module: "engineering",
        status: "READY",
        detail: `self-evolution: stable ${selfEvolution.stableRoot()}, runs under ${selfEvolution.evolutionRoot()}, ${last ? `last run ${last.outcome}` : "nothing has run yet"}; learning layer ${learning ? "created" : "not created yet"}`
      };
    },
    // The host owns the mutation-guard configuration and the evolution run registry,
    // both process-lifetime by design: a run that is in flight must not be
    // un-registered by a disposal, so there is nothing to release here. Idempotent.
    dispose: () => undefined
  };
}
