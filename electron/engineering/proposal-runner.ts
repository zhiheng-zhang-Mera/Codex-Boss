import fs from "node:fs";
import { workspacePath, executeNative } from "./native-tools";
import { parseManifest, applyManifest } from "./change-manifest";
import { digest, verifyAndRepair, type CheckSpec, type ChangeEvidence, type CheckEvidence } from "./verification";
import type { RunAllowedCommandOptions } from "./command-runner";
export interface ProposalResult { verificationHistory?: CheckEvidence[]; status: "PASS" | "FAIL"; changes: ChangeEvidence[]; checks: CheckEvidence[]; repairs: number; diff: string; }
export class ProposalRunner {
  constructor(private readonly worker: (prompt: string) => Promise<string>, private readonly checkOptions: RunAllowedCommandOptions = {}) {}
  async run(root: string, objective: string, authorizedPaths: string[], requiredChecks: CheckSpec[]): Promise<ProposalResult> {
    if (!authorizedPaths.length || !requiredChecks.length) throw new Error("Engineering requires explicit file and verification scope");
    const changes: ChangeEvidence[] = []; const verificationHistory: CheckEvidence[] = []; let repairs = 0;
    const propose = async (failures: CheckEvidence[] = []) => {
      const files = authorizedPaths.map((file) => {
        const target = workspacePath(root, file);
        if (fs.existsSync(target) && fs.statSync(target).size > 100000) throw new Error("Proposal source exceeds budget");
        const content = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
        return { path: file, expectedSha256: content === null ? null : digest(content), content };
      });
      const prompt = JSON.stringify({ objective, files, failures, requiredChecks, responseContract: "Return strict JSON with changes:[{path,expectedSha256,content}] and checks copied exactly from requiredChecks. Syntax checks use singular file, while test checks use files. Change only listed files. Preserve hashes exactly. Do not execute commands. Repair the reported failure without weakening checks." });
      if (prompt.length > 200000) throw new Error("Proposal context exceeds budget");
      const response = await this.worker(prompt);
      let manifest;
      try { manifest = parseManifest(response); }
      catch (error) { manifest = parseManifest(await this.worker(prompt + "\nCorrect the response schema once: " + String(error) + "\nUse the exact requiredChecks objects; syntax uses file, not files. Previous response: " + response.slice(0, 200000))); }
      changes.push(...applyManifest(root, manifest, authorizedPaths));
    };
    await propose();
    // Worker checks are advisory. Required checks are selected by the host before proposal.
    const checks = await verifyAndRepair(root, requiredChecks, async (failures, attempt) => { repairs = attempt; await propose(failures); }, 2, (evidence) => verificationHistory.push(...evidence), this.checkOptions);
    const diff = (await executeNative(root, { kind: "git_diff" })).output;
    return { status: checks.every((item) => item.passed) ? "PASS" : "FAIL", changes, checks, repairs, diff, verificationHistory };
  }
}
