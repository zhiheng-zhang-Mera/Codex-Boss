import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ResearchCommandSpec } from "../../../src/shared/research-command";

/**
 * Structured research process runner (plan 9-6 Phase 6). Always
 * `spawn(executable, args)` with explicit cwd/timeout — never `shell:true`
 * with a model-generated string. Captures bounded stdout/stderr, honours
 * AbortSignal cancellation, and verifies expected markers.
 */

export interface ProcessResult {
  code: number;
  output: string;
  timedOut: boolean;
  cancelled: boolean;
  passed: boolean;
  durationMs: number;
}

const MAX_OUTPUT = 2000000;

export function runStructuredProcess(spec: ResearchCommandSpec, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ code: -1, output: "cancelled before start", timedOut: false, cancelled: true, passed: false, durationMs: 0 });
      return;
    }
    const started = Date.now();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcess;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ code: -1, output: "cancelled", timedOut: false, cancelled: true, passed: false, durationMs: Date.now() - started });
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      child = spawn(spec.executable, spec.args, {
        cwd: spec.cwd,
        windowsHide: true,
        env: { ...process.env, ...(spec.environment ?? {}) },
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      finish({ code: -1, output: String(error), timedOut: false, cancelled: false, passed: false, durationMs: Date.now() - started });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += String(chunk).slice(0, MAX_OUTPUT - stdout.length); });
    child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < 1000000) stderr += String(chunk).slice(0, 1000000 - stderr.length); });
    child.on("error", (error) => finish({ code: -1, output: String(error), timedOut: false, cancelled: false, passed: false, durationMs: Date.now() - started }));
    child.on("close", (code) => {
      const output = `${stdout}\n${stderr}`.trim();
      const passed = code === 0 && (spec.expectedOutputs?.every((marker) => output.includes(marker)) ?? true);
      finish({ code: code ?? -1, output, timedOut: false, cancelled: false, passed, durationMs: Date.now() - started });
    });
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ code: -1, output: `${stdout}\n${stderr}`.trim() + "\n[timed out]", timedOut: true, cancelled: false, passed: false, durationMs: Date.now() - started });
    }, spec.timeoutMs);
  });
}