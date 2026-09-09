import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { prepareWorkspace, prepareStepWorkspace } from "../electron/engineering/workspace";
import { MergeCoordinator } from "../electron/engineering/merge-coordinator";
import { applyScopedChanges, digest, runCheck } from "../electron/engineering/verification";
import type { ProposalResult } from "../electron/engineering/proposal-runner";
it("isolates two workers inside the project and merges their real verified files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-merge-"));
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true });
    fs.writeFileSync(path.join(root, ".gitignore"), ".boss/\n");
    for (const file of ["a.js", "b.js"]) fs.writeFileSync(path.join(root, file), "const value=1;");
    git("init"); git("add", "."); git("-c", "user.name=Acceptance", "-c", "user.email=acceptance@example.invalid", "commit", "-m", "fixture");
    const parent = await prepareWorkspace(root, "parallel", "high", true);
    expect(parent.path.startsWith(root + path.sep)).toBe(true);
    const workers = await Promise.all(["a", "b"].map(async (id) => {
      const file = id + ".js"; const directory = await prepareStepWorkspace(parent.path, id, [file]);
      const changes = applyScopedChanges(directory, [{ path: file, expectedSha256: digest("const value=1;"), content: "const value=2;" }], [file]);
      const check = await runCheck(directory, { kind: "syntax", file });
      return { directory, file, proposal: { status: "PASS", changes, checks: [check], repairs: 0, diff: "" } as ProposalResult };
    }));
    expect(workers[0].directory).not.toBe(workers[1].directory);
    const merge = new MergeCoordinator();
    await Promise.all(workers.map((worker) => merge.merge(parent.path, worker.directory, worker.proposal, [worker.file], [{ kind: "syntax", file: worker.file }])));
    expect(fs.readFileSync(path.join(parent.path, "a.js"), "utf8")).toContain("value=2");
    expect(fs.readFileSync(path.join(parent.path, "b.js"), "utf8")).toContain("value=2");
    expect(fs.readFileSync(path.join(root, "a.js"), "utf8")).toContain("value=1");
    await expect(merge.merge(parent.path, workers[0].directory, workers[0].proposal, ["a.js"], [{ kind: "syntax", file: "a.js" }])).rejects.toThrow("Source changed");
    let resolved = false;
    await merge.merge(parent.path, workers[0].directory, workers[0].proposal, ["a.js"], [{ kind: "syntax", file: "a.js" }], async () => { resolved = true; const changes = applyScopedChanges(parent.path, [{ path: "a.js", expectedSha256: digest("const value=2;"), content: "const value=3;" }], ["a.js"]); return { status: "PASS", changes, checks: [await runCheck(parent.path, { kind: "syntax", file: "a.js" })], repairs: 0, diff: "" }; });
    expect(resolved).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
}, 30000);
