import type { BootModule } from "./boot-module";
import { ProviderViews } from "../provider-views";
import { ProviderAutomation } from "../provider-automation";

/**
 * The provider pool's objects (convergence book, Phase F).
 *
 * The other half of the plan's `providers` group: `providers.ts` holds the API side
 * and the pool's *policies*; this module builds the pool itself — the
 * `ProviderViews` on the controller window and the `ProviderAutomation` over them.
 *
 * The boundary is drawn where the object graph actually splits. The pool reaches
 * outward in three directions that are NOT provider concerns and therefore stay
 * with their owners in the composition root, injected here as callbacks:
 *
 *  - **the task lifecycle** — what happens when a task completes touches the
 *    external-session ledger, the recovery scheduler, the budget manager, the
 *    archive policy and the commander;
 *  - **recovery** — `WebRecovery` needs the views and, through a thunk, the
 *    automation, so it is built by the root immediately after each attach;
 *  - **the archive pass** — a recovery-scheduler handler about external archives.
 *
 * Every option's type is derived from the constructor it is forwarded to
 * (`ConstructorParameters<…>`), so if either constructor changes, this module's
 * surface changes with it rather than drifting.
 *
 * Two behaviours are preserved verbatim:
 *
 *  - **attaching is also re-attaching.** The runtime module creates a new window
 *    when the platform asks for one, and the pool is rebuilt on it; the previous
 *    automation is disposed first, so there is never more than one live automation;
 *  - **a missing window is an error, not a silent no-op** — the same message the
 *    composition root always threw.
 */

type PoolWindow = ConstructorParameters<typeof ProviderViews>[0];
type WindowToggle = ConstructorParameters<typeof ProviderViews>[1];
type Accounts = ConstructorParameters<typeof ProviderViews>[2];
type DownloadPathFor = ConstructorParameters<typeof ProviderViews>[3];
type AutomationStore = ConstructorParameters<typeof ProviderAutomation>[0];
type ResolveProvider = ConstructorParameters<typeof ProviderAutomation>[2];
type Publish = ConstructorParameters<typeof ProviderAutomation>[3];
type ApiClient = ConstructorParameters<typeof ProviderAutomation>[5];
type OnRoundComplete = ConstructorParameters<typeof ProviderAutomation>[6];
type OnTaskComplete = ConstructorParameters<typeof ProviderAutomation>[7];
type OnRecovery = ConstructorParameters<typeof ProviderAutomation>[8];
type Events = ConstructorParameters<typeof ProviderAutomation>[9];
type Attachments = ConstructorParameters<typeof ProviderAutomation>[10];
type AutomationOptions = ConstructorParameters<typeof ProviderAutomation>[11];

interface ProviderPoolOptions {
  /**
   * The controller window, asked for at attach time rather than held: the platform
   * can ask for a new window, and the pool is rebuilt on it.
   */
  window(): PoolWindow | undefined;
  store: AutomationStore;
  provider: ResolveProvider;
  publish: Publish;
  accounts: Accounts;
  api: ApiClient;
  onWindowToggle: WindowToggle;
  downloadPathFor: DownloadPathFor;
  onRoundComplete?: OnRoundComplete;
  onTaskComplete?: OnTaskComplete;
  onRecovery?: OnRecovery;
  events?: Events;
  attachments?: Attachments;
  automationOptions?: AutomationOptions;
  /**
   * Told about each attach, so the composition root can keep its own bindings for
   * the objects its other collaborators already close over. Nothing else should
   * hold these: `views()` and `automation()` are the pool's own answers.
   */
  onAttached?(views: ProviderViews, automation: ProviderAutomation): void;
}

export interface ProviderPoolService {
  /** The live views, or undefined before the first attach. */
  views(): ProviderViews | undefined;
  /** The live automation, or undefined before the first attach. */
  automation(): ProviderAutomation | undefined;
  /**
   * Builds the views on the current window and the automation over them. Called at
   * boot and again whenever a window is recreated.
   */
  attach(): void;
  /** How many times the pool has been attached, which is what the health line reports. */
  attached(): number;
}

export function createProviderPoolModule(options: ProviderPoolOptions): BootModule<ProviderPoolService> {
  let views: ProviderViews | undefined;
  let automation: ProviderAutomation | undefined;
  let attachCount = 0;
  let disposed = false;

  const attach = (): void => {
    const window = options.window();
    if (!window) throw new Error("Main window was not created");
    views = new ProviderViews(window, options.onWindowToggle, options.accounts, options.downloadPathFor);
    // One automation per window: the previous one is disposed before it is replaced,
    // exactly as the inline version did.
    automation?.dispose();
    automation = new ProviderAutomation(
      options.store,
      views,
      options.provider,
      options.publish,
      options.accounts,
      options.api,
      options.onRoundComplete,
      options.onTaskComplete,
      options.onRecovery,
      options.events,
      options.attachments,
      options.automationOptions ?? {}
    );
    attachCount += 1;
    options.onAttached?.(views, automation);
  };

  return {
    service: {
      views: () => views,
      automation: () => automation,
      attach,
      attached: () => attachCount
    },
    health: () => ({
      module: "provider-pool",
      // No views means no pool yet: before boot attaches it, and after the Owner
      // closes the window. That is a real state an operator can see.
      status: views ? "READY" : "DEGRADED",
      detail: `${attachCount} attach(es); ${views ? "views are on the controller window" : "no controller window yet"}${disposed ? "; disposed" : ""}`
    }),
    // The automation owns per-run machinery; releasing it here is the same call the
    // window's close handler makes, and it is idempotent.
    dispose: () => {
      automation?.dispose();
      disposed = true;
    }
  };
}
