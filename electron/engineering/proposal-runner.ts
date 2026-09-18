import fs from "node:fs";
import { workspacePath, executeNative } from "./native-tools";
import { parseManifest, applyManifest } from "./change-manifest";
import { digest, verifyAndRepair, type CheckSpec, type ChangeEvidence, type CheckEvidence } from "./verification";
import type { RunAllowedCommandOptions } from "./command-runner";
export interface ProposalResult { verificationHistory?: CheckEvidence[]; status: "PASS" | "FAIL"; changes: ChangeEvidence[]; checks: CheckEvidence[]; repairs: number; diff: string; }
export class ProposalRunner {
  constructor(private readonly worker: (prompt: string) => Promise<string>, private readonly checkOptions: RunAllowedCommandOptions = {}) {}
  async run(root: string, objective: string, authorizedPaths: string[], requiredChecks: CheckSpec[], options: { mayCreate?: (path: string) => boolean; onApplied?: (changes: ChangeEvidence[]) => void; authorizedPathsFor?: (attempt: number) => string[] } = {}): Promise<ProposalResult> {
    if (!authorizedPaths.length || !requiredChecks.length) throw new Error("Engineering requires explicit file and verification scope");
    const changes: ChangeEvidence[] = []; const verificationHistory: CheckEvidence[] = []; let repairs = 0;
    let proposalCount = 0;
    const propose = async (failures: CheckEvidence[] = []) => {
      proposalCount += 1;
      // THE SCOPE IS RE-DERIVED FOR EVERY PROPOSAL, INCLUDING REPAIRS.
      //
      // A repair pass runs after a write has already landed, so the set of files this run may edit is not
      // the set it started with — a file the first proposal CREATED is now an existing file, and the
      // creation grant no longer covers it. Passing a scope computed once meant the repair re-proposed that
      // file and died with "Change outside authorized scope", discarding the first proposal's work.
      // `authorizedPathsFor` lets the caller answer with what is true NOW; without it the array is used
      // exactly as before.
      const authorized = options.authorizedPathsFor ? options.authorizedPathsFor(proposalCount) : authorizedPaths;
      const files = authorized.map((file) => {
        const target = workspacePath(root, file);
        if (fs.existsSync(target) && fs.statSync(target).size > 100000) throw new Error("Proposal source exceeds budget");
        const content = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
        return { path: file, expectedSha256: content === null ? null : digest(content), content };
      });
      const prompt = JSON.stringify({ objective, files, failures, requiredChecks, responseContract: "Return strict JSON with changes:[{path,expectedSha256,content}] and checks copied exactly from requiredChecks. expectedSha256 must be copied EXACTLY as given for a listed file, and must be null when the file is new (no `files` entry for it). Syntax checks use singular file, while test checks use files. Change only listed files. Do not execute commands. Repair the reported failure without weakening checks." });
      if (prompt.length > 200000) throw new Error("Proposal context exceeds budget");
      const response = await this.worker(prompt);
      let manifest;
      try { manifest = parseManifest(response); }
      catch (error) { manifest = parseManifest(await this.worker(prompt + "\nCorrect the response schema once: " + String(error) + "\nUse the exact requiredChecks objects; syntax uses file, not files. Previous response: " + response.slice(0, 200000))); }
      const applied = applyManifest(root, manifest, authorized, options);
      changes.push(...applied);
      // Report the write THE MOMENT it lands, not when the whole run returns.
      //
      // `verifyAndRepair` below can invoke `propose` again and that call can throw, which abandons this
      // function's return value — and with it any bookkeeping done at the end. A caller that needs to know
      // which paths this run created (so a repair pass may edit them: see the create-grant note in
      // `engineering-goal-loop.ts`) therefore has to be told at the write, or the knowledge is lost exactly
      // when it is needed.
      options.onApplied?.(applied);
    };
    await propose();
    // Worker checks are advisory. Required checks are selected by the host before proposal.
    const checks = await verifyAndRepair(root, requiredChecks, async (failures, attempt) => { repairs = attempt; await propose(failures); }, 2, (evidence) => verificationHistory.push(...evidence), this.checkOptions);
    const diff = (await executeNative(root, { kind: "git_diff" })).output;
    return { status: checks.every((item) => item.passed) ? "PASS" : "FAIL", changes, checks, repairs, diff, verificationHistory };
  }
}
