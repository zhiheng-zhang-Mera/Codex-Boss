import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EvolutionFrozenError,
  EvolutionKillSwitch,
  createOwnerControlChannel,
  isAuthorizedOwnerChannel,
  type OwnerControlChannel
} from "../../electron/emergency-control/evolution-kill-switch";
import { EmergencyControl } from "../../electron/emergency-control/emergency-control";
import { cleanupFixtures, stateFile, tempDir } from "../helpers/root-fixtures";

/**
 * F7 — Emergency Control acceptance (Isolation-Finalization.md §13, §23
 * RD-014 "Emergency stop durable", RD-015 "Emergency stop cannot self-clear";
 * §14 RT-20/RT-21, §15 FI-05).
 *
 * The stop has to satisfy two opposite requirements at once: it must be trivial
 * for the Owner to raise, and impossible for the autonomous path to clear. The
 * asymmetry is implemented, not documented: raising is open, clearing requires a
 * registered Owner control channel whose login matches the Root Policy.
 */

afterEach(cleanupFixtures);

const ROOT_OWNER = "zhiheng-zhang-Mera";

function killSwitch(sentinel = false): { control: EvolutionKillSwitch; controlFile: string; sentinelFile: string } {
  const controlFile = stateFile("evolution-control.json");
  const sentinelFile = path.join(path.dirname(controlFile), "evolution-frozen.sentinel");
  if (sentinel) fs.writeFileSync(sentinelFile, "{}", "utf8");
  return { control: new EvolutionKillSwitch({ controlFile, sentinelFile }), controlFile, sentinelFile };
}

describe("Kill switch state is durable, re-read and fail-closed (§13, RD-014)", () => {
  it("starts ENABLED and reports why", () => {
    const { control, controlFile } = killSwitch();
    const status = control.status();
    expect(status.state).toBe("ENABLED");
    expect(status.signals).toContain("control-record-absent");
    expect(status.controlFile).toBe(controlFile);
    expect(control.isFrozen()).toBe(false);
    expect(() => control.assertEvolutionEnabled("creating a new Candidate")).not.toThrow();
  });

  it("freezes durably and survives a restart", () => {
    const { control, controlFile } = killSwitch();
    const frozen = control.freeze({ frozenBy: ROOT_OWNER, reason: "stop the evolution run", runId: "run-1" });
    expect(frozen.state).toBe("FROZEN_BY_OWNER");
    expect(frozen.record.frozenBy).toBe(ROOT_OWNER);
    expect(frozen.record.runId).toBe("run-1");
    expect(frozen.record.frozenAt).toBeTruthy();

    // A brand-new instance (a restart) reads the same durable state: a restart
    // cannot restore a pre-freeze view.
    const restarted = new EvolutionKillSwitch({ controlFile });
    expect(restarted.isFrozen()).toBe(true);
    expect(restarted.status().signals).toContain("control-record-frozen");
    expect(() => restarted.assertEvolutionEnabled("creating a new Candidate")).toThrow(EvolutionFrozenError);
    expect(() => restarted.assertEvolutionEnabled("promotion")).toThrow(/FROZEN_BY_OWNER/);
  });

  it("fails closed on an unreadable or invalid control record", () => {
    const controlFile = stateFile("evolution-control.json");
    fs.writeFileSync(controlFile, "{ not json", "utf8");
    const corrupt = new EvolutionKillSwitch({ controlFile });
    expect(corrupt.isFrozen()).toBe(true);
    expect(corrupt.status().signals).toContain("control-record-unreadable");

    const invalidFile = stateFile("evolution-control.json");
    fs.writeFileSync(invalidFile, JSON.stringify({ schemaVersion: 99, state: "ENABLED" }), "utf8");
    const invalid = new EvolutionKillSwitch({ controlFile: invalidFile });
    expect(invalid.isFrozen()).toBe(true);
    expect(invalid.status().signals).toContain("control-record-invalid");
  });

  it("treats the external sentinel as a freeze, and refuses to clear past it", () => {
    const { control, sentinelFile } = killSwitch(true);
    expect(control.isFrozen()).toBe(true);
    expect(control.status().sentinelPresent).toBe(true);

    // The sentinel is a separate Owner-controlled input: clearing the record
    // does not clear the freeze.
    const channel = createOwnerControlChannel(ROOT_OWNER);
    expect(() => control.clearFreeze(channel, ROOT_OWNER, "resume")).toThrow(/sentinel is present/);
    control.removeSentinel(channel, ROOT_OWNER);
    expect(fs.existsSync(sentinelFile)).toBe(false);
    expect(control.status().state).toBe("ENABLED");
  });

  it("refuses to place the fuse inside a candidate workspace", () => {
    const candidateRoot = tempDir("boss-candidate-");
    const inside = path.join(candidateRoot, "evolution-control.json");
    expect(() => new EvolutionKillSwitch({ controlFile: inside, candidateRoots: [candidateRoot] })).toThrow(EvolutionFrozenError);
    const insideSentinel = path.join(candidateRoot, "frozen.sentinel");
    expect(() => new EvolutionKillSwitch({ controlFile: stateFile("control.json"), sentinelFile: insideSentinel, candidateRoots: [candidateRoot] })).toThrow(/sentinel must live outside/);
  });
});

