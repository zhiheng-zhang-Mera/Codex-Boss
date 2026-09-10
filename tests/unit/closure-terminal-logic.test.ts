import { describe, expect, it } from "vitest";
import {
  ALLOWED_MANIFEST_STATES,
  BLOCKER_STATE,
  countAllStatuses,
  evaluateTerminal,
  evidenceIntegrityForPass,
  FAILED_STATE,
  looksLikeEvidenceFileRef,
  matrixRows,
  MANIFEST_TRANSITIONS,
  TERMINAL_OK,
  transitionAllowed,
  validateBlockerEvidenceShape,
  validateManifestSchema,
  validateR202Evidence,
  validateR901Evidence,
} from "../../scripts/closure-terminal-logic.mjs";

const req = (id, status, { required = true, evidence = [] } = {}) => ({ id, required, status, evidence });
const allOk = (list, map, ok = true) => list.forEach((r) => { map[r.id] = ok; });

describe("closure-terminal-logic: legal terminal evaluation (Host-A §4)", () => {
  it("COMPLETE only when every required requirement is PASS/LOCKED_PASS with evidence", () => {
    const requirements = [req("R-1", "PASS", { evidence: ["evidence/r1.json"] }), req("L-1", "LOCKED_PASS", { evidence: ["x"] })];
    const evidenceOk = { "R-1": true, "L-1": true };
    const v = evaluateTerminal({ requirements, evidenceOk });
    expect(v.terminal).toBe("COMPLETE");
    expect(v.pending).toEqual([]);
  });

  it("COMPLETE is refused when a required PASS fails evidence integrity", () => {
    const requirements = [req("R-1", "PASS", { evidence: [] })];
    const v = evaluateTerminal({ requirements, evidenceOk: { "R-1": false } });
    expect(v.terminal).toBe("NO_LEGAL_TERMINAL_YET");
    expect(v.incompleteEvidence).toContain("R-1");
  });

  it("any LIVE_REQUIRED / REWORK / IN_PROGRESS / REQUIRED_PENDING blocks COMPLETE (NO_LEGAL_TERMINAL_YET)", () => {
    for (const st of ["LIVE_REQUIRED", "REWORK", "IN_PROGRESS", "REQUIRED_PENDING"]) {
      const requirements = [req("R-1", "PASS", { evidence: ["e"] }), req("R-2", st)];
      const v = evaluateTerminal({ requirements, evidenceOk: { "R-1": true } });
      expect(v.terminal, `status=${st}`).toBe("NO_LEGAL_TERMINAL_YET");
      expect(v.pending).toContain("R-2");
    }
  });

  it("BLOCKED_EXTERNAL allowed only with legal blocker evidence and all other required PASS", () => {
    const requirements = [req("R-1", "PASS", { evidence: ["e"] }), req("R-2", BLOCKER_STATE)];
    const v = evaluateTerminal({ requirements, evidenceOk: { "R-1": true }, blockerEvidenceOk: { "R-2": true } });
    expect(v.terminal).toBe("BLOCKED_EXTERNAL");
  });

  it("BLOCKED_EXTERNAL without structured blocker evidence is NOT a legal terminal", () => {
    const requirements = [req("R-1", "PASS", { evidence: ["e"] }), req("R-2", BLOCKER_STATE)];
    const v = evaluateTerminal({ requirements, evidenceOk: { "R-1": true }, blockerEvidenceOk: { "R-2": false } });
    expect(v.terminal).toBe("NO_LEGAL_TERMINAL_YET");
    expect(v.incompleteEvidence).toContain("R-2");
  });

  it("FAILED_WITH_EVIDENCE forces FAILED_TERMINAL, never COMPLETE", () => {
    const requirements = [req("R-1", "PASS"), req("R-2", FAILED_STATE)];
    const v = evaluateTerminal({ requirements, evidenceOk: { "R-1": true } });
    expect(v.terminal).toBe("FAILED_TERMINAL");
    expect(v.failed).toContain("R-2");
  });

  it("never emits the forbidden quasi-terminal BLOCKED_EXTERNAL_REQUIRED", () => {
    const requirements = [req("R-1", "PASS"), req("R-2", "LIVE_REQUIRED")];
    const v = evaluateTerminal({ requirements, evidenceOk: { "R-1": true } });
    expect(["COMPLETE", "BLOCKED_EXTERNAL", "FAILED_TERMINAL", "NO_LEGAL_TERMINAL_YET"]).toContain(v.terminal);
    expect(v.terminal).not.toMatch(/BLOCKED_EXTERNAL_REQUIRED/);
  });

  it("non-required items never affect the terminal state", () => {
    const requirements = [req("R-1", "PASS"), req("X-1", "REQUIRED_PENDING", { required: false })];
    const v = evaluateTerminal({ requirements, evidenceOk: { "R-1": true } });
    expect(v.terminal).toBe("COMPLETE");
  });
});

