import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { StructuredApplicationsBackend } from "../electron/computer/backends/structured-apps";
import { compileIntent } from "../src/shared/task-ir";
it("reads real workspace evidence with bounded structured interfaces", async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), "boss-structured-"));
 try {
  fs.writeFileSync(path.join(root, "terminal.log"), "BUILD PASSED");
  const backend = new StructuredApplicationsBackend(root, { readBrowser: async id => ({ id, title: "Fixture" }) });
  const run = (name: "read_page" | "verify_state", target: string, expected?: string) => backend.execute({ name, target, expected }, new AbortController().signal);
  expect((await run("read_page", "explorer:.")).evidence).toMatchObject({ entries: [{ name: "terminal.log", directory: false }] });
  expect((await run("verify_state", "terminal:terminal.log", "BUILD PASSED")).status).toBe("SUCCESS");
  expect((await run("verify_state", "terminal:terminal.log")).status).toBe("FAILED");
  expect((await run("verify_state", "terminal:terminal.log", "FAILED")).status).toBe("FAILED");
  await expect(run("read_page", "terminal:../outside")).rejects.toThrow();
  expect((await run("read_page", "browser:chatgpt")).evidence).toMatchObject({ state: { id: "chatgpt", title: "Fixture" } });
  expect((await run("read_page", "vscode:status")).status).toBe("UNSUPPORTED");
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it("compiles explicit desktop requests without a model", () => {
 expect(compileIntent("打开记事本").steps[0].operation).toEqual({ kind: "computer", action: { name: "open_app", target: "notepad" } });
 expect(compileIntent("查看项目目录").estimatedComplexity).toBe("L0");
 expect(() => compileIntent('desktop {"name":"exec","target":"shell"}')).toThrow();
});
