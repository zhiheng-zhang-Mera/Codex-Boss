import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SemanticAction } from "../src/shared/semantic";
import { critiqueRequirement, retainKeyFrames, validatePerceptionRequirement } from "../src/shared/perception";
import { PerceptionLoop, type PerceptionSurface } from "../electron/computer/perception-loop";

const FIXED_NOW = () => "2026-09-06T00:00:00.000Z";

function makeSurface(script: Array<{ observed?: string; status?: "SUCCESS" | "FAILED" | "UNCERTAIN" }>): PerceptionSurface & { calls: SemanticAction[] } {
  const calls: SemanticAction[] = [];
  let index = 0;
  return {
    calls,
    async act(action) {
      calls.push(action);
      const step = script[Math.min(index++, script.length - 1)] ?? { status: "SUCCESS", observed: "" };
      return { status: step.status ?? "SUCCESS", observed: step.observed ?? "" };
    }
  };
}

const action = (name: SemanticAction["name"], target: string, value?: string): SemanticAction => ({ name, target, ...(value !== undefined ? { value } : {}) });

describe("perception requirement critique (pure)", () => {
  it("passes when every mustContain literal is present, listing what is missing otherwise", () => {
    expect(critiqueRequirement("The build is green and tests pass", { goal: "verify build", mustContain: ["green", "tests pass"] })).toEqual({ passed: true, missing: [] });
    expect(critiqueRequirement("build is green", { goal: "verify build", mustContain: ["green", "tests pass"] })).toEqual({ passed: false, missing: ["tests pass"] });
    expect(critiqueRequirement("BUILD IS GREEN", { goal: "verify build", mustContain: ["green"] }).passed).toBe(true);
  });

  it("validates requirements fail closed", () => {
    expect(() => validatePerceptionRequirement({ goal: "", mustContain: ["x"] })).toThrow();
    expect(() => validatePerceptionRequirement({ goal: "g", mustContain: [] })).toThrow();
    expect(() => validatePerceptionRequirement({ goal: "g", mustContain: ["   "] })).toThrow();
    expect(() => validatePerceptionRequirement({ goal: "g", mustContain: ["x"] })).not.toThrow();
  });
});

describe("key-frame retention policy (plan Â§24)", () => {
  it("keeps at most one frame per kind, newest wins, and rejects unknown kinds", () => {
    const at = FIXED_NOW();
    const frames = retainKeyFrames([
      { kind: "before", at, text: "b1" },
      { kind: "error", at, text: "e1" },
      { kind: "before", at, text: "b2" },
      { kind: "after", at, text: "a1" },
      { kind: "error", at, text: "e2" },
      { kind: "final", at, text: "f1" }
    ]);
    expect(frames.map((frame) => frame.kind)).toEqual(["before", "after", "error", "final"]);
    expect(frames.find((frame) => frame.kind === "before")?.text).toBe("b2");
    expect(frames.find((frame) => frame.kind === "error")?.text).toBe("e2");
    expect(() => retainKeyFrames([{ kind: "midway" as never, at }])).toThrow();
  });
});

describe("PerceptionLoop act â†?observe â†?critic â†?revise", () => {
  it("passes when the observed post-state satisfies the requirement and keeps only key frames", async () => {
    const surface = makeSurface([{ observed: "Status: ALL TESTS PASSED (12/12)" }]);
    const loop = new PerceptionLoop(surface, { now: FIXED_NOW, maxAttempts: 4 });
    const { episode } = await loop.run({ goal: "run tests", mustContain: ["ALL TESTS PASSED"] }, [action("run_test", "tests", "")], () => undefined);
    expect(episode.outcome).toBe("PASSED");
    expect(episode.reason).toContain("satisfied");
    expect(episode.attempts).toBe(1);
    expect(episode.frames.map((frame) => frame.kind)).toEqual(["after", "final"]);
    expect(surface.calls).toHaveLength(1);
  });

  it("revises on a failed critique using the revision planner and records error frames only", async () => {
    const surface = makeSurface([{ observed: "Status: 2 FAILED" }, { observed: "Status: ALL TESTS PASSED" }]);
    let revisions = 0;
    const planner = () => { revisions++; return action("run_test", "tests", ""); };
    const loop = new PerceptionLoop(surface, { now: FIXED_NOW, maxAttempts: 4 });
    const { episode } = await loop.run({ goal: "run tests", mustContain: ["ALL TESTS PASSED"] }, [action("run_test", "tests", "")], () => planner());
    expect(episode.outcome).toBe("PASSED");
    expect(episode.attempts).toBe(2);
    expect(revisions).toBe(1);
    expect(episode.frames.filter((frame) => frame.kind === "error")).toHaveLength(1);
    expect(episode.frames.some((frame) => frame.kind === "final")).toBe(true);
  });

  it("stops when no revision is available and never exceeds the bounded attempt cap", async () => {
    const surface = makeSurface([{ observed: "Status: 2 FAILED" }, { observed: "Status: still failing" }, { observed: "Status: failing again" }]);
    const loop = new PerceptionLoop(surface, { now: FIXED_NOW, maxAttempts: 2 });
    const { episode } = await loop.run({ goal: "run tests", mustContain: ["ALL TESTS PASSED"] }, [action("run_test", "tests", "")], () => undefined);
    expect(episode.outcome).toBe("STOPPED");
    expect(episode.reason).toContain("No revision available");
    expect(episode.attempts).toBeLessThanOrEqual(2);
  });

  it("surfaces uncertain/error actions as failures with a bounded journal", async () => {
    const surface = makeSurface([{ status: "UNCERTAIN", observed: "" }]);
    const loop = new PerceptionLoop(surface, { now: FIXED_NOW, maxAttempts: 1 });
    const { episode } = await loop.run({ goal: "submit form", mustContain: ["Saved"] }, [action("submit", "form", "")], () => undefined);
    expect(["FAILED", "STOPPED"]).toContain(episode.outcome);
    expect(episode.frames.some((frame) => frame.kind === "error")).toBe(true);
    expect(episode.frames.length).toBeLessThanOrEqual(4);
  });

  it("persists only the episode with key frames to the state file and restores it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-perception-"));
    try {
      const file = path.join(dir, "episode.json");
      const surface = makeSurface([{ observed: "saved: ok" }]);
      const loop = new PerceptionLoop(surface, { now: FIXED_NOW, stateFile: file });
      await loop.run({ goal: "save", mustContain: ["saved: ok"] }, [action("enter_text", "field", "x")], () => undefined);
      const restored = new PerceptionLoop(surface, { stateFile: file }).restore();
      expect(restored?.outcome).toBe("PASSED");
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(raw.schemaVersion).toBe(1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