describe("closure-terminal-logic: blocker evidence shape (Host-A §5 schema)", () => {
  const legal = {
    requirement: "R-901", status: BLOCKER_STATE, attemptedAt: "2026-09-10T00:00:00Z",
    externalDependency: "dedicated uninterrupted host", observedState: "process reaped",
    operatorActionRequired: "run on dedicated VM", retryCondition: "host available",
    attemptEvidence: ["evidence/r901-attempt.json"],
  };

  it("accepts a fully structured blocker evidence", () => {
    expect(validateBlockerEvidenceShape(legal).ok).toBe(true);
  });

  it("rejects missing fields", () => {
    for (const field of ["attemptedAt", "externalDependency", "observedState", "operatorActionRequired", "retryCondition"]) {
      const { [field]: _drop, ...rest } = legal;
      const r = validateBlockerEvidenceShape(rest);
      expect(r.ok).toBe(false);
      expect(r.reasons.some((x) => x.includes(field))).toBe(true);
    }
  });

  it("rejects a wrong status and an empty attemptEvidence", () => {
    expect(validateBlockerEvidenceShape({ ...legal, status: "PASS" }).ok).toBe(false);
    expect(validateBlockerEvidenceShape({ ...legal, attemptEvidence: [] }).ok).toBe(false);
  });
});

describe("closure-terminal-logic: PASS evidence integrity (Phase C)", () => {
  const mkIo = (existing) => ({
    roots: ["/repo/evidence"],
    existsSync: (p) => existing.includes(p),
    resolve: (root, p) => `${root}/${p}`,
  });

  it("fails an empty evidence array", () => {
    const r = evidenceIntegrityForPass(req("R-1", "PASS", { evidence: [] }), mkIo([]));
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/empty/);
  });

  it("fails when a required evidence file is missing", () => {
    const r = evidenceIntegrityForPass(req("R-1", "PASS", { evidence: ["evidence/r1.json", "note (+3)"] }), mkIo(["/repo/evidence/unrelated.json"]));
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("evidence/r1.json"))).toBe(true);
  });

  it("passes when file-like evidence exists and descriptive strings are ignored", () => {
    const r = evidenceIntegrityForPass(req("R-1", "PASS", { evidence: ["evidence/r1.json", "tests foo (+3)", "round-25 live"] }), mkIo(["/repo/evidence/evidence/r1.json"]));
    expect(r.ok).toBe(true);
  });

  it("file-ref heuristic recognizes evidence/ paths and file suffixes only", () => {
    expect(looksLikeEvidenceFileRef("evidence/r1.json")).toBe(true);
    expect(looksLikeEvidenceFileRef("tests foo (+3)")).toBe(false);
    expect(looksLikeEvidenceFileRef("round-25 live battery")).toBe(false);
    expect(looksLikeEvidenceFileRef("C:\\repo\\evidence\\r1.json")).toBe(true);
  });
});

