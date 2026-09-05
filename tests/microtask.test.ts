import { describe, expect, it } from "vitest";
import { decomposeStep, readyMicrotasks, validateMicrotasks } from "../src/shared/microtask";
import type { TaskStep } from "../src/shared/task-ir";

const edit: TaskStep = { id: "edit-1", kind: "edit", description: "fix a and b", dependencies: [], requiredFiles: ["src/a.ts", "src/b.ts"] };

describe("microtask DAG decomposition", () => {
  it("expands an edit step into read → propose → verify microtasks", () => {
    const micro = decomposeStep(edit);
    const kinds = micro.map((item) => item.kind);
    expect(kinds.filter((kind) => kind === "read").length).toBeGreaterThan(0);
    expect(kinds.filter((kind) => kind === "propose").length).toBeGreaterThan(0);
    expect(kinds.at(-1)).toBe("verify");
    expect(micro.filter((item) => item.parentStepId).every((item) => item.parentStepId === "edit-1")).toBe(true);
    expect(() => validateMicrotasks(micro)).not.toThrow();
  });

  it("chunks large file scopes into multiple proposals", () => {
    const many: TaskStep = { id: "edit-2", kind: "edit", description: "wide change", dependencies: [], requiredFiles: Array.from({ length: 25 }, (_, index) => `src/f${index}.ts`) };
    const micro = decomposeStep(many, { maxFilesPerProposal: 10 });
    const proposals = micro.filter((item) => item.kind === "propose");
    expect(proposals.length).toBe(3);
    expect(proposals.every((item) => item.requiredFiles.length <= 10)).toBe(true);
    expect(() => validateMicrotasks(micro)).not.toThrow();
  });

  it("computes the ready set incrementally", () => {
    const micro = decomposeStep(edit);
    const all = new Set<string>();
    const first = readyMicrotasks(micro, all);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((item) => item.dependencies.length === 0)).toBe(true);
    for (const task of first) all.add(task.id);
    const second = readyMicrotasks(micro, all);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every((item) => item.dependencies.every((dependency) => all.has(dependency)))).toBe(true);
  });

  it("rejects duplicate ids and invalid dependencies", () => {
    expect(() => validateMicrotasks([{ id: "a", kind: "read", parentStepId: "s", description: "a", dependencies: [], requiredFiles: [] }, { id: "a", kind: "read", parentStepId: "s", description: "a2", dependencies: [], requiredFiles: [] }])).toThrow(/Duplicate/);
    expect(() => validateMicrotasks([{ id: "a", kind: "read", parentStepId: "s", description: "a", dependencies: ["missing"], requiredFiles: [] }])).toThrow(/Missing/);
  });
});
