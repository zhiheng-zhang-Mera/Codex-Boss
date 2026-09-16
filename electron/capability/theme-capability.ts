import type { AdapterProvider, CapabilityAdapter } from "./capability-broker";

/**
 * The low-risk built-in capability used to prove the plugin boundary (Phase 03 gate 5).
 *
 * `ui.theme` is the right capability to demonstrate with precisely because it is harmless: it
 * reads the active theme and accepts a proposed one. Nothing it can do touches a file, a shell, a
 * credential or the network, so a plugin holding it has a real capability while the blast radius of
 * getting the boundary wrong stays small. The book asks for "at least one low-risk built-in
 * capability running across the plugin boundary", and a warm-up demonstration on something
 * dangerous would be a poor way to earn trust in the boundary.
 *
 * ## What the adapter deliberately cannot do
 *
 * `pluginSafe: true` is a claim the broker acts on, so it is kept honest by what the adapter is
 * given: a getter for the current theme and a sink for a proposal. It has no filesystem handle, no
 * child process and no fetch, so there is nothing for a plugin to reach through it even if the
 * authorization layer were wrong.
 */

interface ThemeProposal {
  /** A name the proposer suggests. */
  name: string;
  /** Token overrides, as a flat string map. */
  tokens: Record<string, string>;
}

export interface ThemeSurface {
  /** The active theme's id and tokens. */
  current(): { id: string; tokens: Record<string, string> };
  /**
   * Record a proposal. A proposal is not an activation: the owner still decides, which is why the
   * permitted action is `propose` and not `activate`.
   */
  propose(proposal: ThemeProposal): { accepted: boolean; detail: string };
}

/** What the plugin may do with a theme, and nothing else. */
const THEME_ACTIONS: readonly string[] = ["read", "propose"];

/** What a plugin with `ui.theme` can address. A trailing `:` is a prefix match, not a wildcard. */
const THEME_RESOURCES: readonly string[] = ["ui.theme:current", "ui.theme:proposal"];

interface ThemeCapabilityOptions {
  surface: ThemeSurface;
}

export function createThemeCapabilityProvider(options: ThemeCapabilityOptions): AdapterProvider {
  return {
    capability: "ui.theme",
    describes: "reads the active theme and records a proposed one; it cannot activate a theme, reach the filesystem, start a process or use the network",
    // True: this is the one capability a plugin may hold, and the broker's plugin allowlist names
    // it. Every other provider in the system declares false.
    pluginSafe: true,
    create(): CapabilityAdapter {
      return {
        invoke(request) {
          if (request.action === "read") {
            return { theme: options.surface.current() };
          }
          if (request.action === "propose") {
            const input = request.input as Partial<ThemeProposal> | undefined;
            if (!input || typeof input.name !== "string" || !input.name.trim()) {
              return { accepted: false, detail: "a proposal needs a name" };
            }
            const tokens = input.tokens && typeof input.tokens === "object" ? input.tokens : {};
            // Token values are coerced to strings and length-bounded, so a proposal cannot smuggle
            // a structure the theme layer would have to defend against.
            const bounded: Record<string, string> = {};
            for (const [key, value] of Object.entries(tokens)) {
              if (typeof value !== "string") return { accepted: false, detail: `token ${key} must be a string` };
              if (value.length > 200) return { accepted: false, detail: `token ${key} is longer than 200 characters` };
              bounded[key] = value;
            }
            return options.surface.propose({ name: input.name.trim(), tokens: bounded });
          }
          return { accepted: false, detail: `ui.theme does not support the action ${request.action}` };
        }
      };
    }
  };
}

/**
 * The capabilities that reach past the plugin boundary, declared so the broker can refuse them.
 *
 * These are the adapters the escape suite attempts to reach. They exist to be DENIED, and their
 * `pluginSafe: false` is the mechanism: the broker checks it before the grant set, so a plugin
 * cannot obtain one even if a mis-authored grant would allow it.
 *
 * The `create()` bodies return a throwing adapter rather than a working one. If a plugin ever
 * reaches one of these, the failure is loud and immediate — a silent no-op would let a boundary bug
 * pass the escape tests while the real subsystem was still exposed.
 */
interface HighRiskCapabilityNames {
  filesystem: string;
  shell: string;
  network: string;
  credential: string;
  githubWrite: string;
  emailSend: string;
}

export const HIGH_RISK_CAPABILITIES: HighRiskCapabilityNames = {
  filesystem: "project.files",
  shell: "process.exec",
  network: "network.fetch",
  credential: "credential.use",
  githubWrite: "github.write",
  emailSend: "email.send"
};

const HIGH_RISK_DESCRIPTIONS: Record<string, string> = {
  "project.files": "reads and writes files in the project workspace",
  "process.exec": "starts a child process or a shell",
  "network.fetch": "makes an outbound network request",
  "credential.use": "uses a stored credential through its opaque reference",
  "github.write": "creates branches, pushes commits and opens pull requests",
  "email.send": "sends mail from the owner's account"
};

/**
 * Build the high-risk providers.
 *
 * Every one reports `pluginSafe: false`, and `create()` throws rather than performing the
 * operation: the provider is a declaration for the authorization layer, and the escape suite
 * asserts that reaching it is impossible rather than that it is unwise.
 */
export function createHighRiskProviders(): AdapterProvider[] {
  return Object.values(HIGH_RISK_CAPABILITIES).map((capability) => ({
    capability,
    describes: HIGH_RISK_DESCRIPTIONS[capability],
    pluginSafe: false,
    create(): CapabilityAdapter {
      return {
        invoke() {
          throw new Error(`the ${capability} adapter was reached, which should be impossible: the capability is not plugin-safe, so the broker denies it before an adapter is built`);
        }
      };
    }
  }));
}
