import { describe, expect, it } from "vitest";
import { nextActionLabel, waitingLine } from "../../src/renderer/state";

describe("wait read-model (Overcomplete §12.3)", () => {
  it("renders the wait readout with reason, due time and next action", () => {
    const line = waitingLine({ status: "waiting", recoveryMessage: "Provider rate limit", recoveryAt: new Date("2026-01-02T15:30:00Z").getTime(), nextAction: "NEXT_STEP" });
    expect(line).toContain("Provider rate limit");
    expect(line).toContain("等待到");
    expect(line).toContain("下一动作：继续下一步");
  });

  it("stays empty for non-waiting tasks without a recovery message", () => {
    expect(waitingLine({ status: "running", recoveryMessage: undefined, recoveryAt: undefined, nextAction: undefined })).toBe("");
  });

  it("maps unknown actions to their raw value instead of inventing a label", () => {
    expect(nextActionLabel("WEIRD_ACTION")).toBe("WEIRD_ACTION");
    expect(nextActionLabel(undefined)).toBe("");
  });
});
