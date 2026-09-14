import type { BootModule } from "./boot-module";
import type { StateStore } from "../store";
import type { ApiSettingsStore } from "../api-settings";
import type { RuntimeRegistry } from "../commander/runtime-registry";
import { ProviderApiClient } from "../provider-api";
import { ApiRuntime } from "../runtimes/native-api-runtime";
import { createGitHubMachineRuntime } from "../github/github-machine-runtime";

/**
 * Provider-side integration (convergence book, Phase F).
 *
 * The first slice of the plan's `providers` group: the two objects the
 * composition root built inline for the *API* side of the provider pool — the
 * client every API runtime dispatches through, and the GitHub machine identity —
 * plus the registration of one API runtime per configured provider.
 *
 * The pool itself (`ProviderViews`, `ProviderAutomation`, the provider lookup and
 * the web panes that hang off the controller window) is NOT here yet: it is 32
 * `providerViews` and ~30 `automation` references through the desktop acceptance
 * surface, which is its own round. This module deliberately takes only what it
 * needs so that move can happen without re-cutting it.
 *
 * Two behaviours are preserved verbatim, because both are deliberate:
 *
 *  - **a node with no GitHub machine configuration degrades only GitHub.** The
 *    runtime is built inside a try/catch and falls back to `{configured: false}`,
 *    so a missing or invalid node-local secret can never stop Boss from starting;
 *    the fallback is reported through the health line rather than swallowed;
 *  - **the API client is built from the durable settings store**, so a key the
 *    Owner saved is the key the next dispatch uses.
 */

/** Platform secure storage, injected so this module never imports Electron. */
export interface ProvidersCrypto {
  protect(plainText: string): string;
  unprotect(cipherText: string): string;
}

export interface ProvidersOptions {
  /** The resolved data root — `app.getPath("userData")` in production. */
  userData: string;
  /** The live state document: the providers it holds are what gets a runtime. */
  store: StateStore;
  /** The durable API settings the client reads. */
  apiSettings: ApiSettingsStore;
  crypto: ProvidersCrypto;
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
  registerRuntimes(registry: RuntimeRegistry): number;
}

export function createProvidersModule(options: ProvidersOptions): BootModule<ProvidersService> {
  const { userData, store, apiSettings, crypto } = options;

  const apiClient = new ProviderApiClient(apiSettings);
  let githubMachine: ReturnType<typeof createGitHubMachineRuntime>;
  try {
    githubMachine = createGitHubMachineRuntime({ userData, crypto });
  } catch {
    // Invalid/missing node-local GitHub configuration degrades only GitHub.
    githubMachine = { configured: false };
  }

  let registered = 0;
  let disposed = false;
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
      }
    },
    health: () => ({
      module: "providers",
      // A node whose GitHub machine identity could not be built is not broken —
      // everything except GitHub works — but it is not fully configured either, and
      // that is exactly the kind of state an operator has to be able to see.
      status: githubMachine.configured ? "READY" : "DEGRADED",
      detail: `${registered} API runtime(s) registered; GitHub machine ${githubMachine.configured ? "configured" : "unavailable on this node"}${disposed ? "; disposed" : ""}`
    }),
    // The client and the machine identity hold settings and a secret, not an OS
    // handle: there is nothing to release. Disposal is a state change the
    // composition root can rely on, and it is idempotent.
    dispose: () => { disposed = true; }
  };
}