describe("closure-terminal-logic: R-901 evidence validator (Host-A §5/D4)", () => {
  const baseStats = {
    durationSec: 7200, activeTaskCount: 2, completed: 500, fatalFailed: 0,
    slowdownObserved: 3, retryObserved: 3, checkpointWritten: 300, checkpointResumed: 2,
    degradationObserved: 2, fallbackContinuationObserved: 5, providerRecoveryObserved: 2,
  };
  const goodEv = {
    requirement: "R-901", status: "PASS", formal: true, runId: "run-1", pid: 12,
    gitHead: "abcdef1234567890", startedAt: "2026-09-10T00:00:00Z", hostId: "host-1",
    nodeVersion: "v24", harnessVersion: "r901-soak-1", stats: baseStats,
    continuity: { startWallTime: "2026-09-10T00:00:00Z", endWallTime: "2026-09-10T02:00:00Z", maxHeartbeatGapMs: 5000 },
    schedule: [],
  };
  const heartbeats = [
    { ts: "2026-09-10T00:00:00Z" },
    { ts: "2026-09-10T01:00:00Z" },
    { ts: "2026-09-10T02:00:00Z" },
  ];
  const fineHeartbeats = Array.from({ length: 121 }, (_, i) => ({ ts: new Date(Date.UTC(2026, 8, 10, 0, i, 0)).toISOString() }));

  it("accepts a qualifying formal R-901 evidence", () => {
    const r = validateR901Evidence(goodEv, fineHeartbeats);
    expect(r.ok).toBe(true);
    expect(r.qualifiesForAcceptance).toBe(true);
  });

  it("rejects a short formal run (fail-closed 7200s)", () => {
    const ev = { ...goodEv, stats: { ...baseStats, durationSec: 7199 } };
    const r = validateR901Evidence(ev, fineHeartbeats);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("durationSec"))).toBe(true);
  });

  it("rejects fatal failures and missing required counters", () => {
    const ev1 = { ...goodEv, stats: { ...baseStats, fatalFailed: 1 } };
    expect(validateR901Evidence(ev1, fineHeartbeats).ok).toBe(false);
    const ev2 = { ...goodEv, stats: { ...baseStats, slowdownObserved: 0 } };
    expect(validateR901Evidence(ev2, fineHeartbeats).ok).toBe(false);
    const ev3 = { ...goodEv, stats: { ...baseStats, checkpointResumed: 0 } };
    expect(validateR901Evidence(ev3, fineHeartbeats).ok).toBe(false);
  });

  it("rejects an unprovable continuity gap for a formal run", () => {
    const ev = { ...goodEv, continuity: { startWallTime: "2026-09-10T00:00:00Z", endWallTime: "2026-09-10T02:00:00Z", maxHeartbeatGapMs: 9 * 60 * 1000 } };
    const sparse = [{ ts: "2026-09-10T00:00:00Z" }, { ts: "2026-09-10T01:30:00Z" }];
    const r = validateR901Evidence(ev, sparse);
    expect(r.ok).toBe(false);
  });

  it("a validation (non-formal) run never qualifiesForAcceptance", () => {
    const ev = { ...goodEv, status: "VALIDATION", formal: false };
    const r = validateR901Evidence(ev, heartbeats, { formal: false });
    expect(r.qualifiesForAcceptance).toBe(false);
  });
});

describe("closure-terminal-logic: R-202 evidence validator (Host-A §E4/§5)", () => {
  const livePass = {
    requirement: "R-202", status: "PASS", provider: "qwen", providerUrl: "https://chat.qwen.ai",
    authenticated: true, initialAction: "FAILED", recoveryEntered: true, recoverySlot: "computer-use",
    executor: "provider-page-repair/dom", readinessPassed: true,
    repairPlanSteps: ["capture", "readiness", "repair", "verify"], repairStatus: "REPAIRED",
    postConditionVerified: true, runId: "r202-1", gitHead: "abcdef1234567890",
  };

  it("accepts a live REPAIRED PASS evidence", () => {
    expect(validateR202Evidence(livePass).ok).toBe(true);
  });

  it("rejects a live evidence missing required fields", () => {
    const { gitHead: _g, ...missing } = livePass;
    const r = validateR202Evidence(missing);
    expect(r.ok).toBe(false);
    expect(r.reasons.some((x) => x.includes("gitHead"))).toBe(true);
  });

  it("never accepts REPAIRED without a verified post-condition", () => {
    expect(validateR202Evidence({ ...livePass, postConditionVerified: false }).ok).toBe(false);
  });

  it("accepts a legal structured BLOCKED_EXTERNAL evidence", () => {
    const blocker = {
      requirement: "R-202", status: "BLOCKED_EXTERNAL", attemptedAt: "2026-09-10T00:00:00Z",
      externalDependency: "operator login", observedState: "auth:false",
      operatorActionRequired: "log in to provider", retryCondition: "after login",
      attemptEvidence: ["evidence/r202-attempt.json"],
    };
    expect(validateR202Evidence(blocker).ok).toBe(true);
  });
});