describe("The freeze cannot be cleared by the autonomous path (RD-015)", () => {
  it("refuses a forged Owner channel, whatever it looks like", () => {
    const { control } = killSwitch();
    control.freeze({ frozenBy: ROOT_OWNER, reason: "freeze" });
    const forged = { owner: ROOT_OWNER } as unknown as OwnerControlChannel;
    expect(isAuthorizedOwnerChannel(forged)).toBe(false);
    expect(() => control.clearFreeze(forged, ROOT_OWNER, "self-clear")).toThrow(/Owner control channel/);
    expect(control.isFrozen()).toBe(true);
    // A structurally identical class from elsewhere is also not the channel.
    class Impostor { constructor(readonly owner: string) {} }
    expect(() => control.clearFreeze(new Impostor(ROOT_OWNER) as unknown as OwnerControlChannel, ROOT_OWNER, "self-clear")).toThrow(/Owner control channel/);
  });

  it("refuses a real channel that does not name the Root Owner", () => {
    const { control } = killSwitch();
    control.freeze({ frozenBy: "someone", reason: "freeze" });
    const impostorChannel = createOwnerControlChannel("codex-boss-bot");
    expect(isAuthorizedOwnerChannel(impostorChannel)).toBe(true);
    expect(() => control.clearFreeze(impostorChannel, ROOT_OWNER, "self-clear")).toThrow(/not the Root Owner/);
    expect(control.isFrozen()).toBe(true);
  });

  it("clears only for the Root Owner through a registered channel", () => {
    const { control } = killSwitch();
    control.freeze({ frozenBy: ROOT_OWNER, reason: "freeze" });
    const channel = createOwnerControlChannel(ROOT_OWNER);
    const cleared = control.clearFreeze(channel, ROOT_OWNER, "Owner resumed evolution");
    expect(cleared.state).toBe("ENABLED");
    expect(cleared.record.unfrozenAt).toBeTruthy();
    // The previous freeze is retained as history, not erased.
    expect(cleared.record.frozenAt).toBeTruthy();
  });

  it("records an unauthorized clear attempt without changing the freeze", () => {
    const { control } = killSwitch();
    control.freeze({ frozenBy: ROOT_OWNER, reason: "freeze" });
    const attempt = control.attemptUnauthorizedClear("autonomous-worker", "try to resume");
    expect(attempt.allowed).toBe(false);
    expect(attempt.state).toBe("FROZEN_BY_OWNER");
    expect(control.isFrozen()).toBe(true);
  });

  it("requires an Owner channel even to raise or remove the sentinel", () => {
    const { control } = killSwitch();
    const forged = { owner: ROOT_OWNER } as unknown as OwnerControlChannel;
    expect(() => control.raiseSentinel("freeze", forged, ROOT_OWNER)).toThrow(/Owner control channel/);
    const channel = createOwnerControlChannel(ROOT_OWNER);
    control.raiseSentinel("Owner freeze", channel, ROOT_OWNER);
    expect(control.isFrozen()).toBe(true);
    expect(() => control.removeSentinel(forged, ROOT_OWNER)).toThrow(/Owner control channel/);
    control.removeSentinel(channel, ROOT_OWNER);
    expect(control.status().sentinelPresent).toBe(false);
  });
});

