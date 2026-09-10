import { describe, expect, it } from "vitest";
import {
  BLOCKER_STATE,
  countAllStatuses,
  evaluateTerminal,
  evidenceIntegrityForPass,
  FAILED_STATE,
  looksLikeEvidenceFileRef,
  matrixRows,
  TERMINAL_OK,
  validateBlockerEvidenceShape,
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
