import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { checkpointRecord, rollbackToCheckpoint } from "../../electron/engineering/change-points";

const dirs: string[] = [];
// electron-as-node's fs.rmSync cannot delete git's read-only object files
// (plain node can); clear attributes first, with retries for transient locks.
function wipe(dir: string): void {
  if (!dir) return;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      if (fs.existsSync(dir)) {
        const stack = [dir];
        while (stack.length) {
          const current = stack.pop()!;
          try { fs.chmodSync(current, 0o666); } catch { /* ignore */ }
          for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const target = path.join(current, entry.name);
            try { fs.chmodSync(target, 0o666); } catch { /* ignore */ }
            if (entry.isDirectory()) stack.push(target);
          }
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch { /* transient handle / antivirus; retry */ }
  }
}
afterEach(() => dirs.splice(0).forEach(wipe));

function gitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-cp-"));
  dirs.push(dir);
  const run = (args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  run(["init", "-b", "main"]);
  run(["config", "user.email", "boss@test"]);
  run(["config", "user.name", "boss"]);
  run(["config", "core.autocrlf", "false"]); // byte-deterministic rollbacks on Windows
  fs.writeFileSync(path.join(dir, "base.txt"), "base content\n");
  run(["add", "."]);
  run(["commit", "-m", "base"]);
  return dir;
}

// Git/process-heavy tests need explicit timeouts: under full-suite parallel
// load the default 5s budget is not enough (same class of flake as the
// github-resolver and cli-process-recovery tests).
describe("engineering change-points (plan §38 checkpoint/rollback)", () => {
  it("reverts tracked files a change modified after a clean checkpoint", async () => {
    const dir = gitRepo();
    const checkpoint = await checkpointRecord(dir); // clean tree
    expect(checkpoint.dirty).toEqual([]);
    fs.writeFileSync(path.join(dir, "base.txt"), "changed content\n"); // the change
    const rollback = await rollbackToCheckpoint(dir, checkpoint);
    expect(rollback.restored).toContain("base.txt");
    expect(fs.readFileSync(path.join(dir, "base.txt"), "utf8")).toBe("base content\n");
  }, 90000);

  it("removes untracked files created after the checkpoint but never pre-existing ones", async () => {
    const dir = gitRepo();
    fs.writeFileSync(path.join(dir, "notes.txt"), "user notes"); // pre-existing untracked
    const checkpoint = await checkpointRecord(dir);
    expect(checkpoint.preExistingUntracked).toContain("notes.txt");
    fs.writeFileSync(path.join(dir, "generated.ts"), "new file"); // created by the change
    fs.writeFileSync(path.join(dir, "base.txt"), "broken"); // tracked change
    const rollback = await rollbackToCheckpoint(dir, checkpoint);
    expect(rollback.removed).toContain("generated.ts");
    expect(fs.existsSync(path.join(dir, "generated.ts"))).toBe(false); // removed
    expect(fs.existsSync(path.join(dir, "notes.txt"))).toBe(true); // user file kept
    expect(fs.readFileSync(path.join(dir, "base.txt"), "utf8")).toBe("base content\n");
  }, 90000);

  it("restores pre-existing user edits exactly while reverting the change layered on top", async () => {
    const dir = gitRepo();
    fs.writeFileSync(path.join(dir, "base.txt"), "wip content\n"); // user WIP before the change
    const checkpoint = await checkpointRecord(dir);
    expect(checkpoint.dirty).toContain("base.txt");
    expect(checkpoint.snapshots["base.txt"]).toBe("wip content\n");
    fs.writeFileSync(path.join(dir, "base.txt"), "wip content\nloop change\n"); // change on top of WIP
    const rollback = await rollbackToCheckpoint(dir, checkpoint);
    expect(rollback.restored).toContain("base.txt");
    expect(fs.readFileSync(path.join(dir, "base.txt"), "utf8")).toBe("wip content\n");
  }, 90000);

  it("is a no-op on a clean tree and fails closed when HEAD advanced", async () => {
    const dir = gitRepo();
    const checkpoint = await checkpointRecord(dir);
    expect(await rollbackToCheckpoint(dir, checkpoint)).toEqual({ restored: [], removed: [] });
    fs.writeFileSync(path.join(dir, "base.txt"), "next\n");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-m", "advanced"], { cwd: dir });
    await expect(rollbackToCheckpoint(dir, checkpoint)).rejects.toThrow(/advanced past checkpoint/);
  }, 90000);

  it("fails closed outside git", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "boss-cp-plain-"));
    dirs.push(plain);
    // A bogus .git marker stops discovery at this dir even when os.tmpdir sits
    // inside a git worktree (the nested audit run redirects TEMP into this
    // repo), so the dir genuinely is not a usable git workspace.
    fs.writeFileSync(path.join(plain, ".git"), "gitdir: C:/does-not-exist-boss\n");
    await expect(checkpointRecord(plain)).rejects.toThrow();
  }, 90000);
});