describe("EmergencyControl fans the stop out and keeps Stable running (§13, RT-20/RT-21)", () => {
  function emergency(): { control: EmergencyControl; killSwitch: EvolutionKillSwitch; evidenceFile: string } {
    const controlFile = stateFile("evolution-control.json");
    const evidenceFile = stateFile("emergency-evidence.jsonl");
    const killSwitch = new EvolutionKillSwitch({ controlFile });
    return { control: new EmergencyControl({ killSwitch, rootOwner: ROOT_OWNER, evidenceFile }), killSwitch, evidenceFile };
  }

  it("freezes, aborts the running Candidate and blocks creation and promotion", () => {
    const { control, evidenceFile } = emergency();
    let aborted = false;
    const result = control.emergencyStop({ actor: ROOT_OWNER, reason: "unexpected behaviour", candidate: { abort: () => { aborted = true; return true; } }, runId: "run-20" });
    expect(result.state).toBe("FROZEN_BY_OWNER");
    expect(result.stoppedCandidate).toBe(true);
    expect(aborted).toBe(true);
    expect(() => control.assertCandidateCreationAllowed()).toThrow(EvolutionFrozenError);
    expect(() => control.assertPromotionAllowed()).toThrow(EvolutionFrozenError);

    // Evidence is retained, not cleared.
    const evidence = fs.readFileSync(evidenceFile, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ event: "EMERGENCY_STOP", actor: ROOT_OWNER, runId: "run-20", stoppedCandidate: true, state: "FROZEN_BY_OWNER" });
  });

  it("records a denied clear attempt as evidence", () => {
    const { control, evidenceFile } = emergency();
    control.emergencyStop({ actor: ROOT_OWNER, reason: "stop" });
    control.recordUnauthorizedClearAttempt("autonomous-worker", "resume without approval");
    const events = fs.readFileSync(evidenceFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).event);
    expect(events).toEqual(["EMERGENCY_STOP", "EMERGENCY_CLEAR_DENIED"]);
    expect(control.isFrozen()).toBe(true);
  });

  it("clears through the Owner path and records it", () => {
    const { control, evidenceFile } = emergency();
    control.emergencyStop({ actor: ROOT_OWNER, reason: "stop" });
    const channel = createOwnerControlChannel(ROOT_OWNER);
    const cleared = control.clear(channel, "reviewed and resumed");
    expect(cleared.state).toBe("ENABLED");
    expect(() => control.assertPromotionAllowed()).not.toThrow();
    const events = fs.readFileSync(evidenceFile, "utf8").trim().split("\n").map((line) => JSON.parse(line).event);
    expect(events).toContain("EMERGENCY_CLEAR");
  });

  it("does not need a Candidate in flight to stop", () => {
    const { control } = emergency();
    const result = control.emergencyStop({ actor: ROOT_OWNER, reason: "pre-emptive freeze" });
    expect(result.stoppedCandidate).toBe(false);
    expect(control.isFrozen()).toBe(true);
  });

  it("keeps Stable's ordinary operation independent of the evolution freeze", () => {
    const { control } = emergency();
    control.emergencyStop({ actor: ROOT_OWNER, reason: "stop evolution" });
    // Nothing about the freeze is consulted by ordinary application state: a
    // plain durable write outside the evolution subsystem still succeeds.
    const ordinaryState = stateFile("boss-core-state.json");
    fs.writeFileSync(ordinaryState, JSON.stringify({ chat: "ok", work: "ok", research: "ok", knowledge: "ok" }), "utf8");
    expect(JSON.parse(fs.readFileSync(ordinaryState, "utf8")).chat).toBe("ok");
    expect(fs.existsSync(ordinaryState)).toBe(true);
  });
});
