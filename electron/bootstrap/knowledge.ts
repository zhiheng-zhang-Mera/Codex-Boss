import path from "node:path";
import os from "node:os";
import type { BootModule } from "./boot-module";
import type { StateStore } from "../store";
import { KnowledgeBase } from "../knowledge/knowledge-base";
import { KnowledgeFoundation } from "../knowledge/knowledge-foundation";
import { WorldModelStore, buildWorldModelWithGraph } from "../engineering/world-model";
import { UISurfaceRegistryStore, discoverUISurfaces } from "../engineering/ui-surface-discovery";
import { summarizeUISurfaceRegistry, defaultSurfaceContracts } from "../../src/shared/ui-surface";
import { ThemeService } from "../theme/theme-service";
import type { PlanContext } from "../../src/shared/execution-planner";

/**
 * Knowledge, self-model and theme (convergence book, Phase F).
 *
 * These three were built inline in the boot block and they answer one question
 * between them: *what does Boss know about itself and about the repository it is
 * about to work on*. The knowledge base holds reusable facts, the world model is
 * the observed structure of a repository, the UI surface registry is the
 * contract table the theme engine validates against, and the theme is what the
 * Owner sees. They share the application path (the model and the surface
 * registry describe THIS app, not the user's workspace), the data root, and the
 * state document the planner's resource observation reads.
 *
 * Two behaviours are preserved verbatim because they are fail-safe rather than
 * incidental:
 *
 *  - **the planner context is only ever replaced by a successful model**, so a
 *    repository that cannot be modelled leaves the previous observation in place
 *    instead of erasing it;
 *  - **UI-surface discovery never throws into the theme engine**: a failed
 *    discovery logs and returns the locked contract table, because a theme that
 *    cannot be validated is worse than a theme validated against the built-ins.
 */

type WorldModelBuild = ReturnType<typeof buildWorldModelWithGraph>;
type SurfaceContracts = ReturnType<typeof defaultSurfaceContracts>;

interface KnowledgeOptions {
  /** The resolved data root — `app.getPath("userData")` in production. */
  dataRoot: string;
  /**
   * The canonical application path. The world model and the UI surface registry
   * describe Boss's own interface, so they are discovered from here.
   */
  appPath: string;
  /**
   * Canonicalises a repository root before it is modelled. Injected rather than
   * imported: this module performs no filesystem work of its own.
   */
  canonicalize(root: string): string;
  /** The live state document, read for the planner's resource observation. */
  store: StateStore;
}

interface KnowledgeService {
  /** The durable, provenance-carrying fact base. */
  foundation: KnowledgeFoundation;
  /** One world model per repository root, by fingerprint. */
  worldModels: WorldModelStore;
  /** The persisted UI surface registry; the theme engine's contract source. */
  uiSurfaces: UISurfaceRegistryStore;
  themes: ThemeService;
  /** What the theme engine came up as, including whether the persisted theme fell back. */
  themeBootstrap: { activeThemeId: string; fallback: boolean; diagnostics: string[] };
  /** The contract table a theme may touch, memoized per application fingerprint. */
  uiContracts(): SurfaceContracts;
  /** Models one repository root and records the context the planner scopes nodes against. */
  establishWorldModel(root: string): { summary: WorldModelBuild["summary"]; surfaces: ReturnType<typeof summarizeUISurfaceRegistry> };
  /** The observation from the last successful model, or undefined before one. */
  planContext(): PlanContext | undefined;
  /** The counter names this module opened, for the boot health line. */
  opened: readonly string[];
}

