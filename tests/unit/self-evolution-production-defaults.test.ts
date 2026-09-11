import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultEvolutionGovernanceRoot } from "../../electron/self-evolution/self-evolution-host";

describe("production self-evolution defaults", () => {
  it("keeps Root governance outside the Candidate evolution tree", () => {
    const userData = path.resolve("C:/runtime-data");
    const evolution = path.join(userData, "evolution");
    const governance = defaultEvolutionGovernanceRoot(userData);
    expect(path.relative(evolution, governance).startsWith("..")).toBe(true);
  });
});
