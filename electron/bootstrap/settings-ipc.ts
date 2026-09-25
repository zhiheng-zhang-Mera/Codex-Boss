import type { BootModule, IpcRegistrar } from "./boot-module";
import { requireProvider } from "./shared/require-provider";
import type { RoleRouteView, UpdateRemoteChannelInput } from "../../src/shared/contracts";
import type { UpdateApiSettingInput } from "../../src/shared/provider-contracts";

/**
 * Settings and pane-control IPC (convergence book, Phase F/G).
 *
 * Ten channels that change installation settings or drive the web-AI panes: the API
 * and remote-channel settings, the runtime/role routing, the remote command tray,
 * the MERGED↔DETACHED workspace view, and per-pane visibility, zoom and reload.
 *
 * They are grouped because they share one shape — a validated mutation followed by
 * re-publishing the snapshot the renderer reads — and because the validation is
 * genuinely the module's to own rather than the composition root's:
 *
 *   - an unknown provider is refused here, by name;
 *   - an unknown workspace view is refused here, rather than being passed down and
 *     failing somewhere less informative;
 *   - reloading a provider with no open pane is refused with the pane's own name.
 *
 * The pane surface is opaque on purpose. This module must never import Electron, so
 * it receives something it can ask to reload rather than a `WebContents`.
 */

/** The workspace-view modes the renderer may ask for. */
const WORKSPACE_VIEWS = ["MERGED", "DETACHED"] as const;
type WorkspaceView = (typeof WORKSPACE_VIEWS)[number];

/** The durable settings mutations, as these channels use them. */
interface SettingsSurface {
  /** Every known provider id, so an unknown one can be refused here. */
  providerIds(): readonly string[];
  updateApiSetting(input: UpdateApiSettingInput): void;
  updateRemoteChannel(input: UpdateRemoteChannelInput): void;
  setRuntimeControl(runtimeId: string, enabled: boolean, priority: number): void;
  /**
   * The role is the domain's own union rather than `string`: this channel previously
   * took an untyped argument, so a renderer could send a role that does not exist.
   */
  setRoleRoute(role: RoleRouteView["role"], runtimeIds: string[], fallback: boolean): void;
  setRemoteCommandStatus(commandId: string, status: "loaded" | "dismissed"): void;
  /** The snapshot the renderer re-reads after every mutation. */
  publish(): unknown;
}

/** The provider-pane manager, reduced to what these channels ask of it. */
interface ProviderPaneSurface {
  setWorkspaceView(view: WorkspaceView): void;
  workspaceView(): unknown;
  webWindowBounds(): unknown;
  setVisible(visible: boolean): void;
  setManualZoom(providerId: string, factor: number): void;
  /** The open pane for a provider id, or undefined when none is open for it. */
  pane(providerId: string): { reload(): void } | undefined;
}

interface SettingsIpcDeps {
  handle: IpcRegistrar["handle"];
  settings: SettingsSurface;
  panes: ProviderPaneSurface;
}

export const SETTINGS_IPC_CHANNELS = [
  "boss:update-api-setting",
  "boss:update-remote-channel",
  "boss:update-runtime-control",
  "boss:update-role-route",
  "boss:load-remote-command",
  "boss:dismiss-remote-command",
  "boss:set-workspace-view",
  "boss:set-provider-views-visible",
  "boss:set-provider-zoom",
  "boss:reload-provider"
] as const;

function isWorkspaceView(value: unknown): value is WorkspaceView {
  return (WORKSPACE_VIEWS as readonly unknown[]).includes(value);
}

export function createSettingsIpcModule(deps: SettingsIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:update-api-setting", (_event, input: UpdateApiSettingInput) => {
    requireProvider(deps.settings.providerIds(), input.providerId);
    deps.settings.updateApiSetting(input);
    return deps.settings.publish();
  });

  on("boss:update-remote-channel", (_event, input: UpdateRemoteChannelInput) => {
    deps.settings.updateRemoteChannel(input);
    return deps.settings.publish();
  });

  on("boss:update-runtime-control", (_event, runtimeId: string, enabled: boolean, priority: number) => {
    deps.settings.setRuntimeControl(runtimeId, Boolean(enabled), Number(priority));
    return deps.settings.publish();
  });

  on("boss:update-role-route", (_event, role: RoleRouteView["role"], runtimeIds: string[], fallback: boolean) => {
    deps.settings.setRoleRoute(role, runtimeIds, Boolean(fallback));
    return deps.settings.publish();
  });

  on("boss:load-remote-command", (_event, commandId: string) => {
    deps.settings.setRemoteCommandStatus(commandId, "loaded");
    return deps.settings.publish();
  });

  on("boss:dismiss-remote-command", (_event, commandId: string) => {
    deps.settings.setRemoteCommandStatus(commandId, "dismissed");
    return deps.settings.publish();
  });

  on("boss:set-workspace-view", (_event, view: string) => {
    if (!isWorkspaceView(view)) throw new Error("Invalid workspace view");
    deps.panes.setWorkspaceView(view);
    return { view: deps.panes.workspaceView(), webWindow: deps.panes.webWindowBounds() };
  });

  on("boss:set-provider-views-visible", (_event, visible: boolean) => deps.panes.setVisible(Boolean(visible)));

  on("boss:set-provider-zoom", (_event, providerId: string, factor: number) => {
    requireProvider(deps.settings.providerIds(), providerId);
    deps.panes.setManualZoom(providerId, Number(factor));
  });

  on("boss:reload-provider", (_event, providerId: string) => {
    const pane = deps.panes.pane(providerId);
    if (!pane) throw new Error(`Unknown provider view: ${providerId}`);
    pane.reload();
  });

  return {
    service: { channels: SETTINGS_IPC_CHANNELS },
    health: () => ({
      module: "settings-ipc",
      status: registered.length === SETTINGS_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${SETTINGS_IPC_CHANNELS.length} settings/pane channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
