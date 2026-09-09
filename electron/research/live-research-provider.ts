/**
 * Live research semantic provider (milestone §3 seam, Phase 15/17). Adapts the
 * conductor's semantic interface to the Boss web-AI provider pool (the logged-
 * in web AIs) through an injected executor (ProviderAutomation in the GUI
 * session, a fixture in tests).
 *
 * Policy (milestone §8 default, hardened for real web automation):
 * - workers are attempted SEQUENTIALLY, never in parallel fan-out;
 * - host validation is tolerant (extractJsonEntity: accepts JSON the model
 *   emitted even wrapped in prose/fences; never synthesizes content);
 * - providers with recent dispatch failures are DEPRIORITIZED (failure streak),
 *   so a chronically broken page (e.g. deepseek never entering "waiting") stops
 *   burning attempts;
 * - dispatch-level failures (page not ready / send rollback / input failure)
 *   trigger a bounded RETRY round with backoff, and each retry uses a NEW
 *   conversation (fresh jobId) — web automation errors are commonly transient;
 * - per-stage attempt budget is bounded (maxAttempts); exhausted → throw (the
 *   conductor fails the run closed, never a fabricated answer).
 */

import { createHash } from "node:crypto";
import type { ResearchState } from "../../src/shared/research-ir";
import { roleForStage, type ResearchRole } from "../../src/shared/research-roles";
import { extractJsonEntity } from "./semantic-json";
import type { ResearchSemanticProvider } from "./research-conductor";

export interface LiveAskResult {
  status: "SUCCESS" | "FAIL";
  content?: string;
  message?: string;
}

/** Executor seam: sends one semantic prompt to one web provider. */
export type LiveSemanticExecutor = (providerId: string, input: { jobId: string; prompt: string }) => Promise<LiveAskResult>;

export interface LiveResearchProviderOptions {
  /** Returns the currently open (logged-in) provider ids, in preference order. */
  openProviderIds: () => string[];
  /** Sends one prompt to a provider (ProviderAutomation in the GUI session). */
  execute: LiveSemanticExecutor;
  /** Max providers consulted per attempt round (default 3). */
  maxWorkers?: number;
  /** Total attempts across rounds for one stage (default 4). */
  maxAttempts?: number;
  /** Sleep between failed rounds (default 0 in tests; GUI passes e.g. 4000ms). */
  retryBackoffMs?: number;
  /** Explicit per-ask instruction override for tests/live. */
  instruct?: string;
}

interface FailureStreak {
  count: number;
  lastAt: string;
}

export function createLiveResearchProvider(options: LiveResearchProviderOptions): ResearchSemanticProvider {
  const maxWorkers = Math.max(1, options.maxWorkers ?? 3);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const backoff = Math.max(0, options.retryBackoffMs ?? 0);
  const streaks = new Map<string, FailureStreak>();
  return { ask: async (input) => dispatch(options, { maxWorkers, maxAttempts, backoff, streaks }, input) };
}

async function dispatch(options: LiveResearchProviderOptions, cfg: { maxWorkers: number; maxAttempts: number; backoff: number; streaks: Map<string, FailureStreak> }, input: { researchId: string; stage: ResearchState; question: string }): Promise<string> {
  const role = roleForStage(input.stage);
  const base = `${input.researchId}:${input.stage}:${role}`;
  const failures: string[] = [];
  let attempts = 0;
  while (attempts < cfg.maxAttempts) {
    // Preference order: lowest failure streak first; ties keep the caller's
    // provider order (stable sort) so a healthy pool keeps its natural order.
    const providers = options.openProviderIds()
      .map((id) => ({ id, streak: cfg.streaks.get(id)?.count ?? 0 }))
      .sort((a, b) => a.streak - b.streak)
      .slice(0, cfg.maxWorkers)
      .map((entry) => entry.id);
    if (providers.length === 0) throw new Error("no logged-in web provider for the live research semantic stage; open a provider window first");
    for (const providerId of providers) {
      if (attempts >= cfg.maxAttempts) break;
      attempts += 1;
      // Each attempt is a fresh conversation (jobId includes the attempt), so a
      // transient page failure never re-submits the same stalled exchange.
      const jobId = fingerprint(`${base}:a${attempts}`);
      const result = await options.execute(providerId, { jobId, prompt: buildPrompt(input, role, options.instruct) });
      if (result.status === "SUCCESS" && result.content) {
        const entity = extractJsonEntity(result.content);
        if (entity !== null) {
          cfg.streaks.set(providerId, { count: 0, lastAt: new Date().toISOString() });
          return entity;
        }
        recordFailure(cfg.streaks, providerId);
        failures.push(`${providerId}: answer did not contain valid JSON`);
      } else {
        recordFailure(cfg.streaks, providerId);
        failures.push(`${providerId}: ${result.message ?? "worker failed"}`);
      }
      // Space retries so a transiently busy page (previous round still
      // streaming, page not in a sendable state) can free up before the next
      // attempt. Sleeps happen only between attempts (tests pass backoff 0).
      if (attempts < cfg.maxAttempts && cfg.backoff > 0) await sleep(cfg.backoff);
    }
  }
  throw new Error(`live semantic workers failed for ${input.stage} (${role}): ${failures.join("; ")}`);
}

function recordFailure(streaks: Map<string, FailureStreak>, providerId: string): void {
  const current = streaks.get(providerId);
  streaks.set(providerId, { count: (current?.count ?? 0) + 1, lastAt: new Date().toISOString() });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stable prompt prefix (milestone §27): static instruction first, dynamic task last. */
export function buildPrompt(input: { researchId: string; stage: ResearchState; question: string }, role: ResearchRole, instruct?: string): string {
  const instruction = instruct ?? `[research-semantic-v1] You are the ${role} role worker for a bounded autonomous research run. Respond with ONLY valid JSON matching the requested shape. Never change the research question, never invent experiment results or sources, and never output prose outside the JSON.`;
  return [instruction, `researchId: ${input.researchId}`, `stage: ${input.stage}`, `task: ${input.question}`].join("\n\n");
}

export function fingerprint(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 32);
}