export function createKnowledgeModule(options: KnowledgeOptions): BootModule<KnowledgeService> {
  const { dataRoot, appPath, canonicalize, store } = options;
  const boss = (...parts: string[]) => path.join(dataRoot, ".boss", ...parts);
  const opened: string[] = [];
  const open = <T>(name: string, build: () => T): T => {
    const value = build();
    opened.push(name);
    return value;
  };

  const foundation = open("knowledge-base", () => new KnowledgeFoundation(new KnowledgeBase(boss("knowledge-base.json"))));
  const worldModels = open("world-model", () => new WorldModelStore(boss("world-model")));
  const uiSurfaces = open("ui-surfaces", () => new UISurfaceRegistryStore(boss("ui-surfaces.json")));
  let uiSurfaceCache: { fingerprint: string; contracts: SurfaceContracts } | undefined;
  const uiContracts = (): SurfaceContracts => {
    try {
      const built = buildWorldModelWithGraph(appPath);
      if (uiSurfaceCache?.fingerprint !== built.model.fingerprint) {
        const discovery = discoverUISurfaces(built.model);
        if (discovery.validation.ok) uiSurfaces.put(discovery.registry);
        else console.warn("[ui-surfaces] registry rejected", discovery.validation.problems);
        uiSurfaceCache = { fingerprint: built.model.fingerprint, contracts: discovery.registry.contracts };
      }
      return uiSurfaceCache.contracts;
    } catch (error) {
      console.warn("[ui-surfaces] discovery failed; using the locked contract table", error);
      return defaultSurfaceContracts();
    }
  };
  const themes = open("themes", () => new ThemeService({ root: boss("themes"), registryFile: boss("theme-registry.json"), contracts: uiContracts }));
  // §12/§21/§48: materialize the locked built-ins, prove the persisted active
  // theme is still valid, and fall back to a built-in when it is not.
  const themeBootstrap = themes.bootstrap();
  if (themeBootstrap.fallback) console.warn("[theme] active theme fell back", themeBootstrap.diagnostics.slice(-3));

  let lastPlanContext: PlanContext | undefined;
  const establishWorldModel = (root: string) => {
    const built = buildWorldModelWithGraph(canonicalize(root));
    worldModels.put(built.model);
    // checkpoint-1 §29: the planner scopes nodes against what was actually
    // observed here — real files, real test files, real host commands.
    lastPlanContext = {
      files: built.model.modules.map((module) => module.path).concat(built.model.tests),
      tests: built.model.tests.slice(0, 20),
      entry_points: built.model.entry_points,
      build_tools: built.model.build_system.map((entry) => entry.tool),
      commands: {
        ...(built.model.build_system.some((entry) => entry.tool === "tsc") ? { typecheck: "pnpm run typecheck" } : {}),
        ...(built.model.tests.length ? { unit: "pnpm test" } : {}),
        ...(built.model.build_system.some((entry) => entry.tool === "vite") ? { build: "pnpm run build" } : {})
      },
      // §29.3: the concurrency level is derived from what THIS host observes —
      // cores, free memory, provider health and the load already in flight.
      resources: (() => {
        const providers = store.snapshot().providers.filter((item) => item.windowOpen);
        const accounts = store.snapshot().accounts;
        const rateLimited = store.snapshot().runs.filter((run) => run.outcome === "RATE_LIMITED").length;
        const available = providers.filter((provider) => accounts.find((account) => account.providerId === provider.id)?.mode !== "AUTH_REQUIRED").length;
        const activeTasks = store.snapshot().tasks.filter((task) => ["running", "queued", "waiting"].includes(task.status)).length;
        const cores = os.cpus()?.length ?? 2;
        const load = typeof os.loadavg === "function" ? (os.loadavg()[0] ?? 0) / Math.max(1, cores) : 0;
        return {
          cpu_cores: cores,
          free_memory_mb: Math.round(os.freemem() / (1024 * 1024)),
          gpu_available: false,
          available_providers: available,
          rate_limited_providers: rateLimited,
          active_tasks: activeTasks,
          load_average: Number(load.toFixed(3))
        };
      })()
    };
    // The UI surface registry describes the APPLICATION (see uiContracts), so it
    // is read from the persisted registry here rather than rebuilt inside the
    // dispatch path: a task must never pay for a second full-model scan.
    const registry = uiSurfaces.get();
    const surfaces = registry ? summarizeUISurfaceRegistry(registry) : summarizeUISurfaceRegistry({
      schemaVersion: 1,
      version: "ui-surface-registry-1",
      generated_at: new Date().toISOString(),
      root: appPath,
      contracts: defaultSurfaceContracts(),
      unbound: defaultSurfaceContracts().map((contract) => contract.id),
      tokens: [],
      tokens_applied: false,
      style_files: [],
      component_files: []
    });
    return { summary: built.summary, surfaces };
  };

  let disposed = false;
  return {
    service: {
      foundation, worldModels, uiSurfaces, themes, themeBootstrap, uiContracts,
      establishWorldModel,
      planContext: () => lastPlanContext,
      opened
    },
    health: () => ({
      module: "knowledge",
      // A theme that fell back is a real, reachable state the Owner has to know
      // about: the theme they chose is not the one being rendered.
      status: themeBootstrap.fallback ? "DEGRADED" : "READY",
      detail: `${opened.length} store(s); theme ${themeBootstrap.activeThemeId}${themeBootstrap.fallback ? " (fell back)" : ""}; UI contracts ${uiSurfaceCache ? `discovered from ${appPath}` : "locked table"}; world model ${lastPlanContext ? "established" : "not established yet"}${disposed ? "; disposed" : ""}`
    }),
    // The knowledge base, the model store, the surface registry and the theme
    // store are all file-backed and hold no OS handle, so there is nothing to
    // flush. Disposal is a state change the composition root can rely on, and it
    // is idempotent.
    dispose: () => { disposed = true; }
  };
}
