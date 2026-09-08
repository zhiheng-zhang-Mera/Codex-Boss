import { describe, expect, it } from "vitest";
import { ExecutionGate } from "../../electron/commander/execution-gate";
import { TaskStateMachine } from "../../electron/commander/task-state-machine";

describe("deterministic commander gates", () => {
  it("owns lifecycle transitions", () => { const machine = new TaskStateMachine(); expect(machine.transition("queued", "running")).toBe("running"); expect(() => machine.transition("completed", "running")).toThrow(/Invalid/); });
  it("never executes unapproved artifact output", async () => { const gate = new ExecutionGate(); const proposal = gate.propose({ kind: "shell", description: "echo", payload: "echo unsafe", originArtifactId: "artifact" }); gate.validate(proposal.id); expect(gate.get(proposal.id)?.status).toBe("APPROVAL_REQUIRED"); await expect(gate.execute(proposal.id, async () => "ran")).rejects.toThrow(/not approved/); });
});
