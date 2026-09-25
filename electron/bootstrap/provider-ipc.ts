import { normalizeCustomProviderInput } from "../../src/shared/provider-policy";
import type { BootModule, IpcRegistrar } from "./boot-module";
import type { CustomProviderInput, ProviderId } from "../../src/shared/provider-contracts";

/**
 * Custom-provider and provider-pane IPC (convergence book, Phase F/G).
 *
 * The channels that add or remove a provider and that drive its pane. Two rules
 * live here rather than in the composition root, because they are IPC-layer
 * policy:
 *
 *  - an incoming custom provider is normalized by the shared policy before the
 *    store ever sees it, so a renderer cannot install an unvalidated URL;
 *  - a pane layout from the renderer is filtered down to providers that actually
 *    exist and to finite bounds, so a stale or hostile layout cannot move a pane
 *    that is not there or to `NaN`.
 */

/** The pane surface this module is allowed to use (only what its channels need). */
interface ProviderPaneService {
  close(providerId: ProviderId): void;
  layout(views: Partial<Record<ProviderId, { x: number; y: number; width: number; height: number }>>): void;
}

interface ProviderIpcDeps {
  handle: IpcRegistrar["handle"];
  providers: {
    known(): ProviderId[];
    addCustom(name: string, url: string): void;
    removeCustom(providerId: ProviderId): void;
  };
  panes: ProviderPaneService;
  /** Opens a provider pane while respecting the concurrency limit. */
  openWithinLimit(providerId: ProviderId): void;
  /** Resolves a provider (validating the id) before its pane is touched. */
  requireProvider(providerId: ProviderId): unknown;
  publish(): unknown;
}

export const PROVIDER_IPC_CHANNELS = [
  "boss:add-custom-provider",
  "boss:remove-custom-provider",
  "boss:open-provider",
  "boss:close-provider",
  "boss:layout-views"
] as const;

/**
 * Keeps only the panes that exist and the bounds that are real numbers.
 * Exported because it is the rule the channel enforces, and a rule is testable.
 */
export function sanitizeViewLayout(
  known: readonly ProviderId[],
  layout: Partial<Record<ProviderId, { x: number; y: number; width: number; height: number }>>
): Partial<Record<ProviderId, { x: number; y: number; width: number; height: number }>> {
  const safe: Partial<Record<ProviderId, { x: number; y: number; width: number; height: number }>> = {};
  for (const id of known) {
    const bounds = layout?.[id];
    if (!bounds) continue;
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every((value) => Number.isFinite(value))) continue;
    safe[id] = bounds;
  }
  return safe;
}

export function createProviderIpcModule(deps: ProviderIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:add-custom-provider", (_event, input: CustomProviderInput) => {
    const normalized = normalizeCustomProviderInput(input);
    deps.providers.addCustom(normalized.name, normalized.url);
    return deps.publish();
  });

  on("boss:remove-custom-provider", (_event, providerId: ProviderId) => {
    deps.panes.close(providerId);
    deps.providers.removeCustom(providerId);
    return deps.publish();
  });

  on("boss:open-provider", (_event, providerId: ProviderId) => {
    deps.openWithinLimit(providerId);
    return deps.publish();
  });

  on("boss:close-provider", (_event, providerId: ProviderId) => {
    deps.requireProvider(providerId);
    deps.panes.close(providerId);
    return deps.publish();
  });

  on("boss:layout-views", (_event, layout: Partial<Record<ProviderId, { x: number; y: number; width: number; height: number }>>) => {
    deps.panes.layout(sanitizeViewLayout(deps.providers.known(), layout));
  });

  return {
    service: { channels: PROVIDER_IPC_CHANNELS },
    health: () => ({
      module: "provider-ipc",
      status: registered.length === PROVIDER_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${PROVIDER_IPC_CHANNELS.length} channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
