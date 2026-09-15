import path from "node:path";
import type { BootModule, IpcRegistrar } from "./boot-module";
import { requireWorkspacePathSync } from "../workspace/path-utils";
import { researchIdFor } from "../../src/shared/research-input";
import type { ResearchIR } from "../../src/shared/research-ir";

/**
 * Starting a research run, and compiling its manuscript (convergence book, Phase F/G).
 *
 * Two channels at the two ends of a run's life: `boss:research-start` creates it, and
 * `boss:research-compile-pdf` turns its `paper.tex` into `paper.pdf`. The supervisor
 * channels (status, step, wait, protocol freeze, …) live in `research-ipc.ts`; these
 * are the ones that *create the work* and *produce the artifact*, so they are separate.
 *
 * Two rules are load-bearing here and are pinned by tests:
 *
 *   - **A research workspace enters the runtime through the single path model.** It
 *     used to be checked with `.trim()` only, so a typo became a research scope that
 *     silently wrote nowhere, and two spellings of one directory became two project
 *     scopes. A workspace that cannot be canonicalised is refused by name.
 *   - **Compiling is fail-closed.** No engine, or a compile error, yields status FAIL
 *     with the `.tex` preserved and the paths still returned, so a repair can be
 *     attempted — it never reports success it did not observe.
 */

/** The human-defined research input, exactly as the renderer sends it. */
interface ResearchStartInput {
  id?: string;
  /**
   * The falsifiable research question the Owner typed, with the workspace and the
   * budget; `researchQuestion` is the immutable anchor of the run.
   */
  researchQuestion?: string;
  goal: string;
  workspace: string;
  reviewers: string[];
  autonomy?: "AUTOPILOT" | "GUIDED";
  hypothesis?: string;
  providerPolicy?: "AUTO" | "FIXED";
  maxExperiments?: number;
  maxSteps?: number;
  maxProviderCalls?: number;
}

interface ResearchRunSurface {
  /** Creates a run anchored on an Owner-supplied research question. */
  startHumanResearch(input: {
    id?: string;
    researchQuestion: string;
    workspace: string;
    hypothesis?: string;
    providerPolicy: "AUTO" | "FIXED";
    reviewers: string[];
    budget: { maxSteps: number; maxExperiments: number; maxProviderCalls: number };
  }): { ir: { id: string } };
  /** Creates a run from the autopilot/guided path's own IR. */
  start(ir: ResearchIR): { ir: { id: string } };
  /** The run's cache directory; the data root is the composition root's business. */
  researchCache(id: string): string;
  /** Announces that a run exists, so the renderer can follow it. */
  publish(event: { type: "TOOL_RESULT_READY"; taskId: string; message: string }): void;
}

interface ResearchRunIpcDeps {
  handle: IpcRegistrar["handle"];
  run: ResearchRunSurface;
}

export const RESEARCH_RUN_IPC_CHANNELS = [
  "boss:research-start",
  "boss:research-compile-pdf"
] as const;

export function createResearchRunIpcModule(deps: ResearchRunIpcDeps): BootModule<{ channels: readonly string[] }> {
  const registered: string[] = [];
  const on = (channel: string, listener: (event: unknown, ...args: any[]) => unknown): void => {
    deps.handle(channel, listener);
    registered.push(channel);
  };

  on("boss:research-start", (_event, input: ResearchStartInput) => {
    const researchWorkspace = requireWorkspacePathSync(input.workspace).canonicalPath!;

    if (input.researchQuestion?.trim()) {
      const record = deps.run.startHumanResearch({
        id: input.id,
        researchQuestion: input.researchQuestion.trim(),
        workspace: researchWorkspace,
        hypothesis: input.hypothesis?.trim() || undefined,
        providerPolicy: input.providerPolicy ?? (input.autonomy === "GUIDED" ? "FIXED" : "AUTO"),
        reviewers: input.reviewers,
        budget: { maxSteps: input.maxSteps ?? 200, maxExperiments: input.maxExperiments ?? 3, maxProviderCalls: input.maxProviderCalls ?? 200 }
      });
      deps.run.publish({ type: "TOOL_RESULT_READY", taskId: record.ir.id, message: `research ${record.ir.id} started from human-defined RQ` });
      return record;
    }

    if (!input.goal.trim()) throw new Error("Research goal is required when no researchQuestion is supplied");
    if (!input.reviewers.length) throw new Error("Research requires at least one reviewer");
    const ir: ResearchIR = {
      schemaVersion: 1,
      id: input.id ?? researchIdFor(input.goal.trim()),
      goal: input.goal.trim(),
      scope: { workspace: researchWorkspace, allowedDomains: [], reviewers: input.reviewers, autonomy: input.autonomy ?? "AUTOPILOT", budget: { maxExperiments: input.maxExperiments ?? 5, maxSteps: input.maxSteps ?? 100 } },
      state: "SCOPING",
      researchQuestions: [],
      hypotheses: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const record = deps.run.start(ir);
    deps.run.publish({ type: "TOOL_RESULT_READY", taskId: ir.id, message: `research ${ir.id} started` });
    return record;
  });

  on("boss:research-compile-pdf", async (_event, id: string) => {
    // Phase L: compile a run's manuscript/paper.tex into paper.pdf (audit written to
    // research/<id>/audit/compile.json). Fail-closed: no engine or compile error →
    // status FAIL, .tex preserved, paths still returned for repair.
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
    const cache = deps.run.researchCache(safeId);
    // Imported lazily: the LaTeX toolchain is only needed when a document is compiled.
    const { LatexCompiler } = await import("../research/manuscript/latex-compiler.js");
    const audit = await new LatexCompiler().compile(path.join(cache, "manuscript"));
    return { ...audit, researchCache: cache };
  });

  return {
    service: { channels: RESEARCH_RUN_IPC_CHANNELS },
    health: () => ({
      module: "research-run-ipc",
      status: registered.length === RESEARCH_RUN_IPC_CHANNELS.length ? "READY" : "DEGRADED",
      detail: `${registered.length}/${RESEARCH_RUN_IPC_CHANNELS.length} research-run channel(s): ${registered.join(", ")}`
    }),
    dispose: () => undefined
  };
}
