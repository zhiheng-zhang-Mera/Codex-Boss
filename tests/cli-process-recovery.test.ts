import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CodexCliRuntime } from "../electron/runtimes/codex/codex-cli-runtime";
import { ExecutionSupervisor } from "../electron/commander/execution-supervisor";
import { TaskLedger } from "../electron/commander/task-ledger";
const state = vi.hoisted(() => ({ mode: "success", children: [] as any[], outputs: [] as string[] }));
vi.mock("node:child_process", async (importOriginal) => {
 const actual = await importOriginal<typeof import("node:child_process")>();
 return { ...actual,
 execFile: (_command: string, _args: string[], options: any, callback: any) => actual.execFile(process.execPath, ["-e", "console.log('Logged in using ChatGPT')"], options, callback),
 spawn: (_command: string, args: string[], options: any) => {
  const output = args[args.indexOf("--output-last-message") + 1]; state.outputs.push(output);
  const mode = state.mode === "death-once" ? (state.children.length ? "success" : "hang") : state.mode;
  const script = "const fs=require('node:fs');fs.writeFileSync('ready','ready');" +
    (mode === "hang" ? "setInterval(()=>{},1000);" : mode === "empty" ? "process.exit(0);" : "fs.writeFileSync(" + JSON.stringify(output) + ",'BOSS_PROCESS_RECOVERED');");
  const child = actual.spawn(process.execPath, ["-e", script], options); state.children.push(child); return child;
 }
 };
});
const dirs: string[] = [];
afterEach(async () => { await Promise.all(state.children.map(child => new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once("close", () => resolve()); child.kill(); }))); state.children = []; state.outputs = []; state.mode = "success"; dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })); });
function setup() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boss-process-")); dirs.push(dir); return { dir, runtime: new CodexCliRuntime(dir), ledger: new TaskLedger(path.join(dir, "ledger")) }; }
const request = { taskId: "task", jobId: "worker", prompt: "bounded fixture response", role: "coding" as const, replaySafe: true };
async function ready(dir: string) { const file = path.join(dir, "runtimes", "codex-cli", "ready"); const deadline = Date.now() + 5000; while (!fs.existsSync(file) && Date.now() < deadline) await new Promise(r => setTimeout(r, 20)); expect(fs.existsSync(file)).toBe(true); }
it("recovers after an actual worker process is killed and reuses the completed checkpoint", async () => {
 const { dir, runtime, ledger } = setup(); state.mode = "death-once";
 const supervisor = new ExecutionSupervisor(ledger); const result = supervisor.execute(request, [runtime]);
 await ready(dir); expect(state.children[0].kill()).toBe(true);
 expect((await result).content).toBe("BOSS_PROCESS_RECOVERED");
 expect(ledger.load("task")?.failureHistory[0].kind).toBe("PROCESS_CRASH");
 expect(ledger.load("task")?.jobs.worker.attempts).toBe(2);
 expect(new Set(state.outputs).size).toBe(2);
 await new ExecutionSupervisor(new TaskLedger(ledger.root)).execute(request, [runtime]);
 expect(state.children).toHaveLength(2);
}, 20000);
it("does not retry a cancelled child process", async () => {
 const { dir, runtime, ledger } = setup(); state.mode = "hang";
 const result = new ExecutionSupervisor(ledger).execute(request, [runtime]);
 await ready(dir); await runtime.cancel(request.jobId);
 expect((await result).status).toBe("CANCELLED"); expect(state.children).toHaveLength(1);
 await new ExecutionSupervisor(new TaskLedger(ledger.root)).execute(request, [runtime]);
 expect(state.children).toHaveLength(1); expect(ledger.load("task")?.nextAction).toBe("HUMAN_REQUIRED");
});
it("rejects a zero-exit attempt that has not written its own output", async () => {
 const { runtime } = setup();
 expect((await runtime.execute(request)).content).toBe("BOSS_PROCESS_RECOVERED");
 state.mode = "empty";
 const result = await runtime.execute(request);
 expect(result.status).toBe("PERMANENT_FAILURE"); expect(result.content).toBeUndefined();
 expect(state.outputs[0]).not.toBe(state.outputs[1]);
});
