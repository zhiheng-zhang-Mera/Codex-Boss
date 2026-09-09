import { randomUUID } from "node:crypto";
import { readJson, writeJson } from "../commander/durable-json";
import type { SemanticAction } from "../../src/shared/semantic";
import type { SemanticResult } from "./semantic-runtime";
import { critiqueRequirement, retainKeyFrames, validatePerceptionFrame, validatePerceptionRequirement, type PerceptionEpisode, type PerceptionFrame, type PerceptionFrameKind, type PerceptionOutcome, type PerceptionRequirement } from "../../src/shared/perception";

/**
 * Perception–Action loop (plan AP24). Drives act → observe → critic →
 * requirement-compare → revise over an injected surface and records only the
 * key frames (before / after / error / final). The surface is an interface so
 * the loop is deterministic under test; in production it wraps a
 * SemanticRuntime (computer-service) whose backends perform the real actions.
 */

export interface PerceptionSurfaceResult {
  status: SemanticResult["status"];
  /** Deterministic observation text captured after the action (OCR/page text). */
  observed?: string;
  message?: string;
}

/** Anything that can act on a software surface and be observed afterwards. */
export interface PerceptionSurface {
  /** Run one semantic action; the returned observed text is the post-state. */
  act(action: SemanticAction): Promise<PerceptionSurfaceResult>;
  /** Capture a raw frame (image path + surface id) when a surface supports it. */
  capture?(): Promise<{ imagePath?: string; surfaceId?: string } | undefined>;
}

export interface PerceptionLoopOptions {
  id?: string;
  /** Revision planner: propose the next action after a failed critique, or undefined to stop. */
  revise?: (attempt: PerceptionAttemptContext) => SemanticAction | undefined | Promise<SemanticAction | undefined>;
  /** Bounded total attempts (plan §20: never extend a failing loop forever). */
  maxAttempts?: number;
  now?: () => string;
  /** Optional durable episode journal (.json); keeps only key frames on disk. */
  stateFile?: string;
}

export interface PerceptionAttemptContext {
  attempt: number;
  requirement: PerceptionRequirement;
  observed: string;
  missing: string[];
  lastAction?: SemanticAction;
  lastMessage?: string;
}

export interface PerceptionRunResult {
  episode: PerceptionEpisode;
}

export class PerceptionLoop {
  constructor(private readonly surface: PerceptionSurface, private readonly options: PerceptionLoopOptions = {}) {}

  /** Runs one bounded perception–action episode against a requirement. */
  async run(requirement: PerceptionRequirement, plan: SemanticAction[], reviseOverride?: PerceptionLoopOptions["revise"]): Promise<PerceptionRunResult> {
    validatePerceptionRequirement(requirement);
    const now = this.options.now ?? (() => new Date().toISOString());
    const maxAttempts = Math.min(20, Math.max(1, this.options.maxAttempts ?? 4));
    const revisePlanner = reviseOverride ?? this.options.revise;
    const episode: PerceptionEpisode = {
      id: this.options.id ?? `perception-${randomUUID()}`,
      requirement: { goal: requirement.goal, mustContain: [...requirement.mustContain] },
      steps: [], frames: [], outcome: "FAILED", attempts: 0, reason: "Not run", startedAt: now(), completedAt: now()
    };
    const frames: PerceptionFrame[] = [];
    const before = await this.captureFrame("before", now);
    if (before) frames.push(before);

    const revise = async (context: PerceptionAttemptContext): Promise<SemanticAction | undefined> => {
      if (!revisePlanner) return undefined;
      const next = await revisePlanner(context);
      if (next) episode.steps.push(`revision after attempt ${context.attempt} targets missing: ${context.missing.join(", ") || "state"}`);
      return next;
    };

    let outcome: PerceptionOutcome = "FAILED";
    let reason = "Surface never satisfied the requirement";
    let nextAction: SemanticAction | undefined = plan[0];

    for (let attempt = 1; attempt <= maxAttempts && nextAction; attempt++) {
      episode.attempts = attempt;
      const action = nextAction;
      nextAction = undefined;
      const result = await this.surface.act(action);
      const observed = result.observed ?? "";
      if (observed) {
        const frame: PerceptionFrame = { kind: "after", at: now(), text: observed.slice(0, 4000) };
        const raw = await this.captureRaw();
        if (raw?.imagePath) frame.imagePath = raw.imagePath;
        if (raw?.surfaceId) frame.surfaceId = raw.surfaceId;
        frames.push(frame);
      }
      episode.steps.push(`attempt ${attempt}: ${action.name} on ${action.target} → ${result.status}`);
      if (result.status === "FAILED" || result.status === "UNCERTAIN") {
        frames.push({ kind: "error", at: now(), text: (result.message ?? result.status).slice(0, 2000) });
        nextAction = await revise({ attempt, requirement, observed, missing: [result.message ?? result.status], lastAction: action, lastMessage: result.message });
        if (!nextAction) { outcome = result.status === "UNCERTAIN" ? "FAILED" : "STOPPED"; reason = result.message ?? `${result.status} after attempt ${attempt}`; break; }
        continue;
      }
      const critique = critiqueRequirement(observed || "", requirement);
      if (critique.passed) {
        outcome = "PASSED";
        reason = `Requirement satisfied on attempt ${attempt}`;
        frames.push({ kind: "final", at: now(), text: observed.slice(0, 4000) });
        break;
      }
      frames.push({ kind: "error", at: now(), text: `missing: ${critique.missing.join(", ")}` });
      if (attempt >= maxAttempts) { outcome = "FAILED"; reason = `Requirement unmet after ${maxAttempts} attempt(s)`; break; }
      nextAction = await revise({ attempt, requirement, observed, missing: critique.missing, lastAction: action, lastMessage: result.message });
      if (!nextAction) { outcome = "STOPPED"; reason = `No revision available; missing: ${critique.missing.join(", ")}`; break; }
    }

    episode.frames = retainKeyFrames(frames);
    episode.outcome = outcome;
    episode.reason = reason;
    episode.completedAt = now();
    for (const frame of episode.frames) validatePerceptionFrame(frame);
    if (this.options.stateFile) writeJson(this.options.stateFile, { schemaVersion: 1, episode });
    return { episode };
  }

  /** Restore the last episode journal (key frames only) for operator display. */
  restore(): PerceptionEpisode | undefined {
    if (!this.options.stateFile) return undefined;
    const value = readJson<{ schemaVersion?: number; episode?: PerceptionEpisode }>(this.options.stateFile);
    return value?.schemaVersion === 1 && value.episode ? value.episode : undefined;
  }

  private async captureFrame(kind: PerceptionFrameKind, now: () => string): Promise<PerceptionFrame | undefined> {
    const raw = await this.captureRaw();
    if (!raw?.imagePath && !raw?.surfaceId) return undefined;
    return { kind, at: now(), ...(raw.imagePath ? { imagePath: raw.imagePath } : {}), ...(raw.surfaceId ? { surfaceId: raw.surfaceId } : {}) };
  }

  private async captureRaw(): Promise<{ imagePath?: string; surfaceId?: string } | undefined> {
    try { return await this.surface.capture?.(); } catch { return undefined; }
  }
}
