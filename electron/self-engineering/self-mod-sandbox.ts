import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { changeAllowed } from "../../src/shared/guardian";
import { decideABPromotion, candidateCompatibilityVerdicts, validateSelfModCandidate, type ABEvaluation, type CompatibilityVerdict, type SelfModCandidate, type SelfModReplaySummary, type SelfModStatus, type SelfModTestSummary } from "../../src/shared/self-modification";
import { CURRENT_VERSIONS, type CompatibilityAxis, type VersionWindow } from "../../src/shared/compatibility";

/**
 * Self-modification sandbox + Dual BOSS (plan AP27). BOSS-A production creates
 * a candidate (BOSS-B) branch, applies a bounded modification, runs targeted
 * tests, replays historical goldens, A/B-evaluates against the production
 * baseline and verifies old Workspace / Adapter compatibility — then promotes
 * or discards. The heavy operations (git branch, test runner, replay runner,
 * model edit) are injected so the sandbox is deterministic and fail-closed
 * under test; production wires the engineering runtime + Codex model here.
 */

export interface SelfModOps {
  /** Create the candidate branch/worktree off baseCommit. Returns branch id. */
  createCandidateBranch(input: { id: string; baseCommit: string }): Promise<{ branch: string; baseCommit: string }>;
  /** Apply the bounded modification to the candidate branch. */
  applyModification(input: { branch: string; goal: string }): Promise<{ headCommit: string }>;
  /** Run the candidate's targeted test suite. */
  runTargetedTests(input: { branch: string; headCommit: string }): Promise<SelfModTestSummary>;
  /** Replay historical goldens against the candidate. */
  replayHistorical(input: { branch: string; headCommit: string }): Promise<SelfModReplaySummary>;
  /** Baseline pass rate for the same goldens from production (null when none). */
  productionBaseline(): Promise<number | null>;
  /** Merge the candidate branch into production. */
  promote(input: { branch: string }): Promise<void>;
  /** Delete/discard the candidate branch. */
  discard(input: { branch: string }): Promise<void>;
}

export interface SandboxFile {
  schemaVersion: 1;
  candidates: SelfModCandidate[];
}

export class SelfModificationSandbox {
  private readonly candidates = new Map<string, SelfModCandidate>();

  constructor(private readonly filePath: string, private readonly ops: SelfModOps, private readonly scope = "workspace:default") {
    this.restore();
  }