describe("closure-terminal-logic: manifest state machine (Host-A Phase F single-writer)", () => {
  it("explicit transitions allow LIVE_REQUIRED -> PASS / BLOCKED_EXTERNAL / REWORK", () => {
    expect(MANIFEST_TRANSITIONS.LIVE_REQUIRED).toEqual(["PASS", "BLOCKED_EXTERNAL", "REWORK", "FAILED_WITH_EVIDENCE"]);
    expect(transitionAllowed("LIVE_REQUIRED", "PASS").ok).toBe(true);
    expect(transitionAllowed("LIVE_REQUIRED", "BLOCKED_EXTERNAL").ok).toBe(true);
    expect(transitionAllowed("LIVE_REQUIRED", "REWORK").ok).toBe(true);
  });

  it("LOCKED_PASS baselines cannot be changed", () => {
    expect(transitionAllowed("LOCKED_PASS", "REWORK").ok).toBe(false);
    expect(transitionAllowed("LOCKED_PASS", "PASS").ok).toBe(false);
  });

  it("never allows PASS -> LIVE_REQUIRED or invented quasi-terminals", () => {
    expect(transitionAllowed("PASS", "LIVE_REQUIRED").ok).toBe(false);
    expect(transitionAllowed("PASS", "BLOCKED_EXTERNAL_REQUIRED").ok).toBe(false);
    expect(transitionAllowed("REWORK", "COMPLETE").ok).toBe(false);
  });

  it("no-op transitions are rejected", () => {
    expect(transitionAllowed("PASS", "PASS").ok).toBe(false);
  });

  it("schema validator flags unknown statuses and malformed rows", () => {
    expect(validateManifestSchema({ requirements: [{ id: "R-1", status: "DONE", required: true }] }).length).toBeGreaterThan(0);
    expect(validateManifestSchema({ requirements: [{ id: "R-1", status: "PASS", required: true }] })).toEqual([]);
  });

  it("ALLOWED_MANIFEST_STATES is exactly the Host-A vocabulary", () => {
    expect(ALLOWED_MANIFEST_STATES).toEqual(
      expect.arrayContaining(["PASS", "LOCKED_PASS", "BLOCKED_EXTERNAL", "LIVE_REQUIRED", "REWORK", "IN_PROGRESS", "REQUIRED_PENDING", "FAILED_WITH_EVIDENCE"])
    );
    expect(ALLOWED_MANIFEST_STATES).not.toContain("COMPLETE");
    expect(ALLOWED_MANIFEST_STATES).not.toContain("BLOCKED_EXTERNAL_REQUIRED");
  });
});

describe("closure-terminal-logic: R-901 harness fail-closed guard (Host-A §D1/D6)", () => {
  it("a formal soak shorter than MIN_ACCEPTANCE_SECONDS is refused (exit 2)", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(process.execPath, ["scripts/r901-soak.cjs", "--seconds", "60"], { cwd: process.cwd(), encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/R901_FAIL_CLOSED/);
    expect(res.stderr).toMatch(/MIN_ACCEPTANCE_SECONDS=7200/);
  });

  it("the legacy soak harness can no longer emit acceptance evidence (exit 2)", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(process.execPath, ["scripts/closure-soak-2h.cjs"], { cwd: process.cwd(), encoding: "utf8" });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/R901_LEGACY_HARNESS_DISABLED/);
  });

  it("a validate-only run never claims acceptance (exit 0, qualifiesForAcceptance=false)", async () => {
    const { spawnSync } = await import("node:child_process");
    const res = spawnSync(process.execPath, ["scripts/r901-soak.cjs", "--validate-only", "--validate-seconds", "5", "--cooldown-ms", "1000"], { cwd: process.cwd(), encoding: "utf8", timeout: 120000 });
    expect(res.status).toBe(0);
    // Extract the final JSON summary object from stdout robustly.
    const out = res.stdout ?? "";
    const start = out.indexOf("{");
    expect(start).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(out.slice(start));
    expect(parsed.status).toBe("VALIDATION");
    expect(parsed.qualifiesForAcceptance).toBe(false);
  });
});

describe("closure-terminal-logic: helpers", () => {
  it("counts all statuses", () => {
    const requirements = [req("R-1", "PASS"), req("R-2", "LIVE_REQUIRED"), req("R-3", "PASS")];
    expect(countAllStatuses(requirements)).toEqual({ PASS: 2, LIVE_REQUIRED: 1 });
  });

  it("builds matrix rows with ASCII-safe slicing", () => {
    const rows = matrixRows([req("R-1", "PASS", { evidence: ["e1", "e2"] })]);
    expect(rows).toContain("| R-1 | PASS | - | e1; e2 |");
  });

  it("TERMINAL_OK / PENDING_STATES / BLOCKER_STATE / FAILED_STATE exports match Host-A vocabulary", () => {
    expect(TERMINAL_OK).toEqual(["PASS", "LOCKED_PASS"]);
    expect(BLOCKER_STATE).toBe("BLOCKED_EXTERNAL");
    expect(FAILED_STATE).toBe("FAILED_WITH_EVIDENCE");
  });
});
