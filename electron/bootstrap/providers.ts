import type { BootModule } from "./boot-module";
import type { StateStore } from "../store";
import type { ApiSettingsStore } from "../api-settings";
import { ProviderApiClient } from "../provider-api";
import { ApiRuntime } from "../runtimes/native-api-runtime";
import { createGitHubMachineRuntime } from "../github/github-machine-runtime";
import type { Provider, ProviderId } from "../../src/shared/provider-contracts";
import type { WorkspaceViewState } from "../../src/shared/workspace-layout";

/**
 * WHAT THIS MODULE NEEDS FROM A RUNTIME REGISTRY, declared here rather than imported.
 *
 * `registerRuntimes` used to take `RuntimeRegistry`, imported as a TYPE from `electron/commander/runtime-registry.ts`.
 * That made `providers` (a KERNEL) depend on `tenx` (a building) for the SHAPE of a parameter it merely receives, and
 * that one type import was the whole of the inversion: it was the only `providers -> tenx` edge, and together with
 * its reverse (`tenx -> providers`, 27 edges) it formed the mutual pair `providers <-> tenx` -- a cycle whose two
 * directions are a kernel reaching into a building and a building reaching into a kernel.
 *
 * The direction is INVERTED here rather than the import being deleted: the consumer states what it needs, TypeScript's
 * structural typing lets the implementation satisfy it, and every call site keeps passing the real registry --
 * `electron/main.ts` wires it at the composition root, which is where that decision belongs. The shape is deliberately
 * minimal (a method accepting a runtime with an id) so this file does not become a second declaration of the
 * registry's contract.
 */
export interface RuntimeRegistrar {
  register(runtime: { id: string; compatibility?: unknown }): void;
}

/**
 * Provider-side integration and the pool's policies.
 *
 * Two halves of the provider group:
 *
 *  - the **API side** — the client every API runtime dispatches through, the
 *    GitHub machine identity, and the registration of one API runtime per
 *    configured provider;
 *  - the **pool's policies** — which provider an id names, how many web panes may
 *    be open at once, whether opening one may navigate it, and the workspace layout
 *    the open count implies (more than three open switches to the detached
 *    second-window mode).
 *
 * The pool's OBJECTS — `ProviderViews` and `ProviderAutomation` — live in
 * `electron/bootstrap/provider-pool.ts`, and where that module is constructed is the
 * whole of its design: immediately before `createMainWindow()`, because the objects
 * capture the account-session registry, the domain event bus and the attachment store
 * at construction time. Built earlier they capture `undefined` — and TypeScript cannot
 * see it, because the composition root holds those bindings as untyped `let`s; the
 * desktop black box caught it, not the compiler, which is why the ordering is stated
 * here rather than left to the next reader.
 *
 * Three behaviours are preserved verbatim, because each is a decision rather than
 * an accident:
 *
 *  - **a node with no GitHub machine configuration degrades only GitHub.** The
 *    runtime is built inside a try/catch and falls back to `{configured: false}`,
 *    so a missing or invalid node-local secret can never stop Boss from starting;
 *    the fallback is reported through the health line rather than swallowed;
 *  - **a fourth web pane is refused, with the same message the renderer has always
 *    shown**, and an already-open provider never counts against the limit;
 *  - **bounded acceptance opens the pane but never navigates it**, so the dispatch
 *    boundary is still traversed by the real code and its outcome recorded
 *    truthfully, it just cannot reach a live AI page.
 */

/** Platform secure storage, injected so this module never imports Electron. */
export interface ProvidersCrypto {
  protect(plainText: string): string;
  unprotect(cipherText: string): string;
}

/** The slice of the provider views the pool's policies need. Structural, so this
 * module never imports Electron and a test can pass a recorder. */
export interface ProviderPoolViews {
  workspaceView(): WorkspaceViewState;
  setWorkspaceView(state: WorkspaceViewState): WorkspaceViewState;
  /** Opens a pane; `loadInitialPage` false opens it without navigating it. */
  open(provider: Provider, loadInitialPage?: boolean): unknown;
}

interface ProvidersOptions {
  /** The resolved data root — `app.getPath("userData")` in production. */
  userData: string;
  /** The live state document: the providers it holds are what gets a runtime. */
  store: StateStore;
  /** The durable API settings the client reads. */
  apiSettings: ApiSettingsStore;
  crypto: ProvidersCrypto;
  /**
   * The live provider views, or undefined before a window has been attached. A
   * getter rather than a value: the views are built around the controller window,
   * which exists later than this module does.
   */
  views(): ProviderPoolViews | undefined;
  /** How many web providers may be open at once. */
  maxActive: number;
  /**
   * Whether opening a pane may navigate it. Bounded acceptance sets this false: the
   * pane is a real WebContentsView, but it never reaches a live AI page.
   */
  navigateOnOpen: boolean;
  /** Test seam: the layout monitor's tick interval. Default 5000. */
  layoutIntervalMs?: number;
}