  /** Opens a new candidate (BOSS-B) for a goal and returns it in CANDIDATE state. */
  async begin(input: { goal: string; id?: string; baseCommit?: string }): Promise<SelfModCandidate> {
    const id = input.id ?? `candidate-${randomUUID()}`;
    const baseCommit = input.baseCommit ?? "HEAD";
    const created = await this.ops.createCandidateBranch({ id, baseCommit });
    const candidate: SelfModCandidate = {
      id, goal: input.goal.trim(), baseCommit: created.baseCommit, branch: created.branch,
      status: "CANDIDATE", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    validateSelfModCandidate(candidate);
    this.candidates.set(id, candidate);
    this.persist();
    return structuredClone(candidate);
  }

  /** Applies the bounded modification and records the head commit. */
  async modify(id: string): Promise<SelfModCandidate> {
    const candidate = this.require(id);
    this.guard(candidate, "CANDIDATE", "mutation");
    const head = await this.ops.applyModification({ branch: candidate.branch, goal: candidate.goal });
    return this.transition(id, "TESTING", (item) => { item.headCommit = head.headCommit; item.error = undefined; });
  }

  /** Runs targeted tests; red tests move the candidate to FAILED. */
  async test(id: string): Promise<SelfModCandidate> {
    const candidate = this.require(id);
    this.guard(candidate, ["CANDIDATE", "TESTING"], "testing");
    const tests = await this.ops.runTargetedTests({ branch: candidate.branch, headCommit: candidate.headCommit ?? "HEAD" });
    const next = this.transition(id, tests.failed > 0 ? "FAILED" : "REPLAYING", (item) => { item.tests = tests; item.error = tests.failed > 0 ? `targeted tests failed ${tests.failed}/${tests.total}` : undefined; });
    return next;
  }

  /** Replays historical goldens on the candidate and moves to A/B evaluation. */
  async replay(id: string): Promise<SelfModCandidate> {
    const candidate = this.require(id);
    this.guard(candidate, ["CANDIDATE", "TESTING", "REPLAYING"], "replay");
    const replay = await this.ops.replayHistorical({ branch: candidate.branch, headCommit: candidate.headCommit ?? "HEAD" });
    return this.transition(id, "AB_EVALUATING", (item) => { item.replay = replay; });
  }

  /**
   * A/B evaluation + compatibility impact. A Guardian token is required to
   * PROMOTE through the `promotion.gate` protected area; discarding is always
   * allowed. When no baseline exists and goldens are empty the decision stays
   * HUMAN so nothing auto-promotes without evidence.
   */
  async evaluate(id: string, input: {
    guardToken?: boolean;
    adapters?: Array<{ id: string; kind: string; windows: Partial<Record<CompatibilityAxis, VersionWindow>> }>;
    workspaces?: Array<{ id: string; version: string }>;
    minWorkspaceSchema?: string;
    requireBaseline?: boolean;
  } = {}): Promise<SelfModCandidate> {
    const candidate = this.require(id);
    this.guard(candidate, ["CANDIDATE", "TESTING", "REPLAYING", "AB_EVALUATING"], "evaluation");
    const baselineRate = await this.ops.productionBaseline();
    const candidateRate = candidate.replay?.candidateRate ?? null;
    const goldens = candidate.replay?.goldens ?? [];
    const requireBaseline = input.requireBaseline ?? goldens.length === 0;
    const decision = decideABPromotion({ baselineRate, candidateRate, tests: candidate.tests, requireBaseline });
    const compatibility = candidateCompatibilityVerdicts({
      candidateVersions: CURRENT_VERSIONS,
      adapters: input.adapters ?? [],
      workspaces: input.workspaces,
      minWorkspaceSchema: input.minWorkspaceSchema
    });
    const blocking = compatibility.filter((verdict) => !verdict.ok);
    let ab = decision;
    if (blocking.length) {
      ab = { ...decision, verdict: "DISCARD", reasons: [...decision.reasons, `incompatible with production contracts: ${blocking.map((item) => item.reason).join("; ")}`] };
    }
    const gate = changeAllowed("promotion.gate", Boolean(input.guardToken), this.scope);
    let verdict: SelfModStatus;
    let error: string | undefined;
    if (ab.verdict === "PROMOTE") {
      if (!gate.allowed) { verdict = "FAILED"; error = `Guardian denial: ${gate.reason}`; }
      else { verdict = "PROMOTED"; }
    } else if (ab.verdict === "DISCARD") {
      verdict = "DISCARDED";
    } else {
      // HUMAN: the candidate stays durable awaiting a human decision, never auto-promotes.
      verdict = "AB_EVALUATING";
      error = `A/B decision HUMAN: ${ab.reasons.join("; ")}`;
    }
    return this.transition(id, verdict, (item) => {
      item.ab = ab;
      item.compatibility = compatibility;
      item.error = error;
    });
  }

  /**
   * Executes the promotion/discard side effect once the decision is final.
   * HUMAN decisions stay pending (conclude refuses); hard failures discard the
   * candidate branch so a bad self-modification cannot leak into production.
   */
  async conclude(id: string): Promise<SelfModCandidate> {
    const candidate = this.require(id);
    if (candidate.status === "PROMOTED") {
      await this.ops.promote({ branch: candidate.branch });
      return this.require(id);
    }
    if (candidate.status === "DISCARDED" || candidate.status === "FAILED") {
      await this.ops.discard({ branch: candidate.branch });
      return this.require(id);
    }
    throw new Error(`Candidate ${id} awaits a final decision (${candidate.status})`);
  }

  /** Manual rollback after a bad promotion (plan §28 protected `rollback` area). */
  async rollback(id: string, guardToken: boolean): Promise<SelfModCandidate> {
    const candidate = this.require(id);
    const gate = changeAllowed("rollback", guardToken, this.scope);
    if (!gate.allowed) throw new Error(gate.reason);
    return this.transition(id, "ROLLED_BACK", (item) => { item.error = "rolled back by operator"; void candidate; });
  }

  get(id: string): SelfModCandidate | undefined {
    const value = this.candidates.get(id);
    return value && structuredClone(value);
  }

  list(): SelfModCandidate[] { return [...this.candidates.values()].map((item) => structuredClone(item)); }

  private require(id: string): SelfModCandidate {
    const candidate = this.candidates.get(id);
    if (!candidate) throw new Error(`Unknown self-modification candidate: ${id}`);
    return candidate;
  }

  private guard(candidate: SelfModCandidate, allowed: SelfModStatus | SelfModStatus[], phase: string): void {
    const states = Array.isArray(allowed) ? allowed : [allowed];
    if (!states.includes(candidate.status)) throw new Error(`Candidate ${candidate.id} cannot ${phase} in state ${candidate.status}`);
  }

  private transition(id: string, status: SelfModStatus, update: (candidate: SelfModCandidate) => void): SelfModCandidate {
    const candidate = this.require(id);
    const next: SelfModCandidate = { ...structuredClone(candidate), status, updatedAt: new Date().toISOString() };
    update(next);
    validateSelfModCandidate(next);
    this.candidates.set(id, next);
    this.persist();
    return structuredClone(next);
  }

  private restore(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Partial<SandboxFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.candidates)) throw new Error("Invalid self-modification sandbox");
      for (const candidate of parsed.candidates) {
        validateSelfModCandidate(candidate);
        this.candidates.set(candidate.id, candidate);
      }
    } catch (error) {
      // Fail closed on corrupt sandbox state: no candidate silently resumes.
      throw error;
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const file: SandboxFile = { schemaVersion: 1, candidates: [...this.candidates.values()] };
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(file, null, 2), "utf8");
    try { fs.renameSync(temporary, this.filePath); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EEXIST", "EPERM"].includes(code ?? "")) throw error;
      try { fs.copyFileSync(temporary, this.filePath); }
      catch { fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf8"); }
      fs.rmSync(temporary, { force: true });
    }
  }
}
