import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateExperimentImplementation, type ExperimentImplementationSpec } from "../../electron/research/research-conductor";

function specAt(workspace: string, metric = "answer_accuracy"): ExperimentImplementationSpec {
  return {
    researchQuestion: "Does adjudication reduce review errors?",
    hypothesis: "Evidence-weighted adjudication reduces review errors.",
    metric,
    baselineValue: "0.5",
    sampleDefinition: "fixed benchmark tasks × seeds",
    workspace,
    seedArgument: "--seed"
  };
}

describe("experiment generation from frozen protocol (Overcomplete §9.9)", () => {
  it("writes and dry-runs a coder implementation that emits the frozen metric", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "boss-expgen-"));
    try {
      const implFile = await generateExperimentImplementation(ws, specAt(ws), async (spec) => `// generated for ${spec.metric}
process.stdout.write('METRICS ${JSON.stringify({ answer_accuracy: 0.8 })}' + '\\n');
`);
      expect(fs.existsSync(implFile)).toBe(true);
      expect(implFile).toContain("answer-accuracy");
      expect(path.dirname(implFile).endsWith("experiments")).toBe(true);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  });

  it("rejects (fail closed) a coder implementation that omits the frozen metric", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "boss-expgen-bad-"));
    try {
      await expect(generateExperimentImplementation(ws, specAt(ws, "answer_accuracy"), async () => "process.stdout.write('METRICS {\"wrong_metric\":0.8}' + '\\n');")).rejects.toThrow(/metric contract/);
      // The poisoned file is removed so later scans never pick it up.
      expect(fs.readdirSync(path.join(ws, "experiments"))).toEqual([]);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  });

  it("rejects an implementation that prints no numeric METRICS line at all", async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "boss-expgen-none-"));
    try {
      await expect(generateExperimentImplementation(ws, specAt(ws), async () => "console.log('nothing useful');")).rejects.toThrow(/no numeric METRICS/);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  });
});