export interface ProvidersService {
  /** The client every API provider runtime dispatches through. */
  apiClient: ProviderApiClient;
  /**
   * The GitHub machine identity, or the `{configured: false}` fallback when this
   * node's configuration is missing or unusable.
   */
  githubMachine: ReturnType<typeof createGitHubMachineRuntime>;
  /**
   * Registers one API runtime per provider in the state document. Returns how many
   * were registered, which is what the health line reports.
   */
  registerRuntimes(registry: RuntimeRegistrar): number;
  /** The provider record, or a throw naming the unknown id. */
  provider(id: ProviderId): Provider;
  /**
   * Opens a pane for one provider, refusing past the concurrency limit. Throws the
   * same message the composition root always threw, so the renderer's error text is
   * unchanged.
   */
  openWithinLimit(id: ProviderId): void;
  /**
   * The workspace layout the current number of open web providers implies:
   * more than three open switches to the detached second-window mode, three or
   * fewer stay merged. Idempotent, and silent when nothing changed.
   */
  autoLayout(reason: string): void;
  /** Starts (or restarts) the periodic layout monitor. */
  startLayoutMonitor(): void;
  /** Whether the monitor is currently running. */
  monitorRunning(): boolean;
}

export function createProvidersModule(options: ProvidersOptions): BootModule<ProvidersService> {
  const { userData, store, apiSettings, crypto, maxActive, navigateOnOpen } = options;

  const apiClient = new ProviderApiClient(apiSettings);
  let githubMachine: ReturnType<typeof createGitHubMachineRuntime>;
  try {
    githubMachine = createGitHubMachineRuntime({ userData, crypto });
  } catch {
    // Invalid/missing node-local GitHub configuration degrades only GitHub.
    githubMachine = { configured: false };
  }

  const provider = (id: ProviderId): Provider => {
    const match = store.snapshot().providers.find((item) => item.id === id);
    if (!match) throw new Error(`Unknown provider: ${id}`);
    return match;
  };
  const openCount = (): number => store.snapshot().providers.filter((item) => item.windowOpen).length;

  let layoutTimer: ReturnType<typeof setInterval> | undefined;
  let registered = 0;
  let disposed = false;

  const autoLayout = (reason: string): void => {
    try {
      const views = options.views();
      if (!views) return;
      const openWeb = openCount();
      const wanted: WorkspaceViewState = openWeb > 3 ? "DETACHED" : "MERGED";
      if (views.workspaceView() !== wanted) {
        views.setWorkspaceView(wanted);
        console.log(`[auto-layout] ${reason}: ${openWeb} web AI open -> ${wanted}`);
      }
    } catch (error) {
      console.error("[auto-layout] monitor failed", error);
    }
  };

  return {
    service: {
      apiClient,
      githubMachine,
      registerRuntimes: (registry) => {
        let count = 0;
        for (const item of store.snapshot().providers) {
          registry.register(new ApiRuntime(item.id, apiClient));
          count += 1;
        }
        registered += count;
        return count;
      },
      provider,
      openWithinLimit: (id) => {
        const target = provider(id);
        if (!target.windowOpen && openCount() >= maxActive) throw new Error(`最多同时打开 ${maxActive} 个网页 AI`);
        const views = options.views();
        if (!views) throw new Error("Provider views are unavailable: no controller window yet");
        views.open(target, navigateOnOpen);
      },
      autoLayout,
      startLayoutMonitor: () => {
        if (layoutTimer) clearInterval(layoutTimer);
        layoutTimer = setInterval(() => autoLayout("monitor"), options.layoutIntervalMs ?? 5000);
        layoutTimer.unref?.();
      },
      monitorRunning: () => layoutTimer !== undefined
    },
    health: () => ({
      module: "providers",
      // A node whose GitHub machine identity could not be built is not broken —
      // everything except GitHub works — but it is not fully configured either, and
      // that is exactly the kind of state an operator has to be able to see.
      status: githubMachine.configured ? "READY" : "DEGRADED",
      detail: `${registered} API runtime(s) registered; ${openCount()}/${maxActive} web pane(s) open; layout monitor ${layoutTimer ? "running" : "stopped"}; GitHub machine ${githubMachine.configured ? "configured" : "unavailable on this node"}${disposed ? "; disposed" : ""}`
    }),
    // The API client and the machine identity hold settings and a secret, not an OS
    // handle, but the layout monitor owns a real timer: stopping it is the point.
    // Idempotent.
    dispose: () => {
      if (layoutTimer) clearInterval(layoutTimer);
      layoutTimer = undefined;
      disposed = true;
    }
  };
}
