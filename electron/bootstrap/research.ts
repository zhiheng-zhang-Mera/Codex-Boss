import path from "node:path";
import type { BootModule } from "./boot-module";
import type { StateStore } from "../store";
import type { ProviderAutomation } from "../provider-automation";
import { ResearchService } from "../research/research-service";
import { ResearchRuntime } from "../research/runtime/research-runtime";
import { ResearchConductor } from "../research/research-conductor";
import { LiveResearchExecutor } from "../research/live-research-executor";
import { createLiveResearchProvider } from "../research/live-research-provider";
import { runHostLiteraturePass, createOpenAlexLiteratureDeps } from "../research/literature/host-retrieval";
import type { ResearchStageExecutor } from "../research/research-supervisor";

/**
 * The research composition root (convergence book, Phase F).
 *
 * ONE research service, built here: it owns the durable ledger, the protocol
 * manager, the evidence graph, the citation store, the autopilot supervisor and the
 * structured runtime, and every `boss:research-*` channel forwards to it. The roots
 * stay per-store (`research/<id>.json` ledger files, `research-protocols/`) so runs
 * recorded before the composition-root migration remain recoverable.
 *
 * The executor is the part worth stating: every semantic stage is driven by a REAL
 * logged-in provider through the pool's automation, and it **fails closed** — when
 * no provider page is open, or the automation is not ready, the stage returns FAIL
 * with the reason rather than inventing a result. The conductor's own service
 * lookup is a thunk because the service is being built here: that cycle was a
 * module-scope `let` in the composition root, and it is a private detail now.
 *
 * Retries are deliberate and bounded: transient web-automation failures (page busy,
 * not ready, send rollback) are common, so a stage gets 8 attempts with a 20s
 * backoff, each in a fresh conversation, and chronically failing providers are
 * deprioritized by the provider layer rather than retried forever.
 */

export interface ResearchOptions {
  /** The resolved data root — `app.getPath("userData")` in production. */
  dataRoot: string;
  /** The live state document: which provider panes are open is read from it. */
  store: StateStore;
  /**
   * The pool's automation, asked for lazily: research dispatches through provider
   * panes, and the pool is attached after this module is built.
   */
  automation(): ProviderAutomation | undefined;
}

export interface ResearchModuleService {
  /** The one research service every research route forwards to. */
  research: ResearchService;
  /** How many provider pages are open right now, which is what a live stage needs. */
  openProviders(): number;
}

export function createResearchModule(options: ResearchOptions): BootModule<ResearchModuleService> {
  const { dataRoot, store } = options;
  const researchRoot = path.join(dataRoot, ".boss", "research");
  let service: ResearchService | undefined;
  let disposed = false;

  const openProviders = (): number => store.snapshot().providers.filter((item) => item.windowOpen).length;

  const liveExecutor = (): ResearchStageExecutor => {
    const provider = createLiveResearchProvider({
      openProviderIds: () => store.snapshot().providers.filter((item) => item.windowOpen).map((item) => item.id),
      maxAttempts: 8,
      retryBackoffMs: 20000,
      execute: async (providerId, input) => {
        try {
          const automation = options.automation();
          if (!automation) return { status: "FAIL", message: "provider automation not ready" };
          const result = await automation.executeWorker(providerId, {
            taskId: input.jobId,
            jobId: input.jobId,
            role: "research",
            prompt: input.prompt,
            context: "Autonomous research semantic stage. Return ONLY the requested JSON. Never change the research question; never invent experiment results, statistics, sources or citation support.",
            replaySafe: true,
            timeoutMs: 180000
          });
          return result.status === "SUCCESS" ? { status: "SUCCESS", content: result.content } : { status: "FAIL", message: result.failure?.message ?? `web provider ${providerId} did not answer` };
        } catch (error) {
          // executeWorker may reject (e.g. the "AI is busy on another task" guard);
          // surface it as a FAIL so the provider retry/backoff layer can ride
          // through transient busy pages instead of failing the run.
          return { status: "FAIL", message: String(error instanceof Error ? error.message : error).slice(0, 300) };
        }
      }
    });
    return new LiveResearchExecutor({
      inner: new ResearchConductor({
        // A thunk, not a value: the service is built from this executor.
        service: () => {
          if (!service) throw new Error("research service not ready");
          return service;
        },
        provider,
        // Overcomplete §9.3: REAL host literature retrieval (OpenAlex) before any
        // AI advisory intake. Offline/empty results degrade honestly to the
        // provider fallback inside the conductor.
        hostLiterature: async (ir) => runHostLiteraturePass({ rq: ir.researchQuestions[0] ?? ir.goal }, createOpenAlexLiteratureDeps())
      })
    });
  };

  service = new ResearchService({
    root: researchRoot,
    ledgerRoot: researchRoot,
    protocolsRoot: path.join(dataRoot, ".boss", "research-protocols"),
    executor: liveExecutor(),
    runtime: new ResearchRuntime()
  });

  return {
    service: { research: service, openProviders },
    health: () => ({
      module: "research",
      // No open provider page means a live run cannot advance a stage — the
      // executor fails closed — so it is a state the operator should see rather
      // than a number nobody reads.
      status: openProviders() > 0 ? "READY" : "DEGRADED",
      detail: `ledger ${researchRoot}; ${openProviders()} provider page(s) open${openProviders() ? "" : " (a live run cannot advance a semantic stage)"}${disposed ? "; disposed" : ""}`
    }),
    // The service holds file-backed stores and an in-process supervisor; there is no
    // OS handle to release. Disposal is a state change the composition root can rely
    // on, and it is idempotent.
    dispose: () => { disposed = true; }
  };
}
