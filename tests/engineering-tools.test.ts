import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { executeNative } from "../electron/engineering/native-tools";
import { runAllowedCommand } from "../electron/engineering/command-runner";
import { parseManifest, applyManifest } from "../electron/engineering/change-manifest";
import { digest, verifyAndRepair } from "../electron/engineering/verification";
const dirs: string[] = [];
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-native-")); dirs.push(dir); return dir; }
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })));
it("reads bounded source ranges and literal search matches", async () => {
  const root = fixture(); fs.writeFileSync(path.join(root, "a.txt"), "alpha\nbeta\ngamma");
  expect((await executeNative(root, { kind: "read_ranges", path: "a.txt", start: 2, end: 2 })).output).toBe("beta");
  expect((await executeNative(root, { kind: "search_text", path: "a.txt", text: "gamma" })).output).toBe("3:gamma");
  await expect(executeNative(root, { kind: "read_file", path: "../outside" })).rejects.toThrow("escapes");
});
it("executes real failing tests, applies an authorized repair, and verifies passing tests", async () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "sum.cjs"), "module.exports=(a,b)=>a-b;");
  fs.writeFileSync(path.join(root, "sum.test.cjs"), "const test=require('node:test');const assert=require('node:assert/strict');test('sum',()=>assert.equal(require('./sum.cjs')(2,3),5));");
  let repairs = 0;
  const result = await verifyAndRepair(root, [{ kind: "test", files: ["sum.test.cjs"] }], async (failures) => {
    expect(failures[0].passed).toBe(false); repairs++;
    const manifest = parseManifest(JSON.stringify({ changes: [{ path: "sum.cjs", expectedSha256: digest(fs.readFileSync(path.join(root, "sum.cjs"), "utf8")), content: "module.exports=(a,b)=>a+b;" }], checks: [{ kind: "test", files: ["sum.test.cjs"] }] }));
    applyManifest(root, manifest, ["sum.cjs"]);
  });
  expect(repairs).toBe(1); expect(result.every((item) => item.passed)).toBe(true);
  await expect(runAllowedCommand(root, "shell" as never)).rejects.toThrow("allowlisted");
  expect(() => parseManifest(JSON.stringify({ changes: [{ path: "sum.cjs", expectedSha256: null, content: "" }], checks: [{ kind: "shell", command: "anything" }] }))).toThrow("allowlisted");
}, 15000);
