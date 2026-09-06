import fs from "node:fs";
import { workspacePath } from "./native-tools";
import { applyScopedChanges, runCheck, type FileChange, type CheckSpec, type CheckEvidence } from "./verification";
import type { ProposalResult } from "./proposal-runner";
export class MergeCoordinator {
  private tail: Promise<void> = Promise.resolve();
  merge(root: string, workerRoot: string, proposal: ProposalResult, scope: string[], checks: CheckSpec[], resolveConflict?: (incoming: FileChange[], failure: string) => Promise<ProposalResult>): Promise<{ changes: ReturnType<typeof applyScopedChanges>; checks: CheckEvidence[] }> {
    const result = this.tail.then(async () => {
      if (proposal.status !== "PASS") throw new Error("Unverified worker patch cannot merge");
      const changes = new Map<string, FileChange>();
      for (const item of proposal.changes) if (!changes.has(item.path)) changes.set(item.path, { path: item.path, expectedSha256: item.before, content: fs.readFileSync(workspacePath(workerRoot, item.path), "utf8") });
      let applied: ReturnType<typeof applyScopedChanges>;
      try { applied = applyScopedChanges(root, [...changes.values()], scope); }
      catch (error) {
        if (!resolveConflict || !String(error).includes("Source changed since proposal")) throw error;
        const resolved = await resolveConflict([...changes.values()], String(error));
        if (resolved.status !== "PASS") throw new Error("Conflict resolution failed verification");
        return { changes: resolved.changes, checks: resolved.checks };
      }
      const evidence = await Promise.all(checks.map((check) => runCheck(root, check)));
      if (evidence.some((item) => !item.passed)) throw new Error("Merged workspace verification failed: " + JSON.stringify(evidence));
      return { changes: applied, checks: evidence };
    });
    this.tail = result.then(() => undefined, () => undefined); return result;
  }
}
